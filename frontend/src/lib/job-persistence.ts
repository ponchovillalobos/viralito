/**
 * Persistencia de los job stores (editor + long-form) a disco.
 *
 * Por qué: los stores viven en un `Map` en memoria del módulo. Si el dev server
 * se reinicia (crash, recompilación, exit code 4…) en medio de un render, el estado
 * se pierde y la UI muestra el job "renderizando" para siempre (atorado). Persistir
 * a disco + reconciliar al arrancar elimina ese estado fantasma.
 *
 * Escritura ATÓMICA: se escribe a `${file}.tmp` y se renombra encima del final, así
 * un crash a mitad de escritura nunca deja un JSON corrupto.
 *
 * Las funciones de carga son SÍNCRONAS a propósito: se llaman al cargar el módulo,
 * antes de que llegue cualquier request, para que el STORE ya venga poblado.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";

const JOBS_DIR = path.join(DATA_ROOT, "jobs");

/** Lee el snapshot persistido. Devuelve [] si no existe o está corrupto (nunca tira). */
export function loadSnapshot<T>(fileName: string): T[] {
  try {
    const f = path.join(JOBS_DIR, fileName);
    if (!existsSync(f)) return [];
    const raw = readFileSync(f, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err) {
    console.error(`[job-persistence] no se pudo leer ${fileName}:`, err);
    return [];
  }
}

/** Pausa síncrona corta (sin busy-spin) — para el backoff del rename en Windows. */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer deshabilitado (raro en Node server): degradar a busy-wait corto.
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

/**
 * rename con reintentos. En Windows el rename atómico falla con EPERM/EBUSY/EACCES si
 * OTRO proceso tiene el destino abierto un instante (antivirus/Defender escaneando el
 * .json, el indexador, un lector concurrente). Reintentar tras una pausa corta resuelve
 * el lock transitorio en vez de perder ese guardado. Mismo patrón que render-utils.
 */
function renameWithRetry(tmp: string, final: string, attempts = 6): void {
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(tmp, final);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (transient && i < attempts - 1) {
        sleepSync(100 + i * 80); // 100,180,260,340,420ms — total ~1.3s de margen
        continue;
      }
      throw err;
    }
  }
}

/** Escritura atómica síncrona (tmp + rename con reintentos). No tira: loguea y sigue. */
function writeAtomic(fileName: string, snapshot: unknown): void {
  const tmp = path.join(JOBS_DIR, `${fileName}.tmp`);
  const final = path.join(JOBS_DIR, fileName);
  try {
    mkdirSync(JOBS_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify(snapshot), "utf-8");
    renameWithRetry(tmp, final);
  } catch (err) {
    // Último recurso: si el rename no destrabó, escribir DIRECTO sobre el final (no
    // atómico, pero mejor persistir el estado que perderlo). Si también falla, loguear.
    try {
      writeFileSync(final, JSON.stringify(snapshot), "utf-8");
    } catch {
      console.error(`[job-persistence] no se pudo guardar ${fileName}:`, err);
    }
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Guarda con debounce (~400ms). Para updates frecuentes (progreso de render) así no
 * escribimos a disco en cada frame. `getSnapshot` se evalúa al disparar el timer, de
 * modo que se persiste siempre el estado más reciente.
 */
export function scheduleSave(fileName: string, getSnapshot: () => unknown): void {
  const existing = timers.get(fileName);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    timers.delete(fileName);
    writeAtomic(fileName, getSnapshot());
  }, 400);
  // No mantener vivo el event loop sólo por un guardado pendiente.
  if (typeof t.unref === "function") t.unref();
}

/**
 * Guarda YA, síncrono. Para transiciones importantes (crear job, done/failed) donde
 * queremos garantizar que el estado quede en disco aunque el server muera enseguida.
 * Cancela cualquier guardado con debounce pendiente del mismo archivo.
 */
export function saveNow(fileName: string, snapshot: unknown): void {
  const existing = timers.get(fileName);
  if (existing) {
    clearTimeout(existing);
    timers.delete(fileName);
  }
  writeAtomic(fileName, snapshot);
}
