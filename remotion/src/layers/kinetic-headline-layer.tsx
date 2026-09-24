import { AbsoluteFill, interpolate, random, spring } from "remotion";
import type { KineticHeadline } from "../schemas";

/**
 * MODO GRÁFICOS & MOTION — Titular "poderoso" animado.
 * 6 efectos, todos animados por currentTime (SVG/CSS, sin deps pesadas):
 *  split_letters · glitch · shimmer · draw_on · gradient_sweep · tracking_in
 * Aparece en [at, at+duration]. Aditivo: si no hay headlines, no renderiza nada.
 */
export const KineticHeadlineLayer: React.FC<{
  config: KineticHeadline;
  currentTime: number;
  fps: number;
  fontFamily: string;
}> = ({ config, currentTime, fps, fontFamily }) => {
  if (currentTime < config.at || currentTime > config.at + config.duration) {
    return null;
  }
  const elapsed = currentTime - config.at;
  const frame = elapsed * fps;
  // Envelope global: fade-in 0.18s, fade-out 0.3s.
  const fadeIn = Math.min(1, elapsed / 0.18);
  const fadeOut = Math.min(1, (config.duration - elapsed) / 0.3);
  const envelope = Math.max(0, Math.min(fadeIn, fadeOut));

  const justify =
    config.position === "top"
      ? "flex-start"
      : config.position === "bottom"
        ? "flex-end"
        : "center";

  const baseStyle: React.CSSProperties = {
    fontFamily,
    fontSize: config.size,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.01em",
    lineHeight: 1.02,
    textAlign: "center",
    maxWidth: "86%",
    padding: config.position === "center" ? "0" : "90px 40px",
  };

  return (
    <AbsoluteFill
      style={{
        justifyContent: justify,
        alignItems: "center",
        pointerEvents: "none",
        opacity: envelope,
      }}
    >
      {renderEffect(config, frame, fps, baseStyle)}
    </AbsoluteFill>
  );
};

function renderEffect(
  config: KineticHeadline,
  frame: number,
  fps: number,
  base: React.CSSProperties,
): React.ReactNode {
  const { text, effect, color, accent, size } = config;

  if (effect === "split_letters") {
    const letters = text.split("");
    return (
      <div style={{ ...base, color, display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
        {letters.map((ch, i) => {
          const s = spring({
            frame: frame - i * 2,
            fps,
            config: { damping: 12, stiffness: 180, mass: 0.6 },
          });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - s) * 64}px) scale(${0.6 + s * 0.4})`,
                opacity: s,
                whiteSpace: "pre",
                textShadow: `0 0 40px ${accent}66`,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
    );
  }

  if (effect === "glitch") {
    // Magnitud de desalineación que decae con el tiempo (datamosh que se "asienta").
    const decay = interpolate(frame, [0, fps * 1.2], [1, 0.18], {
      extrapolateRight: "clamp",
    });
    const jx = (random(`gx${Math.floor(frame / 2)}`) - 0.5) * 24 * decay;
    const jy = (random(`gy${Math.floor(frame / 2)}`) - 0.5) * 10 * decay;
    const layer = (c: string, dx: number, dy: number, blend: string): React.CSSProperties => ({
      ...base,
      position: "absolute",
      inset: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "inherit",
      color: c,
      transform: `translate(${dx}px, ${dy}px)`,
      mixBlendMode: blend as React.CSSProperties["mixBlendMode"],
    });
    return (
      <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
        {/* Las copias desalineadas son el acento en dos tonos (claro y oscuro), no
            magenta y cian fijos: la regla es un solo color por video. */}
        <div style={layer(`${accent}cc`, jx - 6 * decay, jy, "screen")}>{text}</div>
        <div style={layer(`${accent}66`, -jx + 6 * decay, -jy, "multiply")}>{text}</div>
        <div style={{ ...base, color, position: "relative", textShadow: `0 0 36px ${accent}55` }}>
          {text}
        </div>
      </div>
    );
  }

  if (effect === "shimmer") {
    // Texto sólido (siempre visible) + banda de brillo que barre, revelada con una
    // máscara en movimiento. NO usa background-clip:text (no renderiza en el compositor).
    const pos = interpolate(frame, [0, fps * 1.6], [-20, 120], { extrapolateRight: "clamp" });
    const band = `linear-gradient(110deg, transparent ${pos - 16}%, rgba(255,255,255,0.95) ${pos}%, transparent ${pos + 16}%)`;
    return (
      <div style={{ position: "relative", display: "inline-block" }}>
        <div style={{ ...base, color, textShadow: `0 0 36px ${accent}44` }}>{text}</div>
        <div
          style={{
            ...base,
            position: "absolute",
            inset: 0,
            color: accent,
            WebkitMaskImage: band,
            maskImage: band,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  if (effect === "draw_on") {
    // Contorno SVG que se "dibuja" (stroke-dashoffset) y luego se rellena.
    const draw = interpolate(frame, [0, fps * 1.1], [1, 0], {
      extrapolateRight: "clamp",
    });
    const fill = interpolate(frame, [fps * 0.9, fps * 1.5], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <svg width="100%" height={size * 1.6} viewBox="0 0 1000 200" preserveAspectRatio="xMidYMid meet">
        <text
          x="500"
          y="135"
          textAnchor="middle"
          style={{
            fontFamily: base.fontFamily as string,
            fontSize: 150,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "2px",
          }}
          fill={color}
          fillOpacity={fill}
          stroke={accent}
          strokeWidth={3}
          // pathLength normaliza el contorno a 1 para el dash uniforme.
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={draw}
        >
          {text}
        </text>
      </svg>
    );
  }

  if (effect === "gradient_sweep") {
    // Wipe de color: base en `color`, capa `accent` revelada por una máscara que barre
    // de izquierda a derecha. Robusto en el compositor (máscara, no background-clip).
    const pos = interpolate(frame, [0, fps * 1.4], [-10, 110], { extrapolateRight: "clamp" });
    const wipe = `linear-gradient(90deg, white ${pos - 12}%, transparent ${pos + 12}%)`;
    return (
      <div style={{ position: "relative", display: "inline-block" }}>
        <div style={{ ...base, color }}>{text}</div>
        <div
          style={{
            ...base,
            position: "absolute",
            inset: 0,
            color: accent,
            WebkitMaskImage: wipe,
            maskImage: wipe,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            filter: `drop-shadow(0 6px 24px ${accent}44)`,
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  // tracking_in: entra estirado a lo ancho y se asienta. Antes animaba
  // letter-spacing y blur, y las dos cosas re-maquetan la línea en cada frame (el
  // texto saltaba de renglón mientras entraba). Ahora sólo transform + opacidad.
  const t = interpolate(frame, [0, fps * 0.6], [0, 1], { extrapolateRight: "clamp" });
  const ease = 1 - Math.pow(1 - t, 3);
  return (
    <div
      style={{
        ...base,
        color,
        transform: `scaleX(${interpolate(ease, [0, 1], [1.35, 1])}) translateY(${(1 - ease) * 18}px)`,
        opacity: t,
        textShadow: `0 0 50px ${accent}55`,
      }}
    >
      {text}
    </div>
  );
}
