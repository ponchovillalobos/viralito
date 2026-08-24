/**
 * CapCut Pro FX — capas NUEVAS y 100% ADITIVAS.
 *
 * Traen "recetas" de CapCut a Remotion de forma nativa y headless, SIN tocar
 * ninguna capa existente de ViralVideo/cinematic-layers:
 *   - SceneFxLayer        → light leaks / bokeh / glow / dust (overlays screen-blend)
 *   - ProTransitionLayer  → whip / zoom_punch / glitch / flash en los cortes
 *   - KineticSubtitleLayer → presets de tipografía cinética (pop/slide/type/bounce/glow)
 *
 * Todo es procedural (gradientes + remotion `random`/`noise2D`), así que NO depende
 * de assets externos: funciona en cualquier máquina sin descargar nada. Si en el
 * futuro se quieren overlays de video real, se pueden sumar como kind adicional.
 *
 * Opt-in estricto: ViralVideo solo monta estas capas si su array trae datos
 * (sceneFx/proTransitions con length>0) o si kineticPreset !== "none". Con los
 * defaults vacíos, el render sale IDÉNTICO al de hoy.
 */
import { useMemo } from "react";
import {
  AbsoluteFill,
  spring,
  interpolate,
  random,
} from "remotion";
import { noise2D } from "@remotion/noise";
import { z } from "zod";

// ───────────────────────────── Schemas ──────────────────────────────────────

export const sceneFxSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.2),
  kind: z.enum(["light_leak", "bokeh", "glow", "dust"]).default("light_leak"),
  color: z.string().default("#ff8a3d"),
  opacity: z.number().default(0.55),
  intensity: z.number().default(1),
  seed: z.number().default(1),
});
export type SceneFxProps = z.infer<typeof sceneFxSchema>;

export const proTransitionSchema = z.object({
  at: z.number(),
  kind: z
    .enum([
      "whip",
      "zoom_punch",
      "glitch",
      "flash",
      "reveal_lr",
      "reveal_ud",
      // Nuevas (A5): streak de luz diagonal, barrido con desenfoque, e iris circular.
      "light_streak",
      "swipe_blur",
      "iris",
      // F3 — giro 3D del frame con perspectiva (el movimiento vive en ViralVideo).
      "flip3d",
    ])
    .default("whip"),
  durationFrames: z.number().default(8),
  color: z.string().default("#ffffff"),
});
export type ProTransitionProps = z.infer<typeof proTransitionSchema>;

const KINETIC_PRESETS = [
  "none",
  "pop",
  "slide_up",
  "type_on",
  "bounce",
  "glow_pulse",
  // Karaoke: muestra la línea/frase completa y resalta la palabra que se está diciendo
  // (estilo CapCut "auto captions"). A diferencia de los otros, NO muestra 1 palabra
  // sola sino el grupo, con la activa en color highlight.
  "karaoke",
  // Pop Reels 2026: caption nativo de TikTok — línea completa dentro de una caja
  // negra semi-opaca con contorno grueso, palabra-por-palabra resaltada (reusa el
  // mismo motor que "karaoke", no inventa resaltado por energía). Pensado con la
  // fuente TikTok Sans (subtitleFont: "tiktok").
  "pop_reels",
] as const;
export const kineticPresetSchema = z.enum(KINETIC_PRESETS).default("none");
export type KineticPreset = (typeof KINETIC_PRESETS)[number];

// ─────────────────────────── helpers ────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Fade-in en el primer `inFrac`, fade-out en el último `outFrac` del clip. */
function envelope(progress: number, inFrac = 0.22, outFrac = 0.28): number {
  const fin = clamp01(progress / inFrac);
  const fout = clamp01((1 - progress) / outFrac);
  return Math.min(fin, fout);
}

/**
 * Agrupa palabras en "líneas" para el modo karaoke: corta cuando hay una pausa
 * (gap > maxGap) o cuando se llega a maxWords. Devuelve arrays de índices de palabra.
 */
