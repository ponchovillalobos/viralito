// Helpers puros usados por auto-build/route.ts.
//
// Cada función vive fuera del route handler para que la lógica de archivo / I/O esté
// localizada y se pueda razonar (y testear) sin arrastrar todo el flujo de render.

import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, RAW_DIR } from "@/lib/paths";
import type { AutoBuildRequest } from "./types";

/**
 * Etiqueta corta y legible del estilo, usada en el nombre del archivo de salida.
 * Se DERIVA del registro central (mismos valores que antes) y se re-exporta con
 * el MISMO nombre para no tocar a quien lo importa.
 */
export { STYLE_SHORT_LABEL_FROM_REGISTRY as STYLE_SHORT_LABEL } from "@/lib/style-registry";

/** Resuelve aspect ratio → dimensiones de output en píxeles. */
export function dimensionsFromAspect(
  ratio: AutoBuildRequest["aspectRatio"]
): { width: number; height: number } {
  if (ratio === "16:9") return { width: 1920, height: 1080 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 }; // default 9:16
}

/**
 * Encuentra el video raw de un videoId, probando .mp4 primero y .mov como fallback.
 * Devuelve la ruta absoluta o `null` si ninguno existe. Centraliza el patrón que se
 * repetía 3 veces (tracking, bg-removal, text-behind).
 */
export async function findRawVideo(videoId: string): Promise<string | null> {
  const mp4 = path.join(RAW_DIR, `${videoId}.mp4`);
  if (await fs.access(mp4).then(() => true).catch(() => false)) return mp4;
  const mov = path.join(RAW_DIR, `${videoId}.mov`);
  if (await fs.access(mov).then(() => true).catch(() => false)) return mov;
  return null;
}

/**
 * Devuelve un projectId único basado en `${titulo} ${EstiloLabel}`. Si ya existe un proyecto
 * con ese id pero de OTRO video, agrega un número para no pisarlo. Si es el mismo video
 * (re-render del mismo estilo), reusa el id (sobrescribe a propósito).
 */
export async function uniqueProjectId(
  base: string,
  videoId: string,
  suffix: string
): Promise<string> {
  for (let n = 0; n < 50; n++) {
    const id = (n === 0 ? base : `${base} ${n + 1}`) + suffix;
    const jsonPath = path.join(PROJECTS_DIR, `${id}.json`);
    try {
      const existing = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
      if (existing?.videoId === videoId) return id; // mismo video → reusar/sobrescribir
      // distinto video con ese id → probar el siguiente número
    } catch {
      return id; // no existe → libre
    }
  }
  return `${base} ${Date.now()}${suffix}`;
}
