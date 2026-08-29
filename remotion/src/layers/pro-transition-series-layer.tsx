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
// `iris` ya venia dentro de @remotion/transitions 4.0.462 y llevaba tiempo sin
// usarse: el paquete trae NUEVE presentaciones y aqui habia seis. Es CSS puro
// (un circulo que abre o cierra), asi que no pide nada del entorno de render.
//
// Las otras dos que faltan, `zoomBlur` y `zoomInOut`, quedan fuera A PROPOSITO:
// dibujan con shaders sobre OffscreenCanvas y exigen Chrome con el flag
// experimental `canvas-draw-element`. Sin medir que rindan en este render
// offline, agregarlas seria prometer algo que no se comprobo.
import { iris } from "@remotion/transitions/iris";

export const proTransitionSeriesSchema = z.object({
  at: z.number(),
  /** Duración del barrido (frames). El overlay total dura un poco más para enmarcar. */
  durationFrames: z.number().default(14),
  kind: z
    .enum(["slide", "wipe", "flip", "clockWipe", "iris", "fade", "none"])
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

/** Panel VACIO: deja ver el video debajo. Es lo que convierte esta capa en un
 *  barrido y no en una tapa — ver el comentario de la estructura mas abajo. */
const Vacio: React.FC = () => <AbsoluteFill style={{ backgroundColor: "transparent" }} />;

export const ProTransitionSeriesLayer: React.FC<{
  transitions: ProTransitionSeries[];
  currentTime: number;
}> = ({ transitions, currentTime }) => {
  const { fps, width, height } = useVideoConfig();
  const active = transitions.filter((tr) => {
    const dur = Math.max(2, tr.durationFrames) / fps;
    // El barrido se CENTRA en `at` (entra en la primera mitad, sale en la
    // segunda), asi que la ventana tiene que abrir ANTES de `at`. Con el filtro
    // viejo, que abria en `at - 0.02`, la mitad de entrada no se montaba nunca.
    return currentTime >= tr.at - dur && currentTime <= tr.at + dur + 0.4;
  });
  if (active.length === 0) return null;

  return (
    <>
      {active.map((tr, i) => {
        const dur = Math.max(2, tr.durationFrames);

        // ESTRUCTURA: vacio -> COLOR -> vacio, con dos transiciones.
        //
        // Antes eran DOS paneles opacos (color -> colorTo) y eso no barre nada:
        // tapa el cuadro entero de punta a punta de la ventana. Con un panel
        // vacio a cada lado, el color entra barriendo sobre el video, cubre un
        // instante, y sale barriendo — que es el efecto que el nombre promete.
        //
        // Las tres secuencias duran `dur` porque Remotion EXIGE que ninguna
        // secuencia sea mas corta que la transicion que tiene al lado. El
        // codigo anterior usaba `pad = round(dur * 0.4)`, siempre menor que
        // `dur`, asi que la capa ABORTABA EL RENDER cada vez que se activaba:
        //
        //   "The duration of a <TransitionSeries.Sequence /> must not be
        //    shorter than the duration of the next <TransitionSeries.Transition />.
        //    The transition is 14 frames long, but the sequence is only 6"
        //
        // Por eso el array llegaba siempre vacio: no es que nadie lo usara, es
        // que no PODIA usarse. Nada lo delataba porque nadie lo lleno nunca.
        //
        // El panel de COLOR dura el DOBLE que los vacios, y eso no es estetico:
        // cada transicion se come `dur` frames de la secuencia que tiene al
        // lado. Si el panel de color durara `dur`, las DOS transiciones se lo
        // comerian entero, se solaparian una sobre otra y se anularian — que es
        // exactamente lo que pasaba al probarlo: el barrido no aparecia en
        // ningun fotograma. Con `2*dur`, la primera se come la mitad de entrada
        // y la segunda la de salida, sin pisarse.
        //
        //   vacio(dur) --trans(dur)--> COLOR(2*dur) --trans(dur)--> vacio(dur)
        //
        // Total real = (dur + 2*dur + dur) - (dur + dur) = 2*dur frames. El
        // color cubre el cuadro entero UN instante, en el centro exacto.
        const seqVacio = dur;
        const seqColor = dur * 2;

        // Centrado en `at`: la primera mitad entra, la segunda sale. Asi el
        // instante de cobertura total cae SOBRE el corte, que es donde sirve.
        const fromFrame = Math.round(tr.at * fps) - dur;

        // Tipo comun para que el switch no narrowee a la primera rama (cada
        // presentacion tiene su propio Props; aqui solo importa el contrato comun).
        type AnyPresentation = TransitionPresentation<Record<string, unknown>>;
        const presentation = ((): AnyPresentation => {
          switch (tr.kind) {
            case "wipe":
              return wipe({ direction: tr.direction }) as unknown as AnyPresentation;
            case "flip":
              return flip({ direction: tr.direction }) as unknown as AnyPresentation;
            case "clockWipe":
              return clockWipe({ width, height }) as unknown as AnyPresentation;
            case "iris":
              return iris({ width, height }) as unknown as AnyPresentation;
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
              <TransitionSeries.Sequence durationInFrames={seqVacio}>
                <Vacio />
              </TransitionSeries.Sequence>
              <TransitionSeries.Transition
                presentation={presentation}
                timing={timing}
              />
              <TransitionSeries.Sequence durationInFrames={seqColor}>
                <Panel color={tr.color} />
              </TransitionSeries.Sequence>
              <TransitionSeries.Transition
                presentation={presentation}
                timing={timing}
              />
              <TransitionSeries.Sequence durationInFrames={seqVacio}>
                <Vacio />
              </TransitionSeries.Sequence>
            </TransitionSeries>
          </AbsoluteFill>
        );
      })}
    </>
  );
};
