/**
 * Schemas zod de ViralVideo, extraídos para que sean compartidos entre el componente
 * principal y las sub-capas (sin que ViralVideo cargue 130 líneas de schemas inline).
 *
 * Cada schema viene con su tipo inferido exportado, listo para usar en props de capas.
 */
import { z } from "zod";

export const wordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});
export type Word = z.infer<typeof wordSchema>;

export const bRollSchema = z.object({
  start: z.number(),
  end: z.number(),
  url: z.string(),
  // Dimensiones del ORIGEN, cuando la fuente las declara (Giphy sí; Pexels no
  // siempre). Con ellas el render sabe si el material encaja en el lienzo o si
  // taparlo a pantalla completa le recortaría media imagen: un GIF cuadrado en
  // un vertical pierde los lados con `objectFit: cover`. Sin ellas, el
  // comportamiento es el de siempre.
  width: z.number().optional(),
  height: z.number().optional(),
});
export type BRollClip = z.infer<typeof bRollSchema>;

export const animationSchema = z.object({
  at: z.number(),
  type: z.enum(["zoom", "glow", "shake"]),
});
export type Animation = z.infer<typeof animationSchema>;

export const emphasisCardSchema = z.object({
  at: z.number(),
  duration: z.number().default(0.9),
  word: z.string(),
  emoji: z.string(),
  bg: z.string().default("#09090b"),
  color: z.string().default("#fafafa"),
  accent: z.string().default("#34d399"),
});
export type EmphasisCard = z.infer<typeof emphasisCardSchema>;

export const zoomMarkSchema = z.object({
  at: z.number(),
  duration: z.number().default(0.6),
  scale: z.number().default(1.15),
});
export type ZoomMark = z.infer<typeof zoomMarkSchema>;

export const wordStickerSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.1),
  word: z.string(),
  emoji: z.string(),
  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right", "top-center"])
    .default("top-right"),
  rotation: z.number().default(-5),
  bg: z.string().default("#fbbf24"),
  color: z.string().default("#0a0a0a"),
});
export type WordSticker = z.infer<typeof wordStickerSchema>;

export const floatingEmojiSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.2),
  emoji: z.string(),
  from: z.enum(["left", "right", "top", "bottom"]).default("left"),
  size: z.number().default(180),
  yOffset: z.number().default(0),
});
export type FloatingEmoji = z.infer<typeof floatingEmojiSchema>;

export const reactionZoomSchema = z.object({
  at: z.number(),
  intensity: z.number().default(1.4),
  duration: z.number().default(0.25),
});
export type ReactionZoom = z.infer<typeof reactionZoomSchema>;

export const stutterMarkSchema = z.object({
  at: z.number(),
  duration: z.number().default(0.2),
});
export type StutterMark = z.infer<typeof stutterMarkSchema>;

export const sfxMarkSchema = z.object({
  at: z.number(),
  sound: z.string(),
  url: z.string().optional(),
  volume: z.number().default(0.4),
});
export type SfxMark = z.infer<typeof sfxMarkSchema>;

// A6 — End-screen / CTA: tarjeta animada en los últimos `durationSec` del video.
export const endScreenSchema = z.object({
  text: z.string().default("Seguime para más"),
  handle: z.string().default(""),
  emoji: z.string().default("🔥"),
  durationSec: z.number().default(2.5),
  bg: z.string().default("#0a0a0a"),
  accent: z.string().default("#34d399"),
});
export type EndScreen = z.infer<typeof endScreenSchema>;

// A4 — Speed ramp: ventana donde se overlay-ea el source playing a `rate` < 1 (slow-mo)
// o > 1 (acelerado). El video base sigue corriendo a 1x debajo; al terminar la ventana
// reaparece. La duración total del video NO cambia.
export const speedRampSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.5),
  rate: z.number().default(0.5),
});
export type SpeedRamp = z.infer<typeof speedRampSchema>;

