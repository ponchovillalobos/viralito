/**
 * Copia JS de frontend/src/lib/style-templates.ts y viral-emojis.ts.
 *
 * Por qué duplicar: Remotion corre en Node puro y no compila TS in-line.
 * Si en el futuro extraemos esto a un workspace compartido vía pnpm/turbo,
 * unificamos. Por ahora la duplicación es controlada y se documenta.
 *
 * **NUNCA editar este archivo sin actualizar la versión TS también** — son
 * la misma lógica. Tests E2E verifican que ambas producen output equivalente.
 *
 * 2026-06 — Re-sincronizado con style-templates.ts: este archivo había quedado
 * en la versión PRE-CapCut-FX (sin LUT/scene-fx/transiciones/kinetic/mirror/
 * icon-stickers/speed-ramps), por lo que los clips de largos renderizaban sin
 * esos efectos que los cortos sí tienen. Ahora porta applyCapcutFx y todos los
 * generadores, así largos queda a paridad con shorts.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";

// ─── viral-emojis (port) ──────────────────────────────────────────────────

const VIRAL_EMOJIS_BY_CATEGORY = {
  fire_hype: ["🔥", "💥", "⚡", "🌟", "✨", "💫", "🚀", "💯", "💢", "🆙", "🎆", "🎇", "☄️", "♨️", "💨", "‼️", "⭐"],
  faces_reaction: ["😱", "🤯", "😮", "🤩", "😎", "🥶", "🤑", "😤", "🥲", "😏", "😳", "😬", "🫨", "🥹", "😭", "🤔", "🙄", "😩", "😵", "😍", "🤤", "🤐", "🤫", "🤨", "😈", "🤠", "🥸", "🫠", "🫡", "🤪"],
  money_business: ["💰", "💵", "💸", "💳", "📈", "📉", "📊", "🏆", "🥇", "🪙", "💎", "💼", "🏦", "📦", "🧾", "💹", "🎰"],
  tech_ai: ["💻", "🖥️", "📱", "🤖", "🧠", "⚙️", "🛠️", "🔌", "🔋", "📡", "🛰️", "🎛️", "⌚", "🖲️", "💾"],
  hands_gestures: ["👀", "👆", "👇", "👈", "👉", "👌", "👍", "👎", "👏", "🙌", "👋", "🤝", "💪", "🫵", "🤙", "✊", "🤌", "🫶", "☝️", "🤞", "🤟", "✌️", "🤘"],
  hearts_love: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💗", "💓", "💞", "❤️‍🔥", "💔", "💘", "💝", "💌"],
  symbols_action: ["💡", "💭", "💬", "🗨️", "📢", "📣", "🔔", "🔊", "🎯", "🎬", "🎤", "🎵", "🎉", "🎊", "🎁", "🏅", "🎖️", "🪄"],
  warning_alert: ["⚠️", "❌", "🚫", "⛔", "🛑", "⁉️", "❗", "❓", "🚨", "🆘"],
  objects_signals: ["📌", "📍", "🎲", "🔑", "🗝️", "🔐", "🔒", "🏁", "🎓", "📚", "📖", "📰", "🗞️", "✂️", "📎"],
  nature_aesthetic: ["🌈", "☀️", "🌙", "🌠", "❄️", "💧", "🌊", "🍀", "🌹", "🌻", "🌸", "🌴", "🌵", "🌎", "🌍", "🌌"],
  food_viral: ["🍕", "🍔", "🌮", "🍿", "🍩", "🍪", "🍰", "🎂", "☕", "🧋", "🍷", "🥂", "🍾"],
  sport_dynamic: ["🏀", "⚽", "🏈", "⚾", "🎾", "🥊", "🏋️", "🤸", "🏇", "🏎️", "🚴", "🥋", "🎳"],
};

const VIRAL_EMOJIS_FLAT = Array.from(
  new Set(Object.values(VIRAL_EMOJIS_BY_CATEGORY).flat())
);

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRng(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function pickEmojis(seed, count) {
  const rng = seededRng(hashString(seed));
  const pool = VIRAL_EMOJIS_FLAT.slice();
  const last = Math.max(0, pool.length - count);
  for (let i = pool.length - 1; i >= last; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(last).reverse();
}

// ─── style-templates (port) ───────────────────────────────────────────────

const SFX_POOL = ["swoosh.wav", "water_drop.ogg", "pop.ogg", "ding.ogg", "bloop.ogg", "notification.ogg", "thud.wav", "swoosh_quick.wav", "ding_bell.ogg"];

/** Camera moves auto-distribuidos (solo modo cinematográfico). */
export function generateCameraMoves(duration, density = "medium") {
  const cfg = {
    low: { gap: 14, intensity: 0.1, dur: 2.0 },
    medium: { gap: 7, intensity: 0.16, dur: 2.5 },
    high: { gap: 4, intensity: 0.22, dur: 3.0 },
  }[density];
  const types = ["zoom_in", "pan_right", "zoom_out", "pan_left"];
  const moves = [];
  let cursor = 3;
  let i = 0;
  while (cursor < duration - cfg.dur - 1) {
    moves.push({
      at: +cursor.toFixed(2),
      duration: cfg.dur,
      type: types[i % 4],
      intensity: cfg.intensity + (i % 3) * 0.01,
    });
    cursor += cfg.gap + (i % 3);
    i++;
  }
  return moves;
}

