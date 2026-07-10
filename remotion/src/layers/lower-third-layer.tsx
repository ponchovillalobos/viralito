import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";

/**
 * LOWER-THIRD (F2.c) — banda de nombre/cargo que entra con slide + spring. Ideal para
 * presentar a quien habla ("Poncho Robles · Estratega viral"). Se ubica en una banda
 * ~70% de la altura: ARRIBA de la banda de subtítulos (abajo) → nunca la tapa.
 *
 * Reglas: la barra de acento usa el color mono único. Opt-in: [] = render idéntico.
 */
export const lowerThirdSchema = z.object({
  at: z.number(),
  duration: z.number().default(3.2),
  name: z.string(),
  role: z.string().default(""),
});
export type LowerThird = z.infer<typeof lowerThirdSchema>;

export const LowerThirdLayer: React.FC<{
  item: LowerThird;
  currentTime: number;
  accent: string;
}> = ({ item, currentTime, accent }) => {
  const frame = useCurrentFrame();
  const { fps, height: H, width: W } = useVideoConfig();
  const elapsed = currentTime - item.at;
  if (elapsed < -0.02 || elapsed > item.duration + 0.4) return null;

  const entryFrame = elapsed * fps;
  const sIn = spring({ frame: entryFrame, fps, config: { damping: 18, stiffness: 160, mass: 0.8 } });
  const outT = Math.max(0, (elapsed - item.duration) / 0.4);
  const opacity = Math.min(1, sIn * 1.3) * (1 - outT);
  const x = (1 - sIn) * -40; // entra deslizando desde la izquierda

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: H * 0.7,
          left: W * 0.06,
          transform: `translateX(${x}px)`,
          opacity,
          display: "flex",
          alignItems: "stretch",
          gap: 0,
        }}
      >
        {/* barra de acento mono-color */}
        <div style={{ width: 8, background: accent, borderRadius: 2 }} />
        <div
          style={{
            background: "rgba(10,10,12,0.82)",
            backdropFilter: "blur(4px)",
            padding: "14px 26px",
            borderRadius: "0 8px 8px 0",
          }}
        >
          <div
            style={{
              fontFamily: "Anton, Impact, sans-serif",
              fontSize: 52,
              lineHeight: 1.0,
              color: "#ffffff",
              letterSpacing: "0.01em",
            }}
          >
            {item.name}
          </div>
          {item.role && (
            <div
              style={{
                fontFamily: "Anton, Impact, sans-serif",
                fontSize: 30,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: accent,
                marginTop: 4,
              }}
            >
              {item.role}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
