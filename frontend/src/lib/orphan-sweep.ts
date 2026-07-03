/**
 * Detección de huérfanos + limpieza de ARTEFACTOS de proceso.
 *
 * ⚠️ INVARIANTE (incidente 2026-07-03): NINGÚN proceso automático borra archivos
 * del usuario. NUNCA. El sweep viejo asumía "raw ausente ⇒ borrar todos los
 * derivados" y cuando el usuario borró/movió sus videos originales (organización
 * normal de disco), le DESTRUYÓ los renders terminados — su producto final.
 * Desde entonces:
 *   1. `videoBackingExists()` — los listados FILTRAN lo que no tiene render válido
 *      (visual, no destruye nada). Sin cambios.
 *   2. `sweepLongFormOrphans()` / `sweepShortOrphans()` — SOLO DETECTAN candidatos
 *      huérfanos y los escriben en `{DATA_ROOT}/orphan-report.json` para una futura
 *      pantalla manual de "Liberar espacio". No borran NADA (deleted siempre 0).
 *   3. `sweepStaleArtifacts()` — lo único que sí borra, y SOLO basura de proceso:
 *      temporales `.__rendering`, locks, intermedios `_raw/_nolut` >24h y previews
 *      >7d (caché regenerable). Jamás un render/clip final.
 *   4. `maybeSweepOrphans()` — dispara lo anterior a lo sumo ~2x/día.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DATA_ROOT as DATA_ROOT_DIR,
  LF_RAW,
  LF_CLEAN,
  LF_CLIPS,
  LF_RENDERS,
  LF_ROOT,
  RAW_DIR,
  RENDERS_DIR,
  PROJECTS_DIR,
  TRANSCRIPTS_DIR,
  CUTS_DIR,
} from "@/lib/paths";
import { LF_TRANSCRIPTS, LF_CUTS, LF_PROPOSALS, LF_PROJECTS_DIR } from "@/lib/paths-long-form";
import { STYLE_IDS } from "@/lib/style-registry";

const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h → ~2 barridos/día

// Renders de naming de máquina `{videoStem}_{styleId}`. El sufijo de estilo se
// DERIVA del registro (STYLE_IDS) en vez de hardcodear la lista — así un render
// huérfano de un estilo nuevo (cine_clasico, kinetic_type, …) SÍ se barre sin
// tener que tocar este regex. Ordenamos por longitud desc para que la alternancia
// no trunque (`hype_max_sfx` antes que `hype_max` antes que `hype`) y escapamos
// cada id por si alguno trae metacaracteres de regex.
const _STYLE_ALT = [...STYLE_IDS]
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const MACHINE_RENDER = new RegExp(
  `_(${_STYLE_ALT})(\\.__rendering(_[a-z]+)?)?$`
);

const LF_GRAPHICS = path.join(LF_ROOT, "graphics");
const LF_FACE_TRACKS = path.join(LF_ROOT, "face_tracks");

async function listSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** Stems (nombre sin extensión) de los videos raw que existen en `dir`. */
async function rawStems(dir: string): Promise<Set<string>> {
  const files = await listSafe(dir);
  const stems = new Set<string>();
  for (const f of files) {
    if (VIDEO_EXTS.includes(path.extname(f).toLowerCase())) {
      stems.add(path.basename(f, path.extname(f)));
    }
  }
  return stems;
}

/** videoId dueño de un archivo derivado de largos a partir de su nombre. */
export function longFormOwner(filename: string): string {
  let stem = path.basename(filename, path.extname(filename));
  const clip = stem.match(/^(.+?)_c\d+/); // clips/renders/projects/graphics: {id}_cNN_…
  if (clip) return clip[1];
  // Supercuts: {id}_supercut_{style} — sin esto el sweep los trataba como huérfanos
  // (el owner quedaba con el sufijo entero, nunca matcheaba un raw) y los BORRABA.
  const supercut = stem.match(/^(.+?)_supercut(_|$)/);
  if (supercut) return supercut[1];
  if (stem.endsWith("_clean")) stem = stem.slice(0, -"_clean".length); // clean: {id}_clean
  return stem;
}

/** Tamaño mínimo para considerar un render REPRODUCIBLE (uno fallido/truncado queda chico). */
const MIN_RENDER_BYTES = 100 * 1024;

/** Stems de renders que existen Y son válidos (>100KB) en `dir`. */
async function validRenderStems(dir: string): Promise<Set<string>> {
  const files = await listSafe(dir);
  const stems = new Set<string>();
  await Promise.all(
    files
      .filter((f) => f.toLowerCase().endsWith(".mp4") && !f.includes(".__rendering"))
      .map(async (f) => {
        try {
          const st = await fs.stat(path.join(dir, f));
          if (st.size > MIN_RENDER_BYTES) stems.add(path.basename(f, ".mp4"));
        } catch {
          /* ignore */
        }
      })
  );
  return stems;
}

