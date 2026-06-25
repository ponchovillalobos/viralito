import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { z } from "zod";
import { staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import { PLAYFAIR } from "./layers/local-editorial-fonts";
import { CameraMotionBlur } from "@remotion/motion-blur";
import {
  ImageOverlayLayer,
  FilmGrainLayer,
  useCameraMoveTransform,
  imageOverlaySchema,
  cameraMoveSchema,
} from "./cinematic-layers";
import {
  SceneFxLayer,
  ProTransitionLayer,
  KineticSubtitleLayer,
  sceneFxSchema,
  proTransitionSchema,
  kineticPresetSchema,
} from "./scene-fx";
import { MirrorFxLayer, mirrorFxSchema } from "./mirror-fx";
import { TrackedLayer, trackPointSchema, trackedItemSchema } from "./tracked-layer";
import { BrandWatermarkLayer } from "./layers/brand-watermark-layer";
import { IconStickerLayer } from "./layers/icon-sticker-layer";
import { EndScreenLayer } from "./layers/end-screen-layer";
import { PipBRollLayer } from "./layers/pip-broll-layer";
import { FloatingEmojiLayer } from "./layers/floating-emoji-layer";
import { WordStickerLayer } from "./layers/word-sticker-layer";
import { EmphasisCardLayer } from "./layers/emphasis-card-layer";
import { SubtitleLayer } from "./layers/subtitle-layer";
import { ParticleLayer, particleBurstSchema } from "./layers/particle-layer";
import {
  ProTransitionSeriesLayer,
  proTransitionSeriesSchema,
} from "./layers/pro-transition-series-layer";
import { IllustrationStickerLayer } from "./layers/illustration-sticker-layer";
import { OverlayTextureLayer } from "./layers/overlay-texture-layer";
import {
  AnimatedBackgroundLayer,
  animatedBackgroundSchema,
} from "./layers/animated-background-layer";
import {
  EditorialCardLayer,
  EditorialAmbient,
  EditorialSubtitleBaseline,
  editorialCardSchema,
  editorialLayoutSchema,
  editorialPanelAt,
  editorialFontsFor,
} from "./layers/editorial-layer";
import { EditorialChartLayer } from "./layers/editorial-chart";
import { EditorialCutoutLayer, editorialCutoutSchema } from "./layers/editorial-collage";
// IMPORT DIRECTO del globo. El lazy-load (React.lazy + Suspense) rompía la animación del
// globo (zoom/rotación) porque el frame determinista se capturaba antes de que montara el
// chunk. El schema vive en un archivo liviano y se re-exporta desde editorial-globe.
import { EditorialGlobeLayer, editorialMapSchema } from "./layers/editorial-globe";
import {
  EditorialPaper,
  EditorialFinish,
  EditorialDuotone,
} from "./layers/editorial-texture";
import { resolveEditorialLook, isDarkCanvas, duotonePairFor } from "./layers/editorial-themes";

// FUENTES DE TITULAR — bundle LOCAL (cero red en render). Antes se bajaban de
// fonts.gstatic.com vía @remotion/google-fonts en CADA render: la app es un
// editor OFFLINE, así que sin internet los títulos fallaban o caían a la fuente
// del sistema. Ahora los .ttf viven en remotion/public/fonts (OFL/Apache, libres
// para uso comercial) y se cargan con @remotion/fonts + staticFile.
//
// Los `family` deben coincidir EXACTO con el string que devolvía google-fonts
// (es el mismo nombre CSS) para no cambiar la apariencia: FONT_MAP/BEBAS/ANTON
// y los fontFamily de los estilos siguen siendo idénticos.
const TTF = (
  file: string,
  family: string,
  weight?: string
): void => {
  loadFont({
    family,
    url: staticFile(`fonts/${file}`),
    format: "truetype",
    ...(weight ? { weight } : {}),
  }).catch(() => {
    // Offline-first: si algo falla, el navegador cae a la fuente del sistema en
    // vez de tirar el render. No debería pasar — los .ttf están bundleados.
  });
};

const BEBAS = "Bebas Neue";
const ANTON = "Anton";
// Serif EDITORIAL para subtítulos (subtitleFont "playfair" — p.ej. cinematic_pro).
// El family "Playfair Display" se registra LOCAL y a-prueba-de-abortos en
// local-editorial-fonts (importado arriba); cero red en render.

// Display de un solo peso (400) — un .ttf cada una.
TTF("BebasNeue-Regular.ttf", BEBAS);
TTF("Anton-Regular.ttf", ANTON);
TTF("Bangers-Regular.ttf", "Bangers");
TTF("LuckiestGuy-Regular.ttf", "Luckiest Guy");
TTF("ArchivoBlack-Regular.ttf", "Archivo Black");
TTF("Righteous-Regular.ttf", "Righteous");

// Fuentes variables [wght] — UN .ttf cubre todos los pesos (igual que el
// loadFont() sin args de antes, que bajaba toda la familia).
TTF("Montserrat-var.ttf", "Montserrat");
TTF("Oswald-var.ttf", "Oswald");
TTF("Teko-var.ttf", "Teko");
// TikTok Sans — la grotesque NATIVA de los subtítulos virales de TikTok.
// TTF directo de github.com/google/fonts (OFL 1.1, libre para uso comercial),
// variable [opsz,slnt,wdth,wght] → UN .ttf cubre todos los pesos. Familia CSS
// "TikTok Sans". La usa el preset "Pop Reels 2026" y el subtitleFont "tiktok".
TTF("TikTokSans-var.ttf", "TikTok Sans");

// Poppins es estática por peso en el repo de Google Fonts: se registran los
// pesos que el editor usa bajo el MISMO family ("Poppins").
TTF("Poppins-Regular.ttf", "Poppins", "400");
TTF("Poppins-SemiBold.ttf", "Poppins", "600");
TTF("Poppins-Bold.ttf", "Poppins", "700");
TTF("Poppins-ExtraBold.ttf", "Poppins", "800");
TTF("Poppins-Black.ttf", "Poppins", "900");

// Más fuentes para variedad de subtítulos (todas locales/OFL, gratis). El
// proyecto elige una vía `subtitleFont`; "auto" usa la del estilo (bebas/anton).
const FONT_MAP: Record<string, string> = {
  bebas: BEBAS,
  anton: ANTON,
  montserrat: "Montserrat",
  poppins: "Poppins",
  oswald: "Oswald",
  bangers: "Bangers",
  luckiest: "Luckiest Guy",
  archivo: "Archivo Black",
  teko: "Teko",
  righteous: "Righteous",
  tiktok: "TikTok Sans",
  playfair: PLAYFAIR, // serif editorial (cinematic_pro)
};

import {
  wordSchema,
  bRollSchema,
  animationSchema,
  emphasisCardSchema,
  zoomMarkSchema,
  wordStickerSchema,
  floatingEmojiSchema,
  reactionZoomSchema,
  stutterMarkSchema,
  sfxMarkSchema,
  endScreenSchema,
  speedRampSchema,
  iconStickerSchema,
  brandKitSchema,
  dataVizSchema,
  kineticHeadlineSchema,
  lottieStickerSchema,
  illustrationStickerSchema,
  overlayTextureSchema,
  textBehindSchema,
} from "./schemas";
import { DataVizLayer } from "./layers/data-viz-layer";
import { KineticHeadlineLayer } from "./layers/kinetic-headline-layer";
import { LottieStickerLayer } from "./layers/lottie-sticker-layer";
import { TextBehindLayer } from "./layers/text-behind-layer";

/**
 * A2 — Interpolación lineal de un eje de la cara a un tiempo dado, en el espacio
 * normalizado 0..1 del trackPath. Igual lógica que sampleAt() en tracked-layer, pero
 * inline para no acoplar este archivo al otro. `axis` elige x o y del punto.
 */
function sampleTrackAxis(
  path: { t: number; x: number; y: number }[],
  t: number,
  axis: "x" | "y"
): number {
  if (path.length === 0) return 0.5;
  if (t <= path[0].t) return path[0][axis];
  const last = path[path.length - 1];
  if (t >= last.t) return last[axis];
  for (let i = 1; i < path.length; i++) {
    if (t <= path[i].t) {
      const a = path[i - 1];
      const b = path[i];
      const f = (t - a.t) / Math.max(0.0001, b.t - a.t);
      return a[axis] + (b[axis] - a[axis]) * f;
    }
  }
  return last[axis];
}

/** Compat: posición X de la cara (usa el sampler genérico). */
function sampleTrackX(path: { t: number; x: number; y: number }[], t: number): number {
  return sampleTrackAxis(path, t, "x");
}

/**
 * A2 — Posición SUAVE de la cara: promedia varias muestras alrededor de `t` (ventana
 * ±window s) para matar el jitter del tracker Haar (que salta frame a frame). Resultado
 * estable → el pan del auto-reframe se desliza, no tiembla. Determinista por frame.
 */
function sampleTrackAxisSmooth(
  path: { t: number; x: number; y: number }[],
  t: number,
  axis: "x" | "y",
  windowSec = 0.5,
  taps = 5
): number {
  if (path.length === 0) return 0.5;
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    // muestras equiespaciadas en [t-window, t+window]
    const dt = (k / (taps - 1) - 0.5) * 2 * windowSec;
    sum += sampleTrackAxis(path, t + dt, axis);
  }
  return sum / taps;
}