// B5 — Icon sticker: aparece N segundos con un icono del ICON_MAP + bg circular opcional.
export const iconStickerSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.1),
  icon: z.string().default("sparkles"),
  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right", "top-center"])
    .default("top-right"),
  color: z.string().default("#0a0a0a"),
  bg: z.string().default("#fbbf24"),
  size: z.number().default(120),
  // Si true → "tarjeta de diseño" FULLSCREEN: la pantalla se oscurece y aparece el
  // ícono gigante animado + una palabra (label). Es el momento "motion graphic".
  fullscreen: z.boolean().default(false),
  label: z.string().default(""),
  // ILUSTRACIÓN ANIMADA (Lottie de Noto): si viene una URL, se renderiza la
  // animación de escena (dinero volando, reloj sonando, cohete…) EN LUGAR del
  // ícono estático. "" = ícono clásico (compat total con projects viejos).
  lottieSrc: z.string().default(""),
  // ICONO SVG EXTERNO (Phosphor/Tabler): cuando el sticker viene de la galería con
  // un icono "ph:<nombre>"/"tb:<nombre>", el build embebe el markup del SVG acá
  // (resolveIconStickerSvg, igual que las tarjetas editoriales). Si está presente,
  // se dibuja el SVG en vez del ícono Lucide del ICON_MAP. "" = ícono Lucide clásico.
  iconSvg: z.string().default(""),
});
export type IconSticker = z.infer<typeof iconStickerSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// MODO GRÁFICOS & MOTION (opt-in, ADITIVO) — charts animados + texto poderoso.
// Defaults vacíos = render idéntico. Se animan 100% con useCurrentFrame() en SVG.
// ═══════════════════════════════════════════════════════════════════════════

// Un punto de dato para barras/línea/dona.
export const dataPointSchema = z.object({
  label: z.string().default(""),
  value: z.number(),
  color: z.string().optional(),
});
export type DataPoint = z.infer<typeof dataPointSchema>;

// Gráfica animada: contador, barras, línea o dona. Aparece en `at` por `duration` seg.
export const dataVizSchema = z.object({
  at: z.number(),
  duration: z.number().default(4),
  type: z
    .enum([
      "counter", "bar", "line", "donut",
      // Tipos visuales nuevos:
      "progress",    // gauge/barra que se llena a un %
      "comparison",  // dos paneles VS (izq vs der)
      "pictograph",  // X de Y representado con íconos/puntos
      "steps",       // lista numerada 1·2·3 animada
      "rating",      // estrellas (X de 5)
    ])
    .default("counter"),
  title: z.string().default(""),
  // counter: usa data[0].value. bar/line/donut: usa todos los puntos.
  data: z.array(dataPointSchema).default([]),
  prefix: z.string().default(""), // "$"
  suffix: z.string().default(""), // "%", "k", "M"
  accent: z.string().default("#34d399"),
  bg: z.string().default("#0a0a0aE6"),
  position: z.enum(["center", "top", "bottom"]).default("center"),
  fullscreen: z.boolean().default(true), // tarjeta fullscreen vs flotante
  total: z.number().optional(),  // pictograph: total de íconos (data[0].value = llenos)
  max: z.number().optional(),    // rating: máximo de estrellas (default 5)
});
export type DataViz = z.infer<typeof dataVizSchema>;

// Titular animado "poderoso" con un efecto. Aparece en `at` por `duration` seg.
export const kineticHeadlineSchema = z.object({
  at: z.number(),
  duration: z.number().default(2.5),
  text: z.string(),
  effect: z
    .enum([
      "split_letters", // letras entran escalonadas con spring
      "glitch", // copias RGB desalineadas (datamosh)
      "shimmer", // barrido de brillo sobre gradiente
      "draw_on", // contorno SVG que se dibuja
      "gradient_sweep", // gradiente que se desplaza
      "tracking_in", // expande letter-spacing + blur-in
    ])
    .default("split_letters"),
  color: z.string().default("#ffffff"),
  accent: z.string().default("#34d399"),
  position: z.enum(["center", "top", "bottom"]).default("center"),
  size: z.number().default(130),
});
export type KineticHeadline = z.infer<typeof kineticHeadlineSchema>;

