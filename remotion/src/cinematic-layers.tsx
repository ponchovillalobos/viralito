/**
 * Capas para el modo cinematográfico.
 *
 * F2 (this version): Ken Burns + 5 effects + 5 motions + 4 transitions completos.
 *
 * Opt-in: ViralVideo solo monta ImageOverlayLayer si imageOverlays.length > 0
 * y FilmGrainLayer si filmGrain=true. Sin opt-in este archivo se carga pero no
 * agrega nada al render.
 */
import {
  AbsoluteFill,
  Img,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  random,
} from "remotion";
import { z } from "zod";

export const imageOverlaySchema = z.object({
  id: z.string(),
  url: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  effect: z
    .enum(["tv_static", "memory_flash", "polaroid", "vhs", "newspaper", "none"])
    .default("memory_flash"),
  motion: z
    .enum(["ken_burns_in", "ken_burns_out", "pan_left", "pan_right", "zoom_bump", "static"])
    .default("ken_burns_in"),
  transitionIn: z
    .enum(["fade", "slide_up", "slide_down", "zoom_out", "tv_off", "escala_medida"])
    .default("fade"),
  transitionOut: z
    .enum(["fade", "slide_up", "slide_down", "zoom_out", "tv_off", "escala_medida"])
    .default("fade"),
  position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
  sizeRatio: z.number().default(0.65),
});

export type ImageOverlayProps = z.infer<typeof imageOverlaySchema>;

export const cameraMoveSchema = z.object({
  at: z.number(),
  duration: z.number().default(1.5),
  type: z.enum(["zoom_in", "zoom_out", "pan_left", "pan_right"]).default("zoom_in"),
  intensity: z.number().default(0.08),
});

export type CameraMoveProps = z.infer<typeof cameraMoveSchema>;

interface ImageOverlayLayerProps {
  overlays: ImageOverlayProps[];
  /**
   * Si true (modo cinematic): las imágenes son FULLSCREEN, con TV grain SIEMPRE al
   * aparecer, Ken Burns amplio (1.0 → 1.4). Si false: usa sizeRatio + effect como
   * el flow normal.
   */
  fullscreenCinematic?: boolean;
}

