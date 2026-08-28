// Types compartidos por auto-build/route.ts y sus helpers/módulos auxiliares.
// Extraído del archivo monolítico para mantener una sola fuente de verdad.

import type { StyleId } from "@/lib/style-templates";
import type { BrollSource } from "@/lib/pexels";

export interface CinematicConfig {
  /** IDs de imageOverlays subidos a /api/overlays/upload */
  overlayIds: string[];
  filmGrain?: boolean;
  vignette?: boolean;
  /** Si true, usa subtitleStyle="cinematic" en lugar del default del estilo */
  subtitleCinematic?: boolean;
  /**
   * Perfil de densidad cinematográfica:
   *   low    → 3 camera moves, 4-8 SFX, 0 jump cuts (suave)
   *   medium → 6 camera moves, 6-12 SFX, 3 jump cuts (default)
   *   high   → 10 camera moves, 10-18 SFX, 6 jump cuts (intenso)
   * Usado en tests A/B/C.
   */
  density?: "low" | "medium" | "high";
}

export interface AutoBuildRequest {
  /** Single-video (legacy). Si viene videoIds[] se ignora. */
  videoId?: string;
  /** Multi-video (preferido). Cada videoId crea un job propio. */
  videoIds?: string[];
  styles: StyleId[];
  accentColor: string;
  /** Fuente de subtítulos elegida ("auto" = la del estilo). Google Fonts gratis. */
  subtitleFont?: string;
  /** Color del TEXTO de los subtítulos elegido en el wizard ("auto" = el del estilo). */
  subtitleColor?: string;
  /** Tema del estilo Editorial: fuente serif + fondo del lienzo + sub-tema
   *  de clase mundial ("prensa", "vogue", "riso"… — ver editorial-themes.tsx). */
  editorialTheme?: { font?: string; background?: string; theme?: string };
  /** Fondo animado elegido en el wizard para los estilos motion_* (mismo "kind"
   *  que animatedBackground en style-templates). undefined = el propio del estilo. */
  motionBackground?: "aurora" | "mesh" | "grid";
  /** Intensidad de FX para los estilos hype/hype_max/hype_max_sfx/supreme:
   *  "suave" recorta los FX que el estilo ya trae, "max" los acentúa.
   *  undefined = "normal" (el balance original del estilo, sin cambios). */
  fxIntensity?: "suave" | "max";
  caption?: string;
  captionMeta?: Record<string, unknown>;
  platforms?: string[];
  day?: number;
  /** Aspecto del output. "9:16" → 1080×1920 (vertical, default). "1:1" → 1080×1080 (cuadrado). "16:9" → 1920×1080 (horizontal). */
  aspectRatio?: "9:16" | "1:1" | "16:9";
  /**
   * De dónde sale el material de relleno en los estilos que lo usan
   * (`broll_full`, `broll_pip`, `editorial_broll`). Es una decisión de FUENTE,
   * no de estilo: la composición no cambia, solo qué se ve en el hueco. Sirve
   * para renderizar el mismo video con distinta fuente y compararlas.
   *   auto (default) — video de Pexels, completado con CC0 si falta
   *   pexels_video   — solo video de Pexels
   *   pexels_photo   — fotos de Pexels
   *   giphy          — GIFs de Giphy, servidos como MP4 para que se animen
   *   cc0            — solo dominio público, sin clave
   */
  /** Una fuente, o varias que se alternan momento a momento. */
  brollSource?: BrollSource | BrollSource[];
  /** Modo cinematográfico opt-in. Si undefined, render sale idéntico a antes. */
  cinematic?: CinematicConfig;
  /**
   * Sufijo opcional para el projectId — usado por test-ab para diferenciar
   * renders A/B/C del mismo video+estilo. Ej: "_test_A" → projectId = "Video Imagen_hype_max_sfx_test_A".
   */
  projectIdSuffix?: string;
}

/**
 * Forma "wide" del project que arma processJob: la base (buildProjectForStyle) ya viene
 * con sceneFx/proTransitions/etc pero muchos campos opt-in se agregan o leen en este
 * archivo. Antes había ~17 `(project as { foo? }).foo` repartidos; con este tipo y un
 * solo cast al construir el project, todos los accesos quedan tipados.
 */
