import { AbsoluteFill, spring, interpolate } from "remotion";
import { resolverIcono } from "../icon-map";
import { RemoteLottie } from "./lottie-sticker-layer";
import type { IconSticker } from "../schemas";

/**
 * B5 — Icon sticker: render de un icono lucide (curado en ICON_MAP) sobre un círculo
 * de color, con entrada spring + flotación post-entrada (sutil). Se ubica por esquina
 * o "top-center" con padding seguro para no chocar con otras capas.
 */
export const IconStickerLayer: React.FC<{
  sticker: IconSticker;
  currentTime: number;
}> = ({ sticker, currentTime }) => {
  const elapsed = currentTime - sticker.at;
  const enter = spring({
    frame: Math.max(0, elapsed * 30),
    fps: 30,
    config: { damping: 10, stiffness: 260, mass: 0.5 },
  });
  const exitStart = sticker.duration - 0.2;
  const exitProgress = elapsed > exitStart ? (elapsed - exitStart) / 0.2 : 0;
  const opacity = interpolate(exitProgress, [0, 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Resuelve cualquier nombre de lucide, no sólo los 30 del mapa curado: el
  // generador emite 253 y el 92 % caía al ícono genérico (ver `resolverIcono`).
  const Icon = resolverIcono(sticker.icon);
  // ICONO SVG EXTERNO (Phosphor/Tabler de la galería): el build embebió el markup
  // en sticker.iconSvg. Usa currentColor → se pinta con el color del sticker.
  const hasSvg = Boolean(sticker.iconSvg);
  const SvgIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <div
      style={{ width: size, height: size, color, display: "flex" }}
      dangerouslySetInnerHTML={{ __html: sticker.iconSvg }}
    />
  );

  // ── Tarjeta de diseño FULLSCREEN: pantalla oscura + ícono gigante + palabra. ──
  if (sticker.fullscreen) {
    const bgFade = interpolate(elapsed, [0, 0.25], [0, 0.92], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const ringSpin = elapsed * 40; // grados/seg, anillo girando
    const big = Math.min(560, sticker.size * 3.2);
    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 50,
          background: `rgba(8,8,10,${bgFade * opacity})`,
          opacity,
        }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* anillo de acento que gira detrás del ícono */}
          <svg width={big + 120} height={big + 120} style={{ position: "absolute", transform: `rotate(${ringSpin}deg)` }}>
            <circle
              cx={(big + 120) / 2}
              cy={(big + 120) / 2}
              r={(big + 60) / 2}
              fill="none"
              stroke={sticker.bg}
              strokeWidth={10}
              strokeDasharray="40 28"
              opacity={0.8 * enter}
              style={{ filter: `drop-shadow(0 0 24px ${sticker.bg})` }}
            />
          </svg>
          {sticker.lottieSrc ? (
            // ILUSTRACIÓN ANIMADA (Noto): dinero volando, reloj, cohete… La animación
            // ES la protagonista — sin círculo de fondo, solo glow del color del estilo.
            <div
              style={{
                width: big,
                height: big,
                transform: `scale(${enter})`,
                filter: `drop-shadow(0 0 60px ${sticker.bg}88) drop-shadow(0 16px 40px rgba(0,0,0,0.55))`,
              }}
            >
              <RemoteLottie src={sticker.lottieSrc} />
            </div>
          ) : (
            <div
              style={{
                width: big,
                height: big,
                borderRadius: "50%",
                background: sticker.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `scale(${enter})`,
                boxShadow: `0 0 90px ${sticker.bg}aa, 0 24px 60px rgba(0,0,0,0.6)`,
              }}
            >
              {hasSvg ? (
                <SvgIcon size={big * 0.55} color={sticker.color} />
              ) : (
                <Icon size={big * 0.55} color={sticker.color} strokeWidth={2.2} />
              )}
            </div>
          )}
        </div>
        {sticker.label ? (
          <div
            style={{
              fontFamily: "sans-serif",
              fontSize: 96,
              fontWeight: 900,
              color: "#ffffff",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              textShadow: `0 0 50px ${sticker.bg}88`,
              transform: `translateY(${(1 - enter) * 24}px)`,
              opacity: enter,
            }}
          >
            {sticker.label}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  const floatY = Math.sin(elapsed * 2.2) * 5;
  const wobbleRot = Math.sin(elapsed * 1.6) * 3;
  const pad = 80;
  const isTop = sticker.position.startsWith("top");
  const isLeft = sticker.position.endsWith("left");
  const isCenter = sticker.position === "top-center";
  const justify = isCenter ? "center" : isLeft ? "flex-start" : "flex-end";
  const align = isTop ? "flex-start" : "flex-end";
  const padTop = isCenter ? 160 : pad;
  const diameter = sticker.size + 36;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        justifyContent: align,
        alignItems: justify,
        padding: pad,
        paddingTop: padTop,
        opacity,
      }}
    >
      {sticker.lottieSrc ? (
        // Ilustración animada de esquina: sin círculo — el arte de Noto ya es completo.
        <div
          style={{
            width: diameter * 1.25,
            height: diameter * 1.25,
            transform: `translateY(${floatY}px) scale(${enter})`,
            filter: "drop-shadow(0 12px 28px rgba(0,0,0,0.5))",
          }}
        >
          <RemoteLottie src={sticker.lottieSrc} />
        </div>
      ) : (
        <div
          style={{
            width: diameter,
            height: diameter,
            borderRadius: "50%",
            background: sticker.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 16px 40px rgba(0,0,0,0.55), 0 0 0 4px rgba(255,255,255,0.1) inset",
            transform: `translateY(${floatY}px) scale(${enter}) rotate(${wobbleRot}deg)`,
          }}
        >
          {hasSvg ? (
            <SvgIcon size={sticker.size} color={sticker.color} />
          ) : (
            <Icon size={sticker.size} color={sticker.color} strokeWidth={2.4} />
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};