export const ImageOverlayLayer: React.FC<ImageOverlayLayerProps> = ({
  overlays,
  fullscreenCinematic = false,
}) => {
  const { fps } = useVideoConfig();
  if (!overlays || overlays.length === 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {overlays.map((overlay) => {
        const from = Math.floor(overlay.startTime * fps);
        const duration = Math.max(1, Math.floor((overlay.endTime - overlay.startTime) * fps));
        if (duration <= 0) return null;
        return (
          <Sequence key={overlay.id} from={from} durationInFrames={duration}>
            <OverlayFrame
              overlay={overlay}
              totalFrames={duration}
              fullscreenCinematic={fullscreenCinematic}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// ─── Motion: cómo se MUEVE la imagen mientras está visible ────────────────────
function computeMotion(
  motion: ImageOverlayProps["motion"],
  progress: number, // 0 a 1 del tiempo total visible
  seed: number
): { scale: number; translateX: number; translateY: number } {
  switch (motion) {
    case "ken_burns_in": {
      // scale 1.0 → 1.3 + slight pan. panAmplitude random por seed → cada overlay distinto.
      const panAmplitude = random(`pan-${seed}`) * 30 - 15;
      const scale = interpolate(progress, [0, 1], [1.0, 1.3]);
      const tx = interpolate(progress, [0, 1], [0, panAmplitude]);
      const ty = interpolate(progress, [0, 1], [0, panAmplitude * 0.5]);
      return { scale, translateX: tx, translateY: ty };
    }
    case "ken_burns_out": {
      // scale 1.3 → 1.0 + opposite pan. panAmplitude random por seed → cada overlay distinto.
      const panAmplitude = random(`pan-${seed}`) * 30 - 15;
      const scale = interpolate(progress, [0, 1], [1.3, 1.0]);
      const tx = interpolate(progress, [0, 1], [panAmplitude, 0]);
      const ty = interpolate(progress, [0, 1], [panAmplitude * 0.5, 0]);
      return { scale, translateX: tx, translateY: ty };
    }
    case "pan_left": {
      const tx = interpolate(progress, [0, 1], [40, -40]);
      return { scale: 1.1, translateX: tx, translateY: 0 };
    }
    case "pan_right": {
      const tx = interpolate(progress, [0, 1], [-40, 40]);
      return { scale: 1.1, translateX: tx, translateY: 0 };
    }
    case "zoom_bump": {
      // bump al inicio (0-0.15) y al final (0.85-1), valle en medio
      const startBump = progress < 0.15 ? Math.sin((progress / 0.15) * Math.PI) * 0.05 : 0;
      const endBump =
        progress > 0.85 ? Math.sin(((progress - 0.85) / 0.15) * Math.PI) * 0.05 : 0;
      return { scale: 1 + startBump + endBump, translateX: 0, translateY: 0 };
    }
    case "static":
    default:
      return { scale: 1, translateX: 0, translateY: 0 };
  }
}

// ─── Transitions: cómo APARECE y DESAPARECE ───────────────────────────────────
interface TransitionResult {
  opacity: number;
  scale: number; // multiplicador adicional al de motion
  translateY: number;
  scaleY: number; // solo tv_off lo modifica (collapse CRT)
}

function computeTransition(
  type: ImageOverlayProps["transitionIn"],
  progress: number, // 0 → 1 durante la transición
  reverse: boolean // true = transition out (1 → 0)
): TransitionResult {
  const p = reverse ? 1 - progress : progress;
  switch (type) {
    case "fade":
      return { opacity: p, scale: 1, translateY: 0, scaleY: 1 };
    case "slide_up":
      return {
        opacity: p,
        scale: 1,
        translateY: interpolate(p, [0, 1], [100, 0]),
        scaleY: 1,
      };
    case "slide_down":
      return {
        opacity: p,
        scale: 1,
        translateY: interpolate(p, [0, 1], [-100, 0]),
        scaleY: 1,
      };
    case "zoom_out":
      return {
        opacity: p,
        scale: interpolate(p, [0, 1], [1.5, 1.0]),
        translateY: 0,
        scaleY: 1,
      };
    case "escala_medida": {
      // Entrada de inserto MEDIDA, no elegida a ojo.
      //
      // Viene de un corpus de 152 entradas de inserto en 10 cabezas parlantes
      // 9:16. Tres cosas que el material real dice y la intuición no:
      //
      //   1. ESCALAN, no funden. De 31 entradas animadas, 24 escalan y sólo 5
      //      funden — por eso la opacidad queda en 1 de entrada a fin. Un fundido
      //      lee como "aparece algo"; una escala lee como "mirá esto".
      //   2. Arrancan en 0.50, no en 0.93. Media escala es un gesto que se ve;
      //      el 0.93 que usaban las otras entradas es un movimiento que nadie
      //      percibe, o sea trabajo de animación que no llega al espectador.
      //   3. La curva es smoothstep, no una ease-out cúbica. Ajustada contra el
      //      corpus: error medio 0.0265 contra 0.170 de la cúbica — 3.1 veces
      //      peor. Se nota en el arranque, que la cúbica hace demasiado brusco.
      //
      // Dura 3 fotogramas (la duración la fija el caller). Sin dependencias:
      // `p*p*(3-2*p)` es la smoothstep entera.
      const suave = p * p * (3 - 2 * p);
      return {
        opacity: 1,
        scale: interpolate(suave, [0, 1], [0.5, 1]),
        translateY: 0,
        scaleY: 1,
      };
    }
    case "tv_off":
      // CRT collapse — primero scaleY → 0.05, luego opacity → 0
      return {
        opacity: p > 0.3 ? 1 : p / 0.3,
        scale: 1,
        translateY: 0,
        scaleY: p > 0.3 ? 1 : interpolate(p, [0, 0.3], [0.05, 1]),
      };
    default:
      return { opacity: p, scale: 1, translateY: 0, scaleY: 1 };
  }
}

// ─── Effects: filtros CSS aplicados a la imagen ───────────────────────────────
function effectFilter(
  effect: ImageOverlayProps["effect"],
  frame: number,
  seed: number
): React.CSSProperties {
  switch (effect) {
    case "tv_static": {
      // MAX OUT — shift 50px, opacities 0.85
      const shift = (random(`tv-${seed}-${Math.floor(frame / 3)}`) - 0.5) * 50;
      return {
        filter: `contrast(1.55) saturate(1.7) drop-shadow(${shift}px 0 0 rgba(255,0,0,0.85)) drop-shadow(${-shift}px 0 0 rgba(0,255,255,0.85)) drop-shadow(0 ${shift * 0.4}px 0 rgba(255,255,0,0.4))`,
      };
    }
    case "memory_flash": {
      // MAX OUT — sepia 1.0, blur 3.5px
      return {
        filter: `sepia(1.0) saturate(0.25) brightness(0.85) contrast(1.35) blur(3.5px)`,
      };
    }
    case "polaroid":
      return {
        filter: `contrast(1.4) saturate(1.45) brightness(1.1)`,
      };
    case "vhs": {
      // MAX OUT — chroma shift 30°
      const offsetY = Math.sin(frame / 4) * 30;
      return {
        filter: `saturate(1.95) contrast(1.5) hue-rotate(${offsetY}deg)`,
      };
    }
    case "newspaper":
      return {
        filter: `sepia(1.0) contrast(1.6) brightness(0.85) grayscale(0.7)`,
      };
    case "none":
    default:
      return {};
  }
}

// ─── Effect overlays adicionales (scanlines, vintage borders, etc.) ──────────
const EffectOverlay: React.FC<{ effect: ImageOverlayProps["effect"]; size: number }> = ({
  effect,
  size,
}) => {
  if (effect === "vhs") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.85) 0px, rgba(0,0,0,0.85) 1px, transparent 1px, transparent 2px)",
          mixBlendMode: "overlay",
        }}
      />
    );
  }
  if (effect === "newspaper") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.95) 100%)",
        }}
      />
    );
  }
  return null;
};

