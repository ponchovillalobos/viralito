/**
 * Candado serial (mutex FIFO) por clave — para que las operaciones PESADAS
 * (transcripción, etc.) NO se disparen todas a la vez y saturen CPU/GPU.
 *
 * Por qué: el render ya pasa por `job-queue.ts` (serial). Pero la transcripción
 * corre directa en su route (`videos/transcribe`), así que varios uploads a la vez
 * lanzaban N transcripciones simultáneas → en GPU agotaban la VRAM (se trababa),
 * y en CPU saturaban los núcleos. Con este candado, las llamadas con la MISMA
 * clave se encolan: la segunda espera a que termine la primera.
 *
 * NO cambia el resultado, solo el ORDEN de ejecución (serializa, no modifica nada).
 * El estado vive en globalThis para sobrevivir el HMR de Next y compartirse entre
 * requests del mismo proceso de server.
 */

declare global {
   
  var __viral_serial_locks__: Map<string, Promise<void>> | undefined;
}

const LOCKS: Map<string, Promise<void>> =
  globalThis.__viral_serial_locks__ ??
  (globalThis.__viral_serial_locks__ = new Map());

/**
 * Ejecuta `fn` en exclusión mutua con las demás llamadas de la misma `key`.
 * Las llamadas concurrentes se procesan en orden de llegada (FIFO).
 */
export async function withSerialLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = LOCKS.get(key) ?? Promise.resolve();

  let release!: () => void;
  const mine = new Promise<void>((res) => (release = res));

  // El próximo que llegue esperará a que ESTA tarea libere `mine`.
  // `.then(() => mine, () => mine)`: encadena pase lo que pase con la anterior.
  const chain = prev.then(() => mine, () => mine);
  LOCKS.set(key, chain);

  // Esperar a que la tarea anterior termine (ignorando su posible error).
  await prev.catch(() => {});

  try {
    return await fn();
  } finally {
    release();
    // Si nadie más se encoló detrás, limpiar la entrada para no crecer sin fin.
    if (LOCKS.get(key) === chain) {
      LOCKS.delete(key);
    }
  }
}
