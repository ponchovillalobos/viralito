/**
 * Job queue manager — corre máximo MAX_CONCURRENT jobs activos en paralelo,
 * encola los demás. Usado por /api/editor/auto-build y /api/long_form/process
 * para evitar saturar CPU/disco cuando hay batch de N videos.
 *
 * Por qué cola serial (default MAX_CONCURRENT=1):
 *   Sin GPU NVIDIA, dos renders simultáneos compiten por cores + I/O y van más
 *   lento que serial. Configurable vía env VIRAL_MAX_CONCURRENT_JOBS.
 *
 * Patrón de uso:
 *
 *   const job = createJob(...); // del store correspondiente
 *   enqueue("editor", job.id, async () => {
 *     await processJob(job, body);
 *   });
 *   // El runner se ejecuta cuando haya slot libre. El store del job
 *   // refleja status "queued" hasta entonces, después "running".
 */

import { spawn } from "node:child_process";
import { getJob as getEditorJob, updateStep, persistNow , getEditorPid, unregisterEditorPid } from "@/lib/job-store";
import {
  getLongFormJob,
  updateLongFormStep,
  persistNowLongForm,
  getLongFormPid,
  unregisterLongFormPid,
} from "@/lib/long-form-job-store";
import { updateResearch } from "@/lib/research-store";

export type JobKind = "editor" | "long_form" | "research";

interface QueueEntry {
  kind: JobKind;
  jobId: string;
  runner: () => Promise<void>;
  enqueuedAt: number;
}

interface QueueState {
  pending: QueueEntry[];
  active: Set<string>;
}

declare global {
   
  var __viral_job_queue__: QueueState | undefined;
}

const QUEUE: QueueState =
  globalThis.__viral_job_queue__ ??
  (globalThis.__viral_job_queue__ = { pending: [], active: new Set() });

// Map paralelo de jobId activo → kind. Necesario porque research-store es async
// y no podemos llamarlo en listQueue sin convertir todo a async.
const ACTIVE_KINDS: Map<string, JobKind> = new Map();

const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.VIRAL_MAX_CONCURRENT_JOBS ?? "1", 10) || 1
);

/**
 * Refleja el estado "queued" / "running" en el store correspondiente.
 * No falla si el store no existe (job ya purgado) — silenciosa.
 *
 * PERSISTE AL DISCO. `createJob` guarda el job como "running" de entrada; si
 * acaba en cola porque ya hay otro renderizando, ese cambio vivía solo en
 * memoria. Al reiniciar, la reconciliación leía "running" del disco y lo
 * marcaba fallido en vez de reanudable — rompiendo la promesa de cola
 * reanudable justo en el caso más común: mandar varios videos de una vez.
 */
function markQueued(kind: JobKind, jobId: string, position: number) {
  if (kind === "editor") {
    const job = getEditorJob(jobId);
    if (!job) return;
    job.status = "queued";
    job.queuePosition = position;
    persistNow();
  } else if (kind === "long_form") {
    const job = getLongFormJob(jobId);
    if (!job) return;
    job.status = "queued";
    job.queuePosition = position;
    persistNowLongForm();
  } else if (kind === "research") {
    // Research store es async (persiste a JSON). Fire-and-forget — el próximo update
    // hace read-modify-write y prevalece el último. OK para markQueued.
    updateResearch(jobId, { status: "queued" }).catch(() => {});
  }
}

function markRunning(kind: JobKind, jobId: string) {
  if (kind === "editor") {
    const job = getEditorJob(jobId);
    if (!job) return;
    job.status = "running";
    job.queuePosition = undefined;
    persistNow();
  } else if (kind === "long_form") {
    const job = getLongFormJob(jobId);
    if (!job) return;
    job.status = "running";
    job.queuePosition = undefined;
    persistNowLongForm();
  } else if (kind === "research") {
    // El runner de research va a transitar el status a "downloading" en su primer step;
    // aquí solo dejamos "downloading" como marca de arranque, no "running".
    updateResearch(jobId, { status: "downloading" }).catch(() => {});
  }
}

/**
 * Encolá un runner. Si hay slot libre, arranca inmediatamente.
 * Caller crea el Job primero en su store, después llama enqueue().
 */
