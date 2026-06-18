import { AbsoluteFill } from "remotion";
import { drawProps } from "./line-art-icons";

/**
 * EDITORIAL — 12 SUB-TEMAS de clase mundial (Ola 3 del plan EDITORIAL-SUPREMO).
 * Cada tema = lienzo (bg/texto/muted) + tipografías OFL + motivo procedural
 * ("gesto de motion" reconocible en 2 segundos) + look (duotono/textura).
 *
 * Investigación: docs/PLAN-EDITORIAL-SUPREMO.md (paletas hex y fuentes exactas
 * de prensa 1900, Vogue, Kinfolk, riso, grabado victoriano, constructivismo,
 * Bauhaus, Swiss grid, brutalismo, mincho japonés, Stripe press y Economist).
 * Compat: sin layout.theme todo resuelve a los lienzos clásicos (dark/ink/cream).
 */

// ─── Tipografías por tema (Google Fonts OFL — se cargan una vez por render) ───
import { loadFont as loadOldStandard } from "@remotion/google-fonts/OldStandardTT";
import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as loadKarla } from "@remotion/google-fonts/Karla";
import { loadFont as loadArchivoBlack } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadSpaceMono } from "@remotion/google-fonts/SpaceMono";
import { loadFont as loadIMFell } from "@remotion/google-fonts/IMFellEnglish";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadJosefin } from "@remotion/google-fonts/JosefinSans";
import { loadFont as loadDMSans } from "@remotion/google-fonts/DMSans";
import { loadFont as loadInterTight } from "@remotion/google-fonts/InterTight";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadPlexMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadShippori } from "@remotion/google-fonts/ShipporiMincho";
import { loadFont as loadZenKaku } from "@remotion/google-fonts/ZenKakuGothicNew";
import { loadFont as loadLibreFranklin } from "@remotion/google-fonts/LibreFranklin";
import { loadFont as loadSpectral } from "@remotion/google-fonts/Spectral";
import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadPlayfairDisplay } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadSpecialElite } from "@remotion/google-fonts/SpecialElite";

