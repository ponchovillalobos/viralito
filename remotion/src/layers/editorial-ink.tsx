import { useMemo } from "react";
import { evolvePath } from "@remotion/paths";
import rough from "roughjs";
import { registerLocalFont } from "./local-editorial-fonts";

/**
 * EDITORIAL — Tinta (Ola 2): fuentes VARIABLES locales que "respiran" por frame,
 * subrayados/círculos a mano alzada (rough.js, seed determinista) sincronizados
 * a la palabra acento, y contador gigante para stats.
 *
 * Fuentes: TTF variables del repo de Google Fonts (OFL), descargadas a
 * remotion/public/fonts por python/download_fonts.py — cero red en render.
 */

// ⚠️ CARGA LAZY, NO `@remotion/fonts.loadFont` — auditoría 2026-07-20.
// Estas 8 fuentes se registraban EAGER con `loadFont`, que usa `delayRender` por
// debajo y hace `cancelRender` si la carga falla. Es exactamente el patrón que
// documenta `local-editorial-fonts.ts` como causa raíz de "los videos no salían":
// bajo el render CONCURRENTE de largos, 8 descargas simultáneas saturan las ~6
// conexiones por host (que OffthreadVideo ya ocupa), la delayRender nunca se limpia
// y Remotion ABORTA el clip. Sin internet, directamente cancelaba el render.
// Ahora usan el mismo helper lazy: se descargan sólo cuando un glyph las necesita,
// y si faltan caen a la fuente del sistema sin abortar NUNCA.
const VAR = "100 900"; // rango [wght] de estas fuentes variables
const F = (file: string, family: string, style: "normal" | "italic" = "normal") =>
  registerLocalFont(file, family, { style, weight: VAR });

F("fraunces-var.ttf", "FrauncesVar");
F("fraunces-italic-var.ttf", "FrauncesVarItalic", "italic");
F("bodonimoda-var.ttf", "BodoniModaVar");
F("bodonimoda-italic-var.ttf", "BodoniModaVarItalic", "italic");
F("robotoserif-var.ttf", "RobotoSerifVar");
F("bricolage-var.ttf", "BricolageVar");
F("newsreader-var.ttf", "NewsreaderVar");
F("newsreader-italic-var.ttf", "NewsreaderVarItalic", "italic");

/** [familia normal, familia itálica] de cada fuente variable nueva. */
export const VARIABLE_FONT_THEMES: Record<string, [string, string]> = {
  fraunces: ["FrauncesVar", "FrauncesVarItalic"],
  bodoni: ["BodoniModaVar", "BodoniModaVarItalic"],
  robotoserif: ["RobotoSerifVar", "RobotoSerifVar"],
  bricolage: ["BricolageVar", "BricolageVar"],
  newsreader: ["NewsreaderVar", "NewsreaderVarItalic"],
};

/**
 * fontVariationSettings del TITULAR para que "respire" (interpolación numérica
 * pura por frame — determinista). Ejes custom en MAYÚSCULA (case-sensitive).
 * Devuelve undefined para fuentes no variables (Playfair/DM/Lora/Abril).
 */
export function titleVariation(font: string | undefined, t: number): string | undefined {
  const breathe = Math.sin(t * 0.9);
  switch (font) {
    case "fraunces":
      // SOFT derrite las terminales suavemente; WONK = el sabor único de Fraunces.
      return `"opsz" 144, "wght" ${Math.round(840 + breathe * 35)}, "SOFT" ${Math.round(35 + 30 * Math.sin(t * 0.5))}, "WONK" 1`;
    case "bodoni":
      // opsz alto = hairlines de revista de moda.
      return `"opsz" 96, "wght" ${Math.round(790 + breathe * 45)}`;
    case "robotoserif":
      // GRAD engorda los trazos SIN reflow — pulso de énfasis perfecto.
      return `"opsz" 36, "wght" 700, "GRAD" ${Math.round(40 + 55 * Math.sin(t * 1.1))}`;
    case "bricolage":
      return `"opsz" 96, "wdth" 100, "wght" ${Math.round(740 + breathe * 50)}`;
    case "newsreader":
      return `"opsz" 72, "wght" ${Math.round(690 + breathe * 35)}`;
    default:
      return undefined;
  }
}

// ─── Mano alzada (rough.js, seed FIJO → mismos paths en todos los threads) ────

export type InkKind = "underline" | "circle" | "box";

const gen = rough.generator();

