import { staticFile } from "remotion";

/**
 * Fuentes editoriales OFFLINE — antes se bajaban de fonts.gstatic.com EN CADA
 * RENDER vía `@remotion/google-fonts/*` (carga a nivel de módulo). Sin internet,
 * `loadFont()` de ese paquete LANZA y aborta el render de CUALQUIER estilo
 * (porque ViralVideo importa editorial-themes/editorial-layer siempre). Esta es
 * la causa raíz del "sin internet no funciona" / "el video no salió".
 *
 * Ahora se hornean a TTF locales (`python/download_fonts.py` → remotion/public/fonts)
 * con `@remotion/fonts` + `staticFile` — CERO red en render. Mismo patrón que
 * editorial-ink.tsx y el bloque local de ViralVideo.tsx.
 *
 * Los `family` son EXACTAMENTE los strings CSS que devolvía google-fonts, así que
 * todo lo que vive aguas abajo (EDITORIAL_THEME_DEFS, FONT_THEMES…) queda idéntico.
 * Las itálicas se registran bajo el MISMO family con `style:"italic"` (igual que
 * google-fonts) → la palabra acento las toma con `fontStyle:"italic"`.
 */

const VAR = "100 900"; // rango de pesos para fuentes variables [wght]

/**
 * Registra una fuente local en modo LAZY — el navegador la descarga SOLO cuando un
 * glyph la usa (el tema activo usa 2-3 de estas, no las 24). Decisión clave de robustez:
 *
 *  - NUNCA usa `delayRender`. Antes, una `delayRender` por fuente bloqueaba el render
 *    hasta que el .ttf cargara; bajo el render CONCURRENTE de largos (varios clips ×
 *    varias pestañas) el browser satura sus ~6 conexiones por host —que la transmisión
 *    de OffthreadVideo ya ocupa— y la descarga de UNA fuente quedaba esperando para
 *    siempre → la delayRender nunca se limpiaba → Remotion ABORTABA el clip
 *    ("delayRender 'local-font ...' not cleared after 58000ms"). (El `setTimeout` que
 *    intenté NO sirve: Remotion controla los timers en el render y no lo dispara.)
 *  - NO llama `.load()` eager: si bajara las 24 de golpe, competirían por las conexiones
 *    con las fuentes que SÍ importan (las de editorial-ink/ViralVideo, que sí esperan).
 *    En lazy, las no usadas NO se descargan → cero tormenta → el render nunca se cuelga.
 *
 * Las usadas se bajan on-demand (puede haber un parpadeo a fuente de sistema en los
 * primeros frames de un título; aceptable y MUCHO mejor que un video que no sale).
 *
 * Corre en el browser del render (FontFace/document existen). En Node (sin FontFace) = no-op.
 */
const F = (
  file: string,
  family: string,
  opts: { style?: "normal" | "italic"; weight?: string } = {}
): string => {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return family;
  try {
    const face = new FontFace(family, `url('${staticFile(`fonts/${file}`)}') format('truetype')`, {
      style: opts.style ?? "normal",
      weight: opts.weight ?? "400",
    });
    // add() sin load(): registro lazy. FontFaceSet es un Set<FontFace> por spec.
    (document.fonts as unknown as Set<FontFace>).add(face);
  } catch {
    // .ttf inválido / FontFace no disponible → se ignora; cae a fuente de sistema.
  }
  return family;
};

// ─── editorial-themes.tsx (12+ sub-temas) ───
export const OLDSTD = F("OldStandardTT-Regular.ttf", "Old Standard TT");
F("OldStandardTT-Bold.ttf", "Old Standard TT", { weight: "700" });
F("OldStandardTT-Italic.ttf", "Old Standard TT", { style: "italic" });
export const OLDSTD_IT = "Old Standard TT";

