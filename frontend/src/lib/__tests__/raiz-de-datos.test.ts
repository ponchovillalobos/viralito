import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Dónde vive la carpeta de datos: una sola definición.
 *
 * `pickDataRoot` estaba copiada a mano en NUEVE archivos `.mjs` más
 * `frontend/src/lib/paths.ts`, y una copia ya había divergido:
 * `editorial-icons.mjs` exigía `existsSync(o)` antes de aceptar
 * `VIRAL_DATA_ROOT`.
 *
 * Parece una mejora y es lo contrario. En una instalación nueva, con
 * `VIRAL_DATA_ROOT` apuntando a una carpeta que todavía no se creó, esa copia
 * IGNORA la configuración en silencio y cae en `C:\viral-data\videos` — la
 * carpeta compartida con el proyecto hermano, que es el origen documentado de
 * que los dos proyectos se mezclaran los videos. Las otras ocho, en el mismo
 * caso, fallan al leer un archivo: ruidoso, pero honesto.
 *
 * Este test vigila las dos cosas: que ningún `.mjs` vuelva a definirla por su
 * cuenta, y que la copia de TypeScript —que no puede importar de `remotion/`
 * porque vive en el bundle de Next— siga respetando la misma regla.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");
const REMOTION = join(RAIZ, "remotion");
const leer = (p: string) => readFileSync(p, "utf-8");

describe("raíz de datos: una sola verdad", () => {
  it("ningún .mjs define pickDataRoot por su cuenta", () => {
    const culpables = readdirSync(REMOTION)
      .filter((f) => f.endsWith(".mjs") && f !== "data-root.mjs")
      .filter((f) => /function pickDataRoot\s*\(/.test(leer(join(REMOTION, f))));
    expect(
      culpables,
      `estos .mjs redefinen pickDataRoot en vez de importarla de data-root.mjs: ${culpables.join(", ")}`,
    ).toEqual([]);
  });

  it("los .mjs que la usan la importan del módulo compartido", () => {
    const usan = readdirSync(REMOTION)
      .filter((f) => f.endsWith(".mjs") && f !== "data-root.mjs")
      .filter((f) => leer(join(REMOTION, f)).includes("pickDataRoot("));
    expect(usan.length, "nadie usa pickDataRoot: el módulo sobraría").toBeGreaterThan(0);
    for (const f of usan) {
      expect(leer(join(REMOTION, f)), `${f} usa pickDataRoot sin importarla`).toMatch(
        /from "\.\/data-root\.mjs"/,
      );
    }
  });

  it("una ruta declarada a propósito se respeta aunque todavía no exista", () => {
    // El fallo concreto que tuvo la copia divergida. Si vuelve un `existsSync`
    // sobre la variable de entorno, el override deja de valer en instalaciones
    // nuevas y los datos se van a la carpeta del proyecto hermano.
    const mod = leer(join(REMOTION, "data-root.mjs"));
    const cuerpo = mod.slice(mod.indexOf("export function pickDataRoot"));
    expect(
      /if \(o && existsSync\(o\)\)/.test(cuerpo),
      "volvió el existsSync sobre VIRAL_DATA_ROOT: descarta en silencio lo que alguien configuró",
    ).toBe(false);
    expect(cuerpo).toContain("if (o) return o;");
  });

  it("la copia de TypeScript sigue la misma regla", () => {
    // `paths.ts` no puede importar de `remotion/` (vive en el bundle de Next),
    // así que su copia es deliberada — pero tiene que decir lo mismo.
    const ts = leer(join(RAIZ, "frontend", "src", "lib", "paths.ts"));
    const i = ts.indexOf("function pickDataRoot");
    expect(i, "paths.ts ya no define pickDataRoot").toBeGreaterThan(-1);
    const cuerpo = ts.slice(i, i + 600);
    expect(
      /if \(o && existsSync\(o\)\)/.test(cuerpo),
      "paths.ts descartaría VIRAL_DATA_ROOT si la carpeta no existe",
    ).toBe(false);
  });
});
