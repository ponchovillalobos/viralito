import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EDITORIAL_THEMES } from "../editorial-themes";
import { BROLL_SOURCES } from "../broll-sources";

/**
 * Los catálogos que ven los DOS wizards viven en un módulo compartido, nunca
 * copiados dentro de un wizard.
 *
 * No es preferencia de estilo. `EDITORIAL_THEMES` estuvo escrito dos veces, y
 * las copias ya se habían separado sin que nadie lo notara: los mismos 20
 * temas en distinto orden, y la de largos **sin el campo `hint`**. Resultado
 * real: quien procesaba un video largo elegía entre 20 nombres sin una línea
 * que explicara qué era cada uno. No hay error, no hay test rojo, no hay
 * render roto — sólo se elige peor.
 *
 * Toda lista paralela termina desincronizada; la única pregunta es cuándo.
 */

const SRC = join(__dirname, "..", "..");

const WIZARDS = [
  join("components", "editor", "wizard", "wizard-client.tsx"),
  join("components", "largos", "long-form-wizard.tsx"),
];

const CATALOGOS = ["EDITORIAL_THEMES", "BROLL_SOURCES", "BROLL_STYLE_IDS"];

describe("catálogos compartidos: una sola copia", () => {
  for (const wizard of WIZARDS) {
    for (const catalogo of CATALOGOS) {
      it(`${wizard} no redefine ${catalogo}`, () => {
        const src = readFileSync(join(SRC, wizard), "utf-8");
        const redefine = new RegExp(`^\s*(const|let|var)\s+${catalogo}\s*=`, "m").test(src);
        expect(
          redefine,
          `${wizard} define su propia ${catalogo} en vez de importarla de @/lib. ` +
            "Dos copias se separan: ya pasó con EDITORIAL_THEMES (la de largos perdió `hint`).",
        ).toBe(false);
      });
    }
  }

  it("los dos wizards importan los temas del módulo compartido", () => {
    for (const wizard of WIZARDS) {
      const src = readFileSync(join(SRC, wizard), "utf-8");
      expect(src, `${wizard} no importa EDITORIAL_THEMES`).toMatch(
        /import \{[^}]*EDITORIAL_THEMES[^}]*\} from "@\/lib\/editorial-themes"/,
      );
    }
  });

  it("todo tema editorial trae la línea que lo explica", () => {
    // El campo que la copia de largos había perdido. Sin él la tarjeta muestra
    // sólo un nombre ("Kinfolk", "Riso") que no le dice nada a nadie.
    const sinHint = EDITORIAL_THEMES.filter((t) => !t.hint?.trim()).map((t) => t.id);
    expect(sinHint, `temas sin hint: ${sinHint.join(", ")}`).toEqual([]);
  });

  it("los ids de tema y de fuente de B-roll son únicos", () => {
    const ids = EDITORIAL_THEMES.map((t) => t.id);
    expect(new Set(ids).size, "hay ids de tema repetidos").toBe(ids.length);
    const fuentes = BROLL_SOURCES.map((f) => f.id);
    expect(new Set(fuentes).size, "hay ids de fuente repetidos").toBe(fuentes.length);
  });
});
