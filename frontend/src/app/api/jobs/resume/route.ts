import { NextResponse } from "next/server";
import { enqueue } from "@/lib/job-queue";
import { listJobs } from "@/lib/job-store";
import { listLongFormJobs } from "@/lib/long-form-job-store";
import { processJob as processEditorJob } from "@/app/api/editor/auto-build/route";
import { processJob as processLongFormJob } from "@/app/api/long_form/process/route";

/**
 * Reanuda los jobs que quedaron SOLO en cola (nunca arrancaron) cuando la app se
 * reinició. El reconcile de cada store los deja con `resumable: true` + su `request`
 * persistido; acá los volvemos a encolar reusando el MISMO processJob de cada ruta.
 *
 * Por qué existe: la cola vive en memoria (globalThis) y NO se persiste, así que un
 * reinicio perdía los encolados ("se interrumpió porque la app se reinició"). Ahora
 * se reanudan solos. Idempotente: al reanudar se limpia `resumable`, así que llamarlo
 * 2 veces no duplica. Lo dispara el panel de tareas al montar (tras un reinicio).
 *
 * Solo reanuda jobs que NUNCA arrancaron (status quedó "queued"). Un render a medias
 * NO se reanuda (no es seguro retomarlo); eso se regenera a mano como antes.
 */

// Tipos derivados de la firma de cada processJob → no dependemos de exports de tipo.
type EditorBody = Parameters<typeof processEditorJob>[1];
type LongFormBody = Parameters<typeof processLongFormJob>[2];

export async function POST() {
  let resumed = 0;
  const ids: string[] = [];

  // ── Editor (shorts) ──
  for (const job of listJobs()) {
    if (!job.resumable || !job.request) continue;
    job.resumable = false;
    job.finishedAt = undefined;
    job.status = "queued";
    for (const s of job.steps) {
      s.status = "pending";
      s.progress = 0;
      s.error = undefined;
      s.currentFrame = undefined;
    }
    const body = job.request as EditorBody;
    enqueue("editor", job.id, async () => {
      await processEditorJob(job, body);
    });
    resumed++;
    ids.push(job.id);
  }

  // ── Long form ──
  for (const job of listLongFormJobs()) {
    if (!job.resumable || !job.request) continue;
    job.resumable = false;
    job.finishedAt = undefined;
    job.status = "queued";
    for (const s of job.steps) {
      // El render que arrancó "skipped" (corrida sin render) se respeta.
      if (s.status === "skipped") continue;
      s.status = "pending";
      s.message = undefined;
      s.progress = undefined;
      s.finishedAt = undefined;
    }
    const body = job.request as LongFormBody;
    enqueue("long_form", job.id, async () => {
      await processLongFormJob(job.id, job.videoId, body);
    });
    resumed++;
    ids.push(job.id);
  }

  return NextResponse.json({ ok: true, resumed, ids });
}
