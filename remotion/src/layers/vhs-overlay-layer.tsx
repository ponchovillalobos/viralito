/**
 * VHS OVERLAY — look "cámara de los 90 / camcorder analógico" 100% procedural.
 *
 * Capa ADITIVA y opt-in (prop `vhsLook`): se monta ENCIMA del video y DEBAJO de los
 * subtítulos, nunca los tapa. Todo determinista (remotion `random()` con seeds fijos
 * + funciones de currentTime): mismo frame → mismos píxeles, sin Date.now().
 *
 * Elementos (tendencia "analog nostalgia" 2026 — el grano lee como REAL contra la
 * estética AI-perfecta):
 *   - Scanlines CRT (repeating-linear-gradient, multiply suave)
 *   - Timestamp VCR "► PLAY 0:04:12" (monospace, jitter de 1px)
 *   - "● REC" parpadeante arriba a la derecha
 *   - Tracking glitch cada ~5s: 2 bandas horizontales que saltan con tinte RGB
 *   - Flicker de brillo sutil + banda de ruido inferior durante el glitch
 *
 * El color base (midtones cálidos) NO vive acá: lo pone el LUT vintage_film.cube
 * del estilo (post-fx), igual que en cinematic. Esta capa es solo el "hardware".
 */
import { AbsoluteFill, random } from "remotion";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const VhsOverlayLayer: React.FC<{
  currentTime: number;
  enabled: boolean;
}> = ({ currentTime, enabled }) => {
  if (!enabled) return null;

  const frame = Math.floor(currentTime * 30);
  // Timestamp del contador (desde el arranque del clip, look VCR).
  const mm = Math.floor(currentTime / 60);
  const ss = Math.floor(currentTime % 60);
  const counter = `0:${pad2(mm)}:${pad2(ss)}`;
  // Jitter de 1px del OSD (cada 4 frames cambia, determinista).
  const jx = Math.round((random(`vhs-jx-${Math.floor(frame / 4)}`) - 0.5) * 2);
  const jy = Math.round((random(`vhs-jy-${Math.floor(frame / 4)}`) - 0.5) * 2);
  // REC parpadea 1s on / 1s off.
  const recOn = Math.floor(currentTime) % 2 === 0;
  // Flicker de brillo: senoidal lenta + micro-ruido por frame (sutil).
  const flicker =
    0.02 + 0.015 * Math.sin(currentTime * 9) + 0.01 * random(`vhs-fl-${frame}`);

  // Tracking glitch: ventana de ~0.33s cada ~5.2s (offset por seed para no caer
  // siempre en el mismo beat del video).
  const glitchPeriod = 5.2;
  const tGlitch = currentTime % glitchPeriod;
  const glitchActive = tGlitch > glitchPeriod - 0.34;
  const glitchSeed = Math.floor(currentTime / glitchPeriod);

  const osd: React.CSSProperties = {
    position: "absolute",
    fontFamily: "'Courier New', Consolas, monospace",
    fontWeight: 700,
    color: "#f2f2ea",
    textShadow: "0 0 6px rgba(240,240,220,0.9), 2px 0 0 rgba(255,60,60,0.35), -2px 0 0 rgba(60,255,255,0.35)",
    letterSpacing: "0.08em",
    transform: `translate(${jx}px, ${jy}px)`,
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Scanlines CRT */}
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 2px, transparent 2px, transparent 5px)",
          mixBlendMode: "multiply",
          opacity: 0.55,
        }}
      />
      {/* Viñeta de tubo + leve halo cálido en el centro */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 105% 100% at 50% 50%, transparent 58%, rgba(10,8,4,0.42) 100%)",
        }}
      />
      {/* Flicker de brillo */}
      <AbsoluteFill style={{ background: "#fff", opacity: flicker, mixBlendMode: "overlay" }} />

      {/* Tracking glitch: 2 bandas que saltan con tinte RGB + ruido abajo */}
      {glitchActive && (
        <>
          {[0, 1].map((k) => {
            const y = 12 + random(`vhs-gy-${glitchSeed}-${k}`) * 70;
            const h = 2.5 + random(`vhs-gh-${glitchSeed}-${k}`) * 5;
            const dx = (random(`vhs-gx-${glitchSeed}-${k}-${frame % 3}`) - 0.5) * 46;
            return (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: `${y}%`,
                  height: `${h}%`,
                  transform: `translateX(${dx}px) scaleY(1.06)`,
                  background:
                    "linear-gradient(90deg, rgba(255,70,70,0.16), rgba(240,240,240,0.1) 50%, rgba(70,255,240,0.16))",
                  backdropFilter: "none",
                  mixBlendMode: "screen",
                }}
              />
            );
          })}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "3.2%",
              opacity: 0.5,
              mixBlendMode: "screen",
              background:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='40'><filter id='n'><feTurbulence type='turbulence' baseFrequency='0.9 0.25' numOctaves='2'/></filter><rect width='300' height='40' filter='url(%23n)'/></svg>\")",
            }}
          />
        </>
      )}

      {/* OSD: ► PLAY + contador (abajo-izquierda) y ● REC (arriba-derecha) */}
      <div style={{ ...osd, left: 54, bottom: 96, fontSize: 34 }}>
        {"▶"} PLAY {counter}
      </div>
      <div
        style={{
          ...osd,
          right: 54,
          top: 64,
          fontSize: 34,
          color: recOn ? "#f2f2ea" : "rgba(242,242,234,0.25)",
        }}
      >
        <span style={{ color: recOn ? "#ff3b30" : "rgba(255,59,48,0.25)" }}>{"●"}</span> REC
      </div>
    </AbsoluteFill>
  );
};