const OverlayFrame: React.FC<{
  overlay: ImageOverlayProps;
  totalFrames: number;
  fullscreenCinematic?: boolean;
}> = ({ overlay, totalFrames, fullscreenCinematic = false }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // Transitions: 12 frames (~400ms a 30fps) cada una
  const transFrames = Math.min(12, Math.floor(totalFrames / 4));
  const inProgress = Math.min(1, frame / transFrames);
  const outStart = totalFrames - transFrames;
  const outProgress = frame > outStart ? (frame - outStart) / transFrames : 0;

  const inT = computeTransition(overlay.transitionIn, inProgress, false);
  const outT = computeTransition(overlay.transitionOut, outProgress, true);

  const opacity = Math.min(inT.opacity, outT.opacity);

  // Motion: en modo cinematic Ken Burns es más AMPLIO (scale 1.0 → 1.4, no 1.3)
  const motionProgress = frame / Math.max(1, totalFrames);
  const seed = parseInt(overlay.id.slice(-4), 36) || 1;
  const motion = computeMotion(overlay.motion, motionProgress, seed);
  const motionScaleBoost = fullscreenCinematic ? 1.05 : 1.0; // amplifica Ken Burns

  // Sumar scales (transition * motion)
  const totalScale = motion.scale * motionScaleBoost * inT.scale * outT.scale;
  const totalScaleY = inT.scaleY * outT.scaleY;
  const totalTranslateX = motion.translateX;
  const totalTranslateY = motion.translateY + inT.translateY + outT.translateY;

  // Spring suave para la primera aparición
  const springBoost = spring({
    fps,
    frame,
    config: { damping: 14, stiffness: 100 },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MODO CINEMATIC FULLSCREEN: la imagen llena toda la pantalla (ignora
  // sizeRatio/position) + TV grain siempre activo + Ken Burns más amplio.
  // ───────────────────────────────────────────────────────────────────────────
  if (fullscreenCinematic) {
    return (
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity,
            transform: `
              translate(${totalTranslateX}px, ${totalTranslateY}px)
              scale(${totalScale * (0.95 + 0.05 * springBoost)})
              scaleY(${totalScaleY})
            `,
            transformOrigin: "center center",
          }}
        >
          <Img
            src={overlay.url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              ...effectFilter(overlay.effect, frame, seed),
            }}
          />
          {/* MAX OUT — TV STATIC al 3x */}
          <TVStaticOverlay frame={frame} seed={seed} intensity={inProgress < 0.5 ? 3.0 : 1.5} />
          {/* MAX OUT — Scanlines al 65% (era 0.35) */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.65) 0px, rgba(0,0,0,0.65) 1px, transparent 1px, transparent 3px)",
              mixBlendMode: "overlay",
            }}
          />
          {/* MAX OUT — Vignette interna casi BLACKOUT */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "radial-gradient(ellipse 70% 50% at center, transparent 20%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.99) 100%)",
            }}
          />
          <EffectOverlay effect={overlay.effect} size={Math.max(width, height)} />
        </div>
      </AbsoluteFill>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MODO LEGACY (no fullscreen): respeta sizeRatio + position
  // ───────────────────────────────────────────────────────────────────────────
  const size = Math.min(width, height) * overlay.sizeRatio;
  const pos = positionToOffset(overlay.position, width, height, size);

  const isPolaroid = overlay.effect === "polaroid";
  const rotation = isPolaroid ? (random(`rot-${overlay.id}`) - 0.5) * 6 : 0;
  const polaroidPadding = isPolaroid ? size * 0.06 : 0;
  const wrapBg = isPolaroid ? "#fafafa" : "transparent";
  const wrapShadow = isPolaroid
    ? "0 8px 32px rgba(0,0,0,0.55)"
    : overlay.effect === "newspaper"
    ? "0 4px 16px rgba(0,0,0,0.5)"
    : "none";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: pos.left,
          top: pos.top,
          width: size + polaroidPadding * 2,
          background: wrapBg,
          padding: polaroidPadding,
          paddingBottom: isPolaroid ? polaroidPadding * 3 : polaroidPadding,
          boxShadow: wrapShadow,
          opacity,
          transform: `
            translate(${totalTranslateX}px, ${totalTranslateY}px)
            scale(${totalScale * (0.95 + 0.05 * springBoost)})
            scaleY(${totalScaleY})
            rotate(${rotation}deg)
          `,
          transformOrigin: "center center",
        }}
      >
        <div style={{ position: "relative", width: size, height: size, overflow: "hidden" }}>
          <Img
            src={overlay.url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              ...effectFilter(overlay.effect, frame, seed),
            }}
          />
          <EffectOverlay effect={overlay.effect} size={size} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/**
 * TV static superpuesto: pixeles randomizados con noise + chroma shift.
 * SIEMPRE activo en modo cinematic fullscreen para feeling de recuerdo/flashback.
 */
