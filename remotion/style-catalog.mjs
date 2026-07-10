/**
 * style-catalog.mjs — catálogo de estilos leído del registro compartido
 * (frontend/src/lib/style-registry.data.json), la ÚNICA fuente de verdad.
 *
 * Por qué existe: los builders de largos (build-clip-supreme.mjs, build-clip-props.mjs)
 * y el pipeline (long_form_pipeline.py) tenían CADA UNO su propia lista hardcodeada de
 * "estilos válidos" / "estilos con gráficos" / "estilos con ilustraciones", y se
 * DESINCRONIZABAN del registro. Consecuencias reales:
 *   - build-clip-supreme rechazaba vhs/audiogram/cinematic_pro/kinetic_type/lottie_pop/
 *     paper_cut/cine_clasico → esos estilos hard-failaban y NO renderizaban en largos.
 *   - los estilos editoriales salían sin ilustraciones CC0.
 * Ahora todo se DERIVA del registro. Fallback si el JSON no se puede leer (paquete sin
 * frontend/, etc.) — nunca rompe el build.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(
  __dirname, "..", "frontend", "src", "lib", "style-registry.data.json"
);

// Fallback (solo si el registro no se puede leer). DEBE listar TODOS los estilos.
const FALLBACK_VALID = [
  "silent", "punch", "hype", "hype_max", "hype_max_sfx", "supreme", "cinematic_pro",
  "broll_full", "broll_pip", "text_behind", "pop_reels", "graphics_pro", "graphics_max",
  "motion_pro", "motion_beat", "motion_grid", "editorial", "editorial_full",
  "editorial_broll", "kinetic_type", "lottie_pop", "paper_cut", "cine_clasico",
  "vhs", "audiogram",
];
const FALLBACK_ILLUSTRATIONS = [
  "editorial", "editorial_full", "editorial_broll", "lottie_pop", "paper_cut",
];

function _loadRegistry() {
  try {
    const entries = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    if (Array.isArray(entries) && entries.length) return entries;
  } catch {
    // registro ausente/ilegible → fallback
  }
  return null;
}

const _entries = _loadRegistry();

/** Todos los ids de estilo válidos (rechaza typos, nunca estilos reales del registro). */
export const VALID_STYLE_IDS = new Set(
  _entries ? _entries.map((e) => e.id).filter(Boolean) : FALLBACK_VALID
);

/** Estilos con illustrations:true → reciben ilustraciones CC0 (editorial/lottie_pop). */
export const ILLUSTRATION_STYLE_IDS = new Set(
  _entries
    ? _entries.filter((e) => e.illustrations === true).map((e) => e.id)
    : FALLBACK_ILLUSTRATIONS
);

/** ¿el estilo recibe ilustraciones CC0? */
export function styleHasIllustrations(id) {
  return ILLUSTRATION_STYLE_IDS.has(id);
}
