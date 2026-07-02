/**
 * Nombre corto y consistente para CUALQUIER video (corto/largo/estilo). En vez del id feo
 * (`Vid 20260323 135543_c09_..._editorial`), un nombre humano y localizable de un vistazo:
 *   [score de viralidad] · título de 2-3 palabras · estilo
 * El score y el hook salen de los proposals (long_form). El título corto se deriva del slug.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { LF_ROOT } from "@/lib/paths";

const STOP = new Set(
  "de la el en un una y a que se es su tu los las por con para no del al lo mas mi me te su sus".split(
    " ",
  ),
);
const NUM: Record<string, string> = {
  cero: "0", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6",
  siete: "7", ocho: "8", nueve: "9", diez: "10", once: "11", doce: "12",
};

/** Título corto (2-3 palabras significativas) desde el id/slug del video. Pure (cliente + server). */
export function shortTitle(idOrSlug: string): string {
  // quitar prefijo base y sufijos de clip/estilo comunes para quedarse con el slug del contenido
  const s = contentSlugFromId(idOrSlug);
  const words = s
    .split(/[-_\s]+/)
    .map((w) => w.toLowerCase())
    .map((w) => NUM[w] ?? w)
    .filter((w) => w && !STOP.has(w))
    .slice(0, 3);
  if (!words.length) return idOrSlug;
  const title = words.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

const STYLES = [
  "editorial_full", "editorial_broll", "editorial", "supreme", "hype_max_sfx", "hype_max", "hype",
  "silent", "punch", "cinematic_pro", "broll_full", "broll_pip", "text_behind", "pop_reels",
  "graphics_pro", "graphics_max", "motion_pro", "motion_beat", "motion_grid", "kinetic_type",
  "lottie_pop", "paper_cut", "cine_clasico",
];

/** Estilo/diseño del video, sacado del sufijo del id (ej. "..._editorial" → "editorial"). Pure. */
export function styleFromId(id: string): string | null {
  const low = id.toLowerCase();
  for (const s of STYLES) {
    if (low.endsWith(`_${s}`)) return s;
  }
  return null;
}

/** Etiqueta de display final: "[78] Atencion 8 segundos · editorial". Pure. */
export function videoLabel(opts: { score?: number | null; title: string; style?: string | null }): string {
  const parts: string[] = [];
  if (typeof opts.score === "number" && opts.score > 0) parts.push(`${Math.round(opts.score)}`);
  parts.push(opts.title);
  if (opts.style) parts.push(opts.style);
  return parts.join(" · ");
}

export interface ClipScore {
  slug: string;
  score: number;
  hook: string;
}

// Caché por archivo (mtime): /api/projects llama loadClipScores en CADA request y los
// proposals casi nunca cambian → re-parsear solo los archivos modificados.
const proposalCache = new Map<string, { mtimeMs: number; clips: ClipScore[] }>();

/** Lee los proposals y devuelve un mapa slug → {score, hook}. Server-only. */
export async function loadClipScores(): Promise<Map<string, ClipScore>> {
  const propDir = path.join(LF_ROOT, "proposals");
  const map = new Map<string, ClipScore>();
  let files: string[] = [];
  try {
    files = (await fs.readdir(propDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return map;
  }
  const perFile = await Promise.all(
    files.map(async (f): Promise<ClipScore[]> => {
      const fp = path.join(propDir, f);
      try {
        const stat = await fs.stat(fp);
        const cached = proposalCache.get(fp);
        if (cached && cached.mtimeMs === stat.mtimeMs) return cached.clips;
        const d = JSON.parse(await fs.readFile(fp, "utf-8"));
        const arr: unknown[] = d.clips ?? d.proposals ?? (Array.isArray(d) ? d : []);
        const clips: ClipScore[] = [];
        for (const c of arr) {
          if (!c || typeof c !== "object") continue;
          const o = c as Record<string, unknown>;
          const slug = typeof o.slug === "string" ? o.slug : "";
          if (!slug) continue;
          const score = typeof o.viralityScore === "number" ? o.viralityScore : 0;
          clips.push({ slug, score, hook: typeof o.hook === "string" ? o.hook : "" });
        }
        proposalCache.set(fp, { mtimeMs: stat.mtimeMs, clips });
        return clips;
      } catch {
        return [];
      }
    }),
  );
  for (const clips of perFile) {
    for (const cs of clips) {
      const prev = map.get(cs.slug);
      if (!prev || cs.score > prev.score) map.set(cs.slug, cs);
    }
  }
  return map;
}

const normKey = (s: string) => s.replace(/[-_\s]/g, "").toLowerCase();

/** Slug del contenido dentro de un id de video: saca el prefijo "base_c09_" y el sufijo de estilo. */
export function contentSlugFromId(id: string): string {
  return id
    .replace(/^.*?_c\d+_/i, "")
    .replace(
      /_(editorial(_full|_broll)?|supreme|hype(_max)?(_sfx)?|silent|punch|cinematic_pro|broll_(full|pip)|text_behind|pop_reels|graphics_(pro|max)|motion_(pro|beat|grid)|kinetic_type|lottie_pop|paper_cut|cine_clasico)$/i,
      "",
    );
}

// Índice slug-normalizado por mapa (WeakMap: se invalida solo cuando el mapa se recrea).
// Convierte el match de O(proyectos × clips) a O(1) por proyecto en el caso común.
const slugIndexCache = new WeakMap<Map<string, ClipScore>, Map<string, ClipScore>>();

function slugIndex(map: Map<string, ClipScore>): Map<string, ClipScore> {
  let idx = slugIndexCache.get(map);
  if (idx) return idx;
  idx = new Map();
  for (const cs of map.values()) {
    const key = normKey(cs.slug);
    const prev = idx.get(key);
    if (!prev || cs.score > prev.score) idx.set(key, cs);
  }
  slugIndexCache.set(map, idx);
  return idx;
}

/** Para un id de video, encuentra el mejor clip (por slug contenido en el id). Server-only. */
export function matchClipScore(id: string, map: Map<string, ClipScore>): ClipScore | null {
  // Camino rápido: extraer el slug del id → lookup directo en el índice.
  const direct = slugIndex(map).get(normKey(contentSlugFromId(id)));
  if (direct) return direct;
  // Fallback (ids con otro formato): scan por substring como antes.
  const nid = normKey(id);
  let best: ClipScore | null = null;
  for (const cs of map.values()) {
    if (cs.slug && nid.includes(normKey(cs.slug))) {
      if (!best || cs.score > best.score) best = cs;
    }
  }
  return best;
}
