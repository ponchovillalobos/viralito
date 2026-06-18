"use client";

/**
 * MINI-DEMO animada de cada estilo (UI súper visual, pedido del dueño): una
 * pantallita 9:16 que SE MUEVE mostrando qué hace el estilo — sin necesidad de
 * leer nada (apta para quien no habla español). CSS puro: cero costo de render.
 */
const KEYFRAMES = `
@keyframes smd-pop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.25); } }
@keyframes smd-shake { 0%,100% { transform: translate(0,0); } 25% { transform: translate(-2px,1px); } 75% { transform: translate(2px,-1px); } }
@keyframes smd-zoom { 0%,100% { transform: scale(1); } 50% { transform: scale(1.35); } }
@keyframes smd-bar1 { 0%,100% { height: 30%; } 50% { height: 80%; } }
@keyframes smd-bar2 { 0%,100% { height: 60%; } 50% { height: 35%; } }
@keyframes smd-bar3 { 0%,100% { height: 45%; } 50% { height: 90%; } }
@keyframes smd-aurora { 0%,100% { transform: translateX(-12%) skewY(-6deg); opacity:.7; } 50% { transform: translateX(12%) skewY(-2deg); opacity: 1; } }
@keyframes smd-mesh { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(6px,4px) scale(1.25); } }
@keyframes smd-grid { 0% { background-position: 0 0; } 100% { background-position: 0 14px; } }
@keyframes smd-slide { 0% { transform: translateY(10px); opacity: 0; } 30%,70% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-6px); opacity: 0; } }
@keyframes smd-flash { 0%,88%,100% { opacity: 0; } 92% { opacity: .85; } }
@keyframes smd-behind { 0%,100% { transform: translateX(-4px); } 50% { transform: translateX(4px); } }
@keyframes smd-grain { 0%,100% { opacity: .18; } 50% { opacity: .34; } }
@keyframes smd-cine-zoom { 0%,100% { transform: scale(1.05); } 50% { transform: scale(1.18) translateX(2px); } }
`;

function Screen({ children, bg }: { children?: React.ReactNode; bg?: string }) {
  return (
    <div
      className="relative h-20 w-12 shrink-0 overflow-hidden rounded-md border border-white/10"
      style={{ background: bg ?? "#18181b" }}
    >
      {/* "cara" del speaker, común a todas las demos */}
      <div className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 rounded-full bg-zinc-500/80" />
      <div className="absolute left-1/2 top-7 h-5 w-7 -translate-x-1/2 rounded-t-full bg-zinc-600/80" />
      {children}
    </div>
  );
}

const Caption = ({ color = "#fde047", anim = "smd-pop" }: { color?: string; anim?: string }) => (
  <div
    className="absolute bottom-3 left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-sm"
    style={{ background: color, animation: `${anim} 1.4s ease-in-out infinite` }}
  />
);

