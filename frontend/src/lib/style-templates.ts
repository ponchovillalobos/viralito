/**
 * Templates por estilo. Cada función recibe el contexto del video (duration, keywords)
 * y devuelve un proyecto JSON listo para guardar + renderizar.
 *
 * El estilo "supreme" antes vivía solo en remotion/build-clip-supreme.mjs (long-form).
 * Ahora está aquí también para que tanto cortos como largos puedan elegirlo.
 */

import { pickEmojis } from "./viral-emojis";

// `StyleId` y la metadata de estilos viven ahora en el registro central
// (style-registry.ts + style-registry.data.json). Lo importamos para uso local
// (las firmas de buildProjectForStyle, etc.) y lo re-exportamos para que todos
// los consumidores que ya importan `StyleId` de este archivo no cambien de path.
// Agregar un estilo = editar el JSON + la tupla STYLE_IDS, y cualquier lugar que
// falte se vuelve un error de tsc.
import type { StyleId } from "./style-registry";
export type { StyleId };

export interface BuildContext {
  videoId: string;
  duration: number;
  keywords: { word: string; start: number; end: number }[]; // top palabras del transcript con timestamps
  accentColor: string;
  caption?: string;
  day?: number;
  /** Para supreme (long-form): hook curado del proposal. Default = primera keyword en MAYÚSCULAS. */
  hookOverride?: string;
  /** Para supreme: tema curado del proposal. Default = keyword del medio. */
  themeOverride?: string;
  /** Dimensiones del render. Default 1080×1920 (vertical 9:16). */
  width?: number;
  height?: number;
  /** @handle real del usuario (de user-settings) — endScreen y brandKit lo muestran si existe. */
  brandHandle?: string;
  /** Modo cinematográfico — imageOverlays subidos por el user (con timestamps + effects ya seteados por asamblea IA). */
  imageOverlays?: Array<{
    id: string;
    url: string;
    startTime: number;
    endTime: number;
    effect?: string;
    motion?: string;
    transitionIn?: string;
    transitionOut?: string;
    position?: string;
    sizeRatio?: number;
  }>;
  /** Si true, agrega FilmGrainLayer al render */
  filmGrain?: boolean;
  /** Si true, fuerza subtitleStyle="cinematic" sobreescribiendo el del estilo */
  subtitleCinematic?: boolean;
  /**
   * SFX auto-generados por el matcher determinístico (`python/match_sfx_to_transcript.py`).
   * Si vienen, se inyectan al timeline cuando isCinematic=true.
   */
  autoSfxMarks?: Array<{ at: number; sound: string; volume: number; url?: string }>;
  /** Camera moves auto-generados para el video base */
  autoCameraMoves?: Array<{ at: number; duration: number; type: string; intensity: number }>;
  /** Jump cuts (stutterMarks) auto-detectados en pausas del transcript */
  autoStutterMarks?: Array<{ at: number; duration: number }>;
  /** Perfil de densidad para tests A/B/C: low|medium|high */
  cinematicDensity?: "low" | "medium" | "high";
}

/**
 * Genera camera moves auto-distribuidos sobre la duración del video.
 * Solo se usa cuando hay imageOverlays (modo cinematográfico).
 *
 * density:
 *   - low: 1 cada 10s, intensidad 0.05
 *   - medium: 1 cada 7s, intensidad 0.08
 *   - high: 1 cada 5s, intensidad 0.12
 */
export function generateCameraMoves(
  duration: number,
  density: "low" | "medium" | "high" = "medium"
): { at: number; duration: number; type: string; intensity: number }[] {
  // SUPREME: intensity AMPLIFICADO. El multiplicador real es x2.5 en useCameraMoveTransform,
  // así que estos valores se traducen a zoom REAL de 25%-50% sobre el video.
  // low: 0.10 * 2.5 = 25% zoom; medium: 0.16 * 2.5 = 40%; high: 0.22 * 2.5 = 55%.
  // Para video de 90s: low=6, medium=12, high=18 camera moves.
  const cfg = {
    low: { gap: 14, intensity: 0.1, dur: 2.0 },
    medium: { gap: 7, intensity: 0.16, dur: 2.5 },
    high: { gap: 4, intensity: 0.22, dur: 3.0 },
  }[density];

  const types = ["zoom_in", "pan_right", "zoom_out", "pan_left"] as const;
  const moves: { at: number; duration: number; type: string; intensity: number }[] = [];
  let cursor = 3; // primer move a los 3s
  let i = 0;
  while (cursor < duration - cfg.dur - 1) {
    moves.push({
      at: +cursor.toFixed(2),
      duration: cfg.dur,
      type: types[i % 4],
      intensity: cfg.intensity + (i % 3) * 0.01, // variar ±0.02
    });
    cursor += cfg.gap + (i % 3);
    i++;
  }
  return moves;
}

/**
 * Detecta pausas en el transcript (gaps >0.4s entre palabras) y genera
 * jump cuts en esos momentos. Las pausas naturales son ideales porque ahí
 * no hay audio que se rompa con el cut.
 */
export function generateJumpCuts(
  transcript: { word: string; start: number; end: number }[],
  density: "low" | "medium" | "high" = "medium"
): { at: number; duration: number }[] {
  const maxJumps = { low: 0, medium: 3, high: 6 }[density];
  if (maxJumps === 0) return [];

  const candidates: { gap: number; at: number }[] = [];
  for (let i = 1; i < transcript.length; i++) {
    const gap = transcript[i].start - transcript[i - 1].end;
    if (gap > 0.4) {
      candidates.push({ gap, at: +(transcript[i].start - 0.1).toFixed(2) });
    }
  }
  // Quedarnos con los `maxJumps` gaps más largos (más naturales)
  candidates.sort((a, b) => b.gap - a.gap);
  return candidates.slice(0, maxJumps).map((c) => ({
    at: c.at,
    duration: 0.18,
  }));
}

const SFX_POOL = ["swoosh.wav", "water_drop.ogg", "pop.ogg", "ding.ogg", "bloop.ogg", "notification.ogg", "thud.wav", "swoosh_quick.wav", "ding_bell.ogg"];

// ─────────────────── CapCut Pro FX — generadores compartidos ─────────────────
// Los usa el helper applyCapcutFx para sumar LUT/scene-fx/transiciones/kinetic a
// TODOS los estilos (el estilo capcut_pro se fusionó en estos generadores).

/** LUTs disponibles en remotion/public/luts (ver generate-luts.mjs). */
const LUT_POOL = ["teal_orange.cube", "kodak_warm.cube", "cyberpunk.cube", "vintage_film.cube"];

