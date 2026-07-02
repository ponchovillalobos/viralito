/**
 * Auto B-roll desde Pexels en función de la transcripción.
 *
 * Elige keywords "visuales" del transcript (filtra stopwords/cortas), las busca en
 * Pexels Videos y devuelve clips temporizados listos para `project.bRoll`. Lo usa
 * auto-build para los estilos `broll_full` (fullscreen) y `broll_pip` (pequeñito).
 *
 * Server-only (usa PEXELS_API_KEY). Cadena de fuentes:
 *   - Con PEXELS_API_KEY → busca en Pexels (clips de alta calidad).
 *   - Sin key (o si Pexels devuelve pocos) → cae a CC0 sin key (Internet Archive
 *     video + Openverse fotos) vía `broll-cc0.ts`. Así una PC limpia SIN key ya
 *     no sale con b-roll vacío. Si todo falla, devuelve [] (no rompe el render).
 */

const PEXELS_API = "https://api.pexels.com";
// User-Agent de navegador: Pexels (tras Cloudflare) rechaza clientes sin UA con 403.
const PEXELS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface BrollClip {
  start: number;
  end: number;
  url: string;
  thumbnail?: string;
}

interface Keyword {
  word: string;
  start: number;
  end: number;
}

interface PexelsVideoFile {
  link?: string;
  file_type?: string;
  width?: number;
  height?: number;
  quality?: string;
}

// Stopwords ES frecuentes — no sirven como búsqueda visual.
const ES_STOPWORDS = new Set([
  "que", "como", "para", "pero", "esto", "esta", "este", "estos", "estas", "los", "las",
  "una", "unos", "unas", "con", "por", "sin", "del", "sus", "mas", "muy", "ya", "les",
  "nos", "sea", "son", "fue", "han", "hay", "eso", "esa", "ese", "esos", "esas", "tu",
  "mi", "te", "se", "de", "la", "el", "en", "lo", "le", "su", "al", "un", "si", "no",
  "me", "ti", "entonces", "porque", "cuando", "tambien", "todo", "todos", "toda", "todas",
  "cada", "ser", "estar", "tiene", "tienen", "hacer", "puede", "pueden", "vamos", "aqui",
  "asi", "ahora", "bien", "solo", "cosa", "cosas", "hace", "dice", "decir", "gente",
]);

/** Quita acentos/puntuación y baja a minúsculas. */
function cleanWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/gi, "")
    .trim();
}

// ─── RELEVANCIA (feedback del usuario: "pone videos nada que ver con lo que se dice") ───
// El matcher buscaba en Pexels con UNA palabra suelta EN ESPAÑOL ("seguimiento",
// "clientes") → resultados pobres/aleatorios: el catálogo de Pexels está etiquetado
// en INGLÉS y una palabra sin contexto trae stock genérico. Ahora:
//   1. La IA LOCAL (Ollama) convierte la FRASE (keyword + ±3.5s de contexto) en un
//      término de búsqueda EN INGLÉS de 2-3 palabras, concreto y FILMABLE.
//   2. Sin Ollama (o si tarda >8s), cae a un diccionario ES→EN de conceptos
//      frecuentes; y si tampoco, a la palabra tal cual (comportamiento anterior).
// La búsqueda de b-roll ya es online por definición (Pexels); el render sigue offline.

const OLLAMA_URL = process.env.VIRAL_OLLAMA_URL ?? "http://localhost:11434";