function groupWordsIntoLines(
  words: { word: string; start: number; end: number }[],
  maxWords = 4,
  maxGap = 0.6
): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (cur.length === 0) {
      cur = [i];
      continue;
    }
    const prev = words[cur[cur.length - 1]];
    const gap = words[i].start - prev.end;
    if (cur.length >= maxWords || gap > maxGap) {
      lines.push(cur);
      cur = [i];
    } else {
      cur.push(i);
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// ───────────────────────── SceneFxLayer ─────────────────────────────────────

interface SceneFxLayerProps {
  fx: SceneFxProps[];
  currentTime: number;
}

/**
 * Overlays atmosféricos compuestos con mixBlendMode:"screen" (el negro = transparente),
 * el mismo principio de los efectos de luz/film de CapCut. Solo renderiza los fx
 * activos en el frame actual.
 */
export const SceneFxLayer: React.FC<SceneFxLayerProps> = ({ fx, currentTime }) => {
  const active = fx.filter(
    (f) => currentTime >= f.at - 0.05 && currentTime <= f.at + f.duration
  );
  if (active.length === 0) return null;

  return (
    <>
      {active.map((f, i) => {
        const progress = clamp01((currentTime - f.at) / Math.max(0.001, f.duration));
        const env = envelope(progress);
        const baseOpacity = env * f.opacity;
        if (baseOpacity <= 0.001) return null;

        if (f.kind === "light_leak") {
          // Dos streaks cálidos que barren la pantalla en diagonal.
          const cx = interpolate(progress, [0, 1], [-10, 110]);
          const cx2 = interpolate(progress, [0, 1], [120, 30]);
          return (
            <AbsoluteFill
              key={`${f.at}-${i}`}
              style={{ pointerEvents: "none", mixBlendMode: "screen", opacity: baseOpacity }}
            >
              <AbsoluteFill
                style={{
                  background: `radial-gradient(ellipse 55% 130% at ${cx}% 28%, ${f.color}, transparent 62%)`,
                }}
              />
              <AbsoluteFill
                style={{
                  background: `radial-gradient(ellipse 40% 110% at ${cx2}% 72%, ${f.color}aa, transparent 60%)`,
                  opacity: 0.7,
                }}
              />
            </AbsoluteFill>
          );
        }

        if (f.kind === "bokeh") {
          const count = Math.round(10 * f.intensity);
          return (
            <AbsoluteFill
              key={`${f.at}-${i}`}
              style={{ pointerEvents: "none", mixBlendMode: "screen", opacity: baseOpacity }}
            >
              {Array.from({ length: count }).map((_, k) => {
                const rx = random(`bk-x-${f.seed}-${k}`) * 100;
                const ry0 = random(`bk-y-${f.seed}-${k}`) * 100;
                const size = 40 + random(`bk-s-${f.seed}-${k}`) * 140;
                const drift = progress * (10 + random(`bk-d-${f.seed}-${k}`) * 22);
                const ry = (ry0 - drift + 100) % 100;
                const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(currentTime * 2.4 + k));
                return (
                  <div
                    key={k}
                    style={{
                      position: "absolute",
                      left: `${rx}%`,
                      top: `${ry}%`,
                      width: size,
                      height: size,
                      borderRadius: "50%",
                      background: `radial-gradient(circle, ${f.color} 0%, ${f.color}55 35%, transparent 70%)`,
                      opacity: twinkle,
                      filter: "blur(2px)",
                    }}
                  />
                );
              })}
            </AbsoluteFill>
          );
        }

        if (f.kind === "glow") {
          const pulse = 0.6 + 0.4 * Math.sin(Math.PI * progress);
          return (
            <AbsoluteFill
              key={`${f.at}-${i}`}
              style={{
                pointerEvents: "none",
                mixBlendMode: "screen",
                opacity: baseOpacity * pulse,
                background: `radial-gradient(ellipse 90% 70% at 50% 45%, ${f.color}, transparent 70%)`,
              }}
            />
          );
        }

        // dust — partículas finas con ruido orgánico (noise2D) flotando.
        const count = Math.round(34 * f.intensity);
        return (
          <AbsoluteFill
            key={`${f.at}-${i}`}
            style={{ pointerEvents: "none", mixBlendMode: "screen", opacity: baseOpacity }}
          >
            {Array.from({ length: count }).map((_, k) => {
              const baseX = random(`d-x-${f.seed}-${k}`) * 100;
              const baseY = random(`d-y-${f.seed}-${k}`) * 100;
              const nx = noise2D(`d-nx-${f.seed}`, k, currentTime * 0.5) * 4;
              const ny = noise2D(`d-ny-${f.seed}`, k, currentTime * 0.5) * 4;
              const drift = (progress * 8) % 100;
              const size = 2 + random(`d-s-${f.seed}-${k}`) * 4;
              const tw = 0.2 + 0.8 * Math.abs(Math.sin(currentTime * 3 + k));
              return (
                <div
                  key={k}
                  style={{
                    position: "absolute",
                    left: `${(baseX + nx + 100) % 100}%`,
                    top: `${(baseY + ny - drift + 100) % 100}%`,
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    background: f.color,
                    opacity: tw,
                  }}
                />
              );
            })}
          </AbsoluteFill>
        );
      })}
    </>
  );
};

