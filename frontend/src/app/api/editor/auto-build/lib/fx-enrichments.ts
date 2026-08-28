// FX enrichments opt-in que mutan el `project` antes del render. Cada función
// está envuelta en try/catch — si falla, project queda sin esa mejora pero el
// render sigue (semántica histórica: ningún FX opcional rompe el pipeline).
//
// Convocados desde el loop por-estilo en processJob:
//   - applyTracking      → trackPath para TrackedLayer (hype y similares).
//   - applyRemoveBg      → foregroundVideoId (broll_pip).
//   - applyVoiceover     → voiceoverUrl con Piper (C1) o XTTS clon (C2).
//   - applyTextBehind    → foregroundVideoId con texto detrás del sujeto (A3).
//   - applyTranslate     → captionTranslated en otro idioma (C3).

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import {
  PYTHON_DIR,
  PYTHON_EXE,
  RAW_DIR,
  VOICEOVER_DIR,
  TRANSCRIPTS_DIR,
  DATA_ROOT,
  FFPROBE_EXE,
} from "@/lib/paths";
import { runProcess, parseLastJsonLine } from "@/lib/run-process";
import { findRawVideo } from "./helpers";
import type { ResolvedProject } from "./types";

/**
 * Modo Gráficos & Motion (estilos graphics_*): genera gráficas animadas (contador/
 * barras/línea/dona) + titulares poderosos desde el transcript del short, con
 * generate_graphics.py, y los deja en project.dataViz / project.kineticHeadlines.
 * Las gráficas solo salen si el contenido menciona números (%, "3 veces", "de 23 a 78");
 * los titulares salen siempre. Si Ollama está offline, cae a heurística (no rompe).
 */