const TVStaticOverlay: React.FC<{
  frame: number;
  seed: number;
  intensity: number;
}> = ({ frame, seed, intensity }) => {
  const tick = Math.floor(frame / 2);
  const tx = (random(`tvstatic-x-${seed}-${tick}`) - 0.5) * 50;
  const opacity = 0.6 * intensity;
  return (
    <>
      {/* MAX OUT — Noise layer al 60% (era 0.35) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity,
          mixBlendMode: "screen",
          transform: `translate(${tx}px, 0)`,
          background:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='turbulence' baseFrequency='2.2' numOctaves='1' /></filter><rect width='400' height='400' filter='url(%23n)' opacity='1'/></svg>\")",
        }}
      />
      {/* Chroma shift FUERTE (era 0.08, ahora 0.22) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.22 * intensity,
          mixBlendMode: "screen",
          transform: `translate(${tx * 0.7}px, 0)`,
          background: "linear-gradient(180deg, transparent 0%, rgba(255,0,0,0.5) 50%, transparent 100%)",
        }}
      />
      {/* Cyan complement para RGB shift completo */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.18 * intensity,
          mixBlendMode: "screen",
          transform: `translate(${-tx * 0.7}px, 0)`,
          background: "linear-gradient(180deg, transparent 0%, rgba(0,255,255,0.5) 50%, transparent 100%)",
        }}
      />
    </>
  );
};

function positionToOffset(
  position: ImageOverlayProps["position"],
  width: number,
  height: number,
  size: number
): { left: number; top: number } {
  const cx = width / 2 - size / 2;
  const cy = height / 2 - size / 2;
  switch (position) {
    case "top":
      return { left: cx, top: height * 0.1 };
    case "bottom":
      return { left: cx, top: height * 0.6 };
    case "left":
      return { left: width * 0.05, top: cy };
    case "right":
      return { left: width * 0.6, top: cy };
    case "center":
    default:
      return { left: cx, top: cy };
  }
}

/**
 * Calcula el transform aplicable al video base según camera moves activos.
 * Devuelve scale + translate strings. Solo se usa cuando hay cameraMoves.length > 0
 * (típicamente solo cuando subtitleStyle="cinematic").
 */
