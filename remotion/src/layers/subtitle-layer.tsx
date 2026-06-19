import { AbsoluteFill, spring } from "remotion";
import type { Word } from "../schemas";

/**
 * Subtítulo "palabra a palabra": muestra SOLO la palabra activa (la última que ya
 * empezó) hasta que arranque la siguiente. Soporta tres estilos visuales:
 *   - bebas    → bold caps amarillo/highlight (default viral)
 *   - anton    → idéntico al bebas pero con la fuente Anton
 *   - cinematic → blanco puro, letter-spacing wide, glow triple del highlight,
 *                 spring de entrada — feeling de cine
 *
 * `colorRotation` cicla un color distinto por palabra; sin él se usa el `highlight`.
 */
export const SubtitleLayer: React.FC<{
  words: Word[];
  currentTime: number;
  fps: number;
  fontFamily: string;
  color: string;
  highlight: string;
  colorRotation?: string[];
  bounce?: boolean;
  subtitleStyle?: "bebas" | "anton" | "cinematic";
  /** F2 — "top" cuando la cara del speaker está abajo (auto-cómputo del tracking). */
  position?: "bottom" | "top";
}> = ({
  words,
  currentTime,
  fps,
  fontFamily,
  color,
  highlight,
  colorRotation = [],
  bounce = false,
  subtitleStyle = "bebas",
  position = "bottom",
}) => {
  let activeIndex = -1;
  for (let idx = 0; idx < words.length; idx++) {
    if (words[idx].start <= currentTime + 0.05) activeIndex = idx;
    else break;
  }
  if (activeIndex === -1) return null;

  const word = words[activeIndex];
  const next = words[activeIndex + 1];
  const startsAt = word.start;
  // Clamp anti-"subtítulo invisible": timestamps degenerados (next.start <=
  // word.start) no deben colapsar endsAt por debajo de startsAt. Garantiza la
  // regla "subtítulos siempre visibles".
  const endsAt = Math.max(
    startsAt + 0.05,
    next ? next.start - 0.04 : word.end + 1.5
  );
  if (currentTime > endsAt + 0.1) return null;

  const elapsed = currentTime - startsAt;
  const remaining = endsAt - currentTime;
  const fadeIn = Math.min(1, Math.max(0, elapsed / 0.08));
  const fadeOut = Math.min(1, Math.max(0, remaining / 0.06));
  const opacity = Math.min(fadeIn, fadeOut);

  // Bounce opcional: pop scale (1.08 → 1.0) en los primeros 0.18s.
  let scale = 1;
  if (bounce && elapsed < 0.18) {
    const t = elapsed / 0.18;
    scale = 1 + 0.08 * Math.sin(Math.PI * t);
  }

  const wordColor =
    colorRotation.length > 0
      ? colorRotation[activeIndex % colorRotation.length]
      : highlight;
  // `color` queda reservado para una versión futura con subtítulos no-activos.
  void color;

  const isCinematic = subtitleStyle === "cinematic";
  const entryFrame = elapsed * fps;
  const entrySpring = isCinematic
    ? spring({
        frame: entryFrame,
        fps,
        config: { damping: 14, stiffness: 110, mass: 0.7 },
      })
    : 1;
  const cinematicScale = isCinematic ? 0.88 + entrySpring * 0.12 : 1;
  const cinematicTranslateY = isCinematic ? (1 - entrySpring) * 28 : 0;
  const cinematicGlow = isCinematic
    ? `drop-shadow(0 0 40px ${highlight}) drop-shadow(0 0 20px ${highlight}cc) drop-shadow(0 0 8px rgba(0,0,0,1)) drop-shadow(0 5px 30px rgba(0,0,0,1))`
    : undefined;

  return (
    <AbsoluteFill
      style={{
        ...(position === "top"
          ? { justifyContent: "flex-start" as const, paddingTop: isCinematic ? 200 : 280 }
          : { justifyContent: "flex-end" as const, paddingBottom: isCinematic ? 220 : 320 }),
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize: isCinematic ? 96 : 110,
          fontWeight: isCinematic ? 700 : 800,
          color: isCinematic ? "#ffffff" : wordColor,
          textTransform: isCinematic ? "none" : "uppercase",
          letterSpacing: isCinematic ? "0.22em" : "0.02em",
          lineHeight: 1.0,
          textAlign: "center",
          maxWidth: 980,
          padding: "0 50px",
          whiteSpace: "nowrap",
          textShadow: isCinematic
            ? "0 2px 14px rgba(0,0,0,0.85)"
            : "0 4px 22px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.9)",
          filter: cinematicGlow,
          opacity,
          transform: isCinematic
            ? `scale(${cinematicScale * scale}) translateY(${cinematicTranslateY}px)`
            : `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {word.word}
      </div>
    </AbsoluteFill>
  );
};
