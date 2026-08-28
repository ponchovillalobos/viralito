import { writeFileSync } from "node:fs";
import path from "node:path";

import { existsSync as _existsSync } from "node:fs";
import { pickDataRoot } from "./data-root.mjs";
const DATA_ROOT = pickDataRoot();
const PROJECTS_DIR = path.join(DATA_ROOT, "projects");

const SFX_POOL = ["swoosh.wav", "water_drop.ogg", "pop.ogg", "ding.ogg", "bloop.ogg", "notification.ogg", "thud.wav", "swoosh_quick.wav", "ding_bell.ogg", "splash.ogg"];

function sfxAt(at, idx, volume = 0.4) {
  return { at, sound: SFX_POOL[idx % SFX_POOL.length], volume };
}

const projects = [
  {
    id: "D06_vendedor_toxico",
    day: 6,
    accent: "#ec4899",
    caption: "Dejá de ser ese vendedor tóxico que solo quiere ganar. La diferencia entre manipular y persuadir está en la libertad del otro.\n\nCompartelo a ese 'cocodrilo' que ves todos los días.\n\n#ventasconia #neuroventas #ventasb2b #persuasion",
    bRoll: [
      { start: 8.0, end: 14.0, url: "https://videos.pexels.com/video-files/5644246/5644246-hd_1080_2048_25fps.mp4" },
      { start: 50.0, end: 56.0, url: "https://videos.pexels.com/video-files/7564013/7564013-hd_1080_1920_30fps.mp4" },
    ],
    stickers: [
      { at: 0.5, word: "TOXICO", emoji: "☠️" },
      { at: 11.7, word: "MANIPULADOR", emoji: "🎭" },
      { at: 20.3, word: "PERSUADIR", emoji: "🤝" },
      { at: 26.9, word: "LIBERTAD", emoji: "🕊️" },
      { at: 55.9, word: "GENUINA", emoji: "💎" },
      { at: 61.9, word: "COMPARTE", emoji: "📤" },
    ],
    emojis: [
      { at: 5.0, emoji: "💔", from: "right" },
      { at: 16.0, emoji: "💼", from: "left" },
      { at: 35.0, emoji: "✨", from: "right" },
      { at: 58.0, emoji: "🐊", from: "left" },
    ],
    zooms: [0.3, 11.7, 20.3, 26.9, 55.9],
    reaction: [13.2, 30.0, 61.9],
    stutter: [11.5, 26.7],
    sfx: [[0.3, 0, 0.35], [11.7, 2, 0.4], [20.3, 5, 0.4], [26.9, 3, 0.35], [55.9, 1, 0.45], [61.9, 5, 0.45]],
  },
  {
    id: "D07_manipular_vs_persuadir",
    day: 7,
    accent: "#c084fc",
    caption: "Manipular es forzar. Persuadir es presentar con pasión y dejar al otro libre.\n\nLa diferencia está en los valores.\n\n#ventasb2b #neuroventas #ventasconia",
    bRoll: [
      { start: 11.0, end: 17.0, url: "https://videos.pexels.com/video-files/35063000/14852681_360_640_60fps.mp4" },
      { start: 40.0, end: 47.0, url: "https://videos.pexels.com/video-files/7983985/7983985-hd_720_1280_25fps.mp4" },
    ],
    stickers: [
      { at: 0.5, word: "TOXICO", emoji: "☠️" },
      { at: 7.2, word: "MANIPULAR", emoji: "🚫" },
      { at: 8.5, word: "PERSUADIR", emoji: "🤝" },
      { at: 10.9, word: "VALORES", emoji: "💎" },
      { at: 31.7, word: "PASION", emoji: "🔥" },
      { at: 52.6, word: "GENUINA", emoji: "✨" },
    ],
    emojis: [
      { at: 4.0, emoji: "💔", from: "right" },
      { at: 18.0, emoji: "⛓️", from: "left" },
      { at: 45.0, emoji: "🕊️", from: "right" },
    ],
    zooms: [0.3, 8.5, 18.3, 31.7, 52.6],
    reaction: [7.2, 18.3, 55.0],
    stutter: [8.4, 31.5],
    sfx: [[0.3, 0, 0.35], [7.2, 6, 0.45], [8.5, 2, 0.4], [10.9, 3, 0.35], [31.7, 7, 0.35], [52.6, 4, 0.35]],
  },
  {
    id: "D08_objetivo_reuniones",
    day: 8,
    accent: "#facc15",
    caption: "Saliste de la junta y todo quedó igual o peor.\n\nDefiní un objetivo medible ANTES de cada reunión. Sin objetivo, estás frito.\n\n#liderazgocomercial #ventasconia #reunioneseficaces",
    bRoll: [
      { start: 6.0, end: 12.0, url: "https://videos.pexels.com/video-files/8134445/8134445-hd_1080_2048_25fps.mp4" },
      { start: 55.0, end: 62.0, url: "https://videos.pexels.com/video-files/5971784/5971784-hd_720_1366_25fps.mp4" },
    ],
    stickers: [
      { at: 0.5, word: "TODO IGUAL", emoji: "🙄" },
      { at: 16.5, word: "DEFINE", emoji: "🎯" },
      { at: 17.9, word: "OBJETIVO", emoji: "🎯" },
      { at: 24.9, word: "MEDIR", emoji: "📊" },
      { at: 30.4, word: "IMPACTO", emoji: "💥" },
      { at: 45.3, word: "FRITOS", emoji: "🥵" },
      { at: 65.5, word: "DEFINE Y MIDE", emoji: "✅" },
    ],
    emojis: [
      { at: 4.0, emoji: "😵", from: "left" },
      { at: 22.0, emoji: "🎯", from: "right" },
      { at: 40.0, emoji: "❓", from: "left" },
      { at: 60.0, emoji: "💡", from: "right" },
    ],
    zooms: [0.3, 17.9, 30.4, 45.3, 65.5],
    reaction: [16.5, 46.5, 65.5],
    stutter: [17.7, 45.1],
    sfx: [[0.3, 0, 0.35], [16.5, 3, 0.4], [24.9, 2, 0.4], [30.4, 5, 0.45], [45.3, 6, 0.45], [65.5, 4, 0.4]],
  },
  {
    id: "D09_ia_que_te_rete",
    day: 9,
    accent: "#6366f1",
    caption: "Si usás la IA para que te dé la razón, la estás usando como niño de kinder.\n\nPedile que te RETE el cerebro y los resultados explotan.\n\n#chatgpt #ia #ventasconia #productividad",
    bRoll: [
      { start: 5.0, end: 11.0, url: "https://videos.pexels.com/video-files/7660185/7660185-hd_720_1280_25fps.mp4" },
      { start: 40.0, end: 46.0, url: "https://videos.pexels.com/video-files/6963412/6963412-hd_720_1280_30fps.mp4" },
    ],
    stickers: [
      { at: 0.9, word: "INTELIGENCIA", emoji: "🤖" },
      { at: 16.3, word: "ABSURDAS", emoji: "🚫" },
      { at: 20.7, word: "CUESTIONE", emoji: "❓" },
      { at: 37.2, word: "DEBATE", emoji: "🗣️" },
      { at: 48.2, word: "COMPLACIENTE", emoji: "😴" },
      { at: 51.2, word: "RETALE", emoji: "🧠" },
      { at: 60.3, word: "KINDER", emoji: "🍼" },
    ],
    emojis: [
      { at: 3.0, emoji: "💧", from: "right" },
      { at: 25.0, emoji: "❓", from: "left" },
      { at: 45.0, emoji: "🔥", from: "right" },
      { at: 58.0, emoji: "🧠", from: "top" },
    ],
    zooms: [0.3, 16.3, 20.7, 37.2, 51.2],
    reaction: [20.7, 51.2, 60.3],
    stutter: [20.5, 51.0],
    sfx: [[0.3, 0, 0.35], [16.3, 1, 0.4], [20.7, 2, 0.4], [37.2, 3, 0.35], [48.2, 5, 0.4], [60.3, 6, 0.45]],
  },
  {
    id: "D10_prospectar_diario",
    day: 10,
    accent: "#fb923c",
    caption: "Tu equipo no llega a la cuota porque hace TODO y a la vez NADA.\n\nReservá 1 hora diaria religiosamente para prospectar.\n\n#ventasb2b #prospeccion #liderazgocomercial",
    bRoll: [
      { start: 25.0, end: 32.0, url: "https://videos.pexels.com/video-files/8347254/8347254-hd_1080_1920_25fps.mp4" },
      { start: 50.0, end: 57.0, url: "https://videos.pexels.com/video-files/8347250/8347250-hd_1080_1920_25fps.mp4" },
    ],
    stickers: [
      { at: 0.5, word: "DEMASIADO", emoji: "🤯" },
      { at: 17.0, word: "CUOTAS", emoji: "📉" },
      { at: 22.8, word: "TODO Y NADA", emoji: "🌀" },
      { at: 34.1, word: "PRIORIDADES", emoji: "🎯" },
      { at: 44.4, word: "PROSPECTOS", emoji: "📞" },
      { at: 46.3, word: "SEGUIMIENTO", emoji: "🔁" },
      { at: 58.9, word: "RELIGIOSO", emoji: "⏰" },
    ],
    emojis: [
      { at: 5.0, emoji: "📚", from: "left" },
      { at: 26.0, emoji: "⚠️", from: "right" },
      { at: 50.0, emoji: "📅", from: "top" },
    ],
    zooms: [0.3, 17.0, 34.1, 46.3, 58.9],
    reaction: [22.8, 44.4, 58.9],
    stutter: [22.6, 58.7],
    sfx: [[0.3, 0, 0.35], [17.0, 5, 0.4], [22.8, 6, 0.45], [34.1, 3, 0.4], [44.4, 2, 0.4], [58.9, 4, 0.4]],
  },
  {
    id: "D11_generar_prospectos",
    day: 11,
    accent: "#a3e635",
    caption: "¿Cuál es la actividad MÁS importante de un vendedor? Generar. Prospectar. Crecer el ticket.\n\nNo cotizar. No actualizar CRM. GENERAR.\n\n#ventasb2b #prospeccion #ventasconia",
    bRoll: [
      { start: 17.0, end: 23.0, url: "https://videos.pexels.com/video-files/7706947/7706947-hd_720_1366_25fps.mp4" },
      { start: 50.0, end: 57.0, url: "https://videos.pexels.com/video-files/35417425/15005754_360_640_25fps.mp4" },
    ],
    stickers: [
      { at: 0.3, word: "ACTIVIDAD #1", emoji: "🥇" },
      { at: 11.5, word: "PROPUESTAS", emoji: "📄" },
      { at: 14.6, word: "CRM", emoji: "💻" },
      { at: 27.9, word: "GENERAR", emoji: "🚀" },
      { at: 29.5, word: "PROSPECTAR", emoji: "📞" },
      { at: 32.6, word: "CRECER TICKET", emoji: "📈" },
      { at: 72.0, word: "AGENDALO", emoji: "📅" },
    ],
    emojis: [
      { at: 5.0, emoji: "🤔", from: "left" },
      { at: 22.0, emoji: "❌", from: "right" },
      { at: 47.0, emoji: "🚒", from: "left" },
      { at: 65.0, emoji: "📅", from: "top" },
    ],
    zooms: [0.3, 14.6, 27.9, 32.6, 72.0],
    reaction: [27.9, 47.6, 72.0],
    stutter: [27.7, 71.8],
    sfx: [[0.3, 4, 0.4], [11.5, 1, 0.4], [27.9, 0, 0.45], [32.6, 3, 0.4], [47.6, 6, 0.4], [72.0, 5, 0.45]],
  },
  {
    id: "D12_capacitacion_continua",
    day: 12,
    accent: "#06b6d4",
    caption: "¿No hay tiempo para capacitación? Entonces no hay tiempo para crecer.\n\nEl músculo de la comunicación se desarrolla o te quedás frito.\n\n#capacitacion #ventasconia #liderazgo",
    bRoll: [
      { start: 20.0, end: 27.0, url: "https://videos.pexels.com/video-files/6324554/6324554-hd_1080_1920_24fps.mp4" },
      { start: 55.0, end: 62.0, url: "https://videos.pexels.com/video-files/7652728/7652728-hd_1080_1920_25fps.mp4" },
    ],
    stickers: [
      { at: 1.9, word: "NO HAY TIEMPO", emoji: "⏳" },
      { at: 3.9, word: "CAPACITACION", emoji: "📚" },
      { at: 24.9, word: "DESARROLLO", emoji: "📈" },
      { at: 36.9, word: "VENTAS", emoji: "💼" },
      { at: 40.3, word: "VALOR", emoji: "💎" },
      { at: 48.5, word: "INNOVAR", emoji: "💡" },
      { at: 62.8, word: "FRITO", emoji: "🥵" },
    ],
    emojis: [
      { at: 6.0, emoji: "🚫", from: "right" },
      { at: 28.0, emoji: "💪", from: "left" },
      { at: 50.0, emoji: "✨", from: "top" },
      { at: 65.0, emoji: "🔥", from: "right" },
    ],
    zooms: [0.3, 3.9, 24.9, 48.5, 71.4],
    reaction: [3.9, 48.5, 62.8],
    stutter: [3.7, 62.6],
    sfx: [[0.3, 0, 0.35], [3.9, 5, 0.4], [24.9, 3, 0.4], [40.3, 2, 0.4], [48.5, 1, 0.4], [62.8, 6, 0.45]],
  },
];