// brandKitSchema (B6) vive ahora en ./schemas.

export const viralVideoSchema = z.object({
  rawVideoUrl: z.string(),
  videoDurationSec: z.number().default(30),
  words: z.array(wordSchema).default([]),
  bRoll: z.array(bRollSchema).default([]),
  musicUrl: z.string().nullable().default(null),
  musicVolume: z.number().default(0.35),
  // F1 — Director emocional: curva de DUCKING de la música. Puntos {t, v} donde v
  // multiplica musicVolume (0.35 = voz hablando, 1.0 = pausa larga → la música
  // respira). Vacía = volumen constante (render idéntico al de antes).
  musicVolumeCurve: z
    .array(z.object({ t: z.number(), v: z.number() }))
    .default([]),
  subtitleStyle: z.enum(["bebas", "anton", "cinematic"]).default("bebas"),
  subtitleColor: z.string().default("#ffffff"),
  subtitleHighlight: z.string().default("#34d399"),
  // Fuente del subtítulo. "auto" = la del estilo (bebas/anton). El resto son Google
  // Fonts gratis para variedad (montserrat, poppins, oswald, bangers, etc.).
  subtitleFont: z
    .enum(["auto", "bebas", "anton", "montserrat", "poppins", "oswald", "bangers", "luckiest", "archivo", "teko", "righteous", "tiktok"])
    .default("auto"),
  // F2 — Posición vertical del subtítulo. "top" cuando la cara del speaker queda
  // abajo del frame (lo computa el tracking): el texto nunca tapa la cara.
  subtitlePosition: z.enum(["bottom", "top"]).default("bottom"),
  animations: z.array(animationSchema).default([]),
  emphasisCards: z.array(emphasisCardSchema).default([]),
  bRollMode: z.enum(["fullscreen", "pip"]).default("fullscreen"),
  zoomMarks: z.array(zoomMarkSchema).default([]),
  wordStickers: z.array(wordStickerSchema).default([]),
  floatingEmojis: z.array(floatingEmojiSchema).default([]),
  colorRotation: z.array(z.string()).default([]),
  vignette: z.boolean().default(false),
  reactionZooms: z.array(reactionZoomSchema).default([]),
  stutterMarks: z.array(stutterMarkSchema).default([]),
  captionBounce: z.boolean().default(false),
  sfxMarks: z.array(sfxMarkSchema).default([]),
  // Modo cinematográfico — opt-in. Defaults vacíos/falsos = render idéntico a antes.
  imageOverlays: z.array(imageOverlaySchema).default([]),
  cameraMoves: z.array(cameraMoveSchema).default([]),
  filmGrain: z.boolean().default(false),
  // CINE CLÁSICO — ventanas de DRAMA donde la imagen del video base se vuelve
  // blanco y negro (cine antiguo) y luego revierte. Cada ventana {at, duration}.
  // Vacío = sin B&W (render idéntico al histórico para todos los demás estilos).
  bwWindows: z.array(z.object({ at: z.number(), duration: z.number().default(2.5) })).default([]),
  // F3 SUPREME — densidad cinematográfica para mood-aware color grading.
  // low=KODAK warm, medium=FUJI cool, high=BLEACH thriller.
  cinematicDensity: z.enum(["low", "medium", "high"]).default("medium"),
  // === CapCut Pro FX (opt-in, ADITIVO) — defaults vacíos/"none" = render idéntico ===
  sceneFx: z.array(sceneFxSchema).default([]),
  proTransitions: z.array(proTransitionSchema).default([]),
  kineticPreset: kineticPresetSchema,
  mirrorFx: z.array(mirrorFxSchema).default([]),
  trackPath: z.array(trackPointSchema).default([]),
  trackedItems: z.array(trackedItemSchema).default([]),
  // A6/A8/B6/B5 — opt-in. null/false/[] = render idéntico.
  endScreen: endScreenSchema.nullable().default(null),
  progressBar: z.boolean().default(false),
  brandKit: brandKitSchema.nullable().default(null),
  iconStickers: z.array(iconStickerSchema).default([]),
  speedRamps: z.array(speedRampSchema).default([]),
  // C1 — Voz IA (Piper). Opt-in: si voiceoverUrl viene, se monta una pista de audio
  // extra (encima de music+sfx+raw). Default null = sin voiceover, render idéntico.
  voiceoverUrl: z.string().nullable().default(null),
  voiceoverVolume: z.number().default(0.7),
  voiceoverStartSec: z.number().default(0),
  // A2 — Auto-reframe 16:9 → 9:16 siguiendo al sujeto. Si autoReframe=true y hay trackPath
  // poblado, ViralVideo desplaza el video horizontalmente para mantener la cara centrada
  // sin perder altura. sourceAspect = ancho/alto del source (default 16/9).
  autoReframe: z.boolean().default(false),
  sourceAspect: z.number().default(16 / 9),
  // Dimensiones del composition — Root.tsx las lee vía calculateMetadata.
  // Default vertical 9:16. Pasar {width:1920, height:1080} para horizontal 16:9.
  width: z.number().default(1080),
  height: z.number().default(1920),
  // === MODO GRÁFICOS & MOTION (opt-in) — charts animados + titulares poderosos. ===
  // Defaults [] = render idéntico. Cada elemento tiene su ventana [at, at+duration].
  dataViz: z.array(dataVizSchema).default([]),
  kineticHeadlines: z.array(kineticHeadlineSchema).default([]),
  // B4 — Stickers animados (Lottie). Opt-in. [] = render idéntico.
  lottieStickers: z.array(lottieStickerSchema).default([]),
  // F3 — Partículas procedurales (confeti/chispas/brasas/lluvia de emojis). Opt-in.
  particleBursts: z.array(particleBurstSchema).default([]),
  // MOTION PRO — Fondo animado (aurora/mesh/grid), opcionalmente audio-reactivo.
  // null = sin fondo (render idéntico al histórico).
  animatedBackground: animatedBackgroundSchema.nullable().default(null),
  // EDITORIAL — el video vive en un panel lateral y el lado oscuro muestra
  // tarjetas tipográficas serif + ilustraciones line-art. null = layout normal.
  editorialLayout: editorialLayoutSchema.nullable().default(null),
  editorialCards: z.array(editorialCardSchema).default([]),
  // Ola 6 — tarjeta de COLLAGE (recorte de sujeto rembg, papel de tijera).
  editorialCutout: editorialCutoutSchema.nullable().default(null),
  // Ola 7 — globo con zoom al lugar mencionado en el transcript.
  editorialMap: editorialMapSchema.nullable().default(null),
  // PRO — transiciones oficiales de Remotion (@remotion/transitions): slide/wipe/
  // flip/clockWipe/none como overlay en cortes. ADITIVO a las caseras. [] = idéntico.
  proTransitionSeries: z.array(proTransitionSeriesSchema).default([]),
  // ILUSTRACIONES CC0 multicolor (open-doodles/open-peeps) con duotono opcional al
  // tema, usadas como overlay/sticker de personas. [] = render idéntico.
  illustrationStickers: z.array(illustrationStickerSchema).default([]),
  // OVERLAY de TEXTURA procedural (grano/polvo/scratches) con mixBlendMode opcional.
  // null = sin textura (render idéntico al histórico).
  overlayTexture: overlayTextureSchema.nullable().default(null),
  // TEXTO DETRÁS DEL SUJETO (matte estático): video → texto grande → recorte del
  // sujeto encima. null = sin efecto (render idéntico). El matte (PNG con alpha) lo
  // produce Python a resolución completa del frame; ver text-behind-layer.tsx.
  textBehind: textBehindSchema.nullable().default(null),
  // PRUEBA GRATUITA — pill discreto "PRUEBA GRATUITA · Viralito" encima de
  // todo. Lo inyectan los builders (.mjs) y /api/videos/render cuando NO hay
  // licencia activada. Opcional: props viejos sin el campo = render idéntico.
  trialWatermark: z.boolean().optional(),
});

