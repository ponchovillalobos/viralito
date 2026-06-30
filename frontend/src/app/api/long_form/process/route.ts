import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  LF_RAW,
  PYTHON_EXE,
  PYTHON_DIR,
} from "@/lib/paths";
import { LF_PROPOSALS } from "@/lib/paths-long-form";
import {
  appendLongFormLog,
  createLongFormJob,
  getLongFormJob,
  registerLongFormPid,
  setLongFormClipsCount,
  unregisterLongFormPid,
  updateLongFormStep,
  type LongFormRunMode,
  type LongFormStepKey,
} from "@/lib/long-form-job-store";
import { enqueue } from "@/lib/job-queue";
import { canRender, registerRender } from "@/lib/license";

export const dynamic = "force-dynamic";
export const maxDuration = 3600; // 1 hora — pipelines con render pueden tardar

interface ProcessBody {
  /** Single (legacy). Si viene videoIds[], se ignora. */
  videoId?: string;
  /** Multi (preferido). Cada videoId crea un job propio y se encolan serialmente. */
  videoIds?: string[];
  model?: string;
  render?: boolean;
  maxClips?: number;
  skipTranscribe?: boolean;
  /** Si true, salta Ollama y usa clips heurísticos uniformes (rápido, sin curaduría IA) */
  useHeuristic?: boolean;
  /** Modo Gráficos & Motion: genera charts + titulares poderosos por clip (auto desde transcript). */
  graphicsMode?: boolean;
  /** Estilos de render — array de StyleId. Default ["supreme"]. */
  styles?: string[];
  /** Color accent en hex. Si se omite, paleta rotativa por clipIndex. */
  accentColor?: string;
  /** Fuente de subtítulos ("auto" = la del estilo). Igual que el wizard de shorts. */
  subtitleFont?: string;
  /** Color del TEXTO de subtítulos ("auto" = el del estilo). */
  subtitleColor?: string;
  /** Volumen de música 0..1 (factor sobre el del estilo). Del slider del wizard; 1 = sin override. */
  musicVolume?: number;
  /** Tema del estilo Editorial (fuente serif + fondo + sub-tema). Solo aplica si styles incluye "editorial". */
  editorialTheme?: { font?: string; background?: string; theme?: string };
  /** Plataformas destino (informativo, se persiste en project JSON). */
  platforms?: string[];
  /** Aspecto del output. "9:16" vertical (default) o "16:9" horizontal. */
  aspectRatio?: "9:16" | "16:9";
  /**
   * Face tracking al reframear (aplica solo si el aspecto cambia del source).
   * "off": center crop ciego (default).
   * "single": detección 1-frame del medio del clip (rápido, ~1s/clip).
   * "per-frame": preciso (~5-10s/clip).
   */
  faceTracking?: "off" | "single" | "per-frame";
  /**
   * Flujo REVISAR antes de generar:
   *   "full" (default)  → comportamiento clásico intacto (analiza+extrae+genera).
   *   "analyze"         → solo hasta el proposals JSON (--analyze-only).
   *   "render-approved" → salta el análisis y genera solo los aprobados (--from-proposals).
   */
  mode?: LongFormRunMode;
  /** Solo con mode "render-approved": posiciones 0-based de los clips aprobados. */
  clips?: number[];
}

/**
 * Mapeo del header impreso por long_form_pipeline.py al stepKey del store.
 * El script imprime al stderr: "========== STEP N: <nombre> =========="
 */
const STEP_HEADER_PATTERNS: { regex: RegExp; key: LongFormStepKey }[] = [
  { regex: /STEP 1:\s*transcribe\s*=/i, key: "transcribe" },
  { regex: /STEP 2:\s*detect silences/i, key: "detect_silences" },
  { regex: /STEP 3:\s*cut silences/i, key: "cut_silences" },
  { regex: /STEP 4:\s*re-?transcribe/i, key: "re_transcribe" },
  { regex: /STEP 5:\s*analyze/i, key: "analyze" },
  { regex: /STEP 6:\s*extract clips/i, key: "extract_clips" },
  { regex: /STEP 7:\s*render/i, key: "render" },
];

