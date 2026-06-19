/**
 * Job store en memoria para el pipeline long-form.
 *
 * 7 pasos secuenciales:
 *   1. transcribe       → long_form/transcripts/{id}.json
 *   2. detect_silences  → long_form/cuts/{id}.json
 *   3. cut_silences     → long_form/clean/{id}_clean.mp4
 *   4. re_transcribe    → re-transcribe del clean (timestamps alineados)
 *   5. analyze          → long_form/proposals/{id}.json (Ollama propone clips)
 *   6. extract_clips    → long_form/clips/{id}_cNN_*.mp4
 *   7. render (opt.)    → long_form/renders/{id}_cNN_*_supreme.mp4
 *
 * En Next.js dev sobrevive entre requests (módulo se carga 1 vez). Además se PERSISTE a
 * disco (long-form-jobs.json) y se RECONCILIA al arrancar: un job "running"/"queued" que
 * quedó a medias por un reinicio del server se marca "failed" ("interrumpido") en vez de
 * mostrarse corriendo para siempre (el pipeline Python no se puede reanudar).
 */

import { loadSnapshot, scheduleSave, saveNow } from "@/lib/job-persistence";

const PERSIST_FILE = "long-form-jobs.json";

export type LongFormStepKey =
  | "transcribe"
  | "detect_silences"
  | "cut_silences"
  | "re_transcribe"
  | "analyze"
  | "extract_clips"
  | "render";