export async function applyGraphics(
  project: ResolvedProject,
  videoId: string
): Promise<void> {
  if (!project.graphics) return;
  try {
    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
    const hasTranscript = await fs.access(transcriptPath).then(() => true).catch(() => false);
    if (!hasTranscript) return;

    const outDir = path.join(DATA_ROOT, "graphics");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${videoId}.json`);

    const run = await runProcess(
      PYTHON_EXE,
      [
        path.join(PYTHON_DIR, "generate_graphics.py"),
        "--transcript", transcriptPath,
        "--out", outPath,
      ],
      PYTHON_DIR,
      undefined,
      120_000
    );
    if (!run.ok) return;

    const raw = await fs.readFile(outPath, "utf-8").catch(() => null);
    if (!raw) return;
    const g = JSON.parse(raw) as {
      dataViz?: unknown[];
      kineticHeadlines?: unknown[];
      iconStickers?: unknown[];
      editorialCards?: unknown[];
      editorialScenes?: unknown[];
      editorialMap?: unknown;
    };
    // EDITORIAL: las tarjetas tipográficas mandan; los charts entran CURADOS
    // (máx 3) y el render los dibuja con el look del tema, ocultando las
    // tarjetas mientras duran (Ola 5 — antes se descartaban todos).
    if (project.editorialLayout) {
      if (Array.isArray(g.editorialCards)) project.editorialCards = g.editorialCards;
      project.dataViz = Array.isArray(g.dataViz) ? g.dataViz.slice(0, 3) : [];
      // Ola 7 — globo al lugar mencionado (si el gazetteer encontró uno).
      if (g.editorialMap) project.editorialMap = g.editorialMap as ResolvedProject["editorialMap"];
      // Coreografía del panel dinámico (derecha→izquierda→cuadrado→fullscreen).
      if (Array.isArray(g.editorialScenes)) {
        (project.editorialLayout as { scenes?: unknown[] }).scenes = g.editorialScenes;
      }
      console.log(
        `[auto-build] editorial: ${g.editorialCards?.length ?? 0} tarjetas · ${(project.dataViz as unknown[]).length} charts · ${g.editorialScenes?.length ?? 0} escenas de panel`
      );
      return;
    }
    if (Array.isArray(g.dataViz)) project.dataViz = g.dataViz;
    if (Array.isArray(g.kineticHeadlines)) project.kineticHeadlines = g.kineticHeadlines;
    // Íconos de concepto (visuales) — se suman a los que ya trae el estilo.
    if (Array.isArray(g.iconStickers) && g.iconStickers.length) {
      project.iconStickers = [...(project.iconStickers ?? []), ...g.iconStickers];
    }
    console.log(
      `[auto-build] gráficos: ${project.dataViz?.length ?? 0} charts · ${(project.iconStickers as unknown[] | undefined)?.length ?? 0} íconos`
    );
  } catch (err) {
    console.warn("[auto-build] gráficos falló:", err);
  }
}

/**
 * ILUSTRACIONES CC0 (Phase 4) — personas/escenas multicolor por concepto.
 * Spawnea generate_graphics.py --illustrations, lee illustrationStickers del JSON
 * y los SUMA a project.illustrationStickers. Opt-in vía el REGISTRO de estilos
 * (styleHasIllustrations), NO vía flag del proyecto. Best-effort: si falla, el
 * render sale sin ilustraciones (igual que los demás enriquecedores).
 */
export async function applyIllustrations(
  project: ResolvedProject,
  videoId: string
): Promise<void> {
  try {
    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
    const hasTranscript = await fs.access(transcriptPath).then(() => true).catch(() => false);
    if (!hasTranscript) return;

    const outDir = path.join(DATA_ROOT, "graphics");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${videoId}_illustrations.json`);

    const run = await runProcess(
      PYTHON_EXE,
      [
        path.join(PYTHON_DIR, "generate_graphics.py"),
        "--transcript", transcriptPath,
        "--out", outPath,
        "--illustrations",
      ],
      PYTHON_DIR,
      undefined,
      120_000
    );
    if (!run.ok) return;

    const raw = await fs.readFile(outPath, "utf-8").catch(() => null);
    if (!raw) return;
    const g = JSON.parse(raw) as { illustrationStickers?: unknown[] };
    if (Array.isArray(g.illustrationStickers) && g.illustrationStickers.length) {
      project.illustrationStickers = [
        ...(project.illustrationStickers ?? []),
        ...g.illustrationStickers,
      ];
      console.log(
        `[auto-build] ilustraciones CC0: ${g.illustrationStickers.length} stickers`
      );
    }
  } catch (err) {
    console.warn("[auto-build] ilustraciones falló:", err);
  }
}

/**
 * EDITORIAL Ola 6 — Tarjeta de COLLAGE: recorta al sujeto de un frame del
 * clímax (~58% del video) con rembg local (cutout_subject.py) y lo deja en
 * project.editorialCutout. El render lo muestra como papel recortado con
 * borde de tijera + sombra dura + Ken Burns sutil. OPT-IN total: sin rembg
 * instalado o video corto → no hay tarjeta y nada se rompe.
 */
export async function applyEditorialCutout(
  project: ResolvedProject,
  videoId: string
): Promise<void> {
  if (!project.editorialLayout) return;
  try {
    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
    const raw = await fs.readFile(transcriptPath, "utf-8").catch(() => null);
    if (!raw) return;
    const words = (JSON.parse(raw).words ?? []) as { end?: number }[];
    const end = words.length ? Number(words[words.length - 1].end ?? 0) : 0;
    if (end < 14) return; // videos muy cortos: el collage no aporta
    const at = Math.round(end * 0.58 * 100) / 100;

    const run = await runProcess(
      PYTHON_EXE,
      [path.join(PYTHON_DIR, "cutout_subject.py"), videoId, String(at)],
      PYTHON_DIR,
      undefined,
      180_000
    );
    if (!run.ok) return;
    const res = parseLastJsonLine(run.stdout) as { ok?: boolean; file?: string } | null;
    if (!res?.ok || !res.file) return;
    project.editorialCutout = { at, duration: 4.5, file: res.file };
    console.log(`[auto-build] editorial: cutout de sujeto @${at}s (${res.file})`);
  } catch (err) {
    console.warn("[auto-build] cutout falló:", err);
  }
}