/** Diccionario ES→EN de conceptos frecuentes → término de stock VISUAL. */
const VISUAL_ES_EN: Record<string, string> = {
  dinero: "money cash counting", ventas: "sales handshake deal", vender: "salesman talking client",
  cliente: "customer meeting office", clientes: "customers business meeting",
  equipo: "team working office", empresa: "modern office building", negocio: "small business owner",
  trabajo: "person working laptop", exito: "success celebration office", meta: "goal target dartboard",
  metas: "goals planning notebook", crecer: "growth chart rising", crecimiento: "business growth chart",
  atencion: "eye close up focus", tiempo: "clock time lapse", reunion: "business meeting table",
  llamada: "phone call business", telefono: "smartphone hands typing", correo: "email laptop typing",
  redes: "social media phone scrolling", marca: "brand designer studio", precio: "price tag store",
  producto: "product packaging hands", servicio: "customer service smiling", estrategia: "chess strategy board",
  idea: "lightbulb idea creative", ideas: "brainstorming sticky notes", miedo: "anxious person dark",
  estres: "stressed person desk", energia: "energetic morning run", habito: "morning routine journal",
  habitos: "daily routine planner", aprender: "student studying books", libro: "reading book coffee",
  cerebro: "brain neurons animation", mente: "meditation calm person", pregunta: "question mark thinking",
  respuesta: "aha moment realization", conversacion: "two people talking cafe", historia: "storytelling campfire",
  familia: "family together home", casa: "cozy home interior", ciudad: "city timelapse aerial",
  mundo: "earth globe rotating", futuro: "futuristic technology city", tecnologia: "technology circuit close up",
  inteligencia: "artificial intelligence robot", computadora: "laptop keyboard typing",
  comida: "delicious food closeup", cafe: "coffee pouring cup", agua: "water splash slow motion",
  deporte: "athlete training gym", salud: "healthy lifestyle jogging", doctor: "doctor hospital consult",
  viaje: "travel airport suitcase", camino: "road trip highway", montaña: "mountain landscape aerial",
  mar: "ocean waves aerial", corazon: "heart shape hands", amor: "couple holding hands sunset",
  amigo: "friends laughing together", amigos: "friends group hangout", musica: "concert crowd lights",
  celular: "person scrolling phone", video: "video editing screen", camara: "camera lens closeup",
  contenido: "content creator filming", audiencia: "audience clapping event", seguidores: "social media likes",
  millones: "stack of money bills", banco: "bank building finance", deuda: "empty wallet worried",
  ahorro: "piggy bank coins", inversion: "stock market screen", oportunidad: "open door light",
  problema: "person frustrated desk", solucion: "puzzle piece fitting", error: "mistake crossed paper",
  riesgo: "tightrope walker risk", confianza: "handshake trust closeup", liderazgo: "leader speaking team",
  jefe: "boss office executive", empleado: "employee working desk", oficina: "modern office interior",
};

/** Frase de contexto (±windowSec) alrededor del pick, para darle sentido a la búsqueda. */
function contextPhrase(pick: Keyword, all: Keyword[], windowSec = 3.5): string {
  return all
    .filter((w) => Math.abs(w.start - pick.start) <= windowSec)
    .map((w) => w.word)
    .join(" ")
    .slice(0, 220);
}

