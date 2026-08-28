/**
 * De dónde salen las imágenes de apoyo (B-roll), en UN solo lugar.
 *
 * Esta lista vivía escrita a mano dentro del asistente de shorts, y el de largos
 * ni siquiera ofrecía la opción: fijaba Pexels de punta a punta — interfaz, API y
 * pipeline — así que pedir GIFs o fotos era imposible aunque el buscador supiera
 * hacerlo.
 *
 * Al llevarla a los dos asistentes lo obvio era copiarla, y copiarla es
 * exactamente el error que este proyecto ya pagó caro: los dos asistentes tenían
 * su propia copia del catálogo de estilos, las copias derivaron, y dos estilos
 * completos quedaron sin puerta de entrada durante meses. Una sola definición no
 * puede desincronizarse.
 *
 * Los ids son los que acepta `autoMatchBroll` (ver `BrollSource` en `pexels.ts`).
 */
import type { BrollSource } from "@/lib/pexels";

/** Estilos que usan imágenes de apoyo — el mismo conjunto que `_BROLL_STYLES` en el pipeline de Python. */
/**
 * Estilos que TRAEN material de archivo por su cuenta. Es su rasgo definitorio:
 * elegir `editorial_broll` es pedir "editorial + videos que ilustren lo que digo".
 */
export const BROLL_STYLE_IDS = ["broll_full", "broll_pip", "editorial_broll"] as const;

/**
 * Estilos que PUEDEN mostrar material de archivo, aunque no lo busquen solos.
 *
 * El composition dibuja B-roll para cualquier estilo con `editorialLayout` —son
 * cuatro: `editorial`, `editorial_full`, `editorial_broll` y `paper_cut`— y
 * también para los de pantalla completa y PIP. Pero el selector de fuentes sólo
 * aparecía en los tres de arriba, así que en `editorial`, `editorial_full` y
 * `paper_cut` la capacidad existía y **no había forma de encenderla**: el video
 * salía sin material y nada explicaba por qué.
 *
 * Lo reportó el usuario, no un test: «el estilo editorial no tiene la
 * posibilidad de elegir inserción de videos... el wizard no permite al usuario
 * saber ni desde la elección del estilo».
 *
 * En estos tres, elegir una fuente es una decisión explícita: con "Automático"
 * siguen sin material, igual que siempre.
 */
export const BROLL_CAPABLE_STYLE_IDS = [
  ...BROLL_STYLE_IDS,
  "editorial",
  "editorial_full",
  "paper_cut",
] as const;

export const BROLL_SOURCES: readonly {
  id: BrollSource;
  name: string;
  hint: string;
  emoji: string;
}[] = [
  { id: "auto", name: "Automático", hint: "El sistema elige por vos según el estilo", emoji: "✨" },
  { id: "pexels_video", name: "Videos", hint: "Clips reales de Pexels, con movimiento", emoji: "🎬" },
  { id: "pexels_photo", name: "Fotos", hint: "Imágenes fijas de Pexels, más sobrio", emoji: "🖼️" },
  { id: "giphy", name: "GIFs", hint: "Giphy en MP4: divertido, muy corto", emoji: "🕺" },
  { id: "cc0", name: "Mi biblioteca", hint: "Sólo lo que ya está descargado", emoji: "📁" },
] as const;

/**
 * Estilos que dibujan ADORNOS encima del video: ilustraciones, iconos animados
 * o gráficas de datos.
 *
 * Sale del registro (`illustrations` / `hasGraphics`), no de una lista escrita a
 * mano: es la sexta lista de "qué estilos hacen X" que aparece en este
 * proyecto, y las cinco anteriores se habían separado entre sí.
 */
export const ADORNO_STYLE_IDS = [
  "hype", "hype_max", "hype_max_sfx", "supreme",
  "graphics_pro", "graphics_max",
  "motion_pro", "motion_beat", "motion_grid",
  "editorial", "editorial_full", "editorial_broll",
  "lottie_pop", "paper_cut",
] as const;

/**
 * Estilos a los que se les puede elegir el TEMA editorial (serif + fondo).
 *
 * `applyWizardOverrides` lo aplica a cualquier proyecto con `editorialLayout`,
 * y son cuatro. Pero cada wizard tenía su propia lista y se habían separado:
 *
 *     cortos  ["editorial", "editorial_broll"]
 *     largos  ["editorial", "editorial_broll", "editorial_full"]
 *
 * O sea que "Editorial a pantalla completa" mostraba el selector de tema en
 * largos y no en cortos, y `paper_cut` —que también reusa `editorialLayout`— no
 * lo mostraba en ninguno. La capacidad existía; la puerta, no.
 *
 * (Este archivo se llama `broll-sources` por su primer contenido, pero ya es el
 * módulo de CAPACIDADES POR ESTILO: es donde viven las cuatro listas que antes
 * andaban duplicadas por los wizards y el backend.)
 */
export const EDITORIAL_THEME_STYLE_IDS = [
  "editorial",
  "editorial_full",
  "editorial_broll",
  "paper_cut",
] as const;