/**
 * F1 — DIRECTOR EMOCIONAL: analiza CÓMO habla el speaker (no solo qué dice) con
 * emotion_director.py (librosa, 100% local) y dirige la edición con el resultado:
 *   1. musicVolumeCurve → auto-ducking: la música baja cuando hay voz y respira
 *      en pausas largas (lo que Wisecut cobra, acá gratis).
 *   2. reactionZooms en los PICOS emocionales (solo en estilos dinámicos — si el
 *      estilo no trae zooms, no se inventa ninguno).
 *   3. Volumen de cada SFX modulado por el arousal local (momento intenso → SFX
 *      presente; momento calmo → SFX sutil). Nada de SFX a volumen fijo.
 *   4. project.mood (hype/tension/inspirador/chill/epico) queda guardado para la
 *      selección de música y futuras decisiones.
 * Best-effort: si el análisis falla, el render sale exactamente como antes.
 */
export async function applyEmotionDirector(
  project: ResolvedProject,
  videoId: string,
  /**
   * Acento del video. Viaja en el BuildContext, no en el proyecto, asi que
   * llega por parametro: las particulas lo necesitan para respetar la regla
   * mono-color. Si no llega, la capa cae a su paleta de cinco y el video sale
   * con "chile mole y pozole" — sin error, solo mal.
   */
  accentColor?: string
): Promise<void> {
  try {
    const rawVideo = await findRawVideo(videoId);
    if (!rawVideo) return;
    const outDir = path.join(DATA_ROOT, "emotion");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${videoId}.json`);
    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);

    const run = await runProcess(
      PYTHON_EXE,
      [
        path.join(PYTHON_DIR, "emotion_director.py"),
        rawVideo,
        "--transcript", transcriptPath,
        "--out", outPath,
      ],
      PYTHON_DIR,
      undefined,
      180_000
    );
    if (!run.ok) return;
    const raw = await fs.readFile(outPath, "utf-8").catch(() => null);
    if (!raw) return;
    const e = JSON.parse(raw) as {
      ok?: boolean;
      mood?: string;
      peaks?: { t: number; score: number }[];
      ducking?: { t: number; v: number }[];
      arousal?: { t: number; a: number }[];
    };
    if (!e.ok) return;

    project.mood = e.mood;

    // 1) Auto-ducking — solo tiene sentido si el estilo trae música.
    if (project.musicTrack && Array.isArray(e.ducking) && e.ducking.length > 1) {
      project.musicVolumeCurve = e.ducking;
    }

    // 2) Zooms de reacción en picos emocionales — solo en estilos ya dinámicos.
    const existingZm = (project.zoomMarks ?? []) as { at: number }[];
    const existingRz = (project.reactionZooms ?? []) as { at: number }[];
    const isDynamic = existingZm.length > 0 || existingRz.length > 0;
    if (isDynamic && Array.isArray(e.peaks)) {
      const added = e.peaks
        .filter((p) => p.score >= 0.55)
        .filter((p) => !existingRz.some((z) => Math.abs(z.at - p.t) < 2.5))
        .slice(0, 3)
        .map((p) => ({ at: p.t, intensity: 1.35, duration: 0.25 }));
      if (added.length > 0) {
        project.reactionZooms = [...existingRz, ...added];
      }
      // 2b) MICRO PUNCH-INS (tendencia 2026): en los picos moderados, un zoom sutil
      // del 8% en vez de corte duro — se siente "premium" sin marear.
      const micro = e.peaks
        .filter((p) => p.score >= 0.35 && p.score < 0.55)
        .filter((p) => !existingZm.some((z) => Math.abs(z.at - p.t) < 2.0))
        .map((p) => ({ at: p.t, duration: 0.5, scale: 1.08 }));
      if (micro.length > 0) {
        project.zoomMarks = [...existingZm, ...micro];
      }
      // 2c) F3 — CHISPAS en el pico emocional MÁXIMO: el momento más intenso del
      // video recibe una explosión de partículas (1 sola — el exceso lo abarata).
      const top = [...e.peaks].sort((a, b) => b.score - a.score)[0];
      if (top && top.score >= 0.6) {
        // La PARTICULA depende del tono del video, no es siempre la misma.
        //
        // `emotion_director.py` ya clasifica el mood a partir de arousal y
        // valencia, y la distincion que importa aca es el signo de la valencia:
        // "tension" es alto arousal con valencia NEGATIVA. Tirarle confeti a un
        // remate sobre algo que sale mal lee como burla. Brasas, no fiesta.
        //
        // `emoji_rain` queda deliberadamente sin usar: ningun mood dice
        // "lluvia de emojis", y meter un efecto donde no corresponde es peor
        // que dejarlo guardado.
        const particula =
          e.mood === "hype" ? "confetti" : e.mood === "tension" ? "embers" : "sparks";

        // UN SOLO COLOR — el acento del video.
        //
        // Sin este campo la capa cae a su paleta por omision, que son CINCO
        // colores distintos, y cada particula toma uno. Es exactamente el
        // "chile mole y pozole" que la regla mono-color del proyecto prohibe, y
        // pasaba en todos los videos que llegaban a tener un pico >= 0.6.
        // `embers` ignora el campo a proposito: usa naranjas de brasa fijos.
        const acento = accentColor;

        project.particleBursts = [
          ...((project.particleBursts ?? []) as unknown[]),
          {
            at: top.t,
            duration: 1.6,
            kind: particula,
            count: 60,
            ...(acento ? { colors: [acento] } : {}),
          },
        ] as typeof project.particleBursts;
      }

      // 2d) CONGELADO en el pico máximo: la imagen se detiene un instante para
      // que la frase aterrice.
      //
      // Todo el catálogo de transiciones sirve para PASAR de un plano a otro
      // (barridos, destellos, zooms). Un freeze hace lo contrario: detiene el
      // tiempo. Era el hueco más obvio, y el pico emocional es exactamente donde
      // tiene sentido — rematar un remate, subrayar un dato.
      //
      // UNO SOLO por video, y sólo si el pico es fuerte (≥0.7, por encima del
      // umbral de las chispas): un freeze repetido deja de leerse como énfasis y
      // pasa a leerse como que el video se traba. 0.35s es lo justo para que se
      // note sin que parezca un error de reproducción.
      if (top && top.score >= 0.7) {
        project.freezeMarks = [{ at: top.t, duration: 0.35 }] as typeof project.freezeMarks;
      }
    }

    // 3) Volumen de SFX según el arousal del momento (0.28 calmo → 0.58 intenso).
    const sfx = project.sfxMarks as { at: number; volume?: number }[] | undefined;
    if (Array.isArray(sfx) && Array.isArray(e.arousal) && e.arousal.length > 0) {
      const arousalAt = (t: number): number => {
        let best = e.arousal![0];
        for (const pt of e.arousal!) {
          if (Math.abs(pt.t - t) < Math.abs(best.t - t)) best = pt;
        }
        return best.a;
      };
      for (const m of sfx) {
        m.volume = Math.min(0.58, Math.max(0.25, +(0.28 + 0.3 * arousalAt(m.at)).toFixed(2)));
      }
    }

    console.log(
      `[auto-build] director emocional: mood=${e.mood} · ${e.peaks?.length ?? 0} picos · ducking=${e.ducking?.length ?? 0} pts`
    );
  } catch (err) {
    console.warn("[auto-build] director emocional falló:", err);
  }
}

/**
 * Lee la recomendación de hw_profile para el tracking desde el cache JSON. Devuelve
 * (sample_sec, downscale_w) adaptados al hardware. Si no hay perfil o los valores no
 * son válidos, cae a defaults seguros (0.4s / 480px) — los mismos defaults que tiene
 * track_subject.py, así nada rompe si el perfil aún no se detectó.
 */
function trackingParams(): { sampleSec: number; downscaleW: number } {
  let sampleSec = 0.4;
  let downscaleW = 480;
  try {
    const j = JSON.parse(
      readFileSync(path.join(DATA_ROOT, "cache", "hw_profile.json"), "utf-8")
    ) as { recommend?: { tracking_sample_sec?: number; tracking_downscale_w?: number } };
    const rec = j?.recommend ?? {};
    if (typeof rec.tracking_sample_sec === "number" && rec.tracking_sample_sec > 0) {
      sampleSec = rec.tracking_sample_sec;
    }
    if (typeof rec.tracking_downscale_w === "number" && rec.tracking_downscale_w >= 0) {
      downscaleW = rec.tracking_downscale_w;
    }
  } catch {
    // sin perfil → defaults
  }
  return { sampleSec, downscaleW };
}

/**
 * A2 — Dimensiones REALES del raw (ancho/alto DISPLAYED) vía ffprobe, para que el
 * auto-reframe conozca el aspect verdadero. Clave en celulares: graban apaisado y
 * marcan rotación 90/270 en metadata → el frame codificado es ancho×alto, pero se
 * MUESTRA alto×ancho. Si no compensáramos la rotación, un vertical 9:16 se vería
 * como 16:9 y el reencuadre fallaría. Reusa FFPROBE_EXE (binario ya configurado,
 * sin asumir PATH). Devuelve null si ffprobe falla → el caller deja el campo sin
 * setear y build-props mantiene su fallback 16/9.
 */
async function probeSourceAspect(
  rawVideo: string
): Promise<{ width: number; height: number; aspect: number } | null> {
  try {
    const run = await runProcess(
      FFPROBE_EXE,
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate",
        "-of", "json",
        rawVideo,
      ],
      undefined,
      undefined,
      30_000
    );
    if (!run.ok) return null;
    const parsed = JSON.parse(run.stdout) as {
      streams?: Array<{
        width?: number;
        height?: number;
        tags?: { rotate?: string };
        side_data_list?: Array<{ rotation?: number }>;
      }>;
    };
    const s = parsed.streams?.[0];
    if (!s || !s.width || !s.height) return null;
    let width = s.width;
    let height = s.height;
    // Rotación viene como tag `rotate` (string) o en side_data (número, suele ser
    // negativo: -90). Si es ±90/±270, ancho y alto se intercambian al mostrarse.
    const rotTag = s.tags?.rotate ? parseInt(s.tags.rotate, 10) : 0;
    const rotSide = s.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? 0;
    const rot = ((Math.abs(rotTag || rotSide) % 360) + 360) % 360;
    if (rot === 90 || rot === 270) {
      [width, height] = [height, width];
    }
    if (width <= 0 || height <= 0) return null;
    return { width, height, aspect: width / height };
  } catch {
    return null;
  }
}

/** Motion tracking: detecta cara en el raw, llena project.trackPath. */
export async function applyTracking(
  project: ResolvedProject,
  videoId: string
): Promise<void> {
  // GATING: solo corre para estilos con tracking:true. Si no lo pide, no se
  // spawnea nada (ni se lee hw_profile) — barato en equipos modestos.
  if (!project.tracking) return;
  try {
    const rawVideo = await findRawVideo(videoId);
    if (!rawVideo) return;
    // Muestreo + downscale adaptativos al hardware (hw_profile.recommend). En
    // equipos modestos: muestreo más espaciado. La trayectoria se interpola en
    // track_subject.py → seguimiento fluido con MENOS trabajo. El video NO cambia.
    const { sampleSec, downscaleW } = trackingParams();
    const trackRun = await runProcess(
      PYTHON_EXE,
      [
        path.join(PYTHON_DIR, "track_subject.py"),
        rawVideo,
        String(sampleSec),
        String(downscaleW),
      ],
      PYTHON_DIR,
      undefined,
      180_000
    );
    if (!trackRun.ok) return;
    const line = trackRun.stdout
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .pop();
    const parsed = line ? (JSON.parse(line) as { points?: unknown[] }) : null;
    const pts = parsed?.points ?? [];
    project.trackPath = pts;
    // F2 — Subtítulos FUERA de la cara: si la cara vive en la zona baja del frame
    // (donde van los subtítulos), el texto se mueve arriba. Nunca tapa al speaker.
    const ys = (pts as { y?: number }[])
      .map((p) => p.y)
      .filter((y): y is number => typeof y === "number");
    if (ys.length > 3) {
      const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
      if (avgY > 0.62) {
        project.subtitlePosition = "top";
        console.log(`[auto-build] cara abajo (y=${avgY.toFixed(2)}) → subtítulos ARRIBA`);
      }
    }
    console.log(`[auto-build] motion tracking: ${pts.length} puntos de cara`);
    // A2 — aspecto real del source para el auto-reframe. Solo lo necesita autoReframe;
    // si ffprobe falla, dejamos los campos sin setear (build-props cae a 16/9 default).
    if (project.autoReframe) {
      const dims = await probeSourceAspect(rawVideo);
      if (dims) {
        project.sourceAspect = dims.aspect;
        project.sourceWidth = dims.width;
        project.sourceHeight = dims.height;
        console.log(
          `[auto-build] sourceAspect=${dims.aspect.toFixed(3)} (${dims.width}x${dims.height}) para auto-reframe`
        );
      } else {
        console.warn("[auto-build] ffprobe no devolvió dimensiones — auto-reframe usará fallback 16/9");
      }
    }
  } catch (err) {
    console.warn("[auto-build] tracking falló:", err);
  }
}

/** Quitar fondo con IA: genera <videoId>_fg.mp4 y lo marca como foregroundVideoId. */
export async function applyRemoveBg(
  project: ResolvedProject,
  videoId: string
): Promise<void> {
  if (!project.removeBg) return;
  try {
    const rawVideo = await findRawVideo(videoId);
    if (!rawVideo) return;
    const fgId = `${videoId}_fg`;
    const fgPath = path.join(RAW_DIR, `${fgId}.mp4`);
    const bgRun = await runProcess(
      PYTHON_EXE,
      [path.join(PYTHON_DIR, "remove_background.py"), rawVideo, fgPath, "blur"],
      PYTHON_DIR,
      undefined,
      600_000 // 10 min — segmentación por frame puede tardar en videos largos
    );
    const parsedBg = bgRun.ok ? parseLastJsonLine<{ ok?: boolean }>(bgRun.stdout) : null;
    const okFlag = parsedBg?.ok === true;
    if (okFlag && (await fs.access(fgPath).then(() => true).catch(() => false))) {
      project.foregroundVideoId = fgId;
      console.log(`[auto-build] quitar fondo IA: ${fgId}.mp4 generado`);
    } else {
      console.warn("[auto-build] quitar fondo: no se generó el compuesto, sigo con el raw");
    }
  } catch (err) {
    console.warn("[auto-build] quitar fondo falló:", err);
  }
}

/**
 * Voz IA (C1/C2). Sintetiza desde project.voiceover.text.
 *   - Con speakerWav → C2 (XTTS-v2 clona tu voz, ~1.8GB modelo).
 *   - Sin speakerWav → C1 (Piper, voz ES default, ~63MB).
 * Setea project.voiceoverUrl/Volume/StartSec al éxito.
 */
export async function applyVoiceover(
  project: ResolvedProject,
  projectId: string
): Promise<void> {
  const vo = project.voiceover;
  if (!vo || !vo.text || vo.text.trim().length === 0) return;
  try {
    await fs.mkdir(VOICEOVER_DIR, { recursive: true });
    const voFile = `${projectId}.wav`;
    const voPath = path.join(VOICEOVER_DIR, voFile);
    const useXtts = Boolean(vo.speakerWav);
    const scriptArgs = useXtts
      ? [
          path.join(PYTHON_DIR, "xtts.py"),
          vo.text,
          voPath,
          "--speaker",
          vo.speakerWav!,
          "--lang",
          vo.lang ?? "es",
        ]
      : [path.join(PYTHON_DIR, "tts.py"), vo.text, voPath];
    // XTTS es CPU-intensivo + descarga el modelo la primera vez → timeout más amplio.
    const ttsTimeout = useXtts ? 900_000 : 180_000;
    const ttsRun = await runProcess(
      PYTHON_EXE,
      scriptArgs,
      PYTHON_DIR,
      undefined,
      ttsTimeout
    );
    const parsed = ttsRun.ok ? parseLastJsonLine<{ ok?: boolean }>(ttsRun.stdout) : null;
    if (parsed?.ok && (await fs.access(voPath).then(() => true).catch(() => false))) {
      const apiHost = process.env.VIRAL_API_HOST ?? "http://localhost:3000";
      project.voiceoverUrl = `${apiHost}/api/voiceover/stream?file=${encodeURIComponent(voFile)}`;
      project.voiceoverVolume = vo.volume ?? 0.7;
      project.voiceoverStartSec = vo.startSec ?? 0;
      console.log(`[auto-build] voz IA (${useXtts ? "XTTS clon" : "Piper"}): ${voFile}`);
    } else {
      console.warn("[auto-build] tts.py no generó WAV; render sin voz");
    }
  } catch (err) {
    console.warn("[auto-build] voz IA falló:", err);
  }
}

/** A3 — Texto detrás del sujeto: bake el efecto en un nuevo mp4 y marca foregroundVideoId. */
export async function applyTextBehind(
  project: ResolvedProject,
  videoId: string
): Promise<void> {
  const tb = project.textBehind;
  if (!tb || !tb.phrase) return;
  try {
    const rawVideo = await findRawVideo(videoId);
    if (!rawVideo) return;
    const tbId = `${videoId}_textbehind`;
    const tbPath = path.join(RAW_DIR, `${tbId}.mp4`);
    const tbRun = await runProcess(
      PYTHON_EXE,
      [
        path.join(PYTHON_DIR, "text_behind_subject.py"),
        rawVideo,
        tbPath,
        tb.phrase,
        "--color",
        tb.color || "ffffff",
      ],
      PYTHON_DIR,
      undefined,
      600_000 // 10 min — segmentación por frame
    );
    const parsedTb = tbRun.ok ? parseLastJsonLine<{ ok?: boolean }>(tbRun.stdout) : null;
    const okFlag = parsedTb?.ok === true;
    if (okFlag && (await fs.access(tbPath).then(() => true).catch(() => false))) {
      project.foregroundVideoId = tbId;
      console.log(`[auto-build] texto-detrás-del-sujeto: ${tbId}.mp4 generado`);
    } else {
      console.warn("[auto-build] texto-detrás: no se generó, sigo con el raw");
    }
  } catch (err) {
    console.warn("[auto-build] texto-detrás-del-sujeto falló:", err);
  }
}

/** C3 — Traducción de caption: setea project.captionTranslated. */
export async function applyTranslate(project: ResolvedProject): Promise<void> {
  const translateTo = project.translateTo;
  const captionToTranslate = project.caption;
  if (!translateTo || !captionToTranslate || captionToTranslate.trim().length === 0) return;
  try {
    const trRun = await runProcess(
      PYTHON_EXE,
      [path.join(PYTHON_DIR, "translate.py"), captionToTranslate, "--to", translateTo],
      PYTHON_DIR,
      undefined,
      60_000
    );
    const parsed = trRun.ok
      ? parseLastJsonLine<{ ok?: boolean; translated?: string }>(trRun.stdout)
      : null;
    if (parsed?.ok && parsed.translated) {
      project.captionTranslated = parsed.translated;
      console.log(`[auto-build] traducción es→${translateTo} OK`);
    } else {
      console.warn(`[auto-build] translate.py no devolvió texto (${trRun.stderr.slice(-200)})`);
    }
  } catch (err) {
    console.warn("[auto-build] traducción falló:", err);
  }
}
