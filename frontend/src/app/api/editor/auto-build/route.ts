import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PROJECTS_DIR,
  RAW_DIR,
  TRANSCRIPTS_DIR,
  REMOTION_DIR,
  RENDERS_DIR,
  PYTHON_EXE,
  PYTHON_DIR,
  FFMPEG_EXE,
  DATA_ROOT,
} from "@/lib/paths";
import { humanizeError } from "@/lib/humanize-error";
import { canRender, registerRender } from "@/lib/license";
import { applyWizardOverrides } from "@/lib/apply-wizard-overrides";
import {
  buildProjectForStyle,
  pickRandomMusicTrack,
  type BuildContext,
} from "@/lib/style-templates";
import { createJob, updateStep, setCurrentStyle, type Job } from "@/lib/job-store";
import { enqueue } from "@/lib/job-queue";
import { autoMatchBroll, type BrollClip } from "@/lib/pexels";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import { readSettings } from "@/lib/user-settings";
import { runProcess } from "@/lib/run-process";
import {
  remotionConcurrency,
  renameWithRetry,
  REMOTION_DELAY_TIMEOUT_MS,
  offthreadCacheFlag,
} from "@/lib/render-utils";
import { renderWithServer, renderServerEnabled } from "@/lib/render-server-client";
import {
  pickTopKeywords,
  sanitizeForFilename,
  generateContentTitle,
  type TranscriptWord,
} from "@/lib/content-title";
import {
  type AutoBuildRequest,
  type ResolvedProject,
} from "./lib/types";
import {
  STYLE_SHORT_LABEL,
  dimensionsFromAspect,
  uniqueProjectId,
} from "./lib/helpers";
import { enrichCinematic } from "./lib/enrich-cinematic";
import { resolveImageOverlays } from "./lib/resolve-overlays";
import { applyBeatSync } from "./lib/beat-sync";
import {
  applyTracking,
  applyRemoveBg,
  applyVoiceover,
  applyTextBehind,
  applyTranslate,
  applyGraphics,
  applyIllustrations,
  applyEditorialCutout,
  applyEmotionDirector,
} from "./lib/fx-enrichments";
import { styleHasIllustrations } from "@/lib/style-registry";
import { applyCineClasico } from "./lib/cine-clasico";

export const dynamic = "force-dynamic";
export const maxDuration = 1800;

// CinematicConfig, AutoBuildRequest, ResolvedProject viven en ./lib/types.
// dimensionsFromAspect, findRawVideo, uniqueProjectId, STYLE_SHORT_LABEL viven en ./lib/helpers.
// TranscriptWord, pickTopKeywords, sanitizeForFilename, generateContentTitle viven en @/lib/content-title.
// runProcess + parseLastJsonLine viven en @/lib/run-process.

// ─── #6 — Encoder por hardware para el paso de LUT (fusión, evita doble encode) ──
// hw_profile.py recomienda el encoder en DATA_ROOT/cache/hw_profile.json. Para el
// grade LUT, en vez de encodear SIEMPRE en libx264 'medium' y DESPUÉS re-encodear
// en NVENC (postencode = doble encode), leemos el encoder recomendado y hacemos el
// lut3d + encode por hardware en UNA sola pasada. Si el encoder es libx264 (sin GPU
// usable) mantenemos el camino viejo (libx264) + postencode no-op.
//
// Estos args ESPEJAN hw_profile.ffmpeg_video_args('final') (h264_nvenc p5/cq19,
// qsv gq19/slow, amf qp19) para preservar EXACTAMENTE el mismo look/calidad que el
// postencode que se haría después. Si el JSON falta o algo no calza → libx264.
function hwLutVideoArgs(): { encoder: string; args: string[] } {
  let encoder = "libx264";
  try {
    const j = JSON.parse(
      readFileSync(path.join(DATA_ROOT, "cache", "hw_profile.json"), "utf-8")
    );
    const v = j?.recommend?.video_encoder;
    if (typeof v === "string") encoder = v;
  } catch {
    /* sin perfil → libx264 (camino viejo) */
  }
  switch (encoder) {
    case "h264_nvenc":
      return {
        encoder,
        args: [
          "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19",
          "-b:v", "0", "-spatial-aq", "1", "-temporal-aq", "1",
        ],
      };
    case "h264_qsv":
      return { encoder, args: ["-c:v", "h264_qsv", "-global_quality", "19", "-preset", "slow"] };
    case "h264_amf":
      return {
        encoder,
        args: ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "19", "-qp_p", "19"],
      };
    default:
      // libx264: el grade LUT del camino viejo (CRF 18, preset medium). Lo
      // mantenemos idéntico para no cambiar el look en equipos CPU-only.
      return { encoder: "libx264", args: ["-c:v", "libx264", "-crf", "18", "-preset", "medium"] };
  }
}