/** Elige un LUT determinísticamente por videoId (curado a looks favorecedores). */
export function pickLut(ctx: BuildContext): string {
  let h = 0;
  const s = `${ctx.videoId}:lut`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return LUT_POOL[h % LUT_POOL.length];
}

/** Overlays atmosféricos (light leak / bokeh / glow / dust) distribuidos en el clip. */
export function generateSceneFx(ctx: BuildContext): Array<{
  at: number;
  duration: number;
  kind: "light_leak" | "bokeh" | "glow" | "dust";
  color: string;
  opacity: number;
  intensity: number;
  seed: number;
}> {
  const d = ctx.duration;
  const c = ctx.accentColor;
  const fx = [
    { at: 0.2, duration: 1.4, kind: "light_leak" as const, color: "#ff8a3d", opacity: 0.5, intensity: 1, seed: 1 },
    { at: +(d * 0.33).toFixed(2), duration: 2.5, kind: "bokeh" as const, color: c, opacity: 0.42, intensity: 1, seed: 2 },
    { at: +(d * 0.55).toFixed(2), duration: 1.2, kind: "glow" as const, color: c, opacity: 0.38, intensity: 1, seed: 3 },
    { at: +(d * 0.72).toFixed(2), duration: 3.0, kind: "dust" as const, color: "#ffffff", opacity: 0.3, intensity: 1, seed: 4 },
  ];
  if (d > 8) {
    fx.push({ at: +(d - 2).toFixed(2), duration: 1.6, kind: "light_leak" as const, color: "#ff8a3d", opacity: 0.5, intensity: 1, seed: 5 });
  }
  return fx.filter((f) => f.at < d);
}

/** Transiciones pro (whip/zoom/glitch/flash/reveal) en puntos clave del transcript. */
export function generateProTransitions(ctx: BuildContext): Array<{
  at: number;
  kind:
    | "whip"
    | "zoom_punch"
    | "glitch"
    | "flash"
    | "reveal_lr"
    | "reveal_ud"
    | "light_streak"
    | "swipe_blur"
    | "iris"
    | "flip3d";
  durationFrames: number;
  color: string;
}> {
  // Pool ampliado (A5): suma light_streak / swipe_blur / iris a la rotación para más variedad.
  // F3: flip3d = giro 3D del frame con perspectiva (movimiento real en ViralVideo).
  const kinds = [
    "whip",
    "zoom_punch",
    "flip3d",
    "light_streak",
    "glitch",
    "swipe_blur",
    "reveal_lr",
    "iris",
    "flash",
  ] as const;
  const kws = ctx.keywords.filter((k) => k.start > 1 && k.start < ctx.duration - 1).slice(0, 6);
  return kws.map((kw, i) => ({
    at: +Math.max(0, kw.start - 0.1).toFixed(2),
    kind: kinds[i % kinds.length],
    durationFrames: 8,
    color: "#ffffff",
  }));
}

/** Momentos kaleidoscópicos (mirror/clone/split) en 1-2 keywords del medio del video. */
export function generateMirrorFx(ctx: BuildContext): Array<{
  at: number;
  duration: number;
  kind: "mirror_v" | "mirror_h" | "clone_3" | "split_2";
}> {
  const kinds = ["mirror_v", "clone_3", "mirror_h"] as const;
  const kws = ctx.keywords
    .filter((k) => k.start > ctx.duration * 0.2 && k.start < ctx.duration * 0.85)
    .slice(0, 2);
  return kws.map((kw, i) => ({
    at: +kw.start.toFixed(2),
    duration: 0.8,
    kind: kinds[i % kinds.length],
  }));
}

/** Labels (keyword + emoji) que seguirán la cara del sujeto (motion tracking). */
export function generateTrackedItems(ctx: BuildContext): Array<{
  at: number;
  duration: number;
  text: string;
  emoji: string;
  color: string;
  offsetY: number;
}> {
  const emojis = pickEmojis(`${ctx.videoId}:tracked`, 3);
  return pickKeywords(ctx, 3).map((kw, i) => ({
    at: +kw.start.toFixed(2),
    duration: 2.5,
    text: kw.word.toUpperCase().replace(/[.,;:!?¿¡]/g, "").slice(0, 18),
    emoji: emojis[i] ?? "👀",
    color: ctx.accentColor,
    offsetY: -0.06,
  }));
}

// B5 — Iconos curados para stickers (mismos keys que ICON_MAP en Remotion).
const ICON_POOL = ["fire", "lightbulb", "target", "rocket", "zap", "trending", "crown"] as const;

/**
 * B5 — Genera 3-5 icon stickers repartidos por keyword del video, rotando por ICON_POOL.
 * Cada uno aparece en el timestamp de su keyword, con bg accent y posición top-right.
 */
export function generateIconStickers(ctx: BuildContext): Array<{
  at: number;
  duration: number;
  icon: string;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center";
  color: string;
  bg: string;
  size: number;
}> {
  const kws = pickKeywords(ctx, 4);
  const positions: Array<"top-left" | "top-right" | "bottom-left" | "bottom-right"> = [
    "top-right",
    "top-left",
    "bottom-right",
    "bottom-left",
  ];
  return kws.map((kw, i) => ({
    at: +Math.max(0.5, kw.start - 0.1).toFixed(2),
    duration: 1.2,
    icon: ICON_POOL[i % ICON_POOL.length],
    position: positions[i % positions.length],
    color: "#0a0a0a",
    bg: ctx.accentColor,
    size: 110,
  }));
}

/**
 * A4 — Genera 2 speed ramps (slow-mo 0.5x de ~1.2s) en los keywords más visuales.
 * Cada ventana de slow-mo no extiende la duración total: tapa el video base a 1x.
 */
export function generateSpeedRamps(ctx: BuildContext): Array<{
  at: number;
  duration: number;
  rate: number;
}> {
  const kws = pickKeywords(ctx, 2);
  return kws.map((kw) => ({
    at: +Math.max(0.5, kw.start - 0.05).toFixed(2),
    duration: 1.2,
    rate: 0.5,
  }));
}

/**
 * B4 — Genera stickers ANIMADOS (Lottie) en keywords clave: un sparkle/pulse que late
 * en una esquina para llamar la atención sobre la palabra. Alterna animación y esquina.
 */
