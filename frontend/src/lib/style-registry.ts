/**
 * Registro central de estilos (Phase 0 — light refactor).
 *
 * UNA sola fuente de verdad para la METADATA de cada estilo + el tipo `StyleId`.
 * Antes esto vivía duplicado en >=5 archivos (style-templates.ts, job-store.ts,
 * helpers.ts, los dos wizards, Python); agregar un estilo obligaba a tocar todos
 * y "se me olvidó un lugar" era un bug silencioso. Ahora la metadata vive en
 * `style-registry.data.json` y todo se deriva de aquí, de modo que un id faltante
 * se vuelve un error de tsc.
 *
 * Importante sobre el tipo: el import de JSON da `string` (no un union de
 * literales), así que el union de `StyleId` DEBE venir de la tupla `as const`
 * `STYLE_IDS` de abajo. El test `style-registry.test.ts` ancla que esa tupla y
 * el JSON listen exactamente los mismos ids (anti-drift).
 *
 * Alcance light: NO incluye ordenamiento ni "surfaces" del wizard — esas arrays
 * siguen manuales en cada wizard por ahora.
 */

import data from "./style-registry.data.json";

/** Familias de estilo (membresía en los submenús del wizard de shorts). */
export type StyleFamily = "motion" | "hype" | "music";

export interface StyleRegistryEntry {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  shortLabel: string;
  families: StyleFamily[];
  longForm: boolean;
  hasGraphics: boolean;
  /**
   * Phase 4 — opt-in a las ilustraciones CC0 (personas/escenas multicolor).
   * Cuando true, auto-build corre applyIllustrations para ese estilo. Ausente/
   * false → el estilo NO recibe ilustraciones (render idéntico al histórico).
   */
  illustrations?: boolean;
}

/**
 * Tupla `as const` con TODOS los ids (superset = los que existen en STYLE_INFO).
 * Es la ÚNICA fuente del union literal `StyleId`. Debe mantenerse en sync con el
 * JSON; el test lo verifica. El orden replica el de STYLE_INFO / el JSON.
 */
export const STYLE_IDS = [
  "silent",
  "punch",
  "hype",
  "hype_max",
  "hype_max_sfx",
  "supreme",
  "cinematic_pro",
  "broll_full",
  "broll_pip",
  "text_behind",
  "pop_reels",
  "graphics_pro",
  "motion_pro",
  "motion_beat",
  "motion_grid",
  "editorial",
  "editorial_full",
  "editorial_broll",
  "graphics_max",
  "kinetic_type",
  "lottie_pop",
  "paper_cut",
  "cine_clasico",
  "vhs",
  "audiogram",
] as const;

export type StyleId = (typeof STYLE_IDS)[number];

/** Vista tipada del JSON, indexada por id. */
export const STYLE_REGISTRY = data as readonly StyleRegistryEntry[];

/** Mapa id → entrada, para lookup O(1) por los helpers derivados. */
const BY_ID = new Map<string, StyleRegistryEntry>(
  STYLE_REGISTRY.map((e) => [e.id, e])
);

/**
 * Derivado: STYLE_INFO (name/tagline/emoji por id). Reemplaza el literal que
 * vivía a mano en style-templates.ts — mismos valores, una sola fuente.
 */
export const STYLE_INFO_FROM_REGISTRY = Object.fromEntries(
  STYLE_IDS.map((id) => {
    const e = BY_ID.get(id)!;
    return [id, { name: e.name, tagline: e.tagline, emoji: e.emoji }];
  })
) as Record<StyleId, { name: string; tagline: string; emoji: string }>;

/**
 * Derivado: STYLE_SHORT_LABEL (etiqueta corta por id). Reemplaza el literal que
 * vivía a mano en auto-build/lib/helpers.ts.
 */
export const STYLE_SHORT_LABEL_FROM_REGISTRY = Object.fromEntries(
  STYLE_IDS.map((id) => [id, BY_ID.get(id)!.shortLabel])
) as Record<StyleId, string>;

/**
 * Phase 4 — derivado: ¿este estilo opta por ilustraciones CC0? Gating del
 * enriquecedor applyIllustrations, SIN tocar los style builders ni la paridad.
 * Solo los estilos con "illustrations": true en el JSON quedan en true.
 */
export const STYLE_HAS_ILLUSTRATIONS = Object.fromEntries(
  STYLE_IDS.map((id) => [id, BY_ID.get(id)!.illustrations === true])
) as Record<StyleId, boolean>;

/** Helper O(1): ¿el estilo `id` recibe ilustraciones CC0 (Phase 4)? */
export function styleHasIllustrations(id: StyleId): boolean {
  return STYLE_HAS_ILLUSTRATIONS[id] === true;
}
