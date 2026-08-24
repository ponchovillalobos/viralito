/**
 * Helpers PUROS extraídos de `auto-build/route.ts` para que sean reusables y testeables.
 * Todos sin side-effects (no I/O, no spawn), tipados estrictamente.
 *
 * - `pickTopKeywords(words, count)` — elige `count` keywords distribuidas a lo largo
 *   del transcript, filtrando stopwords y palabras cortas.
 * - `sanitizeForFilename(s)` — quita caracteres ilegales en Windows y colapsa espacios.
 * - `normForFreq(w)` — normaliza para agrupar/contar (sin acentos, lowercase).
 * - `titleCaseWord(w)` — capitaliza la primera letra.
 * - `generateContentTitle(words)` — título corto (1-2 palabras) por frecuencia.
 */

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  score?: number;
  /** Emoji que el LLM propuso para esta palabra (ver `pick_keywords.py`). Sólo
   *  viene en las keywords elegidas por modelo; la transcripción cruda no lo
   *  trae y la heurística de respaldo tampoco. */
  emoji?: string;
}

const TITLE_STOPWORDS = new Set([
  "porque", "cuando", "donde", "nuestro", "nuestra", "nuestros", "nuestras", "tambien",
  "hacia", "sobre", "entre", "durante", "hasta", "desde", "para", "pero", "como", "esto",
  "esta", "este", "estos", "estas", "una", "unos", "unas", "con", "sin", "del", "sus",
  "mas", "muy", "los", "las", "que", "todo", "todos", "toda", "todas", "cada", "tiene",
  "tienen", "puede", "pueden", "vamos", "aqui", "asi", "ahora", "bien", "solo", "cosa",
  "cosas", "hace", "dice", "decir", "gente", "entonces", "siempre", "nunca", "porqué",
]);

const PICK_TOP_STOPWORDS_RE =
  /^(porque|cuando|donde|nuestro|nuestra|nuestros|nuestras|también|tambien|hacia|sobre|entre|durante|hasta|desde)$/i;

// Palabras del HABLA que pasan el filtro de largo pero son pésimos stickers
// gigantes en pantalla ("ENTONCES", "TENEMOS"): verbos/conectores genéricos sin
// contenido. El sticker debe ser una palabra con significado propio.
const GENERIC_SPEECH_WORDS = new Set([
  "entonces", "digamos", "verdad", "ustedes", "nosotros", "vosotros", "ellos",
  "tenemos", "estamos", "podemos", "vamos", "hacemos", "sabemos", "queremos",
  "quiero", "quieres", "quieren", "puedo", "puedes", "pueden", "hacer", "tener",
  "estar", "haber", "decir", "diciendo", "haciendo", "teniendo", "mucho",
  "mucha", "muchos", "muchas", "ahorita", "luego", "claro", "bueno", "buenas",
  "buenos", "demás", "demas", "manera", "forma", "parte", "partes", "ejemplo",
  "realmente", "simplemente", "solamente", "justamente", "obviamente",
]);

export function pickTopKeywords(words: TranscriptWord[], count = 7): TranscriptWord[] {
  const filtered = words.filter((w) => {
    const clean = w.word.replace(/[^\wáéíóúñÁÉÍÓÚÑ]/g, "");
    const norm = normForFreq(clean);
    return (
      clean.length >= 5 &&
      !PICK_TOP_STOPWORDS_RE.test(clean) &&
      !TITLE_STOPWORDS.has(norm) &&
      !GENERIC_SPEECH_WORDS.has(norm)
    );
  });
  if (filtered.length <= count) return filtered;
  const slice = filtered.length / count;
  const picks: TranscriptWord[] = [];
  for (let i = 0; i < count; i++) picks.push(filtered[Math.floor(i * slice)]);
  return picks;
}

/**
 * Quita acentos para comparar/agrupar; CONSERVA ñ.
 *
 * Bug arreglado: antes NFD descomponía ñ en "n + ̃" y el strip de combining marks
 * la convertía en "n", así que "año" terminaba como "ano". Ahora ñ se sustituye por
 * un placeholder antes del NFD y se restaura después — preserva la identidad real.
 */
export function normForFreq(w: string): string {
  return w
    .toLowerCase()
    .replace(/ñ/g, "") // placeholder fuera del alfabeto latino
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(//g, "ñ")
    .replace(/[^a-z0-9ñ]/gi, "");
}

export function titleCaseWord(w: string): string {
  return w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
}

/** Quita caracteres ilegales en nombres de archivo (Windows) y colapsa espacios. */
export function sanitizeForFilename(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Genera un título corto (1-2 palabras de contenido) por frecuencia de palabras
 * significativas (sin stopwords, ≥5 letras), conservando acentos para que se lea bien.
 * Para que el archivo de salida sea identificable a la vista.
 */
export function generateContentTitle(words: TranscriptWord[]): string {
  const freq = new Map<string, { count: number; display: string }>();
  for (const w of words) {
    const norm = normForFreq(w.word);
    if (norm.length < 5) continue;
    if (TITLE_STOPWORDS.has(norm)) continue;
    const display = w.word.replace(/[^\p{L}\p{N}ñÑ]/gu, "");
    if (!display) continue;
    const e = freq.get(norm) ?? { count: 0, display };
    e.count++;
    freq.set(norm, e);
  }
  const top = [...freq.values()].sort((a, b) => b.count - a.count).slice(0, 2);
  return top.map((t) => titleCaseWord(t.display)).join(" ").trim();
}
