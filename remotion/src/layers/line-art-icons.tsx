import React from "react";
import * as Lucide from "lucide-react";

/**
 * EDITORIAL — Ilustraciones LINE-ART animadas (trazo crema + acentos del color
 * elegido, con glow, estilo "grabado a mano"). Dos fases por ícono:
 *   1. DRAW-ON: el contorno se dibuja solo (strokeDashoffset 0→fin en ~1.2s).
 *   2. LOOP: vida infinita sutil (manecillas, partículas, pulsos, engranajes…).
 * 100% SVG procedural — cero assets. 18 ilustraciones.
 */
export type LineArtKind =
  | "clock" | "calendar" | "funnel" | "faucet" | "radar" | "chart"
  | "lightbulb" | "target" | "rocket" | "brain" | "lock" | "megaphone"
  | "scale" | "gears" | "trophy" | "route" | "fire" | "hourglass"
  | "money" | "diamond" | "eye" | "mountain" | "magnet" | "compass"
  | "network" | "shield" | "coin" | "heart";

export const LINE_ART_KINDS: LineArtKind[] = [
  "clock", "calendar", "funnel", "faucet", "radar", "chart",
  "lightbulb", "target", "rocket", "brain", "lock", "megaphone",
  "scale", "gears", "trophy", "route", "fire", "hourglass",
  "money", "diamond", "eye", "mountain", "magnet", "compass",
  "network", "shield", "coin", "heart",
];

// Trazo base por DEFECTO (crema) — pensado para fondo OSCURO. En editorial se pasa
// `ink` = color del TEXTO del tema para que la ilustración contraste con el fondo:
// en fondo claro (cream/riso) el crema desaparecía ("ilustraciones blancas en fondo
// blanco"); con el color del texto siempre se ve (oscuro sobre claro, claro sobre oscuro).
const DEFAULT_INK = "#e9e2d4"; // crema (fondo oscuro)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** kebab/lower → PascalCase de lucide ("trending-up" → "TrendingUp"). */
function toPascal(name: string): string {
  return name
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

/**
 * LINE-ART GENÉRICO sobre los 1,500+ íconos de Lucide: cualquier ícono se vuelve
 * una ilustración editorial — trazo crema, draw-on aproximado (dash/offset por
 * CSS sobre todos los paths), flotación sutil y nodo de acento dorado latiendo.
 * Así el generador puede pedir CUALQUIER concepto sin dibujarlo a mano.
 */
export const LineArtLucide: React.FC<{
  name: string;
  elapsed: number;
  size?: number;
  gold?: string;
  /** Color del TRAZO (default crema, para fondo oscuro). En editorial = color del
   *  texto del tema → contrasta con fondos claros (antes salía blanco sobre blanco). */
  ink?: string;
}> = ({ name, elapsed, size = 300, gold = "#f0b429", ink = DEFAULT_INK }) => {
  const Cmp = (Lucide as unknown as Record<string, React.ComponentType<{
    size?: number; color?: string; strokeWidth?: number; absoluteStrokeWidth?: boolean;
  }>>)[toPascal(name)];
  if (!Cmp) return null;
  const p = clamp01(elapsed / 1.2);
  const ease = 1 - Math.pow(1 - p, 3);
  // dasharray 130 cubre los paths de un viewBox 24x24; offset uniforme aproximado.
  const off = 130 * (1 - ease);
  const float = Math.sin(elapsed * 1.6) * (size * 0.012);
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.6);
  const cls = `la-luc-${Math.abs(name.length * 7 + name.charCodeAt(0))}`;
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: `translateY(${float}px)`,
        filter: `drop-shadow(0 0 14px ${gold}55) drop-shadow(0 0 3px ${gold}33)`,
        position: "relative",
      }}
      className={cls}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `.${cls} svg * { stroke-dasharray: 130; stroke-dashoffset: ${off.toFixed(2)}; }`,
        }}
      />
      <Cmp size={size} color={ink} strokeWidth={1.4} />
      {/* nodo de acento que late (vida infinita, como los dibujados a mano) */}
      <div
        style={{
          position: "absolute",
          right: size * 0.1,
          top: size * 0.1,
          width: size * 0.07,
          height: size * 0.07,
          borderRadius: "50%",
          background: gold,
          opacity: clamp01((elapsed - 1.2) / 0.4) * (0.5 + pulse * 0.5),
          boxShadow: `0 0 ${size * 0.06}px ${gold}`,
        }}
      />
    </div>
  );
};

export function drawProps(len: number, elapsed: number, delay = 0, drawIn = 1.1) {
  const p = clamp01((elapsed - delay) / drawIn);
  return { strokeDasharray: len, strokeDashoffset: len * (1 - p), opacity: p > 0 ? 1 : 0 };
}

