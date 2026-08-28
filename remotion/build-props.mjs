import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEditorialCardIcons, resolveIconStickerSvg } from "./editorial-icons.mjs";
import { needsTrialWatermark } from "./license-check.mjs";
import { applyHookTemplate } from "./hook-templates.mjs";
import { localizeBrollClips } from "./broll-localize.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VIDEO_ID = process.argv[2] || "D01_test_01";
const PROJECT_OVERRIDE = process.argv[3];
// 4to arg opcional: nombre del props file de salida (default "props.json").
// Lo usan los previews/render paralelo para no pisar el props.json de otro render.
const OUT_NAME = process.argv[4] || "props.json";
import { existsSync as _existsSync } from "node:fs";
import { pickDataRoot } from "./data-root.mjs";
const DATA_ROOT = pickDataRoot();
const HOST = process.env.VIRAL_API_HOST ?? "http://localhost:3000";

const projectPath = PROJECT_OVERRIDE
  ? PROJECT_OVERRIDE
  : path.join(DATA_ROOT, "projects", `${VIDEO_ID}.json`);
const project = JSON.parse(readFileSync(projectPath, "utf-8"));
const transcript = JSON.parse(
  readFileSync(path.join(DATA_ROOT, "transcripts", `${VIDEO_ID}.json`), "utf-8")
);

// Limpiar transcript (join "cha" + "GPT")
const words = [];
let i = 0;
while (i < transcript.words.length) {
  const w = transcript.words[i];
  const next = transcript.words[i + 1];
  if (
    next &&
    /^(cha|chat)$/i.test(w.word) &&
    /^GPT$/i.test(next.word.replace(/[.,]/g, ""))
  ) {
    words.push({ word: "ChatGPT", start: w.start, end: next.end });
    i += 2;
    continue;
  }
  words.push({ word: w.word, start: w.start, end: w.end });
  i += 1;
}

// Jump cuts: si está habilitado y existe _cut.mp4, remapear timestamps
let useCutVideo = false;
let segments = null;
let totalDuration = transcript.duration;
let videoIdForUrl = VIDEO_ID;

if (project.enableJumpCuts) {
  const cutVideoPath = path.join(DATA_ROOT, "raw", `${VIDEO_ID}_cut.mp4`);
  const cutsJsonPath = path.join(DATA_ROOT, "cuts", `${VIDEO_ID}.json`);
  if (existsSync(cutVideoPath) && existsSync(cutsJsonPath)) {
    const cuts = JSON.parse(readFileSync(cutsJsonPath, "utf-8"));
    segments = cuts.keep_segments;
    totalDuration = segments.reduce((acc, s) => acc + (s.end - s.start), 0);
    useCutVideo = true;
    videoIdForUrl = `${VIDEO_ID}_cut`;
    console.log(
      `[jump cuts] aplicado: ${segments.length} segmentos · ${transcript.duration.toFixed(2)}s → ${totalDuration.toFixed(2)}s`
    );
  } else {
    console.log("[jump cuts] enableJumpCuts=true pero falta _cut.mp4 o cuts JSON — ignorando");
  }
}

// Quitar fondo IA: si auto-build generó el compuesto ({videoId}_fg.mp4 en raw),
// usarlo como video base. Solo cuando NO hay jump cuts (los estilos removeBg no cortan).
if (project.foregroundVideoId && !useCutVideo) {
  videoIdForUrl = project.foregroundVideoId;
  console.log(`[quitar fondo] usando compuesto: ${videoIdForUrl}`);
}

function remapTime(t) {
  if (!segments) return t;
  let offset = 0;
  for (const seg of segments) {
    if (t < seg.start) return null; // en un silencio anterior
    if (t <= seg.end) return +(offset + (t - seg.start)).toFixed(3);
    offset += seg.end - seg.start;
  }
  return null; // después del último segmento
}

function remapItem(item, fields) {
  const out = { ...item };
  for (const f of fields) {
    if (typeof item[f] === "number") {
      const r = remapTime(item[f]);
      if (r === null) return null;
      out[f] = r;
    }
  }
  return out;
}

function filterAndRemap(arr, fields) {
  if (!segments) return arr;
  return arr.map((it) => remapItem(it, fields)).filter((it) => it !== null);
}