export function generateLottieStickers(ctx: BuildContext): Array<{
  at: number;
  duration: number;
  name: "pulse_ring" | "sparkle" | "arrow_down" | "star5";
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "center";
  size: number;
  color: string;
}> {
  const kws = pickKeywords(ctx, 4);
  const names: Array<"pulse_ring" | "sparkle" | "arrow_down" | "star5"> = [
    "sparkle",
    "star5",
    "arrow_down",
    "pulse_ring",
  ];
  const positions: Array<"top-right" | "top-left" | "bottom-right"> = [
    "top-right",
    "top-left",
    "bottom-right",
  ];
  return kws.map((kw, i) => ({
    at: +Math.max(0.4, kw.start - 0.15).toFixed(2),
    duration: 1.6,
    name: names[i % names.length],
    position: positions[i % positions.length],
    size: 240,
    color: ctx.accentColor,
  }));
}

type KineticPresetName = "none" | "pop" | "slide_up" | "type_on" | "bounce" | "glow_pulse" | "karaoke" | "pop_reels";

/**
 * Suma las "recetas CapCut" (LUT de color, scene-fx atmosféricos, transiciones pro y
 * tipografía cinética) a CUALQUIER proyecto de estilo. Aditivo: los campos son opt-in
 * del schema (default vacío/none), así que sumar esto no rompe nada.
 *
 *   opts.lut          → nombre de .cube (default: pickLut determinístico)
 *   opts.kinetic      → preset de subtítulo cinético (default "none" = subs normales)
 *   opts.sceneFx      → false para no agregar light leaks/bokeh (ej. estilo limpio)
 *   opts.transitions  → false para no agregar whip/glitch en cortes
 */
function applyCapcutFx<T extends object>(
  project: T,
  ctx: BuildContext,
  opts: {
    lut?: string;
    kinetic?: KineticPresetName;
    sceneFx?: boolean;
    transitions?: boolean;
    mirror?: boolean;
    tracking?: boolean;
    // A6/A8/B5/B6/A2/A4 — opt-in.
    endScreen?: boolean;
    progressBar?: boolean;
    brandKit?: boolean;
    iconStickers?: boolean;
    autoReframe?: boolean;
    speedRamps?: boolean;
    lottieStickers?: boolean;
  } = {}
) {
  return {
    ...project,
    lut: opts.lut ?? pickLut(ctx),
    sceneFx: opts.sceneFx === false ? [] : generateSceneFx(ctx),
    proTransitions: opts.transitions === false ? [] : generateProTransitions(ctx),
    kineticPreset: (opts.kinetic ?? "none") as KineticPresetName,
    mirrorFx: opts.mirror ? generateMirrorFx(ctx) : [],
    // Motion tracking: el flag `tracking` hace que auto-build corra track_subject.py
    // y rellene `trackPath`. trackedItems son los labels que seguirán la cara.
    ...(opts.tracking
      ? { tracking: true, trackedItems: generateTrackedItems(ctx), trackPath: [] as unknown[] }
      : {}),
    ...(opts.endScreen
      ? {
          endScreen: {
            text: "Seguime para más",
            // @handle real del usuario (user-settings vía ctx) — el layer lo muestra
            // debajo del copy. Vacío = end-screen genérico, render idéntico a antes.
            handle: ctx.brandHandle ?? "",
            emoji: "🔥",
            accent: ctx.accentColor,
            durationSec: 2.5,
          },
        }
      : {}),
    ...(opts.progressBar ? { progressBar: true } : {}),
    // Marca de agua: handle desde ctx (user-settings); si viene vacío, auto-build (B6)
    // intenta rellenarlo. Sin handle configurado, ViralVideo no la renderiza (queda igual).
    ...(opts.brandKit
      ? { brandKit: { handle: ctx.brandHandle ?? "", position: "bottom-right" } }
      : {}),
    ...(opts.iconStickers ? { iconStickers: generateIconStickers(ctx) } : {}),
    // A2 — autoReframe necesita tracking activo para tener trackPath. Si el estilo
    // ya pidió tracking (vía opts.tracking) o lo activamos aquí, el trackPath se llena.
    ...(opts.autoReframe
      ? {
          autoReframe: true,
          ...(opts.tracking ? {} : { tracking: true, trackedItems: [], trackPath: [] as unknown[] }),
        }
      : {}),
    ...(opts.speedRamps ? { speedRamps: generateSpeedRamps(ctx) } : {}),
    ...(opts.lottieStickers ? { lottieStickers: generateLottieStickers(ctx) } : {}),
  };
}

function pickKeywords(ctx: BuildContext, count: number) {
  return ctx.keywords.slice(0, count);
}

function buildStickers(ctx: BuildContext, count: number) {
  // Emojis seleccionados deterministically para este video → cada video distinto, mismo
  // video siempre igual al re-renderizar.
  const emojis = pickEmojis(`${ctx.videoId}:stickers`, count);
  return pickKeywords(ctx, count).map((kw, i) => ({
    at: kw.start,
    duration: 1.5,
    word: kw.word.toUpperCase().replace(/[.,;:!?¿¡]/g, "").slice(0, 24),
    emoji: emojis[i] ?? "✨",
    position: "top-center" as const,
    rotation: 0,
    bg: ctx.accentColor,
    color: "#0a0a0a",
  }));
}

function buildFloatingEmojis(ctx: BuildContext, count: number) {
  const emojis = pickEmojis(`${ctx.videoId}:floating`, count);
  const result = [];
  for (let i = 0; i < count; i++) {
    const at = ((i + 0.5) * ctx.duration) / count;
    result.push({
      at: +at.toFixed(2),
      duration: 1.3,
      emoji: emojis[i] ?? "✨",
      from: (i % 2 === 0 ? "left" : "right") as "left" | "right",
      size: 220,
      yOffset: 0,
    });
  }
  return result;
}

