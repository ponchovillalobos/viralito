/**
 * Build props.json para un clip del long_form.
 *
 * Diferencias con build-props.mjs:
 *  - Lee transcript desde long_form/transcripts/
 *  - Lee proyecto desde long_form/projects/
 *  - rawVideoUrl apunta a /api/long_form/stream?file=<clip>&source=clip
 *  - No aplica jump cuts (el clip ya viene del video CLEAN sin silencios)
 *
 * Uso:
 *   node build-clip-props.mjs <clip_id> [style_id] [out_file]
 *   - out_file (opcional): nombre del props file de salida (default "props.json").
 *     Lo usa el render PARALELO de largos: cada worker escribe su propio
 *     props_{clipId}_{styleId}.json para no pisarse entre sí.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEditorialCardIcons, resolveIconStickerSvg } from "./editorial-icons.mjs";
import { needsTrialWatermark } from "./license-check.mjs";
import { applyHookTemplate } from "./hook-templates.mjs";
import { localizeBrollClips } from "./broll-localize.mjs";
import { styleHasIllustrations } from "./style-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { existsSync as _existsSync } from "node:fs";
function pickDataRoot() {
  const o = process.env.VIRAL_DATA_ROOT;
  if (o) return o;
  for (const c of ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"]) {
    if (_existsSync(c)) return c;
  }
  return "C:\\viral-data\\videos";
}
const DATA_ROOT = pickDataRoot();
const LF = path.join(DATA_ROOT, "long_form");
const HOST = process.env.VIRAL_API_HOST ?? "http://localhost:3000";

const clipId = process.argv[2];
const styleId = process.argv[3] || null; // opcional — si falta intenta legacy {clipId}.json
const outName = process.argv[4] || "props.json"; // opcional — props file único (render paralelo)
if (!clipId) {
  console.error("Uso: node build-clip-props.mjs <clip_id> [style_id]");
  console.error("  style_id opcional. Si se pasa, lee {clipId}_{style_id}.json");
  console.error("  Si se omite, fallback orden: {clipId}.json → {clipId}_supreme.json");
  process.exit(1);
}

// Resolver path del project — soportar 3 layouts:
//   1. styleId explícito → {clipId}_{styleId}.json
//   2. legacy sin sufijo → {clipId}.json (compat con renders viejos)
//   3. fallback default → {clipId}_supreme.json
function resolveProjectPath() {
  if (styleId) {
    return path.join(LF, "projects", `${clipId}_${styleId}.json`);
  }
  const legacy = path.join(LF, "projects", `${clipId}.json`);
  if (_existsSync(legacy)) return legacy;
  return path.join(LF, "projects", `${clipId}_supreme.json`);
}

const projectPath = resolveProjectPath();
const transcriptPath = path.join(LF, "transcripts", `${clipId}.json`);

const project = JSON.parse(readFileSync(projectPath, "utf-8"));
const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));

const words = (transcript.words || []).map((w) => ({
  word: w.word,
  start: w.start,
  end: w.end,
}));

const sfxMarks = (project.sfxMarks || []).map((m) => ({
  at: m.at,
  sound: m.sound,
  volume: m.volume ?? 0.4,
  url: `${HOST}/api/sfx/stream?file=${encodeURIComponent(m.sound)}`,
}));

// Subtítulos: si el estilo trae manualSubtitles, respetarlos; si no, los del transcript.
const subtitles =
  project.manualSubtitles && project.manualSubtitles.length > 0
    ? project.manualSubtitles
    : words;

// B-roll local (defensa: los largos hoy no usan b-roll, pero si un proyecto trae
// clips con URL remota los bajamos a disco igual que en los shorts — cache compartido).
const bRollLocal = await localizeBrollClips(project.bRoll || [], { dataRoot: DATA_ROOT, host: HOST });

const props = {
  rawVideoUrl: `${HOST}/api/long_form/stream?file=${encodeURIComponent(clipId)}&source=clip`,
  videoDurationSec: +transcript.duration.toFixed(3),
  words: subtitles,
  bRoll: bRollLocal.map((c) => ({ start: c.start, end: c.end, url: c.url })),
  // musicTrack: NOMBRE de archivo o URL "/api/music/stream?..." (pickRandomMusicTrack).
  // Antes se re-envolvía siempre → URL doble-encodeada → render roto con música.
  musicUrl: (() => {
    const t = project.musicTrack;
    if (!t) return null;
    if (/^https?:\/\//.test(t)) return t;
    if (t.startsWith("/api/")) return `${HOST}${t}`;
    return `${HOST}/api/music/stream?file=${encodeURIComponent(t)}`;
  })(),
  musicVolume: project.musicVolume ?? Number(process.env.VIRAL_MUSIC_VOLUME ?? 0.35),
  // F1 — Director emocional: curva de ducking de la música (pass-through; los clips
  // de largos no hacen jump cuts, no hay remap).
  musicVolumeCurve: project.musicVolumeCurve || [],
  // F3 — Partículas procedurales (pass-through).
  particleBursts: project.particleBursts || [],
  // MOTION PRO — fondo animado (pass-through).
  animatedBackground: project.animatedBackground ?? null,
  // EDITORIAL — layout split-screen + tarjetas (pass-through; el merge desde el
  // graphics file pasa más abajo junto con dataViz/íconos).
  editorialLayout: project.editorialLayout ?? null,
  editorialCards: project.editorialCards || [],
  subtitleStyle: project.subtitleStyle ?? "anton",
  subtitleColor: project.subtitleColor ?? "#ffffff",
  subtitleHighlight: project.subtitleHighlight ?? "#34d399",
  subtitleFont: project.subtitleFont ?? "auto",
  // F2 — subtítulos fuera de la cara: "top" si el tracking detectó la cara abajo.
  subtitlePosition: project.subtitlePosition ?? "bottom",
  animations: project.animations || [],
  emphasisCards: project.emphasisCards || [],
  bRollMode: project.bRollMode ?? "pip",
  zoomMarks: project.zoomMarks || [],
  wordStickers: project.wordStickers || [],
  floatingEmojis: project.floatingEmojis || [],
  colorRotation: project.colorRotation || [],
  vignette: project.vignette ?? true,
  reactionZooms: project.reactionZooms || [],
  stutterMarks: project.stutterMarks || [],
  captionBounce: project.captionBounce ?? true,
  sfxMarks,
  // Dimensiones del composition. Default 1080×1920 (vertical 9:16).
  width: project.width ?? 1080,
  height: project.height ?? 1920,
  // ─── Paridad con build-props.mjs (shorts): FX que el estilo genera vía
  //     buildProjectForStyle pero que ANTES se descartaban en el render de largos.
  //     Los clips de largos NO hacen jump-cut (vienen del CLEAN sin silencios), así
  //     que no hay remap de timestamps — es pass-through directo. Defaults vacíos/none
  //     = render idéntico para un proyecto que no traiga el campo. ───
  sceneFx: project.sceneFx || [],
  proTransitions: project.proTransitions || [],
  kineticPreset: project.kineticPreset ?? "none",
  mirrorFx: project.mirrorFx || [],
  trackPath: project.trackPath || [],
  trackedItems: project.trackedItems || [],
  iconStickers: project.iconStickers || [],
  speedRamps: project.speedRamps || [],
  lottieStickers: project.lottieStickers || [],
  // PRO — transiciones oficiales de Remotion + ilustraciones CC0 (duotono opcional)
  // + overlay de textura. Pass-through (los clips no remapean). Defaults = idéntico.
  proTransitionSeries: project.proTransitionSeries || [],
  // AUDIOGRAMA (F2.a) — config del estilo 'audiogram' (null = sin onda). Pass-through.
  audiogram: project.audiogram ?? null,
  // LENS FX (F2.d) — halación + aberración cromática (null = sin FX). Pass-through.
  lensFx: project.lensFx ?? null,
  // CALLOUTS (F2.c) — statPops + lower-thirds. Pass-through (los clips no remapean).
  statPops: project.statPops || [],
  lowerThirds: project.lowerThirds || [],
  illustrationStickers: project.illustrationStickers || [],
  overlayTexture: project.overlayTexture ?? null,
  // TEXTO DETRÁS DEL SUJETO (matte estático, paridad con shorts). SOLO se activa con
  // modo matte explícito (matteFile/matteUrl/useMatte) y sin foregroundVideoId (bake
  // legacy). El matte se sirve por /api/cutouts/stream. null = sin efecto.
  textBehind: (() => {
    const tb = project.textBehind;
    if (!tb || !tb.phrase) return null;
    const matteMode = tb.matteFile || tb.matteUrl || tb.useMatte;
    if (!matteMode || project.foregroundVideoId) return null;
    const matteUrl = tb.matteUrl
      ? tb.matteUrl
      : tb.matteFile
        ? `${HOST}/api/cutouts/stream?file=${encodeURIComponent(tb.matteFile)}`
        : "";
    return {
      phrase: tb.phrase,
      matteUrl,
      color: tb.color ? (tb.color.startsWith("#") ? tb.color : `#${tb.color}`) : "#ffffff",
      ...(tb.size ? { size: tb.size } : {}),
      at: tb.at ?? 0,
      duration: tb.duration ?? 0,
      position: tb.position ?? "center",
      shadow: tb.shadow ?? true,
      outline: tb.outline ?? false,
      outlineColor: tb.outlineColor ?? "#000000",
      textOpacity: tb.textOpacity ?? 1,
    };
  })(),
  endScreen: project.endScreen ?? null,
  progressBar: project.progressBar ?? false,
  brandKit: project.brandKit ?? null,
  cameraMoves: Array.isArray(project.cameraMoves) ? project.cameraMoves : [],
  filmGrain: project.filmGrain ?? false,
  // VHS — overlay camcorder analógico (estilo "vhs"). Boolean puro.
  vhsLook: project.vhsLook ?? false,
  cinematicDensity: project.cinematicDensity ?? "medium",
  // Voz IA (largos no la cablea aún → null = sin voz). Pass-through por si un futuro
  // estilo/flag la setea en el project.
  voiceoverUrl: project.voiceoverUrl ?? null,
  voiceoverVolume: project.voiceoverVolume ?? 0.7,
  voiceoverStartSec: project.voiceoverStartSec ?? 0,
  // autoReframe sólo se activa si hay trackPath real (lo llena el pipeline con
  // track_subject.py sobre el clip). Sin puntos, reframear no tiene a qué seguir →
  // lo dejamos en false para no introducir un crop errático.
  autoReframe: Boolean(project.autoReframe) && (project.trackPath || []).length > 0,
  sourceAspect: project.sourceAspect ?? 16 / 9,
  // Modo Gráficos & Motion: charts + titulares poderosos. El project puede traerlos,
  // o el generador los deja en long_form/graphics/{clipId}.json (auto desde el transcript).
  dataViz: project.dataViz || [],
  kineticHeadlines: project.kineticHeadlines || [],
};

// Si existe un spec de gráficos generado por generate_graphics.py, lo mergeamos.
// (Sólo existe cuando el usuario eligió "Modo Gráficos" → si no, esto no hace nada.)
const graphicsPath = path.join(LF, "graphics", `${clipId}.json`);
if (_existsSync(graphicsPath)) {
  try {
    const g = JSON.parse(readFileSync(graphicsPath, "utf-8"));
    if (Array.isArray(g.dataViz) && g.dataViz.length) props.dataViz = g.dataViz;
    if (Array.isArray(g.kineticHeadlines) && g.kineticHeadlines.length) {
      props.kineticHeadlines = g.kineticHeadlines;
    }
    // Íconos de concepto (visuales) generados desde el transcript — se suman a los del estilo.
    if (Array.isArray(g.iconStickers) && g.iconStickers.length) {
      props.iconStickers = [...(props.iconStickers || []), ...g.iconStickers];
    }
    // ILUSTRACIONES CC0 (personas/escenas multicolor): SOLO para estilos con
    // illustrations:true en el registro (editorial*/lottie_pop). El graphics-file las
    // trae para el clip; el gate por estilo evita que un estilo NO-ilustración las
    // reciba (paridad con shorts, donde applyIllustrations gatea por styleHasIllustrations).
    if (
      styleId &&
      styleHasIllustrations(styleId) &&
      Array.isArray(g.illustrationStickers) &&
      g.illustrationStickers.length
    ) {
      props.illustrationStickers = [
        ...(props.illustrationStickers || []),
        ...g.illustrationStickers,
      ];
    }
    // EDITORIAL: tarjetas tipográficas (solo se usan si el estilo es editorial; en
    // ese caso reemplazan charts/íconos para no saturar el lado oscuro).
    // resolveEditorialCardIcons embebe el SVG de iconos "ph:"/"tb:" (Ola 4).
    if (props.editorialLayout && Array.isArray(g.editorialCards)) {
      props.editorialCards = resolveEditorialCardIcons(g.editorialCards);
      // Ola 5: máx 3 charts curados — el render editorial los dibuja con el
      // look del tema (hairline/sketchy) y oculta las tarjetas mientras duran.
      props.dataViz = Array.isArray(g.dataViz) ? g.dataViz.slice(0, 3) : [];
      // Ola 7: globo al lugar mencionado (pass-through, los clips no remapean).
      if (g.editorialMap) props.editorialMap = g.editorialMap;
      props.iconStickers = [];
      // Coreografía del panel dinámico.
      if (Array.isArray(g.editorialScenes)) {
        props.editorialLayout = { ...props.editorialLayout, scenes: g.editorialScenes };
      }
    }
    console.error(
      `[graphics] mergeado ${props.dataViz.length} charts · ${(props.iconStickers || []).length} íconos`,
    );
  } catch (e) {
    console.error(`[graphics] no pude leer ${graphicsPath}: ${e.message}`);
  }
}