// B6 — Brand kit / marca de agua: handle (y/o logo) sutil en una esquina, todo el video.
export const brandKitSchema = z.object({
  handle: z.string().default(""),
  logoUrl: z.string().default(""),
  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
    .default("bottom-right"),
  opacity: z.number().default(0.55),
  color: z.string().default("#ffffff"),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

// B4 — Sticker ANIMADO (Lottie). Animación vectorial que se mueve en loop (no un emoji
// estático). Aparece en `at` por `duration` seg. `name` selecciona una animación CC0
// propia bundleada en src/lottie/. `color` tiñe el glow (las formas base son blancas).
export const lottieStickerSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.6),
  name: z.enum(["pulse_ring", "sparkle", "arrow_down", "star5"]).default("sparkle"),
  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right", "top-center", "center"])
    .default("top-right"),
  size: z.number().default(220),
  color: z.string().default("#fbbf24"),
});
export type LottieSticker = z.infer<typeof lottieStickerSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// ILUSTRACIONES CC0 (open-doodles / open-peeps) — MULTICOLOR (no currentColor).
// Overlay/sticker de "personas" que opcionalmente se TIÑE a duotono con los
// colores del tema para combinar con la estética. Opt-in: [] = render idéntico.
// ═══════════════════════════════════════════════════════════════════════════
export const illustrationStickerSchema = z.object({
  at: z.number(),
  duration: z.number().default(2.5),
  /** URL del SVG/PNG (las 73 ilustraciones viven en assets/illustrations). */
  url: z.string(),
  position: z
    .enum(["top-left", "top-right", "bottom-left", "bottom-right", "top-center", "center", "left", "right"])
    .default("bottom-right"),
  size: z.number().default(420),
  /** Ángulo de inclinación (estética sticker). */
  rotation: z.number().default(0),
  /**
   * Duotono: 0 = ilustración MULTICOLOR original; 1 = teñida por completo a la
   * pareja sombra/luz del tema. Valores intermedios mezclan. Default 0 (intacta).
   */
  duotone: z.number().default(0),
  /** Tinta de las sombras (color oscuro del tema). */
  duotoneShadow: z.string().default("#171310"),
  /** Tinta de las luces (color claro/papel del tema). */
  duotoneHighlight: z.string().default("#f3ede1"),
  /** Sombra dura tipo "papel recortado" detrás de la ilustración. */
  dropShadow: z.boolean().default(false),
});
export type IllustrationSticker = z.infer<typeof illustrationStickerSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// OVERLAYS DE TEXTURA procedurales (assets/overlays/*.png — 7 texturas).
// Se componen sobre TODO con mixBlendMode opcional por proyecto. Opt-in:
// null = sin textura (render idéntico al histórico).
// ═══════════════════════════════════════════════════════════════════════════
export const overlayTextureSchema = z.object({
  /** URL del PNG de textura (grano/polvo/scratches/light-leak…). */
  url: z.string(),
  /** Modo de mezcla — "screen" (aclara, light-leaks) u "overlay" (contraste, grano). */
  blendMode: z.enum(["screen", "overlay", "soft-light", "multiply", "lighten"]).default("screen"),
  opacity: z.number().default(0.35),
  /** Si true, la textura cubre todo el video (object-fit:cover). */
  cover: z.boolean().default(true),
});
export type OverlayTexture = z.infer<typeof overlayTextureSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// TEXTO DETRÁS DEL SUJETO (matte estático) — opt-in, ADITIVO. null = sin efecto.
// Compone: video → TEXTO grande → matte del sujeto (PNG con alpha) encima, de modo
// que el texto se ve DETRÁS de la persona. El matte es de UN frame clave (estático,
// barato) — lo produce Python (rembg) a resolución completa del frame, alineado al
// encuadre del video. Si matteUrl="" el texto igual se dibuja (sin recorte encima).
// ═══════════════════════════════════════════════════════════════════════════
export const textBehindSchema = z.object({
  /** La palabra/frase grande que va detrás. */
  phrase: z.string(),
  /** URL del PNG RGBA del sujeto recortado (frame completo, NO bbox). "" = sin matte. */
  matteUrl: z.string().default(""),
  /** Color del texto (acepta "#rrggbb" o "rrggbb"). */
  color: z.string().default("#ffffff"),
  /** Tamaño de fuente en px. Default ~34% del ancho (lo resuelve el layer). */
  size: z.number().optional(),
  /** Ventana del efecto. duration<=0 = persiste todo el video (default histórico). */
  at: z.number().default(0),
  duration: z.number().default(0),
  /** Posición vertical del texto. */
  position: z.enum(["center", "top", "bottom"]).default("center"),
  /** Sombra dura para legibilidad. */
  shadow: z.boolean().default(true),
  /** Contorno tipo CapCut. */
  outline: z.boolean().default(false),
  outlineColor: z.string().default("#000000"),
  /** Opacidad del texto (0..1). */
  textOpacity: z.number().default(1),
});
export type TextBehind = z.infer<typeof textBehindSchema>;
