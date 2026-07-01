/**
 * Miniaturas custom por video. El usuario sube una imagen (vertical u horizontal según el
 * video) que se usa como thumbnail del post (ej. LinkedIn uploadThumbnail). Se guardan en
 * THUMBS_DIR keyed por projectId. Aditivo — si no hay miniatura, el post usa el default de la red.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { THUMBS_DIR } from "@/lib/paths";

const EXTS = ["jpg", "jpeg", "png", "webp"] as const;

/** Devuelve la ruta de la miniatura del proyecto si existe (probando extensiones), o null. */
export async function findThumbnail(projectId: string): Promise<string | null> {
  for (const ext of EXTS) {
    const p = path.join(THUMBS_DIR, `${projectId}.${ext}`);
    try {
      await fs.access(p);
      return p;
    } catch {
      /* sigue */
    }
  }
  return null;
}

/** Guarda la miniatura del proyecto (borra variantes previas de otra extensión). */
export async function saveThumbnail(
  projectId: string,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  await fs.mkdir(THUMBS_DIR, { recursive: true });
  for (const e of EXTS) {
    try {
      await fs.unlink(path.join(THUMBS_DIR, `${projectId}.${e}`));
    } catch {
      /* no existía */
    }
  }
  const clean = (EXTS as readonly string[]).includes(ext.toLowerCase()) ? ext.toLowerCase() : "jpg";
  const p = path.join(THUMBS_DIR, `${projectId}.${clean}`);
  await fs.writeFile(p, buffer);
  return p;
}

/** Borra la miniatura del proyecto (todas las extensiones). */
export async function deleteThumbnail(projectId: string): Promise<void> {
  for (const e of EXTS) {
    try {
      await fs.unlink(path.join(THUMBS_DIR, `${projectId}.${e}`));
    } catch {
      /* no existía */
    }
  }
}
