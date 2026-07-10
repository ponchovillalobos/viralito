import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

/**
 * STAT POP (F2.c) — cifra grande que ENTRA con spring cronometrada a la palabra
 * hablada (word-level). Si el valor es numérico, cuenta hacia arriba (0→N). Refuerza
 * los datos que el hablante menciona ("8 segundos", "3x", "50%").
 *
 * Reglas: mono-color (usa el `accent` único). Se monta arriba-centro (como los
 * stickers), por ENCIMA de la banda de subtítulos → no la tapa. Opt-in: [] = idéntico.
 */
export const statPopSchema = z.object({
  at: z.number(),
  duration: z.number().default(2.2),
  /** Valor a mostrar: "8", "3x", "50%", "$1.2M"… El número se cuenta si es simple. */
  value: z.string(),
  /** Etiqueta chica opcional debajo ("segundos", "más rápido"). */
  label: z.string().default(""),
});
export type StatPop = z.infer<typeof statPopSchema>;

/** Extrae [prefijo, número, sufijo] de un valor tipo "$1.2M" / "50%" / "3x". */
function splitValue(v: string): { pre: string; num: number | null; suf: string } {
  const m = /^([^\d.-]*)(-?\d+(?:\.\d+)?)(.*)$/.exec(v.trim());
  if (!m) return { pre: v, num: null, suf: "" };
  return { pre: m[1], num: parseFloat(m[2]), suf: m[3] };
}

export const StatPopLayer: React.FC<{
  pop: StatPop;
  currentTime: number;
  accent: string;
}> = ({ pop, currentTime, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = currentTime - pop.at;
  if (elapsed < -0.02 || elapsed > pop.duration + 0.3) return null;

  const entryFrame = elapsed * fps;
  const s = spring({ frame: entryFrame, fps, config: { damping: 12, stiffness: 200, mass: 0.7 } });
  const outT = Math.max(0, (elapsed - pop.duration) / 0.3);
  const opacity = Math.min(1, s * 1.2) * (1 - outT);
  const scale = 0.7 + s * 0.3;

  const { pre, num, suf } = splitValue(pop.value);
  // Conteo perceptual del número (si es simple) durante los primeros 0.6s.
  const countP = interpolate(elapsed, [0, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shown =
    num === null
      ? pop.value
      : `${pre}${Number.isInteger(num) ? Math.round(num * countP) : (num * countP).toFixed(1)}${suf}`;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-start",
        alignItems: "center",
        paddingTop: 150,
        pointerEvents: "none",
      }}
    >
      <div style={{ opacity, transform: `scale(${scale})`, textAlign: "center" }}>
        <div
          style={{
            fontFamily: "Anton, Impact, sans-serif",
            fontSize: 190,
            lineHeight: 0.9,
            color: accent,
            textShadow: "0 6px 30px rgba(0,0,0,0.9)",
            WebkitTextStroke: "2px rgba(0,0,0,0.35)",
          }}
        >
          {shown}
        </div>
        {pop.label && (
          <div
            style={{
              fontFamily: "Anton, Impact, sans-serif",
              fontSize: 46,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#ffffff",
              textShadow: "0 3px 16px rgba(0,0,0,0.9)",
              marginTop: 6,
            }}
          >
            {pop.label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
