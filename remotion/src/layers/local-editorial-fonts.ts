import { staticFile, delayRender, continueRender } from "remotion";

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
 * Registra una fuente local con red de seguridad DURA. A diferencia de
 * `@remotion/fonts.loadFont` (que en caso de fallo llama `cancelRender` y ABORTA
 * el render), aquí el path de error hace `continueRender`: si faltara/se corrompiera
 * el .ttf, el navegador cae a la fuente de sistema y el render IGUAL sale. Nunca
 * más un render abortado por una fuente (el bug que dejó "videos sin salir").
 *
 * El render corre en navegador (Chrome headless) → FontFace/document existen. Si
 * por alguna razón el módulo se evalúa en Node (sin FontFace), es no-op.
 */
// Tope por fuente: si una carga no resuelve en este tiempo, seguimos con fuente de
// sistema en vez de COLGAR el render. Crítico bajo render concurrente de largos:
// el browser limita ~6 conexiones por host y 24 fuentes + assets pueden saturarlas,
// dejando una carga esperando indefinidamente. Sin este tope, ese delayRender no se
// limpia y Remotion aborta el clip ("delayRender not cleared after 118000ms").
const FONT_LOAD_TIMEOUT_MS = 12000;

const F = (
  file: string,
  family: string,
  opts: { style?: "normal" | "italic"; weight?: string } = {}
): string => {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return family;
  const handle = delayRender(`local-font ${family} (${file})`, {
    timeoutInMilliseconds: 60000,
  });
  let cleared = false;
  const clear = () => {
    if (cleared) return;
    cleared = true;
    try {
      continueRender(handle);
    } catch {
      /* handle ya resuelto */
    }
  };
  // Garantía DURA: pase lo que pase con la carga, el delayRender se limpia ≤12s.
  const timer = setTimeout(clear, FONT_LOAD_TIMEOUT_MS);
  try {
    const face = new FontFace(family, `url('${staticFile(`fonts/${file}`)}') format('truetype')`, {
      style: opts.style ?? "normal",
      weight: opts.weight ?? "400",
    });
    face
      .load()
      .then((loaded) => {
        // FontFaceSet es un Set<FontFace> por spec; el cast evita el lib DOM incompleto.
        (document.fonts as unknown as Set<FontFace>).add(loaded);
      })
      .catch(() => {
        // .ttf faltante/corrupto → se ignora; cae a la fuente de sistema.
      })
      .finally(() => {
        clearTimeout(timer);
        clear();
      });
  } catch {
    clearTimeout(timer);
    clear();
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