type ViralVideoProps = z.infer<typeof viralVideoSchema>;

export const defaultProps: ViralVideoProps = {
  rawVideoUrl: "",
  videoDurationSec: 30,
  words: [],
  bRoll: [],
  musicUrl: null,
  musicVolume: 0.35,
  musicVolumeCurve: [],
  subtitleStyle: "bebas",
  subtitleColor: "#ffffff",
  subtitleHighlight: "#34d399",
  subtitleFont: "auto",
  subtitlePosition: "bottom",
  animations: [],
  emphasisCards: [],
  bRollMode: "fullscreen",
  zoomMarks: [],
  wordStickers: [],
  floatingEmojis: [],
  colorRotation: [],
  vignette: false,
  reactionZooms: [],
  stutterMarks: [],
  captionBounce: false,
  sfxMarks: [],
  imageOverlays: [],
  cameraMoves: [],
  filmGrain: false,
  bwWindows: [],
  cinematicDensity: "medium",
  sceneFx: [],
  proTransitions: [],
  kineticPreset: "none",
  mirrorFx: [],
  trackPath: [],
  trackedItems: [],
  endScreen: null,
  progressBar: false,
  brandKit: null,
  iconStickers: [],
  speedRamps: [],
  voiceoverUrl: null,
  voiceoverVolume: 0.7,
  voiceoverStartSec: 0,
  autoReframe: false,
  sourceAspect: 16 / 9,
  width: 1080,
  height: 1920,
  dataViz: [],
  kineticHeadlines: [],
  lottieStickers: [],
  particleBursts: [],
  animatedBackground: null,
  editorialLayout: null,
  editorialCards: [],
  editorialCutout: null,
  editorialMap: null,
  proTransitionSeries: [],
  illustrationStickers: [],
  overlayTexture: null,
  textBehind: null,
  trialWatermark: false,
};

