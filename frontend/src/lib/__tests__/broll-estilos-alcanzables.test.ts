import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BROLL_STYLE_IDS, BROLL_CAPABLE_STYLE_IDS } from "@/lib/broll-sources";

/**
 * Qué estilos pueden llevar material de apoyo: una sola lista.
 *
 * Lo reportó el usuario, no un test: «el estilo editorial no tiene la
 * posibilidad de elegir inserción de videos... el wizard no permite al usuario
 * saber ni desde la elección del estilo».
 *
 * Tenía razón, y la causa eran CUATRO listas de lo mismo que se habían separado:
 *
 *   1. `BROLL_STYLE_IDS`                  el selector del wizard  → 3 estilos
 *   2. una copia a mano en `route.ts`     decide si se BUSCA material → los mismos 3
 *   3. `editorialLayout && bRoll.map()`   el composition lo DIBUJA → 4 estilos
 *   4. `fullscreenBRoll` / PIP            los otros dos caminos del composition
 *
 * El composition dibujaba B-roll para los cuatro editoriales —`editorial`,
 * `editorial_full`, `editorial_broll` y `paper_cut`— y el selector aparecía en
 * uno. En los otros tres la capacidad existía y no había forma de encenderla:
 * el video salía sin material y nada explicaba por qué.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf-8");

/** Estilos a los que `style-templates.ts` les arma un `editorialLayout`. */
function estilosConLayoutEditorial(): string[] {
  const src = leer(join("frontend", "src", "lib", "style-templates.ts"));
  const encontrados = new Set<string>();
  let i = src.indexOf("editorialLayout:");
  while (i > -1) {
    // El id del estilo aparece antes del bloque, como `case "x"` o `styleId === "x"`.
    const antes = src.slice(Math.max(0, i - 3000), i);
    const ids = [...antes.matchAll(/(?:case|styleId ===)\s*"([a-z_]+)"/g)].map((m) => m[1]);
    if (ids.length) encontrados.add(ids[ids.length - 1]);
    i = src.indexOf("editorialLayout:", i + 1);
  }
  return [...encontrados].sort();
}

describe("estilos que pueden llevar material de apoyo", () => {
  it("todo estilo que el composition sabe dibujar con B-roll está en la lista de capaces", () => {
    const conLayout = estilosConLayoutEditorial();
    expect(conLayout.length, "no encontré ningún estilo con editorialLayout").toBeGreaterThan(0);

    const capaces = new Set<string>(BROLL_CAPABLE_STYLE_IDS);
    const huerfanos = conLayout.filter((s) => !capaces.has(s));
    expect(
      huerfanos,
      `el composition les dibuja B-roll pero el wizard no ofrece elegir fuente: ${huerfanos.join(", ")}`,
    ).toEqual([]);
  });

  it("los que traen material solos son un subconjunto de los capaces", () => {
    // Al revés sería absurdo: un estilo que busca material y no sabe mostrarlo.
    const capaces = new Set<string>(BROLL_CAPABLE_STYLE_IDS);
    for (const s of BROLL_STYLE_IDS) {
      expect(capaces.has(s), `${s} trae material y no está entre los capaces`).toBe(true);
    }
  });

  it("el backend NO vuelve a escribir la lista a mano", () => {
    // La copia inline de `route.ts` era la cuarta, y la que hacía que elegir una
    // fuente en `editorial` no sirviera de nada aunque el selector apareciera.
    const src = leer(join("frontend", "src", "app", "api", "editor", "auto-build", "route.ts"));
    expect(
      /styleId === "broll_full"\s*\|\|/.test(src),
      "volvió la lista de estilos escrita a mano en route.ts",
    ).toBe(false);
    expect(src).toContain("BROLL_CAPABLE_STYLE_IDS");
  });

  it("los dos wizards ofrecen el selector para los CAPACES, no sólo para los tres de siempre", () => {
    for (const w of [
      join("frontend", "src", "components", "editor", "wizard", "wizard-client.tsx"),
      join("frontend", "src", "components", "largos", "long-form-wizard.tsx"),
    ]) {
      const src = leer(w);
      expect(src, `${w} sigue usando sólo BROLL_STYLE_IDS para el selector`).toContain(
        "const BROLL_STYLES: StyleId[] = [...BROLL_CAPABLE_STYLE_IDS];",
      );
      // Y lo dice en la tarjeta, antes de elegir.
      expect(src, `${w} no marca en la tarjeta qué estilos aceptan material`).toContain(
        "+ material",
      );
    }
  });
});