export function useCameraMoveTransform(
  cameraMoves: CameraMoveProps[]
): { scale: number; translateX: number; translateY: number } {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Encontrar move activo
  const active = cameraMoves.find(
    (c) => currentTime >= c.at && currentTime <= c.at + c.duration
  );
  if (!active) return { scale: 1, translateX: 0, translateY: 0 };

  const t = (currentTime - active.at) / active.duration; // 0 → 1
  // Ease-in-out cúbico para movimientos suaves
  const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const intensity = active.intensity;

  // GESTO DE CÁMARA — calibrado con metraje.
  //
  // Antes: `intensity * 6.0`, con el comentario "MAX OUT … calibrable hacia
  // abajo después". Ese después nunca llegó: 0.10/0.16/0.22 salían como
  // 60 %/96 %/132 % de zoom. Medido:
  //   · gesto `push_in` sobre imagen fija: 1.00 → 1.14 en 1.0–1.6 s
  //   · deriva sostenida de cámara en cabeza parlante: +0.127 %/s sobre 95 planos
  // +96 % es 6.9× el techo del gesto real.
  //
  // Ahora `intensity` ES la fracción de zoom, sin multiplicador oculto: 0.14 =
  // +14 %. La curva cúbica de arriba ya da el slow-in/slow-out.
  //
  // EL LOOK ANTERIOR NO SE PIERDE: quien lo quiera pide `intensity: 0.96` en el
  // proyecto y obtiene exactamente el +96 % de antes. Lo que cambia es el valor
  // por DEFECTO de `generateCameraMoves`, que ahora sale de medición.
  const amplified = intensity;
  switch (active.type) {
    case "zoom_in":
      return { scale: 1 + amplified * eased, translateX: 0, translateY: 0 };
    case "zoom_out":
      // zoom_out parte de zoom amplio y termina en escala normal (cinematic reveal)
      return { scale: 1 + amplified * (1 - eased), translateX: 0, translateY: 0 };
    case "pan_left":
      // Antes trasladaba el video en X (translateX) y el desplazamiento real en
      // pantalla (scale·tx) superaba el margen que el zoom cubría → se veía borde
      // negro y "salía del plano". Ahora es un push-in suave (mismo gesto de
      // cámara) SIN traslación: con objectFit:cover el frame nunca descubre borde.
      return { scale: 1 + amplified * eased, translateX: 0, translateY: 0 };
    case "pan_right":
      // Pull-out suave (zoom amplio → escala normal). translateX:0 → cero borde.
      return { scale: 1 + amplified * (1 - eased), translateX: 0, translateY: 0 };
    default:
      return { scale: 1, translateX: 0, translateY: 0 };
  }
}

// ─── F3 SUPREME — Film grain con DOBLE capa (fina + gruesa) y mixBlendMode screen
// Antes: opacity 0.12, overlay (apenas visible). Ahora: opacity 0.35, screen + dual layer.
export const FilmGrainLayer: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const frame = useCurrentFrame();
  if (!enabled) return null;
  // Re-randomiza posición cada 4 frames para sensación de grano vivo
  const tick = Math.floor(frame / 4);
  const tx = (random(`grain-x-${tick}`) - 0.5) * 30;
  const ty = (random(`grain-y-${tick}`) - 0.5) * 30;
  const tx2 = (random(`grain-x2-${tick}`) - 0.5) * 20;
  const ty2 = (random(`grain-y2-${tick}`) - 0.5) * 20;
  return (
    <>
      {/* MAX OUT — Capa 1: grano FINO al 55% (era 0.32) */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.55,
          mixBlendMode: "overlay",
          transform: `translate(${tx}px, ${ty}px)`,
          background:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='3' /></filter><rect width='400' height='400' filter='url(%23n)' opacity='1'/></svg>\")",
        }}
      />
      {/* MAX OUT — Capa 2: grano GRUESO al 40% (era 0.18) + scale 1.8 */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.4,
          mixBlendMode: "screen",
          transform: `translate(${tx2}px, ${ty2}px) scale(1.8)`,
          background:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='turbulence' baseFrequency='0.6' numOctaves='2' /></filter><rect width='400' height='400' filter='url(%23n)' opacity='1'/></svg>\")",
        }}
      />
      {/* MAX OUT — Capa 3 NUEVA: grano EXTRA-GRUESO para textura 35mm pesada */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          opacity: 0.28,
          mixBlendMode: "multiply",
          transform: `translate(${ty}px, ${tx}px) scale(2.2)`,
          background:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='turbulence' baseFrequency='0.3' numOctaves='1' /></filter><rect width='400' height='400' filter='url(%23n)' opacity='1'/></svg>\")",
        }}
      />
    </>
  );
};

// ─── F3 SUPREME — Vignette ELÍPTICA fuerte (cine, no plana)
// Antes: gradient circle, 50%→0.45 (invisible). Ahora: ellipse 80% 60% con 30%→0.85.
export const VignetteLayer: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  if (!enabled) return null;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background:
          "radial-gradient(ellipse 75% 55% at center, transparent 15%, rgba(0,0,0,0.65) 55%, rgba(0,0,0,0.95) 85%, rgba(0,0,0,1) 100%)",
      }}
    />
  );
};