export async function processJob(job: Job, body: AutoBuildRequest) {
  // Usar job.videoId (siempre string) en lugar de body.videoId (opcional ahora con batch)
  const videoId = job.videoId;
  const { accentColor, caption, captionMeta, platforms, day } = body;
  const hasWizardCopy = Boolean(captionMeta && caption);

  // 1. Verificar transcript — y si FALTA, transcribir ACÁ como primer paso del job.
  // Wizard homogéneo (paridad con largos): el wizard de cortos ya NO escucha el video
  // a mitad de flujo; TODO el trabajo (transcribir → construir → renderizar) ocurre al
  // final, cuando el usuario ya eligió todo. Mismo candado serial que /api/videos/
  // transcribe (varias transcripciones a la vez saturan CPU/VRAM).
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  let transcript: { duration: number; words: TranscriptWord[] };
  try {
    transcript = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
  } catch {
    for (const s of job.styles) {
      updateStep(job.id, s, { status: "building", progress: 2 });
    }
    console.log(`[auto-build] ${videoId}: sin transcripción — escuchando el video primero…`);
    try {
      const files = await fs.readdir(RAW_DIR);
      const match = files.find((f) => path.basename(f, path.extname(f)) === videoId);
      if (!match) throw new Error("el video ya no está en la carpeta de videos");
      const { runPythonJson } = await import("@/lib/run-python");
      const { withSerialLock } = await import("@/lib/serial-lock");
      const tr = await withSerialLock("transcribe", () =>
        runPythonJson("transcribe.py", [path.join(RAW_DIR, match)], {
          idleTimeoutMs: 8 * 60 * 1000,
        })
      );
      if (!tr.ok) throw new Error(tr.stderr.slice(-300) || "transcribe.py falló");
      transcript = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
    } catch (err) {
      const human = humanizeError(String(err), "No se pudo escuchar el audio del video.");
      for (const s of job.styles) {
        updateStep(job.id, s, { status: "fail", error: human.message });
      }
      return;
    }
  }

  // 2. Cuts si es necesario
  const needsCuts = job.styles.some(
    (s) => s === "hype_max" || s === "hype_max_sfx" || s === "graphics_max"
  );
  if (needsCuts) {
    const cutMp4 = path.join(RAW_DIR, `${videoId}_cut.mp4`);
    try {
      await fs.access(cutMp4);
    } catch {
      await runProcess(PYTHON_EXE, [path.join(PYTHON_DIR, "detect_silences.py"), `${videoId}.mp4`], PYTHON_DIR, undefined, 300_000);
      // F2 — Muletillas en español: resta "eh/este…/o sea" (con firma de duda) de los
      // keep_segments ANTES de cortar. El _cut.mp4 sale sin silencios NI muletillas,
      // y los subtítulos las pierden solos en el remap. Best-effort.
      await runProcess(PYTHON_EXE, [path.join(PYTHON_DIR, "detect_fillers.py"), videoId], PYTHON_DIR, undefined, 60_000);
      await runProcess(PYTHON_EXE, [path.join(PYTHON_DIR, "cut_silences.py"), `${videoId}.mp4`], PYTHON_DIR, undefined, 600_000);
    }
  }

  // 3. Contexto + aspect ratio + cinematic (opt-in)
  const keywords = pickTopKeywords(transcript.words, 7);
  const { width, height } = dimensionsFromAspect(body.aspectRatio);

  // Cargar overlays del store si vienen IDs (modo cinematográfico).
  // Resolver de timestamps (matcher determinístico → asamblea LLM si hace falta → fallback).
  const imageOverlaysForCtx: BuildContext["imageOverlays"] = await resolveImageOverlays({
    overlayIds: body.cinematic?.overlayIds ?? [],
    transcriptPath,
    transcriptDuration: transcript.duration,
    videoId,
  });

  // ─── Auto-enriquecimiento cinematográfico ──────────────────────────────────
  // Cuando hay imageOverlays, generar auto SFX + camera moves + jump cuts.
  // Densidad configurable (default medium). En tests A/B/C cambia entre low/medium/high.
  const cinematicDensity = (body.cinematic?.density as "low" | "medium" | "high") ?? "medium";
  const { autoSfxMarks, autoCameraMoves, autoStutterMarks } = await enrichCinematic({
    density: cinematicDensity,
    imageOverlays: imageOverlaysForCtx,
    transcript,
    transcriptPath,
    videoId,
  });

  // B6 — Handle para la marca de agua y el end-screen: prioridad instagram → linkedin →
  // tiktok → facebook. Si no hay ninguno configurado en settings, watermark y handle del
  // end-screen quedan vacíos y ViralVideo no los renderiza (render idéntico). Se lee una
  // sola vez por job, no por estilo, y ANTES del ctx para que los estilos lo hereden.
  let brandHandle = "";
  try {
    const s = await readSettings();
    brandHandle =
      s.handles?.instagram ||
      s.handles?.linkedin ||
      s.handles?.tiktok ||
      s.handles?.facebook ||
      "";
  } catch {
    /* sin settings → sin watermark, no rompe */
  }

  const ctx: BuildContext = {
    videoId,
    duration: transcript.duration,
    keywords,
    accentColor,
    caption,
    day,
    width,
    height,
    imageOverlays: imageOverlaysForCtx,
    filmGrain: body.cinematic?.filmGrain ?? false,
    subtitleCinematic: body.cinematic?.subtitleCinematic ?? false,
    autoSfxMarks,
    autoCameraMoves,
    autoStutterMarks,
    cinematicDensity,
    ...(brandHandle ? { brandHandle } : {}),
  };

  await fs.mkdir(PROJECTS_DIR, { recursive: true });

  // Título corto basado en el CONTENIDO del video (lo que más se dice), para que el archivo
  // de salida sea identificable: "<Título> <Estilo>.mp4". Cae al videoId si no hay nada útil.
  const contentTitle = sanitizeForFilename(generateContentTitle(transcript.words)) || videoId;

  // 4. Procesar cada estilo
  for (const styleId of job.styles) {
    setCurrentStyle(job.id, styleId);
    updateStep(job.id, styleId, { status: "building", progress: 5 });

    // projectId = nombre del archivo de salida (.mp4 y .json). Declarado afuera del try
    // para poder limpiar el temporal en el catch. Se arma con el título + estilo legible.
    let projectId = `${videoId}_${styleId}${body.projectIdSuffix ?? ""}`;
    try {
      const baseProject = buildProjectForStyle(ctx, styleId);
      const styleLabel = STYLE_SHORT_LABEL[styleId] ?? styleId;
      projectId = await uniqueProjectId(
        sanitizeForFilename(`${contentTitle} ${styleLabel}`),
        videoId,
        body.projectIdSuffix ?? ""
      );

      // Auto B-roll desde Pexels por transcripción — estilos broll_* + editorial_broll.
      // broll_full → fullscreen, broll_pip → pequeñito sobre el video, editorial_broll →
      // cortinillas PIP sobre el lienzo editorial. Si Pexels falla o no hay key, queda []
      // y el render sale sin b-roll (no rompe; editorial_broll cae a editorial puro).
      let autoBroll: BrollClip[] = [];
      if (
        styleId === "broll_full" ||
        styleId === "broll_pip" ||
        styleId === "editorial_broll"
      ) {
        try {
          // Escalar la cantidad de clips con la DURACIÓN del video: ~1 clip cada 16s,
          // mínimo 5, máximo 40 (cada clip = 1 request a Pexels; 40 respeta el rate limit).
          // Antes era fijo en 5 → un video de 12 min recibía lo mismo que uno de 30s.
          const brollCount = Math.max(5, Math.min(40, Math.round(transcript.duration / 16)));
          // Pasamos TODAS las palabras del transcript (no solo las 7 keywords globales) para
          // que el matcher tenga candidatos repartidos a lo largo de todo el video.
          autoBroll = await autoMatchBroll(transcript.words, transcript.duration, {
            count: brollCount,
            clipDur: 3,
            orientation: "portrait",
          });
          console.log(
            `[auto-build] auto b-roll (${styleId}): ${autoBroll.length}/${brollCount} clips de Pexels ` +
              `(video ${Math.round(transcript.duration)}s)`
          );
        } catch (err) {
          console.warn("[auto-build] auto b-roll falló:", err);
        }
      }

      const project: ResolvedProject = {
        ...baseProject,
        ...(autoBroll.length ? { bRoll: autoBroll } : {}),
        // El `id` interno DEBE coincidir con el filename (`${projectId}.json`) y el
        // render (`${projectId}.mp4`). Sin esto, los renders test A/B/C heredaban el
        // `id` base sin sufijo de buildProjectForStyle → keys duplicadas en React y
        // lookups rotos. Ver nota en /api/projects/route.ts.
        id: projectId,
        // videoId real (fuente para raw/transcript/cut) y título legible — el projectId ya
        // NO contiene el videoId, así que los guardamos explícitos en el JSON.
        videoId,
        title: contentTitle,
        styleId,
        // B6 — Si el estilo activó brandKit y hay handle en settings, rellenarlo. Si el
        // estilo no lo activó (no hay brandKit en baseProject), esto no hace nada.
        ...(() => {
          const bk = (baseProject as { brandKit?: { handle?: string } }).brandKit;
          if (bk && !bk.handle && brandHandle) {
            return { brandKit: { ...bk, handle: brandHandle } };
          }
          return {};
        })(),
        platforms: platforms ?? (baseProject as { platforms?: string[] }).platforms ?? [],
        captionMeta: captionMeta ?? (baseProject as { captionMeta?: unknown }).captionMeta ?? null,
        // Fuente de subtítulos elegida en el wizard ("auto" = la del estilo).
        ...(body.subtitleFont && body.subtitleFont !== "auto"
          ? { subtitleFont: body.subtitleFont }
          : {}),
        // Color del TEXTO de los subtítulos elegido en el wizard ("auto" = el del estilo).
        ...(body.subtitleColor && body.subtitleColor !== "auto"
          ? { subtitleColor: body.subtitleColor }
          : {}),
      };

      // 🎵 Música elegida en el wizard. Se aplica AQUÍ (auto-build) y NO en
      // apply-wizard-overrides porque: (1) la música no aplica a la vista previa
      // (stills/clips mudos — style-preview ya fuerza musicTrack:null), así que
      // compartirla en el helper no aporta nada; y (2) pickRandomMusicTrack tiene
      // efectos en disco (escribe music-rotation.json) que NO deben dispararse
      // desde el helper compartido con previews. Va ANTES de applyBeatSync para
      // que el beat-sync detecte los beats de la pista realmente elegida.
      //   "auto"/undefined → comportamiento de siempre (el estilo elige y rota).
      //   "none"           → sin música.
      //   {mood}           → pista de ese mood, SOLO si el estilo lleva música.
      {
        const music = (body as AutoBuildRequest & {
          music?: "auto" | "none" | { mood?: string };
        }).music;
        if (music === "none") {
          project.musicTrack = null;
        } else if (
          music &&
          typeof music === "object" &&
          music.mood &&
          project.musicTrack
        ) {
          // Seed con el mood: si el user re-crea el mismo video con otro mood,
          // la asignación persistida del seed anterior no pisa la elección nueva.
          const track = pickRandomMusicTrack(`${videoId}:${music.mood}`, music.mood);
          if (track) project.musicTrack = track;
        }
      }

      await applyBeatSync(project, transcript.duration);

      // FX enrichments opt-in: tracking, bg-removal, voz IA, texto-detrás, traducción.
      // Cada uno muta `project` si su flag está activo; ninguno rompe si falla.
      await applyTracking(project, videoId);
      await applyRemoveBg(project, videoId);
      await applyVoiceover(project, projectId);
      await applyTextBehind(project, videoId);
      // Tema editorial + fondo animado elegidos en el wizard — helper compartido
      // con style-preview, para que la vista previa muestre lo mismo que el video.
      applyWizardOverrides(project, {
        editorialTheme: body.editorialTheme,
        motionBackground: body.motionBackground,
      });

      await applyTranslate(project);
      await applyGraphics(project, videoId);
      // ILUSTRACIONES CC0 (Phase 4) — opt-in vía el REGISTRO (no flag de proyecto):
      // solo los estilos con illustrations:true en style-registry.data.json las
      // reciben. Los demás → render idéntico al histórico.
      if (styleHasIllustrations(styleId)) await applyIllustrations(project, videoId);
      // EDITORIAL Ola 6 — recorte de sujeto (rembg) para la tarjeta de collage.
      await applyEditorialCutout(project, videoId);
      // F1 — Director emocional: ducking de música + zooms en picos + SFX por arousal.
      await applyEmotionDirector(project, videoId);

      // CINE CLÁSICO — drama por-pico (B&W de la imagen + SFX de cine antiguo +
      // voz "a radio vieja" gateada). Best-effort: si no hay picos, el estilo
      // renderiza igual como cine elegante (look base de buildProjectForStyle).
      // Va DESPUÉS del director emocional para reusar su emotion/{videoId}.json.
      if (styleId === "cine_clasico") {
        try {
          const windows = await applyCineClasico(project, videoId, transcript.duration);
          console.log(
            `[auto-build] cine_clasico: ${windows.length} ventanas de drama (B&W + radio vieja + SFX) · ` +
              `-af pre=${project.audioFilterPre ? "sí" : "no"}`
          );
        } catch (err) {
          console.warn("[auto-build] cine_clasico falló (render seguirá como cine elegante):", err);
        }
      }

      // Intensidad de FX elegida en el wizard (estilos hype*/supreme) — helper
      // compartido con style-preview. Va DESPUÉS de los enriquecedores para
      // recortar/acentuar también los FX que ellos agregaron (mismo orden de siempre).
      applyWizardOverrides(project, { fxIntensity: body.fxIntensity });

      const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
      await writeJsonFileAtomic(projectPath, project);

      // build-props
      const buildProps = await runProcess(
        "node",
        ["build-props.mjs", videoId, projectPath],
        REMOTION_DIR,
        undefined,
        120_000
      );
      if (!buildProps.ok) {
        updateStep(job.id, styleId, {
          status: "fail",
          error: humanizeError(buildProps.stderr, "No se pudo preparar el video para generar.").message,
        });
        continue;
      }

      // Render ATÓMICO: renderizamos (y post-procesamos LUT/mastering) sobre un archivo
      // temporal `__rendering.mp4`; sólo al final lo renombramos al .mp4 definitivo. Así, si
      // el server muere a mitad del render, NO queda un .mp4 parcial en la ruta final que el
      // dashboard o la reconciliación de jobs tomarían por "terminado".
      const finalOut = path.join(RENDERS_DIR, `${projectId}.mp4`);
      const outPath = path.join(RENDERS_DIR, `${projectId}.__rendering.mp4`);
      // Guardamos `output` ya en "rendering": como el projectId ahora es el título (no
      // videoId_estilo), la reconciliación al reiniciar necesita esta ruta para detectar
      // si el render llegó a completarse.
      updateStep(job.id, styleId, { status: "rendering", progress: 10, output: finalOut });
      // Limpiar restos de un intento anterior interrumpido (best-effort).
      await fs.rm(outPath, { force: true }).catch(() => {});
      const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
      // BUG FIX: en Windows, spawn con shell:true (necesario para .cmd) concatena los args
      // con espacios SIN quoting. Si el outPath tiene espacios (ej: "Video Imagen_hype.mp4"),
      // Remotion lo recibe como dos args: "Video" y "Imagen_hype.mp4" — el render termina
      // en "Video.mp4" (truncado en el primer espacio). Solución: quote explícito.
      const needsQuote = process.platform === "win32" && /\s/.test(outPath);
      const outArg = needsQuote ? `"${outPath}"` : outPath;
      const doRender = () =>
        runProcess(
          npxExe,
          [
            "remotion",
            "render",
            "src/index.ts",
            "ViralVideo",
            outArg,
            "--concurrency",
            String(remotionConcurrency()),
            `--timeout=${REMOTION_DELAY_TIMEOUT_MS}`,
            offthreadCacheFlag(),
            "--props=props.json",
          ],
          REMOTION_DIR,
          (chunk) => {
            // Remotion emite MUCHAS líneas "Rendered X/Y" muy seguidas y el stream las
            // agrupa en un mismo chunk. Hay que tomar la ÚLTIMA (la más reciente), no la
            // primera: si no, la barra reporta un frame viejo y queda muy por detrás del
            // render real (peor cuanto más largo el video → más updates por chunk).
            const matches = [...chunk.matchAll(/Rendered (\d+)\/(\d+)/g)];
            if (matches.length > 0) {
              const last = matches[matches.length - 1];
              const current = parseInt(last[1], 10);
              const total = parseInt(last[2], 10);
              if (total > 0 && current <= total) {
                const progress = Math.min(95, 10 + Math.floor((current / total) * 85));
                updateStep(job.id, styleId, {
                  progress,
                  currentFrame: current,
                  totalFrames: total,
                });
              }
            }
          },
          // timeoutMs = undefined: un render largo es válido, no hay tope de tiempo total.
          undefined,
          // idleTimeoutMs = 15 min: si Remotion deja de emitir progreso por 15 min está colgado
          // → se mata, el step falla y la cola sigue con el próximo. Nunca queda trabada.
          15 * 60 * 1000
        );

      // ─── OLA 2 — RENDER-SERVER (optimización opt-in con FALLBACK) ───────────
      // Intentamos primero el server de larga vida (bundle webpack 1 sola vez →
      // ahorra 15-40s por render). build-props.mjs ya escribió props.json en
      // REMOTION_DIR; el server lo lee de ahí y escribe el MISMO outPath temporal.
      // Si el server falla por CUALQUIER motivo, caemos al `npx remotion render`
      // de siempre (camino probado, red de seguridad). El post-encode NVENC, el
      // mastering de audio y el LUT corren igual abajo sobre el .mp4 resultante.
      let renderRun: { ok: boolean; stdout: string; stderr: string } | null = null;
      if (renderServerEnabled()) {
        try {
          await renderWithServer({
            propsPath: path.join(REMOTION_DIR, "props.json"),
            outPath,
            concurrency: remotionConcurrency(),
            timeoutMs: REMOTION_DELAY_TIMEOUT_MS,
            scale: 1,
            onProgress: (current, total) => {
              if (total > 0 && current <= total) {
                const progress = Math.min(95, 10 + Math.floor((current / total) * 85));
                updateStep(job.id, styleId, { progress, currentFrame: current, totalFrames: total });
              }
            },
          });
          renderRun = { ok: true, stdout: "", stderr: "" };
          console.log(`[auto-build] render-server ok: ${projectId}`);
        } catch (err) {
          // Fallback: el camino viejo sigue intacto. Limpiamos el temporal parcial.
          console.warn(`[auto-build] render-server falló (${String(err)}) — fallback a npx remotion render`);
          await fs.rm(outPath, { force: true }).catch(() => {});
          updateStep(job.id, styleId, { progress: 10, currentFrame: 0 });
        }
      }

      if (!renderRun) renderRun = await doRender();
      if (!renderRun.ok) {
        // F4 — RETRY del render: los fallos por carga (delayRender timeout del stream
        // bajo presión sostenida, browser crash) suelen ser transitorios. Un reintento
        // limpio recupera la mayoría sin intervención. ENOSPC (disco lleno) no se reintenta.
        if (!/ENOSPC/i.test(renderRun.stderr)) {
          console.warn(`[auto-build] render de ${projectId} falló — reintentando 1 vez…`);
          updateStep(job.id, styleId, { progress: 10, currentFrame: 0 });
          await fs.rm(outPath, { force: true }).catch(() => {});
          renderRun = await doRender();
        }
      }

      if (!renderRun.ok) {
        await fs.rm(outPath, { force: true }).catch(() => {});
        const human = humanizeError(renderRun.stderr, "No se pudo generar el video con este estilo.");
        updateStep(job.id, styleId, {
          status: "fail",
          // Mensaje humano primero; cola técnica corta al final para soporte.
          error: `${human.message}\n[detalle] ${human.technical.slice(-180)}`,
        });
        continue;
      }

      // Audio mastering post-render con ffmpeg — para TODOS los estilos.
      // Base (todos): alimiter (sin clipping) + loudnorm a -14 LUFS (estándar de
      // TikTok/Reels/IG → loudness consistente = mejor retención y "se oye pro").
      // cinematic_pro suma su cadena rica: acompressor + highpass 80Hz (quita
      // rumble) + EQ +2dB @ 3kHz (claridad de voz). Si ffmpeg falla, se conserva
      // el render sin master (no rompe el job).
      {
        updateStep(job.id, styleId, { progress: 96 });
        try {
          const masteredPath = outPath.replace(/\.mp4$/, "_mastered.mp4");
          const loudness = "loudnorm=I=-14:TP=-1.5:LRA=11";
          // Cadena RICA de cine (acompressor + highpass 80 + EQ claridad), igual
          // que cinematic_pro. cine_clasico usa la MISMA base + el band-limit
          // telefónico GATEADO a las ventanas de pico (project.audioFilterPre),
          // antepuesto para que la voz suene a radio vieja SOLO en los picos.
          const cinematicChain =
            "acompressor=threshold=-18dB:ratio=3:attack=20:release=200," +
            "highpass=f=80," +
            "equalizer=f=3000:t=q:w=1:g=2," +
            "alimiter=level_in=1:level_out=0.95:limit=0.95," +
            loudness;
          let audioFilter: string;
          if (styleId === "cine_clasico") {
            const pre = project.audioFilterPre;
            audioFilter = pre ? `${pre},${cinematicChain}` : cinematicChain;
          } else if (styleId === "cinematic_pro") {
            audioFilter = cinematicChain;
          } else {
            audioFilter = "alimiter=level_in=1:level_out=0.95:limit=0.95," + loudness;
          }
          // FFMPEG_EXE (no "ffmpeg" literal): en máquinas de usuarios finales
          // ffmpeg NO está en el PATH del sistema — solo en tools/ del paquete.
          const masterRun = await runProcess(
            FFMPEG_EXE,
            [
              "-y",
              "-i", outPath,
              "-af", audioFilter,
              "-c:v", "copy",
              "-c:a", "aac",
              "-b:a", "192k",
              masteredPath,
            ],
            REMOTION_DIR,
            undefined,
            120_000 // timeout 2 min — si ffmpeg se cuelga, abortamos y dejamos el raw
          );
          if (masterRun.ok) {
            // Reemplazar el original con el mastered
            await fs.rename(outPath, outPath.replace(/\.mp4$/, "_raw.mp4"));
            await fs.rename(masteredPath, outPath);
            await fs.unlink(outPath.replace(/\.mp4$/, "_raw.mp4")).catch(() => {});
            console.log(`[auto-build] audio mastered: ${path.basename(outPath)}`);
          } else {
            console.warn(`[auto-build] ffmpeg mastering falló, manteniendo raw render`);
          }
        } catch (err) {
          console.warn(`[auto-build] audio mastering skipped:`, err);
        }
      }

      // === CapCut Pro — LUT 3D color grade (opt-in, ADITIVO) ===
      // Si el project trae `lut` (nombre de .cube en remotion/public/luts), aplica
      // un grade profesional con ffmpeg lut3d. Independiente del mastering de audio
      // (que sigue solo para cinematic_pro). Si el .cube no existe o ffmpeg falla,
      // se conserva el render sin LUT (no rompe el job). Estilos existentes no setean
      // `lut` → este bloque no corre para ellos (render idéntico).
      const lutName = project.lut;
      // #6 — Si el paso de LUT encodeó YA por hardware, el postencode NVENC posterior
      // sería un doble encode inútil: marcamos para saltarlo.
      let lutHwEncoded = false;
      if (lutName) {
        updateStep(job.id, styleId, { progress: 96 });
        try {
          const lutPath = path.join(REMOTION_DIR, "public", "luts", lutName);
          const lutExists = await fs
            .access(lutPath)
            .then(() => true)
            .catch(() => false);
          if (!lutExists) {
            console.warn(`[auto-build] LUT no encontrado, se salta: ${lutName}`);
          } else {
            const gradedPath = outPath.replace(/\.mp4$/, "_graded.mp4");
            // Ruta relativa con forward-slashes (cwd=REMOTION_DIR) para evitar el
            // escaping del ":" de la unidad de Windows dentro del filtergraph.
            const lutFilter = `lut3d=public/luts/${lutName}`;
            // #6 — FUSIÓN: encodea el grade con el encoder por HARDWARE recomendado
            // en UNA sola pasada (antes: libx264 'medium' fijo + postencode NVENC =
            // doble encode). Mismo lut3d, calidad equivalente (p5/cq19 ≈ crf18).
            // Si no hay GPU usable → libx264 crf18/medium (look idéntico al de antes).
            const { encoder: lutEncoder, args: lutVideoArgs } = hwLutVideoArgs();
            const lutRun = await runProcess(
              FFMPEG_EXE,
              [
                "-y",
                "-i", outPath,
                "-vf", lutFilter,
                "-c:a", "copy",
                ...lutVideoArgs,
                "-pix_fmt", "yuv420p",
                gradedPath,
              ],
              REMOTION_DIR,
              undefined,
              180_000 // 3 min — re-encode de video
            );
            if (lutRun.ok) {
              await fs.rename(outPath, outPath.replace(/\.mp4$/, "_nolut.mp4"));
              await fs.rename(gradedPath, outPath);
              await fs.unlink(outPath.replace(/\.mp4$/, "_nolut.mp4")).catch(() => {});
              // Si encodeó por hardware, no hace falta el postencode posterior.
              lutHwEncoded = lutEncoder !== "libx264";
              console.log(
                `[auto-build] LUT aplicado (${lutName}, encoder=${lutEncoder}): ${path.basename(outPath)}`
              );
            } else {
              console.warn(`[auto-build] ffmpeg lut3d falló, manteniendo render sin LUT`);
            }
          }
        } catch (err) {
          console.warn(`[auto-build] LUT skipped:`, err);
        }
      }

      // Auto-generar caption viral si el wizard no lo trajo ya hecho
      updateStep(job.id, styleId, { progress: 97 });
      if (!hasWizardCopy) {
        try {
          await runProcess(
            PYTHON_EXE,
            [
              path.join(PYTHON_DIR, "generate_caption.py"),
              videoId,
              "--project-id",
              projectId,
            ],
            PYTHON_DIR,
            undefined,
            120_000
          );
        } catch {
          // Ignorar: el caption se puede regenerar manualmente desde /produccion
        }
      }

      // POST-ENCODE NVENC (OLA 1) — Remotion encodea SIEMPRE en CPU x264 aunque la
      // máquina tenga NVENC/QSV/AMF ocioso. postencode.py re-encodea el MP4 con el
      // encoder por hardware recomendado por hw_profile (3-8× más rápido, calidad
      // equivalente p5/cq19≈crf18), preservando el audio (-c:a copy). GATE: si el
      // encoder recomendado es libx264 (sin GPU usable), el script es NO-OP y deja el
      // archivo intacto — así NUNCA degrada un equipo CPU-only con un re-encode inútil.
      // Best-effort: si falla, se conserva el render tal cual (no rompe el estilo).
      updateStep(job.id, styleId, { progress: 98 });
      // #6 — Si el paso de LUT YA encodeó por hardware, saltamos el postencode: sería
      // un segundo encode por GPU del mismo material (doble encode, sin ganancia y con
      // pérdida extra). Sin LUT, o con LUT en libx264 (CPU-only), corremos el postencode
      // de siempre (que es no-op en equipos sin GPU usable).
      if (lutHwEncoded) {
        console.log(
          `[auto-build] post-encode NVENC omitido (LUT ya encodeó por hardware): ${path.basename(outPath)}`
        );
      } else {
        try {
          const pe = await runProcess(
            PYTHON_EXE,
            [path.join(PYTHON_DIR, "postencode.py"), outPath],
            PYTHON_DIR,
            undefined,
            300_000 // 5 min — re-encode NVENC de un short es rápido, pero damos margen
          );
          if (pe.ok) {
            console.log(`[auto-build] post-encode NVENC ok: ${path.basename(outPath)}`);
          } else {
            console.warn(`[auto-build] post-encode NVENC falló, manteniendo render x264`);
          }
        } catch (err) {
          console.warn(`[auto-build] post-encode NVENC skipped:`, err);
        }
      }

      // LOUDNESS -14 LUFS — las redes normalizan a ~-14; nuestros mixes salían a ~-21
      // y la red los subía amplificando ruido. 2-pass loudnorm SOLO del audio
      // (-c:v copy → segundos). Best-effort: si falla, el render queda tal cual.
      try {
        const ln = await runProcess(
          PYTHON_EXE,
          [path.join(PYTHON_DIR, "normalize_audio.py"), outPath],
          PYTHON_DIR,
          undefined,
          180_000
        );
        if (ln.ok) console.log(`[auto-build] loudnorm -14 LUFS ok: ${path.basename(outPath)}`);
      } catch (err) {
        console.warn(`[auto-build] loudnorm skipped:`, err);
      }

      // Publicar atómicamente: el .mp4 final aparece de una sola pieza recién acá.
      // (con retry ante locks transitorios de antivirus/indexador sobre el archivo)
      await renameWithRetry(outPath, finalOut);
      updateStep(job.id, styleId, { status: "ok", progress: 100, output: finalOut });
      // PRUEBA GRATUITA — contar 1 video generado por estilo exitoso (solo
      // afecta el tope de la prueba; con licencia activa no descuenta nada).
      registerRender();
    } catch (err) {
      // Si quedó un temporal a medias por la excepción, limpiarlo (projectId ya resuelto).
      await fs.rm(path.join(RENDERS_DIR, `${projectId}.__rendering.mp4`), { force: true }).catch(() => {});
      updateStep(job.id, styleId, {
        status: "fail",
        error: humanizeError(String(err), "Falló la generación de este estilo.").message,
      });
    }
  }
}

