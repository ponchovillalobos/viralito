import { AbsoluteFill } from "remotion";
import { z } from "zod";
import { PLAYFAIR, PLAYFAIR_IT, DMSERIF, DMSERIF_IT, LORA, LORA_IT, ABRIL } from "./local-editorial-fonts";
import { LineArtIcon, LineArtLucide, LINE_ART_KINDS, type LineArtKind } from "./line-art-icons";
import { stepTime, gateWeave } from "./editorial-texture";
import {
  VARIABLE_FONT_THEMES,
  titleVariation,
  InkAnnotation,
  inkKindFor,
  animatedStatText,
  InlineSvgIcon,
} from "./editorial-ink";
import { resolveEditorialLook, MotifLayer, EDITORIAL_THEME_DEFS } from "./editorial-themes";

/**
 * EDITORIAL — Tarjetas tipográficas estilo revista/documental (referencia: los
 * screenshots del dueño). El video vive en un panel lateral; el lado oscuro
 * muestra: kicker en mayúsculas espaciadas, titular serif GIGANTE con la palabra
 * acento en dorado-itálica, subtítulo gris, capítulos numerados (01 · 01/04),
 * stats enormes ($300 al día) e ilustraciones line-art animadas.
 */
// Tipografías (Playfair/DMSerif/Lora/Abril) ahora son TTF locales (cero red en
// render). Mismos family CSS → FONT_THEMES queda idéntico. Ver local-editorial-fonts.

/** Familia (normal, itálica) por tema de fuente. Abril no tiene itálica → reusa.
 *  Las VARIABLES (fraunces/bodoni/robotoserif/bricolage/newsreader) vienen de
 *  editorial-ink (TTF locales, ejes animables por frame). */
const FONT_THEMES: Record<string, [string, string]> = {
  playfair: [PLAYFAIR, PLAYFAIR_IT],
  dmserif: [DMSERIF, DMSERIF_IT],
  lora: [LORA, LORA_IT],
  abril: [ABRIL, ABRIL],
  ...VARIABLE_FONT_THEMES,
};

/** Colores de lienzo/texto por fondo. */
export const EDITORIAL_BG: Record<string, { bg: string; text: string; muted: string }> = {
  dark: { bg: "#0a0908", text: "#f3ede1", muted: "#9b958a" },
  ink: { bg: "#0a0f16", text: "#e9eef5", muted: "#8b95a3" },
  cream: { bg: "#f5efe3", text: "#1c1611", muted: "#7a7163" },
};

export const editorialCardSchema = z.object({
  at: z.number(),
  duration: z.number().default(5),
  /** Mini-etiqueta arriba del titular: "LA VERDAD", "HOY TE ENSEÑO · 01 / 04" */
  kicker: z.string().default(""),
  /** Titular serif. La palabra que coincida con `accent` va en dorado itálica. */
  title: z.string().default(""),
  accent: z.string().default(""),
  subtitle: z.string().default(""),
  /** Capítulo: "01" grande dorado (si viene). */
  number: z.string().default(""),
  /** Stat: valor enorme ("$300") + unidad itálica ("al día"). */
  statValue: z.string().default(""),
  statUnit: z.string().default(""),
  /** Ilustración line-art ("" = sin ícono). 18 dibujadas a mano (clock, funnel,
   *  faucet, gears, route…) o CUALQUIER nombre de ícono Lucide ("shield-check",
   *  "users", "map-pin"… 1,500+) animado genéricamente. */
  icon: z.string().default(""),
  /** PULL-QUOTE (Ola 2): cita serif palabra-por-palabra al ritmo de la voz.
   *  quoteWords trae los timestamps de Whisper de cada palabra. */
  quote: z.boolean().default(false),
  quoteWords: z.array(z.object({ w: z.string(), at: z.number() })).default([]),
  /** SVG embebido para iconos externos "ph:"/"tb:" (Ola 4) — lo inyecta
   *  editorial-icons.mjs en build-time; usa currentColor (se pinta del acento). */
  iconSvg: z.string().default(""),
});
export type EditorialCard = z.infer<typeof editorialCardSchema>;

