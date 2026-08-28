import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Las partículas de los picos emocionales respetan la regla mono-color.
 *
 * `particleBurstSchema` trae `colors` con una paleta de CINCO por omisión, y
 * la capa reparte un color distinto por partícula (`colors[i % colors.length]`).
 * Los dos directores emocionales emitían el burst sin ese campo, así que todo
 * video con un pico >= 0.6 salía con cinco colores en pantalla — el "chile mole
 * y pozole" que la regla del proyecto prohíbe explícitamente.
 *
 * No daba error, no rompía el render, y sólo se ve mirando el video con
 * atención. Por eso se vigila desde el código.
 *
 * Hay DOS implementaciones del mismo director —una en TS para cortos y otra en
 * Python para largos, la segunda declarada "paridad con shorts"— y la corrección
 * tenía que ir en las dos. Este test mira las dos.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf-8");

const CORTOS = join("frontend", "src", "app", "api", "editor", "auto-build", "lib", "fx-enrichments.ts");
const LARGOS = join("python", "long_form_pipeline.py");

/** El bloque que emite el burst, en cada implementación. */
function bloqueDelBurst(rel: string): string {
  const src = leer(rel);
  const i = src.indexOf("particleBursts");
  expect(i, `${rel} ya no emite particleBursts`).toBeGreaterThan(-1);
  return src.slice(Math.max(0, i - 1800), i + 900);
}

describe("partículas: un solo color y variedad por tono", () => {
  for (const [nombre, rel] of [["cortos", CORTOS], ["largos", LARGOS]] as const) {
    it(`${nombre}: el burst lleva el acento del video, no la paleta por omisión`, () => {
      const b = bloqueDelBurst(rel);
      expect(
        /colors/.test(b),
        `${rel} emite el burst sin \`colors\`: la capa cae a su paleta de CINCO ` +
          "y cada partícula toma un color distinto. Rompe la regla mono-color.",
      ).toBe(true);
      expect(/accentColor|acento/.test(b), `${rel} no usa el acento del video`).toBe(true);
    });

    it(`${nombre}: la partícula depende del tono, no es siempre la misma`, () => {
      const b = bloqueDelBurst(rel);
      // "tension" es alto arousal con valencia NEGATIVA: confeti ahí lee como burla.
      for (const kind of ["confetti", "embers", "sparks"]) {
        expect(b.includes(kind), `${rel} nunca elige "${kind}"`).toBe(true);
      }
      expect(/tension/.test(b), `${rel} no distingue el mood "tension"`).toBe(true);
    });
  }

  it("las dos implementaciones eligen la misma partícula para el mismo tono", () => {
    // Paridad real, no declarada: el mapeo mood -> kind debe coincidir.
    const mapa = (b: string) => ({
      hype: /hype[^\n]*confetti|confetti[^\n]*hype/.test(b),
      tension: /tension[^\n]*embers|embers[^\n]*tension/.test(b),
    });
    expect(mapa(bloqueDelBurst(CORTOS))).toEqual(mapa(bloqueDelBurst(LARGOS)));
    expect(mapa(bloqueDelBurst(CORTOS))).toEqual({ hype: true, tension: true });
  });
});
