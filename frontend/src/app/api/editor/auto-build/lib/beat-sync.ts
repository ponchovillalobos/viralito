// Beat-sync: "cortar al ritmo". Lee el mapa rítmico de la pista (detect_beats.py →
// music_map.py: beats, downbeats, secciones, drops) y ordena el montaje contra él.
//
// Antes: los 12 beats más fuertes recibían zoom + flash, exactamente EN el beat, y
// nada más se movía — los cortes seguían donde los ponían las palabras clave. El
// video de referencia que se midió (78 % de eventos en el beat) hace otra cosa:
//
//   drop            → golpe grande: flash + punch + zoom
//   downbeat        → zoom suave (cada uno en secciones altas, uno sí/uno no en medias,
//                     ninguno en las bajas)
//   evento existente cerca de un beat (zoom, punch, transición, corte de B-roll)
//                   → se CUANTIZA a ese beat, si está a ≤ min(150 ms, ¼ de beat)
//
// y todo cae UN FRAME ANTES del beat: la norma ITU-R BT.1359 pone el umbral en que
// se nota el desfase en +45 ms si el sonido va adelantado y −125 ms si va atrasado,
// así que una imagen 33 ms antes no se percibe y 33 ms tarde sí.
//
// Pre-condiciones (si falta una, sale sin tocar nada):
//   - project.beatSync === true
//   - project.musicTrack es una URL con ?file=<filename> que existe en MUSIC_DIR
//   - el estilo NO tiene jump cuts: la música suena en el tiempo de salida y los
//     eventos están en el del video fuente; con jump cuts no coinciden.
//
// Va DESPUÉS del director emocional para que sus zooms en los picos también
// caigan en la grilla, en vez de competir con los del beat.

import { promises as fs } from "node:fs";
import path from "node:path";
import { MUSIC_DIR, PYTHON_DIR, PYTHON_EXE } from "@/lib/paths";
import { runProcess } from "@/lib/run-process";
import type { ResolvedProject } from "./types";

export const FPS = 30;
/** Cuánto antes del beat cae cada golpe (1 frame a 30 fps). */
export const ANTICIPACION = 1 / FPS;
/** Separación mínima entre dos golpes generados, en segundos. */
const SEPARACION_MIN = 1.2;
/** Tope de golpes generados por cada 10 s de video (sin contar drops). */
const TOPE_POR_10S = 5;

export interface MapaRitmico {
  bpm?: number;
  dur?: number;
  beats?: { t: number; strength: number }[];
  downbeats?: number[];
  drops?: number[];
  bars?: { t: number; e: number }[];
  sections?: { t0: number; t1: number; kind: "low" | "mid" | "high"; energy: number }[];
}

type Evento = { at: number };
type Clip = { start: number; end: number };

const r2 = (n: number) => +n.toFixed(3);

/** Beat más cercano a `t`, si está dentro de la tolerancia. */
function beatCercano(t: number, beats: number[], tol: number): number | null {
  let mejor: number | null = null;
  let d = Infinity;
  for (const b of beats) {
    const x = Math.abs(b - t);
    if (x < d) { d = x; mejor = b; }
    if (b > t + tol) break;
  }
  return mejor !== null && d <= tol ? mejor : null;
}

/**
 * Desde qué downbeat arrancar la música para que el tramo que suena durante el
 * clip sea el de más energía. Antes la pista sonaba siempre desde el segundo 0,
 * o sea desde la intro tranquila, aunque el clip dure 40 s y la parte buena
 * empiece en el 1:28. Devuelve 0 si la pista es más corta que el clip.
 */
export function elegirInicioMusica(mapa: MapaRitmico, duracion: number): number {
  const bars = mapa.bars ?? [];
  const total = mapa.dur ?? (bars.length ? bars[bars.length - 1].t : 0);
  if (bars.length < 4 || total <= duracion + 2) return 0;
  let mejor = 0;
  let mejorE = -1;
  for (const b of bars) {
    if (b.t + duracion > total - 1.5) break; // que no se corte antes del final
    const dentro = bars.filter((x) => x.t >= b.t && x.t < b.t + duracion);
    if (!dentro.length) continue;
    // Energía media del tramo + premio si hay un drop dentro, cerca del tercio.
    let e = dentro.reduce((a, x) => a + x.e, 0) / dentro.length;
    for (const d of mapa.drops ?? []) {
      const rel = (d - b.t) / duracion;
      if (rel > 0.15 && rel < 0.7) e += 0.25;
    }
    if (e > mejorE + 1e-9) { mejorE = e; mejor = b.t; }
  }
  return r2(mejor);
}

