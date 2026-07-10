import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { useWindowedAudioData, visualizeAudio } from "@remotion/media-utils";
import { z } from "zod";

/**
 * AUDIOGRAMA (F2.a) — estilo "clip de podcast": una onda de barras que BAILA con la
 * VOZ real del clip (no la música), + branding del show. Desbloquea el vertical
 * podcast/entrevista sin depender de que se vea bien la cara.
 *
 * Reusa el patrón probado de AudioPulse (animated-background-layer): useWindowedAudioData
 * + visualizeAudio de @remotion/media-utils, por frame. La fuente de audio es la VOZ
 * (voiceoverUrl ?? rawVideoUrl) que ViralVideo ya tiene — cero deps nuevas, 100% offline.
 *
 * Reglas respetadas:
 *   - MONO-COLOR: TODAS las barras usan el `accent` único (nada de gradientes).
 *   - Subtítulos siempre visibles: la onda vive en una banda media (~66% de altura),
 *     lejos de la banda de subtítulos (abajo) y de los stickers (arriba-centro).
 *   - Opt-in: si `config` es null la capa no monta nada → render idéntico.
 */
export const audiogramSchema = z.object({
  /** @handle del show (arriba-izquierda). "" = no se muestra. */
  handle: z.string().default(""),
  /** Logo del show (PNG/SVG). "" = no se muestra. */
  logoUrl: z.string().default(""),
  /** Cantidad de barras de la onda. */
  bars: z.number().default(42),
  /** Centro vertical de la onda (0..1 de la altura). */
  y: z.number().default(0.66),
  /** Altura máxima de una barra (px a 1080×1920; escala con el alto). */
  height: z.number().default(150),
});
export type Audiogram = z.infer<typeof audiogramSchema>;

export const AudiogramLayer: React.FC<{
  config: Audiogram;
  /** Fuente de audio de la VOZ (voiceoverUrl ?? rawVideoUrl). */
  audioSrc: string;
  accent: string;
}> = ({ config, audioSrc, accent }) => {
  const frame = useCurrentFrame();
  const { fps, height: H, width: W } = useVideoConfig();
  const { audioData } = useWindowedAudioData({
    src: audioSrc,
    frame,
    fps,
    windowInSeconds: 10,
  });

  const n = Math.max(8, Math.min(80, config.bars));
  // visualizeAudio devuelve `numberOfSamples` bandas de frecuencia (potencia de 2).
  const samples = 64;
  const freq = audioData
    ? visualizeAudio({ fps, frame, audioData, numberOfSamples: samples })
    : [];

  // Mapear n barras a la mitad baja del espectro (la voz vive en graves/medios);
  // onda simétrica (espejo) tomando bandas hacia el centro para un look de waveform.
  const maxH = (config.height / 1920) * H;
  const centerY = config.y * H;
  const barW = (W * 0.86) / (n * 1.7);
  const gap = barW * 0.7;
  const totalW = n * (barW + gap) - gap;
  const startX = (W - totalW) / 2;

  const heights: number[] = [];
  for (let i = 0; i < n; i++) {
    // Espejo desde el centro: barras centrales = graves (más energía), extremos = agudos.
    const dist = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2 || 1); // 0 centro → 1 extremo
    const band = Math.floor(dist * (samples / 2 - 1));
    const v = freq.length ? freq[band] ?? 0 : 0;
    // sqrt = respuesta perceptual; piso mínimo para que la onda "viva" en silencios.
    const h = Math.max(0.06, Math.sqrt(v) * 1.5);
    heights.push(Math.min(1, h) * maxH);
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Onda de barras espejadas, mono-color acento. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: centerY,
          height: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap,
        }}
      >
        {heights.map((h, i) => (
          <div
            key={i}
            style={{
              width: barW,
              height: Math.max(barW, h * 2),
              borderRadius: barW,
              background: accent,
              boxShadow: `0 0 ${barW * 1.2}px ${accent}55`,
            }}
          />
        ))}
      </div>

      {/* Branding del show: logo + @handle arriba-izquierda (fuera de la zona de stickers). */}
      {(config.handle || config.logoUrl) && (
        <div
          style={{
            position: "absolute",
            top: H * 0.05,
            left: W * 0.06,
            display: "flex",
            alignItems: "center",
            gap: W * 0.02,
          }}
        >
          {config.logoUrl && (
            <Img
              src={config.logoUrl}
              style={{ height: H * 0.05, width: "auto", objectFit: "contain" }}
            />
          )}
          {config.handle && (
            <span
              style={{
                fontFamily: "Anton, Impact, sans-serif",
                fontSize: H * 0.028,
                letterSpacing: "0.02em",
                color: "#ffffff",
                textShadow: "0 2px 12px rgba(0,0,0,0.85)",
              }}
            >
              {config.handle}
            </span>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};