export const editorialLayoutSchema = z.object({
  /** Lado donde vive el PANEL DE VIDEO (el texto va al lado contrario). */
  panel: z.enum(["right", "left"]).default("right"),
  /** Ancho del panel de video como fracción del frame (0.3-0.5). */
  panelWidth: z.number().default(0.40),
  /** Color de acento del tema (reemplaza al dorado clásico): palabra itálica,
   *  números de capítulo y detalles de las ilustraciones line-art. */
  accent: z.string().default("#f0b429"),
  /** Fuente serif del tema (las últimas 5 son VARIABLES y respiran por frame). */
  font: z
    .enum(["playfair", "dmserif", "lora", "abril", "fraunces", "bodoni", "robotoserif", "bricolage", "newsreader"])
    .default("playfair"),
  /** Fondo del lienzo: oscuro clásico, tinta azulada, o crema claro (texto invertido). */
  background: z.enum(["dark", "ink", "cream"]).default("dark"),
  /** ESCENAS del panel de video: cambia de tamaño/lugar a lo largo del video
   *  (derecha → izquierda → cuadrado → grande → FULLSCREEN al final) con
   *  transición suave. [] = panel estático (compat). */
  scenes: z
    .array(
      z.object({
        at: z.number(),
        mode: z.enum(["right", "left", "square_right", "square_left", "big", "full"]),
      })
    )
    .default([]),
  // ─── Motor de look (Ola 1, opt-in: un proyecto viejo renderiza idéntico) ───
  /** Textura procedural del lienzo. */
  texture: z.enum(["none", "paper"]).default("none"),
  /** Capas gráficas a 12 fps (look documental "hecho a mano", firma Vox). */
  fps12: z.boolean().default(false),
  /** Capa de cohesión: grano vivo + viñeta + aberración sutil + gate weave. */
  cohesion: z.boolean().default(false),
  /** Duotono del panel de video 0..1 (0 = off). Look Economist. */
  duotone: z.number().default(0),
  /** SUB-TEMA de clase mundial (Ola 3): "prensa", "vogue", "kinfolk", "riso",
   *  "grabado", "constructivista", "bauhaus", "swiss", "brutal", "mincho",
   *  "stripe", "docu", "ft". "" = clásico (font+background de arriba). */
  theme: z.string().default(""),
});
export type EditorialLayout = z.infer<typeof editorialLayoutSchema>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** [familia del titular, familia de kickers] resueltas del tema (la usa el
 *  chart layer de Ola 5 — misma lógica que las tarjetas). */
export function editorialFontsFor(layout: EditorialLayout): [string, string] {
  const look = resolveEditorialLook(layout);
  const [n] = look.fontTitle ?? FONT_THEMES[layout.font ?? "playfair"] ?? FONT_THEMES.playfair;
  return [n, look.fontKicker ?? "Arial, sans-serif"];
}

// ─── PANEL DINÁMICO: rect del video por escena, con transición suave. ─────────
export interface PanelRect {
  x: number; y: number; w: number; h: number; r: number;
  /** En "big"/"full" las tarjetas se ocultan: el video respira. */
  cardsHidden: boolean;
  /** Lado donde va el TEXTO (contrario al panel). */
  textSide: "left" | "right";
  /** En 9:16 los modos cuadrado/cierre ponen el texto DEBAJO del panel (lado a
   *  lado no entra sin encimarse — bug visto en producción). */
  textBelow?: boolean;
}

type PanelMode = "right" | "left" | "square_right" | "square_left" | "big" | "full";

