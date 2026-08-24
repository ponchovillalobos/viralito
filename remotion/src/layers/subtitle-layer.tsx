import { AbsoluteFill, spring, useVideoConfig } from "remotion";
import type { Word } from "../schemas";

/** Lienzo de referencia con el que se calibraron los tamaños fijos (9:16). */
const REF_W = 1080;
const REF_H = 1920;

// ── CONTORNO DEL RÓTULO (medido) ──────────────────────────────────────────────
// El path viral (bebas/anton) se sostenía SOLO con `textShadow`. Una sombra
// difuminada no da borde: aprueba sobre metraje oscuro y suspende sobre fondo
// claro. Medido sobre tres renders de este mismo composition (1080×1920, la
// palabra "LEVANTAR", frame 18), contrastando el relleno del glifo contra el
// anillo de 6 px que lo rodea, con el criterio WCAG:
//
//        fondo        antes (solo sombra)     después (contorno + sombra)
//        negro                 21.00 : 1                    21.00 : 1
//        amarillo               5.48 : 1                    21.00 : 1
//        blanco                 4.00 : 1                    21.00 : 1   ← PEOR
//
// 4.00:1 sobre blanco no llega ni al mínimo AA de WCAG (4.5) y rompe la regla
// dura del proyecto: "subtítulos SIEMPRE visibles".
//
// GROSOR_CAP es 0.085 de la altura de mayúscula, hacia AFUERA.
// `-webkit-text-stroke` dibuja centrado, así que se pide el doble;
// `paintOrder: "stroke fill"` repinta el relleno encima para que el contorno no
// se coma la letra. CAP_POR_EM se midió en el render: 98 px de mayúscula con
// `fontSize` 110.
const GROSOR_CAP = 0.085;
const CAP_POR_EM = 0.89;
const CONTORNO_POR_EM = 2 * GROSOR_CAP * CAP_POR_EM; // ≈ 0.151

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
  // Entrada con SPRING (motion orgánico) también para bebas/anton, no solo cinematic:
  // un pop suave (0.9→1) + leve subida, en vez del corte lineal seco. NO toca la
  // opacidad (el fade in/out por palabra sigue igual → "subtítulos siempre visibles").
  const entrySpring = spring({
    frame: entryFrame,
    fps,
    config: isCinematic
      ? { damping: 14, stiffness: 110, mass: 0.7 }
      : { damping: 12, stiffness: 200, mass: 0.6 },
  });
  const cinematicScale = isCinematic ? 0.88 + entrySpring * 0.12 : 1;
  const cinematicTranslateY = isCinematic ? (1 - entrySpring) * 28 : 0;
  // Pop sutil para el path viral (bebas/anton). Se combina con `bounce` si está.
  const popScale = isCinematic ? 1 : 0.9 + entrySpring * 0.1;
  const popTranslateY = isCinematic ? 0 : (1 - entrySpring) * 12;
  const cinematicGlow = isCinematic
    ? `drop-shadow(0 0 40px ${highlight}) drop-shadow(0 0 20px ${highlight}cc) drop-shadow(0 0 8px rgba(0,0,0,1)) drop-shadow(0 5px 30px rgba(0,0,0,1))`
    : undefined;

  // ── RESPONSIVE (auditoría 2026-07-20) ──────────────────────────────────────
  // Todos los tamaños de acá estaban en px FIJOS calibrados a 1080×1920. En una
  // salida 16:9 (1920×1080) el `paddingBottom: 320` es el 30% del alto en vez del
  // 17%, así que el subtítulo caía en MITAD DEL CUADRO, encima de las caras
  // (verificado con un render). Se escalan contra el lienzo de referencia:
  //   · lo VERTICAL (fuente y padding) por alto  → mantiene el ritmo vertical
  //   · lo HORIZONTAL (maxWidth y padding lateral) por ancho
  // En 9:16 ambos factores valen exactamente 1 → el render vertical NO cambia.
  const { width: compW, height: compH } = useVideoConfig();
  const sV = compH / REF_H;
  const sH = compW / REF_W;

  const baseFont = isCinematic ? 96 : 110;
  const maxWidth = Math.round(980 * sH);
  // AUTO-FIT: una palabra larga ("responsabilidad", "extraordinariamente") con
  // `whiteSpace: nowrap` y sin techo se salía del lienzo. Se estima el ancho y se
  // encoge sólo si hace falta — con las palabras normales no se activa, así que
  // los videos que hoy se ven bien quedan igual. Mismo enfoque que
  // word-sticker-layer.tsx, que ya hacía auto-fit por ancho.
  const CHAR_FACTOR = 0.5; // Bebas/Anton son condensadas
  const fitFont = maxWidth / Math.max(1, word.word.length * CHAR_FACTOR);
  const fontSize = Math.round(Math.min(baseFont * sV, Math.max(28, fitFont)));

  return (
    <AbsoluteFill
      style={{
        ...(position === "top"
          ? {
              justifyContent: "flex-start" as const,
              paddingTop: Math.round((isCinematic ? 200 : 280) * sV),
            }
          : {
              justifyContent: "flex-end" as const,
              paddingBottom: Math.round((isCinematic ? 220 : 320) * sV),
            }),
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize,
          fontWeight: isCinematic ? 700 : 800,
          color: isCinematic ? "#ffffff" : wordColor,
          textTransform: isCinematic ? "none" : "uppercase",
          letterSpacing: isCinematic ? "0.22em" : "0.02em",
          lineHeight: 1.0,
          textAlign: "center",
          maxWidth,
          padding: `0 ${Math.round(50 * sH)}px`,
          whiteSpace: "nowrap",
          // El contorno va SOLO en el path viral. `cinematic` conserva su
          // tratamiento (letra suelta + glow triple) porque es otro idioma
          // tipográfico y su contraste no se midió aquí.
          ...(isCinematic
            ? {}
            : {
                WebkitTextStroke: `${Math.max(2, Math.round(fontSize * CONTORNO_POR_EM))}px #000000`,
                paintOrder: "stroke fill" as const,
              }),
          textShadow: isCinematic
            ? "0 2px 14px rgba(0,0,0,0.85)"
            : "0 4px 22px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.9)",
          filter: cinematicGlow,
          opacity,
          transform: isCinematic
            ? `scale(${cinematicScale * scale}) translateY(${cinematicTranslateY}px)`
            : `scale(${scale * popScale}) translateY(${popTranslateY}px)`,
          transformOrigin: "center center",
        }}
      >
        {word.word}
      </div>
    </AbsoluteFill>
  );
};