/** Paths normalizados (viewBox 200×30) de la anotación; memo por seed+kind. */
function inkPaths(kind: InkKind, seed: number): { d: string; strokeWidth: number }[] {
  const opts = { seed, roughness: 2.1, bowing: 1.6, strokeWidth: 3, stroke: "#000" };
  const drawable =
    kind === "circle"
      ? gen.ellipse(100, 15, 192, 27, { ...opts, roughness: 1.6 })
      : kind === "box"
        ? gen.rectangle(4, 2, 192, 26, opts)
        : gen.line(4, 16, 196, 17, opts);
  return gen.toPaths(drawable).map((p) => ({ d: p.d, strokeWidth: p.strokeWidth || 3 }));
}

/**
 * Anotación a mano alzada sobre la palabra acento. Se posiciona ABSOLUTA dentro
 * de un span position:relative y se estira al ancho real de la palabra
 * (preserveAspectRatio="none") — cero medición de DOM, 100% determinista.
 * `progress` 0..1 = porcentaje dibujado (sincronizar con la voz).
 */
export const InkAnnotation: React.FC<{
  kind: InkKind;
  progress: number;
  color: string;
  seed: number;
}> = ({ kind, progress, color, seed }) => {
  const paths = useMemo(() => inkPaths(kind, seed), [kind, seed]);
  if (progress <= 0) return null;
  const isUnder = kind === "underline";
  return (
    <svg
      viewBox="0 0 200 30"
      preserveAspectRatio="none"
      style={
        isUnder
          ? { position: "absolute", left: "-2%", bottom: "-0.16em", width: "104%", height: "0.24em", overflow: "visible", pointerEvents: "none" }
          : { position: "absolute", left: "-7%", top: "-0.12em", width: "114%", height: "1.24em", overflow: "visible", pointerEvents: "none" }
      }
    >
      {paths.map((p, i) => {
        // Cada trazo del rough se dibuja en secuencia (mitad y mitad).
        const n = paths.length;
        const local = Math.min(1, Math.max(0, progress * n - i));
        if (local <= 0) return null;
        const ev = evolvePath(local, p.d);
        return (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={color}
            // non-scaling-stroke: el grosor no se deforma con el stretch del
            // viewBox; ×2.2 para que se VEA a 1080p (3px era invisible).
            strokeWidth={p.strokeWidth * 2.2}
            strokeLinecap="round"
            strokeDasharray={ev.strokeDasharray}
            strokeDashoffset={ev.strokeDashoffset}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
};

/** Rotación de anotación por índice de tarjeta (variedad sin tocar el schema). */
export const inkKindFor = (index: number): InkKind =>
  (["underline", "circle", "underline", "box"] as InkKind[])[Math.abs(index) % 4];

// ─── Icono SVG externo embebido (Phosphor duotone / Tabler — Ola 4) ──────────

/**
 * Renderiza el markup SVG embebido en build-time (editorial-icons.mjs). Los
 * packs usan currentColor → `color` lo pinta del acento del tema; el duotone
 * de Phosphor (capa opacity 0.2) se ve dorado + dorado translúcido solo.
 */
export const InlineSvgIcon: React.FC<{
  svg: string;
  size: number;
  gold: string;
  elapsed: number;
}> = ({ svg, size, gold, elapsed }) => {
  const p = Math.min(1, Math.max(0, elapsed / 0.6));
  const ease = 1 - Math.pow(1 - p, 3);
  const float = Math.sin(elapsed * 1.3) * size * 0.014;
  return (
    <div
      style={{
        width: size,
        height: size,
        color: gold,
        opacity: ease,
        transform: `translateY(${float.toFixed(2)}px) scale(${(0.85 + 0.15 * ease).toFixed(3)})`,
        filter: `drop-shadow(0 0 ${size * 0.06}px ${gold}33)`,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

// ─── Contador gigante (el "dato estrella") ────────────────────────────────────

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/**
 * Anima el NÚMERO dentro de un statValue ("$300", "50%", "1.200") de 0 → valor
 * en `dur` segundos, conservando prefijo/sufijo y formateando es-MX con
 * tabular-nums (no baila el layout). Si no hay número, devuelve el texto tal cual.
 */
export function animatedStatText(statValue: string, elapsed: number, dur = 0.9): string {
  const m = statValue.match(/^([^0-9]*)([0-9][0-9.,]*)(.*)$/);
  if (!m) return statValue;
  const [, prefix, numRaw, suffix] = m;
  // "1.200" / "1,200" → 1200 ; "3,5" / "3.5" → 3.5 (heurística: separador final de 1-2 dígitos = decimal)
  const clean = numRaw.replace(/[.,](?=\d{3}\b)/g, "");
  const normalized = clean.replace(",", ".");
  const target = parseFloat(normalized);
  if (!Number.isFinite(target)) return statValue;
  const decimals = (normalized.split(".")[1] ?? "").length;
  const p = easeOutCubic(Math.min(1, Math.max(0, elapsed / dur)));
  const value = target * p;
  const formatted = new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${prefix}${formatted}${suffix}`;
}