export function StyleMiniDemo({ styleId, accent }: { styleId: string; accent: string }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      {(() => {
        switch (styleId) {
          case "silent":
            return (
              <Screen>
                <div className="absolute bottom-3 left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-sm bg-white/90" />
              </Screen>
            );
          case "punch":
            return (
              <Screen>
                <Caption color={accent} anim="smd-slide" />
                <div className="absolute inset-0 bg-white" style={{ animation: "smd-flash 2.2s linear infinite" }} />
              </Screen>
            );
          case "hype":
            return (
              <Screen>
                <Caption color={accent} />
                <span className="absolute right-0.5 top-0.5 text-[9px]" style={{ animation: "smd-pop 1.2s ease-in-out infinite" }}>🔥</span>
              </Screen>
            );
          case "hype_max":
          case "hype_max_sfx":
            return (
              <Screen>
                <div className="absolute inset-0" style={{ animation: "smd-zoom 1.6s ease-in-out infinite" }}>
                  <div className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 rounded-full bg-zinc-500/80" />
                  <div className="absolute left-1/2 top-7 h-5 w-7 -translate-x-1/2 rounded-t-full bg-zinc-600/80" />
                </div>
                <Caption color={accent} anim="smd-shake" />
                {styleId === "hype_max_sfx" && (
                  <span className="absolute left-0.5 top-0.5 text-[8px]" style={{ animation: "smd-pop 1s ease-in-out infinite" }}>🎵</span>
                )}
              </Screen>
            );
          case "supreme":
            return (
              <Screen>
                <Caption color={accent} />
                <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[9px]" style={{ animation: "smd-pop 1.6s ease-in-out infinite" }}>👑</span>
                <div className="absolute bottom-0 left-0 h-0.5 w-2/3 rounded-r" style={{ background: accent }} />
              </Screen>
            );
          case "cinematic_pro":
            return (
              <Screen bg="#0c0a08">
                {/* "escena" con grade cálido teal&orange + lento zoom de cámara */}
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 38%, rgba(255,170,90,0.5), transparent 55%), linear-gradient(160deg, #0b2733, #0c0a08 70%)",
                    animation: "smd-cine-zoom 4s ease-in-out infinite",
                  }}
                >
                  <div className="absolute left-1/2 top-4 h-4 w-4 -translate-x-1/2 rounded-full bg-amber-200/70" />
                  <div className="absolute left-1/2 top-8 h-5 w-7 -translate-x-1/2 rounded-t-full bg-orange-300/40" />
                </div>
                {/* viñeta: bordes oscuros */}
                <div
                  className="absolute inset-0"
                  style={{ boxShadow: "inset 0 0 14px 6px rgba(0,0,0,0.85)" }}
                />
                {/* film grain titilando */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-radial-gradient(rgba(255,255,255,0.5) 0 0.4px, transparent 0.4px 1.4px)",
                    backgroundSize: "3px 3px",
                    animation: "smd-grain 0.25s steps(2) infinite",
                  }}
                />
                {/* barras letterbox cine arriba/abajo */}
                <div className="absolute inset-x-0 top-0 h-2 bg-black" />
                <div className="absolute inset-x-0 bottom-0 h-2 bg-black" />
                {/* subtítulo cine: barra fina con glow */}
                <div
                  className="absolute bottom-3.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-sm bg-white/95"
                  style={{ boxShadow: "0 0 6px rgba(255,255,255,0.7)", animation: "smd-slide 2.8s ease-in-out infinite" }}
                />
              </Screen>
            );
          case "broll_full":
          case "broll_pip":
            return (
              <Screen>
                <div
                  className="absolute rounded-sm border border-white/30 bg-sky-700/70"
                  style={
                    styleId === "broll_full"
                      ? { inset: 2, animation: "smd-flash 3s linear infinite reverse" }
                      : { right: 2, top: 2, width: 14, height: 18, animation: "smd-pop 2s ease-in-out infinite" }
                  }
                />
                <Caption color={accent} />
              </Screen>
            );
          case "text_behind":
            return (
              <Screen>
                <div
                  className="absolute left-1/2 top-4 -translate-x-1/2 text-[10px] font-black text-white/70"
                  style={{ animation: "smd-behind 2s ease-in-out infinite", zIndex: 0 }}
                >
                  ABC
                </div>
                <div className="absolute left-1/2 top-3 z-10 h-4 w-4 -translate-x-1/2 rounded-full bg-zinc-400" />
                <div className="absolute left-1/2 top-7 z-10 h-5 w-7 -translate-x-1/2 rounded-t-full bg-zinc-500" />
              </Screen>
            );
          case "graphics_pro":
          case "graphics_max":
            return (
              <Screen>
                <div className="absolute bottom-3 left-1.5 flex h-8 items-end gap-0.5">
                  <div className="w-1.5 rounded-t-sm" style={{ background: accent, animation: "smd-bar1 1.6s ease-in-out infinite" }} />
                  <div className="w-1.5 rounded-t-sm bg-cyan-400" style={{ animation: "smd-bar2 1.6s ease-in-out infinite" }} />
                  <div className="w-1.5 rounded-t-sm bg-violet-400" style={{ animation: "smd-bar3 1.6s ease-in-out infinite" }} />
                </div>
                {styleId === "graphics_max" && (
                  <div className="absolute inset-0" style={{ animation: "smd-shake 0.8s linear infinite" }} />
                )}
              </Screen>
            );
          case "motion_pro":
            return (
              <Screen bg="#0c0a1d">
                <div
                  className="absolute left-[-20%] top-1 h-4 w-[140%] rounded-full blur-[6px]"
                  style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, animation: "smd-aurora 2.4s ease-in-out infinite" }}
                />
                <div
                  className="absolute left-[-20%] top-5 h-3 w-[140%] rounded-full blur-[6px]"
                  style={{ background: "linear-gradient(90deg, transparent, #22d3ee, transparent)", animation: "smd-aurora 3s ease-in-out infinite reverse" }}
                />
                <Caption color="#ffffff" />
              </Screen>
            );
          case "motion_beat":
            return (
              <Screen bg="#0c0a1d">
                <div className="absolute left-1 top-1 h-7 w-7 rounded-full blur-[8px]" style={{ background: accent, animation: "smd-mesh 0.9s ease-in-out infinite" }} />
                <div className="absolute bottom-5 right-0 h-8 w-8 rounded-full blur-[8px] bg-cyan-500/80" style={{ animation: "smd-mesh 1.1s ease-in-out infinite reverse" }} />
                <Caption color="#ffffff" anim="smd-pop" />
              </Screen>
            );
          case "motion_grid":
            return (
              <Screen bg="#0a0a14">
                <div
                  className="absolute bottom-0 left-[-15%] h-1/2 w-[130%]"
                  style={{
                    transform: "perspective(60px) rotateX(55deg)",
                    transformOrigin: "bottom center",
                    backgroundImage: `linear-gradient(${accent}99 1px, transparent 1px), linear-gradient(90deg, #22d3ee99 1px, transparent 1px)`,
                    backgroundSize: "7px 7px",
                    animation: "smd-grid 1.2s linear infinite",
                  }}
                />
                <Caption color="#ffffff" />
              </Screen>
            );
          case "editorial":
            return (
              <Screen bg="#0a0908">
                {/* panel de video a la derecha */}
                <div className="absolute right-1 top-2 h-16 w-4 overflow-hidden rounded-sm border border-white/15 bg-zinc-700/70">
                  <div className="absolute left-1/2 top-2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-zinc-400" />
                  <div className="absolute left-1/2 top-4 h-2 w-2.5 -translate-x-1/2 rounded-t-full bg-zinc-500" />
                </div>
                {/* titulares serif a la izquierda */}
                <div className="absolute left-1 top-4 space-y-1">
                  <div className="h-0.5 w-3 bg-zinc-500" />
                  <div className="h-1.5 w-6 rounded-sm bg-white/90" style={{ animation: "smd-slide 2.6s ease-in-out infinite" }} />
                  <div className="h-1.5 w-5 rounded-sm" style={{ background: "#f0b429", animation: "smd-slide 2.6s ease-in-out infinite", animationDelay: "0.15s" }} />
                  <div className="h-0.5 w-4 bg-zinc-600" />
                </div>
                {/* line-art dorado abajo */}
                <div className="absolute bottom-2 left-2 h-3 w-3 rounded-full border" style={{ borderColor: "#f0b429", animation: "smd-pop 2s ease-in-out infinite" }} />
              </Screen>
            );
          case "kinetic_type":
            return (
              <Screen bg="#0c0a1d">
                {/* fondo mesh que late */}
                <div className="absolute left-1 top-1 h-7 w-7 rounded-full blur-[8px]" style={{ background: accent, animation: "smd-mesh 0.9s ease-in-out infinite" }} />
                <div className="absolute bottom-5 right-0 h-8 w-8 rounded-full blur-[8px] bg-violet-500/80" style={{ animation: "smd-mesh 1.1s ease-in-out infinite reverse" }} />
                {/* caption GIGANTE palabra-por-palabra */}
                <div
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] font-black tracking-tight text-white"
                  style={{ animation: "smd-pop 0.9s ease-in-out infinite" }}
                >
                  AB
                </div>
              </Screen>
            );
          case "lottie_pop":
            return (
              <Screen bg="#0c0a1d">
                {/* aurora */}
                <div
                  className="absolute left-[-20%] top-1 h-4 w-[140%] rounded-full blur-[6px]"
                  style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, animation: "smd-aurora 2.4s ease-in-out infinite" }}
                />
                {/* stickers animados (Lottie) */}
                <span className="absolute right-0.5 top-0.5 text-[9px]" style={{ animation: "smd-pop 1s ease-in-out infinite" }}>✨</span>
                <span className="absolute left-0.5 top-5 text-[8px]" style={{ animation: "smd-pop 1.3s ease-in-out infinite" }}>⭐</span>
                <Caption color={accent} anim="smd-pop" />
              </Screen>
            );
          case "paper_cut":
            return (
              <Screen bg="#f1ece0">
                {/* panel de papel recortado a la izquierda */}
                <div className="absolute left-1 top-2 h-16 w-4 overflow-hidden rounded-sm border border-black/15 bg-zinc-400/70 shadow-[2px_2px_0_rgba(0,0,0,0.25)]">
                  <div className="absolute left-1/2 top-2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-zinc-600" />
                  <div className="absolute left-1/2 top-4 h-2 w-2.5 -translate-x-1/2 rounded-t-full bg-zinc-700" />
                </div>
                {/* titulares serif a la derecha */}
                <div className="absolute right-1 top-4 space-y-1 text-right">
                  <div className="ml-auto h-1.5 w-6 rounded-sm bg-zinc-900/90" style={{ animation: "smd-slide 2.6s ease-in-out infinite" }} />
                  <div className="ml-auto h-1.5 w-5 rounded-sm" style={{ background: "#FF48B0", animation: "smd-slide 2.6s ease-in-out infinite", animationDelay: "0.15s" }} />
                  <div className="ml-auto h-0.5 w-4 bg-zinc-500" />
                </div>
              </Screen>
            );
          default:
            return <Screen><Caption color={accent} /></Screen>;
        }
      })()}
    </>
  );
}