const SFX_POOL_NAMES = SFX_POOL;
function sfxFromTuple(t) {
  return { at: t[0], sound: SFX_POOL_NAMES[t[1]], volume: t[2] };
}

function buildSticker(s, accent) {
  return {
    at: s.at,
    duration: 1.5,
    word: s.word,
    emoji: s.emoji,
    position: "top-center",
    rotation: 0,
    bg: accent,
    color: "#0a0a0a",
  };
}

function buildEmoji(e) {
  return { at: e.at, duration: 1.3, emoji: e.emoji, from: e.from, size: 220, yOffset: e.from === "top" ? -80 : 0 };
}

function buildProject(p) {
  return {
    id: `${p.id}_hype_sfx`,
    videoId: p.id,
    day: p.day,
    platforms: ["tiktok", "instagram"],
    styleId: "hype_max_sfx",
    accentColor: p.accent,
    caption: p.caption,
    status: "borrador",
    subtitleStyle: "anton",
    subtitleColor: "#ffffff",
    subtitleHighlight: p.accent,
    musicTrack: null,
    musicVolume: Number(process.env.VIRAL_MUSIC_VOLUME ?? 0.35),
    bRollMode: "pip",
    vignette: true,
    colorRotation: [],
    captionBounce: true,
    enableJumpCuts: true,
    bRoll: p.bRoll,
    zoomMarks: p.zooms.map((z) => ({ at: z, duration: 0.6, scale: 1.14 })),
    reactionZooms: p.reaction.map((r) => ({ at: r, intensity: 1.42, duration: 0.22 })),
    stutterMarks: p.stutter.map((s) => ({ at: s, duration: 0.18 })),
    wordStickers: p.stickers.map((s) => buildSticker(s, p.accent)),
    floatingEmojis: p.emojis.map(buildEmoji),
    sfxMarks: p.sfx.map(sfxFromTuple),
    animations: [],
    emphasisCards: [],
    manualSubtitles: [],
  };
}

for (const p of projects) {
  const out = buildProject(p);
  const file = path.join(PROJECTS_DIR, `${out.id}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2), "utf-8");
  console.log(`OK ${out.id}`);
}