export function enqueue(kind: JobKind, jobId: string, runner: () => Promise<void>): void {
  QUEUE.pending.push({ kind, jobId, runner, enqueuedAt: Date.now() });
  // Actualizar posición visible del recién encolado
  markQueued(kind, jobId, QUEUE.pending.length);
  // Disparar tick (asíncrono pero no esperamos)
  tick().catch((err) => console.error("[job-queue] tick error:", err));
}

/**
 * Tick: si hay slot libre y hay pendientes, arrancar el siguiente.
 * Reentrante: se llama recursivo al terminar cada runner.
 */
async function tick(): Promise<void> {
  while (QUEUE.active.size < MAX_CONCURRENT && QUEUE.pending.length > 0) {
    const next = QUEUE.pending.shift();
    if (!next) break;
    QUEUE.active.add(next.jobId);
    ACTIVE_KINDS.set(next.jobId, next.kind);
    markRunning(next.kind, next.jobId);
    // Re-calcular posiciones de los que siguen
    for (let i = 0; i < QUEUE.pending.length; i++) {
      markQueued(QUEUE.pending[i].kind, QUEUE.pending[i].jobId, i + 1);
    }
    // Lanzar el runner sin esperarlo (fire-and-forget) y al terminar disparar tick de nuevo
    next
      .runner()
      .catch((err) => {
        console.error(`[job-queue] runner ${next.kind}/${next.jobId} crashed:`, err);
        // Marcar el job como failed si el runner explotó sin haber dejado estado consistente
        if (next.kind === "editor") {
          const job = getEditorJob(next.jobId);
          if (job && job.status === "running") {
            for (const step of job.steps) {
              if (step.status === "pending" || step.status === "building" || step.status === "rendering") {
                updateStep(job.id, step.styleId, { status: "fail", error: String(err) });
              }
            }
          }
        } else if (next.kind === "long_form") {
          const job = getLongFormJob(next.jobId);
          if (job && job.status === "running") {
            for (const step of job.steps) {
              if (step.status === "pending" || step.status === "running") {
                updateLongFormStep(job.id, step.key, {
                  status: "fail",
                  message: `runner crashed: ${String(err)}`,
                });
              }
            }
          }
        } else if (next.kind === "research") {
          updateResearch(next.jobId, {
            status: "failed",
            lastError: `runner crashed: ${String(err)}`,
          }).catch(() => {});
        }
      })
      .finally(() => {
        QUEUE.active.delete(next.jobId);
        ACTIVE_KINDS.delete(next.jobId);
        // Disparar el próximo
        tick().catch((err) => console.error("[job-queue] tick recursive error:", err));
      });
  }
}

/** Snapshot del estado para mostrar en /api/jobs/queue. */
export function listQueue(): {
  maxConcurrent: number;
  active: { kind: JobKind; jobId: string }[];
  pending: { kind: JobKind; jobId: string; position: number; enqueuedAt: number }[];
} {
  return {
    maxConcurrent: MAX_CONCURRENT,
    active: Array.from(QUEUE.active).map((jobId) => {
      // O(1) lookup gracias al Map paralelo
      const kind = ACTIVE_KINDS.get(jobId);
      if (kind) return { kind, jobId };
      // Fallback: chequear stores síncronos (research no se puede chequear sync)
      if (getEditorJob(jobId)) return { kind: "editor" as JobKind, jobId };
      if (getLongFormJob(jobId)) return { kind: "long_form" as JobKind, jobId };
      return { kind: "research" as JobKind, jobId };
    }),
    pending: QUEUE.pending.map((e, i) => ({
      kind: e.kind,
      jobId: e.jobId,
      position: i + 1,
      enqueuedAt: e.enqueuedAt,
    })),
  };
}


/** Útil para tests / debugging. */
export function clearQueue(): void {
  QUEUE.pending = [];
  QUEUE.active.clear();
  ACTIVE_KINDS.clear();
}

/**
 * Recovery: libera los slots ocupados y dispara tick.
 *
 * Antes solo hacía `QUEUE.active.clear()`. Eso liberaba el hueco en la cola
 * pero NO tocaba el proceso real ni el estado guardado del job, así que:
 *   · si el proceso viejo seguía vivo, `tick()` arrancaba otro EN PARALELO,
 *     contradiciendo el diseño serial que existe para no competir por disco; y
 *   · el job desatascado seguía figurando "running" para siempre en el panel.
 *
 * Ahora, antes de soltar el slot, a cada job activo se le mata el proceso (los
 * largos registran su pid; se mata el árbol entero con taskkill /T porque
 * python lanza ffmpeg y remotion por debajo) y se le deja el estado en
 * "failed", que es la verdad: se abortó.
 */
