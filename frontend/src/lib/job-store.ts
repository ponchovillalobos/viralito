/**
 * Job store del server para tracking de renders del wizard.
 *
 * En Next.js dev, este Map sobrevive entre requests (módulo se carga 1 vez). Además se
 * PERSISTE a disco (editor-jobs.json) y se RECONCILIA al arrancar: si el server se reinició
 * en medio de un render, los jobs "running"/"queued" se resuelven mirando si el .mp4 final
 * existe (→ ok) o no (→ fail "interrumpido"), en vez de quedar atorados para siempre.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { RENDERS_DIR } from "@/lib/paths";
import { loadSnapshot, scheduleSave, saveNow } from "@/lib/job-persistence";
import { pushNotification, type NotificationType } from "@/lib/notifications-store";

const PERSIST_FILE = "editor-jobs.json";

// `StyleId` ya no se duplica aquí: viene del registro central vía
// style-templates.ts. Lo importamos para uso local (Job, JobStep, firmas) y lo
// re-exportamos para no cambiar paths de import de los consumidores existentes.
import type { StyleId } from "@/lib/style-templates";
export type { StyleId };

export interface JobStep {
  styleId: StyleId;
  status: "pending" | "building" | "rendering" | "ok" | "fail";
  progress: number; // 0-100
  currentFrame?: number;
  totalFrames?: number;
  output?: string;
  error?: string;
}

export interface Job {
  id: string;
  videoId: string;
  styles: StyleId[];
  accentColor: string;
  startedAt: number;
  finishedAt?: number;
  currentStyle?: StyleId;
  overallProgress: number; // 0-100 (avg de todos los steps)
  steps: JobStep[];
  /**
   * "queued"  → encolado, esperando slot libre (queuePosition >= 1)
   * "running" → el runner está procesando los steps
   * "done"    → todos los steps OK
   * "failed"  → al menos un step fail
   */
  status: "queued" | "running" | "done" | "failed";
  /** Posición en la cola (1-indexed). undefined cuando está running/done/failed. */
  queuePosition?: number;
  /**
   * Body original del request (AutoBuildRequest) — se persiste para poder REANUDAR
   * el job si la app se reinició mientras estaba en cola. Tipado laxo a propósito
   * para no acoplar el store con el tipo de la ruta (evita ciclos de import).
   */
  request?: unknown;
  /** true si quedó interrumpido en cola por un reinicio y puede reanudarse (tiene request). */
  resumable?: boolean;
}

declare global {
   
  var __viral_job_store__: Map<string, Job> | undefined;
}

const isFreshBoot = !globalThis.__viral_job_store__;
const STORE: Map<string, Job> =
  globalThis.__viral_job_store__ ?? (globalThis.__viral_job_store__ = new Map());

/** Snapshot del store a disco (debounced). */
function persist(): void {
  scheduleSave(PERSIST_FILE, () => Array.from(STORE.values()));
}

/** Recalcula overallProgress + status/finishedAt a partir de los steps. */
function recompute(job: Job): void {
  const total = job.steps.reduce((acc, s) => acc + s.progress, 0);
  job.overallProgress = job.steps.length ? Math.round(total / job.steps.length) : 0;
  if (job.steps.every((s) => s.status === "ok" || s.status === "fail")) {
    job.status = job.steps.every((s) => s.status === "ok") ? "done" : "failed";
    if (!job.finishedAt) job.finishedAt = Date.now();
  }
}

/**
 * Reconcilia un job que quedó a medias por un reinicio del server. Para cada step
 * no terminal: si el render final existe en disco → "ok"; si no → "fail". Así nunca
 * queda un job "running"/"queued" colgado tras un restart.
 */
function reconcileJob(job: Job): void {
  if (job.status !== "running" && job.status !== "queued") return;
  // Un job que quedó SOLO en cola (nunca arrancó, status "queued") y tiene su request
  // guardado se puede REANUDAR idéntico → lo marcamos resumable en vez de matarlo.
  // Los "running" (a medias) sí se reconcilian por disco (no se reanuda un render
  // partido de forma segura).
  const wasQueued = job.status === "queued";
  for (const step of job.steps) {
    if (step.status === "ok" || step.status === "fail") continue;
    const projectId = `${job.videoId}_${step.styleId}`;
    const outPath = step.output ?? path.join(RENDERS_DIR, `${projectId}.mp4`);
    let finished = false;
    try {
      finished = existsSync(outPath) && statSync(outPath).size > 100_000;
    } catch {
      finished = false;
    }
    if (finished) {
      step.status = "ok";
      step.progress = 100;
      step.output = outPath;
    } else {
      step.status = "fail";
      step.error =
        wasQueued && job.request
          ? "Pausado porque la app se reinició — se reanudará solo."
          : "Se interrumpió porque la app se reinició — intenta generarlo de nuevo.";
    }
  }
  job.queuePosition = undefined;
  if (wasQueued && job.request) job.resumable = true;
  recompute(job);
}

// Cargar + reconciliar desde disco SÓLO en arranque fresco del proceso (no en HMR,
// donde globalThis ya tiene el store vivo y no queremos pisarlo con el snapshot viejo).
if (isFreshBoot) {
  for (const job of loadSnapshot<Job>(PERSIST_FILE)) {
    reconcileJob(job);
    STORE.set(job.id, job);
  }
  // Persistir el resultado reconciliado de una.
  saveNow(PERSIST_FILE, Array.from(STORE.values()));
}