export interface LongFormStep {
  key: LongFormStepKey;
  label: string;
  status: "pending" | "running" | "ok" | "fail" | "skipped";
  message?: string;
  /** 0-100 — sub-progreso DENTRO del paso. Hoy lo emite el render (N/M clips listos)
   *  para que la barra avance durante el render (la fase más larga) en vez de
   *  quedarse congelada. Los pasos que no lo emiten usan la heurística 0.5. */
  progress?: number;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * Tipo de corrida (flujo REVISAR antes de generar):
 *   "full"            → comportamiento clásico: analiza + extrae + genera todo de un jalón.
 *   "analyze"         → solo hasta el proposals JSON (el usuario revisa los momentos).
 *   "render-approved" → salta el análisis y solo extrae + genera los clips aprobados.
 */
export type LongFormRunMode = "full" | "analyze" | "render-approved";

export interface LongFormJob {
  id: string;
  videoId: string;
  videoPath: string;
  options: {
    model?: string;
    render: boolean;
    maxClips?: number;
    skipTranscribe?: boolean;
    useHeuristic?: boolean;
    styles?: string[];
    accentColor?: string;
    platforms?: string[];
    /** Tipo de corrida; undefined = "full" (jobs viejos persistidos siguen funcionando). */
    mode?: LongFormRunMode;
  };
  startedAt: number;
  finishedAt?: number;
  /**
   * "queued"    → encolado por el job-queue, esperando slot
   * "running"   → el pipeline Python está corriendo
   * "done"      → todos los steps OK
   * "failed"    → fallo en algún step
   * "cancelled" → el usuario lo canceló (no es un fallo; se muestra distinto)
   */
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  /** Posición en cola (1-indexed); undefined cuando está running/done/failed */
  queuePosition?: number;
  /** 0-100 — derivado de los pasos completados */
  overallProgress: number;
  steps: LongFormStep[];
  /** Output del CLI capturado (últimas 100 líneas para no inflar la memoria) */
  log: string[];
  /** Cantidad de clips generados al final (poblado al terminar) */
  clipsCount?: number;
}

const DEFAULT_STEPS: { key: LongFormStepKey; label: string }[] = [
  { key: "transcribe", label: "Convertir a texto lo que se dice en el video" },
  { key: "detect_silences", label: "Detectar silencios" },
  { key: "cut_silences", label: "Cortar los silencios del video" },
  { key: "re_transcribe", label: "Volver a transcribir el video sin silencios" },
  { key: "analyze", label: "Analizar con IA → elegir los mejores momentos" },
  { key: "extract_clips", label: "Recortar los clips (30-60 s cada uno)" },
  { key: "render", label: "Generar los videos finales con tu estilo" },
];

/**
 * Steps por tipo de corrida: la barra de progreso solo muestra los pasos que de
 * verdad corren en ese modo (antes el subset dejaba pasos "pending" eternos o
 * mostraba pasos que nunca iban a correr).
 *
 *  - "analyze": el pipeline corre transcribe (smart; en rápido lo salta y lo marca
 *    skipped) + analyze (incluye score + whyViral) y termina.
 *  - "render-approved": el pipeline arranca directo en extract (STEP 6) + render (STEP 7).
 *  - "full" (default): los 7 pasos clásicos, intactos.
 */
const STEPS_BY_MODE: Record<LongFormRunMode, { key: LongFormStepKey; label: string }[]> = {
  full: DEFAULT_STEPS,
  analyze: [
    { key: "transcribe", label: "Convertir a texto lo que se dice en el video" },
    { key: "analyze", label: "Analizar con IA → elegir los mejores momentos" },
  ],
  "render-approved": [
    { key: "extract_clips", label: "Recortar los clips aprobados" },
    { key: "render", label: "Generar los videos finales con tu estilo" },
  ],
};

declare global {
   
  var __viral_lf_job_store__: Map<string, LongFormJob> | undefined;
}

const isFreshBoot = !globalThis.__viral_lf_job_store__;
const STORE: Map<string, LongFormJob> =
  globalThis.__viral_lf_job_store__ ?? (globalThis.__viral_lf_job_store__ = new Map());

/** Snapshot a disco (debounced). */
function persist(): void {
  scheduleSave(PERSIST_FILE, () => Array.from(STORE.values()));
}

/**
 * Reconcilia un job interrumpido por reinicio. El pipeline Python no se reanuda, así que
 * cualquier step no terminal pasa a "fail" y el job a "failed" con mensaje claro.
 */
function reconcileLongFormJob(job: LongFormJob): void {
  if (job.status !== "running" && job.status !== "queued") return;
  for (const step of job.steps) {
    if (step.status === "pending" || step.status === "running") {
      step.status = "fail";
      step.message = "Interrumpido por reinicio del servidor — vuelve a empezar el proceso.";
      if (!step.finishedAt) step.finishedAt = Date.now();
    }
  }
  job.status = "failed";
  job.queuePosition = undefined;
  if (!job.finishedAt) job.finishedAt = Date.now();
}

if (isFreshBoot) {
  for (const job of loadSnapshot<LongFormJob>(PERSIST_FILE)) {
    reconcileLongFormJob(job);
    STORE.set(job.id, job);
  }
  saveNow(PERSIST_FILE, Array.from(STORE.values()));
}

export function createLongFormJob(
  videoId: string,
  videoPath: string,
  options: LongFormJob["options"]
): LongFormJob {
  const id = `lfjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Pasos según el tipo de corrida (mode ausente o desconocido → los 7 clásicos).
  const stepDefs = STEPS_BY_MODE[options.mode ?? "full"] ?? DEFAULT_STEPS;
  const job: LongFormJob = {
    id,
    videoId,
    videoPath,
    options,
    startedAt: Date.now(),
    status: "running",
    overallProgress: 0,
    steps: stepDefs.map((s) => ({
      key: s.key,
      label: s.label,
      status: "pending",
    })),
    log: [],
  };
  if (!options.render) {
    // El step de render se marca skipped desde el arranque (si esta corrida lo tiene)
    const renderStep = job.steps.find((s) => s.key === "render");
    if (renderStep) renderStep.status = "skipped";
  }
  STORE.set(id, job);
  saveNow(PERSIST_FILE, Array.from(STORE.values()));
  return job;
}

export function getLongFormJob(id: string): LongFormJob | undefined {
  return STORE.get(id);
}

export function listLongFormJobs(): LongFormJob[] {
  return Array.from(STORE.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function updateLongFormStep(
  jobId: string,
  stepKey: LongFormStepKey,
  patch: Partial<Omit<LongFormStep, "key" | "label">>
): void {
  const job = STORE.get(jobId);
  if (!job) return;
  // Un job cancelado por el usuario es terminal: el handler de cierre del proceso
  // matado por taskkill NO debe pisarlo con "failed".
  if (job.status === "cancelled") return;
  const step = job.steps.find((s) => s.key === stepKey);
  if (!step) return;

  if (patch.status === "running" && step.status === "pending") {
    step.startedAt = Date.now();
  }
  if ((patch.status === "ok" || patch.status === "fail") && !step.finishedAt) {
    step.finishedAt = Date.now();
  }
  Object.assign(step, patch);

  // Recalcular overall. Cada paso pesa igual (1/N). Un paso done/skipped/fail aporta
  // su peso completo; un paso RUNNING aporta su sub-progreso (step.progress/100) si lo
  // emite — hoy el render manda N/M clips listos — y si no, 0.5 (heurística "a la
  // mitad", como antes). Así la barra YA NO se congela durante el render: antes el
  // render running pesaba 0.5 fijo → 75% clavado toda la fase más larga (~30+ min).
  const total = job.steps.length || 1;
  let weighted = 0;
  for (const s of job.steps) {
    if (s.status === "ok" || s.status === "skipped" || s.status === "fail") {
      weighted += 1;
    } else if (s.status === "running") {
      weighted +=
        typeof s.progress === "number"
          ? Math.min(100, Math.max(0, s.progress)) / 100
          : 0.5;
    }
  }
  job.overallProgress = Math.round((weighted / total) * 100);

  // Terminal: un paso que falla cierra el job DE INMEDIATO. El pipeline Python
  // corta en el primer error (subprocess check=True), así que los pasos siguientes
  // quedan en "pending" para siempre — si esperáramos a que no haya pending, el job
  // se mostraría "running" eternamente (bug del job colgado). Por eso anyFail es
  // terminal aunque queden pendientes.
  const anyFail = job.steps.some((s) => s.status === "fail");
  const stillPending = job.steps.some(
    (s) => s.status === "pending" || s.status === "running"
  );
  let nowTerminal = false;
  if (anyFail || !stillPending) {
    job.status = anyFail ? "failed" : "done";
    job.finishedAt = Date.now();
    // 100% solo si TODO salió bien; en fallo dejamos el progreso real (honesto).
    if (!anyFail) job.overallProgress = 100;
    nowTerminal = true;
  }

  if (nowTerminal) {
    saveNow(PERSIST_FILE, Array.from(STORE.values()));
  } else {
    persist();
  }
}

export function appendLongFormLog(jobId: string, chunk: string): void {
  const job = STORE.get(jobId);
  if (!job) return;
  const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
  job.log.push(...lines);
  // Mantener solo las últimas 100 líneas (evitar OOM en pipelines largos)
  if (job.log.length > 100) job.log = job.log.slice(-100);
  persist();
}

export function setLongFormClipsCount(jobId: string, count: number): void {
  const job = STORE.get(jobId);
  if (!job) return;
  job.clipsCount = count;
  persist();
}

/**
 * Cancelación pedida por el usuario. Marca el job "cancelled" (NO "failed") con
 * mensaje "Cancelado por ti" y cierra los steps abiertos como "skipped".
 * También convierte los steps que la cola ya marcó "fail · cancelado" (cancelPending
 * de job-queue) para que el panel no muestre un fallo donde hubo una decisión.
 *
 * Devuelve false si el job no existe o ya era terminal.
 */
export function cancelLongFormJob(jobId: string, message = "Cancelado por ti"): boolean {
  const job = STORE.get(jobId);
  if (!job) return false;
  if (job.status === "done" || job.status === "cancelled") return false;
  const wasFailedByQueueCancel =
    job.status === "failed" &&
    job.steps.some((s) => s.status === "fail" && /cancelado/i.test(s.message ?? ""));
  if (job.status === "failed" && !wasFailedByQueueCancel) return false;

  job.status = "cancelled";
  job.queuePosition = undefined;
  if (!job.finishedAt) job.finishedAt = Date.now();
  for (const step of job.steps) {
    const cancelledByQueue = step.status === "fail" && /cancelado/i.test(step.message ?? "");
    if (step.status === "pending" || step.status === "running" || cancelledByQueue) {
      step.status = "skipped";
      step.message = message;
      if (!step.finishedAt) step.finishedAt = Date.now();
    }
  }
  saveNow(PERSIST_FILE, Array.from(STORE.values()));
  return true;
}

// ─── Registro jobId → pid del proceso Python ────────────────────────────────
// Vive en globalThis para sobrevivir hot-reload en dev (mismo patrón que STORE).
// /api/long_form/process registra el pid al spawnear; /api/long_form/cancel lo usa
// para matar el árbol completo (python + ffmpeg + remotion) con taskkill /T /F.

declare global {

  var __viral_lf_pid_map__: Map<string, number> | undefined;
}

const PID_MAP: Map<string, number> =
  globalThis.__viral_lf_pid_map__ ?? (globalThis.__viral_lf_pid_map__ = new Map());

export function registerLongFormPid(jobId: string, pid: number): void {
  PID_MAP.set(jobId, pid);
}

export function getLongFormPid(jobId: string): number | undefined {
  return PID_MAP.get(jobId);
}

export function unregisterLongFormPid(jobId: string): void {
  PID_MAP.delete(jobId);
}

// Limpieza: borrar jobs > 4h de antigüedad (los pipelines de render pueden tardar mucho)
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  let changed = false;
  for (const [k, v] of STORE.entries()) {
    // NUNCA borrar un job que aún corre (o espera slot): los pipelines de render
    // pueden superar las 4h y borrarlo dejaría el trabajo activo sin estado.
    if (v.status === "running" || v.status === "queued") continue;
    if (v.startedAt < cutoff) {
      STORE.delete(k);
      changed = true;
    }
  }
  if (changed) persist();
}, 10 * 60 * 1000);