const subtitlesRemapped = filterAndRemap(words, ["start", "end"]);
const bRollRemapped = filterAndRemap(project.bRoll || [], ["start", "end"]);
// Localizar el b-roll REMOTO a disco ANTES de renderizar. Si a OffthreadVideo se le
// pasan URLs de internet (Pexels/CC0), seekea por HTTP en CADA frame → la CPU queda
// ociosa esperando la red y un video de 1 min tarda ~30 min. Bajándolo una vez a
// local (cacheado, con keyframes densos) el seek es de milisegundos y el render vuela.
const bRollLocal = await localizeBrollClips(bRollRemapped, { dataRoot: DATA_ROOT, host: HOST });
const zoomMarksRemapped = filterAndRemap(project.zoomMarks || [], ["at"]);
const wordStickersRemapped = filterAndRemap(project.wordStickers || [], ["at"]);
const floatingEmojisRemapped = filterAndRemap(project.floatingEmojis || [], ["at"]);
const animationsRemapped = filterAndRemap(project.animations || [], ["at"]);
const emphasisCardsRemapped = filterAndRemap(project.emphasisCards || [], ["at"]);
const reactionZoomsRemapped = filterAndRemap(project.reactionZooms || [], ["at"]);
const stutterMarksRemapped = filterAndRemap(project.stutterMarks || [], ["at"]);
const sfxMarksRemapped = filterAndRemap(project.sfxMarks || [], ["at"]).map((m) => ({
  at: m.at,
  sound: m.sound,
  volume: m.volume ?? 0.4,
  url: `${HOST}/api/sfx/stream?file=${encodeURIComponent(m.sound)}`,
}));
// CapCut Pro FX (opt-in, aditivo) — remapear timestamps igual que el resto.
const sceneFxRemapped = filterAndRemap(project.sceneFx || [], ["at"]);
const proTransitionsRemapped = filterAndRemap(project.proTransitions || [], ["at"]);
const mirrorFxRemapped = filterAndRemap(project.mirrorFx || [], ["at"]);
const trackPathRemapped = filterAndRemap(project.trackPath || [], ["t"]);
const trackedItemsRemapped = filterAndRemap(project.trackedItems || [], ["at"]);
// Galería de stickers: embebe el SVG de los iconos "ph:"/"tb:" elegidos a mano.
const iconStickersRemapped = resolveIconStickerSvg(filterAndRemap(project.iconStickers || [], ["at"]));
const speedRampsRemapped = filterAndRemap(project.speedRamps || [], ["at"]);
const lottieStickersRemapped = filterAndRemap(project.lottieStickers || [], ["at"]);
// PRO transiciones oficiales (@remotion/transitions) + ilustraciones CC0 — tienen
// `at` → remapear igual con jump cuts. Aditivo: [] = render idéntico.
const proTransitionSeriesRemapped = filterAndRemap(project.proTransitionSeries || [], ["at"]);
const illustrationStickersRemapped = filterAndRemap(project.illustrationStickers || [], ["at"]);
// Modo Gráficos & Motion: charts + titulares animados. Tienen `at` → remapear igual
// que el resto si hay jump cuts (estilo graphics_max).
const dataVizRemapped = filterAndRemap(project.dataViz || [], ["at"]);
const kineticHeadlinesRemapped = filterAndRemap(project.kineticHeadlines || [], ["at"]);

const subtitles =
  project.manualSubtitles && project.manualSubtitles.length > 0
    ? project.manualSubtitles
    : subtitlesRemapped;