export const CORMORANT = F("CormorantGaramond-var.ttf", "Cormorant Garamond", { weight: VAR });
F("CormorantGaramond-italic-var.ttf", "Cormorant Garamond", { style: "italic", weight: VAR });
export const CORMORANT_IT = "Cormorant Garamond";

export const KARLA = F("Karla-var.ttf", "Karla", { weight: VAR });

export const ARCHIVO_BLACK = F("ArchivoBlack-Regular.ttf", "Archivo Black");

export const SPACE_MONO = F("SpaceMono-Regular.ttf", "Space Mono");
F("SpaceMono-Bold.ttf", "Space Mono", { weight: "700" });

export const IMFELL = F("IMFellEnglish-Regular.ttf", "IM Fell English");
F("IMFellEnglish-Italic.ttf", "IM Fell English", { style: "italic" });
export const IMFELL_IT = "IM Fell English";

export const OSWALD = F("Oswald-var.ttf", "Oswald", { weight: VAR });

export const JOSEFIN = F("JosefinSans-var.ttf", "Josefin Sans", { weight: VAR });
F("JosefinSans-italic-var.ttf", "Josefin Sans", { style: "italic", weight: VAR });
export const JOSEFIN_IT = "Josefin Sans";

export const DM_SANS = F("DMSans-var.ttf", "DM Sans", { weight: VAR });

export const INTER_TIGHT = F("InterTight-var.ttf", "Inter Tight", { weight: VAR });

export const SPACE_GROTESK = F("SpaceGrotesk-var.ttf", "Space Grotesk", { weight: VAR });

export const PLEX_MONO = F("IBMPlexMono-Regular.ttf", "IBM Plex Mono");
F("IBMPlexMono-Bold.ttf", "IBM Plex Mono", { weight: "700" });

export const SHIPPORI = F("ShipporiMincho-Regular.ttf", "Shippori Mincho");
F("ShipporiMincho-Bold.ttf", "Shippori Mincho", { weight: "700" });

export const ZEN_KAKU = F("ZenKakuGothicNew-Regular.ttf", "Zen Kaku Gothic New");
F("ZenKakuGothicNew-Bold.ttf", "Zen Kaku Gothic New", { weight: "700" });

export const FRANKLIN = F("LibreFranklin-var.ttf", "Libre Franklin", { weight: VAR });
F("LibreFranklin-italic-var.ttf", "Libre Franklin", { style: "italic", weight: VAR });
export const FRANKLIN_IT = "Libre Franklin";

export const SPECTRAL = F("Spectral-Regular.ttf", "Spectral");
F("Spectral-Bold.ttf", "Spectral", { weight: "700" });

export const CINZEL = F("Cinzel-var.ttf", "Cinzel", { weight: VAR });

export const JETBRAINS = F("JetBrainsMono-var.ttf", "JetBrains Mono", { weight: VAR });

export const PLAYFAIR_D = F("PlayfairDisplay-var.ttf", "Playfair Display", { weight: VAR });
F("PlayfairDisplay-italic-var.ttf", "Playfair Display", { style: "italic", weight: VAR });
export const PLAYFAIR_D_IT = "Playfair Display";

export const SPECIAL_ELITE = F("SpecialElite-Regular.ttf", "Special Elite");

// ─── editorial-layer.tsx (temas tipográficos) ───
// Playfair se comparte (mismo family "Playfair Display" registrado arriba).
export const PLAYFAIR = "Playfair Display";
export const PLAYFAIR_IT = "Playfair Display";

export const DMSERIF = F("DMSerifDisplay-Regular.ttf", "DM Serif Display");
F("DMSerifDisplay-Italic.ttf", "DM Serif Display", { style: "italic" });
export const DMSERIF_IT = "DM Serif Display";

export const LORA = F("Lora-var.ttf", "Lora", { weight: VAR });
F("Lora-italic-var.ttf", "Lora", { style: "italic", weight: VAR });
export const LORA_IT = "Lora";

export const ABRIL = F("AbrilFatface-Regular.ttf", "Abril Fatface");
