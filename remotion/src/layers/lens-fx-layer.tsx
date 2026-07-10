import { AbsoluteFill, useCurrentFrame } from "remotion";
import { z } from "zod";

/**
 * LENS FX (F2.d) — efectos de lente/óptica como OVERLAY autocontenido (NO toca la
 * cadena de filtro del video base → cero riesgo al render delicado de ViralVideo).
 *
 *   - halation  : bloom suave del ACENTO en altas luces (screen blend). Refuerza el
 *                 mono-color; da el "glow analógico" de cine/VHS/Y2K.
 *   - chromatic : fringe RGB (rojo/cian) en los BORDES del frame — donde la aberración
 *                 cromática de una lente real es visible. EXCEPCIÓN mono-color
 *                 documentada: por definición el efecto es rojo+cian, así que SOLO se
 *                 usa en VHS/Y2K (looks analógicos), nunca en estilos limpios.
 *
 * Opt-in: `config` null → no monta nada (render idéntico). Barato: overlays CSS, sin
 * leer píxeles del video ni filtros SVG pesados.
 */
export const lensFxSchema = z.object({
  /** Intensidad de la halación (bloom de acento) 0..1. 0 = off. */
  halation: z.number().default(0),
  /** Intensidad de la aberración cromática 0..1. 0 = off. Solo looks analógicos. */
  chromatic: z.number().default(0),
});
export type LensFx = z.infer<typeof lensFxSchema>;

export const LensFxLayer: React.FC<{
  config: LensFx;
  accent: string;
}> = ({ config, accent }) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const hal = Math.max(0, Math.min(1, config.halation));
  const chr = Math.max(0, Math.min(1, config.chromatic));
  // Respiración lenta del bloom (vivo pero sutil).
  const breathe = 0.85 + 0.15 * Math.sin(t * 0.9);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* HALACIÓN — bloom del acento en screen: brillo central + halo de bordes. */}
      {hal > 0 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: 0.1 + hal * 0.22 * breathe,
            background: `radial-gradient(ellipse at 50% 42%, ${accent}, transparent 62%)`,
          }}
        />
      )}

      {/* ABERRACIÓN CROMÁTICA — fringe rojo/cian en los bordes (radiales con centro
          transparente), offset unos px en direcciones opuestas. Screen blend. */}
      {chr > 0 && (
        <>
          <AbsoluteFill
            style={{
              mixBlendMode: "screen",
              opacity: 0.35 * chr,
              transform: `translateX(${1.5 + chr * 3}px)`,
              background:
                "radial-gradient(ellipse at 50% 50%, transparent 58%, rgba(255,0,60,0.9) 100%)",
            }}
          />
          <AbsoluteFill
            style={{
              mixBlendMode: "screen",
              opacity: 0.35 * chr,
              transform: `translateX(${-(1.5 + chr * 3)}px)`,
              background:
                "radial-gradient(ellipse at 50% 50%, transparent 58%, rgba(0,220,255,0.9) 100%)",
            }}
          />
        </>
      )}
    </AbsoluteFill>
  );
};
