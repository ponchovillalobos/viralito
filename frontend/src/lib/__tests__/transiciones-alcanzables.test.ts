import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Las transiciones de los inserts viven escritas TRES veces:
 *
 *   1. `remotion/src/cinematic-layers.tsx` — el enum de Zod que valida el prop
 *      y el `switch` que efectivamente dibuja cada una.
 *   2. `frontend/src/lib/overlays-store.ts` — el union de TypeScript.
 *   3. `python/cinematic_assembly.py` — la lista dentro del prompt del agente
 *      VFX, que es lo UNICO que el modelo local llega a leer.
 *
 * Las tres tienen que decir lo mismo, y por un motivo asimetrico: una
 * transicion que falta en (3) queda IMPLEMENTADA PERO INALCANZABLE — compila,
 * pasa los tipos, no da ningun error, y simplemente nunca se elige. Es
 * exactamente la clase de falla que este proyecto ya documento como la mas
 * cara: el sistema entrega video igual, solo que peor.
 *
 * `escala_medida` estuvo asi: en el enum y en el switch, ausente del prompt.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");

function leer(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf-8");
}

function transicionesDelEnumZod(): string[] {
  const src = leer(join("remotion", "src", "cinematic-layers.tsx"));
  const m = src.match(/transitionIn:\s*z\s*\.enum\(\[([^\]]+)\]\)/);
  if (!m) throw new Error("no encontre el enum de transitionIn en cinematic-layers.tsx");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function transicionesDelUnionTs(): string[] {
  const src = leer(join("frontend", "src", "lib", "overlays-store.ts"));
  const m = src.match(/export type OverlayTransition =([\s\S]*?);/);
  if (!m) throw new Error("no encontre OverlayTransition en overlays-store.ts");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function transicionesDelPrompt(): string[] {
  const src = leer(join("python", "cinematic_assembly.py"));
  const m = src.match(/Transitions \(entrada\/salida\):([\s\S]*?)\n\s*\n/);
  if (!m) throw new Error("no encontre el bloque 'Transitions' en cinematic_assembly.py");
  // Solo las lineas que ABREN una entrada de la lista ("  - nombre : ..."),
  // no las de continuacion de una descripcion multilinea.
  return [...m[1].matchAll(/^\s*-\s+([a-z_]+)\s*:/gm)].map((x) => x[1]);
}

describe("transiciones de inserts: las tres copias dicen lo mismo", () => {
  it("el switch que dibuja las transiciones cubre todo el enum", () => {
    const src = leer(join("remotion", "src", "cinematic-layers.tsx"));
    for (const t of transicionesDelEnumZod()) {
      if (t === "fade") continue; // fade es el `default` del switch, no un case
      expect(src, `"${t}" esta en el enum pero no tiene case en el switch`).toContain(
        `case "${t}"`,
      );
    }
  });

  it("el union de TS tiene exactamente las mismas transiciones que el enum", () => {
    expect(transicionesDelUnionTs().sort()).toEqual(transicionesDelEnumZod().sort());
  });

  it("el prompt del agente VFX ofrece todas las transiciones implementadas", () => {
    const implementadas = transicionesDelEnumZod().sort();
    const ofrecidas = transicionesDelPrompt().sort();
    const inalcanzables = implementadas.filter((t) => !ofrecidas.includes(t));
    expect(
      inalcanzables,
      `implementadas pero ausentes del prompt (el modelo nunca las elegira): ${inalcanzables.join(", ")}`,
    ).toEqual([]);
  });

  it("el prompt no ofrece transiciones que no existan", () => {
    const implementadas = transicionesDelEnumZod();
    const inventadas = transicionesDelPrompt().filter((t) => !implementadas.includes(t));
    expect(
      inventadas,
      `el prompt las ofrece pero Zod las rechazaria: ${inventadas.join(", ")}`,
    ).toEqual([]);
  });

  it("escala_medida quedo alcanzable en las tres capas", () => {
    expect(transicionesDelEnumZod()).toContain("escala_medida");
    expect(transicionesDelUnionTs()).toContain("escala_medida");
    expect(transicionesDelPrompt()).toContain("escala_medida");
  });
});