export const LineArtIcon: React.FC<{
  kind: LineArtKind;
  elapsed: number;
  size?: number;
  /** Color de acento (default dorado clásico). */
  gold?: string;
  /** Color del TRAZO base (default crema). En editorial = color del texto del tema
   *  → contrasta con fondos claros (antes salía blanco sobre blanco). */
  ink?: string;
}> = ({ kind, elapsed, size = 300, gold = "#f0b429", ink = DEFAULT_INK }) => {
  const GOLD = gold;
  // Alias local: todo el cuerpo dibuja el trazo base con `STROKE`; ahora = `ink`
  // (color del texto en editorial claro) en vez del crema fijo.
  const STROKE = ink;
  const common: React.SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 200 200",
    fill: "none",
    style: { filter: `drop-shadow(0 0 14px ${GOLD}55) drop-shadow(0 0 3px ${GOLD}33)` },
  };
  const base = { stroke: STROKE, strokeWidth: 2, strokeLinecap: "round" as const };
  const goldS = { stroke: GOLD, strokeWidth: 2.4, strokeLinecap: "round" as const };
  const appear = (d: number) => clamp01((elapsed - d) / 0.4);

  switch (kind) {
    case "clock": {
      const minDeg = (elapsed * 60) % 360;
      const hrDeg = (elapsed * 8) % 360;
      return (
        <svg {...common}>
          <circle cx="100" cy="108" r="58" {...base} {...drawProps(365, elapsed)} />
          <circle cx="100" cy="108" r="48" {...base} strokeWidth={1.4} {...drawProps(302, elapsed, 0.25)} />
          <path d="M92 46 q8 -14 16 0 M96 46 v-8 M104 46 v-8" {...base} {...drawProps(60, elapsed, 0.5)} />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            return (
              <line key={i} x1={100 + Math.sin(a) * 42} y1={108 - Math.cos(a) * 42}
                x2={100 + Math.sin(a) * 46} y2={108 - Math.cos(a) * 46}
                {...base} strokeWidth={1.4} {...drawProps(6, elapsed, 0.7 + i * 0.04, 0.3)} />
            );
          })}
          <g opacity={appear(1.0)}>
            <line x1="100" y1="108" x2="100" y2="76" {...goldS} transform={`rotate(${hrDeg} 100 108)`} />
            <line x1="100" y1="108" x2="100" y2="68" {...goldS} strokeWidth={1.8} transform={`rotate(${minDeg} 100 108)`} />
            <circle cx="100" cy="108" r="3" fill={GOLD} />
          </g>
        </svg>
      );
    }
    case "calendar": {
      const pulse = 0.55 + 0.45 * Math.sin(elapsed * 2.4);
      return (
        <svg {...common}>
          <rect x="40" y="48" width="120" height="110" rx="4" {...base} {...drawProps(460, elapsed)} />
          <line x1="40" y1="64" x2="160" y2="64" {...base} strokeWidth={1.4} {...drawProps(120, elapsed, 0.3)} />
          {Array.from({ length: 5 }).map((_, r) =>
            Array.from({ length: 7 }).map((__, c) => {
              const hl = r === 2;
              return (
                <rect key={`${r}-${c}`} x={46 + c * 16} y={70 + r * 17} width={12} height={13} rx={1.5}
                  stroke={hl ? GOLD : STROKE} strokeWidth={hl ? 1.8 : 1}
                  opacity={hl ? pulse : clamp01((elapsed - 0.5 - (r * 7 + c) * 0.02) / 0.3) * 0.8}
                  fill={hl ? `${GOLD}22` : "none"} />
              );
            })
          )}
          <path d="M38 100 q-8 6 0 12 q-8 6 0 12" {...goldS} fill="none" opacity={pulse} />
          <path d="M162 100 q8 6 0 12 q8 6 0 12" {...goldS} fill="none" opacity={pulse} />
        </svg>
      );
    }
    case "funnel":
      return (
        <svg {...common}>
          <path d="M50 50 L150 50 L110 110 L110 140 L90 140 L90 110 Z" {...base} {...drawProps(420, elapsed)} />
          {Array.from({ length: 26 }).map((_, i) => {
            const seed = (i * 9301 + 49297) % 233280;
            const rx = (seed / 233280) * 88 + 56;
            const ry = (((seed * 7) % 100) / 100) * 16 + 56 + Math.sin(elapsed * 2 + i) * 2;
            return <circle key={i} cx={rx} cy={ry} r={1.8} fill={STROKE} opacity={clamp01((elapsed - 0.8 - i * 0.03) / 0.3) * 0.85} />;
          })}
          {Array.from({ length: 3 }).map((_, i) => {
            const t = (elapsed * 0.9 + i * 0.33) % 1;
            return <circle key={`d-${i}`} cx={100} cy={148 + t * 38} r={2.6} fill={GOLD} opacity={appear(1.2) * (1 - t)} />;
          })}
        </svg>
      );
    case "faucet":
      return (
        <svg {...common}>
          <path d="M70 48 h36 q14 0 14 14 v10" {...base} {...drawProps(120, elapsed)} />
          <path d="M64 42 h12 M70 36 v12" {...base} {...drawProps(40, elapsed, 0.3)} />
          <path d="M112 72 h16 v10 h-16 z" {...base} {...drawProps(60, elapsed, 0.45)} />
          <path d="M76 130 L84 168 L124 168 L132 130" {...base} {...drawProps(160, elapsed, 0.6)} />
          <ellipse cx="104" cy="130" rx="28" ry="6" {...base} {...drawProps(110, elapsed, 0.75)} />
          {Array.from({ length: 7 }).map((_, i) => {
            const t = (elapsed * 1.1 + i * 0.14) % 1;
            return <circle key={i} cx={120 + Math.sin(i * 2.4) * 5} cy={86 + t * 42} r={2.4} fill={GOLD} opacity={appear(1.0) * (0.95 - t * 0.4)} />;
          })}
          {Array.from({ length: 12 }).map((_, i) => (
            <circle key={`p-${i}`} cx={88 + (i % 5) * 8} cy={146 - Math.floor(i / 5) * 6 + Math.sin(elapsed * 3 + i) * 0.8}
              r={2.6} fill={GOLD} opacity={clamp01((elapsed - 1.3 - i * 0.05) / 0.3) * 0.9} />
          ))}
        </svg>
      );
    case "radar": {
      const pulseT = (elapsed * 0.7) % 1;
      return (
        <svg {...common}>
          {[28, 44, 60, 76].map((r, i) => (
            <circle key={r} cx="100" cy="100" r={r} {...base} strokeWidth={1.2} {...drawProps(2 * Math.PI * r, elapsed, i * 0.18)} />
          ))}
          <path d="M100 112 l-8 14 h16 z M100 112 v-22 M92 94 l8 -8 8 8" {...goldS} {...drawProps(110, elapsed, 0.7)} />
          <circle cx="100" cy="100" r={20 + pulseT * 60} stroke={GOLD} strokeWidth={1.6} opacity={(1 - pulseT) * 0.7 * appear(1.2)} fill="none" />
          {[{ a: 0.6, r: 60 }, { a: 2.4, r: 76 }, { a: 4.0, r: 44 }, { a: 5.2, r: 76 }].map((d, i) => {
            const ang = d.a + elapsed * 0.15;
            return <rect key={i} x={100 + Math.cos(ang) * d.r - 5} y={100 + Math.sin(ang) * d.r - 3.5} width={10} height={7} rx={1.5} {...base} strokeWidth={1.4} opacity={appear(1.0 + i * 0.1)} />;
          })}
        </svg>
      );
    }
    case "lightbulb": {
      const glow = 0.5 + 0.5 * Math.sin(elapsed * 2.6);
      return (
        <svg {...common}>
          <path d="M100 44 a36 36 0 0 1 18 67 q-4 3 -4 9 v6 h-28 v-6 q0 -6 -4 -9 a36 36 0 0 1 18 -67 z" {...base} {...drawProps(280, elapsed)} />
          <path d="M90 134 h20 M92 142 h16 M96 150 h8" {...base} strokeWidth={1.6} {...drawProps(60, elapsed, 0.5)} />
          <path d="M93 104 q7 -10 14 0 M100 109 v12" {...goldS} {...drawProps(50, elapsed, 0.8)} />
          {/* rayos que laten */}
          {Array.from({ length: 7 }).map((_, i) => {
            const a = ((i * 30 - 90) * Math.PI) / 180;
            return (
              <line key={i} x1={100 + Math.cos(a) * 48} y1={80 + Math.sin(a) * 48}
                x2={100 + Math.cos(a) * (58 + glow * 6)} y2={80 + Math.sin(a) * (58 + glow * 6)}
                {...goldS} strokeWidth={2} opacity={appear(1.2) * glow} />
            );
          })}
        </svg>
      );
    }
    case "target": {
      const hit = clamp01((elapsed - 1.3) / 0.25);
      const ringT = (elapsed * 0.8) % 1;
      return (
        <svg {...common}>
          {[58, 42, 26].map((r, i) => (
            <circle key={r} cx="100" cy="104" r={r} {...base} {...drawProps(2 * Math.PI * r, elapsed, i * 0.2)} />
          ))}
          <circle cx="100" cy="104" r="9" stroke={GOLD} strokeWidth={2} fill={`${GOLD}33`} opacity={appear(0.8)} />
          {/* flecha que llega */}
          <g opacity={appear(1.1)} transform={`translate(${(1 - hit) * 70} ${-(1 - hit) * 70})`}>
            <line x1="104" y1="100" x2="138" y2="66" {...goldS} />
            <path d="M138 66 l10 -2 -4 -8 z M134 78 l8 -8 M126 74 l8 -8" {...goldS} strokeWidth={1.8} />
          </g>
          <circle cx="100" cy="104" r={12 + ringT * 40} stroke={GOLD} strokeWidth={1.4} fill="none" opacity={hit * (1 - ringT) * 0.6} />
        </svg>
      );
    }
    case "rocket": {
      const wob = Math.sin(elapsed * 6) * 1.5;
      return (
        <svg {...common}>
          <g transform={`translate(0 ${wob})`}>
            <path d="M100 38 q22 26 12 70 l-24 0 q-10 -44 12 -70 z" {...base} {...drawProps(220, elapsed)} />
            <circle cx="100" cy="78" r="9" {...base} strokeWidth={1.6} {...drawProps(57, elapsed, 0.4)} />
            <path d="M88 96 q-16 8 -14 26 q10 -8 16 -8 M112 96 q16 8 14 26 q-10 -8 -16 -8" {...base} {...drawProps(120, elapsed, 0.6)} />
          </g>
          {/* llama que parpadea */}
          <path d={`M94 ${112 + wob} q6 ${14 + Math.sin(elapsed * 9) * 5} 6 ${20 + Math.sin(elapsed * 7) * 6} q6 -${8 + Math.sin(elapsed * 8) * 4} 6 -${20 + Math.sin(elapsed * 9) * 5}`}
            {...goldS} fill="none" opacity={appear(1.0) * (0.7 + 0.3 * Math.sin(elapsed * 11))} />
          {/* líneas de velocidad */}
          {[64, 136].map((x, i) => (
            <line key={x} x1={x} y1={120 + ((elapsed * 60 + i * 25) % 40)} x2={x} y2={132 + ((elapsed * 60 + i * 25) % 40)} {...base} strokeWidth={1.4} opacity={appear(1.2) * 0.6} />
          ))}
        </svg>
      );
    }
    case "brain": {
      const pulse = 0.6 + 0.4 * Math.sin(elapsed * 2.2);
      return (
        <svg {...common}>
          <path d="M96 52 q-26 -6 -30 18 q-18 6 -10 26 q-12 14 4 26 q0 20 22 18 q6 12 18 6 l0 -92 q-2 -2 -4 -2 z" {...base} {...drawProps(330, elapsed)} />
          <path d="M104 52 q26 -6 30 18 q18 6 10 26 q12 14 -4 26 q0 20 -22 18 q-6 12 -18 6 l0 -92 q2 -2 4 -2 z" {...base} {...drawProps(330, elapsed, 0.2)} />
          <line x1="100" y1="54" x2="100" y2="146" {...base} strokeWidth={1.4} {...drawProps(92, elapsed, 0.5)} />
          {/* sinapsis doradas que laten */}
          {[[82, 80], [78, 108], [88, 128], [118, 80], [122, 108], [112, 128]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={2.4 + pulse * 1.2} fill={GOLD} opacity={appear(1.0 + i * 0.08) * (0.5 + 0.5 * Math.sin(elapsed * 3 + i * 1.3))} />
          ))}
        </svg>
      );
    }
    case "lock": {
      const closeP = clamp01((elapsed - 1.2) / 0.3);
      return (
        <svg {...common}>
          <rect x="64" y="92" width="72" height="64" rx="6" {...base} {...drawProps(272, elapsed)} />
          {/* arco del candado: baja y se cierra */}
          <path d="M76 92 v-14 a24 24 0 0 1 48 0 v14" {...base} {...drawProps(110, elapsed, 0.4)}
            transform={`translate(0 ${-(1 - closeP) * 10})`} />
          <circle cx="100" cy="118" r="8" {...goldS} fill="none" opacity={appear(1.0)} />
          <line x1="100" y1="124" x2="100" y2="138" {...goldS} opacity={appear(1.1)} />
          {/* destello al cerrar */}
          <circle cx="100" cy="118" r={10 + ((elapsed * 0.9) % 1) * 26} stroke={GOLD} strokeWidth={1.2} fill="none" opacity={closeP * (1 - ((elapsed * 0.9) % 1)) * 0.5} />
        </svg>
      );
    }
    case "megaphone": {
      return (
        <svg {...common}>
          <path d="M56 92 v24 l14 0 36 22 v-68 l-36 22 z" {...base} {...drawProps(250, elapsed)} />
          <path d="M62 116 l6 26 h14 l-6 -26" {...base} {...drawProps(80, elapsed, 0.4)} />
          {/* ondas de sonido doradas en loop */}
          {[0, 1, 2].map((i) => {
            const t = (elapsed * 0.8 + i * 0.33) % 1;
            return <path key={i} d={`M${116 + t * 26} ${100 - 14 - t * 10} a ${18 + t * 22} ${18 + t * 22} 0 0 1 0 ${28 + t * 20}`} stroke={GOLD} strokeWidth={2} fill="none" opacity={appear(0.9) * (1 - t)} />;
          })}
        </svg>
      );
    }
    case "scale": {
      const tilt = Math.sin(elapsed * 1.4) * 5;
      return (
        <svg {...common}>
          <line x1="100" y1="52" x2="100" y2="150" {...base} {...drawProps(98, elapsed)} />
          <path d="M76 150 h48" {...base} {...drawProps(48, elapsed, 0.3)} />
          <g transform={`rotate(${tilt} 100 64)`} opacity={appear(0.6)}>
            <line x1="56" y1="64" x2="144" y2="64" {...base} />
            <path d="M56 64 l-12 26 h24 z" {...base} strokeWidth={1.6} />
            <path d="M144 64 l-12 26 h24 z" {...base} strokeWidth={1.6} />
            <circle cx="56" cy="64" r="2.4" fill={GOLD} />
            <circle cx="144" cy="64" r="2.4" fill={GOLD} />
          </g>
          <circle cx="100" cy="56" r="4" stroke={GOLD} strokeWidth={2} fill="none" opacity={appear(0.8)} />
        </svg>
      );
    }
    case "gears": {
      const rot = elapsed * 40;
      const tooth = (cx: number, cy: number, r: number, n: number, deg: number, golden: boolean) => (
        <g transform={`rotate(${deg} ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} stroke={golden ? GOLD : STROKE} strokeWidth={2} fill="none" />
          {Array.from({ length: n }).map((_, i) => {
            const a = (i * (360 / n) * Math.PI) / 180;
            return <line key={i} x1={cx + Math.cos(a) * r} y1={cy + Math.sin(a) * r} x2={cx + Math.cos(a) * (r + 8)} y2={cy + Math.sin(a) * (r + 8)} stroke={golden ? GOLD : STROKE} strokeWidth={2.4} strokeLinecap="round" />;
          })}
          <circle cx={cx} cy={cy} r={r * 0.35} stroke={golden ? GOLD : STROKE} strokeWidth={1.6} fill="none" />
        </g>
      );
      return (
        <svg {...common}>
          <g opacity={appear(0.2)}>{tooth(82, 92, 28, 8, rot, false)}</g>
          <g opacity={appear(0.5)}>{tooth(130, 124, 18, 6, -rot * 1.5 + 14, true)}</g>
        </svg>
      );
    }
    case "trophy": {
      const shine = (elapsed * 0.6) % 1;
      return (
        <svg {...common}>
          <path d="M72 54 h56 v28 a28 28 0 0 1 -56 0 z" {...base} {...drawProps(190, elapsed)} />
          <path d="M72 60 h-14 a16 16 0 0 0 16 22 M128 60 h14 a16 16 0 0 1 -16 22" {...base} {...drawProps(110, elapsed, 0.3)} />
          <path d="M94 110 v14 h12 v-14 M82 138 h36 v8 h-36 z" {...base} {...drawProps(130, elapsed, 0.55)} />
          <path d="M92 66 l5 12 -10 0 z" fill={GOLD} opacity={appear(1.0)} transform={`translate(${shine * 26} 0)`} />
          <line x1={78 + shine * 40} y1="58" x2={86 + shine * 40} y2="84" stroke={GOLD} strokeWidth={3} opacity={(1 - shine) * 0.5 * appear(1.0)} />
        </svg>
      );
    }
    case "route": {
      const pinDrop = clamp01((elapsed - 1.5) / 0.35);
      const bounce = Math.sin(Math.min(1, pinDrop) * Math.PI) * 6;
      return (
        <svg {...common}>
          {/* ruta punteada: los guiones "marchan" en loop (dashoffset animado). */}
          <path
            d="M52 150 q30 -24 12 -44 q-16 -22 16 -34 q34 -10 30 -34"
            {...base}
            strokeWidth={2}
            strokeDasharray="7 7"
            strokeDashoffset={-elapsed * 14}
            opacity={clamp01(elapsed / 0.8)}
          />
          <circle cx="52" cy="150" r="6" {...goldS} fill={`${GOLD}33`} opacity={appear(0.3)} />
          {/* pin que cae y rebota */}
          <g opacity={appear(1.4)} transform={`translate(0 ${-(1 - pinDrop) * 40 - bounce})`}>
            <path d="M110 22 a16 16 0 0 1 16 16 q0 12 -16 28 q-16 -16 -16 -28 a16 16 0 0 1 16 -16 z" {...goldS} fill={`${GOLD}22`} />
            <circle cx="110" cy="38" r="5" {...goldS} fill="none" />
          </g>
        </svg>
      );
    }
    case "fire": {
      const f = (i: number) => Math.sin(elapsed * (7 + i * 2) + i * 2) * 4;
      return (
        <svg {...common}>
          <path d={`M100 ${44 + f(0)} q-34 36 -22 66 a34 34 0 0 0 44 0 q12 -30 -22 -66 z`} {...base} {...drawProps(240, elapsed)} />
          <path d={`M100 ${86 + f(1)} q-14 18 -8 30 a12 12 0 0 0 16 0 q6 -12 -8 -30 z`} {...goldS} fill={`${GOLD}22`} opacity={appear(0.8) * (0.75 + 0.25 * Math.sin(elapsed * 9))} />
          {Array.from({ length: 4 }).map((_, i) => {
            const t = (elapsed * 0.8 + i * 0.25) % 1;
            return <circle key={i} cx={88 + i * 9 + Math.sin(elapsed * 4 + i) * 3} cy={70 - t * 32} r={1.8} fill={GOLD} opacity={(1 - t) * 0.8 * appear(1.0)} />;
          })}
        </svg>
      );
    }
    case "hourglass": {
      const sandT = (elapsed * 0.5) % 1;
      return (
        <svg {...common}>
          <path d="M68 48 h64 M68 152 h64 M74 48 q0 34 26 52 q26 18 26 52 M126 48 q0 34 -26 52 q-26 18 -26 52" {...base} {...drawProps(330, elapsed)} />
          {/* arena cayendo */}
          {[0, 1, 2].map((i) => {
            const t = (elapsed * 1.4 + i * 0.33) % 1;
            return <circle key={i} cx={100} cy={100 + t * 38} r={1.6} fill={GOLD} opacity={appear(0.9) * (1 - t * 0.5)} />;
          })}
          {/* montículo de abajo crece */}
          <path d={`M${90 - sandT * 6} 148 q${10 + sandT * 6} -${8 + sandT * 8} ${20 + sandT * 12} 0 z`} fill={GOLD} opacity={appear(1.0) * 0.85} />
          <path d="M88 64 q12 10 24 0" stroke={GOLD} strokeWidth={2} fill="none" opacity={appear(0.8) * 0.8} />
        </svg>
      );
    }
    case "money": {
      // fajos de billetes + monedas que caen en loop.
      const coinT = (i: number) => (elapsed * 0.9 + i * 0.34) % 1;
      return (
        <svg {...common}>
          <rect x="46" y="120" width="108" height="28" rx="4" {...base} {...drawProps(280, elapsed)} />
          <rect x="54" y="102" width="92" height="22" rx="4" {...base} {...drawProps(236, elapsed, 0.2)} />
          <rect x="62" y="86" width="76" height="18" rx="4" {...base} {...drawProps(196, elapsed, 0.4)} />
          <ellipse cx="100" cy="95" rx="11" ry="7" {...goldS} fill={`${GOLD}22`} opacity={appear(0.8)} />
          <path d="M100 90 v10 M96 92 q4 -3 8 0 M96 98 q4 3 8 0" {...goldS} strokeWidth={1.6} opacity={appear(0.9)} />
          {[0, 1, 2].map((i) => (
            <g key={i} opacity={appear(1.1) * (1 - coinT(i)) * 0.95}>
              <circle cx={60 + i * 40} cy={36 + coinT(i) * 44} r={7} {...goldS} fill={`${GOLD}18`} />
              <path d={`M${60 + i * 40} ${31 + coinT(i) * 44} v10`} {...goldS} strokeWidth={1.4} />
            </g>
          ))}
        </svg>
      );
    }
    case "diamond": {
      // gema facetada + destello que orbita.
      const sa = elapsed * 1.4;
      const sx = 100 + Math.cos(sa) * 46;
      const sy = 96 + Math.sin(sa) * 34;
      const tw = 0.5 + 0.5 * Math.sin(elapsed * 5);
      return (
        <svg {...common}>
          <path d="M64 78 L100 50 L136 78 L100 152 Z" {...base} {...drawProps(330, elapsed)} />
          <path d="M64 78 h72 M100 50 L82 78 L100 152 M100 50 L118 78 L100 152" {...base} strokeWidth={1.4} {...drawProps(300, elapsed, 0.35)} />
          <path d="M88 70 L96 60" {...goldS} opacity={appear(0.9) * (0.5 + tw * 0.5)} />
          <g opacity={appear(1.2) * tw}>
            <path d={`M${sx} ${sy - 7} v14 M${sx - 7} ${sy} h14`} {...goldS} strokeWidth={1.8} />
          </g>
          <circle cx="100" cy="96" r="3" fill={GOLD} opacity={appear(1.0) * (0.4 + tw * 0.6)} />
        </svg>
      );
    }
    case "eye": {
      // ojo que observa: pupila se dilata + destello que cruza.
      const dilate = 1 + Math.sin(elapsed * 1.8) * 0.18;
      const scanT = (elapsed * 0.45) % 1;
      return (
        <svg {...common}>
          <path d="M34 100 Q100 44 166 100 Q100 156 34 100 Z" {...base} {...drawProps(400, elapsed)} />
          <circle cx="100" cy="100" r={26 * dilate} {...base} strokeWidth={1.8} {...drawProps(165, elapsed, 0.4)} />
          <circle cx="100" cy="100" r={11 * dilate} {...goldS} fill={`${GOLD}33`} opacity={appear(0.9)} />
          <circle cx={94} cy={92} r="3.5" fill={STROKE} opacity={appear(1.0) * 0.9} />
          {[0, 1, 2, 3, 4].map((i) => {
            const a = (-0.9 + i * 0.45) + Math.sin(elapsed * 2) * 0.05;
            return <line key={i} x1={100 + Math.cos(a) * 34} y1={100 + Math.sin(a) * 34} x2={100 + Math.cos(a) * 42} y2={100 + Math.sin(a) * 42} {...goldS} strokeWidth={1.5} opacity={appear(1.1 + i * 0.06) * 0.8} />;
          })}
          <line x1={40 + scanT * 120} y1="64" x2={56 + scanT * 120} y2="136" stroke={GOLD} strokeWidth={2.5} opacity={(1 - Math.abs(scanT - 0.5) * 2) * 0.35 * appear(1.3)} />
        </svg>
      );
    }
    case "mountain": {
      // cima con bandera que flamea + sol que late.
      const wave = Math.sin(elapsed * 5) * 4;
      const sun = 0.5 + 0.5 * Math.sin(elapsed * 2.2);
      return (
        <svg {...common}>
          <path d="M30 156 L86 70 L112 108 L134 78 L170 156 Z" {...base} {...drawProps(420, elapsed)} />
          <path d="M78 84 l8 -14 l9 13 l-8 5 z" {...base} strokeWidth={1.4} {...drawProps(60, elapsed, 0.5)} />
          <line x1="86" y1="70" x2="86" y2="44" {...goldS} opacity={appear(1.0)} />
          <path d={`M86 44 q12 ${wave * 0.5} 22 2 l0 12 q-10 ${-wave * 0.5 - 2} -22 -2 z`} {...goldS} fill={`${GOLD}22`} opacity={appear(1.1)} />
          <circle cx="152" cy="48" r={11 + sun * 2} {...goldS} fill={`${GOLD}18`} opacity={appear(0.8)} />
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2 + elapsed * 0.5;
            return <line key={i} x1={152 + Math.cos(a) * 16} y1={48 + Math.sin(a) * 16} x2={152 + Math.cos(a) * (20 + sun * 3)} y2={48 + Math.sin(a) * (20 + sun * 3)} {...goldS} strokeWidth={1.5} opacity={appear(1.0) * sun} />;
          })}
        </svg>
      );
    }
    case "magnet": {
      // imán en U + partículas atraídas en loop.
      return (
        <svg {...common}>
          <path d="M66 56 v52 a34 34 0 0 0 68 0 v-52 h-24 v52 a10 10 0 0 1 -20 0 v-52 z" {...base} {...drawProps(420, elapsed)} />
          <rect x="66" y="56" width="24" height="16" {...goldS} fill={`${GOLD}22`} opacity={appear(0.7)} />
          <rect x="110" y="56" width="24" height="16" {...goldS} fill={`${GOLD}22`} opacity={appear(0.7)} />
          {[0, 1, 2, 3, 4].map((i) => {
            const t = (elapsed * 0.8 + i * 0.2) % 1;
            const x0 = 40 + (i % 3) * 56;
            const y0 = 188 - (i % 2) * 10;
            const x1 = 78 + (i % 2) * 44;
            const y1 = 150;
            return <circle key={i} cx={x0 + (x1 - x0) * t} cy={y0 + (y1 - y0) * t} r={2.6} fill={GOLD} opacity={appear(1.0) * t * 0.95} />;
          })}
          <path d="M84 158 q16 10 32 0" {...goldS} strokeWidth={1.4} fill="none" opacity={appear(1.2) * (0.4 + 0.4 * Math.sin(elapsed * 3))} />
        </svg>
      );
    }
    case "compass": {
      // brújula con aguja que busca el norte (oscila y se asienta).
      const wob = Math.sin(elapsed * 2.4) * 14 * Math.exp(-elapsed * 0.35) + Math.sin(elapsed * 1.2) * 4;
      return (
        <svg {...common}>
          <circle cx="100" cy="100" r="60" {...base} {...drawProps(380, elapsed)} />
          <circle cx="100" cy="100" r="50" {...base} strokeWidth={1.2} {...drawProps(316, elapsed, 0.25)} />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * 45 * Math.PI) / 180;
            return <line key={i} x1={100 + Math.sin(a) * 44} y1={100 - Math.cos(a) * 44} x2={100 + Math.sin(a) * 50} y2={100 - Math.cos(a) * 50} {...base} strokeWidth={1.4} {...drawProps(8, elapsed, 0.6 + i * 0.05, 0.3)} />;
          })}
          <g opacity={appear(1.0)} transform={`rotate(${wob} 100 100)`}>
            <path d="M100 100 L92 112 L100 64 L108 112 Z" {...goldS} fill={`${GOLD}33`} />
            <path d="M100 100 L92 112 L100 138 L108 112 Z" {...base} strokeWidth={1.6} />
          </g>
          <circle cx="100" cy="100" r="4" fill={GOLD} opacity={appear(1.0)} />
          <path d="M96 36 h8 M100 32 v8" {...goldS} strokeWidth={1.6} opacity={appear(1.2) * (0.5 + 0.5 * Math.sin(elapsed * 2.6))} />
        </svg>
      );
    }
    case "network": {
      // red de nodos con pulsos que viajan por las aristas.
      const nodes: [number, number][] = [[100, 56], [52, 104], [148, 96], [76, 152], [132, 150]];
      const edges: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [1, 2]];
      return (
        <svg {...common}>
          {edges.map(([a, b], i) => (
            <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} {...base} strokeWidth={1.4} {...drawProps(120, elapsed, 0.15 + i * 0.12)} />
          ))}
          {nodes.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i === 0 ? 11 : 8} {...(i === 0 ? goldS : base)} fill={i === 0 ? `${GOLD}22` : "none"} opacity={appear(0.3 + i * 0.12)} />
          ))}
          {edges.map(([a, b], i) => {
            const t = (elapsed * 0.7 + i * 0.17) % 1;
            return <circle key={`p-${i}`} cx={nodes[a][0] + (nodes[b][0] - nodes[a][0]) * t} cy={nodes[a][1] + (nodes[b][1] - nodes[a][1]) * t} r={2.4} fill={GOLD} opacity={appear(1.1) * 0.9} />;
          })}
        </svg>
      );
    }
    case "shield": {
      // escudo + check que se dibuja + onda protectora.
      const ringT = (elapsed * 0.6) % 1;
      return (
        <svg {...common}>
          <path d="M100 40 L150 58 v44 q0 38 -50 58 q-50 -20 -50 -58 v-44 z" {...base} {...drawProps(360, elapsed)} />
          <path d="M100 48 L142 63 v39 q0 32 -42 49 q-42 -17 -42 -49 v-39 z" {...base} strokeWidth={1.2} {...drawProps(310, elapsed, 0.3)} />
          <path d="M78 102 L94 118 L126 84" {...goldS} strokeWidth={3} fill="none" {...drawProps(80, elapsed, 0.9, 0.6)} />
          <path d="M100 40 L150 58 v44 q0 38 -50 58 q-50 -20 -50 -58 v-44 z" stroke={GOLD} strokeWidth={1.6} fill="none" opacity={(1 - ringT) * 0.5 * appear(1.4)} transform={`translate(${-(ringT * 10)} ${-(ringT * 12)}) scale(${1 + ringT * 0.12})`} transform-origin="100 100" />
        </svg>
      );
    }
    case "coin": {
      // moneda que gira sobre su eje (scaleX oscilante) + sombra.
      const spin = Math.cos(elapsed * 2.2);
      const w = Math.abs(spin);
      return (
        <svg {...common}>
          <ellipse cx="100" cy="166" rx={34 * (0.6 + w * 0.4)} ry="6" fill={STROKE} opacity={appear(0.8) * 0.18} />
          <g transform={`translate(100 100) scale(${Math.max(0.12, w)} 1) translate(-100 -100)`}>
            <circle cx="100" cy="100" r="52" {...base} {...drawProps(330, elapsed)} />
            <circle cx="100" cy="100" r="43" {...base} strokeWidth={1.3} {...drawProps(270, elapsed, 0.25)} />
            <path d="M100 76 v48 M88 84 q12 -8 24 0 q-24 16 0 24 q-12 8 -24 0" {...goldS} strokeWidth={2.6} fill="none" opacity={appear(0.8)} />
          </g>
          {[0, 1, 2].map((i) => {
            const tw = 0.5 + 0.5 * Math.sin(elapsed * 4 + i * 2.1);
            const px = 52 + i * 48;
            const py = 48 - (i % 2) * 14;
            return <path key={i} d={`M${px} ${py - 5} v10 M${px - 5} ${py} h10`} {...goldS} strokeWidth={1.6} opacity={appear(1.2) * tw * 0.8} />;
          })}
        </svg>
      );
    }
    case "heart": {
      // corazón que late + línea de pulso EKG que lo cruza.
      const beat = 1 + Math.max(0, Math.sin(elapsed * 3.4)) ** 6 * 0.08;
      return (
        <svg {...common}>
          <g transform={`translate(100 104) scale(${beat}) translate(-100 -104)`}>
            <path d="M100 150 q-44 -30 -50 -58 a26 26 0 0 1 50 -12 a26 26 0 0 1 50 12 q-6 28 -50 58 z" {...base} {...drawProps(360, elapsed)} />
          </g>
          <path d="M40 104 h28 l8 -16 l12 30 l10 -22 l6 8 h56" {...goldS} strokeWidth={2.2} fill="none" {...drawProps(220, elapsed, 0.7, 1.2)} />
          <circle cx="160" cy="104" r="3" fill={GOLD} opacity={appear(1.6) * (0.4 + 0.6 * Math.max(0, Math.sin(elapsed * 3.4)))} />
        </svg>
      );
    }
    default: {
      // chart — línea que sube + punto dorado latiendo.
      const pulse = 0.6 + 0.4 * Math.sin(elapsed * 3);
      return (
        <svg {...common}>
          <path d="M44 156 v-104 M44 156 h116" {...base} {...drawProps(230, elapsed)} />
          <path d="M52 140 L78 118 L100 128 L126 88 L150 64" {...goldS} strokeWidth={2.6} fill="none" {...drawProps(150, elapsed, 0.5, 1.4)} />
          <circle cx="150" cy="64" r={4 * pulse + 2} fill={GOLD} opacity={appear(1.9)} />
          {[52, 78, 100, 126].map((x, i) => (
            <circle key={x} cx={x} cy={[140, 118, 128, 88][i]} r={2.2} fill={STROKE} opacity={clamp01((elapsed - 0.7 - i * 0.25) / 0.3)} />
          ))}
        </svg>
      );
    }
  }
};