function rectFor(
  mode: PanelMode,
  pw: number,
  W: number,
  H: number,
  sourceAspect?: number
): PanelRect {
  const portrait = H > W;
  const tall = { w: pw * W, h: 0.88 * H, y: 0.06 * H, r: 18 };
  const s = Math.min(0.52 * H, 0.8 * W);
  switch (mode) {
    case "left":
      return { x: 36, ...tall, cardsHidden: false, textSide: "right" };
    case "square_right": {
      if (portrait) {
        // 9:16: el cuadrado va ARRIBA y el texto DEBAJO. Lado a lado el panel
        // tapaba el texto (el cuadrado ocupaba ~80% del ancho).
        const sq = Math.min(0.74 * W, 0.4 * H);
        return { x: W - 56 - sq, y: 0.06 * H, w: sq, h: sq, r: 24, cardsHidden: false, textSide: "left", textBelow: true };
      }
      return { x: W - 48 - s, y: (H - s) / 2, w: s, h: s, r: 24, cardsHidden: false, textSide: "left" };
    }
    case "square_left": {
      if (portrait) {
        const sq = Math.min(0.74 * W, 0.4 * H);
        return { x: 56, y: 0.06 * H, w: sq, h: sq, r: 24, cardsHidden: false, textSide: "right", textBelow: true };
      }
      return { x: 48, y: (H - s) / 2, w: s, h: s, r: 24, cardsHidden: false, textSide: "right" };
    }
    case "big": {
      if (portrait) {
        // 9:16: "grande" = casi todo el ancho (el 0.56W de landscape quedaba flaco).
        const bw = 0.86 * W;
        const bh = 0.62 * H;
        return { x: (W - bw) / 2, y: (H - bh) / 2, w: bw, h: bh, r: 22, cardsHidden: true, textSide: "left" };
      }
      const bw = 0.56 * W;
      const bh = 0.78 * H;
      return { x: (W - bw) / 2, y: (H - bh) / 2, w: bw, h: bh, r: 22, cardsHidden: true, textSide: "left" };
    }
    case "full": {
      // FULLSCREEN solo si el aspecto del VIDEO ORIGINAL coincide con el del
      // output (±15%). Si no, recortar a pantalla completa destruiría el
      // encuadre → escena de CIERRE: el video GRANDE respetando su aspecto +
      // la frase final cerca (nunca un video miniatura con el texto lejos).
      const outAspect = W / H;
      const src = sourceAspect && sourceAspect > 0 ? sourceAspect : outAspect;
      const mismatch = Math.abs(src - outAspect) / outAspect > 0.15;
      if (!mismatch) {
        return { x: 0, y: 0, w: W, h: H, r: 0, cardsHidden: true, textSide: "left" };
      }
      if (portrait) {
        // salida 9:16 con fuente apaisada: banda ancha en el tercio superior
        // (la cara se ve grande) + texto DEBAJO.
        const cw = W - 96;
        const ch = Math.min(cw / src, 0.5 * H);
        return { x: 48, y: 0.13 * H, w: cw, h: ch, r: 20, cardsHidden: false, textSide: "left", textBelow: true };
      }
      const ch = 0.88 * H;
      const cw = Math.min(ch * src, 0.6 * W);
      return {
        x: W - 48 - cw,
        y: (H - ch) / 2,
        w: cw,
        h: cw / src,
        r: 20,
        cardsHidden: false,
        textSide: "left",
      };
    }
    default: // right
      return { x: W - 36 - pw * W, ...tall, cardsHidden: false, textSide: "left" };
  }
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Rect del panel en el tiempo t: interpola entre la escena anterior y la actual
 *  durante 0.8s (ease cúbico). Sin escenas → panel estático clásico. */
export function editorialPanelAt(
  layout: EditorialLayout,
  t: number,
  W: number,
  H: number,
  sourceAspect?: number
): PanelRect {
  const pw = layout.panelWidth ?? 0.4;
  const baseMode: PanelMode = (layout.panel ?? "right") as PanelMode;
  const scenes = (layout.scenes ?? []).filter((s) => typeof s?.at === "number");
  if (scenes.length === 0) return rectFor(baseMode, pw, W, H, sourceAspect);

  const sorted = [...scenes].sort((a, b) => a.at - b.at);
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].at <= t) idx = i;
    else break;
  }
  const prevMode: PanelMode = idx <= 0 ? (idx === 0 ? baseMode : baseMode) : (sorted[idx - 1].mode as PanelMode);
  const curMode: PanelMode = idx < 0 ? baseMode : (sorted[idx].mode as PanelMode);
  const from = rectFor(idx <= 0 ? baseMode : prevMode, pw, W, H, sourceAspect);
  const to = rectFor(curMode, pw, W, H, sourceAspect);
  const p = idx < 0 ? 1 : easeInOut(clamp01((t - sorted[idx].at) / 0.8));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    w: lerp(from.w, to.w),
    h: lerp(from.h, to.h),
    r: lerp(from.r, to.r),
    cardsHidden: p > 0.4 ? to.cardsHidden : from.cardsHidden,
    textSide: p > 0.4 ? to.textSide : from.textSide,
    textBelow: p > 0.4 ? to.textBelow : from.textBelow,
  };
}

// ─── FX DE ILUSTRACIÓN: 4 tratamientos distintos que rotan por tarjeta ───────
// La MISMA ilustración se ve diferente según la tarjeta: anillo orbital, ráfaga
// de líneas, marco de esquinas o limpio. Variedad sin tocar el schema.
type IlloVariant = "clean" | "ring" | "burst" | "frame";
const ILLO_VARIANTS: IlloVariant[] = ["ring", "burst", "frame", "clean"];

export function illoVariantFor(card: EditorialCard, index: number): IlloVariant {
  const h = (card.icon ?? "").length * 7 + Math.round((card.at ?? 0) * 10) + index * 3;
  return ILLO_VARIANTS[Math.abs(h) % ILLO_VARIANTS.length];
}