export function forceUnstuck(): { activeBefore: number; pendingBefore: number } {
  const activeBefore = QUEUE.active.size;
  const pendingBefore = QUEUE.pending.length;

  for (const jobId of QUEUE.active) {
    const kind = ACTIVE_KINDS.get(jobId);
    // 1) Matar el proceso real si lo conocemos. Sin esto, el render viejo sigue
    //    escribiendo mientras arranca uno nuevo sobre los mismos archivos.
    // Vale para los DOS tipos. Antes solo se mataba el arbol de los jobs de
    // largos, porque solo esos registraban su PID: un job de shorts atascado
    // liberaba el slot de la cola y se marcaba fallido, pero el render seguia
    // vivo detras y el siguiente job arrancaba en paralelo real con ese zombi
    // — encima escribiendo sobre los mismos archivos.
    {
      const pid = kind === "long_form" ? getLongFormPid(jobId) : getEditorPid(jobId);
      if (pid) {
        try {
          const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.on("error", () => {});
          if (kind === "long_form") unregisterLongFormPid(jobId);
          else unregisterEditorPid(jobId);
          console.log(`[job-queue] forceUnstuck: matado el arbol del pid ${pid} (${jobId})`);
        } catch {
          // best-effort: si no se pudo matar, igual se marca el job y se sigue.
        }
      }
    }
    // 2) Dejar el estado guardado acorde con la realidad: se abortó.
    markCancelled(kind ?? "editor", jobId);
  }

  QUEUE.active.clear();
  ACTIVE_KINDS.clear();
  tick().catch((err) => console.error("[job-queue] forceUnstuck tick error:", err));
  return { activeBefore, pendingBefore };
}

/** Marca un job como cancelado en su store (para que el panel no lo muestre "queued" eterno). */
function markCancelled(kind: JobKind, jobId: string) {
  if (kind === "editor") {
    const job = getEditorJob(jobId);
    if (!job) return;
    job.status = "failed";
    job.queuePosition = undefined;
    job.finishedAt = Date.now();
    for (const step of job.steps) {
      if (step.status === "pending") {
        updateStep(job.id, step.styleId, { status: "fail", error: "cancelado por el usuario" });
      }
    }
  } else if (kind === "long_form") {
    const job = getLongFormJob(jobId);
    if (!job) return;
    job.status = "failed";
    job.queuePosition = undefined;
    job.finishedAt = Date.now();
    for (const step of job.steps) {
      if (step.status === "pending") {
        updateLongFormStep(job.id, step.key, { status: "fail", message: "cancelado por el usuario" });
      }
    }
  } else if (kind === "research") {
    updateResearch(jobId, { status: "failed", lastError: "cancelado por el usuario" }).catch(() => {});
  }
}

/**
 * Cancela UN job pendiente por id (no toca los running). Devuelve si lo encontró.
 * Marca el job como failed/"cancelado" en su store y re-numera posiciones.
 */
export function cancelPending(jobId: string): boolean {
  const idx = QUEUE.pending.findIndex((e) => e.jobId === jobId);
  if (idx < 0) return false;
  const [entry] = QUEUE.pending.splice(idx, 1);
  markCancelled(entry.kind, entry.jobId);
  for (let i = 0; i < QUEUE.pending.length; i++) {
    markQueued(QUEUE.pending[i].kind, QUEUE.pending[i].jobId, i + 1);
  }
  return true;
}

/**
 * Cancela todos los pending y limpia active. NO mata los runners ya disparados
 * (esos siguen corriendo en background hasta resolver). Para uso cuando el user
 * quiere abortar batches duplicados.
 */
export function cancelAllPending(): { pendingCancelled: number; activeBefore: number } {
  const pendingCancelled = QUEUE.pending.length;
  const activeBefore = QUEUE.active.size;
  // BUG FIX (auditoría): antes sólo se vaciaba la cola sin marcar los jobs → quedaban
  // "queued" para siempre en el panel. Ahora cada uno queda failed/"cancelado".
  for (const e of QUEUE.pending) markCancelled(e.kind, e.jobId);
  QUEUE.pending = [];
  QUEUE.active.clear();
  ACTIVE_KINDS.clear();
  return { pendingCancelled, activeBefore };
}
