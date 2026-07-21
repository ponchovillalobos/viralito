import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
// IMPORT DIRECTO del componente <Lottie> de Remotion. Es el que sincroniza la animación
// con el frame determinista del render (useCurrentFrame). El lazy-load (React.lazy +
// Suspense) rompía la animación: el frame se capturaba antes de que el chunk montara, así
// que las animaciones salían estáticas/en blanco. Bundle un poco más pesado, pero ANIMA.
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import type { LottieSticker } from "../schemas";

/**
 * Lottie REMOTO: carga el JSON de animación por URL (las ilustraciones animadas
 * de Noto viven en {DATA_ROOT}/assets/lottie/noto y se sirven por
 * /api/lottie/stream). delayRender pausa el frame hasta que el JSON llegó.
 */
export const RemoteLottie: React.FC<{ src: string; loop?: boolean }> = ({
  src,
  loop = true,
}) => {
  const [data, setData] = useState<LottieAnimationData | null>(null);
  const [handle] = useState(() => delayRender(`lottie remoto: ${src}`));
  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`lottie ${r.status}: ${src}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setData(d as LottieAnimationData);
        continueRender(handle);
      })
      .catch((e) => {
        // ⚠️ NO `cancelRender` — auditoría 2026-07-20. Un sticker Lottie es
        // DECORATIVO: si `/api/lottie/stream` no responde o falta el archivo, antes
        // se caía el CLIP ENTERO (misma clase de fragilidad que el bug de fuentes).
        // Ahora se omite el sticker y el video sale igual. `continueRender` es
        // obligatorio: sin él la delayRender queda colgada y Remotion aborta a los 58s.
        console.warn(`[lottie] sticker omitido (${src}): ${String(e)}`);
        if (!cancelled) continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
  }, [src, handle]);
  if (!data) return null;
  return <Lottie animationData={data} loop={loop} />;
};
import pulseRing from "../lottie/pulse-ring.json";
import sparkle from "../lottie/sparkle.json";
import arrowDown from "../lottie/arrow-down.json";
import star5 from "../lottie/star5.json";

/**
 * B4 — Sticker ANIMADO (Lottie). A diferencia de los emojis estáticos, esta capa monta
 * una animación vectorial en loop (pulse ring tipo radar, o un destello/sparkle). Las
 * formas base son blancas; se tiñen con un glow del color del estilo para integrarse.
 *
 * El padre (ViralVideo) ya filtra por ventana [at, at+duration]; acá sólo hacemos el
 * fade de entrada/salida y el posicionamiento en la esquina elegida.
 */
const ANIMATIONS: Record<LottieSticker["name"], LottieAnimationData> = {
  pulse_ring: pulseRing as LottieAnimationData,
  sparkle: sparkle as LottieAnimationData,
  arrow_down: arrowDown as LottieAnimationData,
  star5: star5 as LottieAnimationData,
};

const POSITIONS: Record<
  LottieSticker["position"],
  { justifyContent: "flex-start" | "center" | "flex-end"; alignItems: "flex-start" | "center" | "flex-end"; padding: string }
> = {
  "top-left": { justifyContent: "flex-start", alignItems: "flex-start", padding: "150px 0 0 60px" },
  "top-right": { justifyContent: "flex-start", alignItems: "flex-end", padding: "150px 60px 0 0" },
  "top-center": { justifyContent: "flex-start", alignItems: "center", padding: "150px 0 0 0" },
  "bottom-left": { justifyContent: "flex-end", alignItems: "flex-start", padding: "0 0 420px 60px" },
  "bottom-right": { justifyContent: "flex-end", alignItems: "flex-end", padding: "0 60px 420px 0" },
  center: { justifyContent: "center", alignItems: "center", padding: "0" },
};

export const LottieStickerLayer: React.FC<{
  sticker: LottieSticker;
  currentTime: number;
}> = ({ sticker, currentTime }) => {
  const elapsed = currentTime - sticker.at;
  const remaining = sticker.at + sticker.duration - currentTime;
  if (elapsed < -0.05 || remaining < 0) return null;

  // Fade + pop de entrada (0.18s) y fade de salida (0.2s).
  const fadeIn = Math.min(1, Math.max(0, elapsed / 0.18));
  const fadeOut = Math.min(1, Math.max(0, remaining / 0.2));
  const opacity = Math.min(fadeIn, fadeOut);
  const pop = 0.7 + 0.3 * fadeIn;

  const pos = POSITIONS[sticker.position];
  const data = ANIMATIONS[sticker.name];

  return (
    <AbsoluteFill style={{ ...pos, pointerEvents: "none" }}>
      <div
        style={{
          width: sticker.size,
          height: sticker.size,
          opacity,
          transform: `scale(${pop})`,
          // Las formas son blancas → un glow del color del estilo las integra al look.
          filter: `drop-shadow(0 0 16px ${sticker.color}) drop-shadow(0 0 6px ${sticker.color})`,
        }}
      >
        <Lottie animationData={data} loop />
      </div>
    </AbsoluteFill>
  );
};
