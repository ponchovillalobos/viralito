/**
 * PRUEBA GRATUITA — chequeo de licencia para los builders de props (.mjs).
 *
 * Espejo mínimo de frontend/src/lib/license.ts: el estado de licencia vive en
 * {dirname(DATA_ROOT)}\license.json (ej. C:\hermes-data\license.json) y trae el
 * campo `licenseKey` cuando hay licencia activada. Acá NO verificamos la firma
 * (eso lo hace el frontend al activar la clave): solo decidimos si el video
 * lleva la marca de agua de prueba.
 *
 * DATA_ROOT se resuelve con el MISMO patrón que build-props.mjs /
 * build-clip-props.mjs / editorial-icons.mjs: env VIRAL_DATA_ROOT → rutas
 * conocidas → default.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";


import { pickDataRoot } from "./data-root.mjs";
/**
 * true → el video debe llevar la marca de agua "PRUEBA GRATUITA".
 *
 *  - license.json NO existe → true (instalación en prueba; el frontend lo crea
 *    en el primer uso, pero si un render corre antes, sigue siendo prueba).
 *  - license.json existe y trae `licenseKey` no vacío → false (sin marca).
 *  - license.json existe pero NO se puede leer/parsear (permisos, JSON
 *    corrupto, instalación rara) → false. Decisión deliberada de CORTESÍA:
 *    preferimos NO manchar el video de un usuario con instalación dañada —
 *    ese caso casi siempre es un bug/entorno raro, no piratería. Nunca debe
 *    romper el build.
 */
// INTERRUPTOR (espejo de license.ts LICENSE_ENFORCED): con la licencia desactivada,
// NUNCA se pone marca de agua — la app es de uso libre. Reactivar = poner true.
const LICENSE_ENFORCED = false;

export function needsTrialWatermark() {
  if (!LICENSE_ENFORCED) return false;
  try {
    const licenseFile = path.join(path.dirname(pickDataRoot()), "license.json");
    if (!existsSync(licenseFile)) return true;
    const raw = JSON.parse(readFileSync(licenseFile, "utf-8"));
    const key = raw?.licenseKey;
    return !(typeof key === "string" && key.trim().length > 0);
  } catch {
    return false;
  }
}
