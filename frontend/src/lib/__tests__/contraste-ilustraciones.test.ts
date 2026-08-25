/**
 * Que el color elegido SOBREVIVA y se vea.
 *
 * Reportado con capturas: en el estilo editorial los íconos salían casi
 * transparentes, fundidos con el lienzo crema. La causa era el umbral de
 * contraste, que estaba en 2 — muy por debajo del 3:1 que WCAG 2.1 pide para
 * elementos gráficos (criterio 1.4.11). Medido contra el crema del tema:
 *
 *     fucsia 2.56 · violeta 2.63 · rosa 2.60 · azul 2.46
 *
 * Los cuatro pasaban el filtro y no se veían. Y los que NO pasaban (ámbar 1.61,
 * verde 1.86) se veían bien, porque caían al color del texto: el filtro
 * premiaba justo al revés de lo que hacía falta.
 *
 * La regla que pidió el usuario, y que estos tests cuidan: si se elige un color,
 * la ilustración sale DE ESE COLOR y contrasta. No gris, no un color distinto —
 * el mismo tono, con la luminosidad que haga falta.
 */
import { describe, it, expect } from "vitest";
import { illustrationAccent } from "../../../../remotion/src/layers/editorial-layer";

const CREMA = "#FDFBF5";
const TINTA = "#1a1a1a";
const OSCURO = "#0E1116";

/** Contraste WCAG entre dos colores (mismo cálculo que el layer). */
function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const ch = (i: number) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  };
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Tono en grados (0-360). Sirve para comprobar que el color no cambió de familia. */
function tono(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let x: number;
  if (max === r) x = ((g - b) / d) % 6;
  else if (max === g) x = (b - r) / d + 2;
  else x = (r - g) / d + 4;
  x *= 60;
  return x < 0 ? x + 360 : x;
}

// Los seis acentos que el sistema rota, y el fucsia del reporte.
const ACENTOS = {
  verde: "#34d399",
  ambar: "#fbbf24",
  azul: "#60a5fa",
  fucsia: "#f472b6",
  violeta: "#a78bfa",
  rosa: "#fb7185",
};

describe("el acento de las ilustraciones siempre se ve", () => {
  for (const [nombre, color] of Object.entries(ACENTOS)) {
    it(`${nombre} contrasta sobre el lienzo crema`, () => {
      const salida = illustrationAccent(color, CREMA, TINTA);
      expect(contraste(salida, CREMA)).toBeGreaterThanOrEqual(3);
    });

    it(`${nombre} conserva su tono (no se convierte en gris ni en otro color)`, () => {
      const salida = illustrationAccent(color, CREMA, TINTA);
      const diferencia = Math.abs(tono(salida) - tono(color));
      expect(Math.min(diferencia, 360 - diferencia)).toBeLessThanOrEqual(8);
    });
  }

  it("sobre fondo oscuro aclara en vez de oscurecer", () => {
    // Un acento oscuro sobre lienzo oscuro tiene que IRSE hacia la luz.
    const salida = illustrationAccent("#3b0764", OSCURO, "#E8ECF3");
    expect(contraste(salida, OSCURO)).toBeGreaterThanOrEqual(3);
  });

  it("un color que ya contrasta se devuelve intacto", () => {
    const bueno = "#7a1040";
    expect(contraste(bueno, CREMA)).toBeGreaterThanOrEqual(3);
    expect(illustrationAccent(bueno, CREMA, TINTA)).toBe(bueno);
  });

  it("un gris cae al color del texto: no hay tono que conservar", () => {
    expect(illustrationAccent("#9a9a9a", CREMA, TINTA)).toBe(TINTA);
  });

  it("sin acento cae al color del texto", () => {
    expect(illustrationAccent("", CREMA, TINTA)).toBe(TINTA);
  });
});