/** Parsea "[skip] <step> (existe ...)" para marcar steps como skipped. */
const SKIP_PATTERNS: { regex: RegExp; key: LongFormStepKey }[] = [
  { regex: /\[skip\] transcribe/i, key: "transcribe" },
  { regex: /\[skip\] detect_silences/i, key: "detect_silences" },
  { regex: /\[skip\] cut_silences/i, key: "cut_silences" },
  { regex: /\[skip\] re-?transcribe/i, key: "re_transcribe" },
  { regex: /\[skip\] analyze_clips/i, key: "analyze" },
];

async function findRawFile(videoId: string): Promise<string | null> {
  const exts = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
  for (const ext of exts) {
    const p = path.join(LF_RAW, `${videoId}${ext}`);
    try {
      await fs.access(p);
      return p;
    } catch {
      // probar siguiente extensión
    }
  }
  return null;
}

export async function processJob(
  jobId: string,
  videoId: string,
  body: ProcessBody
): Promise<void> {
  const mode: LongFormRunMode = body.mode ?? "full";
  const args = [path.join(PYTHON_DIR, "long_form_pipeline.py"), videoId];
  if (body.model) args.push("--model", body.model);
  // En "analyze" nunca se genera nada (el render llega después, ya aprobados).
  if (body.render && mode !== "analyze") args.push("--render");
  if (body.maxClips != null) args.push("--max-clips", String(body.maxClips));
  if (body.skipTranscribe) args.push("--skip-transcribe");
  if (body.useHeuristic) args.push("--use-heuristic");
  if (mode === "analyze") args.push("--analyze-only");
  if (mode === "render-approved") {
    args.push("--from-proposals");
    if (body.clips && body.clips.length > 0) {
      args.push("--clips", body.clips.join(","));
    }
  }
  if (body.graphicsMode) args.push("--graphics");
  if (body.styles && body.styles.length > 0) {
    args.push("--styles", body.styles.join(","));
  }
  if (body.accentColor) args.push("--accent-color", body.accentColor);
  if (body.subtitleFont && body.subtitleFont !== "auto") {
    args.push("--subtitle-font", body.subtitleFont);
  }
  if (body.subtitleColor && body.subtitleColor !== "auto") {
    args.push("--subtitle-color", body.subtitleColor);
  }
  // Volumen de música: solo se pasa si el usuario lo bajó (≠ 1). Clamp 0..1.
  if (typeof body.musicVolume === "number" && body.musicVolume >= 0 && body.musicVolume < 1) {
    args.push("--music-volume", String(Math.max(0, Math.min(1, body.musicVolume))));
  }
  if (
    body.editorialTheme &&
    (body.editorialTheme.font || body.editorialTheme.background || body.editorialTheme.theme)
  ) {
    // Formato CLI compacto "font:background:theme" (ej. "playfair:dark:" o "::riso").
    args.push(
      "--editorial-theme",
      `${body.editorialTheme.font ?? ""}:${body.editorialTheme.background ?? ""}:${body.editorialTheme.theme ?? ""}`
    );
  }
  if (body.platforms && body.platforms.length > 0) {
    args.push("--platforms", body.platforms.join(","));
  }
  if (body.aspectRatio) args.push("--aspect-ratio", body.aspectRatio);
  if (body.faceTracking && body.faceTracking !== "off") {
    args.push("--face-tracking", body.faceTracking);
  }

  let currentStep: LongFormStepKey | null = null;
  // Último frame de Remotion reportado, para throttlear las actualizaciones de progreso.
  let lastRenderedFrame = -100;

  // Step donde reportar un fallo si el proceso muere ANTES de imprimir un header.
  // Antes era "transcribe" fijo, pero en "render-approved" ese step no existe (la
  // corrida arranca en extract_clips) y el job quedaría "running" para siempre.
  const fallbackStep = (): LongFormStepKey =>
    currentStep ?? getLongFormJob(jobId)?.steps[0]?.key ?? "transcribe";

  return new Promise<void>((resolve) => {
    const proc = spawn(PYTHON_EXE, args, {
      cwd: PYTHON_DIR,
      shell: false,
    });

    // Registrar jobId → pid (globalThis, sobrevive hot-reload) para que
    // /api/long_form/cancel pueda matar el árbol con taskkill /T /F.
    if (proc.pid != null) registerLongFormPid(jobId, proc.pid);

    // Idle-timeout: el pipeline puede tardar mucho (rendea N clips), así que NO usamos un
    // tope de tiempo total. En cambio matamos el proceso si deja de emitir CUALQUIER salida
    // por 20 min — señal de cuelgue real (no de un render largo, que loguea progreso).
    let timedOut = false;
    let idleTimer: ReturnType<typeof setTimeout>;
    const IDLE_MS = 20 * 60 * 1000;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        try { proc.kill("SIGKILL"); } catch {}
      }, IDLE_MS);
    };
    resetIdle();

    function processLine(line: string) {
      appendLongFormLog(jobId, line);

      // Progreso de Remotion durante el render: "Rendered X/Y". Antes la barra parecía
      // congelada todo el render (lo más largo). Lo surfaceamos como mensaje del step
      // "render". Throttle cada ~15 frames (o el último) para no escribir de más.
      const rm = line.match(/Rendered (\d+)\/(\d+)/);
      if (rm) {
        const cur = parseInt(rm[1], 10);
        const tot = parseInt(rm[2], 10);
        if (tot > 0 && (cur - lastRenderedFrame >= 15 || cur >= tot)) {
          lastRenderedFrame = cur;
          updateLongFormStep(jobId, "render", {
            status: "running",
            message: `generando video · ${cur}/${tot}`,
          });
        }
        return;
      }
      // Sub-progreso REAL del render: "[ok] render -> … (N/M listos)" (N = renders
      // clip×estilo COMPLETADOS, M = total). MUEVE la barra durante el render — la fase
      // más larga (~30+ min) — en vez de dejarla congelada en 75%. Paralelo-seguro: lo
      // emite el loop principal (as_completed de long_form_pipeline), no el render-server,
      // a diferencia de "Rendered X/Y" que se intercala entre clips con render paralelo.
      const doneM = line.match(/\((\d+)\/(\d+)\s+listos\)/);
      if (doneM) {
        const n = parseInt(doneM[1], 10);
        const m = parseInt(doneM[2], 10);
        if (m > 0) {
          updateLongFormStep(jobId, "render", {
            status: "running",
            progress: Math.round((n / m) * 100),
            message: `video ${n} de ${m} listo`,
          });
        }
        // sin return: la línea ya se logueó arriba; no matchea headers/skips.
      }
      // Marcadores del pipeline Python (clip i/n, detectando cara, color grade, master):
      // se muestran como mensaje del step render para que el panel muestre actividad
      // durante los tramos silenciosos (tracking + post-fx ffmpeg).
      const marker = line.match(/\[(render|tracking|post-fx)\]\s*(.+)/i);
      if (marker) {
        updateLongFormStep(jobId, "render", { message: marker[2].trim().slice(0, 120) });
        // sin return: estas líneas no matchean headers/skips, no hay conflicto.
      }

      // Detectar headers de step
      for (const p of STEP_HEADER_PATTERNS) {
        if (p.regex.test(line)) {
          if (currentStep && currentStep !== p.key) {
            updateLongFormStep(jobId, currentStep, { status: "ok" });
          }
          currentStep = p.key;
          // El render arranca su sub-progreso en 0 para que la barra suba con cada clip
          // (N/M listos), en vez de saltar de 75% hacia atrás al completarse el 1ro.
          updateLongFormStep(
            jobId,
            p.key,
            p.key === "render" ? { status: "running", progress: 0 } : { status: "running" }
          );
          return;
        }
      }
      // Detectar skips. El motivo viene entre paréntesis: "existe <ruta>" (cache),
      // "modo clips rápidos", "modo inteligente: …". Las rutas C:\ no se muestran.
      for (const p of SKIP_PATTERNS) {
        if (p.regex.test(line)) {
          const reason = line.match(/\(([^)]+)\)/)?.[1];
          const message =
            reason && !/existe/i.test(reason)
              ? `no aplica (${reason})`
              : "ya existía, no se regeneró";
          updateLongFormStep(jobId, p.key, { status: "skipped", message });
          return;
        }
      }
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    // Acumulador del stdout COMPLETO (no se consume con el split de líneas). El JSON
    // final del pipeline ({"ok":true,...,"clips":N}) termina en \n, así que se va de
    // stdoutBuf; para extraer clipsCount al cerrar necesitamos el log entero.
    let fullStdout = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      resetIdle();
      const text = chunk.toString("utf-8");
      fullStdout += text;
      stdoutBuf += text;
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      resetIdle();
      const text = chunk.toString("utf-8");
      stderrBuf += text;
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.on("close", (code) => {
      clearTimeout(idleTimer);
      unregisterLongFormPid(jobId);
      if (stdoutBuf.trim()) processLine(stdoutBuf);
      if (stderrBuf.trim()) processLine(stderrBuf);

      // Si el usuario lo canceló (taskkill desde /api/long_form/cancel), el job ya
      // quedó "cancelled" y el store ignora updates — no marcar nada como fallo.
      if (getLongFormJob(jobId)?.status === "cancelled") {
        resolve();
        return;
      }

      if (timedOut) {
        const step = fallbackStep();
        updateLongFormStep(jobId, step, {
          status: "fail",
          message: "El proceso dejó de responder por 20 minutos y se detuvo. Inténtalo de nuevo.",
        });
        resolve();
        return;
      }

      if (code === 0) {
        if (currentStep) {
          updateLongFormStep(jobId, currentStep, { status: "ok" });
        }
        // PRUEBA GRATUITA — contar UNA sola vez por corrida exitosa del pipeline
        // (los largos generan muchos clips de un jalón; 1 por corrida es lo justo
        // para la prueba). Solo si se pidió render: una corrida de puro análisis
        // no genera videos. Con licencia activa no descuenta nada.
        if (body.render && mode !== "analyze") registerRender();
        try {
          // Match sobre la ÚLTIMA línea JSON del stdout completo (la del resumen final).
          const jsonLine = fullStdout
            .split(/\r?\n/)
            .reverse()
            .find((l) => /"clips"\s*:\s*\d+/.test(l));
          const clipsMatch = jsonLine?.match(/"clips"\s*:\s*(\d+)/);
          // Conteos de render REAL (clips renderizados vs extraídos). El pipeline los
          // emite solo cuando hubo render; en modo análisis no vienen.
          const renderedMatch = jsonLine?.match(/"rendered"\s*:\s*(\d+)/);
          const tasksMatch = jsonLine?.match(/"render_tasks"\s*:\s*(\d+)/);
          const failedMatch = jsonLine?.match(/"render_failed"\s*:\s*(\d+)/);

          if (body.render && renderedMatch && tasksMatch) {
            // Hubo render: el conteo "listos" debe reflejar lo RENDERIZADO (en disco),
            // no lo extraído — si no, el panel decía "N listos" con videos faltantes.
            const nDone = parseInt(renderedMatch[1], 10);
            const nTotal = parseInt(tasksMatch[1], 10);
            const nFail = failedMatch
              ? parseInt(failedMatch[1], 10)
              : Math.max(0, nTotal - nDone);
            setLongFormClipsCount(jobId, nDone);
            if (nFail > 0) {
              // Parcial: terminó pero faltan clips. Avisar en vez de un "listo" liso.
              updateLongFormStep(jobId, "render", {
                status: "ok",
                message: `Atención: ${nDone} de ${nTotal} clips se renderizaron — ${nFail} fallaron. Revisá el log y volvé a generar los faltantes.`,
              });
            }
          } else if (clipsMatch) {
            // Modo análisis (sin render): reportar clips extraídos como antes.
            setLongFormClipsCount(jobId, parseInt(clipsMatch[1], 10));
          }
        } catch {
          // ignore
        }
      } else {
        if (currentStep) {
          updateLongFormStep(jobId, currentStep, {
            status: "fail",
            message: `El proceso se detuvo inesperadamente (código ${code}).`,
          });
        } else {
          updateLongFormStep(jobId, fallbackStep(), {
            status: "fail",
            message: `El proceso se detuvo antes de empezar (código ${code}).`,
          });
        }
      }
      resolve();
    });

    proc.on("error", (err) => {
      clearTimeout(idleTimer);
      unregisterLongFormPid(jobId);
      updateLongFormStep(jobId, fallbackStep(), {
        status: "fail",
        message: `No se pudo iniciar el proceso: ${err.message}`,
      });
      resolve();
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    // PRUEBA GRATUITA — gate: si la prueba terminó y no hay licencia, no se
    // procesan más videos. La marca de agua la inyecta build-clip-props.mjs.
    const lic = canRender();
    if (!lic.allowed) {
      return NextResponse.json({ error: lic.reason }, { status: 403 });
    }

    const body = (await req.json()) as ProcessBody;

    // ── Flujo REVISAR: normalizar/validar el modo ANTES de encolar nada ──
    const mode: LongFormRunMode = body.mode ?? "full";
    if (!["full", "analyze", "render-approved"].includes(mode)) {
      return NextResponse.json(
        { error: "Modo de proceso no reconocido. Recarga la pantalla e intenta de nuevo." },
        { status: 400 }
      );
    }
    if (mode === "analyze") {
      // Una corrida de puro análisis nunca genera videos.
      body.render = false;
    }
    if (body.clips != null) {
      if (
        mode !== "render-approved" ||
        !Array.isArray(body.clips) ||
        body.clips.some((n) => !Number.isInteger(n) || n < 0)
      ) {
        return NextResponse.json(
          { error: "La lista de clips aprobados no es válida. Vuelve a revisar los momentos." },
          { status: 400 }
        );
      }
      if (body.clips.length === 0) {
        return NextResponse.json(
          { error: "Aprueba al menos un momento antes de generar." },
          { status: 400 }
        );
      }
    }

    // Normalizar a array: si vino videoIds[] usar ese; si no, fallback a videoId singular
    const videoIdList: string[] = (body.videoIds && body.videoIds.length > 0)
      ? body.videoIds
      : body.videoId ? [body.videoId] : [];

    if (videoIdList.length === 0) {
      return NextResponse.json({ error: "videoId (o videoIds[]) requerido" }, { status: 400 });
    }

    // render-approved necesita el proposals JSON ya escrito (el análisis previo).
    if (mode === "render-approved") {
      for (const vid of videoIdList) {
        try {
          await fs.access(path.join(LF_PROPOSALS, `${vid}.json`));
        } catch {
          return NextResponse.json(
            {
              error: `Todavía no hay momentos analizados para «${vid}». Corre primero «Encontrar los mejores momentos».`,
            },
            { status: 409 }
          );
        }
      }
    }

    // Validar que cada raw existe ANTES de empezar a encolar
    const resolved: { videoId: string; rawPath: string }[] = [];
    for (const vid of videoIdList) {
      const rawPath = await findRawFile(vid);
      if (!rawPath) {
        // Sin rutas C:\ en mensajes visibles: solo el nombre del video.
        return NextResponse.json(
          {
            error: `No se encontró el video «${vid}» en la carpeta de videos largos. Súbelo de nuevo desde el paso 1.`,
          },
          { status: 404 }
        );
      }
      resolved.push({ videoId: vid, rawPath });
    }

    // Crear N jobs + encolar (la cola serial los corre 1 a la vez)
    const jobs = resolved.map(({ videoId, rawPath }) => {
      const job = createLongFormJob(videoId, rawPath, {
        model: body.model,
        render: body.render ?? false,
        maxClips: body.maxClips,
        skipTranscribe: body.skipTranscribe,
        useHeuristic: body.useHeuristic,
        styles: body.styles,
        mode,
      }, { ...body, videoId, videoIds: undefined });
      enqueue("long_form", job.id, async () => {
        await processJob(job.id, videoId, body);
      });
      return { job, rawPath };
    });

    return NextResponse.json({
      ok: true,
      // backwards-compat singular
      jobId: jobs.length === 1 ? jobs[0].job.id : undefined,
      videoPath: jobs.length === 1 ? jobs[0].rawPath : undefined,
      jobIds: jobs.map((j) => j.job.id),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