/** Jump cuts en pausas del transcript (gaps >0.4s). */
export function generateJumpCuts(transcript, density = "medium") {
  const maxJumps = { low: 0, medium: 3, high: 6 }[density];
  if (maxJumps === 0) return [];
  const candidates = [];
  for (let i = 1; i < transcript.length; i++) {
    const gap = transcript[i].start - transcript[i - 1].end;
    if (gap > 0.4) {
      candidates.push({ gap, at: +(transcript[i].start - 0.1).toFixed(2) });
    }
  }
  candidates.sort((a, b) => b.gap - a.gap);
  return candidates.slice(0, maxJumps).map((c) => ({ at: c.at, duration: 0.18 }));
}

// ─────────────────── CapCut Pro FX — generadores compartidos ─────────────────

/** LUTs disponibles en remotion/public/luts. */
const LUT_POOL = ["teal_orange.cube", "kodak_warm.cube", "cyberpunk.cube", "vintage_film.cube"];

/** Elige un LUT determinísticamente por videoId. */
export function pickLut(ctx) {
  let h = 0;
  const s = `${ctx.videoId}:lut`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return LUT_POOL[h % LUT_POOL.length];
}

/** Overlays atmosféricos (light leak / bokeh / glow / dust). */
export function generateSceneFx(ctx) {
  const d = ctx.duration;
  const c = ctx.accentColor;
  const fx = [
    { at: 0.2, duration: 1.4, kind: "light_leak", color: "#ff8a3d", opacity: 0.5, intensity: 1, seed: 1 },
    { at: +(d * 0.33).toFixed(2), duration: 2.5, kind: "bokeh", color: c, opacity: 0.42, intensity: 1, seed: 2 },
    { at: +(d * 0.55).toFixed(2), duration: 1.2, kind: "glow", color: c, opacity: 0.38, intensity: 1, seed: 3 },
    { at: +(d * 0.72).toFixed(2), duration: 3.0, kind: "dust", color: "#ffffff", opacity: 0.3, intensity: 1, seed: 4 },
  ];
  if (d > 8) {
    fx.push({ at: +(d - 2).toFixed(2), duration: 1.6, kind: "light_leak", color: "#ff8a3d", opacity: 0.5, intensity: 1, seed: 5 });
  }
  return fx.filter((f) => f.at < d);
}

/** Transiciones pro (whip/zoom/glitch/flash/reveal/streak/swipe/iris). */
export function generateProTransitions(ctx) {
  // F3 (paridad con .ts): flip3d = giro 3D del frame con perspectiva.
  const kinds = [
    "whip", "zoom_punch", "flip3d", "light_streak", "glitch",
    "swipe_blur", "reveal_lr", "iris", "flash",
  ];
  const kws = ctx.keywords.filter((k) => k.start > 1 && k.start < ctx.duration - 1).slice(0, 6);
  return kws.map((kw, i) => ({
    at: +Math.max(0, kw.start - 0.1).toFixed(2),
    kind: kinds[i % kinds.length],
    durationFrames: 8,
    color: "#ffffff",
  }));
}

