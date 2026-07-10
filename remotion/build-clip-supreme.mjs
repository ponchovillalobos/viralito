/**
 * Genera un proyecto JSON con el estilo elegido para un clip de long_form.
 *
 * Input:
 *   - long_form/transcripts/{clip_id}.json   (sub-transcript con timestamps [0, duration])
 *   - long_form/proposals/{video_id}.json    (proposal con hook/theme/keywords/caption del clip)
 *
 * Output:
 *   - long_form/projects/{clip_id}_{style_id}.json   (ej: ..._supreme.json, ..._hype_max.json)
 *
 * Uso:
 *   node build-clip-supreme.mjs <video_id> <clip_index> [style_id] [accent_color]
 *
 *   - style_id default = "supreme"  (5 estilos válidos del editor + supreme)
 *   - accent_color default = paleta rotativa por clipIndex (compat con comportamiento viejo)
 *
 * Nota: nombre legacy del script "build-clip-supreme". Ahora soporta cualquier estilo,
 * delega a remotion/style-templates.mjs (port JS de frontend/src/lib/style-templates.ts).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProjectForStyle } from "./style-templates.mjs";
import { needsTrialWatermark } from "./license-check.mjs";
import { VALID_STYLE_IDS } from "./style-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pickDataRoot() {
  const o = process.env.VIRAL_DATA_ROOT;
  if (o) return o;
  for (const c of ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"]) {
    if (existsSync(c)) return c;
  }
  return "C:\\viral-data\\videos";
}

const DATA_ROOT = pickDataRoot();
const LF = path.join(DATA_ROOT, "long_form");

// ─── Argumentos ────────────────────────────────────────────────────────────

const videoId = process.argv[2];
const clipIndex = parseInt(process.argv[3], 10);
const styleId = process.argv[4] || "supreme";
// accent puede llegar vacío "" desde pipeline.py si no se pasó — usar fallback
const accentColorOverride = (process.argv[5] && process.argv[5].trim()) || null;
const aspectRatio = process.argv[6] || "9:16";
// Fuente + color de TEXTO de subtítulos del wizard de largos ("" o "auto" = del estilo).
const subtitleFontOverride =
  process.argv[7] && process.argv[7].trim() && process.argv[7].trim() !== "auto"
    ? process.argv[7].trim()
    : null;
const subtitleColorOverride =
  process.argv[8] && process.argv[8].trim() && process.argv[8].trim() !== "auto"
    ? process.argv[8].trim()
    : null;
// Tema editorial "font:background" (ej. "playfair:dark"). Solo aplica al estilo editorial.
const editorialThemeArg = (process.argv[9] && process.argv[9].trim()) || null;
// Factor 0..1 de volumen de música del slider del wizard (multiplica el del estilo).
// "" / ausente = sin override → se respeta el musicVolume del estilo.
const musicVolumeFactor =
  process.argv[10] && process.argv[10].trim() !== "" && Number.isFinite(parseFloat(process.argv[10]))
    ? Math.max(0, Math.min(1, parseFloat(process.argv[10])))
    : null;

if (!videoId || !clipIndex) {
  console.error("Uso: node build-clip-supreme.mjs <video_id> <clip_index> [style_id] [accent_color] [aspect_ratio]");
  console.error("  style_id default = 'supreme'");
  console.error("  accent_color default = paleta rotativa por clipIndex");
  console.error("  aspect_ratio default = '9:16' (también soportado: '16:9')");
  process.exit(1);
}

// Convertir aspect ratio a dimensiones
const { width: aspectWidth, height: aspectHeight } =
  aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };

// VALID_STYLE_IDS se DERIVA del registro (style-catalog.mjs), la única fuente de
// verdad. Antes vivía hardcodeado acá y se DESINCRONIZABA: faltaban vhs, audiogram,
// cinematic_pro, kinetic_type, lottie_pop, paper_cut, cine_clasico → esos estilos
// (todos longForm:true, ofrecidos en el wizard) hard-failaban y NO renderizaban en
// largos. buildProjectForStyle ya maneja TODOS los estilos del registro.
if (!VALID_STYLE_IDS.has(styleId)) {
  console.error(`style_id inválido '${styleId}'. Válidos: ${[...VALID_STYLE_IDS].join(", ")}`);
  process.exit(1);
}

// ─── Cargar proposal + transcript ─────────────────────────────────────────

const proposalPath = path.join(LF, "proposals", `${videoId}.json`);
const proposal = JSON.parse(readFileSync(proposalPath, "utf-8"));
const clipMeta = proposal.clips[clipIndex - 1];
if (!clipMeta) {
  console.error(`Clip ${clipIndex} no existe en proposals (hay ${proposal.clips.length})`);
  process.exit(1);
}

const slug = clipMeta.slug || `clip-${String(clipIndex).padStart(2, "0")}`;
const clipId = `${videoId}_c${String(clipIndex).padStart(2, "0")}_${slug}`;
const transcriptPath = path.join(LF, "transcripts", `${clipId}.json`);
const outPath = path.join(LF, "projects", `${clipId}_${styleId}.json`);

const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
const duration = transcript.duration;
const words = transcript.words || [];

// ─── Paleta rotativa (fallback si no se pasa accent explícito) ────────────

const PALETTE_FALLBACK = ["#fb7185", "#a78bfa", "#fbbf24", "#34d399", "#22d3ee", "#ec4899", "#fb923c"];
const accent = accentColorOverride || PALETTE_FALLBACK[(clipIndex - 1) % PALETTE_FALLBACK.length];

// ─── Resolver keywords con timestamps ──────────────────────────────────────
// El proposal trae keywords como strings sin timestamps. Buscamos cada una en el transcript
// del clip y construimos el shape {word, start, end} que espera buildProjectForStyle.

function findKeywordTimestamp(keyword) {
  const lower = String(keyword).toLowerCase();
  for (const w of words) {
    if (w.word.toLowerCase().replace(/[.,;:!?]/g, "").includes(lower)) {
      return { start: w.start, end: w.end ?? w.start + 0.5 };
    }
  }
  return null;
}

const rawKeywords = Array.isArray(clipMeta.keywords) ? clipMeta.keywords : [];
const resolvedKeywords = [];
for (const kw of rawKeywords.slice(0, 8)) {
  const ts = findKeywordTimestamp(kw);
  if (ts && ts.start > 0.5 && ts.start < duration - 2) {
    resolvedKeywords.push({ word: String(kw), start: ts.start, end: ts.end });
  }
}

// Si Ollama dio pocas keywords reconocibles, completar con las primeras palabras "interesantes"
// del transcript (>4 chars, no stopwords) para que el estilo tenga contenido suficiente.
if (resolvedKeywords.length < 4) {
  // Paridad con pickTopKeywords de shorts: también se excluyen verbos/conectores
  // genéricos del habla que quedan horribles como sticker gigante ("ENTONCES").
  const STOPWORDS = new Set([
    "porque", "cuando", "donde", "nuestro", "nuestra", "también", "tambien", "hacia", "sobre",
    "entre", "durante", "hasta", "desde", "para", "este", "esta", "estos", "estas",
    "entonces", "digamos", "verdad", "ustedes", "nosotros", "tenemos", "estamos", "podemos",
    "vamos", "hacemos", "sabemos", "queremos", "quiero", "quieren", "puedo", "pueden",
    "hacer", "tener", "decir", "mucho", "muchos", "ahorita", "luego", "claro", "bueno",
    "manera", "forma", "parte", "ejemplo", "realmente", "simplemente", "solamente",
  ]);
  for (const w of words) {
    if (resolvedKeywords.length >= 6) break;
    const clean = w.word.toLowerCase().replace(/[^\wáéíóúñ]/g, "");
    if (clean.length >= 5 && !STOPWORDS.has(clean) && w.start > 0.5 && w.start < duration - 2) {
      if (!resolvedKeywords.some((rk) => rk.word.toLowerCase() === clean)) {
        resolvedKeywords.push({ word: w.word, start: w.start, end: w.end ?? w.start + 0.5 });
      }
    }
  }
}

// ─── Construir contexto y delegar al template ─────────────────────────────

const ctx = {
  videoId: clipId, // usar clipId como videoId para que stickers tengan seed único por clip
  duration,
  keywords: resolvedKeywords,
  accentColor: accent,
  hookOverride: clipMeta.hook,
  themeOverride: clipMeta.theme,
  width: aspectWidth,
  height: aspectHeight,
  // Caption: usar el del proposal con hashtags
  caption: (() => {
    const captionText = clipMeta.caption || clipMeta.hook || clipMeta.theme || "";
    const tags = clipMeta.hashtags && clipMeta.hashtags.length > 0
      ? clipMeta.hashtags.join(" ")
      : "#ventasconia #ventasb2b #neuroventas #chatgpt #ventas";
    return `${captionText}\n\n${tags}`.trim();
  })(),
};

const project = buildProjectForStyle(ctx, styleId);

// Overrides del wizard de largos: fuente y color del TEXTO de subtítulos.
// Se aplican DESPUÉS de buildProjectForStyle para ganarle al default del estilo.
if (subtitleFontOverride) project.subtitleFont = subtitleFontOverride;
if (subtitleColorOverride) project.subtitleColor = subtitleColorOverride;
// Tema editorial elegido en el wizard de largos: pisa font/background del layout.
// Tercer segmento = SUB-TEMA de clase mundial ("prensa", "riso"… — Ola 3).
if (editorialThemeArg && project.editorialLayout) {
  const [themeFont, themeBg, subTheme] = editorialThemeArg.split(":");
  if (themeFont) project.editorialLayout.font = themeFont;
  if (themeBg) project.editorialLayout.background = themeBg;
  if (subTheme) project.editorialLayout.theme = subTheme;
}

// Volumen de música del wizard: factor multiplicador sobre el del estilo (preserva
// el tuning por estilo y deja BAJARLO para que no tape el audio original). El ducking
// (musicVolumeCurve, director emocional) sigue operando sobre este nuevo base.
if (musicVolumeFactor != null && typeof project.musicVolume === "number") {
  project.musicVolume = +(project.musicVolume * musicVolumeFactor).toFixed(4);
}

// PRUEBA GRATUITA — marcar el project si no hay licencia activada. El props
// builder (build-clip-props.mjs) re-chequea la licencia al armar props.json,
// así que esto es redundancia deliberada (belt & braces); nunca rompe el build.
if (needsTrialWatermark()) project.trialWatermark = true;

writeFileSync(outPath, JSON.stringify(project, null, 2), "utf-8");
console.log(
  `OK ${clipId}_${styleId} · stickers:${(project.wordStickers || []).length} · emojis:${(project.floatingEmojis || []).length} · emphasis:${(project.emphasisCards || []).length} · sfx:${(project.sfxMarks || []).length} · duration:${duration}s · accent:${accent}`
);