/** Corre el mapa para que sus tiempos queden en el reloj del VIDEO. */
export function desplazarMapa(mapa: MapaRitmico, inicio: number): MapaRitmico {
  if (!inicio) return mapa;
  const m = (t: number) => r2(t - inicio);
  return {
    ...mapa,
    beats: (mapa.beats ?? []).map((b) => ({ ...b, t: m(b.t) })),
    downbeats: (mapa.downbeats ?? []).map(m),
    drops: (mapa.drops ?? []).map(m),
    bars: (mapa.bars ?? []).map((b) => ({ ...b, t: m(b.t) })),
    sections: (mapa.sections ?? []).map((x) => ({ ...x, t0: m(x.t0), t1: m(x.t1) })),
  };
}

/**
 * Plan puro (sin disco ni procesos): muta `project` según el mapa. Devuelve un
 * resumen para el log y los tests.
 */
export function planBeatSync(
  project: ResolvedProject,
  mapa: MapaRitmico,
  duracion: number,
  acento = "#fb923c"
): { drops: number; downbeats: number; cuantizados: number } {
  const dentro = (t: number) => t > 0.5 && t < duracion - 0.3;
  const beats = (mapa.beats ?? []).map((b) => b.t).filter(dentro);
  if (beats.length < 4) return { drops: 0, downbeats: 0, cuantizados: 0 };

  const periodo = mapa.bpm && mapa.bpm > 0 ? 60 / mapa.bpm : 0.5;
  const tol = Math.min(0.15, periodo / 4);
  const antes = (t: number) => r2(Math.max(0, t - ANTICIPACION));

  // 1) Cuantizar lo que ya existe (zooms, punches, transiciones, cortes de B-roll).
  let cuantizados = 0;
  const cuantizar = (lista: unknown[] | undefined) => {
    for (const e of (lista ?? []) as Evento[]) {
      if (typeof e?.at !== "number") continue;
      const b = beatCercano(e.at, beats, tol);
      if (b !== null) { e.at = antes(b); cuantizados++; }
    }
  };
  cuantizar(project.zoomMarks);
  cuantizar(project.reactionZooms);
  cuantizar(project.proTransitions);
  const broll = (project as { bRoll?: Clip[] }).bRoll;
  for (const c of broll ?? []) {
    if (typeof c?.start !== "number") continue;
    const b = beatCercano(c.start, beats, tol);
    if (b !== null) {
      const largo = c.end - c.start;
      c.start = antes(b);
      c.end = r2(c.start + largo);
      cuantizados++;
    }
  }

  // Momentos ya ocupados: no apilar un golpe nuevo encima de uno existente.
  const ocupados: number[] = [
    ...((project.zoomMarks ?? []) as Evento[]).map((e) => e.at),
    ...((project.reactionZooms ?? []) as Evento[]).map((e) => e.at),
  ];
  const libre = (t: number) => ocupados.every((o) => Math.abs(o - t) >= SEPARACION_MIN);

  // 2) Drops: el golpe grande.
  const zooms: { at: number; duration: number; scale: number }[] = [];
  const punches: { at: number; intensity: number; duration: number }[] = [];
  const flashes: { at: number; kind: "flash"; durationFrames: number; color: string }[] = [];
  let drops = (mapa.drops ?? []).filter(dentro);
  // Un clip de 30-60 s casi nunca contiene el drop de una pista de 3 min. Sin
  // drop dentro, el golpe va en el compás con el mayor salto de energía del
  // tramo que sí suena, si el salto es claro (>= 0.15 sobre el compás anterior).
  if (drops.length === 0 && mapa.bars && mapa.bars.length > 2) {
    let mejor: { t: number; salto: number } | null = null;
    for (let i = 1; i < mapa.bars.length; i++) {
      const b = mapa.bars[i];
      if (!dentro(b.t) || b.t < 2) continue;
      const salto = b.e - mapa.bars[i - 1].e;
      if (salto >= 0.15 && (!mejor || salto > mejor.salto)) mejor = { t: b.t, salto };
    }
    if (mejor) drops = [mejor.t];
  }
  // Un destello de luz de lente (lightLeak) acompaña al golpe, teñido al acento.
  const luces: { at: number; duration: number; seed: number; color: string; intensity: number }[] = [];
  for (const [n, d] of drops.entries()) {
    const t = antes(d);
    flashes.push({ at: t, kind: "flash", durationFrames: 5, color: "#ffffff" });
    punches.push({ at: t, intensity: 1.2, duration: 0.22 });
    luces.push({ at: t, duration: Math.min(1.6, periodo * 4), seed: n + 1, color: acento, intensity: 0.6 });
    ocupados.push(t);
  }

  // 3) Downbeats según la energía de la sección.
  const seccionDe = (t: number) =>
    (mapa.sections ?? []).find((s) => t >= s.t0 && t < s.t1)?.kind ?? "mid";
  const porVentana = new Map<number, number>();
  let alternar = 0;
  let nDown = 0;
  for (const db of (mapa.downbeats ?? []).filter(dentro)) {
    const kind = seccionDe(db);
    if (kind === "low") continue;
    if (kind === "mid" && alternar++ % 2 === 1) continue;
    const t = antes(db);
    const ventana = Math.floor(t / 10);
    if ((porVentana.get(ventana) ?? 0) >= TOPE_POR_10S || !libre(t)) continue;
    porVentana.set(ventana, (porVentana.get(ventana) ?? 0) + 1);
    zooms.push({ at: t, duration: Math.min(0.45, periodo * 0.9), scale: kind === "high" ? 1.08 : 1.05 });
    ocupados.push(t);
    nDown++;
  }

  project.zoomMarks = [...(project.zoomMarks ?? []), ...zooms];
  project.reactionZooms = [...(project.reactionZooms ?? []), ...punches];
  project.proTransitions = [...(project.proTransitions ?? []), ...flashes];
  if (luces.length) project.lightLeaks = [...(project.lightLeaks ?? []), ...luces];
  return { drops: drops.length, downbeats: nDown, cuantizados };
}