function buildEmphasisCards(ctx: BuildContext) {
  const first = ctx.keywords[0];
  const mid = ctx.keywords[Math.floor(ctx.keywords.length / 2)];
  const hookWord = first ? first.word.toUpperCase().slice(0, 16) : "ATENCION";
  const midWord = mid ? mid.word.toUpperCase().slice(0, 16) : "CLAVE";
  // 3 emojis distintos para el video (hook/clave/guardalo)
  const [eHook, eMid, eSave] = pickEmojis(`${ctx.videoId}:emphasis`, 3);
  return [
    { at: 0.4, duration: 1.2, word: hookWord, emoji: eHook ?? "🔥", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
    { at: Math.max(2, ctx.duration * 0.5), duration: 1.2, word: midWord, emoji: eMid ?? "💡", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
    { at: Math.max(ctx.duration - 2.5, ctx.duration - 3), duration: 1.5, word: "GUARDALO", emoji: eSave ?? "📌", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
  ];
}

function commonBase(ctx: BuildContext, styleId: StyleId) {
  // Detección de modo cinematográfico: hay imágenes subidas por el user.
  // Cuando es cinematic, se inyectan AUTOMÁTICAMENTE los autos (SFX, cameras, jumps)
  // ENCIMA de lo que el estilo agregue. Los estilos legacy siguen funcionando igual
  // cuando NO hay overlays.
  const isCinematic = (ctx.imageOverlays?.length ?? 0) > 0;

  return {
    id: `${ctx.videoId}_${styleId}`,
    videoId: ctx.videoId,
    day: ctx.day ?? null,
    platforms: ["tiktok", "instagram"],
    styleId,
    accentColor: ctx.accentColor,
    caption: ctx.caption ?? "",
    status: "borrador" as const,
    subtitleColor: "#ffffff",
    subtitleHighlight: ctx.accentColor,
    musicTrack: null,
    musicVolume: 0.35,
    colorRotation: [],
    bRoll: [],
    animations: [],
    emphasisCards: [],
    wordStickers: [],
    floatingEmojis: [],
    zoomMarks: [],
    reactionZooms: [],
    // Auto-stutter/SFX/cameras SOLO cuando hay imageOverlays. Si no, default vacío
    // y el estilo legacy decide qué poner.
    stutterMarks: isCinematic && ctx.autoStutterMarks ? ctx.autoStutterMarks : [],
    sfxMarks: isCinematic && ctx.autoSfxMarks ? ctx.autoSfxMarks : [],
    manualSubtitles: [],
    captionBounce: false,
    enableJumpCuts: isCinematic,
    bRollMode: "fullscreen" as const,
    vignette: isCinematic || ctx.subtitleCinematic === true || ctx.filmGrain === true,
    subtitleStyle: (ctx.subtitleCinematic || isCinematic ? "cinematic" : "bebas") as
      | "bebas"
      | "anton"
      | "cinematic",
    width: ctx.width ?? 1080,
    height: ctx.height ?? 1920,
    imageOverlays: ctx.imageOverlays ?? [],
    cameraMoves: isCinematic && ctx.autoCameraMoves ? ctx.autoCameraMoves : [],
    filmGrain: isCinematic ? true : (ctx.filmGrain ?? false),
    // F3 SUPREME — propagar densidad para mood-aware color grading en Remotion.
    cinematicDensity: ctx.cinematicDensity ?? "medium",
  };
}

/**
 * Variante "supreme": premium full-stack con stickers desde keywords curadas,
 * emphasis cards con hook/insight/CTA, floating emojis sin solaparse con stickers,
 * zoom + reaction + stutter coordinados, SFX en cada emphasis card.
 *
 * Diseñado originalmente para clips de long-form (con hook/theme/keywords curados
 * por el LLM en el proposal), pero también sirve para cortos si el wizard solo
 * pasa ctx.keywords sin overrides.
 */
function buildSupremeStyle(ctx: BuildContext, styleId: StyleId) {
  const base = commonBase(ctx, styleId);
  const stickerEmojis = pickEmojis(`${ctx.videoId}:supreme:stickers`, 6);
  const sideEmojis = pickEmojis(`${ctx.videoId}:supreme:floating`, 4);

  // Stickers desde top keywords (con timestamps filtrados para no estar en bordes)
  const stickers: ReturnType<typeof buildStickers> = [];
  const keywordList = pickKeywords(ctx, 6);
  for (let i = 0; i < keywordList.length; i++) {
    const kw = keywordList[i];
    if (kw.start > 0.5 && kw.start < ctx.duration - 2) {
      stickers.push({
        at: +kw.start.toFixed(2),
        duration: 1.5,
        word: kw.word.toUpperCase().replace(/[.,;:!?¿¡]/g, "").slice(0, 24),
        emoji: stickerEmojis[i] ?? "✨",
        position: "top-center" as const,
        rotation: 0,
        bg: ctx.accentColor,
        color: "#0a0a0a",
      });
    }
  }
  stickers.sort((a, b) => a.at - b.at);

  // Emphasis cards: hook al inicio, insight al medio, CTA "GUARDALO" al final (si dura >25s)
  const hookSource = ctx.hookOverride ?? ctx.keywords[0]?.word ?? "MIRA ESTO";
  const themeSource =
    ctx.themeOverride ?? ctx.keywords[Math.floor(ctx.keywords.length / 2)]?.word ?? hookSource;
  const hookText = hookSource
    .replace(/[^\w áéíóúñÁÉÍÓÚÑ]/g, "")
    .trim()
    .slice(0, 24)
    .toUpperCase();
  const themeText = themeSource
    .replace(/[^\w áéíóúñÁÉÍÓÚÑ]/g, "")
    .trim()
    .slice(0, 22)
    .toUpperCase();

  const emphasisCards: ReturnType<typeof buildEmphasisCards> = [
    {
      at: 0.4,
      duration: 1.2,
      word: hookText.split(" ").slice(0, 3).join(" ") || "ATENCION",
      emoji: "🔥",
      bg: "#0a0a0a",
      color: "#ffffff",
      accent: ctx.accentColor,
    },
    {
      at: Math.max(2, ctx.duration * 0.5 - 0.5),
      duration: 1.2,
      word: themeText.split(" ").slice(0, 3).join(" ") || "INSIGHT",
      emoji: "💡",
      bg: "#0a0a0a",
      color: "#ffffff",
      accent: ctx.accentColor,
    },
  ];
  if (ctx.duration > 25) {
    emphasisCards.push({
      at: Math.max(ctx.duration - 2.5, ctx.duration - 3),
      duration: 1.6,
      word: "GUARDALO",
      emoji: "📌",
      bg: "#0a0a0a",
      color: "#ffffff",
      accent: ctx.accentColor,
    });
  }

  // Floating emojis: 3-4 distribuidos, evitando solapamiento con stickers (±1s)
  const emojiCount = ctx.duration > 40 ? 4 : 3;
  const floatingEmojis: ReturnType<typeof buildFloatingEmojis> = [];
  for (let i = 0; i < emojiCount; i++) {
    const at = ((i + 0.5) * ctx.duration) / emojiCount;
    const tooClose = stickers.some((s) => Math.abs(s.at - at) < 1.0);
    if (tooClose) continue;
    floatingEmojis.push({
      at: +at.toFixed(2),
      duration: 1.3,
      emoji: sideEmojis[i] ?? "✨",
      from: (i % 2 === 0 ? "left" : "right") as "left" | "right",
      size: 220,
      yOffset: 0,
    });
  }

  // Zoom marks: uno por sticker + uno al inicio
  const zoomMarks = stickers.slice(0, 5).map((s) => ({
    at: s.at,
    duration: 0.6,
    scale: 1.14,
  }));
  zoomMarks.unshift({ at: 0.3, duration: 0.7, scale: 1.18 });

  // Reaction zooms: uno por emphasis card
  const reactionZooms = emphasisCards.map((e) => ({
    at: +(e.at + 0.05).toFixed(2),
    intensity: 1.42,
    duration: 0.22,
  }));

  // Stutters: antes del segundo emphasis card y del CTA
  const stutterMarks: { at: number; duration: number }[] = [];
  if (emphasisCards[1]) stutterMarks.push({ at: +(emphasisCards[1].at - 0.2).toFixed(2), duration: 0.18 });
  if (emphasisCards[2]) stutterMarks.push({ at: +(emphasisCards[2].at - 0.2).toFixed(2), duration: 0.18 });

  // SFX: swoosh al arranque + uno por emphasis card + alternados en stickers (no todos)
  const sfxMarks: { at: number; sound: string; volume: number }[] = [];
  sfxMarks.push({ at: 0.3, sound: "swoosh.wav", volume: 0.35 });
  emphasisCards.forEach((e, i) => {
    sfxMarks.push({
      at: +(e.at + 0.05).toFixed(2),
      sound: i === 0 ? "pop.ogg" : i === 1 ? "ding.ogg" : "notification.ogg",
      volume: 0.45,
    });
  });
  stickers.forEach((s, i) => {
    if (i % 2 === 0 && !sfxMarks.some((x) => Math.abs(x.at - s.at) < 0.3)) {
      sfxMarks.push({
        at: s.at,
        sound: SFX_POOL[(i + 2) % SFX_POOL.length],
        volume: 0.35,
      });
    }
  });
  sfxMarks.sort((a, b) => a.at - b.at);

  return {
    ...base,
    subtitleStyle: "anton" as const,
    bRollMode: "pip" as const,
    vignette: true,
    captionBounce: true,
    enableJumpCuts: false, // ya está corrido del video clean en long-form
    wordStickers: stickers,
    floatingEmojis,
    zoomMarks,
    reactionZooms,
    stutterMarks,
    emphasisCards,
    sfxMarks,
  };
}

/**
 * Pool de música de fondo. Devuelve null si NO hay archivos en disco —
 * Remotion <Audio> con URL 404 ROMPE el render, así que verificamos primero.
 *
 * Hoy Pixabay descontinuó la API de música (404), así que el sistema queda
 * sin música hasta que el user suba archivos manualmente. Sin música = render OK.
 */
export function pickRandomMusicTrack(seed: string, mood?: string): string | null {
  // Sync check: ¿hay archivos en MUSIC_DIR? Lectura síncrona OK porque
  // commonBase corre en el server al momento de buildear project.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MUSIC_DIR } = require("@/lib/paths");
    const folders = [
      path.join(MUSIC_DIR, "pixabay"),
      path.join(MUSIC_DIR, "freesound"),
      path.join(MUSIC_DIR, "github"),
      MUSIC_DIR,
    ];
    const files: string[] = [];
    for (const folder of folders) {
      try {
        const entries = fs.readdirSync(folder) as string[];
        for (const f of entries) {
          if (/\.(mp3|wav|m4a|ogg)$/i.test(f)) files.push(f);
        }
      } catch {
        // carpeta no existe
      }
    }
    if (files.length === 0) return null; // ← sin música, render OK
    // Filtro por mood: la biblioteca codifica el mood en el filename
    // (incompetech-epic-..., openlofi-lofi-chill-..., freepd-energetic-..., chosic-calm-...).
    //
    // BUG histórico: emotion_director.py emite los moods hype/tension/inspirador/chill/epico,
    // pero NINGÚN archivo se llama "-hype-", "-inspirador-" ni "-epico-" → el filtro daba 0
    // matches y caía al pool completo (música random, no acorde al video). El alias mapea
    // cada mood de la IA a los tokens que SÍ existen en los nombres de archivo.
    const MOOD_ALIASES: Record<string, string[]> = {
      hype: ["hype", "energetic", "energizing", "driving", "funky", "funkeriffic", "groovin", "beat", "drop", "city", "circuit", "action"],
      tension: ["tension", "dark", "dramatic", "suspense", "cold", "honor"],
      inspirador: ["inspirador", "inspiration", "hopeful", "uplifting", "elevate", "heroic", "horizon", "journey", "adventure", "magic", "lovely"],
      chill: ["chill", "calm", "lofi", "ambient", "kalimba", "flutey", "maple", "coy", "bonfire"],
      epico: ["epico", "epic", "heroic", "honor", "kings", "apex", "infinite", "chronos", "final", "limit"],
    };
    let pool = files;
    if (mood) {
      const key = mood.toLowerCase();
      const tokens = MOOD_ALIASES[key] ?? [key];
      const filtered = files.filter((f) => {
        const lf = f.toLowerCase();
        return tokens.some((t) => lf.includes(`-${t}-`) || lf.includes(`-${t}.`));
      });
      if (filtered.length > 0) pool = filtered;
    }
    pool = [...pool].sort(); // orden estable, independiente del orden de readdir
    // Hash-based pick determinístico
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    let pick = pool[h % pool.length];
    // Rotación anti-repetición (persistida en MUSIC_DIR/music-rotation.json):
    //  - mismo videoId → SIEMPRE la misma pista (assignments ⇒ re-render determinista)
    //  - videoId NUEVO cuyo hash cae en la última pista usada por OTRO video → siguiente
    const rotPath = path.join(MUSIC_DIR, "music-rotation.json");
    try {
      let rot: {
        lastFile?: string;
        lastVideoId?: string;
        assignments?: Record<string, string>;
      } = {};
      try {
        rot = JSON.parse(fs.readFileSync(rotPath, "utf-8"));
      } catch {
        // sin estado previo
      }
      const assignments = rot.assignments ?? {};
      const prev = assignments[seed];
      if (prev && files.includes(prev)) {
        pick = prev; // re-render del mismo video: respeta la asignación original
      } else if (pool.length > 1 && rot.lastFile === pick && rot.lastVideoId !== seed) {
        pick = pool[(h + 1) % pool.length]; // evita repetir la última pista entre videos distintos
      }
      assignments[seed] = pick;
      const keys = Object.keys(assignments);
      if (keys.length > 300) {
        for (const k of keys.slice(0, keys.length - 300)) delete assignments[k];
      }
      fs.writeFileSync(
        rotPath,
        JSON.stringify({ lastFile: pick, lastVideoId: seed, assignments })
      );
    } catch {
      // si el JSON no se puede leer/escribir, seguimos con el pick por hash
    }
    return `/api/music/stream?file=${encodeURIComponent(pick)}`;
  } catch {
    return null;
  }
}

export function buildProjectForStyle(ctx: BuildContext, styleId: StyleId) {
  const base = commonBase(ctx, styleId);

  // ─── cinematic_pro: look de cine de PRIMERA CLASE. Hornea el look completo
  // SIN depender de overlays subidos: film grain ON, LUT teal&orange, vignette,
  // camera moves auto-distribuidos (zoom/pan suaves) + subtítulos cine. Si además
  // el user sube imágenes (overlays + asamblea IA), commonBase ya inyecta SFX/
  // jump-cuts/overlays — este bloque solo garantiza un cine válido por defecto.
  // Conserva subtítulos cine (kinetic="none"). ───
  if (styleId === "cinematic_pro") {
    const cineDensity = ctx.cinematicDensity ?? "medium";
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "cinematic" as const,
        // Letra SERIF editorial (Playfair) en vez de display → look más profesional, de cine.
        subtitleFont: "playfair",
        bRollMode: "fullscreen" as const,
        vignette: true,
        filmGrain: true,
        cinematicDensity: cineDensity,
        // Camera moves horneados aunque no haya overlays: el matcher (auto-build)
        // los pisa con autoCameraMoves cuando hay imágenes; si no, este default
        // da el vaivén de cámara cinematográfico igual.
        cameraMoves:
          base.cameraMoves.length > 0
            ? base.cameraMoves
            : generateCameraMoves(ctx.duration, cineDensity),
        captionBounce: false,
        // Música con MOOD cinematográfico (no pop aleatorio) + volumen bajo para que
        // acompañe sin sonar raro sobre la voz.
        musicTrack: pickRandomMusicTrack(ctx.videoId, "inspirador"),
        musicVolume: 0.06,
      },
      ctx,
      { lut: "teal_orange.cube", kinetic: "none" }
    );
  }

  // ─── broll_full / broll_pip: estilos NUEVOS con B-roll automático de Pexels por
  // transcripción. auto-build llena `project.bRoll` con autoMatchBroll(). Aquí solo
  // fijamos el MODO (fullscreen vs pip) + edición + FX CapCut. ───
  if (styleId === "broll_full" || styleId === "broll_pip") {
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "anton" as const,
        bRollMode: styleId === "broll_full" ? ("fullscreen" as const) : ("pip" as const),
        vignette: true,
        captionBounce: false,
        wordStickers: buildStickers(ctx, 5),
        floatingEmojis: buildFloatingEmojis(ctx, 3),
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.12 })),
        // Música + beat-sync: el montaje de B-roll corta/zoomea al ritmo. auto-build
        // detecta los beats del track y agrega zoomMarks/transiciones en ellos.
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.2,
        beatSync: true,
        // broll_pip: el sujeto es protagonista (Pexels va chiquito) → quitar fondo con IA
        // hace que la persona resalte sobre un fondo desenfocado. auto-build lo procesa.
        removeBg: styleId === "broll_pip",
        // bRoll lo puebla auto-build (Pexels por keyword). Default [] del commonBase.
      },
      ctx,
      {
        lut: "teal_orange.cube",
        kinetic: "karaoke",
        mirror: styleId === "broll_full",
        endScreen: true,
        progressBar: true,
        brandKit: true,
        iconStickers: true,
        lottieStickers: true,
      }
    );
  }

  if (styleId === "silent") {
    // Limpio "sin distracciones": solo grade de color, sin scene-fx/transiciones/kinetic.
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "bebas" as const,
        animations: ctx.keywords.slice(0, 3).map((kw, i) => ({
          at: kw.start,
          type: (i === 0 ? "zoom" : i === 1 ? "glow" : "shake") as "zoom" | "glow" | "shake",
        })),
      },
      ctx,
      { lut: "kodak_warm.cube", sceneFx: false, transitions: false, kinetic: "none" }
    );
  }

  if (styleId === "punch") {
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "bebas" as const,
        emphasisCards: buildEmphasisCards(ctx),
      },
      ctx,
      { lut: "vintage_film.cube", kinetic: "slide_up" }
    );
  }

  if (styleId === "hype") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        bRollMode: "pip" as const,
        vignette: true,
        wordStickers: buildStickers(ctx, 6),
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
      },
      ctx,
      { lut: "teal_orange.cube", kinetic: "pop", tracking: true, autoReframe: true }
    );
  }

  if (styleId === "hype_max") {
    const stickers = buildStickers(ctx, 6);
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        bRollMode: "pip" as const,
        vignette: true,
        captionBounce: true,
        enableJumpCuts: true,
        wordStickers: stickers,
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
        reactionZooms: pickKeywords(ctx, 3).slice(-3).map((kw) => ({
          at: kw.start,
          intensity: 1.42,
          duration: 0.22,
        })),
        stutterMarks: pickKeywords(ctx, 2).map((kw) => ({ at: Math.max(0, kw.start - 0.15), duration: 0.18 })),
      },
      ctx,
      { lut: "cyberpunk.cube", kinetic: "bounce", mirror: true, speedRamps: true, lottieStickers: true, autoReframe: true }
    );
  }

  if (styleId === "hype_max_sfx") {
    const stickers = buildStickers(ctx, 6);
    const sfxMarks = stickers.slice(0, 6).map((s, i) => ({
      at: s.at,
      sound: SFX_POOL[i % SFX_POOL.length],
      volume: 0.4,
    }));
    sfxMarks.unshift({ at: 0.3, sound: "swoosh.wav", volume: 0.35 });
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        bRollMode: "pip" as const,
        vignette: true,
        captionBounce: true,
        enableJumpCuts: true,
        wordStickers: stickers,
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
        reactionZooms: pickKeywords(ctx, 3).slice(-3).map((kw) => ({
          at: kw.start,
          intensity: 1.42,
          duration: 0.22,
        })),
        stutterMarks: pickKeywords(ctx, 2).map((kw) => ({ at: Math.max(0, kw.start - 0.15), duration: 0.18 })),
        sfxMarks,
      },
      ctx,
      { lut: "teal_orange.cube", kinetic: "pop", autoReframe: true }
    );
  }

  if (styleId === "supreme") {
    return applyCapcutFx({ ...buildSupremeStyle(ctx, styleId), graphics: true }, ctx, {
      lut: "kodak_warm.cube",
      kinetic: "karaoke",
      endScreen: true,
      progressBar: true,
      brandKit: true,
      iconStickers: true,
      speedRamps: true,
      lottieStickers: true,
      autoReframe: true,
    });
  }

  // POP REELS 2026 — caption nativo de TikTok: caja negra semi-opaca + contorno
  // grueso + palabra-por-palabra (kinetic "pop_reels"), fuente TikTok Sans.
  // Edición viral pero limpia. Paridad con remotion/style-templates.mjs.
  if (styleId === "pop_reels") {
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "anton",
        subtitleFont: "tiktok",
        vignette: false,
        captionBounce: false,
        wordStickers: buildStickers(ctx, 4),
        floatingEmojis: buildFloatingEmojis(ctx, 3),
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.12 })),
      },
      ctx,
      {
        lut: "teal_orange.cube",
        kinetic: "pop_reels",
        endScreen: true,
        progressBar: true,
        iconStickers: true,
      }
    );
  }

  // A3 — Estilo NUEVO "text_behind": bake en Python del texto detrás del sujeto.
  // auto-build corre text_behind_subject.py y setea foregroundVideoId al mp4 procesado.
  // Por encima va el resto del FX premium normal (subtítulos karaoke, etc.).
  if (styleId === "text_behind") {
    const topKw = pickKeywords(ctx, 1)[0]?.word ?? ctx.videoId;
    const phrase = topKw.toUpperCase().replace(/[.,;:!?¿¡]/g, "").slice(0, 18);
    return applyCapcutFx(
      {
        ...base,
        textBehind: { phrase, color: ctx.accentColor.replace("#", "") },
      },
      ctx,
      {
        lut: "teal_orange.cube",
        kinetic: "karaoke",
        endScreen: true,
        progressBar: true,
        brandKit: true,
      }
    );
  }

  // ─── graphics_pro: MODO GRÁFICOS & MOTION en shorts. Gráficas animadas + titulares
  // poderosos (los genera auto-build con applyGraphics desde el transcript) COMBINADO
  // con edición dinámica: zooms en keywords, transiciones, karaoke, stickers. ───
  if (styleId === "graphics_pro") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        vignette: true,
        captionBounce: true,
        wordStickers: buildStickers(ctx, 4),
        floatingEmojis: buildFloatingEmojis(ctx, 3),
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.12 })),
      },
      ctx,
      {
        lut: "teal_orange.cube",
        kinetic: "karaoke",
        endScreen: true,
        progressBar: true,
        lottieStickers: true,
      }
    );
  }

  // ─── EDITORIAL: split-screen documental. El video vive en un panel lateral y
  // el lado oscuro muestra tarjetas serif (kicker + titular + stat + capítulos) e
  // ilustraciones line-art doradas. SIN captions (las tarjetas son el texto),
  // SIN stickers/emojis/transiciones — la elegancia es el efecto. ───
  if (styleId === "editorial") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true, // genera editorialCards (+charts que editorial no usa)
        subtitleStyle: "anton" as const,
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "right" as const,
          // 16:9 → panel angosto tipo documental; 9:16 → casi media pantalla.
          panelWidth: (ctx.width ?? 1080) > (ctx.height ?? 1920) ? 0.34 : 0.46,
          // El color del wizard pinta TODO el tema: acentos, capítulos, line-art.
          accent: ctx.accentColor,
          // Motor de look (Ola 1): papel procedural + gráficos a 12 fps + capa
          // de cohesión (grano/viñeta). Proyectos viejos sin estos campos
          // renderizan idéntico (defaults off en el schema).
          texture: "paper" as const,
          fps12: true,
          cohesion: true,
        },
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── EDITORIAL CON ARCHIVO: el look editorial (panel + titulares serif + line-art)
  // COMBINADO con b-roll de archivo (Pexels) que ilustra lo que se dice. El sujeto
  // vive en el panel editorial; el lado oscuro muestra las tarjetas serif; y los clips
  // de archivo aparecen como cortinillas PIP (cuadrito con borde de acento, sobre el
  // lienzo) — así la elegancia editorial se mantiene y el archivo añade contexto visual.
  // auto-build llena `project.bRoll` con autoMatchBroll() de Pexels (cae a CC0 sin key).
  // Misma receta editorial + bRollMode "pip". editorialLayout y bRoll/pip coexisten en
  // ViralVideo sin tocar el render (el PIP flota sobre el panel/lienzo editorial). ───
  if (styleId === "editorial_broll") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true, // genera editorialCards (+charts que editorial no usa)
        subtitleStyle: "anton" as const,
        bRollMode: "pip" as const,
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "right" as const,
          panelWidth: (ctx.width ?? 1080) > (ctx.height ?? 1920) ? 0.34 : 0.46,
          accent: ctx.accentColor,
          texture: "paper" as const,
          fps12: true,
          cohesion: true,
        },
        // bRoll lo puebla auto-build (Pexels por keyword). Default [] del commonBase.
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── MOTION PRO: animación pura, limpia, SIN emojis/stickers. El protagonismo
  // es del motion design: fondo animado audio-reactivo + charts + karaoke minimal.
  if (styleId === "motion_pro" || styleId === "motion_beat" || styleId === "motion_grid") {
    const bgKind =
      styleId === "motion_beat" ? ("mesh" as const)
      : styleId === "motion_grid" ? ("grid" as const)
      : ("aurora" as const);
    const isBeat = styleId === "motion_beat";
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        vignette: true,
        captionBounce: false,
        // SIN wordStickers / floatingEmojis / emphasisCards — limpio a propósito.
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: isBeat ? 0.22 : 0.14,
        // Micro punch-ins sutiles (el director emocional suma más en los picos).
        zoomMarks: pickKeywords(ctx, isBeat ? 5 : 4).map((kw) => ({
          at: kw.start,
          duration: 0.5,
          scale: isBeat ? 1.1 : 1.08,
        })),
        ...(isBeat
          ? {
              reactionZooms: pickKeywords(ctx, 2).slice(-2).map((kw) => ({
                at: kw.start,
                intensity: 1.3,
                duration: 0.22,
              })),
            }
          : {}),
        animatedBackground: {
          kind: bgKind,
          colors: [ctx.accentColor, "#22d3ee", "#a78bfa"],
          opacity: isBeat ? 0.6 : 0.48,
          audioReactive: true,
        },
      },
      ctx,
      {
        lut: styleId === "motion_grid" ? "cyberpunk.cube" : "kodak_warm.cube",
        kinetic: "karaoke",
        endScreen: true,
        progressBar: true,
      }
    );
  }

  // ─── graphics_max: lo mismo PERO al máximo — jump cuts, reaction zooms, stutter,
  // speed ramps y mirror. Para quien quiere gráficos + la edición más intensa. ───
  if (styleId === "graphics_max") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        vignette: true,
        captionBounce: true,
        enableJumpCuts: true,
        wordStickers: buildStickers(ctx, 6),
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
        reactionZooms: pickKeywords(ctx, 3).slice(-3).map((kw) => ({
          at: kw.start,
          intensity: 1.42,
          duration: 0.22,
        })),
        stutterMarks: pickKeywords(ctx, 2).map((kw) => ({ at: Math.max(0, kw.start - 0.15), duration: 0.18 })),
      },
      ctx,
      {
        lut: "cyberpunk.cube",
        kinetic: "karaoke",
        mirror: true,
        speedRamps: true,
        endScreen: true,
        progressBar: true,
        iconStickers: true,
        lottieStickers: true,
      }
    );
  }

  // ─── kinetic_type: TIPOGRAFÍA CINÉTICA. El protagonismo es del texto — captions
  // gigantes palabra-por-palabra (pop_reels) sobre un fondo mesh que late con la
  // música. Limpio: SIN stickers/emojis, solo micro punch-ins sutiles. ───
  if (styleId === "kinetic_type") {
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "anton" as const,
        vignette: true,
        captionBounce: false,
        // SIN wordStickers / floatingEmojis — el texto cinético es el efecto.
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.18,
        // Micro punch-ins suaves en keywords (acompañan el ritmo del texto).
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.5, scale: 1.08 })),
        animatedBackground: {
          kind: "mesh" as const,
          colors: [ctx.accentColor, "#22d3ee", "#a78bfa"],
          opacity: 0.5,
          audioReactive: true,
        },
      },
      ctx,
      {
        lut: "kodak_warm.cube",
        kinetic: "pop_reels",
        endScreen: true,
        progressBar: true,
      }
    );
  }

  // ─── lottie_pop: ANIMADO CON STICKERS. Lleno de vida — stickers animados (Lottie)
  // + icon stickers + fondo aurora + karaoke. Para contenido juguetón y enérgico. ───
  if (styleId === "lottie_pop") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton" as const,
        vignette: true,
        captionBounce: true,
        wordStickers: buildStickers(ctx, 4),
        floatingEmojis: buildFloatingEmojis(ctx, 3),
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.12 })),
        animatedBackground: {
          kind: "aurora" as const,
          colors: [ctx.accentColor, "#22d3ee", "#a78bfa"],
          opacity: 0.48,
          audioReactive: true,
        },
      },
      ctx,
      {
        lut: "teal_orange.cube",
        kinetic: "karaoke",
        lottieStickers: true,
        iconStickers: true,
        endScreen: true,
        progressBar: true,
      }
    );
  }

  // ─── paper_cut: PAPEL RECORTADO. El collage editorial promovido a estilo propio:
  // tu video en un panel de papel recortado + titulares serif. Reusa editorialLayout
  // (auto-build corre applyEditorialCutout para cualquier proyecto con editorialLayout). ───
  if (styleId === "paper_cut") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true, // genera editorialCards (+charts que paper_cut curará)
        subtitleStyle: "anton" as const,
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "left" as const,
          // 16:9 → panel angosto; 9:16 → casi media pantalla (igual que editorial).
          panelWidth: (ctx.width ?? 1080) > (ctx.height ?? 1920) ? 0.34 : 0.46,
          accent: ctx.accentColor,
          // Tema collage + papel procedural: el motor de look del editorial-layer.
          theme: "riso" as const,
          texture: "paper" as const,
          fps12: true,
          cohesion: true,
        },
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── CINE CLÁSICO: cine antiguo editorial. Base ELEGANTE: subtítulos cine
  // (serif limpio), film grain ON, LUT desaturado/cálido (kodak_warm), viñeta,
  // música baja. La DRAMA por-pico (imagen B&W + grano, SFX de máquina de
  // escribir/proyector y la voz "a radio vieja") la computa auto-build a partir
  // de los picos del director emocional (emotion_director.py): emite bwWindows +
  // sfxMarks en cada ventana de pico y construye el -af telefónico gateado por
  // ventana. Si ese paso falla, este estilo renderiza igual como cine elegante. ───
  if (styleId === "cine_clasico") {
    const cineDensity = ctx.cinematicDensity ?? "medium";
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "cinematic" as const,
        bRollMode: "fullscreen" as const,
        vignette: true,
        filmGrain: true,
        cinematicDensity: cineDensity,
        // Vaivén de cámara cinematográfico suave (lo pisa autoCameraMoves si hay overlays).
        cameraMoves:
          base.cameraMoves.length > 0
            ? base.cameraMoves
            : generateCameraMoves(ctx.duration, cineDensity),
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.1,
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none" }
    );
  }

  return base;
}

// STYLE_INFO se DERIVA ahora del registro central (mismos valores que antes,
// una sola fuente). Se re-exporta con el MISMO nombre y desde el MISMO archivo
// para que ningún consumidor cambie su import.
export { STYLE_INFO_FROM_REGISTRY as STYLE_INFO } from "./style-registry";

export const PALETTE: { name: string; value: string; mood: string }[] = [
  { name: "rosa coral", value: "#fb7185", mood: "urgencia" },
  { name: "violeta", value: "#a78bfa", mood: "autoridad" },
  { name: "amarillo", value: "#fbbf24", mood: "claridad" },
  { name: "emerald", value: "#34d399", mood: "crecimiento" },
  { name: "cyan", value: "#22d3ee", mood: "tech" },
  { name: "magenta", value: "#ec4899", mood: "intensidad" },
  { name: "naranja", value: "#fb923c", mood: "acción" },
  { name: "lime", value: "#a3e635", mood: "energía" },
  { name: "indigo", value: "#6366f1", mood: "IA" },
  { name: "violeta claro", value: "#c084fc", mood: "elegancia" },
];
