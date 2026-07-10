/**
 * ProTransitionSeriesLayer — transiciones PRO oficiales de Remotion (@remotion/transitions).
 *
 * 100% ADITIVA y opt-in. NO reemplaza a las transiciones caseras (ProTransitionLayer
 * en scene-fx, que viven en los `proTransitions`): se SUMAN. Mientras el array
 * `proTransitionSeries` esté vacío (default), esta capa no monta nada → render idéntico.
 *
 * Por qué un TransitionSeries de paneles en vez de cortar el video base: el video de
 * ViralVideo es un único <OffthreadVideo> continuo (no una serie de clips), así que un
 * TransitionSeries "real" entre clips rompería ese modelo. En cambio montamos un
 * <TransitionSeries> de DOS paneles de color (entrante/saliente) como OVERLAY corto en
 * el punto de corte: la presentación oficial (slide/wipe/flip/clockWipe/none) anima el
 * barrido por encima del frame, dando el look de corte profesional sin tocar el video.
 *
 * Presentaciones expuestas (todas del paquete oficial, gratis con el stack Remotion):
 *   - slide      → empuja desde un lado
 *   - wipe       → barrido direccional con borde limpio
 *   - flip       → giro 3D del panel (perspectiva)
 *   - clockWipe  → barrido radial tipo reloj
 *   - none       → corte seco (sirve para alinear timing sin animación)
 */
import { AbsoluteFill, useVideoConfig } from "remotion";
import { z } from "zod";
import {
  TransitionSeries,
  linearTiming,
  springTiming,
  type TransitionPresentation,
} from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { fade } from "@remotion/transitions/fade";
import { none } from "@remotion/transitions/none";

export const proTransitionSeriesSchema = z.object({
  at: z.number(),
  /** Duración del barrido (frames). El overlay total dura un poco más para enmarcar. */
  durationFrames: z.number().default(14),
  kind: z
    .enum(["slide", "wipe", "flip", "clockWipe", "fade", "none"])
    .default("slide"),
  /** Dirección para slide/wipe/flip (las que la soportan). */
  direction: z
    .enum(["from-left", "from-right", "from-top", "from-bottom"])
    .default("from-left"),
  /** Color del panel que barre (suele ser el acento del proyecto o negro). */
  color: z.string().default("#0a0a0a"),
  /** Color del panel "destino" que queda al final del barrido (se desvanece). */
  colorTo: z.string().default("#ffffff"),
});
export type ProTransitionSeries = z.infer<typeof proTransitionSeriesSchema>;

const Panel: React.FC<{ color: string }> = ({ color }) => (
  <AbsoluteFill style={{ backgroundColor: color }} />
);

export const ProTransitionSeriesLayer: React.FC<{
  transitions: ProTransitionSeries[];
  currentTime: number;
}> = ({ transitions, currentTime }) => {
  const { fps, width, height } = useVideoConfig();
  const active = transitions.filter((tr) => {
    const dur = Math.max(2, tr.durationFrames) / fps;
    // El overlay vive [at, at+dur+pad]; fuera de eso, no monta nada (barato).
    return currentTime >= tr.at - 0.02 && currentTime <= tr.at + dur + 0.4;
  });
  if (active.length === 0) return null;

  return (
    <>
      {active.map((tr, i) => {
        const dur = Math.max(2, tr.durationFrames);
        // El primer panel ocupa hasta `at`, luego transiciona al segundo durante `dur`.
        const fromFrame = Math.round(tr.at * fps);
        // Margen pequeño a cada lado para que el TransitionSeries tenga sequences válidas.
        const pad = Math.max(2, Math.round(dur * 0.4));

        // Tipo común para que el switch no narrowee a la primera rama (cada
        // presentación tiene su propio Props; aquí solo nos importa el contrato común).
        type AnyPresentation = TransitionPresentation<Record<string, unknown>>;
        const presentation = ((): AnyPresentation => {
          switch (tr.kind) {
            case "wipe":
              return wipe({ direction: tr.direction }) as unknown as AnyPresentation;
            case "flip":
              return flip({ direction: tr.direction }) as unknown as AnyPresentation;
            case "clockWipe":
              return clockWipe({ width, height }) as unknown as AnyPresentation;
            case "fade":
              return fade() as unknown as AnyPresentation;
            case "none":
              return none() as unknown as AnyPresentation;
            case "slide":
            default:
              return slide({ direction: tr.direction }) as unknown as AnyPresentation;
          }
        })();

        const timing =
          tr.kind === "none" || tr.kind === "fade"
            ? linearTiming({ durationInFrames: dur })
            : springTiming({
                config: { damping: 26, mass: 0.7 },
                durationInFrames: dur,
                durationRestThreshold: 0.001,
              });

        return (
          <AbsoluteFill
            key={`pts-${i}-${tr.at}`}
            style={{ pointerEvents: "none" }}
          >
            <TransitionSeries from={fromFrame}>
              <TransitionSeries.Sequence durationInFrames={pad}>
                <Panel color={tr.color} />
              </TransitionSeries.Sequence>
              <TransitionSeries.Transition
                presentation={presentation}
                timing={timing}
              />
              <TransitionSeries.Sequence durationInFrames={pad}>
                <Panel color={tr.colorTo} />
              </TransitionSeries.Sequence>
            </TransitionSeries>
          </AbsoluteFill>
        );
      })}
    </>
  );
};
