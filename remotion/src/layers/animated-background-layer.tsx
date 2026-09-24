import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { z } from "zod";

/**
 * MOTION PRO — Fondo ANIMADO (inspirado en remotion-scenes, MIT; reescrito para
 * nuestro schema opt-in). Tres looks limpios, sin assets externos:
 *   - aurora: bandas de luz que fluyen (norte boreal suave)
 *   - mesh:   gradiente de malla que respira (look moderno tipo Stripe)
 *   - grid:   cuadrícula en perspectiva que avanza (retro-tech sutil)
 *
 * `audioReactive: true` + música → el fondo PULSA con los graves del track
 * (visualizeAudio de @remotion/media-utils, por frame). Sin música, respira
 * con una onda suave. Se renderiza como overlay aditivo a baja opacidad sobre
 * el video (screen blend) — eleva el look sin tapar al speaker.
 */
export const animatedBackgroundSchema = z.object({
  kind: z.enum(["aurora", "mesh", "grid"]).default("aurora"),
  // Paleta (2-3 colores). El director emocional puede elegirla por mood.
  colors: z.array(z.string()).default(["#34d399", "#6ee7b7", "#047857"]), // un solo matiz: el acento y dos tonos
  opacity: z.number().default(0.35),
  audioReactive: z.boolean().default(true),
});
export type AnimatedBackground = z.infer<typeof animatedBackgroundSchema>;

/** Pulso 0..1 desde los graves de la música (solo se monta si hay musicUrl). */
const AudioPulse: React.FC<{
  musicUrl: string;
  /** Frames que la música está adelantada (musicStartSec): el pulso lee ESE tramo. */
  offsetFrames?: number;
  children: (pulse: number) => React.ReactNode;
}> = ({ musicUrl, offsetFrames = 0, children }) => {
  const frame = useCurrentFrame() + offsetFrames;
  const { fps } = useVideoConfig();
  const { audioData } = useWindowedAudioData({
    src: musicUrl,
    frame,
    fps,
    windowInSeconds: 10,
  });
  let pulse = 0;
  if (audioData) {
    const freq = visualizeAudio({ fps, frame, audioData, numberOfSamples: 32 });
    // Graves = primeras bandas; suavizado perceptual con raíz.
    const bass = (freq[0] + freq[1] + freq[2] + freq[3]) / 4;
    pulse = Math.min(1, Math.sqrt(bass) * 1.6);
  }
  return <>{children(pulse)}</>;
};

const BackgroundVisual: React.FC<{
  bg: AnimatedBackground;
  pulse: number; // 0..1 (audio o respiración)
}> = ({ bg, pulse }) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const c = bg.colors.length >= 2 ? bg.colors : [bg.colors[0] ?? "#34d399", bg.colors[0] ?? "#6ee7b7", bg.colors[0] ?? "#047857"];
  const baseOpacity = bg.opacity ?? 0.35;
  const energy = 0.6 + pulse * 0.4; // el pulso escala brillo/tamaño

  if (bg.kind === "mesh") {
    // Tres radiales que orbitan lento — gradiente de malla vivo.
    const o1x = 30 + Math.sin(t * 0.35) * 18;
    const o1y = 25 + Math.cos(t * 0.28) * 14;
    const o2x = 72 + Math.cos(t * 0.31 + 2) * 16;
    const o2y = 70 + Math.sin(t * 0.24 + 1) * 16;
    const o3x = 55 + Math.sin(t * 0.22 + 4) * 20;
    const r = 38 + pulse * 14;
    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          mixBlendMode: "screen",
          opacity: baseOpacity * energy,
          background: [
            `radial-gradient(circle at ${o1x}% ${o1y}%, ${c[0]} 0%, transparent ${r}%)`,
            `radial-gradient(circle at ${o2x}% ${o2y}%, ${c[1]} 0%, transparent ${r}%)`,
            `radial-gradient(circle at ${o3x}% 45%, ${c[2] ?? c[0]} 0%, transparent ${r - 6}%)`,
          ].join(", "),
          filter: "blur(40px)",
        }}
      />
    );
  }

  if (bg.kind === "grid") {
    // Cuadrícula en perspectiva que avanza; el pulso ilumina las líneas.
    const offset = (t * 60) % 80;
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: baseOpacity * energy }}>
        <div
          style={{
            position: "absolute",
            left: "-20%",
            right: "-20%",
            bottom: 0,
            height: "55%",
            transform: "perspective(700px) rotateX(62deg)",
            transformOrigin: "bottom center",
            backgroundImage: `linear-gradient(${c[0]}cc 2px, transparent 2px), linear-gradient(90deg, ${c[1]}cc 2px, transparent 2px)`,
            backgroundSize: "80px 80px",
            backgroundPosition: `0px ${offset}px`,
            maskImage: "linear-gradient(to top, black 30%, transparent 95%)",
            WebkitMaskImage: "linear-gradient(to top, black 30%, transparent 95%)",
            filter: `drop-shadow(0 0 ${6 + pulse * 14}px ${c[0]})`,
          }}
        />
      </AbsoluteFill>
    );
  }

  // aurora (default) — bandas de luz que ondulan en la parte alta del frame.
  const bands = [0, 1, 2].map((i) => {
    const sway = Math.sin(t * (0.4 + i * 0.13) + i * 2.1) * 14;
    const skew = Math.sin(t * 0.3 + i) * 10;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          top: `${4 + i * 9}%`,
          left: `${-15 + sway}%`,
          width: "130%",
          height: `${15 + pulse * 7}%`,
          background: `linear-gradient(90deg, transparent 0%, ${c[i % c.length]} 45%, transparent 100%)`,
          transform: `skewY(${-6 + skew * 0.4}deg)`,
          filter: "blur(46px)",
          opacity: 0.8 - i * 0.18,
        }}
      />
    );
  });
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity: baseOpacity * energy,
      }}
    >
      {bands}
    </AbsoluteFill>
  );
};

export const AnimatedBackgroundLayer: React.FC<{
  bg: AnimatedBackground;
  musicUrl: string | null;
  musicOffsetFrames?: number;
}> = ({ bg, musicUrl, musicOffsetFrames = 0 }) => {
  const frame = useCurrentFrame();
  // Respiración de respaldo (sin música o sin audioReactive): onda lenta 0..0.5.
  const breath = 0.25 + 0.25 * Math.sin(frame / 38);
  if (bg.audioReactive && musicUrl) {
    return (
      <AudioPulse musicUrl={musicUrl} offsetFrames={musicOffsetFrames}>
        {(pulse) => <BackgroundVisual bg={bg} pulse={pulse} />}
      </AudioPulse>
    );
  }
  return <BackgroundVisual bg={bg} pulse={breath} />;
};