export const ViralVideo: React.FC<ViralVideoProps> = ({
  rawVideoUrl,
  videoDurationSec,
  words,
  bRoll,
  musicUrl,
  musicVolume,
  musicVolumeCurve,
  subtitleStyle,
  subtitleColor,
  subtitleHighlight,
  subtitleFont,
  subtitlePosition,
  animations,
  emphasisCards,
  bRollMode,
  zoomMarks,
  wordStickers,
  floatingEmojis,
  colorRotation,
  vignette,
  reactionZooms,
  stutterMarks,
  captionBounce,
  sfxMarks,
  imageOverlays,
  cameraMoves,
  filmGrain,
  bwWindows,
  cinematicDensity,
  sceneFx,
  proTransitions,
  kineticPreset,
  mirrorFx,
  trackPath,
  trackedItems,
  endScreen,
  progressBar,
  brandKit,
  iconStickers,
  speedRamps,
  voiceoverUrl,
  voiceoverVolume,
  voiceoverStartSec,
  autoReframe,
  sourceAspect,
  dataViz,
  kineticHeadlines,
  lottieStickers,
  particleBursts,
  animatedBackground,
  editorialLayout,
  editorialCards,
  editorialCutout,
  editorialMap,
  proTransitionSeries,
  illustrationStickers,
  overlayTexture,
  textBehind,
  trialWatermark,
}) => {
  // Modo cinematic detection: se activa con CUALQUIERA de estas señales:
  //   - subtitleStyle="cinematic" explícito (toggle "Subtítulos cine"), O
  //   - filmGrain activo (el user pidió look cine), O
  //   - hay imageOverlays con timestamps (modo cinematográfico funcional)
  // Si alguna está, se aplican TODAS las mejoras visuales:
  //   - Imágenes fullscreen con TV grain siempre activo + Ken Burns amplio
  //   - Camera moves sobre el video base
  //   - Color grading sutil (contrast/saturation tipo cine)
  // Para los estilos legacy (bebas/anton sin overlays/grain) el render queda IDÉNTICO.
  const isCinematicMode =
    subtitleStyle === "cinematic" || filmGrain || imageOverlays.length > 0;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width: compWidth, height: compHeight } = useVideoConfig();
  const currentTime = frame / fps;
  const totalDuration = durationInFrames / fps;

  // A2 — Auto-reframe: mantener la cara del sujeto centrada siguiendo el trackPath.
  // Dos regímenes según el aspecto del source vs. el canvas vertical:
  //
  //   (1) SOURCE MÁS ANCHO que el canvas (p.ej. 16:9 horneado en 9:16): objectFit:cover
  //       ya recorta los lados; sólo se DESPLAZA en X dentro del exceso horizontal.
  //       Comportamiento HISTÓRICO — exacto, sin regresión.
  //
  //   (2) SOURCE NO más ancho que el canvas (VERTICAL de celular ~9:16, o cuadrado):
  //       no hay exceso horizontal → el desplazamiento sería imperceptible. En su lugar
  //       ZOOM-AND-PAN: se escala el video levemente (reframeZoom) para crear margen en
  //       AMBOS ejes y se traslada DENTRO de ese margen (X e Y) para centrar la cara.
  //       Clampeado al margen → NUNCA se ve borde negro (objectFit:cover se mantiene).
  //
  // En ambos: si autoReframe=false o trackPath vacío, nada se aplica → render byte-idéntico.
  let autoReframeTranslateX = 0;
  let autoReframeZoomTranslateX = 0;
  let autoReframeZoomTranslateY = 0;
  let autoReframeScale = 1;
  const reframeActive = autoReframe && trackPath.length > 0 && compHeight > compWidth;
  if (reframeActive && sourceAspect > compWidth / compHeight) {
    // (1) Source horizontal — comportamiento histórico (no tocar).
    const faceX = sampleTrackX(trackPath, currentTime);
    // objectFit:cover escala el source para que el alto = compHeight; el ancho excede.
    const renderedSourceWidth = compHeight * sourceAspect;
    const maxOffset = (renderedSourceWidth - compWidth) / 2;
    const desired = -(faceX - 0.5) * renderedSourceWidth;
    autoReframeTranslateX = Math.max(-maxOffset, Math.min(maxOffset, desired));
  } else if (reframeActive) {
    // (2) Source vertical/cuadrado — zoom-and-pan suave siguiendo la cara.
    // Zoom fijo y moderado: crea margen para reencuadrar sin degradar nitidez.
    const reframeZoom = 1.14;
    autoReframeScale = reframeZoom;
    const faceX = sampleTrackAxisSmooth(trackPath, currentTime, "x");
    const faceY = sampleTrackAxisSmooth(trackPath, currentTime, "y");
    // El transform es scale(S)·translate(T): el desplazamiento real en px es S·T, y el
    // margen disponible (mitad) tras el zoom es (S-1)·dim/2. Para no descubrir borde:
    //   |S·T| ≤ (S-1)·dim/2  →  |T| ≤ (S-1)·dim/(2·S).
    // Se clampa contra ESTE zoom (los zooms dinámicos —reactionZoom, etc.— sólo agregan
    // más escala, nunca menos, así que el clamp es conservador y seguro).
    const maxTx = ((reframeZoom - 1) * compWidth) / (2 * reframeZoom);
    const maxTy = ((reframeZoom - 1) * compHeight) / (2 * reframeZoom);
    // Llevar la cara (normalizada 0..1) al centro: desplazamiento deseado en px del canvas.
    const desiredTx = -(faceX - 0.5) * compWidth;
    const desiredTy = -(faceY - 0.5) * compHeight;
    autoReframeZoomTranslateX = Math.max(-maxTx, Math.min(maxTx, desiredTx));
    autoReframeZoomTranslateY = Math.max(-maxTy, Math.min(maxTy, desiredTy));
  }

  // SEGUIMIENTO INTELIGENTE EN COVER-CROP (panel editorial) — objectPosition.
  // Cuando el contenedor RECORTA (panel editorial angosto), objectFit:cover muestra
  // solo una franja; por defecto el centro → si el que habla está a un lado, SE
  // PIERDE. Movemos la franja visible hacia la CABEZA detectada (trackPath).
  //
  // CLAVE (feedback del usuario): la cabeza debe quedar centrada con AIRE arriba y a
  // los lados, nunca cortada. Por eso clampeamos el punto a una banda segura: X con
  // margen lateral, e Y a la zona ALTA-central (headroom) → el encuadre jamás baja
  // al torso/piernas aunque la detección falle y dé un punto muy abajo. Suavizado
  // fuerte (ventana 0.8s) para que no tiemble. Sin trackPath → undefined → "50% 50%"
  // nativo (render byte-idéntico al histórico).
  const headX =
    trackPath.length > 0
      ? Math.min(0.9, Math.max(0.1, sampleTrackAxisSmooth(trackPath, currentTime, "x", 0.8)))
      : null;
  // HEADROOM: restamos un margen al Y de la cabeza para que el encuadre muestre algo
  // de aire ARRIBA de la cabeza (no pegada al borde) y el cuerpo abajo. Clamp a una
  // banda alta-central → nunca cae al torso/piernas (cortando la cabeza).
  const headY =
    trackPath.length > 0
      ? Math.min(0.42, Math.max(0.0, sampleTrackAxisSmooth(trackPath, currentTime, "y", 0.8) - 0.1))
      : null;
  const faceObjectPosition =
    headX !== null && headY !== null
      ? `${(headX * 100).toFixed(2)}% ${(headY * 100).toFixed(2)}%`
      : undefined;
  // Solo en el panel editorial: ahí el recorte pierde la cara. En fullscreen el
  // auto-reframe por transform ya sigue al sujeto en vertical → no se toca.
  const panelObjectPosition = editorialLayout ? faceObjectPosition : undefined;

  const activeAnim = animations.find(
    (a) => currentTime >= a.at && currentTime <= a.at + 0.5
  );
  const activeEmphasis = emphasisCards.find(
    (c) => currentTime >= c.at && currentTime <= c.at + c.duration
  );
  const activeZoom = zoomMarks.find(
    (z) => currentTime >= z.at && currentTime <= z.at + z.duration
  );

  const activeReactionZoom = reactionZooms.find(
    (z) => currentTime >= z.at && currentTime <= z.at + z.duration
  );
  const activeStutter = stutterMarks.find(
    (s) => currentTime >= s.at && currentTime <= s.at + s.duration
  );

  let scale = 1;
  if (activeReactionZoom) {
    const t = (currentTime - activeReactionZoom.at) / activeReactionZoom.duration;
    // Punch: subida rápida 0-0.3, sostén 0.3-0.7, bajada rápida 0.7-1
    const punch =
      t < 0.3 ? t / 0.3 : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    scale = 1 + (activeReactionZoom.intensity - 1) * punch;
  } else if (activeZoom) {
    const t = (currentTime - activeZoom.at) / activeZoom.duration;
    const bell = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    scale = 1 + (activeZoom.scale - 1) * bell;
  } else if (activeAnim?.type === "zoom") {
    scale = interpolate(currentTime - activeAnim.at, [0, 0.25, 0.5], [1, 1.08, 1]);
  }

  let shake = 0;
  if (activeReactionZoom) {
    const t = (currentTime - activeReactionZoom.at) / activeReactionZoom.duration;
    shake = Math.sin(t * 80) * 14 * (1 - Math.abs(t - 0.5) * 1.5);
  } else if (activeStutter) {
    const t = currentTime - activeStutter.at;
    // Shake X violento alta frecuencia
    shake = Math.sin(t * 180) * 18;
  } else if (activeAnim?.type === "shake") {
    shake = Math.sin((currentTime - activeAnim.at) * 60) * 6;
  }

  // bebas usa BEBAS, anton + cinematic usan ANTON (cinematic agrega styling extra).
  // Fuente: si subtitleFont != "auto", usa la elegida; si no, la del estilo (bebas/anton).
  const fontFamily =
    subtitleFont && subtitleFont !== "auto" && FONT_MAP[subtitleFont]
      ? FONT_MAP[subtitleFont]
      : subtitleStyle === "bebas"
        ? BEBAS
        : ANTON;
  const fullscreenBRoll = bRollMode === "fullscreen";

  // CameraMoves sobre el video base — SOLO activo en modo cinematic.
  // useCameraMoveTransform respeta la regla de hooks: siempre llamar.
  const cameraMove = useCameraMoveTransform(isCinematicMode ? cameraMoves : []);

  // F3 — MOVIMIENTO REAL en transiciones (auditoría: "se ven congeladas").
  // Además del overlay (ProTransitionLayer), el FRAME se mueve: whip barre en X,
  // zoom_punch empuja la escala, swipe_blur barre en Y, glitch tiembla. La escala
  // se compensa para que el barrido no descubra bordes negros, y el blur del
  // movimiento se suma al filtro del video. Estilos sin transiciones: cero cambio.
  let trScale = 1;
  let trTx = 0;
  let trTy = 0;
  let trBlur = 0;
  let trRotY = 0; // F3 — giro 3D (grados) con perspective
  for (const tr of proTransitions) {
    const durSec = Math.max(1, tr.durationFrames ?? 8) / fps;
    if (currentTime < tr.at || currentTime > tr.at + durSec) continue;
    const p = (currentTime - tr.at) / durSec; // 0→1
    const bell = Math.sin(Math.PI * p); // 0→1→0 (entra y vuelve)
    if (tr.kind === "whip") {
      trTx = bell * compWidth * 0.12;
      trBlur = bell * 26;
    } else if (tr.kind === "zoom_punch") {
      trScale = 1 + bell * 0.16;
      trBlur = bell * 7;
    } else if (tr.kind === "swipe_blur") {
      trTy = bell * compHeight * 0.1;
      trBlur = bell * 20;
    } else if (tr.kind === "glitch") {
      trTx = ((frame % 3) - 1) * bell * 14;
      trTy = (((frame * 7) % 5) - 2) * bell * 6;
    } else if (tr.kind === "iris" || tr.kind === "light_streak") {
      trScale = 1 + bell * 0.07;
    } else if (tr.kind === "flip3d") {
      // Giro 3D: el frame rota en Y (hasta 28°) con un empuje de escala para
      // cubrir el borde que la perspectiva descubre. Blur leve por el movimiento.
      trRotY = bell * 28;
      trScale = 1 + bell * 0.22;
      trBlur = bell * 6;
    }
    break; // una transición activa a la vez
  }
  // Compensación de bordes EXACTA: el transform es `scale(s) translate(t)` → el
  // desplazamiento real es s·t px. Para cubrir: (s-1)·(w/2) ≥ s·|t| →
  // s ≥ (w/2)/((w/2)-|t|). Se toma el peor eje (y un tope por seguridad).
  if (trTx !== 0 || trTy !== 0) {
    const sx = compWidth / 2 / Math.max(1, compWidth / 2 - Math.abs(trTx));
    const sy = compHeight / 2 / Math.max(1, compHeight / 2 - Math.abs(trTy));
    trScale *= Math.min(1.6, Math.max(sx, sy));
  }
  const transitionMotionActive =
    trScale !== 1 || trTx !== 0 || trTy !== 0 || trBlur > 0.5 || trRotY !== 0;

  const baseScale = scale * cameraMove.scale * trScale * autoReframeScale;
  const baseTranslateX =
    shake + cameraMove.translateX + autoReframeTranslateX + autoReframeZoomTranslateX + trTx;
  const baseTranslateY = cameraMove.translateY + autoReframeZoomTranslateY + trTy;
  // MENOS ZOOM en el panel editorial (feedback del usuario): los punches de
  // reactionZoom/cameraMove escalan el video hacia adentro y RECORTAN la cabeza.
  // En editorial el video del panel se queda en cover puro (scale<=1) → encuadre
  // amplio, se ve cabeza + cuerpo. Fuera de editorial, sin cambios.
  const panelVideoScale = editorialLayout ? Math.min(baseScale, 1) : baseScale;
  const panelVideoTranslateX = editorialLayout ? 0 : baseTranslateX;
  const panelVideoTranslateY = editorialLayout ? 0 : baseTranslateY;

  // F3 SUPREME — Color grading PROFESIONAL según densidad (mood-aware).
  // Antes: contrast(1.05) saturate(0.92) — imperceptible.
  // Ahora: 3 moods cinematográficos (KODAK warm / FUJI cool / BLEACH thriller)
  // según cinematicDensity, recibido del project. Diferencia visible entre A/B/C.
  // MAX OUT — color grading extremo para ver el techo. Calibrable después.
  const gradeFilter = isCinematicMode
    ? cinematicDensity === "low"
      ? // KODAK ULTRA WARM — naranja casi quemado
        "contrast(1.6) saturate(0.6) brightness(0.85) hue-rotate(-8deg) sepia(0.25)"
      : cinematicDensity === "high"
      ? // BLEACH BYPASS EXTREMO — casi blanco y negro con tinte azul
        "contrast(1.95) saturate(0.12) brightness(0.82) hue-rotate(-10deg)"
      : // FUJI ULTRA COOL — teal/cyan muy marcado
        "contrast(1.55) saturate(0.6) brightness(0.88) hue-rotate(18deg)"
    : undefined;
  // F3 — PULSO DE COLOR emocional: durante un reaction zoom (que el director
  // emocional pone en los picos), el color "respira" — saturación y contraste
  // suben brevemente con la misma campana del zoom. Sutil pero se siente.
  let colorPulse: string | null = null;
  if (activeReactionZoom) {
    const tz = Math.min(
      1,
      Math.max(0, (currentTime - activeReactionZoom.at) / activeReactionZoom.duration)
    );
    const pulseBell = Math.sin(Math.PI * tz);
    if (pulseBell > 0.05) {
      colorPulse = `saturate(${(1 + pulseBell * 0.22).toFixed(3)}) contrast(${(1 + pulseBell * 0.06).toFixed(3)})`;
    }
  }

  // CINE CLÁSICO — BLANCO Y NEGRO durante los momentos dramáticos. Cada ventana
  // {at, duration} desatura el video base a B&W con contraste alto (look 35mm
  // antiguo) y revierte al salir. Fade de 0.4s en cada borde para que no "salte".
  // Fuera de ventanas k=0 → sin filtro (render idéntico). Vacío = nunca aplica.
  let bwFilter: string | null = null;
  if (bwWindows && bwWindows.length > 0) {
    let k = 0;
    for (const w of bwWindows) {
      const dur = w.duration ?? 2.5;
      if (currentTime < w.at || currentTime > w.at + dur) continue;
      const fade = Math.min(0.4, dur / 2);
      const inK = Math.min(1, (currentTime - w.at) / fade);
      const outK = Math.min(1, (w.at + dur - currentTime) / fade);
      k = Math.max(k, Math.max(0, Math.min(inK, outK)));
    }
    if (k > 0.001) {
      // Mezcla: grayscale(k) + contraste/sepia/brillo escalados por k para que el
      // cruce sea continuo (k=1 → cine antiguo pleno; k=0 → color normal).
      const gray = k.toFixed(3);
      const contrast = (1 + 0.25 * k).toFixed(3);
      const sepia = (0.18 * k).toFixed(3);
      const bright = (1 - 0.06 * k).toFixed(3);
      bwFilter = `grayscale(${gray}) contrast(${contrast}) sepia(${sepia}) brightness(${bright})`;
    }
  }

  // F3 — blur de movimiento de las transiciones se suma al grade (si lo hay).
  const videoFilter =
    [gradeFilter, colorPulse, bwFilter, trBlur > 0.5 ? `blur(${trBlur.toFixed(1)}px)` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // F2 SUPREME — Motion blur OFICIAL de Remotion (regla 180° cine).
  // Solo activo cuando hay un camera move ACTIVO en ese frame (cameraMove.scale!=1
  // o translate!=0). Sin esto, CameraMotionBlur no agrega costo CPU porque no
  // detecta movimiento.
  const hasActiveCameraMotion =
    (isCinematicMode &&
      (Math.abs(cameraMove.scale - 1) > 0.001 ||
        Math.abs(cameraMove.translateX) > 0.5 ||
        Math.abs(cameraMove.translateY) > 0.5)) ||
    // F3 — las transiciones con movimiento también reciben motion blur real.
    transitionMotionActive;

  // EDITORIAL — panel DINÁMICO: el video cambia de tamaño/lugar por escenas
  // (derecha → izquierda → cuadrado → grande → fullscreen) con transición suave.
  // Sin editorial: inset 0 (passthrough exacto al comportamiento histórico).
  const editorialPanel = editorialLayout
    ? editorialPanelAt(editorialLayout, currentTime, compWidth, compHeight, sourceAspect)
    : null;
  // Look resuelto del sub-tema (lienzo, duotono, textura) — o clásico si no hay theme.
  const edLook = editorialLayout ? resolveEditorialLook(editorialLayout) : null;
  // EDITORIAL — chart activo (Ola 5): mientras dura, las tarjetas se ocultan
  // (anti-encime: el chart ES la tarjeta de ese momento).
  const activeEditorialViz = editorialLayout
    ? dataViz.find((v) => currentTime >= v.at && currentTime <= v.at + (v.duration ?? 4)) ?? null
    : null;
  // EDITORIAL — collage activo (Ola 6): igual que el chart, manda él solo.
  const cutoutActive = Boolean(
    editorialLayout &&
      editorialCutout &&
      currentTime >= editorialCutout.at &&
      currentTime <= editorialCutout.at + (editorialCutout.duration ?? 4.5)
  );
  // EDITORIAL — globo activo (Ola 7): el viaje al lugar mencionado manda solo.
  const mapActive = Boolean(
    editorialLayout &&
      editorialMap &&
      currentTime >= editorialMap.at &&
      currentTime <= editorialMap.at + (editorialMap.duration ?? 5)
  );
  const editorialChartFonts: [string, string] = editorialLayout
    ? editorialFontsFor(editorialLayout)
    : ["Georgia, serif", "Arial, sans-serif"];
  const videoContainerStyle: React.CSSProperties = editorialPanel
    ? {
        position: "absolute",
        left: editorialPanel.x,
        top: editorialPanel.y,
        width: editorialPanel.w,
        height: editorialPanel.h,
        borderRadius: editorialPanel.r,
        overflow: "hidden",
        boxShadow:
          editorialPanel.r > 1 ? "0 24px 90px rgba(0,0,0,0.65)" : "none",
        // Ola 6 — temas de papel: bordes del panel RASGADOS (displacement map;
        // seed fijo = determinista). Solo cuando el panel no es fullscreen.
        filter:
          edLook?.tornPanel && editorialPanel.r > 1 ? "url(#ed-torn-edge)" : undefined,
      }
    : { position: "absolute", inset: 0 };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: edLook ? edLook.canvas.bg : "#000",
      }}
    >
      {/* EDITORIAL — filtro de borde rasgado para temas de papel (Ola 6). */}
      {edLook?.tornPanel && (
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <filter id="ed-torn-edge" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.05" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {/* EDITORIAL — textura de papel procedural detrás de TODO (Ola 1). */}
      {edLook && edLook.texture === "paper" && (
        <EditorialPaper
          width={compWidth}
          height={compHeight}
          darkCanvas={isDarkCanvas(edLook.canvas)}
        />
      )}
      {/* EDITORIAL — decoración ambiental SIEMPRE visible detrás de todo:
          el lienzo nunca queda vacío entre tarjetas ni en escenas big/full. */}
      {editorialLayout && (
        <EditorialAmbient
          layout={editorialLayout}
          currentTime={currentTime}
          width={compWidth}
          height={compHeight}
        />
      )}
      <div style={videoContainerStyle}>
      <AbsoluteFill
        style={{
          // F3 — la perspectiva + rotateY solo aparecen durante un flip3d activo;
          // el resto del tiempo el transform es idéntico al histórico.
          transform:
            trRotY !== 0
              ? `perspective(1200px) rotateY(${trRotY.toFixed(2)}deg) scale(${panelVideoScale}) translate(${panelVideoTranslateX}px, ${panelVideoTranslateY}px)`
              : `scale(${panelVideoScale}) translate(${panelVideoTranslateX}px, ${panelVideoTranslateY}px)`,
        }}
      >
        {rawVideoUrl && (
          hasActiveCameraMotion ? (
            // MAX OUT (calibrado) — shutterAngle 270° + 15 samples (25 samples reventaba)
            <CameraMotionBlur shutterAngle={270} samples={15}>
              <OffthreadVideo
                src={rawVideoUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: panelObjectPosition,
                  filter: videoFilter,
                }}
              />
            </CameraMotionBlur>
          ) : (
            <OffthreadVideo
              src={rawVideoUrl}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: panelObjectPosition,
                filter: videoFilter,
              }}
            />
          )
        )}
      </AbsoluteFill>
      {/* EDITORIAL — duotono del panel (look Economist): desatura el video y
          mapea sombras→tinta, luces→papel. Solo monta si el tema lo pide. */}
      {edLook && edLook.duotone > 0 && (
        <EditorialDuotone
          strength={edLook.duotone}
          shadow={duotonePairFor(edLook.canvas).shadow}
          highlight={duotonePairFor(edLook.canvas).highlight}
        />
      )}
      </div>

      {/* A4 — Speed ramps: ventanas donde se overlay-ea el source a rate < 1 (slow-mo)
          o > 1 (acelerado), tapando el base 1x debajo. Audio mute para no doblar. */}
      {speedRamps.map((r, i) => {
        const fromFrame = Math.round(r.at * fps);
        const winFrames = Math.max(1, Math.round(r.duration * fps));
        return (
          <Sequence key={`sr-${i}`} from={fromFrame} durationInFrames={winFrames}>
            <AbsoluteFill
              style={{
                transform: `scale(${baseScale}) translate(${baseTranslateX}px, ${baseTranslateY}px)`,
              }}
            >
              {rawVideoUrl && (
                <OffthreadVideo
                  src={rawVideoUrl}
                  startFrom={fromFrame}
                  playbackRate={r.rate}
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: videoFilter,
                  }}
                />
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {fullscreenBRoll &&
        bRoll.map((clip, i) => (
          <Sequence
            key={`${clip.start}-${i}`}
            from={Math.floor(clip.start * fps)}
            durationInFrames={Math.ceil((clip.end - clip.start) * fps)}
          >
            <AbsoluteFill>
              <OffthreadVideo
                src={clip.url}
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </AbsoluteFill>
          </Sequence>
        ))}

      {!fullscreenBRoll &&
        bRoll.map((clip, i) => (
          <Sequence
            key={`${clip.start}-${i}`}
            from={Math.floor(clip.start * fps)}
            durationInFrames={Math.ceil((clip.end - clip.start) * fps)}
          >
            <PipBRollLayer url={clip.url} accent={subtitleHighlight} />
          </Sequence>
        ))}

      {/* Mirror/clone/split — cubre el video base durante su ventana, debajo de
          subtítulos/stickers. Solo monta si mirrorFx trae datos (aditivo). */}
      {mirrorFx.length > 0 && (
        <MirrorFxLayer
          fx={mirrorFx}
          rawVideoUrl={rawVideoUrl}
          currentTime={currentTime}
          videoFilter={videoFilter}
        />
      )}

      {/* TEXTO DETRÁS DEL SUJETO (matte estático): el texto va sobre el video y el
          recorte del sujeto encima → el texto queda "detrás" de la persona. Debajo de
          subtítulos/stickers/vignette. null = no monta (render idéntico). */}
      {textBehind && (
        <TextBehindLayer
          config={textBehind}
          currentTime={currentTime}
          fontFamily={fontFamily}
        />
      )}

      {vignette && (
        <AbsoluteFill
          style={{
            background: isCinematicMode
              ? // MAX OUT — vignette extrema, bordes prácticamente negros
                "radial-gradient(ellipse 75% 55% at center, transparent 15%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.99) 95%, rgba(0,0,0,1) 100%)"
              : "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)",
            pointerEvents: "none",
          }}
        />
      )}

      {activeAnim?.type === "glow" && (
        <AbsoluteFill
          style={{
            boxShadow: `inset 0 0 200px ${subtitleHighlight}`,
            mixBlendMode: "screen",
            opacity: 0.6,
          }}
        />
      )}

      {/* MAX OUT — Flash 8 frames blancos + Glitch RGB en TODOS los density */}
      {isCinematicMode && activeStutter && (() => {
        const stutterFrame = Math.round((currentTime - activeStutter.at) * fps);
        // Flash: 8 frames con decay (1.0, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.1)
        const flashRamp = [1.0, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.1];
        const flashOpacity = stutterFrame < flashRamp.length ? flashRamp[stutterFrame] : 0;
        // RGB glitch: TODOS los density, 12 frames con magnitud 30px (era 12)
        const showGlitch = stutterFrame < 12;
        const glitchMag = stutterFrame < 12 ? 30 - (stutterFrame * 2) : 0;
        return (
          <>
            {flashOpacity > 0 && (
              <AbsoluteFill
                style={{
                  background: "white",
                  opacity: flashOpacity,
                  pointerEvents: "none",
                }}
              />
            )}
            {showGlitch && (
              <AbsoluteFill
                style={{
                  pointerEvents: "none",
                  mixBlendMode: "screen",
                  opacity: 0.95,
                  filter: `drop-shadow(${(stutterFrame % 2 === 0 ? glitchMag : -glitchMag)}px 0 0 rgba(255,0,0,1)) drop-shadow(${(stutterFrame % 2 === 0 ? -glitchMag : glitchMag)}px 0 0 rgba(0,255,255,1)) drop-shadow(0 ${glitchMag * 0.5}px 0 rgba(255,255,0,0.6))`,
                  background:
                    "linear-gradient(180deg, transparent 0%, transparent 100%)",
                }}
              />
            )}
          </>
        );
      })()}

      {/* Subtítulo: con kineticPreset "none" se usa el SubtitleLayer de siempre.
          Los estilos que eligen un preset cinético montan KineticSubtitleLayer en su lugar.
          En modo EDITORIAL no hay captions: las tarjetas tipográficas SON el texto. */}
      {!editorialLayout && (kineticPreset === "none" ? (
        <SubtitleLayer
          words={words}
          currentTime={currentTime}
          fps={fps}
          fontFamily={fontFamily}
          color={subtitleColor}
          highlight={subtitleHighlight}
          colorRotation={colorRotation}
          bounce={captionBounce}
          subtitleStyle={subtitleStyle}
          position={subtitlePosition}
        />
      ) : (
        <KineticSubtitleLayer
          words={words}
          currentTime={currentTime}
          fps={fps}
          preset={kineticPreset}
          fontFamily={fontFamily}
          color={subtitleColor}
          highlight={subtitleHighlight}
          position={subtitlePosition}
        />
      ))}

      {/* EDITORIAL — BASELINE DE TEXTO: subtítulo editorial SIEMPRE presente
          (frase activa según la voz, look del tema). Va por DEBAJO de las
          tarjetas/charts y NO se oculta en "big"/"full": así nunca hay pantalla
          sin texto, ni siquiera cuando las tarjetas ceden el cuadro al video. */}
      {editorialLayout && editorialPanel && words.length > 0 && (
        <EditorialSubtitleBaseline
          words={words}
          currentTime={currentTime}
          layout={editorialLayout}
          width={compWidth}
          height={compHeight}
          panel={editorialPanel}
        />
      )}

      {/* EDITORIAL — tarjetas tipográficas (kicker + titular serif + stat + line-art).
          Cuando el panel está en "big"/"full", se ocultan: el video respira. */}
      {editorialLayout &&
        editorialPanel &&
        !editorialPanel.cardsHidden &&
        !activeEditorialViz &&
        !cutoutActive &&
        !mapActive &&
        editorialCards
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => currentTime >= c.at && currentTime <= c.at + (c.duration ?? 5))
          .map(({ c, i }) => (
            <EditorialCardLayer
              key={`ed-${i}-${c.at}`}
              card={c}
              currentTime={currentTime}
              layout={editorialLayout}
              width={compWidth}
              height={compHeight}
              panel={editorialPanel}
              index={i}
            />
          ))}

      {/* EDITORIAL — data-viz de periódico (Ola 5): hairline Economist o
          sketchy a mano según el tema; reemplaza a las tarjetas mientras dura. */}
      {editorialLayout && editorialPanel && !editorialPanel.cardsHidden && activeEditorialViz && (
        <EditorialChartLayer
          viz={activeEditorialViz}
          currentTime={currentTime}
          layout={editorialLayout}
          width={compWidth}
          height={compHeight}
          panel={editorialPanel}
          fontTitle={editorialChartFonts[0]}
          fontKicker={editorialChartFonts[1]}
        />
      )}

      {/* EDITORIAL — tarjeta de COLLAGE (Ola 6): sujeto recortado como papel
          de tijera con sombra dura + Ken Burns sutil; manda él solo. */}
      {editorialLayout && editorialPanel && !editorialPanel.cardsHidden && cutoutActive && editorialCutout && (
        <EditorialCutoutLayer
          cut={editorialCutout}
          currentTime={currentTime}
          layout={editorialLayout}
          width={compWidth}
          height={compHeight}
          panel={editorialPanel}
        />
      )}

      {/* EDITORIAL — globo con zoom al lugar mencionado (Ola 7). */}
      {editorialLayout && editorialPanel && !editorialPanel.cardsHidden && mapActive && editorialMap && (
        <EditorialGlobeLayer
          map={editorialMap}
          currentTime={currentTime}
          layout={editorialLayout}
          width={compWidth}
          height={compHeight}
          panel={editorialPanel}
        />
      )}

      {/* EDITORIAL — capa de cohesión final: grano vivo + viñeta + aberración
          sutil. Unifica todo el render "como filmado" (Ola 1). */}
      {editorialLayout && editorialLayout.cohesion && edLook && (
        <EditorialFinish
          width={compWidth}
          height={compHeight}
          t={currentTime}
          darkCanvas={isDarkCanvas(edLook.canvas)}
        />
      )}

      {floatingEmojis
        .filter(
          (e) => currentTime >= e.at - 0.05 && currentTime <= e.at + e.duration
        )
        .map((e, i) => {
          // Si hay sticker top-center activo y el emoji venía de 'top', redirigir a 'left' para no chocar.
          const topStickerActive = wordStickers.some(
            (s) =>
              s.position === "top-center" &&
              currentTime >= s.at &&
              currentTime <= s.at + s.duration
          );
          const safeEmoji =
            e.from === "top" && topStickerActive
              ? { ...e, from: "left" as const }
              : e;
          return (
            <FloatingEmojiLayer
              key={`fe-${i}`}
              emoji={safeEmoji}
              currentTime={currentTime}
            />
          );
        })}

      {wordStickers
        .map((s, i, arr) => {
          // Cortar la duración si el siguiente sticker arranca antes.
          const next = arr[i + 1];
          const effectiveEnd =
            next && next.at < s.at + s.duration
              ? next.at - 0.05
              : s.at + s.duration;
          return { sticker: s, effectiveEnd, index: i };
        })
        .filter(
          ({ sticker, effectiveEnd }) =>
            currentTime >= sticker.at - 0.05 && currentTime <= effectiveEnd
        )
        .map(({ sticker, effectiveEnd, index }) => (
          <WordStickerLayer
            key={`ws-${index}`}
            sticker={{ ...sticker, duration: effectiveEnd - sticker.at }}
            currentTime={currentTime}
            fontFamily={fontFamily}
          />
        ))}

      {/* B5 — Icon stickers: aparecen N segundos con un icono del ICON_MAP. Aditivo. */}
      {iconStickers
        .filter((s) => currentTime >= s.at - 0.05 && currentTime <= s.at + s.duration)
        .map((s, i) => (
          <IconStickerLayer key={`is-${i}-${s.at}`} sticker={s} currentTime={currentTime} />
        ))}

      {/* B4 — Stickers ANIMADOS (Lottie): animación vectorial en loop. Aditivo. */}
      {lottieStickers
        .filter((s) => currentTime >= s.at - 0.05 && currentTime <= s.at + s.duration)
        .map((s, i) => (
          <LottieStickerLayer key={`ls-${i}-${s.at}`} sticker={s} currentTime={currentTime} />
        ))}

      {/* MOTION PRO — Fondo animado (aurora/mesh/grid), pulsa con la música. */}
      {animatedBackground && (
        <AnimatedBackgroundLayer bg={animatedBackground} musicUrl={musicUrl} />
      )}

      {/* F3 — Partículas procedurales (confeti/chispas/brasas/lluvia de emojis). */}
      {particleBursts
        .filter((b) => currentTime >= b.at && currentTime <= b.at + (b.duration ?? 2.2))
        .map((b, i) => (
          <ParticleLayer
            key={`pb-${i}-${b.at}`}
            burst={b}
            currentTime={currentTime}
            width={compWidth}
            height={compHeight}
          />
        ))}

      {activeEmphasis && (
        <EmphasisCardLayer
          card={activeEmphasis}
          currentTime={currentTime}
          fontFamily={fontFamily}
        />
      )}

      {sfxMarks.map((sfx, i) => {
        const startFrame = Math.max(0, Math.floor(sfx.at * fps));
        return (
          <Sequence
            key={`sfx-${i}-${sfx.at}`}
            from={startFrame}
            durationInFrames={Math.max(1, Math.ceil(3 * fps))}
          >
            <Audio src={sfx.url ?? sfx.sound} volume={sfx.volume} />
          </Sequence>
        );
      })}

      {musicUrl && (
        <Audio
          src={musicUrl}
          // F1 — Auto-ducking: la música baja cuando hay voz y respira en pausas
          // largas, con rampa de 0.45s en cada transición (sin saltos audibles).
          // Curva vacía = volumen constante. SIEMPRE: fade-out en los últimos
          // 1.6s — sin esto la música cortaba en seco al terminar (anti-premium).
          volume={(f) => {
            const t = f / fps;
            const fadeOut = Math.min(1, Math.max(0, (totalDuration - t) / 1.6));
            if (musicVolumeCurve.length === 0) return musicVolume * fadeOut;
            let idx = 0;
            for (let i = 0; i < musicVolumeCurve.length; i++) {
              if (musicVolumeCurve[i].t <= t) idx = i;
              else break;
            }
            const target = musicVolumeCurve[idx].v;
            const from = idx > 0 ? musicVolumeCurve[idx - 1].v : target;
            const ramp = Math.min(1, Math.max(0, (t - musicVolumeCurve[idx].t) / 0.45));
            return Math.max(0, musicVolume * (from + (target - from) * ramp) * fadeOut);
          }}
        />
      )}

      {/* C1 — Voz IA (Piper): pista de audio extra. Arranca en voiceoverStartSec. */}
      {voiceoverUrl && (
        <Sequence from={Math.max(0, Math.round(voiceoverStartSec * fps))}>
          <Audio src={voiceoverUrl} volume={voiceoverVolume} />
        </Sequence>
      )}

      {/* === Modo cinematográfico (opt-in vía imageOverlays/filmGrain/vignette) === */}
      {/* Cuando isCinematicMode=true → imágenes FULLSCREEN + TV grain siempre + Ken Burns amplio */}
      <ImageOverlayLayer overlays={imageOverlays} fullscreenCinematic={isCinematicMode} />
      <FilmGrainLayer enabled={filmGrain} />

      {/* === CapCut Pro FX (opt-in, ADITIVO) — solo montan si traen datos === */}
      {sceneFx.length > 0 && <SceneFxLayer fx={sceneFx} currentTime={currentTime} />}
      {proTransitions.length > 0 && (
        <ProTransitionLayer
          transitions={proTransitions}
          currentTime={currentTime}
          fps={fps}
        />
      )}

      {/* PRO — transiciones oficiales de Remotion (@remotion/transitions): slide/
          wipe/flip/clockWipe/none como overlay en los cortes. Aditivo a las caseras. */}
      {proTransitionSeries.length > 0 && (
        <ProTransitionSeriesLayer
          transitions={proTransitionSeries}
          currentTime={currentTime}
        />
      )}

      {/* ILUSTRACIONES CC0 multicolor (open-doodles/open-peeps) como sticker de
          personas, con duotono opcional al tema. Aditivo: [] = render idéntico. */}
      {illustrationStickers
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => currentTime >= s.at - 0.05 && currentTime <= s.at + s.duration)
        .map(({ s, i }) => (
          <IllustrationStickerLayer
            key={`illus-${i}-${s.at}`}
            sticker={s}
            currentTime={currentTime}
            index={i}
          />
        ))}

      {/* Motion tracking — label que sigue la cara. Encima de todo. Aditivo. */}
      {trackPath.length > 0 && trackedItems.length > 0 && (
        <TrackedLayer
          trackPath={trackPath}
          items={trackedItems}
          currentTime={currentTime}
          fontFamily={fontFamily}
        />
      )}

      {/* MODO GRÁFICOS & MOTION — gráficas animadas (counter/bar/line/donut). Aditivo.
          En EDITORIAL las dibuja EditorialChartLayer con el look del tema (Ola 5). */}
      {!editorialLayout && dataViz.map((dv, i) => (
        <DataVizLayer
          key={`dv-${i}`}
          config={dv}
          currentTime={currentTime}
          fps={fps}
          fontFamily={fontFamily}
        />
      ))}

      {/* MODO GRÁFICOS & MOTION — titulares poderosos animados. Aditivo. */}
      {kineticHeadlines.map((kh, i) => (
        <KineticHeadlineLayer
          key={`kh-${i}`}
          config={kh}
          currentTime={currentTime}
          fps={fps}
          fontFamily={fontFamily}
        />
      ))}

      {/* A8 — Barra de progreso (opt-in). Encima de todo, no tapa nada. */}
      {progressBar && (
        <AbsoluteFill style={{ pointerEvents: "none", justifyContent: "flex-start" }}>
          <div
            style={{
              height: 8,
              width: `${Math.min(100, (frame / Math.max(1, durationInFrames)) * 100)}%`,
              background: subtitleHighlight,
              boxShadow: `0 0 16px ${subtitleHighlight}`,
            }}
          />
        </AbsoluteFill>
      )}

      {/* A6 — End-screen / CTA en los últimos segundos. Encima de todo. Aditivo. */}
      {endScreen && (
        <EndScreenLayer
          config={endScreen}
          currentTime={currentTime}
          totalDuration={totalDuration}
          fps={fps}
          fontFamily={fontFamily}
        />
      )}

      {/* B6 — Marca de agua (handle/logo) sutil en una esquina, todo el video. Aditivo. */}
      {brandKit && (brandKit.handle || brandKit.logoUrl) && (
        <BrandWatermarkLayer config={brandKit} fontFamily={fontFamily} />
      )}

      {/* OVERLAY de TEXTURA procedural (grano/polvo/scratches) compuesto sobre TODO
          con mixBlendMode opcional. null = sin textura (render idéntico). */}
      {overlayTexture && <OverlayTextureLayer overlay={overlayTexture} />}

      {/* PRUEBA GRATUITA — pill discreto encima de TODO. Estático a propósito
          (sin animación = barato de render). Posición relativa al AbsoluteFill
          raíz, así se ve igual en 9:16 y 16:9. */}
      {trialWatermark && (
        <div
          style={{
            position: "absolute",
            left: 24,
            bottom: 24,
            padding: "10px 22px",
            background: "rgba(0,0,0,0.45)",
            borderRadius: 999,
            color: "rgba(255,255,255,0.7)",
            fontSize: 26,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            fontWeight: 600,
            letterSpacing: 0.5,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          PRUEBA GRATUITA · Viralito
        </div>
      )}
    </AbsoluteFill>
  );
};

// IconStickerLayer vive ahora en ./layers/icon-sticker-layer.

// EndScreenLayer vive ahora en ./layers/end-screen-layer.

// PipBRollLayer vive ahora en ./layers/pip-broll-layer.

// FloatingEmojiLayer vive ahora en ./layers/floating-emoji-layer.

// WordStickerLayer vive ahora en ./layers/word-sticker-layer.

// EmphasisCardLayer vive ahora en ./layers/emphasis-card-layer.

// SubtitleLayer vive ahora en ./layers/subtitle-layer.