/** Busca la pista en MUSIC_DIR y sus subcarpetas, como /api/music/stream. */
async function buscarPista(nombre: string): Promise<string | null> {
  if (nombre.includes("..") || nombre.includes("/") || nombre.includes("\\")) return null;
  for (const sub of ["", "github", "pixabay", "freesound"]) {
    const p = path.join(MUSIC_DIR, sub, nombre);
    if (await fs.access(p).then(() => true).catch(() => false)) return p;
  }
  const recorrer = async (dir: string, prof: number): Promise<string | null> => {
    if (prof > 3) return null;
    const entradas = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entradas) {
      if (e.isFile() && e.name === nombre) return path.join(dir, e.name);
    }
    for (const e of entradas) {
      if (e.isDirectory() && !e.name.startsWith(".")) {
        const r = await recorrer(path.join(dir, e.name), prof + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return recorrer(MUSIC_DIR, 0);
}

export async function applyBeatSync(
  project: ResolvedProject,
  transcriptDuration: number,
  accentColor?: string
): Promise<void> {
  const musicTrack = project.musicTrack;
  if (project.beatSync !== true || !musicTrack || project.enableJumpCuts) return;

  try {
    const fileParam = new URL(musicTrack, "http://x").searchParams.get("file");
    const musicPath = fileParam ? await buscarPista(fileParam) : null;
    if (!musicPath) {
      // Antes buscaba sólo en la raíz de MUSIC_DIR, pero las pistas viven en
      // subcarpetas por origen (github/, pixabay/...): no las encontraba y salía
      // sin decir nada. El beat-sync no corrió NUNCA hasta el 2026-09-23.
      console.warn(`[auto-build] beat-sync: no encontré la pista ${fileParam} en ${MUSIC_DIR}`);
      return;
    }

    const run = await runProcess(
      PYTHON_EXE,
      [path.join(PYTHON_DIR, "detect_beats.py"), musicPath],
      PYTHON_DIR,
      undefined,
      180_000
    );
    if (!run.ok) {
      console.warn("[auto-build] beat-sync: detect_beats.py falló", run.stderr?.slice(-300));
      return;
    }
    const line = run.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop();
    const mapa = line ? (JSON.parse(line) as MapaRitmico) : null;
    if (!mapa) return;

    // La música arranca en el downbeat que deja su parte más fuerte dentro del
    // clip; la grilla se corre para quedar en el reloj del video.
    const inicio = elegirInicioMusica(mapa, transcriptDuration);
    if (inicio > 0) project.musicStartSec = inicio;
    const r = planBeatSync(project, desplazarMapa(mapa, inicio), transcriptDuration, accentColor);
    console.log(
      `[auto-build] beat-sync (${mapa.bpm ?? "?"} bpm, música desde ${inicio}s): ${r.drops} drops, ${r.downbeats} downbeats, ${r.cuantizados} eventos al beat`
    );
  } catch (err) {
    console.warn("[auto-build] beat-sync falló:", err);
  }
}