/** Decora cualquier ilustración (a mano o Lucide) con un FX animado alrededor. */
const IllustrationFX: React.FC<{
  variant: IlloVariant;
  elapsed: number;
  size: number;
  gold: string;
  children: React.ReactNode;
}> = ({ variant, elapsed, size, gold, children }) => {
  const p = clamp01(elapsed / 0.8);
  const ease = 1 - Math.pow(1 - p, 3);
  const S = size * 1.34;
  const deco: React.ReactNode = (() => {
    if (variant === "ring") {
      // anillo punteado que rota + satélite orbitando.
      const a = elapsed * 0.9;
      const r = S * 0.46;
      return (
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ position: "absolute", inset: 0 }}>
          <circle cx={S / 2} cy={S / 2} r={r * ease} fill="none" stroke={gold} strokeWidth={1.6}
            strokeDasharray="3 9" strokeDashoffset={-elapsed * 16} opacity={0.55 * ease} />
          <circle cx={S / 2 + Math.cos(a) * r * ease} cy={S / 2 + Math.sin(a) * r * ease}
            r={S * 0.018} fill={gold} opacity={ease} />
        </svg>
      );
    }
    if (variant === "burst") {
      // ráfaga de 8 rayos que respiran (estilo grabado).
      const breathe = 0.6 + 0.4 * Math.sin(elapsed * 2.2);
      return (
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ position: "absolute", inset: 0 }}>
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2 + 0.39;
            const r0 = S * 0.44;
            const r1 = S * (0.44 + 0.05 * breathe);
            return (
              <line key={i} x1={S / 2 + Math.cos(a) * r0 * ease} y1={S / 2 + Math.sin(a) * r0 * ease}
                x2={S / 2 + Math.cos(a) * r1 * ease} y2={S / 2 + Math.sin(a) * r1 * ease}
                stroke={gold} strokeWidth={2} strokeLinecap="round" opacity={0.7 * ease} />
            );
          })}
        </svg>
      );
    }
    if (variant === "frame") {
      // marco de esquinas editoriales que se dibuja.
      const L = S * 0.16 * ease;
      const m = S * 0.06;
      const corner = (x: number, y: number, dx: number, dy: number) => (
        <path d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} fill="none"
          stroke={gold} strokeWidth={1.8} opacity={0.7 * ease} />
      );
      return (
        <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ position: "absolute", inset: 0 }}>
          {corner(m, m, 1, 1)}
          {corner(S - m, m, -1, 1)}
          {corner(m, S - m, 1, -1)}
          {corner(S - m, S - m, -1, -1)}
        </svg>
      );
    }
    return null;
  })();
  return (
    <div style={{ position: "relative", width: S, height: S, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {deco}
      {children}
    </div>
  );
};

// ─── CAPA AMBIENTAL: el lienzo NUNCA se ve vacío ──────────────────────────────
// Decoración editorial sutil siempre presente detrás de todo: grilla de puntos,
// reglas de página tipo revista, círculo punteado gigante que rota lento y
// marcas "+" que derivan. Determinística (currentTime) — no distrae, acompaña.
export const EditorialAmbient: React.FC<{
  layout: EditorialLayout;
  currentTime: number;
  width: number;
  height: number;
}> = ({ layout, currentTime, width, height }) => {
  const look = resolveEditorialLook(layout);
  const GOLD = layout.accent ?? look.themeAccent ?? "#f0b429";
  const theme = look.canvas;
  // 12 fps en lo gráfico (firma Vox) — el video del panel sigue a fps completos.
  const t = stepTime(currentTime, layout.fps12);
  const intro = clamp01(t / 1.2);
  const W = width;
  const H = height;
  // Sub-tema: motivo procedural propio; los temas "limpios" silencian la
  // decoración clásica (círculos punteados, marcas +, reglas con folio).
  const motifNode =
    look.motif !== "none" ? (
      <MotifLayer motif={look.motif} t={t} width={W} height={H} accent={GOLD} canvas={theme} />
    ) : null;
  if (look.motif !== "none" && look.minimalAmbient) {
    return <AbsoluteFill style={{ pointerEvents: "none", opacity: intro }}>{motifNode}</AbsoluteFill>;
  }
  const marks = [
    { x: 0.12, y: 0.16, s: 0.9, ph: 0 },
    { x: 0.86, y: 0.12, s: 0.7, ph: 2.1 },
    { x: 0.08, y: 0.82, s: 0.8, ph: 4.2 },
    { x: 0.9, y: 0.86, s: 1.0, ph: 1.3 },
    { x: 0.5, y: 0.07, s: 0.6, ph: 3.4 },
  ];
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: intro,
        transform: gateWeave(t, layout.cohesion) || undefined,
      }}
    >
      {/* grilla de puntos sutil en todo el lienzo */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${theme.muted} 1px, transparent 1px)`,
          backgroundSize: `${Math.round(W * 0.04)}px ${Math.round(W * 0.04)}px`,
          opacity: 0.07,
        }}
      />
      {/* reglas de página (arriba/abajo) con folio, como una revista — los
          sub-temas con motivo propio traen sus propias reglas (filetes, marcos). */}
      {!motifNode && (
        <>
          <div style={{ position: "absolute", top: H * 0.035, left: W * 0.045, right: W * 0.045, borderTop: `1px solid ${theme.muted}55`, display: "flex", justifyContent: "space-between", paddingTop: 6 }}>
            <span style={{ fontFamily: "Arial, sans-serif", fontSize: H * 0.011, letterSpacing: "0.45em", color: theme.muted, opacity: 0.75, textTransform: "uppercase" }}>● Documental</span>
            <span style={{ fontFamily: "Arial, sans-serif", fontSize: H * 0.011, letterSpacing: "0.45em", color: GOLD, opacity: 0.8 }}>{`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`}</span>
          </div>
          <div style={{ position: "absolute", bottom: H * 0.035, left: W * 0.045, right: W * 0.045, borderBottom: `1px solid ${theme.muted}55` }} />
        </>
      )}
      {motifNode}
      {/* círculo punteado GIGANTE que rota lentísimo (textura de fondo) */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.1 }}>
        <g transform={`rotate(${t * 2.4} ${W * 0.18} ${H * 0.7})`}>
          <circle cx={W * 0.18} cy={H * 0.7} r={Math.min(W, H) * 0.34} fill="none" stroke={GOLD} strokeWidth={1.4} strokeDasharray="2 14" />
        </g>
        <g transform={`rotate(${-t * 1.6} ${W * 0.84} ${H * 0.26})`}>
          <circle cx={W * 0.84} cy={H * 0.26} r={Math.min(W, H) * 0.22} fill="none" stroke={theme.muted} strokeWidth={1.2} strokeDasharray="2 11" />
        </g>
      </svg>
      {/* marcas "+" que derivan suave (vida ambiental) */}
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {marks.map((m, i) => {
          const dx = Math.sin(t * 0.5 + m.ph) * W * 0.006;
          const dy = Math.cos(t * 0.4 + m.ph) * H * 0.008;
          const tw = 0.35 + 0.3 * Math.sin(t * 1.4 + m.ph);
          const s = H * 0.009 * m.s;
          const x = m.x * W + dx;
          const y = m.y * H + dy;
          return (
            <g key={i} opacity={tw}>
              <line x1={x - s} y1={y} x2={x + s} y2={y} stroke={i % 2 ? GOLD : theme.muted} strokeWidth={1.6} />
              <line x1={x} y1={y - s} x2={x} y2={y + s} stroke={i % 2 ? GOLD : theme.muted} strokeWidth={1.6} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

// ─── BASELINE DE TEXTO: subtítulo editorial SIEMPRE presente ──────────────────
// Garantiza que NUNCA haya pantalla sin texto en modo editorial: agrupa las
// palabras del transcript en frases cortas (frase activa según el timestamp) y
// las muestra en una banda inferior con el LOOK del tema (serif + acento). Va por
// DEBAJO de las tarjetas/charts (es la base constante); cuando el panel está en
// "big"/"full" y las tarjetas se ocultan, este baseline sigue en pantalla → cero
// "aire muerto". Pasivo y discreto: no compite con el titular, solo evita el vacío.
interface BaselineWord { word: string; start: number; end: number }

/** Agrupa words en líneas de ~3-7 palabras cortando por pausa/puntuación. */
function baselineLines(words: BaselineWord[]): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let cur: BaselineWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.word).join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push({ text, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w || typeof w.start !== "number") continue;
    cur.push(w);
    const txt = (w.word ?? "").trim();
    const next = words[i + 1];
    const gap = next ? next.start - (w.end ?? w.start) : 99;
    const hardStop = /[.!?…]$/.test(txt);
    // Corta por puntuación, pausa > 0.45s, o al juntar ~7 palabras (línea legible).
    if (hardStop || gap > 0.45 || cur.length >= 7) flush();
  }
  flush();
  return out;
}

export const EditorialSubtitleBaseline: React.FC<{
  words: BaselineWord[];
  currentTime: number;
  layout: EditorialLayout;
  width: number;
  height: number;
  panel?: PanelRect;
}> = ({ words, currentTime, layout, width, height, panel }) => {
  if (!words || words.length === 0) return null;
  const look = resolveEditorialLook(layout);
  const GOLD = layout.accent ?? look.themeAccent ?? "#f0b429";
  const [, FONT_I] =
    look.fontTitle ?? FONT_THEMES[layout.font ?? "playfair"] ?? FONT_THEMES.playfair;
  const FONT_BODY = look.fontBody ?? FONT_I;
  const theme = look.canvas;
  const now = currentTime; // baseline al ritmo real de la voz (no 12fps).
  const lines = baselineLines(words);
  if (lines.length === 0) return null;
  // Línea activa: la última cuyo inicio ya pasó (se mantiene hasta la próxima).
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= now + 0.04) idx = i;
    else break;
  }
  if (idx < 0) idx = 0;
  // Antes de que arranque la voz no mostramos baseline (el arranque del clip lo
  // cubren las tarjetas/visuales); de ahí en adelante SIEMPRE hay una línea
  // activa (la última dicha se sostiene hasta la próxima → cero vacío).
  if (now < lines[0].start - 0.05) return null;
  const line = lines[idx];
  const intro = clamp01((now - line.start) / 0.28);
  // Palabras de la línea entran al ritmo de la voz (sutil, no kinético agresivo).
  const lineWords = line.text.split(/\s+/).filter(Boolean);
  const span = Math.max(0.4, line.end - line.start);
  // Posición: si hay panel con texto DEBAJO, la banda va más arriba para no
  // chocar; si no, banda inferior centrada clásica.
  const bottom = panel?.textBelow ? height * 0.05 : height * 0.06;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: width * 0.07,
          right: width * 0.07,
          bottom,
          display: "flex",
          justifyContent: "center",
          opacity: intro,
        }}
      >
        <div
          style={{
            fontFamily: FONT_BODY,
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: height * 0.026,
            lineHeight: 1.3,
            color: theme.text,
            textAlign: "center",
            maxWidth: "100%",
            // Caja sutil para legibilidad sobre el video del panel sin tapar el look.
            background: `${theme.bg}c2`,
            padding: `${height * 0.008}px ${width * 0.02}px`,
            borderRadius: height * 0.01,
            backdropFilter: "blur(2px)",
            boxShadow: `0 2px 16px ${theme.bg}55`,
          }}
        >
          {lineWords.map((w, i) => {
            const wt = lineWords.length > 1 ? i / (lineWords.length - 1) : 0;
            const wStart = line.start + wt * span * 0.85;
            const lit = now >= wStart - 0.02;
            return (
              <span
                key={i}
                style={{
                  color: lit ? theme.text : theme.muted,
                  transition: "none",
                  // La última palabra dicha toma el acento (guía la lectura).
                  ...(lit && now < wStart + 0.32 ? { color: GOLD } : null),
                }}
              >
                {w}
                {i < lineWords.length - 1 ? " " : ""}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Entrada por líneas: slide-up con máscara (el look "editorial" clásico). */
const Reveal: React.FC<{ t: number; delay: number; children: React.ReactNode }> = ({
  t,
  delay,
  children,
}) => {
  const p = clamp01((t - delay) / 0.5);
  const ease = 1 - Math.pow(1 - p, 3);
  return (
    <div style={{ overflow: "hidden" }}>
      <div style={{ transform: `translateY(${(1 - ease) * 110}%)`, opacity: p > 0 ? 1 : 0 }}>
        {children}
      </div>
    </div>
  );
};

export const EditorialCardLayer: React.FC<{
  card: EditorialCard;
  currentTime: number;
  layout: EditorialLayout;
  width: number;
  height: number;
  /** Rect actual del panel dinámico (define lado del texto y ancho disponible). */
  panel?: PanelRect;
  /** Índice de la tarjeta (rota el tratamiento FX de la ilustración). */
  index?: number;
}> = ({ card, currentTime, layout, width, height, panel, index = 0 }) => {
  const look = resolveEditorialLook(layout);
  const GOLD = layout.accent ?? look.themeAccent ?? "#f0b429";
  const [FONT_N, FONT_I] =
    look.fontTitle ?? FONT_THEMES[layout.font ?? "playfair"] ?? FONT_THEMES.playfair;
  const FONT_BODY = look.fontBody ?? FONT_N;
  const FONT_KICKER = look.fontKicker ?? "Arial, sans-serif";
  const theme = look.canvas;
  const TEXT = theme.text;
  const MUTED = theme.muted;
  // Reloj gráfico a 12 fps (las tarjetas entran/animan en pasos — look editorial).
  const now = stepTime(currentTime, layout.fps12);
  const t = now - card.at;
  const remaining = card.at + (card.duration ?? 5) - now;
  if (t < 0 || remaining < 0) return null;
  const fadeOut = clamp01(remaining / 0.35);
  const weave = gateWeave(now, layout.cohesion) || undefined;

  const textOnLeft =
    (panel?.textSide ?? ((layout.panel ?? "right") === "right" ? "left" : "right")) === "left";
  // En 9:16 (cuadrado/cierre) el texto va DEBAJO del panel a lo ancho — al
  // costado se encimaba con el video (bug visto en producción).
  const textBelow = Boolean(panel?.textBelow);
  const zoneWidth = textBelow
    ? width - 112
    : panel
      ? Math.max(width * 0.3, width - panel.w - 140)
      : width * (1 - (layout.panelWidth ?? 0.4)) - 90;
  const isStat = Boolean(card.statValue);
  const hasIcon = Boolean(card.icon);
  // Tarjeta VISUAL: sin titular/stat/capítulo → la ILUSTRACIÓN es la protagonista
  // (se usa para rellenar huecos entre frases fuertes; el lienzo nunca queda vacío).
  const isVisual = hasIcon && !card.title && !card.statValue && !card.number;
  // Escala tipográfica relativa al alto del frame (sirve igual en 9:16 y 16:9).
  const titleSize = Math.min(zoneWidth * (textBelow ? 0.082 : 0.135), height * 0.075);
  const variant = illoVariantFor(card, index);
  const iconSize = isVisual
    ? Math.min(zoneWidth * (textBelow ? 0.4 : 0.62), height * (textBelow ? 0.22 : 0.36))
    : Math.min(zoneWidth * (textBelow ? 0.24 : 0.46), height * (textBelow ? 0.15 : 0.26));
  const zoneStyle: React.CSSProperties =
    textBelow && panel
      ? {
          position: "absolute",
          left: 56,
          right: 56,
          top: panel.y + panel.h + height * 0.03,
          bottom: height * 0.04,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: height * 0.014,
        }
      : {
          position: "absolute",
          top: 0,
          bottom: 0,
          [textOnLeft ? "left" : "right"]: 56,
          width: zoneWidth,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: height * 0.014,
        };
  const iconNode = card.iconSvg ? (
    // Icono EXTERNO embebido (Phosphor duotone / Tabler — Ola 4): currentColor
    // lo pinta del acento; entra con fade+scale y flota suave.
    <InlineSvgIcon svg={card.iconSvg} size={iconSize * 0.92} gold={GOLD} elapsed={Math.max(0, t - 0.4)} />
  ) : hasIcon ? (
    LINE_ART_KINDS.includes(card.icon as LineArtKind) ? (
      <LineArtIcon kind={card.icon as LineArtKind} elapsed={Math.max(0, t - 0.4)} size={iconSize} gold={GOLD} />
    ) : (
      <LineArtLucide name={card.icon} elapsed={Math.max(0, t - 0.4)} size={iconSize * 0.88} gold={GOLD} />
    )
  ) : null;

  // Titular con la palabra acento en dorado-itálica (match por inclusión, sin caso).
  const accentLc = (card.accent ?? "").toLowerCase();
  const words = (card.title ?? "").split(/\s+/).filter(Boolean);
  // Fuente variable: el titular "respira" por frame (undefined si no es variable).
  // Los sub-temas con fuente variable mapean a su clave (vogue→bodoni, stripe→newsreader).
  const varKey =
    layout.theme === "vogue" ? "bodoni"
    : layout.theme === "stripe" ? "newsreader"
    : layout.theme && EDITORIAL_THEME_DEFS[layout.theme] ? undefined
    : layout.font;
  const titleVar = titleVariation(varKey, now);
  // Anotación a mano alzada sobre la palabra acento (seed determinista por tarjeta).
  const inkSeed = 1 + Math.abs(Math.round((card.at ?? 0) * 37) + index * 11);
  const inkProgress = clamp01((t - 0.55) / 0.6);

  // ── PULL-QUOTE: cita serif palabra-por-palabra al ritmo de la voz. ──
  if (card.quote && (card.quoteWords?.length ?? 0) > 0) {
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut, transform: weave }}>
        <div style={{ ...zoneStyle, justifyContent: "center" }}>
          {/* comillas gigantes al 12% detrás */}
          <div
            style={{
              position: "absolute",
              top: textBelow ? "-0.05em" : "8%",
              [textOnLeft ? "left" : "right"]: 0,
              fontFamily: FONT_N,
              fontWeight: 900,
              fontSize: titleSize * 3.4,
              lineHeight: 1,
              color: GOLD,
              opacity: 0.13,
            }}
          >
            “
          </div>
          {card.kicker ? (
            <Reveal t={t} delay={0.05}>
              <div style={{ fontFamily: FONT_KICKER, fontSize: height * 0.0165, letterSpacing: "0.5em", textTransform: "uppercase", color: MUTED }}>
                {card.kicker}
              </div>
            </Reveal>
          ) : null}
          <div
            style={{
              fontFamily: FONT_I,
              fontStyle: "italic",
              fontWeight: 700,
              fontSize: titleSize * 0.82,
              lineHeight: 1.28,
              color: TEXT,
              maxWidth: zoneWidth * 0.94,
              fontVariationSettings: titleVar,
            }}
          >
            {card.quoteWords.map((qw, i) => {
              // Cada palabra entra EXACTAMENTE cuando se dice (timestamp Whisper).
              const wp = clamp01((now - qw.at) / 0.22);
              if (wp <= 0) return null;
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    clipPath: `inset(${(1 - wp) * 100}% 0 0 0)`,
                    transform: `translateY(${(1 - wp) * 14}%)`,
                    marginRight: "0.28em",
                  }}
                >
                  {qw.w}
                </span>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  // ── TARJETA VISUAL: ilustración GRANDE centrada + kicker + frase corta. ──
  if (isVisual) {
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut, transform: weave }}>
        <div style={{ ...zoneStyle, alignItems: "center", justifyContent: "center", gap: height * 0.022 }}>
          {card.kicker ? (
            <Reveal t={t} delay={0.05}>
              <div
                style={{
                  fontFamily: FONT_KICKER,
                  fontSize: height * 0.0165,
                  letterSpacing: "0.5em",
                  textTransform: "uppercase",
                  color: MUTED,
                  textAlign: "center",
                }}
              >
                {card.kicker}
              </div>
            </Reveal>
          ) : null}
          <div style={{ opacity: clamp01((t - 0.25) / 0.3) }}>
            <IllustrationFX variant={variant} elapsed={Math.max(0, t - 0.25)} size={iconSize} gold={GOLD}>
              {iconNode}
            </IllustrationFX>
          </div>
          {card.subtitle ? (
            <Reveal t={t} delay={0.55}>
              <div
                style={{
                  fontFamily: FONT_I,
                  fontStyle: "italic",
                  fontWeight: 700,
                  fontSize: titleSize * 0.5,
                  color: TEXT,
                  textAlign: "center",
                  maxWidth: zoneWidth * 0.9,
                  lineHeight: 1.3,
                }}
              >
                {card.subtitle}
              </div>
            </Reveal>
          ) : null}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut, transform: weave }}>
      <div style={zoneStyle}>
        {card.kicker ? (
          <Reveal t={t} delay={0.05}>
            <div
              style={{
                fontFamily: FONT_KICKER,
                fontSize: height * 0.0165,
                letterSpacing: "0.5em",
                textTransform: "uppercase",
                color: MUTED,
                // DOCU: la barra roja Economist antes del kicker (la firma).
                ...(look.motif === "docu"
                  ? { borderLeft: `${Math.round(height * 0.006)}px solid ${GOLD}`, paddingLeft: 14 }
                  : null),
              }}
            >
              {card.kicker}
            </div>
          </Reveal>
        ) : null}

        {card.number ? (
          <Reveal t={t} delay={0.18}>
            <div
              style={{
                fontFamily: FONT_N,
                fontWeight: 900,
                fontSize: titleSize * 1.05,
                lineHeight: 1,
                color: GOLD,
              }}
            >
              {card.number}
            </div>
          </Reveal>
        ) : null}

        {isStat ? (
          <Reveal t={t} delay={0.18}>
            <div style={{ lineHeight: 1.02 }}>
              <span
                style={{
                  fontFamily: FONT_N,
                  fontWeight: 900,
                  fontSize: titleSize * 1.5,
                  color: TEXT,
                  // tabular-nums: el contador no "baila" mientras sube.
                  fontVariantNumeric: "tabular-nums",
                  fontVariationSettings: titleVar,
                }}
              >
                {animatedStatText(card.statValue, Math.max(0, t - 0.18))}
              </span>
              {card.statUnit ? (
                <span
                  style={{
                    fontFamily: FONT_I,
                    fontStyle: "italic",
                    fontWeight: 700,
                    fontSize: titleSize * 0.85,
                    color: TEXT,
                    marginLeft: 14,
                  }}
                >
                  {card.statUnit}
                </span>
              ) : null}
            </div>
          </Reveal>
        ) : null}

        {words.length > 0 && (
          <Reveal t={t} delay={isStat || card.number ? 0.32 : 0.18}>
            <div style={{ position: "relative" }}>
              {/* RISO: misregistración de tintas (rosa/azul multiply ±2px que
                  respira ±1px) — la firma del tema zine. */}
              {look.motif === "riso" ? (
                <>
                  {([["#FF48B0", 1], ["#0078BF", -1]] as const).map(([c, dir]) => (
                    <div
                      key={c}
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: 0,
                        fontFamily: FONT_N,
                        fontWeight: titleVar ? undefined : 900,
                        fontSize: titleSize,
                        lineHeight: 1.06,
                        color: c,
                        mixBlendMode: "multiply",
                        textTransform: look.titleTransform,
                        transform: `translate(${dir * (2 + Math.round(Math.sin(now * 2.3) * 1))}px, ${dir * (1 + Math.round(Math.cos(now * 1.9) * 1))}px)`,
                        opacity: 0.85,
                      }}
                    >
                      {card.title}
                    </div>
                  ))}
                </>
              ) : null}
              {/* VOGUE: numeral de capítulo GIGANTE detrás del titular (8%). */}
              {look.motif === "vogue" && card.number ? (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    right: "-4%",
                    top: "-1.2em",
                    fontFamily: FONT_N,
                    fontSize: titleSize * 3.6,
                    lineHeight: 1,
                    color: TEXT,
                    opacity: 0.08,
                    fontVariationSettings: titleVar,
                  }}
                >
                  {card.number}
                </div>
              ) : null}
            <div
              style={{
                position: "relative",
                fontFamily: FONT_N,
                fontWeight: titleVar ? undefined : 900,
                fontSize: titleSize,
                lineHeight: 1.06,
                color: TEXT,
                textTransform: look.titleTransform,
                // Fuente variable: el titular respira (wght/SOFT/GRAD por frame).
                fontVariationSettings: titleVar,
              }}
            >
              {words.map((w, i) => {
                const isAccent =
                  accentLc.length > 1 &&
                  w.toLowerCase().replace(/[.,;:!?¿¡]/g, "").includes(accentLc);
                if (isAccent) {
                  // Palabra acento: dorada itálica + anotación a MANO ALZADA
                  // (subrayado/círculo/caja rough) que se dibuja con la voz.
                  return (
                    <span key={i}>
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <span style={{ fontFamily: FONT_I, fontStyle: "italic", color: GOLD }}>{w}</span>
                        <InkAnnotation
                          kind={inkKindFor(index)}
                          progress={inkProgress}
                          color={GOLD}
                          seed={inkSeed}
                        />
                      </span>
                      {i < words.length - 1 ? " " : ""}
                    </span>
                  );
                }
                return (
                  <span key={i}>
                    {w}
                    {i < words.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </div>
            </div>
          </Reveal>
        )}

        {card.subtitle ? (
          <Reveal t={t} delay={0.5}>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 500,
                fontSize: titleSize * 0.42,
                color: MUTED,
                lineHeight: 1.35,
                maxWidth: zoneWidth * 0.92,
              }}
            >
              {card.subtitle}
            </div>
          </Reveal>
        ) : null}

        {hasIcon ? (
          <div style={{ marginTop: height * 0.012, opacity: clamp01((t - 0.4) / 0.3), alignSelf: "flex-start" }}>
            <IllustrationFX variant={variant} elapsed={Math.max(0, t - 0.4)} size={iconSize} gold={GOLD}>
              {iconNode}
            </IllustrationFX>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
