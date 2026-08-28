/**
 * Dónde vive la carpeta de datos, en UN solo lugar.
 *
 * Esta función estaba copiada a mano en NUEVE archivos `.mjs`, y una copia ya
 * había divergido. `editorial-icons.mjs` exigía `existsSync(o)` antes de
 * aceptar `VIRAL_DATA_ROOT`:
 *
 *     if (o && existsSync(o)) return o;      // <- la copia divergida
 *     if (o) return o;                       // <- las otras ocho
 *
 * La diferencia parece una mejora —validar la ruta antes de usarla— y es justo
 * lo contrario. En una instalación nueva, donde `VIRAL_DATA_ROOT` apunta a una
 * carpeta que todavía no se creó, esa copia **ignora la configuración en
 * silencio** y cae en `C:\viral-data\videos`: exactamente la carpeta compartida
 * con el proyecto hermano que el workspace documenta como el origen histórico
 * de que los dos proyectos se mezclaran los videos.
 *
 * Las otras ocho, en el mismo caso, fallan al leer un archivo — ruidoso, pero
 * honesto. Ésa es la conducta que se conserva aquí: **una ruta declarada a
 * propósito se respeta aunque todavía no exista**, porque el pipeline crea sus
 * carpetas. Descartar en silencio lo que alguien configuró explícitamente no es
 * validar, es desobedecer sin avisar.
 *
 * `viralito/frontend/src/lib/paths.ts` mantiene su propia copia a propósito: es
 * TypeScript dentro del bundle de Next y no puede importar de `remotion/`. El
 * test `raiz-de-datos.test.ts` compara las dos para que no se separen.
 */
import { existsSync } from "node:fs";

/** Candidatas históricas, en orden. Sólo se miran si no hay `VIRAL_DATA_ROOT`. */
export const CANDIDATAS = ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"];

export const POR_OMISION = "C:\\viral-data\\videos";

/**
 * @param {{ permitirNulo?: boolean }} [opts]
 *   `permitirNulo: true` devuelve `null` cuando no encuentra ninguna carpeta,
 *   en vez de la ruta por omisión. Lo usa `editorial-icons.mjs`, cuyo lector de
 *   SVG ya tolera no encontrar nada y se salta el icono.
 */
export function pickDataRoot(opts = {}) {
  const o = process.env.VIRAL_DATA_ROOT;
  if (o) return o;
  for (const c of CANDIDATAS) {
    if (existsSync(c)) return c;
  }
  return opts.permitirNulo ? null : POR_OMISION;
}