/** Sanitiza la respuesta del LLM a un término de búsqueda corto en inglés. */
function sanitizeQuery(raw: string): string | null {
  const q = raw
    .replace(/["'`.,;:!?()\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!q || !/^[a-z0-9 -]+$/.test(q)) return null;
  const words = q.split(" ").filter(Boolean).slice(0, 4);
  if (words.length === 0) return null;
  return words.join(" ");
}

/** Ollama local → término de búsqueda visual EN INGLÉS para la frase. Null si falla. */
async function llmVisualQuery(phrase: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: process.env.VIRAL_OLLAMA_MODEL ?? "qwen3:4b",
        prompt:
          "You pick stock footage search terms. For this Spanish phrase, give an English " +
          "search query of 2-3 words describing something CONCRETE and FILMABLE (an object, " +
          `action or scene — never abstract words). Phrase: "${phrase}". ` +
          'Reply ONLY this JSON: {"query": "..."}',
        stream: false,
        // format json + think:false: sin ambos, qwen3 (thinking) vuelca su razonamiento
        // en `response` en vez del término (verificado en pruebas).
        format: "json",
        think: false,
        options: { temperature: 0.3, num_ctx: 1024, num_predict: 32 },
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    try {
      const parsed = JSON.parse(data.response ?? "{}") as { query?: string };
      return sanitizeQuery(String(parsed.query ?? ""));
    } catch {
      return sanitizeQuery(data.response ?? "");
    }
  } catch {
    return null;
  }
}

/** Query visual final para un pick: LLM local → diccionario ES→EN → palabra tal cual. */
async function buildVisualQuery(pick: Keyword, all: Keyword[]): Promise<string> {
  const word = cleanWord(pick.word);
  const phrase = contextPhrase(pick, all);
  const fromLlm = phrase ? await llmVisualQuery(phrase) : null;
  if (fromLlm) return fromLlm;
  return VISUAL_ES_EN[word] ?? word;
}

/** Elige `count` keywords visuales repartidas a lo largo del video. */
function selectVisualKeywords(keywords: Keyword[], count: number): Keyword[] {
  const seen = new Set<string>();
  const candidates = keywords.filter((k) => {
    const norm = cleanWord(k.word);
    if (norm.length < 4) return false;
    if (ES_STOPWORDS.has(norm)) return false;
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
  if (candidates.length <= count) return candidates;
  const step = candidates.length / count;
  const picks: Keyword[] = [];
  for (let i = 0; i < count; i++) picks.push(candidates[Math.floor(i * step)]);
  return picks;
}

/** Elige un mp4 razonable (portrait, altura <= 1920) del set de Pexels. */
function pickVideoFile(files: PexelsVideoFile[] | undefined): PexelsVideoFile | null {
  if (!Array.isArray(files)) return null;
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.link);
  if (mp4.length === 0) return null;
  const sorted = mp4.slice().sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return sorted.find((f) => (f.height ?? 0) <= 1920) ?? sorted[sorted.length - 1];
}

/** Evita que los clips se pisen: empuja el inicio tras el final del anterior. */
function dedupeOverlaps(clips: BrollClip[]): BrollClip[] {
  const out: BrollClip[] = [];
  let lastEnd = -1;
  for (const c of clips) {
    let start = c.start;
    if (start < lastEnd) start = lastEnd;
    const end = Math.max(start + 0.5, c.end);
    if (start >= end) continue;
    out.push({ ...c, start: +start.toFixed(2), end: +end.toFixed(2) });
    lastEnd = end;
  }
  return out;
}

/**
 * Busca clips de Pexels para las keywords del transcript y los devuelve temporizados.
 * `count` clips, cada uno de `clipDur` segundos arrancando en el timestamp de su keyword.
 */
export async function autoMatchBroll(
  keywords: Keyword[],
  duration: number,
  opts: { count?: number; clipDur?: number; orientation?: "portrait" | "landscape" } = {}
): Promise<BrollClip[]> {
  const count = opts.count ?? 5;
  const clipDur = opts.clipDur ?? 3;
  const orientation = opts.orientation ?? "portrait";

  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    // Sin key: NO devolvemos vacío. Usamos la fuente CC0 sin key (IA + Openverse).
    console.warn("[pexels] sin PEXELS_API_KEY → fallback b-roll CC0 (Internet Archive + Openverse)");
    const { autoMatchBrollCC0 } = await import("./broll-cc0");
    return autoMatchBrollCC0(keywords, duration, { count, clipDur });
  }

  const picks = selectVisualKeywords(keywords, count);

  const clips: BrollClip[] = [];
  for (const kw of picks) {
    // Query VISUAL en inglés (IA local con contexto de la frase → diccionario →
    // palabra tal cual). Ver bloque RELEVANCIA arriba.
    const q = await buildVisualQuery(kw, keywords);
    if (!q) continue;
    try {
      const res = await fetch(
        `${PEXELS_API}/videos/search?query=${encodeURIComponent(q)}&per_page=3&orientation=${orientation}`,
        // Pexels está detrás de Cloudflare: un cliente sin User-Agent de navegador
        // recibe 403 (error 1010, "browser integrity check"). Mandamos un UA real.
        { headers: { Authorization: key, "User-Agent": PEXELS_UA } }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { videos?: Array<{ video_files?: PexelsVideoFile[]; image?: string }> };
      const video = data.videos?.[0];
      if (!video) continue;
      const file = pickVideoFile(video.video_files);
      if (!file?.link) continue;
      clips.push({
        start: +kw.start.toFixed(2),
        end: +Math.min(kw.start + clipDur, duration).toFixed(2),
        url: file.link,
        thumbnail: video.image,
      });
    } catch {
      // saltear esta keyword
    }
  }
  // Si Pexels nos dio MENOS de la mitad de lo pedido (rate limit, keywords sin
  // match, etc.), rellenamos con CC0 sin key para no quedarnos cortos.
  if (clips.length < Math.ceil(count / 2)) {
    try {
      const { autoMatchBrollCC0 } = await import("./broll-cc0");
      const cc0 = await autoMatchBrollCC0(keywords, duration, {
        count: count - clips.length,
        clipDur,
      });
      // Evita duplicar timestamps que Pexels ya cubrió.
      const used = new Set(clips.map((c) => Math.round(c.start)));
      for (const c of cc0) {
        if (!used.has(Math.round(c.start))) clips.push(c);
      }
    } catch {
      // si CC0 falla, nos quedamos con lo de Pexels.
    }
  }

  clips.sort((a, b) => a.start - b.start);
  return dedupeOverlaps(clips);
}