/**
 * ¿El proyecto tiene un video REPRODUCIBLE? Se usa para filtrar "Mis videos": un
 * proyecto se muestra SOLO si su render final existe y es válido (>100KB). Antes se
 * mostraba si existía el raw/clips aunque el render hubiera FALLADO → quedaban videos
 * que "no se reproducen" en la lista (todos los renders rotos por el bug de fuentes).
 * "Mis videos" = videos TERMINADOS, así que exigir el render reproducible es lo correcto.
 */
export async function buildBackingChecker(): Promise<
  (id: string, videoId: string | undefined, source: "short" | "long_form") => boolean
> {
  const [shortRenders, lfRenders] = await Promise.all([
    validRenderStems(RENDERS_DIR),
    validRenderStems(LF_RENDERS),
  ]);
  return (id, _videoId, source) =>
    source === "long_form" ? lfRenders.has(id) : shortRenders.has(id);
}

/** Escribe el reporte de huérfanos (para la futura pantalla manual "Liberar espacio").
 *  Merge por sección; NUNCA borra nada. Best-effort. */
async function writeOrphanReport(
  section: "long_form" | "short",
  candidates: string[],
): Promise<void> {
  const reportPath = path.join(DATA_ROOT_DIR, "orphan-report.json");
  try {
    let report: Record<string, unknown> = {};
    try {
      report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
    } catch {
      /* primer reporte */
    }
    report[section] = candidates;
    report.generatedAt = new Date().toISOString();
    report.note =
      "Candidatos huérfanos DETECTADOS (su video original ya no está). NADA se borra automáticamente — invariante desde 2026-07-03.";
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  } catch {
    /* el reporte es informativo, nunca bloquea */
  }
}

/**
 * DETECTA (no borra) derivados de LARGOS cuyo raw ya no existe y los reporta en
 * orphan-report.json. `deleted` es SIEMPRE 0 — ver invariante del módulo: el sweep
 * viejo destruyó renders terminados del usuario cuando él movió sus raws.
 */
export async function sweepLongFormOrphans(): Promise<{ deleted: number; orphans: string[] }> {
  const raw = await rawStems(LF_RAW);
  if (raw.size === 0) {
    // Sin raws (o error leyendo): podría ser FS temporalmente inaccesible.
    return { deleted: 0, orphans: [] };
  }
  const dirs = [
    LF_TRANSCRIPTS, LF_CUTS, LF_PROPOSALS, LF_CLIPS,
    LF_RENDERS, LF_CLEAN, LF_PROJECTS_DIR, LF_GRAPHICS, LF_FACE_TRACKS,
  ];
  const orphanIds = new Set<string>();
  const candidates: string[] = [];
  for (const dir of dirs) {
    const files = await listSafe(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      // Los DIRECTORIOS son organización del usuario (ej. renders/Publicados): jamás se tocan.
      try {
        if ((await fs.stat(full)).isDirectory()) continue;
      } catch {
        continue;
      }
      const owner = longFormOwner(f);
      if (!owner || raw.has(owner)) continue;
      orphanIds.add(owner);
      candidates.push(full);
    }
  }
  await writeOrphanReport("long_form", candidates);
  if (candidates.length > 0) {
    console.log(
      `[orphan-sweep] ${candidates.length} huérfano(s) de largos DETECTADOS (no se borra nada) — ver orphan-report.json`,
    );
  }
  return { deleted: 0, orphans: [...orphanIds] };
}

/**
 * DETECTA (no borra) derivados de SHORTS cuyo raw ya no existe y los reporta en
 * orphan-report.json. `deleted` es SIEMPRE 0 — mismo invariante que largos: los
 * renders/proyectos son el PRODUCTO del usuario y solo él los borra a mano.
 */