export async function POST(req: NextRequest) {
  // PRUEBA GRATUITA — gate: si la prueba terminó y no hay licencia, no se
  // generan más videos. La marca de agua la inyecta build-props.mjs.
  const lic = canRender();
  if (!lic.allowed) {
    return NextResponse.json({ error: lic.reason }, { status: 403 });
  }

  const body = (await req.json()) as AutoBuildRequest;
  const { videoId, videoIds, styles, accentColor } = body;

  // Normalizar a array: si vino videoIds[] usar ese; si no, fallback a videoId singular
  const videoIdList: string[] = (videoIds && videoIds.length > 0)
    ? videoIds
    : videoId ? [videoId] : [];

  if (videoIdList.length === 0 || !Array.isArray(styles) || styles.length === 0) {
    return NextResponse.json(
      { error: "videoId (o videoIds[]) y styles[] son requeridos" },
      { status: 400 }
    );
  }

  // Crear un Job por cada videoId y encolar (la cola serial los corre 1 a la vez)
  const jobs: Job[] = [];
  for (const vid of videoIdList) {
    // El body que recibe processJob tiene que tener videoId del job — no el original.
    // Se PERSISTE en el job (4º arg de createJob) para poder reanudarlo idéntico si la
    // app se reinició mientras estaba en cola.
    const jobBody: AutoBuildRequest = { ...body, videoId: vid, videoIds: undefined };
    const job = createJob(vid, styles, accentColor, jobBody);
    jobs.push(job);
    enqueue("editor", job.id, async () => {
      await processJob(job, jobBody);
    });
  }

  return NextResponse.json({
    ok: true,
    // Backwards-compat: si era 1 solo, devolvemos jobId singular también
    jobId: jobs.length === 1 ? jobs[0].id : undefined,
    jobIds: jobs.map((j) => j.id),
  });
}
