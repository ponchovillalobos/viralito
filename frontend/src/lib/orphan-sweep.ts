/**
 * Limpieza de huérfanos: cuando el usuario BORRA un video de la carpeta, sus
 * metadatos derivados (transcripts, clips, renders, proposals, projects, graphics…)
 * quedan colgados. Este módulo:
 *   1. `videoBackingExists()` — usado por los endpoints de listado para NO mostrar
 *      entradas cuyo video ya no existe (desaparición instantánea al borrar el raw).
 *   2. `sweepLongFormOrphans()` — borra del disco los derivados de largos cuyo raw
 *      ya no existe. Best-effort, conservador (no borra si no pudo leer LF_RAW).
 *   3. `maybeSweepOrphans()` — dispara el sweep a lo sumo ~2x/día (throttle 12h),
 *      llamado perezosamente desde los listados + una vez al boot.
 *
 * Diseño conservador: el auto-borrado solo toca LARGOS (naming limpio `{id}_cNN_…`).
 * Los shorts solo se FILTRAN del listado (no se auto-borran del disco) por seguridad.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
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

/**
 * Borra los derivados de LARGOS cuyo raw ya no existe. Conservador: si LF_RAW no
 * se pudo leer (set vacío), NO borra nada (evita nukear todo por un error de FS).
 */
export async function sweepLongFormOrphans(): Promise<{ deleted: number; orphans: string[] }> {
  const raw = await rawStems(LF_RAW);
  if (raw.size === 0) {
    // Sin raws (o error leyendo): no borrar. Podría ser FS temporalmente inaccesible.
    return { deleted: 0, orphans: [] };
  }
  const dirs = [
    LF_TRANSCRIPTS, LF_CUTS, LF_PROPOSALS, LF_CLIPS,
    LF_RENDERS, LF_CLEAN, LF_PROJECTS_DIR, LF_GRAPHICS, LF_FACE_TRACKS,
  ];
  const orphanIds = new Set<string>();
  let deleted = 0;
  for (const dir of dirs) {
    const files = await listSafe(dir);
    for (const f of files) {
      const owner = longFormOwner(f);
      if (!owner || raw.has(owner)) continue;
      orphanIds.add(owner);
      try {
        await fs.rm(path.join(dir, f), { force: true });
        deleted++;
      } catch {
        /* best-effort */
      }
    }
  }
  if (deleted > 0) {
    console.log(
      `[orphan-sweep] borrados ${deleted} derivados de ${orphanIds.size} video(s) eliminado(s): ${[...orphanIds].join(", ")}`,
    );
  }
  return { deleted, orphans: [...orphanIds] };
}

/**
 * Borra los derivados de SHORTS cuyo video raw fuente ya no existe: project JSONs,
 * renders, transcripts y cuts. Conservador igual que el de largos: si RAW_DIR no se
 * pudo leer (set vacío) NO borra nada. La lógica de "huérfano" espeja EXACTAMENTE la
 * del filtro de Producción (buildBackingChecker): lo que se oculta es lo que se borra,
 * y nada visible se toca.
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
  let deleted = 0;
  const del = async (dir: string, f: string) => {
    try {
      await fs.rm(path.join(dir, f), { force: true });
      deleted++;
    } catch {
      /* best-effort */
    }
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
    await del(PROJECTS_DIR, f);
  }

  // renders/* → huérfano si ningún raw es prefijo del id del render, PERO sólo se
  // auto-borran los de naming de máquina `{videoStem}_{styleId}`. Los renders ya
  // publicados se renombran a título legible ("Empatía Ambos Editorial.mp4") y no
  // tienen prefijo de raw — esos NUNCA se tocan (sólo el usuario los borra a mano).
  for (const f of await listSafe(RENDERS_DIR)) {
    const id = path.basename(f, path.extname(f));
    if (!MACHINE_RENDER.test(id)) continue;
    if (ownerByPrefix(id)) continue;
    orphanOwners.add(id);
    await del(RENDERS_DIR, f);
  }

  // transcripts/ y cuts/ → keyed por videoId exacto (stem). Huérfano si no está en raw.
  for (const dir of [TRANSCRIPTS_DIR, CUTS_DIR]) {
    for (const f of await listSafe(dir)) {
      const stem = path.basename(f, path.extname(f));
      if (raw.has(stem)) continue;
      await del(dir, f);
    }
  }

  if (deleted > 0) {
    console.log(
      `[orphan-sweep] shorts: borrados ${deleted} derivados de video(s) eliminado(s): ${[...orphanOwners].join(", ")}`,
    );
  }
  return { deleted, orphans: [...orphanOwners] };
}

/**
 * F0.5 — Limpieza de ARTEFACTOS de render (no huérfanos, sino basura del proceso):
 *   - SIEMPRE: temporales `__rendering.mp4`, intermedios `_raw.mp4`/`_nolut.mp4` y
 *     locks `.__lock` con más de 24h (un render real nunca dura tanto).
 *   - OPT-IN (env `VIRAL_RENDER_RETENTION_DAYS=N`): renders finales con más de N días.
 *     Por default NO se borran renders finales — el user puede tener renders viejos
 *     que aún quiere publicar. Activar sólo si el disco preocupa.
 * Cada borrado queda auditado en `{DATA_ROOT}/disk-audit.log`.
 */
export async function sweepStaleArtifacts(): Promise<{ deleted: number }> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const retentionDays = Number(process.env.VIRAL_RENDER_RETENTION_DAYS);
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
        continue;
      }
      if (
        Number.isFinite(retentionDays) && retentionDays >= 1 &&
        f.endsWith(".mp4") && !isArtifact && ageMs > retentionDays * DAY_MS
      ) {
        await rmAudited(dir, f, `retención ${retentionDays}d`);
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
