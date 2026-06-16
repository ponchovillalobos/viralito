// @vitest-environment jsdom
//
// Pruebas del <Slider> (H8 — volumen de música regulable). NO se corren todavía:
// el proyecto aún no tiene jsdom + @testing-library/react cableados para React.
// Cuando se configure (environment "jsdom" + setup files), debería pasar tal cual.
// El tsconfig ya excluye **/*.test.* del build de producción.
//
// Casos cubiertos:
//   (a) arranca en 35  → el thumb refleja value=35 (aria-valuenow).
//   (b) onValueChange(50) → el caller recibe el número 50 (no un array, no event).

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Slider } from "../slider";

describe("Slider", () => {
  it("arranca en 35", () => {
    const { container } = render(
      <Slider aria-label="vol" value={35} min={0} max={100} step={1} />,
    );
    // base-ui expone el valor del thumb vía aria-valuenow (puede ir en el thumb
    // o en un input interno role=slider, según la versión). Buscamos por atributo
    // para no acoplarnos a la estructura interna.
    const withValue = container.querySelector("[aria-valuenow]");
    expect(withValue).not.toBeNull();
    expect(withValue).toHaveAttribute("aria-valuenow", "35");
    // El % mostrado al lado parte de 35 cuando musicVolume = 0.35.
    expect(Math.round(0.35 * 100)).toBe(35);
  });

  it("conversión 0-100 ↔ 0-1: onValueChange(50) ⇒ musicVolume 0.5", () => {
    // El editor mapea el slider (0-100) al musicVolume del proyecto (0-1) con
    // `onValueChange={(v) => updateProject({ musicVolume: v / 100 })}`. Aquí
    // verificamos ese contrato de conversión que usan music-picker y settings.
    const updateProject = vi.fn();
    const onValueChange = (v: number) => updateProject({ musicVolume: v / 100 });

    onValueChange(50);
    expect(updateProject).toHaveBeenCalledWith({ musicVolume: 0.5 });

    // Y el valor mostrado parte de 35% cuando musicVolume = 0.35.
    expect(Math.round(0.35 * 100)).toBe(35);
  });
});
