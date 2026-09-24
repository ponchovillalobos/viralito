/**
 * Destellos de luz de lente (light leak) en momentos puntuales — el drop de la
 * música, el arranque del hook. Es el efecto `lightLeak` de @remotion/effects
 * (4.0.527, mismo pineo que el resto), el primero de ese paquete que usa Viralito.
 *
 * CÓMO. Los efectos de @remotion/effects sólo se aplican a <Img>, <CanvasImage> y
 * <HtmlInCanvas>, no a <OffthreadVideo>. En vez de pasar el video por un canvas
 * (caro, y cambia cómo se decodifica), esta capa pinta el destello sobre un fondo
 * NEGRO y se compone encima con `mix-blend-mode: screen`: el negro no suma nada y
 * sólo la luz aclara el cuadro. El video debajo no se toca.
 *
 * MONO-COLOR. El destello de fábrica es cálido (naranja). `hueShift` lo gira hacia
 * el matiz del acento del video, así la luz es del mismo color que todo lo demás.
 */
import React from "react";
import { AbsoluteFill, HtmlInCanvas, interpolate, useVideoConfig } from "remotion";
import { lightLeak } from "@remotion/effects";
import { z } from "zod";

export const lightLeakSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.2),
  seed: z.number().default(0),
  /** Color al que se tiñe la luz (normalmente el accentColor del video). */
  color: z.string().default("#fb923c"),
  /** Opacidad máxima del destello, 0-1. */
  intensity: z.number().default(0.6),
});
export type LightLeak = z.infer<typeof lightLeakSchema>;

/** Matiz (0-360) de un color #rrggbb. */
function matiz(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 30;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 30;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** El destello de fábrica ronda el naranja (~30°): se gira hasta el acento. */
const MATIZ_BASE = 30;

export const LightLeakLayer: React.FC<{ leaks: LightLeak[]; currentTime: number }> = ({
  leaks,
  currentTime,
}) => {
  const { width, height } = useVideoConfig();
  // Los props llegan sin pasar por Zod (el schema es sólo para validar en Studio),
  // así que los defaults se aplican aquí también.
  const lista = leaks.map((l) => ({
    ...l,
    duration: l.duration ?? 1.2,
    seed: l.seed ?? 0,
    color: l.color ?? "#fb923c",
    intensity: l.intensity ?? 0.6,
  }));
  const activo = lista.find((l) => currentTime >= l.at && currentTime <= l.at + l.duration);
  if (!activo) return null;
  const p = (currentTime - activo.at) / activo.duration;
  // Entra rápido, se va lento: la luz "pega" en el golpe y se desvanece.
  const opacidad = interpolate(p, [0, 0.15, 1], [0, activo.intensity, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // El shader gira el matiz en sentido contrario al que dice el nombre: medido con
  // un acento violeta (258°), sumar el giro dio verde azulado. Restarlo da el acento.
  const giro = (MATIZ_BASE - matiz(activo.color) + 720) % 360;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity: opacidad, pointerEvents: "none" }}>
      <HtmlInCanvas
        width={width}
        height={height}
        effects={[lightLeak({ seed: activo.seed, progress: p, hueShift: giro })]}
      >
        <AbsoluteFill style={{ backgroundColor: "#000" }} />
      </HtmlInCanvas>
    </AbsoluteFill>
  );
};