// Galería de stickers: embebe el SVG de los iconos "ph:"/"tb:" (paridad con shorts).
props.iconStickers = resolveIconStickerSvg(props.iconStickers || []);

// PLANTILLA DE HOOK (opt-in, paridad con shorts) — titular + sticker + whoosh + zoom
// en los primeros ~2.5s del clip. ADITIVO: sin hookTemplate/hook = no-op.
const hookId = project.hookTemplate ?? project.hook ?? null;
Object.assign(
  props,
  applyHookTemplate(props, hookId, (sound) =>
    `${HOST}/api/sfx/stream?file=${encodeURIComponent(sound)}`
  )
);

// PRUEBA GRATUITA — sin licencia activada, el clip sale con marca de agua.
// (ver license-check.mjs: nunca rompe el build; en duda, sin marca.)
if (needsTrialWatermark()) props.trialWatermark = true;

const outFile = path.join(__dirname, path.basename(outName));
writeFileSync(outFile, JSON.stringify(props, null, 2), "utf-8");
console.log(
  `OK ${clipId} · subs:${props.words.length} · stickers:${props.wordStickers.length} · emphasis:${props.emphasisCards.length} · emojis:${props.floatingEmojis.length} · sfx:${props.sfxMarks.length} · duration:${props.videoDurationSec}s`
);
