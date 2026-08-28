import { describe, it, expect } from "vitest";
import path from "node:path";
import { DATA_ROOT, TRANSCRIPTS_DIR, PROJECT_ROOT } from "@/lib/paths";

/**
 * La raiz de datos tiene que ser ABSOLUTA. Siempre.
 *
 * Si no lo es, cada proceso la resuelve contra SU directorio de trabajo, y el
 * pipeline empieza a escribir en un sitio y leer en otro. No falla: devuelve
 * vacio.
 *
 * Paso de verdad. `pickDataRoot()` devolvia "C:\viral-data\videos" tambien
 * fuera de Windows, donde eso NO es una ruta absoluta sino un nombre relativo
 * cualquiera. El frontend escribia el archivo de palabras relativo a
 * `frontend/`, el script de Python lo buscaba relativo a `python/`, y las cifras
 * en pantalla salian vacias. En CI el sintoma fue
 * "expected [] to deeply equal [ '8', '50%', '3x' ]", que no menciona rutas por
 * ningun lado.
 *
 * Este test corre en las dos plataformas y en las dos exige lo mismo.
 */
describe("la raiz de datos", () => {
  it("es una ruta absoluta en esta plataforma", () => {
    expect(path.isAbsolute(DATA_ROOT), `DATA_ROOT no es absoluta: ${DATA_ROOT}`).toBe(
      true,
    );
  });

  it("las carpetas derivadas tambien lo son", () => {
    for (const [nombre, valor] of [
      ["TRANSCRIPTS_DIR", TRANSCRIPTS_DIR],
      ["PROJECT_ROOT", PROJECT_ROOT],
    ] as const) {
      expect(path.isAbsolute(valor), `${nombre} no es absoluta: ${valor}`).toBe(true);
    }
  });

  it("no lleva separadores de la OTRA plataforma", () => {
    // Una ruta con "\" en Linux (o al reves) es justo el sintoma de haber
    // heredado el default de la plataforma equivocada.
    const ajeno = path.sep === "\\" ? null : "\\";
    if (ajeno) {
      expect(DATA_ROOT.includes(ajeno), `DATA_ROOT trae "${ajeno}": ${DATA_ROOT}`).toBe(
        false,
      );
    }
  });
});
