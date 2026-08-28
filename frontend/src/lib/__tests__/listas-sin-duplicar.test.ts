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

  it("toda fuente editorial del composition tiene al menos un tema que la elija", () => {
    // Las fuentes viven en un `z.enum` de editorial-layer.tsx, con su TTF en
    // remotion/public/fonts y su `case` en editorial-ink.tsx. Si ningun tema la
    // nombra, la fuente esta descargada, mapeada, y es INALCANZABLE: nadie
    // puede elegirla y nada avisa. Pasaba con fraunces, robotoserif y
    // bricolage — tres de nueve.
    const layer = readFileSync(
      join(SRC, "..", "..", "remotion", "src", "layers", "editorial-layer.tsx"),
      "utf-8",
    );
    // RegExp por constructor: el patron cruza saltos de linea porque el
    // `.enum([...])` de la fuente esta partido en varias lineas en el fuente.
    const m = layer.match(new RegExp("font:\\s*z[\\s\\S]*?\\.enum\\(\\[([^\\]]+)\\]\\)"));
    expect(m, "no encontre el enum de fuentes en editorial-layer.tsx").toBeTruthy();
    const declaradas = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const usadas = new Set(EDITORIAL_THEMES.map((t) => t.font));
    const huerfanas = declaradas.filter((f) => !usadas.has(f));
    expect(
      huerfanas,
      `fuentes sin ningun tema que las elija: ${huerfanas.join(", ")}`,
    ).toEqual([]);
  });
});