export async function sweepShortOrphans(): Promise<{ deleted: number; orphans: string[] }> {
  const raw = await rawStems(RAW_DIR);
  if (raw.size === 0) return { deleted: 0, orphans: [] };

  // owner por prefijo: el raw stem `s` tal que id === s o id empieza con `${s}_`
  // (los ids de proyecto/render son `{videoStem}_{styleId}`).
  const ownerByPrefix = (id: string): string | null => {
    if (raw.has(id)) return id;
    for (const s of raw) if (id === s || id.startsWith(`${s}_`)) return s;
    return null;
  };

  const orphanOwners = new Set<string>();
  const candidates: string[] = [];
  const flag = async (dir: string, f: string) => {
    const full = path.join(dir, f);
    try {
      if ((await fs.stat(full)).isDirectory()) return; // carpetas del usuario: jamás
    } catch {
      return;
    }
    candidates.push(full);
  };

  // projects/*.json → huérfano si su videoId (o, si falta, el owner por prefijo) no existe.
  for (const f of await listSafe(PROJECTS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const id = path.basename(f, ".json");
    let videoId: string | undefined;
    try {
      videoId = JSON.parse(await fs.readFile(path.join(PROJECTS_DIR, f), "utf-8"))?.videoId;
    } catch {
      /* JSON ilegible → tratar por prefijo */
    }
    const owner = videoId || ownerByPrefix(id);
    if (owner && raw.has(owner)) continue;
    orphanOwners.add(owner || id);
    await flag(PROJECTS_DIR, f);
  }

  // renders de naming de máquina `{videoStem}_{styleId}` sin raw → solo se REPORTAN.
  for (const f of await listSafe(RENDERS_DIR)) {
    const id = path.basename(f, path.extname(f));
    if (!MACHINE_RENDER.test(id)) continue;
    if (ownerByPrefix(id)) continue;
    orphanOwners.add(id);
    await flag(RENDERS_DIR, f);
  }

  // transcripts/ y cuts/ → keyed por videoId exacto (stem).
  for (const dir of [TRANSCRIPTS_DIR, CUTS_DIR]) {
    for (const f of await listSafe(dir)) {
      const stem = path.basename(f, path.extname(f));
      if (raw.has(stem)) continue;
      await flag(dir, f);
    }
  }

  await writeOrphanReport("short", candidates);
  if (candidates.length > 0) {
    console.log(
      `[orphan-sweep] ${candidates.length} huérfano(s) de shorts DETECTADOS (no se borra nada) — ver orphan-report.json`,
    );
  }
  return { deleted: 0, orphans: [...orphanOwners] };
}

/**
 * F0.5 — Limpieza de ARTEFACTOS de render (no huérfanos, sino basura del proceso):
 *   - SIEMPRE: temporales `__rendering.mp4`, intermedios `_raw.mp4`/`_nolut.mp4` y
 *     locks `.__lock` con más de 24h (un render real nunca dura tanto).
 *   - Los renders FINALES no se tocan JAMÁS (la retención opt-in por días se RETIRÓ
 *     tras el incidente 2026-07-03: ningún proceso borra videos del usuario).
 * Cada borrado queda auditado en `{DATA_ROOT}/disk-audit.log`.
 */
export async function sweepStaleArtifacts(): Promise<{ deleted: number }> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const auditLines: string[] = [];
  let deleted = 0;

  const rmAudited = async (dir: string, f: string, reason: string) => {
    try {
      await fs.rm(path.join(dir, f), { force: true });
      deleted++;
      auditLines.push(`[${new Date().toISOString()}] DELETE ${path.join(dir, f)} (${reason})`);
    } catch {
      /* best-effort */
    }
  };

  for (const dir of [RENDERS_DIR, LF_RENDERS]) {
    for (const f of await listSafe(dir)) {
      let ageMs: number;
      try {
        ageMs = Date.now() - (await fs.stat(path.join(dir, f))).mtimeMs;
      } catch {
        continue;
      }
      const isArtifact =
        f.includes(".__rendering.") || f.endsWith(".__lock") ||
        f.endsWith("_raw.mp4") || f.endsWith("_nolut.mp4");
      if (isArtifact && ageMs > DAY_MS) {
        await rmAudited(dir, f, "artefacto de render >24h");
      }
    }
  }

  // Vistas previas de estilos (F4): caché barata — se regeneran al click. >7 días fuera.
  const previewsDir = path.join(path.dirname(RENDERS_DIR), "previews");
  for (const f of await listSafe(previewsDir)) {
    try {
      const ageMs = Date.now() - (await fs.stat(path.join(previewsDir, f))).mtimeMs;
      if (ageMs > 7 * DAY_MS) await rmAudited(previewsDir, f, "preview >7d");
    } catch {
      /* best-effort */
    }
  }

  if (auditLines.length > 0) {
    const auditFile = path.join(path.dirname(RENDERS_DIR), "disk-audit.log");
    await fs.appendFile(auditFile, auditLines.join("\n") + "\n", "utf-8").catch(() => {});
    console.log(`[artifact-sweep] borrados ${deleted} artefacto(s) — ver disk-audit.log`);
  }
  return { deleted };
}

// Throttle en globalThis (sobrevive a hot-reload; se resetea al reiniciar el server,
// que de todas formas dispara un sweep de boot).
const g = globalThis as unknown as { __lastOrphanSweep?: number };

/** Dispara el sweep a lo sumo cada 12h, sin bloquear al caller. */
export function maybeSweepOrphans(): void {
  const now = Date.now();
  if (g.__lastOrphanSweep && now - g.__lastOrphanSweep < SWEEP_INTERVAL_MS) return;
  g.__lastOrphanSweep = now;
  // fire-and-forget: no bloqueamos la respuesta del listado. Barre largos Y shorts.
  void sweepLongFormOrphans().catch((e) =>
    console.warn(`[orphan-sweep] largos falló: ${e instanceof Error ? e.message : e}`),
  );
  void sweepShortOrphans().catch((e) =>
    console.warn(`[orphan-sweep] shorts falló: ${e instanceof Error ? e.message : e}`),
  );
  void sweepStaleArtifacts().catch((e) =>
    console.warn(`[artifact-sweep] falló: ${e instanceof Error ? e.message : e}`),
  );
  // Locks de render huérfanos (PID muerto) de una sesión anterior.
  void import("@/lib/render-utils").then((m) => m.sweepOrphanLocks()).catch(() => {});
}