const props = {
  rawVideoUrl: `${HOST}/api/videos/${encodeURIComponent(videoIdForUrl)}/stream?source=raw`,
  videoDurationSec: +totalDuration.toFixed(3),
  words: subtitles,
  // width/height viajan cuando la fuente las declara (Giphy sí): el render las
  // usa para no recortar material que no encaja en el lienzo. Si no vienen, el
  // comportamiento es el de siempre.
  bRoll: bRollLocal.map((c) => ({
    start: c.start,
    end: c.end,
    url: c.url,
    ...(c.width ? { width: c.width } : {}),
    ...(c.height ? { height: c.height } : {}),
  })),
  // musicTrack puede venir como NOMBRE de archivo ("tema.mp3") o ya como URL
  // ("/api/music/stream?file=..." — lo que devuelve pickRandomMusicTrack). Antes
  // se re-envolvía siempre → URL doble-encodeada → el <Audio> tiraba el render.
  musicUrl: (() => {
    const t = project.musicTrack;
    if (!t) return null;
    if (/^https?:\/\//.test(t)) return t;
    if (t.startsWith("/api/")) return `${HOST}${t}`;
    return `${HOST}/api/music/stream?file=${encodeURIComponent(t)}`;
  })(),
  musicVolume: project.musicVolume ?? Number(process.env.VIRAL_MUSIC_VOLUME ?? 0.35),
  // F1 — Director emocional: curva de ducking de la música ({t, v}). Con jump cuts
  // los `t` se remapean a la línea de tiempo cortada (los puntos que caen en un
  // silencio eliminado se descartan — el cambio de volumen siguiente los cubre).
  musicVolumeCurve: filterAndRemap(project.musicVolumeCurve || [], ["t"]),
  // F3 — Partículas procedurales (confeti/chispas/brasas). Remapean igual.
  particleBursts: filterAndRemap(project.particleBursts || [], ["at"]),
  // Congelados del director emocional. `filterAndRemap` reancla los tiempos al
  // inicio del corte: sin eso, un congelado marcado en el segundo 90 del video
  // original se dispararia en el segundo 90 del CLIP, que no existe.
  freezeMarks: filterAndRemap(project.freezeMarks || [], ["at"]),
  // MOTION PRO — fondo animado (objeto sin timestamps, pass-through).
  animatedBackground: project.animatedBackground ?? null,
  // EDITORIAL — layout split-screen + tarjetas (remapean con jump cuts).
  editorialLayout: project.editorialLayout ?? null,
  // resolveEditorialCardIcons embebe el SVG de iconos "ph:"/"tb:" (Ola 4).
  editorialCards: resolveEditorialCardIcons(filterAndRemap(project.editorialCards || [], ["at"])),
  // Ola 7 — globo con zoom al lugar mencionado (remapea con jump cuts).
  editorialMap: project.editorialMap
    ? (filterAndRemap([{ ...project.editorialMap }], ["at"])[0] ?? null)
    : null,
  // Ola 6 — tarjeta de COLLAGE (recorte de sujeto): file → URL del API local.
  editorialCutout: (() => {
    const c = project.editorialCutout;
    if (!c || !c.file) return null;
    const remapped = filterAndRemap([{ ...c }], ["at"])[0];
    if (!remapped) return null;
    return {
      at: remapped.at,
      duration: c.duration ?? 4.5,
      url: `${HOST}/api/cutouts/stream?file=${encodeURIComponent(c.file)}`,
    };
  })(),
  subtitleStyle: project.subtitleStyle ?? "bebas",
  subtitleColor: project.subtitleColor ?? "#ffffff",
  subtitleHighlight: project.subtitleHighlight ?? "#34d399",
  subtitleFont: project.subtitleFont ?? "auto",
  // F2 — subtítulos fuera de la cara: "top" si el tracking detectó la cara abajo.
  subtitlePosition: project.subtitlePosition ?? "bottom",
  animations: animationsRemapped,
  emphasisCards: emphasisCardsRemapped,
  bRollMode: project.bRollMode ?? "fullscreen",
  // Donde aparece el material de apoyo. `auto` = comportamiento historico.
  bRollPosition: project.bRollPosition || "auto",
  zoomMarks: zoomMarksRemapped,
  wordStickers: wordStickersRemapped,
  floatingEmojis: floatingEmojisRemapped,
  colorRotation: project.colorRotation || [],
  vignette: project.vignette ?? false,
  reactionZooms: reactionZoomsRemapped,
  stutterMarks: stutterMarksRemapped,
  captionBounce: project.captionBounce ?? false,
  sfxMarks: sfxMarksRemapped,
  // Dimensiones del composition. Default 1080×1920 (vertical 9:16).
  width: project.width ?? 1080,
  height: project.height ?? 1920,
  // Modo cinematográfico (opt-in). Defaults vacíos/falsos = render igual a antes.
  imageOverlays: Array.isArray(project.imageOverlays)
    ? project.imageOverlays.map((o) => ({
        id: o.id,
        // URL absoluta porque Remotion render no comparte el contexto del navegador.
        // Usa HOST (VIRAL_API_HOST) porque la app instalada corre en 3100+, no 3000.
        url: o.url?.startsWith("http") ? o.url : `${HOST}${o.url}`,
        startTime: o.startTime ?? 0,
        endTime: o.endTime ?? 3,
        effect: o.effect ?? "memory_flash",
        motion: o.motion ?? "ken_burns_in",
        transitionIn: o.transitionIn ?? "fade",
        transitionOut: o.transitionOut ?? "fade",
        position: o.position ?? "center",
        sizeRatio: o.sizeRatio ?? 0.65,
      }))
    : [],
  cameraMoves: Array.isArray(project.cameraMoves) ? project.cameraMoves : [],
  filmGrain: project.filmGrain ?? false,
  // VHS — overlay camcorder analógico (estilo "vhs"). Boolean puro, sin remapear.
  vhsLook: project.vhsLook ?? false,
  // CINE CLÁSICO — ventanas de B&W (drama). Tienen `at` → remapear con jump cuts.
  bwWindows: filterAndRemap(project.bwWindows || [], ["at"]),
  // F3 SUPREME — mood-aware color grading (KODAK/FUJI/BLEACH según densidad).
  cinematicDensity: project.cinematicDensity ?? "medium",
  // === CapCut Pro FX (opt-in, ADITIVO). Defaults vacíos/"none" = render igual a antes. ===
  sceneFx: sceneFxRemapped,
  proTransitions: proTransitionsRemapped,
  kineticPreset: project.kineticPreset ?? "none",
  mirrorFx: mirrorFxRemapped,
  trackPath: trackPathRemapped,
  trackedItems: trackedItemsRemapped,
  // A6/A8/B5/B6/A2 — opt-in. null/false/[] = render idéntico.
  endScreen: project.endScreen ?? null,
  progressBar: project.progressBar ?? false,
  brandKit: project.brandKit ?? null,
  iconStickers: iconStickersRemapped,
  speedRamps: speedRampsRemapped,
  // B4 — Stickers animados (Lottie) opt-in.
  lottieStickers: lottieStickersRemapped,
  // PRO — transiciones oficiales de Remotion + ilustraciones CC0 (duotono opcional)
  // + overlay de textura. Aditivo: defaults []/null = render idéntico.
  proTransitionSeries: proTransitionSeriesRemapped,
  // AUDIOGRAMA (F2.a) — config del estilo 'audiogram' (null = sin onda). Objeto simple,
  // sin timestamps que remapear → pasa tal cual.
  audiogram: project.audiogram ?? null,
  // LENS FX (F2.d) — halación + aberración cromática (null = sin FX). Pass-through.
  lensFx: project.lensFx ?? null,
  // CALLOUTS (F2.c) — statPops + lower-thirds (remap de timestamp `at`). [] = idéntico.
  statPops: filterAndRemap(project.statPops || [], ["at"]),
  lowerThirds: filterAndRemap(project.lowerThirds || [], ["at"]),
  illustrationStickers: illustrationStickersRemapped,
  overlayTexture: project.overlayTexture ?? null,
  // TEXTO DETRÁS DEL SUJETO (matte estático, NUEVO). Compone en Remotion: video →
  // texto → matte del sujeto encima. SOLO se activa cuando el modo MATTE está elegido
  // explícitamente (matteFile/matteUrl/useMatte), para NO chocar con el camino LEGACY
  // del estilo text_behind (que BAKEA el texto en Python vía foregroundVideoId — ahí
  // el texto ya está quemado en el video y no debe redibujarse). null = sin efecto.
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
  // Modo Gráficos & Motion (estilos graphics_*): charts + titulares animados.
  dataViz: dataVizRemapped,
  kineticHeadlines: kineticHeadlinesRemapped,
  // C1 — Voz IA (Piper) opt-in. auto-build rellena voiceoverUrl tras correr tts.py.
  voiceoverUrl: project.voiceoverUrl ?? null,
  voiceoverVolume: project.voiceoverVolume ?? 0.7,
  voiceoverStartSec: project.voiceoverStartSec ?? 0,
  autoReframe: project.autoReframe ?? false,
  sourceAspect: project.sourceAspect ?? 16 / 9,
};

// PLANTILLA DE HOOK (opt-in) — orquesta capas que ya existen (titular + sticker +
// whoosh + zoom) en los primeros ~2.5s para clavar el gancho. ADITIVO: si el project
// no trae hookTemplate/hook, applyHookTemplate es no-op (render idéntico). El whoosh
// sale con su URL de /api/sfx ya resuelta, igual que el resto de sfxMarks.
const hookId = project.hookTemplate ?? project.hook ?? null;
const propsWithHook = applyHookTemplate(props, hookId, (sound) =>
  `${HOST}/api/sfx/stream?file=${encodeURIComponent(sound)}`
);
Object.assign(props, propsWithHook);

// PRUEBA GRATUITA — sin licencia activada, el video sale con marca de agua.
// (ver license-check.mjs: nunca rompe el build; en duda, sin marca.)
if (needsTrialWatermark()) props.trialWatermark = true;

const outFile = path.join(__dirname, path.basename(OUT_NAME));
writeFileSync(outFile, JSON.stringify(props, null, 2), "utf-8");
console.log(`props written: ${outFile}`);
console.log(
  `subs: ${props.words.length} · b-roll: ${props.bRoll.length} · zoom: ${props.zoomMarks.length} · stickers: ${props.wordStickers.length} · emojis: ${props.floatingEmojis.length} · reactZooms: ${props.reactionZooms.length} · stutter: ${props.stutterMarks.length} · sfx: ${props.sfxMarks.length} · duration: ${props.videoDurationSec}s`
);