export interface ResolvedProject {
  id: string;
  videoId: string;
  title?: string;
  styleId: StyleId;
  caption?: string;
  captionTranslated?: string;
  platforms?: string[];
  captionMeta?: unknown;
  // FX y assets opt-in
  beatSync?: boolean;
  enableJumpCuts?: boolean;
  musicTrack?: string | null;
  tracking?: boolean;
  trackPath?: unknown[];
  // A2 — auto-reframe: sigue la cara del sujeto. autoReframe lo activan los estilos
  // viral (hype*/supreme) vía applyCapcutFx; sourceAspect/Width/Height los computa
  // applyTracking con ffprobe sobre el raw (sin ellos, build-props cae a 16/9 default).
  autoReframe?: boolean;
  sourceAspect?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  removeBg?: boolean;
  foregroundVideoId?: string;
  voiceover?: { text?: string; volume?: number; startSec?: number; speakerWav?: string; lang?: string };
  voiceoverUrl?: string;
  voiceoverVolume?: number;
  voiceoverStartSec?: number;
  textBehind?: { phrase?: string; color?: string };
  translateTo?: string;
  lut?: string | null;
  zoomMarks?: unknown[];
  proTransitions?: unknown[];
  reactionZooms?: unknown[];
  brandKit?: { handle?: string; logoUrl?: string; position?: string; opacity?: number; color?: string };
  bRoll?: unknown[];
  // Fuente de subtítulos elegida en el wizard ("auto" = la del estilo).
  subtitleFont?: string;
  // Color del TEXTO de los subtítulos elegido en el wizard ("auto" = el del estilo).
  subtitleColor?: string;
  // F2 — "top" si el tracking detectó la cara en la zona baja (no tapar al speaker).
  subtitlePosition?: "bottom" | "top";
  // F1 — Director emocional: ducking de música + mood + SFX modulados por arousal.
  musicVolumeCurve?: { t: number; v: number }[];
  mood?: string;
  sfxMarks?: unknown[];
  // CINE CLÁSICO — look base + drama por-pico (B&W de la imagen + voz a radio vieja).
  filmGrain?: boolean;
  cinematicDensity?: "low" | "medium" | "high";
  imageOverlays?: unknown[];
  cameraMoves?: unknown[];
  /** Ventanas de blanco y negro en los picos dramáticos (las computa auto-build). */
  bwWindows?: { at: number; duration: number }[];
  /** Cadena -af extra que el mastering de audio antepone al mastering base
   *  (cine_clasico: band-limit telefónico gateado a las ventanas de pico). */
  audioFilterPre?: string;
  // F3 — Partículas procedurales (chispas en el pico emocional, confeti, etc.).
  particleBursts?: { at: number; duration: number; kind: string; count?: number }[];
  /**
   * Momentos donde la imagen se congela para rematar.
   *
   * Lo pone el director emocional en el pico maximo del video (ver
   * `fx-enrichments.ts`). El schema del composition lo valida; declararlo aca
   * es lo que permite que el enriquecedor lo escriba con el tipo puesto — sin
   * esto compilaria igual con un `as`, y quedaria como un campo que nadie sabe
   * que existe.
   */
  freezeMarks?: Array<{ at: number; duration?: number }>;
  // FX que los estilos hype*/supreme ya generan (los lee el override fxIntensity).
  wordStickers?: unknown[];
  floatingEmojis?: unknown[];
  stutterMarks?: unknown[];
  // Fondo animado de los estilos motion_* (lo setea buildProjectForStyle; el
  // override motionBackground del wizard solo cambia el "kind").
  animatedBackground?: { kind: string; colors?: string[]; opacity?: number; audioReactive?: boolean };
  // Modo Gráficos & Motion (estilos graphics_*): applyGraphics genera dataViz +
  // kineticHeadlines desde el transcript del short y los deja acá.
  graphics?: boolean;
  dataViz?: unknown[];
  kineticHeadlines?: unknown[];
  iconStickers?: unknown[];
  // ILUSTRACIONES CC0 (Phase 4) — personas/escenas multicolor (opt-in vía el
  // REGISTRO de estilos, no vía flag del proyecto). applyIllustrations las llena.
  illustrationStickers?: unknown[];
  // EDITORIAL — split-screen documental (tarjetas serif + line-art).
  editorialLayout?: { panel: string; panelWidth: number } | null;
  editorialCards?: unknown[];
  // EDITORIAL Ola 6 — recorte de sujeto (rembg) para la tarjeta de collage.
  editorialCutout?: { at: number; duration: number; file: string } | null;
  // EDITORIAL Ola 7 — globo con zoom al lugar mencionado.
  editorialMap?: { at: number; duration: number; lat: number; lon: number; label: string } | null;
}
