// CINE CLÁSICO — enriquecedor por-pico (opt-in, best-effort).
//
// El estilo `cine_clasico` es cine antiguo editorial: el LOOK BASE (subtítulos
// cine, film grain, LUT cálido desaturado, viñeta, música baja) lo hornea
// buildProjectForStyle. Esta función agrega la DRAMA en los momentos dramáticos
// (los "picos" del director emocional) y la revierte fuera de ellos:
//
//   1) VOZ → suena a radio vieja / teléfono antiguo: construye una cadena -af de
//      ffmpeg con band-limit (highpass 400 + lowpass 3000) GATEADA por ventana con
//      la opción `enable='between(t,A,B)+...'`, de modo que la voz se vuelve
//      telefónica SOLO dentro de los picos y full-range afuera. La guarda en
//      project.audioFilterPre; el mastering de audio la antepone a su cadena base.
//
//   2) IMAGEN → blanco y negro (cine antiguo) + grano: emite project.bwWindows
//      (cada ventana {at, duration}); ViralVideo desatura el video base solo ahí.
//      project.filmGrain ya viene true del builder.
//
//   3) SFX → máquina de escribir / proyector: pone sfxMarks (typewriter.wav y
//      film_reel.wav, alternados) al inicio de cada ventana de pico.
//
// Todo gateado a styleId==="cine_clasico" y envuelto en try/catch por el caller:
// si los picos no se obtienen, el estilo igual renderiza como cine elegante.

import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT, PYTHON_DIR, PYTHON_EXE, TRANSCRIPTS_DIR } from "@/lib/paths";
import { runProcess } from "@/lib/run-process";
import { findRawVideo } from "./helpers";
import type { ResolvedProject } from "./types";

interface Peak {
  t: number;
  score: number;
}

/** Lee el emotion JSON cacheado; si no existe, corre emotion_director.py una vez. */
async function getPeaks(videoId: string, duration: number): Promise<Peak[]> {
  const outPath = path.join(DATA_ROOT, "emotion", `${videoId}.json`);
  // 1) Cache (lo escribe applyEmotionDirector, que corre antes en el loop).
  try {
    const raw = await fs.readFile(outPath, "utf-8");
    const e = JSON.parse(raw) as { ok?: boolean; peaks?: Peak[] };
    if (e.ok && Array.isArray(e.peaks)) return e.peaks;
  } catch {
    /* sin cache → correr el director */
  }
  // 2) Correr emotion_director.py (best-effort).
  const rawVideo = await findRawVideo(videoId);
  if (!rawVideo) return [];
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const run = await runProcess(
    PYTHON_EXE,
    [
      path.join(PYTHON_DIR, "emotion_director.py"),
      rawVideo,
      "--transcript",
      transcriptPath,
      "--out",
      outPath,
    ],
    PYTHON_DIR,
    undefined,
    180_000
  );
  if (!run.ok) return [];
  try {
    const e = JSON.parse(await fs.readFile(outPath, "utf-8")) as {
      ok?: boolean;
      peaks?: Peak[];
    };
    if (e.ok && Array.isArray(e.peaks)) return e.peaks;
  } catch {
    /* nada */
  }
  return [];
}

/**
 * Construye las ventanas dramáticas a partir de los picos: cada ventana es
 * [peak-1.0 .. peak+3.0] recortada a [0, duration]. Se ordenan y se fusionan las
 * que se solapan (para no doblar el band-limit en el -af).
 */
export function peakWindows(
  peaks: Peak[],
  duration: number
): { at: number; duration: number }[] {
  const raw = peaks
    .map((p) => {
      const start = Math.max(0, p.t - 1.0);
      const end = Math.min(duration, p.t + 3.0);
      return { start, end };
    })
    .filter((w) => w.end - w.start > 0.3)
    .sort((a, b) => a.start - b.start);
  // Fusionar solapamientos.
  const merged: { start: number; end: number }[] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end + 0.05) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ ...w });
    }
  }
  return merged.map((w) => ({
    at: +w.start.toFixed(2),
    duration: +(w.end - w.start).toFixed(2),
  }));
}

/**
 * Construye el -af telefónico GATEADO por las ventanas (between(t,A,B)+...).
 * highpass=f=400 + lowpass=f=3000 (banda de teléfono/radio AM) activados SOLO
 * dentro de las ventanas; afuera la voz pasa full-range. Si no hay ventanas
 * devuelve "" (sin -af extra). El acrusher añade el "crujido" de radio vieja.
 */
export function buildTelephoneFilter(
  windows: { at: number; duration: number }[]
): string {
  if (windows.length === 0) return "";
  const between = windows
    .map((w) => `between(t,${w.at.toFixed(2)},${(w.at + w.duration).toFixed(2)})`)
    .join("+");
  const enable = `enable='${between}'`;
  // highpass+lowpass = band-limit telefónico; acrusher (bits 8, leve) = crujido AM.
  return [
    `highpass=f=400:${enable}`,
    `lowpass=f=3000:${enable}`,
    `acrusher=bits=8:mode=log:mix=0.35:${enable}`,
  ].join(",");
}

/**
 * Enriquecedor cine_clasico: muta `project` con bwWindows, sfxMarks de cine
 * antiguo y project.audioFilterPre (la cadena -af telefónica gateada). Devuelve
 * las ventanas calculadas (para log). Best-effort: ante 0 picos no hace nada.
 */
export async function applyCineClasico(
  project: ResolvedProject,
  videoId: string,
  duration: number
): Promise<{ at: number; duration: number }[]> {
  const peaks = await getPeaks(videoId, duration);
  if (peaks.length === 0) return [];
  const windows = peakWindows(peaks, duration);
  if (windows.length === 0) return [];

  // 2) IMAGEN → B&W en cada ventana.
  project.bwWindows = windows;

  // 3) SFX → máquina de escribir / proyector, alternados, al inicio de cada
  // ventana. Volumen suave para no tapar la voz (el director emocional luego lo
  // modula por arousal, así que estos quedan presentes en los picos).
  const cineSfx = windows.map((w, i) => ({
    at: +Math.max(0, w.at - 0.05).toFixed(2),
    sound: i % 2 === 0 ? "typewriter.wav" : "film_reel.wav",
    volume: 0.32,
  }));
  const existing = (project.sfxMarks as { at: number }[] | undefined) ?? [];
  project.sfxMarks = [...existing, ...cineSfx].sort((a, b) => a.at - b.at);

  // 1) VOZ → radio vieja gateada a las ventanas.
  project.audioFilterPre = buildTelephoneFilter(windows);

  return windows;
}