// ──────────────────────── ProTransitionLayer ────────────────────────────────

interface ProTransitionLayerProps {
  transitions: ProTransitionProps[];
  currentTime: number;
  fps: number;
}

/**
 * Transiciones estilo CapCut en los puntos de corte. Son overlays cortos
 * (6-12 frames) — no transforman el video base, así que no pisan la cámara/zoom
 * existentes. Pensadas para sincronizarse con un whoosh vía sfxMarks.
 */
export const ProTransitionLayer: React.FC<ProTransitionLayerProps> = ({
  transitions,
  currentTime,
  fps,
}) => {
  return (
    <>
      {transitions.map((tr, i) => {
        const dur = Math.max(2, tr.durationFrames);
        const elapsedFrames = (currentTime - tr.at) * fps;
        if (elapsedFrames < 0 || elapsedFrames > dur) return null;
        const t = clamp01(elapsedFrames / dur);

        if (tr.kind === "whip") {
          const slide = interpolate(t, [0, 1], [-120, 120]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                mixBlendMode: "screen",
                opacity: Math.sin(Math.PI * t) * 0.9,
                transform: `translateX(${slide}%)`,
                background: `linear-gradient(90deg, transparent 0%, ${tr.color} 50%, transparent 100%)`,
                filter: "blur(48px)",
              }}
            />
          );
        }

        if (tr.kind === "flip3d") {
          // El giro 3D real lo hace ViralVideo (rotateY con perspective); acá solo
          // un oscurecimiento con forma de campana que da profundidad al giro.
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                background: "#000",
                opacity: Math.sin(Math.PI * t) * 0.35,
              }}
            />
          );
        }

        if (tr.kind === "zoom_punch") {
          const r = interpolate(t, [0, 1], [0, 150]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                mixBlendMode: "screen",
                opacity: (1 - t) * 0.85,
                background: `radial-gradient(circle at 50% 50%, ${tr.color} 0%, transparent ${r}%)`,
              }}
            />
          );
        }

        if (tr.kind === "glitch") {
          // Bandas RGB horizontales que saltan — look datamosh, visible y aditivo.
          const mag = (1 - t) * 30;
          return (
            <AbsoluteFill key={`tr-${i}`} style={{ pointerEvents: "none", mixBlendMode: "screen" }}>
              {Array.from({ length: 5 }).map((_, k) => {
                const y = random(`g-y-${tr.at}-${k}`) * 90;
                const h = 4 + random(`g-h-${tr.at}-${k}`) * 16;
                const dir = k % 2 === 0 ? 1 : -1;
                const colors = ["#ff0040", "#00ffe0", "#fffb00"];
                return (
                  <div
                    key={k}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: `${y}%`,
                      height: `${h}%`,
                      transform: `translateX(${dir * mag}px)`,
                      background: colors[k % colors.length],
                      opacity: 0.5 * (1 - t),
                      filter: "blur(1px)",
                    }}
                  />
                );
              })}
            </AbsoluteFill>
          );
        }

        if (tr.kind === "reveal_lr") {
          // Wipe horizontal: panel de color que barre y "revela" (clip-path inset).
          const cut = interpolate(t, [0, 1], [0, 100]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                background: tr.color,
                clipPath: `inset(0 0 0 ${cut}%)`,
              }}
            />
          );
        }

        if (tr.kind === "reveal_ud") {
          const cut = interpolate(t, [0, 1], [0, 100]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                background: tr.color,
                clipPath: `inset(${cut}% 0 0 0)`,
              }}
            />
          );
        }

        if (tr.kind === "light_streak") {
          // Streak de luz diagonal que cruza la pantalla (look "anamorphic flare").
          const pos = interpolate(t, [0, 1], [-30, 130]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                mixBlendMode: "screen",
                opacity: Math.sin(Math.PI * t) * 0.9,
                background: `linear-gradient(115deg, transparent ${pos - 18}%, ${tr.color} ${pos}%, transparent ${pos + 18}%)`,
                filter: "blur(10px)",
              }}
            />
          );
        }

        if (tr.kind === "swipe_blur") {
          // Panel de color que barre de izquierda a derecha con bordes desenfocados.
          const cut = interpolate(t, [0, 1], [-10, 110]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                opacity: Math.sin(Math.PI * t),
                background: `linear-gradient(90deg, ${tr.color} 0%, ${tr.color} ${cut}%, transparent ${cut + 12}%)`,
                filter: "blur(6px)",
              }}
            />
          );
        }

        if (tr.kind === "iris") {
          // Iris circular que se cierra/abre desde el centro (clip-path circle).
          const r = interpolate(t, [0, 0.5, 1], [0, 80, 0]);
          return (
            <AbsoluteFill
              key={`tr-${i}`}
              style={{
                pointerEvents: "none",
                background: tr.color,
                clipPath: `circle(${100 - r}% at 50% 50%)`,
                opacity: 0.96,
              }}
            />
          );
        }

        // flash — destello blanco con decay rápido.
        return (
          <AbsoluteFill
            key={`tr-${i}`}
            style={{ pointerEvents: "none", background: tr.color, opacity: (1 - t) * 0.95 }}
          />
        );
      })}
    </>
  );
};

