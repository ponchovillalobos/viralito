import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * B-roll en modo "PIP" (Picture-in-Picture): el clip de Pexels se muestra en un cuadrito
 * con borde de color de marca, sobre el video base. Layout responsivo según comp size.
 */
export const PipBRollLayer: React.FC<{
  url: string;
  accent: string;
}> = ({ url, accent }) => {
  const { width: compWidth, height: compHeight } = useVideoConfig();
  const pipWidth = Math.min(compWidth * 0.5, 540);
  const pipHeight = Math.min(compHeight * 0.375, 720);
  const paddingBottom = compHeight * 0.25;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom,
      }}
    >
      <div
        style={{
          width: pipWidth,
          height: pipHeight,
          borderRadius: 28,
          overflow: "hidden",
          border: `5px solid ${accent}`,
          boxShadow: `0 0 60px ${accent}55, 0 12px 40px rgba(0,0,0,0.7)`,
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <OffthreadVideo
          src={url}
          muted
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: "auto",
            height: "auto",
            objectFit: "contain",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/**
 * CORTINILLA EDITORIAL — el b-roll SUSTITUYE brevemente al video original DENTRO
 * de su mismo panel (mismas dimensiones, mismo recorte/duotono), con fade suave,
 * y después vuelve el original. Reemplaza al PIP flotante en los estilos editorial
 * (feedback del usuario: el PIP tapaba el texto/animaciones del lienzo Y al video).
 *
 * Soporta VIDEO (mp4/webm vía OffthreadVideo) e IMAGEN (jpg/png/webp vía Img con
 * un Ken Burns sutil para que no se sienta congelada). Va montada DENTRO del
 * contenedor del panel, ANTES del duotono → hereda clipping, borde y tinte del tema.
 */
export const EditorialCutaway: React.FC<{
  url: string;
  durationInFrames: number;
}> = ({ url, durationInFrames }) => {
  const frame = useCurrentFrame(); // relativo a la Sequence del clip
  const { fps } = useVideoConfig();
  const fadeF = Math.max(1, Math.round(0.35 * fps));
  const opacity = Math.max(
    0,
    Math.min(1, frame / fadeF, (durationInFrames - frame) / fadeF)
  );
  const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(url);
  // Ken Burns sutil para imágenes: zoom 1.0 → 1.08 a lo largo de la ventana.
  const kb = 1 + 0.08 * Math.min(1, frame / Math.max(1, durationInFrames));
  return (
    <AbsoluteFill style={{ opacity, background: "#000" }}>
      {isImage ? (
        <Img
          src={url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${kb.toFixed(4)})`,
          }}
        />
      ) : (
        <OffthreadVideo
          src={url}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </AbsoluteFill>
  );
};
