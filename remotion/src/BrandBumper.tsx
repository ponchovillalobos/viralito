import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

/**
 * BRAND BUMPER (F2.b) — intro/outro de marca (logo + tagline) como composición SEPARADA.
 *
 * DISEÑO SEGURO: NO toca ViralVideo (el archivo más delicado). Se renderiza aparte y se
 * CONCATENA en post con ffmpeg (intro + main + outro). Así el timeline del clip no se
 * corre ni se arriesga el render de los 25 estilos.
 *
 *   - El logo REVELA con un wipe (clip-path) + spring scale → sensación de "dibujado",
 *     funciona con cualquier logo (PNG/SVG raster) sin necesitar paths.
 *   - La tagline entra con fade + subida escalonada, después del logo.
 *   - MONO-COLOR: el acento único pinta el fondo (variante oscura) + la barra + tagline.
 */
export const brandBumperSchema = z.object({
  mode: z.enum(["intro", "outro"]).default("intro"),
  logoUrl: z.string().default(""),
  /** Texto principal (tagline en intro; CTA/handle en outro). */
  tagline: z.string().default(""),
  /** Subtexto opcional (handle / web). */
  subtitle: z.string().default(""),
  accent: z.string().default("#fb7185"),
  /** Fondo: "dark" (negro con tinte de acento) o "accent" (acento pleno). */
  background: z.enum(["dark", "accent"]).default("dark"),
  /** Duración del bumper (s). calculateMetadata lo usa para el largo del render. */
  bumperSec: z.number().default(1.4),
  /** Dimensiones del render (casan con el clip: 1080×1920 / 1080×1080 / 1920×1080). */
  width: z.number().default(1080),
  height: z.number().default(1920),
});
export type BrandBumperProps = z.infer<typeof brandBumperSchema>;

export const brandBumperDefaults: BrandBumperProps = {
  mode: "intro",
  logoUrl: "",
  tagline: "",
  subtitle: "",
  accent: "#fb7185",
  background: "dark",
  bumperSec: 1.4,
  width: 1080,
  height: 1920,
};

export const BrandBumper: React.FC<BrandBumperProps> = ({
  mode,
  logoUrl,
  tagline,
  subtitle,
  accent,
  background,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  // Fondo: negro con un halo de acento, o acento pleno (con texto en contraste).
  const bg =
    background === "accent"
      ? accent
      : `radial-gradient(ellipse at 50% 45%, ${accent}33, #08070a 65%)`;
  const onAccent = background === "accent";

  // Reveal del logo: wipe horizontal (clip-path inset) + spring scale. En outro, entra igual.
  const revealSpring = spring({ frame, fps, config: { damping: 16, stiffness: 140, mass: 0.8 } });
  const wipeAmt = interpolate(revealSpring, [0, 1], [100, 0]); // % de inset → 0 al revelar
  // Intro revela de izquierda→derecha; outro de derecha→izquierda (gesto de cierre).
  const clipPath = mode === "outro" ? `inset(0 0 0 ${wipeAmt}%)` : `inset(0 ${wipeAmt}% 0 0)`;
  const logoScale = 0.82 + revealSpring * 0.18;

  // Tagline: aparece DESPUÉS del logo (0.45s) con fade + subida.
  const tagFrame = frame - Math.round(0.45 * fps);
  const tagSpring = spring({ frame: tagFrame, fps, config: { damping: 18, stiffness: 160, mass: 0.7 } });
  const tagOpacity = Math.max(0, Math.min(1, tagSpring));
  const tagRise = (1 - tagSpring) * 24;

  // Salida: fade global en los últimos 0.3s (para que el concat corte limpio).
  const outStart = durationInFrames - Math.round(0.3 * fps);
  const globalOpacity = interpolate(frame, [outStart, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const textColor = onAccent ? "#0a0a0a" : "#ffffff";
  const barColor = onAccent ? "#0a0a0a" : accent;
  const logoH = Math.min(width, height) * 0.26;

  return (
    <AbsoluteFill style={{ background: bg, opacity: globalOpacity }}>
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: height * 0.03 }}
      >
        {/* Logo con wipe-reveal (aproxima el "dibujado"), o iniciales si no hay logo. */}
        {logoUrl ? (
          <div style={{ clipPath, transform: `scale(${logoScale})` }}>
            <Img src={logoUrl} style={{ height: logoH, width: "auto", objectFit: "contain" }} />
          </div>
        ) : (
          <div
            style={{
              clipPath,
              transform: `scale(${logoScale})`,
              width: logoH,
              height: logoH,
              borderRadius: logoH * 0.22,
              background: barColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "Anton, Impact, sans-serif",
              fontSize: logoH * 0.5,
              color: onAccent ? accent : "#0a0a0a",
            }}
          >
            {(tagline || "V").slice(0, 1).toUpperCase()}
          </div>
        )}

        {/* Barra de acento fina bajo el logo. */}
        <div
          style={{
            width: interpolate(revealSpring, [0, 1], [0, width * 0.16]),
            height: 6,
            borderRadius: 3,
            background: barColor,
          }}
        />

        {/* Tagline + subtítulo. */}
        {tagline && (
          <div style={{ opacity: tagOpacity, transform: `translateY(${tagRise}px)`, textAlign: "center", padding: "0 8%" }}>
            <div
              style={{
                fontFamily: "Anton, Impact, sans-serif",
                fontSize: Math.min(width, height) * 0.058,
                lineHeight: 1.05,
                color: textColor,
                letterSpacing: "0.01em",
              }}
            >
              {tagline}
            </div>
            {subtitle && (
              <div
                style={{
                  marginTop: height * 0.012,
                  fontFamily: "Anton, Impact, sans-serif",
                  fontSize: Math.min(width, height) * 0.03,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: onAccent ? "#0a0a0a" : accent,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