/** Momentos kaleidoscópicos (mirror/clone/split). */
export function generateMirrorFx(ctx) {
  const kinds = ["mirror_v", "clone_3", "mirror_h"];
  const kws = ctx.keywords
    .filter((k) => k.start > ctx.duration * 0.2 && k.start < ctx.duration * 0.85)
    .slice(0, 2);
  return kws.map((kw, i) => ({
    at: +kw.start.toFixed(2),
    duration: 0.8,
    kind: kinds[i % kinds.length],
  }));
}

/** Labels (keyword + emoji) que siguen la cara del sujeto (motion tracking). */
export function generateTrackedItems(ctx) {
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

const ICON_POOL = ["fire", "lightbulb", "target", "rocket", "zap", "trending", "crown"];

/** B5 — 3-5 icon stickers por keyword, rotando por ICON_POOL. */
export function generateIconStickers(ctx) {
  const kws = pickKeywords(ctx, 4);
  const positions = ["top-right", "top-left", "bottom-right", "bottom-left"];
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

/** A4 — 2 speed ramps (slow-mo 0.5x ~1.2s) en keywords visuales. */
export function generateSpeedRamps(ctx) {
  const kws = pickKeywords(ctx, 2);
  return kws.map((kw) => ({
    at: +Math.max(0.5, kw.start - 0.05).toFixed(2),
    duration: 1.2,
    rate: 0.5,
  }));
}

/** B4 — stickers animados (Lottie) en keywords clave. Alterna animación y esquina. */
export function generateLottieStickers(ctx) {
  const kws = pickKeywords(ctx, 4);
  const names = ["sparkle", "star5", "arrow_down", "pulse_ring"];
  const positions = ["top-right", "top-left", "bottom-right"];
  return kws.map((kw, i) => ({
    at: +Math.max(0.4, kw.start - 0.15).toFixed(2),
    duration: 1.6,
    name: names[i % names.length],
    position: positions[i % positions.length],
    size: 240,
    color: ctx.accentColor,
  }));
}

/**
 * Suma las recetas CapCut (LUT, scene-fx, transiciones, kinetic, mirror, tracking,
 * end-screen, progress-bar, brand-kit, icon-stickers, auto-reframe, speed-ramps) a
 * CUALQUIER proyecto de estilo. Aditivo: todos los campos son opt-in del schema.
 */
function applyCapcutFx(project, ctx, opts = {}) {
  return {
    ...project,
    lut: opts.lut ?? pickLut(ctx),
    sceneFx: opts.sceneFx === false ? [] : generateSceneFx(ctx),
    proTransitions: opts.transitions === false ? [] : generateProTransitions(ctx),
    kineticPreset: opts.kinetic ?? "none",
    mirrorFx: opts.mirror ? generateMirrorFx(ctx) : [],
    ...(opts.tracking
      ? { tracking: true, trackedItems: generateTrackedItems(ctx), trackPath: [] }
      : {}),
    ...(opts.endScreen
      ? {
          endScreen: {
            text: "Seguime para más",
            emoji: "🔥",
            accent: ctx.accentColor,
            durationSec: 2.5,
          },
        }
      : {}),
    ...(opts.progressBar ? { progressBar: true } : {}),
    ...(opts.brandKit ? { brandKit: { handle: "", position: "bottom-right" } } : {}),
    ...(opts.iconStickers ? { iconStickers: generateIconStickers(ctx) } : {}),
    ...(opts.autoReframe
      ? {
          autoReframe: true,
          ...(opts.tracking ? {} : { tracking: true, trackedItems: [], trackPath: [] }),
        }
      : {}),
    ...(opts.speedRamps ? { speedRamps: generateSpeedRamps(ctx) } : {}),
    ...(opts.lottieStickers ? { lottieStickers: generateLottieStickers(ctx) } : {}),
  };
}

function pickKeywords(ctx, count) {
  return ctx.keywords.slice(0, count);
}

function buildStickers(ctx, count) {
  const emojis = pickEmojis(`${ctx.videoId}:stickers`, count);
  return pickKeywords(ctx, count).map((kw, i) => ({
    at: kw.start,
    duration: 1.5,
    word: kw.word.toUpperCase().replace(/[.,;:!?¿¡]/g, "").slice(0, 24),
    emoji: emojis[i] ?? "✨",
    position: "top-center",
    rotation: 0,
    bg: ctx.accentColor,
    color: "#0a0a0a",
  }));
}

function buildFloatingEmojis(ctx, count) {
  const emojis = pickEmojis(`${ctx.videoId}:floating`, count);
  const result = [];
  for (let i = 0; i < count; i++) {
    const at = ((i + 0.5) * ctx.duration) / count;
    result.push({
      at: +at.toFixed(2),
      duration: 1.3,
      emoji: emojis[i] ?? "✨",
      from: i % 2 === 0 ? "left" : "right",
      size: 220,
      yOffset: 0,
    });
  }
  return result;
}

function buildEmphasisCards(ctx) {
  const first = ctx.keywords[0];
  const mid = ctx.keywords[Math.floor(ctx.keywords.length / 2)];
  const hookWord = first ? first.word.toUpperCase().slice(0, 16) : "ATENCION";
  const midWord = mid ? mid.word.toUpperCase().slice(0, 16) : "CLAVE";
  const [eHook, eMid, eSave] = pickEmojis(`${ctx.videoId}:emphasis`, 3);
  return [
    { at: 0.4, duration: 1.2, word: hookWord, emoji: eHook ?? "🔥", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
    { at: Math.max(2, ctx.duration * 0.5), duration: 1.2, word: midWord, emoji: eMid ?? "💡", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
    { at: Math.max(ctx.duration - 2.5, ctx.duration - 3), duration: 1.5, word: "GUARDALO", emoji: eSave ?? "📌", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
  ];
}

function commonBase(ctx, styleId) {
  // Modo cinematográfico: hay imágenes subidas por el user.
  const isCinematic = (ctx.imageOverlays?.length ?? 0) > 0;
  return {
    id: `${ctx.videoId}_${styleId}`,
    videoId: ctx.videoId,
    day: ctx.day ?? null,
    // Preservar el comportamiento del .mjs (ctx.platforms si viene; default si no).
    platforms: ctx.platforms ?? ["tiktok", "instagram"],
    styleId,
    accentColor: ctx.accentColor,
    caption: ctx.caption ?? "",
    status: "borrador",
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
    stutterMarks: isCinematic && ctx.autoStutterMarks ? ctx.autoStutterMarks : [],
    sfxMarks: isCinematic && ctx.autoSfxMarks ? ctx.autoSfxMarks : [],
    manualSubtitles: [],
    captionBounce: false,
    enableJumpCuts: isCinematic,
    bRollMode: "fullscreen",
    vignette: isCinematic || ctx.subtitleCinematic === true || ctx.filmGrain === true,
    subtitleStyle: ctx.subtitleCinematic || isCinematic ? "cinematic" : "bebas",
    width: ctx.width ?? 1080,
    height: ctx.height ?? 1920,
    imageOverlays: ctx.imageOverlays ?? [],
    cameraMoves: isCinematic && ctx.autoCameraMoves ? ctx.autoCameraMoves : [],
    filmGrain: isCinematic ? true : (ctx.filmGrain ?? false),
    cinematicDensity: ctx.cinematicDensity ?? "medium",
  };
}

/** Variante "supreme": premium full-stack. */
function buildSupremeStyle(ctx, styleId) {
  const base = commonBase(ctx, styleId);
  const stickerEmojis = pickEmojis(`${ctx.videoId}:supreme:stickers`, 6);
  const sideEmojis = pickEmojis(`${ctx.videoId}:supreme:floating`, 4);

  const stickers = [];
  const keywordList = pickKeywords(ctx, 6);
  for (let i = 0; i < keywordList.length; i++) {
    const kw = keywordList[i];
    if (kw.start > 0.5 && kw.start < ctx.duration - 2) {
      stickers.push({
        at: +kw.start.toFixed(2),
        duration: 1.5,
        word: kw.word.toUpperCase().replace(/[.,;:!?¿¡]/g, "").slice(0, 24),
        emoji: stickerEmojis[i] ?? "✨",
        position: "top-center",
        rotation: 0,
        bg: ctx.accentColor,
        color: "#0a0a0a",
      });
    }
  }
  stickers.sort((a, b) => a.at - b.at);

  const hookSource = ctx.hookOverride ?? ctx.keywords[0]?.word ?? "MIRA ESTO";
  const themeSource = ctx.themeOverride ?? ctx.keywords[Math.floor(ctx.keywords.length / 2)]?.word ?? hookSource;
  const hookText = String(hookSource).replace(/[^\w áéíóúñÁÉÍÓÚÑ]/g, "").trim().slice(0, 24).toUpperCase();
  const themeText = String(themeSource).replace(/[^\w áéíóúñÁÉÍÓÚÑ]/g, "").trim().slice(0, 22).toUpperCase();

  const emphasisCards = [
    { at: 0.4, duration: 1.2, word: hookText.split(" ").slice(0, 3).join(" ") || "ATENCION", emoji: "🔥", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
    { at: Math.max(2, ctx.duration * 0.5 - 0.5), duration: 1.2, word: themeText.split(" ").slice(0, 3).join(" ") || "INSIGHT", emoji: "💡", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor },
  ];
  if (ctx.duration > 25) {
    emphasisCards.push({ at: Math.max(ctx.duration - 2.5, ctx.duration - 3), duration: 1.6, word: "GUARDALO", emoji: "📌", bg: "#0a0a0a", color: "#ffffff", accent: ctx.accentColor });
  }

  const emojiCount = ctx.duration > 40 ? 4 : 3;
  const floatingEmojis = [];
  for (let i = 0; i < emojiCount; i++) {
    const at = ((i + 0.5) * ctx.duration) / emojiCount;
    const tooClose = stickers.some((s) => Math.abs(s.at - at) < 1.0);
    if (tooClose) continue;
    floatingEmojis.push({
      at: +at.toFixed(2),
      duration: 1.3,
      emoji: sideEmojis[i] ?? "✨",
      from: i % 2 === 0 ? "left" : "right",
      size: 220,
      yOffset: 0,
    });
  }

  const zoomMarks = stickers.slice(0, 5).map((s) => ({ at: s.at, duration: 0.6, scale: 1.14 }));
  zoomMarks.unshift({ at: 0.3, duration: 0.7, scale: 1.18 });

  const reactionZooms = emphasisCards.map((e) => ({ at: +(e.at + 0.05).toFixed(2), intensity: 1.42, duration: 0.22 }));

  const stutterMarks = [];
  if (emphasisCards[1]) stutterMarks.push({ at: +(emphasisCards[1].at - 0.2).toFixed(2), duration: 0.18 });
  if (emphasisCards[2]) stutterMarks.push({ at: +(emphasisCards[2].at - 0.2).toFixed(2), duration: 0.18 });

  const sfxMarks = [];
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
      sfxMarks.push({ at: s.at, sound: SFX_POOL[(i + 2) % SFX_POOL.length], volume: 0.35 });
    }
  });
  sfxMarks.sort((a, b) => a.at - b.at);

  return {
    ...base,
    subtitleStyle: "anton",
    bRollMode: "pip",
    vignette: true,
    captionBounce: true,
    enableJumpCuts: false,
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
 * Pool de música de fondo. Devuelve null si no hay archivos (Remotion <Audio>
 * con URL 404 rompe el render). Sólo lo usan cinematic_pro/broll_* — que el
 * pipeline de largos NO ofrece — así que en la práctica acá devuelve null.
 */
function pickRandomMusicTrack(seed, mood) {
  try {
    const candidates = ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"];
    let dataRoot = process.env.VIRAL_DATA_ROOT;
    if (!dataRoot) {
      for (const c of candidates) {
        if (existsSync(c)) { dataRoot = c; break; }
      }
    }
    if (!dataRoot) return null;
    const MUSIC_DIR = nodePath.join(dataRoot, "assets", "music");
    const folders = [
      nodePath.join(MUSIC_DIR, "pixabay"),
      nodePath.join(MUSIC_DIR, "freesound"),
      nodePath.join(MUSIC_DIR, "github"),
      MUSIC_DIR,
    ];
    const files = [];
    for (const folder of folders) {
      try {
        for (const f of readdirSync(folder)) {
          if (/\.(mp3|wav|m4a|ogg)$/i.test(f)) files.push(f);
        }
      } catch {
        // carpeta no existe
      }
    }
    if (files.length === 0) return null;
    // Filtro por mood (filenames nuevos: incompetech-epic-..., chosic-calm-...)
    let pool = files;
    if (mood) {
      const token = `-${mood.toLowerCase()}-`;
      const filtered = files.filter((f) => f.toLowerCase().includes(token));
      if (filtered.length > 0) pool = filtered;
    }
    pool = [...pool].sort(); // orden estable, independiente del orden de readdir
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    let pick = pool[h % pool.length];
    // Rotación anti-repetición (MISMA lógica que frontend/src/lib/style-templates.ts):
    // mismo videoId → misma pista (assignments); videoId nuevo que cae en la última
    // pista usada por OTRO video → siguiente del pool.
    const rotPath = nodePath.join(MUSIC_DIR, "music-rotation.json");
    try {
      let rot = {};
      try {
        rot = JSON.parse(readFileSync(rotPath, "utf-8"));
      } catch {
        // sin estado previo
      }
      const assignments = rot.assignments ?? {};
      const prev = assignments[seed];
      if (prev && files.includes(prev)) {
        pick = prev; // re-render del mismo video: respeta la asignación original
      } else if (pool.length > 1 && rot.lastFile === pick && rot.lastVideoId !== seed) {
        pick = pool[(h + 1) % pool.length];
      }
      assignments[seed] = pick;
      const keys = Object.keys(assignments);
      if (keys.length > 300) {
        for (const k of keys.slice(0, keys.length - 300)) delete assignments[k];
      }
      writeFileSync(rotPath, JSON.stringify({ lastFile: pick, lastVideoId: seed, assignments }));
    } catch {
      // si el JSON no se puede leer/escribir, seguimos con el pick por hash
    }
    return `/api/music/stream?file=${encodeURIComponent(pick)}`;
  } catch {
    return null;
  }
}

export function buildProjectForStyle(ctx, styleId) {
  const base = commonBase(ctx, styleId);

  if (styleId === "cinematic_pro") {
    const cineDensity = ctx.cinematicDensity ?? "medium";
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "cinematic",
        // Letra SERIF editorial (Playfair) en vez de display → look más profesional, de cine.
        subtitleFont: "playfair",
        bRollMode: "fullscreen",
        vignette: true,
        filmGrain: true,
        cinematicDensity: cineDensity,
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

  if (styleId === "broll_full" || styleId === "broll_pip") {
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "anton",
        bRollMode: styleId === "broll_full" ? "fullscreen" : "pip",
        vignette: true,
        captionBounce: false,
        wordStickers: buildStickers(ctx, 5),
        floatingEmojis: buildFloatingEmojis(ctx, 3),
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.12 })),
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.2,
        beatSync: true,
        removeBg: styleId === "broll_pip",
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
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "bebas",
        animations: ctx.keywords.slice(0, 3).map((kw, i) => ({
          at: kw.start,
          type: i === 0 ? "zoom" : i === 1 ? "glow" : "shake",
        })),
      },
      ctx,
      { lut: "kodak_warm.cube", sceneFx: false, transitions: false, kinetic: "none" }
    );
  }

  if (styleId === "punch") {
    return applyCapcutFx(
      { ...base, subtitleStyle: "bebas", emphasisCards: buildEmphasisCards(ctx) },
      ctx,
      { lut: "vintage_film.cube", kinetic: "slide_up" }
    );
  }

  if (styleId === "hype") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        bRollMode: "pip",
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
        subtitleStyle: "anton",
        bRollMode: "pip",
        vignette: true,
        captionBounce: true,
        enableJumpCuts: true,
        wordStickers: stickers,
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
        reactionZooms: pickKeywords(ctx, 3).slice(-3).map((kw) => ({ at: kw.start, intensity: 1.42, duration: 0.22 })),
        stutterMarks: pickKeywords(ctx, 2).map((kw) => ({ at: Math.max(0, kw.start - 0.15), duration: 0.18 })),
      },
      ctx,
      { lut: "cyberpunk.cube", kinetic: "bounce", mirror: true, speedRamps: true, lottieStickers: true, autoReframe: true }
    );
  }

  if (styleId === "hype_max_sfx") {
    const stickers = buildStickers(ctx, 6);
    const sfxMarks = stickers.slice(0, 6).map((s, i) => ({ at: s.at, sound: SFX_POOL[i % SFX_POOL.length], volume: 0.4 }));
    sfxMarks.unshift({ at: 0.3, sound: "swoosh.wav", volume: 0.35 });
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        bRollMode: "pip",
        vignette: true,
        captionBounce: true,
        enableJumpCuts: true,
        wordStickers: stickers,
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
        reactionZooms: pickKeywords(ctx, 3).slice(-3).map((kw) => ({ at: kw.start, intensity: 1.42, duration: 0.22 })),
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

  // ─── POP REELS 2026 (paridad con shorts): caption nativo de TikTok — caja negra
  //     semi-opaca + contorno grueso + palabra-por-palabra (kinetic "pop_reels"),
  //     fuente TikTok Sans. Edición viral pero limpia. ───
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

  // ─── graphics_pro: MODO GRÁFICOS & MOTION (paridad con shorts/style-templates.ts).
  // Las gráficas/íconos los genera generate_graphics.py → long_form/graphics/{clipId}.json
  // y build-clip-props los mergea. Acá va la edición dinámica que las acompaña. ───
  if (styleId === "graphics_pro") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
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

  // ─── EDITORIAL (paridad con shorts): split-screen documental, sin captions. ───
  if (styleId === "editorial") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "right",
          panelWidth: ctx.width > ctx.height ? 0.34 : 0.46,
          // Editorial = PANEL en vertical Y horizontal: el video original (sin recortar,
          // en movimiento) vive en un panel y el texto + ilustraciones line-art animadas
          // van al COSTADO (pedido del usuario). El fullscreen es el estilo editorial_full.
          fullBleed: false,
          // El color del wizard pinta TODO el tema: acentos, capítulos, line-art.
          accent: ctx.accentColor,
          // Motor de look (Ola 1) — paridad con shorts.
          texture: "paper",
          fps12: true,
          cohesion: true,
        },
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── EDITORIAL PANTALLA COMPLETA (documental): el video ORIGINAL ocupa todo el
  //     frame (sin panel lateral, sin recortar) y la tipografía editorial + el grade
  //     van SUPERPUESTOS como lower-third sobre un degradado. Ideal 16:9 horizontal:
  //     mantiene el formato original del material y suma el look editorial. ───
  if (styleId === "editorial_full") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "right",        // ignorado en fullBleed
          panelWidth: 0.4,
          accent: ctx.accentColor,
          texture: "none",       // sin textura de papel ENCIMA del video
          fps12: true,
          cohesion: false,       // sin gate-weave: el video manda, el texto firme
          fullBleed: true,       // PANTALLA COMPLETA + tipografía superpuesta
        },
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── EDITORIAL CON ARCHIVO (paridad con shorts): look editorial + b-roll de archivo
  //     (Pexels) en cortinillas PIP. En largos el b-roll automático NO está cableado,
  //     pero el editorialLayout renderiza idéntico; el bloque existe para la paridad. ───
  if (styleId === "editorial_broll") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        bRollMode: "pip",
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "right",
          panelWidth: ctx.width > ctx.height ? 0.34 : 0.46,
          // Editorial = PANEL en vertical Y horizontal: el video original (sin recortar,
          // en movimiento) vive en un panel y el texto + ilustraciones line-art animadas
          // van al COSTADO (pedido del usuario). El fullscreen es el estilo editorial_full.
          fullBleed: false,
          accent: ctx.accentColor,
          texture: "paper",
          fps12: true,
          cohesion: true,
        },
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── MOTION PRO (paridad con shorts): animación pura, limpia, SIN emojis. ───
  if (styleId === "motion_pro" || styleId === "motion_beat" || styleId === "motion_grid") {
    const bgKind =
      styleId === "motion_beat" ? "mesh" : styleId === "motion_grid" ? "grid" : "aurora";
    const isBeat = styleId === "motion_beat";
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        vignette: true,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: isBeat ? 0.22 : 0.14,
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

  // ─── graphics_max: gráficos + la edición más intensa (paridad con shorts). ───
  if (styleId === "graphics_max") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        vignette: true,
        captionBounce: true,
        enableJumpCuts: true,
        wordStickers: buildStickers(ctx, 6),
        floatingEmojis: buildFloatingEmojis(ctx, 4),
        zoomMarks: pickKeywords(ctx, 5).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.14 })),
        reactionZooms: pickKeywords(ctx, 3).slice(-3).map((kw) => ({ at: kw.start, intensity: 1.42, duration: 0.22 })),
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

  // ─── kinetic_type (paridad con shorts): TIPOGRAFÍA CINÉTICA — captions gigantes
  //     palabra-por-palabra (pop_reels) sobre fondo mesh que late, sin emojis. ───
  if (styleId === "kinetic_type") {
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "anton",
        vignette: true,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.18,
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.5, scale: 1.08 })),
        animatedBackground: {
          kind: "mesh",
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

  // ─── lottie_pop (paridad con shorts): ANIMADO CON STICKERS — stickers animados
  //     (Lottie) + icon stickers + fondo aurora + karaoke. Juguetón y enérgico. ───
  if (styleId === "lottie_pop") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        vignette: true,
        captionBounce: true,
        wordStickers: buildStickers(ctx, 4),
        floatingEmojis: buildFloatingEmojis(ctx, 3),
        zoomMarks: pickKeywords(ctx, 4).map((kw) => ({ at: kw.start, duration: 0.6, scale: 1.12 })),
        animatedBackground: {
          kind: "aurora",
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

  // ─── paper_cut (paridad con shorts): PAPEL RECORTADO — collage editorial como
  //     estilo propio. Reusa editorialLayout (applyEditorialCutout lo enriquece). ───
  if (styleId === "paper_cut") {
    return applyCapcutFx(
      {
        ...base,
        graphics: true,
        subtitleStyle: "anton",
        vignette: false,
        captionBounce: false,
        musicTrack: pickRandomMusicTrack(ctx.videoId),
        musicVolume: 0.06,
        editorialLayout: {
          panel: "left",
          panelWidth: ctx.width > ctx.height ? 0.34 : 0.46,
          // Editorial = PANEL en vertical Y horizontal: el video original (sin recortar,
          // en movimiento) vive en un panel y el texto + ilustraciones line-art animadas
          // van al COSTADO (pedido del usuario). El fullscreen es el estilo editorial_full.
          fullBleed: false,
          accent: ctx.accentColor,
          theme: "riso",
          texture: "paper",
          fps12: true,
          cohesion: true,
        },
      },
      ctx,
      { lut: "kodak_warm.cube", kinetic: "none", sceneFx: false, transitions: false }
    );
  }

  // ─── CINE CLÁSICO (paridad con shorts): cine antiguo editorial. Base elegante —
  //     subtítulos cine, film grain, LUT desaturado/cálido, viñeta, música baja.
  //     La drama por-pico (B&W + SFX + voz a radio vieja) la computa auto-build a
  //     partir de los picos del director emocional; en largos NO está cableada, pero
  //     el look base renderiza idéntico y el bloque existe para la paridad. ───
  if (styleId === "cine_clasico") {
    const cineDensity = ctx.cinematicDensity ?? "medium";
    return applyCapcutFx(
      {
        ...base,
        subtitleStyle: "cinematic",
        bRollMode: "fullscreen",
        vignette: true,
        filmGrain: true,
        cinematicDensity: cineDensity,
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
