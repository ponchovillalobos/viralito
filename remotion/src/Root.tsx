import { Composition } from "remotion";
import { ViralVideo, viralVideoSchema, defaultProps } from "./ViralVideo";
import { BrandBumper, brandBumperSchema, brandBumperDefaults } from "./BrandBumper";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ViralVideo"
        component={ViralVideo}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        schema={viralVideoSchema}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => {
          const totalSeconds = props.videoDurationSec ?? 30;
          return {
            durationInFrames: Math.ceil(totalSeconds * 30),
            // Dimensiones dinámicas desde props — defaults 1080×1920 (vertical 9:16).
            // El wizard puede pasar { width: 1920, height: 1080 } para horizontal 16:9.
            width: props.width ?? 1080,
            height: props.height ?? 1920,
          };
        }}
      />
      {/* BRAND BUMPER (F2.b) — intro/outro de marca, composición SEPARADA que se
          concatena en post (no toca el render de ViralVideo). Dimensiones dinámicas
          para casar con el clip (9:16 / 1:1 / 16:9); duración vía prop bumperSec. */}
      <Composition
        id="BrandBumper"
        component={BrandBumper}
        durationInFrames={45}
        fps={30}
        width={1080}
        height={1920}
        schema={brandBumperSchema}
        defaultProps={brandBumperDefaults}
        calculateMetadata={({ props }) => {
          const secs =
            (props as { bumperSec?: number }).bumperSec ??
            (props.mode === "outro" ? 1.6 : 1.4);
          return {
            durationInFrames: Math.max(20, Math.round(secs * 30)),
            width: (props as { width?: number }).width ?? 1080,
            height: (props as { height?: number }).height ?? 1920,
          };
        }}
      />
    </>
  );
};