const { fontFamily: OLDSTD } = loadOldStandard("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: OLDSTD_IT } = loadOldStandard("italic", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: CORMORANT } = loadCormorant("normal", { weights: ["400", "600"], subsets: ["latin"] });
const { fontFamily: CORMORANT_IT } = loadCormorant("italic", { weights: ["400", "600"], subsets: ["latin"] });
const { fontFamily: KARLA } = loadKarla("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: ARCHIVO_BLACK } = loadArchivoBlack("normal", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: SPACE_MONO } = loadSpaceMono("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: IMFELL } = loadIMFell("normal", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: IMFELL_IT } = loadIMFell("italic", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: OSWALD } = loadOswald("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: JOSEFIN } = loadJosefin("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: JOSEFIN_IT } = loadJosefin("italic", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: DM_SANS } = loadDMSans("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: INTER_TIGHT } = loadInterTight("normal", { weights: ["400", "700", "900"], subsets: ["latin"] });
const { fontFamily: SPACE_GROTESK } = loadSpaceGrotesk("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: PLEX_MONO } = loadPlexMono("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: SHIPPORI } = loadShippori("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: ZEN_KAKU } = loadZenKaku("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: FRANKLIN } = loadLibreFranklin("normal", { weights: ["400", "700", "900"], subsets: ["latin"] });
const { fontFamily: FRANKLIN_IT } = loadLibreFranklin("italic", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: SPECTRAL } = loadSpectral("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: SPECTRAL_IT } = loadSpectral("italic", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: CINZEL } = loadCinzel("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: JETBRAINS } = loadJetBrainsMono("normal", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: PLAYFAIR_D } = loadPlayfairDisplay("normal", { weights: ["400", "700", "900"], subsets: ["latin"] });
const { fontFamily: PLAYFAIR_D_IT } = loadPlayfairDisplay("italic", { weights: ["400", "700"], subsets: ["latin"] });
const { fontFamily: SPECIAL_ELITE } = loadSpecialElite("normal", { weights: ["400"], subsets: ["latin"] });

export type MotifId =
  | "none" | "prensa" | "vogue" | "kinfolk" | "riso" | "grabado"
  | "constructivista" | "bauhaus" | "swiss" | "brutal" | "mincho" | "stripe" | "docu"
  | "art_deco" | "blueprint" | "noir";

export interface EditorialThemeDef {
  id: string;
  /** Nombre vendible en el wizard. */
  name: string;
  canvas: { bg: string; text: string; muted: string };
  /** [titular normal, titular itálica] — familias ya cargadas. */
  fontTitle: [string, string];
  /** Texto de apoyo (subtítulos). */
  fontBody: string;
  /** Kickers / metadatos (mono o sans según el tema). */
  fontKicker: string;
  /** Acento sugerido (el wizard puede sobreescribirlo). */
  accent: string;
  /** Gesto decorativo procedural del tema. */
  motif: MotifId;
  /** Duotono del panel de video 0..1. */
  duotone: number;
  texture: "none" | "paper";
  /** Transform del titular (constructivista = caps, bauhaus = minúsculas). */
  titleTransform?: "uppercase" | "lowercase";
  /** Ambient mínimo: sin círculos punteados ni marcas "+" (temas limpios). */
  minimalAmbient?: boolean;
  /** Bordes del panel de video RASGADOS (feDisplacementMap — temas de papel). */
  tornPanel?: boolean;
}

/** Claves de fuente variable (editorial-ink) usadas por algunos temas. */
const VAR = {
  bodoni: ["BodoniModaVar", "BodoniModaVarItalic"] as [string, string],
  newsreader: ["NewsreaderVar", "NewsreaderVarItalic"] as [string, string],
};

export const EDITORIAL_THEME_DEFS: Record<string, EditorialThemeDef> = {
  prensa: {
    id: "prensa", name: "Prensa 1900",
    canvas: { bg: "#e8e1cf", text: "#1c1812", muted: "#6e6450" },
    fontTitle: [OLDSTD, OLDSTD_IT], fontBody: OLDSTD, fontKicker: OLDSTD,
    accent: "#8e2a1e", motif: "prensa", duotone: 0.8, texture: "paper",
    tornPanel: true,
  },
  vogue: {
    id: "vogue", name: "Vogue noir",
    canvas: { bg: "#0c0b0a", text: "#f4f0e6", muted: "#8c8475" },
    fontTitle: VAR.bodoni, fontBody: CORMORANT, fontKicker: KARLA,
    accent: "#c9a96a", motif: "vogue", duotone: 0, texture: "none",
    minimalAmbient: true,
  },
  kinfolk: {
    id: "kinfolk", name: "Kinfolk calma",
    canvas: { bg: "#f6f3ec", text: "#33302a", muted: "#9b948a" },
    fontTitle: [CORMORANT, CORMORANT_IT], fontBody: KARLA, fontKicker: KARLA,
    accent: "#b06b4c", motif: "kinfolk", duotone: 0, texture: "paper",
    minimalAmbient: true,
  },
  riso: {
    id: "riso", name: "Zine riso",
    canvas: { bg: "#f1ece0", text: "#141414", muted: "#5a554c" },
    fontTitle: [ARCHIVO_BLACK, ARCHIVO_BLACK], fontBody: SPACE_MONO, fontKicker: SPACE_MONO,
    accent: "#FF48B0", motif: "riso", duotone: 0, texture: "paper",
    tornPanel: true,
  },
  grabado: {
    id: "grabado", name: "Grabado victoriano",
    canvas: { bg: "#ece3cd", text: "#2a2118", muted: "#7a6a52" },
    fontTitle: [IMFELL, IMFELL_IT], fontBody: OLDSTD, fontKicker: OLDSTD,
    accent: "#8a6d3b", motif: "grabado", duotone: 0.85, texture: "paper",
    tornPanel: true,
  },
  constructivista: {
    id: "constructivista", name: "Constructivista",
    canvas: { bg: "#ece2cf", text: "#181613", muted: "#6e6657" },
    fontTitle: [OSWALD, OSWALD], fontBody: DM_SANS, fontKicker: DM_SANS,
    accent: "#cf2618", motif: "constructivista", duotone: 0.9, texture: "paper",
    titleTransform: "uppercase",
  },
  bauhaus: {
    id: "bauhaus", name: "Bauhaus",
    canvas: { bg: "#f2e9d8", text: "#1f1d1a", muted: "#8a8276" },
    fontTitle: [JOSEFIN, JOSEFIN_IT], fontBody: DM_SANS, fontKicker: DM_SANS,
    accent: "#be1e2d", motif: "bauhaus", duotone: 0, texture: "none",
    titleTransform: "lowercase",
  },
  swiss: {
    id: "swiss", name: "Suizo grid",
    canvas: { bg: "#f4f4f1", text: "#0d0d0d", muted: "#8e8e8a" },
    fontTitle: [INTER_TIGHT, INTER_TIGHT], fontBody: INTER_TIGHT, fontKicker: INTER_TIGHT,
    accent: "#e30613", motif: "swiss", duotone: 0, texture: "none",
    minimalAmbient: true,
  },
  brutal: {
    id: "brutal", name: "Brutalista",
    canvas: { bg: "#efefea", text: "#000000", muted: "#4a4a46" },
    fontTitle: [SPACE_GROTESK, SPACE_GROTESK], fontBody: PLEX_MONO, fontKicker: PLEX_MONO,
    accent: "#ff4d00", motif: "brutal", duotone: 0, texture: "none",
  },
  mincho: {
    id: "mincho", name: "Japón mincho",
    canvas: { bg: "#f5f3ed", text: "#26241f", muted: "#a09a8c" },
    fontTitle: [SHIPPORI, SHIPPORI], fontBody: ZEN_KAKU, fontKicker: ZEN_KAKU,
    accent: "#b3342c", motif: "mincho", duotone: 0, texture: "paper",
    minimalAmbient: true,
  },
  stripe: {
    id: "stripe", name: "Stripe press",
    canvas: { bg: "#0a2540", text: "#f6f9fc", muted: "#7a93ad" },
    fontTitle: VAR.newsreader, fontBody: FRANKLIN, fontKicker: PLEX_MONO,
    accent: "#635bff", motif: "stripe", duotone: 0, texture: "none",
  },
  docu: {
    id: "docu", name: "Docu rojo",
    canvas: { bg: "#f9f7f1", text: "#121212", muted: "#777269" },
    fontTitle: [FRANKLIN, FRANKLIN_IT], fontBody: SPECTRAL, fontKicker: PLEX_MONO,
    accent: "#e3120b", motif: "docu", duotone: 0, texture: "none",
  },
  ft: {
    id: "ft", name: "FT salmón",
    canvas: { bg: "#fff1e5", text: "#33302e", muted: "#8c8273" },
    fontTitle: [FRANKLIN, FRANKLIN_IT], fontBody: SPECTRAL, fontKicker: PLEX_MONO,
    accent: "#0d7680", motif: "docu", duotone: 0, texture: "none",
  },
  art_deco: {
    id: "art_deco", name: "Art Déco",
    canvas: { bg: "#f3ead6", text: "#16130d", muted: "#8a7c5c" },
    fontTitle: [CINZEL, CINZEL], fontBody: CORMORANT, fontKicker: KARLA,
    accent: "#bd9a4e", motif: "art_deco", duotone: 0, texture: "paper",
    titleTransform: "uppercase", minimalAmbient: true,
  },
  blueprint: {
    id: "blueprint", name: "Blueprint",
    canvas: { bg: "#0b2138", text: "#dbe9f4", muted: "#5f7f9c" },
    fontTitle: [JETBRAINS, JETBRAINS], fontBody: PLEX_MONO, fontKicker: JETBRAINS,
    accent: "#34c6d8", motif: "blueprint", duotone: 0, texture: "none",
    minimalAmbient: true,
  },
  noir: {
    id: "noir", name: "Noir",
    canvas: { bg: "#0a0a0a", text: "#f2f2f0", muted: "#7d7d79" },
    fontTitle: [PLAYFAIR_D, PLAYFAIR_D_IT], fontBody: CORMORANT, fontKicker: SPECIAL_ELITE,
    accent: "#d8d2c4", motif: "noir", duotone: 1, texture: "none",
    minimalAmbient: true,
  },
};

/** Look resuelto que consumen el render del card layer, ambient y ViralVideo. */
export interface ResolvedEditorialLook {
  canvas: { bg: string; text: string; muted: string };
  fontTitle: [string, string] | null; // null = usar FONT_THEMES clásico del layout.font
  fontBody: string | null;
  fontKicker: string | null;
  motif: MotifId;
  duotone: number;
  texture: "none" | "paper";
  titleTransform?: "uppercase" | "lowercase";
  minimalAmbient: boolean;
  themeAccent: string | null;
  tornPanel: boolean;
}

const LEGACY_CANVAS: Record<string, { bg: string; text: string; muted: string }> = {
  dark: { bg: "#0a0908", text: "#f3ede1", muted: "#9b958a" },
  ink: { bg: "#0a0f16", text: "#e9eef5", muted: "#8b95a3" },
  cream: { bg: "#f5efe3", text: "#1c1611", muted: "#7a7163" },
};

/** Resuelve tema nuevo (layout.theme) o clásico (layout.background). */
export function resolveEditorialLook(layout: {
  theme?: string;
  background?: string;
  duotone?: number;
  texture?: string;
}): ResolvedEditorialLook {
  const def = layout.theme ? EDITORIAL_THEME_DEFS[layout.theme] : undefined;
  if (def) {
    return {
      canvas: def.canvas,
      fontTitle: def.fontTitle,
      fontBody: def.fontBody,
      fontKicker: def.fontKicker,
      motif: def.motif,
      // El layout puede sobreescribir el look del tema (override explícito).
      duotone: (layout.duotone ?? 0) > 0 ? (layout.duotone as number) : def.duotone,
      texture: (layout.texture === "paper" || layout.texture === "none" ? layout.texture : def.texture) as "none" | "paper",
      titleTransform: def.titleTransform,
      minimalAmbient: Boolean(def.minimalAmbient),
      themeAccent: def.accent,
      tornPanel: Boolean(def.tornPanel),
    };
  }
  return {
    canvas: LEGACY_CANVAS[layout.background ?? "dark"] ?? LEGACY_CANVAS.dark,
    fontTitle: null,
    fontBody: null,
    fontKicker: null,
    motif: "none",
    duotone: layout.duotone ?? 0,
    texture: (layout.texture === "paper" ? "paper" : "none") as "none" | "paper",
    minimalAmbient: false,
    themeAccent: null,
    tornPanel: false,
  };
}

/** Luminancia 0..1 aproximada de un hex (#rgb/#rrggbb). */
export function luma(hex: string): number {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v.slice(0, 6), 16);
  if (!Number.isFinite(n)) return 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export const isDarkCanvas = (canvas: { bg: string }): boolean => luma(canvas.bg) < 0.5;

/** Pareja tinta/papel del duotono: la sombra es el tono más oscuro del lienzo
 *  y la luz el más claro (el video queda "impreso" con la tinta del tema). */
export function duotonePairFor(canvas: { bg: string; text: string }): { shadow: string; highlight: string } {
  return luma(canvas.bg) < luma(canvas.text)
    ? { shadow: canvas.bg, highlight: canvas.text }
    : { shadow: canvas.text, highlight: canvas.bg };
}

// ─── MOTIVOS PROCEDURALES: el "gesto" reconocible de cada tema ────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Decoración de lienzo por tema. Se monta DENTRO de EditorialAmbient. */
export const MotifLayer: React.FC<{
  motif: MotifId;
  t: number;
  width: number;
  height: number;
  accent: string;
  canvas: { bg: string; text: string; muted: string };
}> = ({ motif, t, width: W, height: H, accent, canvas }) => {
  const intro = clamp01(t / 1.0);
  const ink = canvas.text;
  const muted = canvas.muted;

  if (motif === "prensa") {
    // Filetes dobles de periódico + folio "EST. 1901 · VOL." (sello de época).
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <div style={{ position: "absolute", top: H * 0.028, left: W * 0.05, right: W * 0.05 }}>
          <div style={{ borderTop: `3px solid ${ink}`, marginBottom: 3 }} />
          <div style={{ borderTop: `1px solid ${ink}` }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontFamily: "Georgia, serif", fontSize: H * 0.011, letterSpacing: "0.28em", color: muted, textTransform: "uppercase" }}>
            <span>EST. 1901</span>
            <span style={{ color: accent }}>⁂</span>
            <span>VOL. XXIII · No. 4</span>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: H * 0.028, left: W * 0.05, right: W * 0.05 }}>
          <div style={{ borderTop: `1px solid ${ink}`, marginBottom: 3 }} />
          <div style={{ borderTop: `3px solid ${ink}` }} />
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "vogue") {
    // Marco hairline interior + nada más: el lujo es el vacío.
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <div style={{ position: "absolute", inset: `${H * 0.025}px ${W * 0.035}px`, border: `0.5px solid ${muted}66` }} />
      </AbsoluteFill>
    );
  }

  if (motif === "kinfolk") {
    // Una sola línea fina + número de página: aire y calma.
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <div style={{ position: "absolute", top: H * 0.05, left: W * 0.08, width: W * 0.1, borderTop: `1px solid ${muted}` }} />
        <div style={{ position: "absolute", bottom: H * 0.04, right: W * 0.07, fontFamily: "Arial, sans-serif", fontSize: H * 0.012, letterSpacing: "0.3em", color: muted }}>
          {String(Math.floor(t / 8) + 14).padStart(2, "0")}
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "riso") {
    // Halftone de esquina + cinta adhesiva: fotocopia punk. Las "tintas" riso
    // respiran ±1px (misregistración viva — nadie más tiene esto).
    const jx = Math.round(Math.sin(t * 2.1) * 1.5);
    const jy = Math.round(Math.cos(t * 1.7) * 1.5);
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <div
          style={{
            position: "absolute", right: -W * 0.06, top: -H * 0.03, width: W * 0.34, height: W * 0.34,
            backgroundImage: `radial-gradient(${accent} 1.6px, transparent 1.7px)`,
            backgroundSize: "11px 11px",
            transform: `translate(${jx}px, ${jy}px) rotate(8deg)`,
            opacity: 0.5, mixBlendMode: "multiply",
          }}
        />
        <div
          style={{
            position: "absolute", right: -W * 0.06, top: -H * 0.03, width: W * 0.34, height: W * 0.34,
            backgroundImage: "radial-gradient(#0078BF 1.6px, transparent 1.7px)",
            backgroundSize: "11px 11px",
            transform: `translate(${-jx}px, ${-jy}px) rotate(8deg)`,
            opacity: 0.4, mixBlendMode: "multiply",
          }}
        />
        {/* cinta adhesiva */}
        <div
          style={{
            position: "absolute", left: W * 0.06, bottom: H * 0.09, width: W * 0.16, height: H * 0.018,
            background: "#FFE800", opacity: 0.85, transform: "rotate(-2deg)",
            boxShadow: "1px 2px 0 rgba(0,0,0,0.18)",
          }}
        />
      </AbsoluteFill>
    );
  }

  if (motif === "grabado") {
    // Cartuchos de esquina ornamentales (un path reflejado 4×) + "Fig.".
    const L = Math.min(W, H) * 0.07 * intro;
    const m = Math.min(W, H) * 0.035;
    const corner = (x: number, y: number, sx: number, sy: number) => (
      <g transform={`translate(${x} ${y}) scale(${sx} ${sy})`}>
        <path d={`M0 ${L} L0 ${L * 0.25} Q0 0 ${L * 0.25} 0 L${L} 0`} fill="none" stroke={ink} strokeWidth={2} />
        <path d={`M${L * 0.12} ${L * 0.62} Q${L * 0.3} ${L * 0.3} ${L * 0.62} ${L * 0.12}`} fill="none" stroke={accent} strokeWidth={1.3} />
        <circle cx={L * 0.16} cy={L * 0.16} r={2.2} fill={accent} />
      </g>
    );
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          {corner(m, m, 1, 1)}
          {corner(W - m, m, -1, 1)}
          {corner(m, H - m, 1, -1)}
          {corner(W - m, H - m, -1, -1)}
        </svg>
        <div style={{ position: "absolute", bottom: H * 0.045, left: 0, right: 0, textAlign: "center", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: H * 0.013, letterSpacing: "0.18em", color: muted }}>
          Fig. {Math.floor(t / 10) + 1}.
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "constructivista") {
    // La CUÑA roja de Lissitzky entra como wipe diagonal y se queda de testigo.
    const p = clamp01(t / 0.9);
    const e = 1 - Math.pow(1 - p, 3);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute", inset: 0, background: accent, opacity: 0.92,
            clipPath: `polygon(0 ${100 - 12 * e}%, ${22 * e}% 100%, 0 100%)`,
          }}
        />
        <div
          style={{
            position: "absolute", inset: 0, background: ink,
            clipPath: `polygon(${100 - 8 * e}% 0, 100% 0, 100% ${14 * e}%)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (motif === "bauhaus") {
    // Círculo + triángulo + cuadrado: el sistema de formas marcha abajo.
    const s = H * 0.018;
    const y = H * 0.94;
    const x0 = W * 0.07;
    const rot = t * 18;
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          <circle cx={x0} cy={y} r={s * 0.62} fill={accent} />
          <g transform={`rotate(${rot} ${x0 + s * 2} ${y})`}>
            <polygon
              points={`${x0 + s * 2},${y - s * 0.66} ${x0 + s * 2.62},${y + s * 0.5} ${x0 + s * 1.38},${y + s * 0.5}`}
              fill="#21409a"
            />
          </g>
          <rect x={x0 + s * 3.4} y={y - s * 0.55} width={s * 1.1} height={s * 1.1} fill="#f0c020" />
        </svg>
      </AbsoluteFill>
    );
  }

  if (motif === "swiss") {
    // La retícula VISIBLE: columnas 1px que aparecen primero (identidad pura).
    const cols = 4;
    const gp = clamp01(t / 0.5);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {Array.from({ length: cols + 1 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i / cols) * 88 + 6}%`,
              top: `${6 + (1 - gp) * 8}%`,
              bottom: "6%",
              width: 1,
              background: ink,
              opacity: 0.07 * gp,
            }}
          />
        ))}
        <div style={{ position: "absolute", top: H * 0.06, left: W * 0.06, width: W * 0.07, height: H * 0.012, background: accent }} />
      </AbsoluteFill>
    );
  }

  if (motif === "brutal") {
    // Borde 3px en TODO + contador mono + franja marquee inferior.
    const marq = (t * W * 0.06) % (W * 0.5);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: `${H * 0.018}px ${W * 0.028}px`, border: `3px solid ${ink}` }} />
        <div style={{ position: "absolute", top: H * 0.028, right: W * 0.045, fontFamily: "Consolas, monospace", fontSize: H * 0.014, color: ink, background: canvas.bg, padding: "1px 8px", border: `2px solid ${ink}` }}>
          [{String(Math.floor(t / 60)).padStart(2, "0")}:{String(Math.floor(t % 60)).padStart(2, "0")}]
        </div>
        <div style={{ position: "absolute", left: W * 0.028, right: W * 0.028, bottom: H * 0.018, height: H * 0.024, borderTop: `3px solid ${ink}`, overflow: "hidden", background: canvas.bg }}>
          <div style={{ position: "absolute", whiteSpace: "nowrap", transform: `translateX(${-marq}px)`, fontFamily: "Consolas, monospace", fontSize: H * 0.013, lineHeight: `${H * 0.022}px`, color: accent, letterSpacing: "0.2em" }}>
            {"/// DOCUMENTAL /// SIN FILTRO /// DOCUMENTAL /// SIN FILTRO /// DOCUMENTAL /// SIN FILTRO ///"}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "mincho") {
    // Eje vertical fino + sello hanko bermellón (ma 間: el vacío es el diseño).
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <div style={{ position: "absolute", top: H * 0.08, bottom: H * 0.08, left: W * 0.085, width: 1, background: `${muted}88` }} />
        <div
          style={{
            position: "absolute", bottom: H * 0.06, left: W * 0.062, width: W * 0.048, height: W * 0.048,
            background: accent, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
            color: canvas.bg, fontFamily: "Georgia, serif", fontWeight: 700, fontSize: W * 0.022,
            boxShadow: "0 1px 0 rgba(0,0,0,0.15)",
          }}
        >
          印
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "stripe") {
    // Grid de puntos + columna de notas al margen con filete corto.
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(${muted} 1px, transparent 1px)`,
            backgroundSize: `${Math.round(W * 0.05)}px ${Math.round(W * 0.05)}px`,
            opacity: 0.1,
          }}
        />
        <div style={{ position: "absolute", top: H * 0.07, right: W * 0.055, width: W * 0.06, borderTop: `2px solid ${accent}` }} />
        <div style={{ position: "absolute", top: H * 0.078, right: W * 0.055, fontFamily: "Consolas, monospace", fontSize: H * 0.011, color: muted, letterSpacing: "0.12em" }}>
          ¹ nota
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "docu") {
    // La barra roja Economist arriba-izquierda: la firma en 0.4s.
    const p = clamp01(t / 0.4);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 0, left: W * 0.06, width: W * 0.085, height: H * 0.012 * p, background: accent }} />
      </AbsoluteFill>
    );
  }

  if (motif === "art_deco") {
    // Marco de esquina déco: abanico de rayos + galón escalonado que se DIBUJAN
    // (strokeDashoffset vía drawProps), asentándose en ~1.2s, con shimmer dorado.
    // Cartel de lujo 1920. Cada path es un trazo geométrico reflejado 4×.
    const m = Math.min(W, H) * 0.04;
    const R = Math.min(W, H) * 0.13; // radio del abanico de rayos
    // Brillo sutil que recorre el dorado tras dibujarse.
    const shimmer = 0.78 + 0.22 * Math.sin(t * 1.6);
    const settle = clamp01((t - 1.2) / 0.6);
    // Galón escalonado (chevrons) — un path único de longitud ~ chevLen.
    const chev = `M0 ${R * 1.18} L${R * 0.32} ${R * 0.86} L0 ${R * 0.54} M0 ${R * 0.9} L${R * 0.24} ${R * 0.64} L0 ${R * 0.38}`;
    const corner = (cx: number, cy: number, sx: number, sy: number, idx: number) => (
      <g key={idx} transform={`translate(${cx} ${cy}) scale(${sx} ${sy})`}>
        {/* abanico de rayos déco (sunburst) — se dibujan escalonados */}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 5) * (Math.PI / 2);
          const x2 = Math.cos(a) * R;
          const y2 = Math.sin(a) * R;
          const len = R;
          return (
            <line
              key={i}
              x1={0} y1={0} x2={x2} y2={y2}
              stroke={accent} strokeWidth={i % 2 === 0 ? 2.4 : 1.2} strokeLinecap="round"
              {...drawProps(len, t, 0.1 + i * 0.07, 0.5)}
            />
          );
        })}
        {/* arco que cierra el abanico */}
        <path
          d={`M${R} 0 A ${R} ${R} 0 0 1 0 ${R}`}
          fill="none" stroke={accent} strokeWidth={1.4}
          {...drawProps(R * 1.6, t, 0.5, 0.6)}
        />
        {/* galón escalonado a la altura del marco */}
        <path
          d={chev}
          fill="none" stroke={ink} strokeWidth={2.2}
          {...drawProps(R * 2.2, t, 0.35, 0.7)}
        />
      </g>
    );
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: clamp01(t / 0.3) }}>
        <svg width={W} height={H} style={{ position: "absolute", inset: 0, filter: `drop-shadow(0 0 ${4 + settle * 5}px ${accent}${settle > 0 ? "55" : "00"})`, opacity: shimmer }}>
          {corner(m, m, 1, 1, 0)}
          {corner(W - m, m, -1, 1, 1)}
          {corner(m, H - m, 1, -1, 2)}
          {corner(W - m, H - m, -1, -1, 3)}
        </svg>
      </AbsoluteFill>
    );
  }

  if (motif === "blueprint") {
    // Esquema de ingeniería: retícula cian tenue + líneas de cota animadas y un
    // crosshair que "mide" el panel. Las líneas se extienden por longitud
    // interpolada (clamp01 del tiempo); ticks de cota en los extremos.
    const grid = Math.round(Math.min(W, H) * 0.045);
    const ext = clamp01((t - 0.2) / 0.8); // las cotas se extienden 0.2→1.0s
    const cx = W / 2, cy = H / 2;
    const halfX = W * 0.34 * ext;
    const halfY = H * 0.30 * ext;
    const tick = Math.min(W, H) * 0.012;
    const blink = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2)); // crosshair "vivo"
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: clamp01(t / 0.4) }}>
        {/* retícula de medición tenue */}
        <AbsoluteFill
          style={{
            backgroundImage:
              `linear-gradient(${accent}22 1px, transparent 1px), linear-gradient(90deg, ${accent}22 1px, transparent 1px)`,
            backgroundSize: `${grid}px ${grid}px`,
            opacity: 0.5,
          }}
        />
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          {/* cota horizontal con ticks en los extremos */}
          <line x1={cx - halfX} y1={cy} x2={cx + halfX} y2={cy} stroke={accent} strokeWidth={1.2} />
          <line x1={cx - halfX} y1={cy - tick} x2={cx - halfX} y2={cy + tick} stroke={accent} strokeWidth={1.2} opacity={ext} />
          <line x1={cx + halfX} y1={cy - tick} x2={cx + halfX} y2={cy + tick} stroke={accent} strokeWidth={1.2} opacity={ext} />
          {/* cota vertical con ticks */}
          <line x1={cx} y1={cy - halfY} x2={cx} y2={cy + halfY} stroke={accent} strokeWidth={1.2} />
          <line x1={cx - tick} y1={cy - halfY} x2={cx + tick} y2={cy - halfY} stroke={accent} strokeWidth={1.2} opacity={ext} />
          <line x1={cx - tick} y1={cy + halfY} x2={cx + tick} y2={cy + halfY} stroke={accent} strokeWidth={1.2} opacity={ext} />
          {/* crosshair central que "mide" */}
          <circle cx={cx} cy={cy} r={Math.min(W, H) * 0.018} fill="none" stroke={accent} strokeWidth={1.4} opacity={blink} />
          <line x1={cx - tick * 1.6} y1={cy} x2={cx + tick * 1.6} y2={cy} stroke={accent} strokeWidth={1} opacity={blink} />
          <line x1={cx} y1={cy - tick * 1.6} x2={cx} y2={cy + tick * 1.6} stroke={accent} strokeWidth={1} opacity={blink} />
        </svg>
        {/* etiqueta de cota tipo plano */}
        <div style={{ position: "absolute", top: H * 0.04, left: W * 0.06, fontFamily: "Consolas, monospace", fontSize: H * 0.011, letterSpacing: "0.18em", color: muted }}>
          {`SCALE 1:1 · REV ${String(Math.floor(t / 6) % 9 + 1).padStart(2, "0")}`}
        </div>
      </AbsoluteFill>
    );
  }

  if (motif === "noir") {
    // Barra de luz que barre el tercio inferior (sin/cos) + contador de fotograma
    // tipo title-card de cine detectivesco. La barra se desplaza con un ciclo lento.
    const sweep = (Math.sin(t * 0.5 - Math.PI / 2) + 1) / 2; // 0→1→0 lento
    const barW = W * 0.22;
    const barX = -barW + sweep * (W + barW);
    const lower = H * 0.78;
    const frame = Math.floor(t * 24) % 10000; // contador de fotograma a 24 fps
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: clamp01(t / 0.5) }}>
        {/* tercio inferior: línea hairline de acento */}
        <div style={{ position: "absolute", top: lower, left: W * 0.06, right: W * 0.06, borderTop: `1px solid ${muted}55` }} />
        {/* barra de luz que barre sobre el tercio inferior */}
        <div
          style={{
            position: "absolute", top: lower - H * 0.02, left: barX, width: barW, height: H * 0.04,
            background: `linear-gradient(90deg, transparent, ${accent}aa, transparent)`,
            mixBlendMode: "screen", filter: "blur(2px)",
          }}
        />
        {/* contador de fotograma title-card */}
        <div style={{ position: "absolute", bottom: H * 0.05, right: W * 0.07, fontFamily: "Consolas, monospace", fontSize: H * 0.012, letterSpacing: "0.2em", color: muted }}>
          {`FRAME ${String(frame).padStart(4, "0")}`}
        </div>
      </AbsoluteFill>
    );
  }

  return null;
};