// ─────────────────────── KineticSubtitleLayer ───────────────────────────────

interface KineticSubtitleLayerProps {
  words: { word: string; start: number; end: number }[];
  currentTime: number;
  fps: number;
  preset: KineticPreset;
  fontFamily: string;
  color: string;
  highlight: string;
  /** F2 — "top" cuando la cara del speaker está abajo (auto-cómputo del tracking). */
  position?: "bottom" | "top";
}

/**
 * Tipografía cinética estilo CapCut. Misma lógica de selección de palabra que
 * SubtitleLayer (palabra activa visible hasta que arranca la siguiente), pero con
 * presets de entrada animada. ViralVideo monta ESTA capa en lugar de SubtitleLayer
 * solo cuando preset !== "none" (ver ViralVideo.tsx); con "none" usa la original.
 */
export const KineticSubtitleLayer: React.FC<KineticSubtitleLayerProps> = ({
  words,
  currentTime,
  fps,
  preset,
  fontFamily,
  color,
  highlight,
  position = "bottom",
}) => {
  // Posición vertical: abajo (default histórico) o arriba si la cara está abajo.
  const placementStyle =
    position === "top"
      ? ({ justifyContent: "flex-start", paddingTop: 280 } as const)
      : ({ justifyContent: "flex-end", paddingBottom: 320 } as const);
  // PERF: agrupar palabras en líneas + mapa palabra→línea SOLO cuando cambia `words`,
  // no en cada frame. Sin esto, KineticSubtitleLayer en modo "karaoke" hacía
  // groupWordsIntoLines + lines.find() cada frame (~360k iteraciones de más a 30fps × 60s).
  // "karaoke" y "pop_reels" comparten el motor de líneas (frase completa con la
  // palabra activa resaltada). pop_reels solo cambia el LOOK (caja + contorno).
  const isLineMode = preset === "karaoke" || preset === "pop_reels";
  const lines = useMemo(
    () => (isLineMode ? groupWordsIntoLines(words) : null),
    [words, isLineMode]
  );
  const wordToLine = useMemo(() => {
    const map: Record<number, number> = {};
    if (lines) {
      for (let li = 0; li < lines.length; li++) {
        for (const wi of lines[li]) map[wi] = li;
      }
    }
    return map;
  }, [lines]);

  let activeIndex = -1;
  for (let idx = 0; idx < words.length; idx++) {
    if (words[idx].start <= currentTime + 0.05) activeIndex = idx;
    else break;
  }
  if (activeIndex === -1) return null;

  // ── Modo KARAOKE / POP REELS 2026: línea completa con la palabra activa resaltada ──
  if (isLineMode) {
    // `lines` y `wordToLine` se memoizan a nivel componente (ver useMemo arriba),
    // así no se recalculan en CADA frame (~360k iteraciones menos a 30fps × 60s × 200 words).
    const line = (lines && lines[wordToLine[activeIndex] ?? 0]) ?? [activeIndex];
    const lineStart = words[line[0]].start;
    const lineEntry = currentTime - lineStart;
    const sLine = spring({
      frame: lineEntry * fps,
      fps,
      config: { damping: 14, stiffness: 120, mass: 0.6 },
    });
    const lineOpacity = clamp01(lineEntry / 0.12);
    const lineY = (1 - sLine) * 40;

    // POP REELS 2026 — look nativo de TikTok: caja negra semi-opaca + contorno
    // grueso en cada palabra + la activa resaltada con caja del color highlight.
    // Reusa EXACTAMENTE el motor de palabra activa de karaoke; solo cambia el CSS.
    const popReels = preset === "pop_reels";

    // Contorno grueso vía text-shadow multi-dirección (el "stroke" de TikTok).
    // Constante → se construye una vez por frame, no por palabra dentro del map.
    const stroke =
      "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, " +
      "0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000";

    // CONTORNO MEDIDO para el preset `pop`, que es el que usan los estilos hype.
    // Esa rama se sostenía SOLO con `drop-shadow` — resplandores difuminados, sin
    // borde duro: aprueba sobre metraje oscuro y suspende sobre fondo claro.
    // Mismo criterio que subtitle-layer.tsx: 0.085 de la altura de mayúscula
    // hacia AFUERA; `-webkit-text-stroke` dibuja centrado, así que se pide el
    // doble, y `paintOrder: "stroke fill"` repinta el relleno encima para que el
    // contorno no se coma la letra.
    const fontSizePop = popReels ? 88 : 96;
    const contornoPop = `${Math.max(2, Math.round(fontSizePop * 0.151))}px #000000`;

    return (
      <AbsoluteFill
        style={{
          ...placementStyle,
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: popReels ? "0.18em" : "0.28em",
            maxWidth: 980,
            padding: popReels ? "18px 30px" : "0 50px",
            opacity: lineOpacity,
            transform: `translateY(${lineY}px)`,
            fontFamily,
            fontSize: popReels ? 88 : 96,
            fontWeight: popReels ? 900 : 800,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            lineHeight: popReels ? 1.12 : 1.05,
            textAlign: "center",
            // La caja negra semi-opaca detrás de toda la línea (estilo TikTok nativo).
            ...(popReels
              ? {
                  background: "rgba(0,0,0,0.62)",
                  borderRadius: 18,
                  boxShadow: "0 8px 30px rgba(0,0,0,0.55)",
                }
              : {}),
          }}
        >
          {line.map((j) => {
            const isActive = j === activeIndex;
            // Relleno progresivo (karaoke real): las palabras YA dichas se quedan
            // resaltadas (highlight), la activa con pop+glow, las que faltan atenuadas.
            const spoken = words[j].start <= currentTime + 0.05;

            if (popReels) {
              // La palabra activa va dentro de una píldora del color highlight; el
              // contorno (stroke) se hoisteó fuera del map (constante por frame).
              return (
                <span
                  key={j}
                  style={{
                    color: isActive ? "#0a0a0a" : "#ffffff",
                    opacity: spoken || isActive ? 1 : 0.85,
                    transform: isActive ? "scale(1.06)" : "scale(1)",
                    display: "inline-block",
                    transformOrigin: "center bottom",
                    padding: isActive ? "2px 14px" : "2px 4px",
                    borderRadius: 12,
                    background: isActive ? highlight || "#34d399" : "transparent",
                    boxShadow: isActive
                      ? `0 4px 18px ${highlight || "#34d399"}aa`
                      : "none",
                    // El contorno solo aplica al texto blanco; en la activa la
                    // píldora ya da contraste, así que el stroke se atenúa.
                    textShadow: isActive ? "0 2px 6px rgba(0,0,0,0.45)" : stroke,
                  }}
                >
                  {words[j].word}
                </span>
              );
            }

            return (
              <span
                key={j}
                style={{
                  color: spoken ? highlight || color : color,
                  opacity: spoken ? 1 : 0.5,
                  transform: isActive ? "scale(1.1)" : "scale(1)",
                  display: "inline-block",
                  transformOrigin: "center bottom",
                  WebkitTextStroke: contornoPop,
                  paintOrder: "stroke fill" as const,
                  filter: isActive
                    ? `drop-shadow(0 0 26px ${highlight}) drop-shadow(0 4px 16px rgba(0,0,0,0.95))`
                    : spoken
                    ? `drop-shadow(0 0 12px ${highlight}aa) drop-shadow(0 3px 14px rgba(0,0,0,0.9))`
                    : `drop-shadow(0 3px 14px rgba(0,0,0,0.9))`,
                }}
              >
                {words[j].word}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  const word = words[activeIndex];
  const next = words[activeIndex + 1];
  const startsAt = word.start;
  // Clamp anti-"subtítulo invisible": si el timestamp de la palabra siguiente es
  // degenerado (next.start <= word.start), no dejar que endsAt colapse antes de
  // startsAt → garantiza la regla "subtítulos siempre visibles".
  const endsAt = Math.max(
    startsAt + 0.05,
    next ? next.start - 0.04 : word.end + 1.5
  );
  if (currentTime > endsAt + 0.1) return null;

  const elapsed = currentTime - startsAt;
  const remaining = endsAt - currentTime;
  const fadeIn = clamp01(elapsed / 0.08);
  const fadeOut = clamp01(remaining / 0.06);
  let opacity = Math.min(fadeIn, fadeOut);

  const entryFrame = elapsed * fps;
  const s = spring({ frame: entryFrame, fps, config: { damping: 12, stiffness: 130, mass: 0.6 } });

  let transform = "scale(1)";
  let filter: string | undefined = `drop-shadow(0 4px 22px rgba(0,0,0,0.95))`;
  let text = word.word;

  switch (preset) {
    case "pop": {
      const sc = interpolate(s, [0, 1], [0.4, 1]);
      transform = `scale(${sc})`;
      filter = `drop-shadow(0 0 26px ${highlight}) drop-shadow(0 4px 18px rgba(0,0,0,0.95))`;
      break;
    }
    case "slide_up": {
      const ty = (1 - s) * 80;
      transform = `translateY(${ty}px)`;
      break;
    }
    case "type_on": {
      const shown = Math.max(1, Math.round(clamp01(elapsed / 0.28) * word.word.length));
      text = word.word.slice(0, shown);
      break;
    }
    case "bounce": {
      const ty = (1 - s) * 70;
      const rot = (1 - s) * -8;
      transform = `translateY(${ty}px) rotate(${rot}deg)`;
      filter = `drop-shadow(0 0 22px ${highlight}) drop-shadow(0 6px 20px rgba(0,0,0,0.95))`;
      break;
    }
    case "glow_pulse": {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 8);
      const sc = interpolate(s, [0, 1], [0.85, 1]);
      transform = `scale(${sc})`;
      filter = `drop-shadow(0 0 ${20 + pulse * 30}px ${highlight}) drop-shadow(0 4px 18px rgba(0,0,0,0.95))`;
      break;
    }
    default:
      break;
  }

  // En type_on el cursor aún no terminó → mantener opacidad alta durante el typing.
  if (preset === "type_on") opacity = Math.min(1, Math.max(opacity, fadeOut));

  return (
    <AbsoluteFill
      style={{
        ...placementStyle,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize: 112,
          fontWeight: 800,
          color: highlight || color,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          lineHeight: 1.0,
          textAlign: "center",
          maxWidth: 980,
          padding: "0 50px",
          whiteSpace: "nowrap",
          // CONTORNO MEDIDO. Esta rama —la de palabra suelta, que usan los
          // presets `pop`, `bounce`, `type_on`…— se sostenía SOLO con el
          // `drop-shadow` de `filter`: resplandor difuminado, sin borde duro.
          // Aprueba sobre metraje oscuro y suspende sobre fondo claro, que es
          // justo lo que rompe la regla "subtítulos siempre visibles".
          // 0.085 de la altura de mayúscula hacia AFUERA; el trazo se dibuja
          // centrado, así que se pide el doble, y `paintOrder` repinta el
          // relleno encima para que el contorno no se coma la letra.
          WebkitTextStroke: `${Math.round(112 * 0.151)}px #000000`,
          paintOrder: "stroke fill" as const,
          opacity,
          transform,
          transformOrigin: "center center",
          filter,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