/**
 * Vuelca el store a disco AHORA, sin debounce.
 *
 * Existe para las transiciones de estado de la cola. `createJob` guarda el job
 * como "running" de entrada; si la cola lo pasa a "queued" porque ya hay otro
 * renderizando, ese cambio vivía SOLO en memoria. Al reiniciar, `reconcileJob`
 * leía "running" del disco y lo marcaba fallido en vez de reanudable — o sea,
 * la promesa de "cola reanudable" se rompía justo en el caso más común:
 * mandar varios videos de una vez.
 *
 * Va sin debounce a propósito: lo que se quiere sobrevivir es precisamente un
 * cierre abrupto, y un guardado aplazado no llega a ocurrir.
 */
export function persistNow(): void {
  saveNow(PERSIST_FILE, Array.from(STORE.values()));
}

export function createJob(
  videoId: string,
  styles: StyleId[],
  accentColor: string,
  request?: unknown,
): Job {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    videoId,
    styles,
    accentColor,
    startedAt: Date.now(),
    overallProgress: 0,
    steps: styles.map((s) => ({ styleId: s, status: "pending", progress: 0 })),
    status: "running",
    request,
  };
  STORE.set(id, job);
  saveNow(PERSIST_FILE, Array.from(STORE.values()));
  return job;
}

export function getJob(id: string): Job | undefined {
  return STORE.get(id);
}

/** Todos los jobs del store (para historial / panel de cola). */
export function listJobs(): Job[] {
  return Array.from(STORE.values());
}

/**
 * Título humano del job: el nombre del archivo de salida (que auto-build arma con el
 * título del contenido + estilo, ej "Como vender mas Viral"). undefined si todavía
 * no hay output o si el nombre es el técnico videoId_estilo.
 */
export function jobTitle(job: Job): string | undefined {
  for (const step of job.steps) {
    if (!step.output) continue;
    const base = path.basename(step.output).replace(/\.mp4$/i, "");
    if (base && base !== `${job.videoId}_${step.styleId}`) return base;
  }
  return undefined;
}

/**
 * Avisa al usuario (vía /api/notifications → NotificationPoller) que el job terminó.
 * Se llama UNA sola vez por job, en la transición a estado terminal. El store de
 * notificaciones además dedupea por (type, scheduleId, projectId) sin ack.
 */
function notifyTerminal(job: Job): void {
  const failedStep = job.steps.find((s) => s.status === "fail" && s.error);
  // Si el propio usuario lo canceló, no hay nada que avisar.
  if (failedStep?.error && /cancelado por el usuario/i.test(failedStep.error)) return;
  const title = jobTitle(job);
  // El union NotificationType original no incluye los tipos de render; el store
  // serializa a JSON así que el cast es seguro (el poller los maneja por string).
  const type = (job.status === "done" ? "render_done" : "render_failed") as unknown as NotificationType;
  pushNotification({
    type,
    projectId: job.videoId,
    scheduleId: job.id,
    scheduledAt: Date.now(),
    message:
      job.status === "done"
        ? title ?? job.videoId
        : (failedStep?.error ?? "").split("\n[detalle]")[0] || "Algo salió mal al generar el video.",
  }).catch(() => {
    /* best-effort: si el JSON de notificaciones falla, el job igual queda bien */
  });
}

export function updateStep(
  jobId: string,
  styleId: StyleId,
  patch: Partial<JobStep>
): void {
  const job = STORE.get(jobId);
  if (!job) return;
  const step = job.steps.find((s) => s.styleId === styleId);
  if (!step) return;
  Object.assign(step, patch);

  const wasTerminal = job.status === "done" || job.status === "failed";
  recompute(job);
  const nowTerminal = job.status === "done" || job.status === "failed";

  // Guardado: en transición a terminal escribimos YA (no perder el resultado final si
  // el server muere enseguida); en updates de progreso, con debounce.
  if (nowTerminal && !wasTerminal) {
    saveNow(PERSIST_FILE, Array.from(STORE.values()));
    // Aviso de éxito/fallo al usuario — sólo en la transición (anti-spam: 1 vez por job).
    notifyTerminal(job);
  } else {
    persist();
  }
}

export function setCurrentStyle(jobId: string, styleId: StyleId): void {
  const job = STORE.get(jobId);
  if (!job) return;
  job.currentStyle = styleId;
  persist();
}

// Limpieza: borrar jobs > 72h de antigüedad (los terminados quedan visibles en el
// historial /api/jobs/history y en el panel de cola durante ese tiempo).
setInterval(() => {
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  let changed = false;
  for (const [k, v] of STORE.entries()) {
    // NUNCA borrar un job que aún corre (o espera slot): un pipeline largo puede
    // superar las 72h y borrarlo dejaría el trabajo activo sin entrada de estado.
    if (v.status === "running" || v.status === "queued") continue;
    if (v.startedAt < cutoff) {
      STORE.delete(k);
      changed = true;
    }
  }
  if (changed) persist();
}, 5 * 60 * 1000);


// ─── PID del proceso en curso, por job ───────────────────────────────────────
//
// Mismo mecanismo que `long-form-job-store.ts`, que ya lo tenia. Sin esto,
// `forceUnstuck` sobre un job de shorts liberaba el slot de la cola y marcaba el
// job como fallido, pero el `remotion render` seguia vivo detras — escribiendo
// props y .mp4 mientras el siguiente job de la cola ya habia arrancado.
declare global {
   
  var __viral_editor_pid_map__: Map<string, number> | undefined;
}

const EDITOR_PID_MAP: Map<string, number> =
  globalThis.__viral_editor_pid_map__ ?? (globalThis.__viral_editor_pid_map__ = new Map());

export function registerEditorPid(jobId: string, pid: number): void {
  EDITOR_PID_MAP.set(jobId, pid);
}

export function getEditorPid(jobId: string): number | undefined {
  return EDITOR_PID_MAP.get(jobId);
}

export function unregisterEditorPid(jobId: string): void {
  EDITOR_PID_MAP.delete(jobId);
}
