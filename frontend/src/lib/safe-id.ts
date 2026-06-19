/**
 * Validación anti-path-traversal centralizada para ids que se usan como nombre de
 * archivo (videoId, projectId, …) dentro de path.join sobre el FS.
 *
 * Generaliza el guard que vivía inline en `api/long_form/[videoId]/delete/route.ts`:
 * un id es seguro SOLO si no está vacío, no contiene separadores de ruta (`/`, `\`)
 * ni `..`, y coincide exactamente con su `path.basename` (descarta también `.`/`..`
 * y cualquier resto de ruta). Así un id como `../../etc/passwd` o `a/b` se rechaza
 * ANTES de tocar el disco.
 *
 * Dos formas de uso:
 *  - `isSafeId(id)` → boolean: para devolver 400 fácil en las rutas API.
 *  - `assertSafeId(id)` → string normalizado (path.basename), o lanza Error.
 */
import path from "node:path";

/** ¿`id` es seguro para usarse como nombre de archivo? (sin path traversal). */
export function isSafeId(id: string | null | undefined): id is string {
  if (typeof id !== "string" || id.length === 0) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return false;
  const base = path.basename(id);
  if (base !== id) return false;
  if (base === "." || base === "..") return false;
  return true;
}

/**
 * Devuelve `path.basename(id)` si es seguro; lanza Error si no. Útil cuando el
 * caller prefiere fallar fuerte en vez de ramificar a un 400.
 */
export function assertSafeId(id: string | null | undefined): string {
  if (!isSafeId(id)) {
    throw new Error(`id inválido (path traversal): ${String(id)}`);
  }
  return path.basename(id);
}
