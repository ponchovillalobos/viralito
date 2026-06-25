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
    const q = cleanWord(kw.word);
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
