/**
 * Store + worker para uploads programados a TikTok / LinkedIn / Instagram (bridge).
 *
 * Store: JSON en C:\hermes-data\scheduled-uploads.json
 * Worker: setInterval cada 60s en el process del Next dev server.
 *   - Scanea entries con status=pending y scheduledAt <= now
 *   - Marca running, dispara la función de upload según platform, persiste resultado
 *   - Si dev server se reinicia, el worker arranca de nuevo en el módulo init
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import {
  uploadVideoToTikTok,
  fetchPublishStatus,
  type PrivacyLevel,
} from "@/lib/tiktok-upload";
import { uploadVideoToLinkedIn } from "@/lib/linkedin-upload";
import { publishVideoToFacebook } from "@/lib/facebook-upload";
import { findThumbnail } from "@/lib/thumbnails";
import { pushNotification } from "@/lib/notifications-store";

const STORE_FILE = path.join(path.dirname(DATA_ROOT), "scheduled-uploads.json");
const TICK_MS = 60_000; // chequea cada 60s

export type ScheduledStatus =
  | "pending"
  | "running"
  | "uploaded"
  | "published"
  | "pending_manual" // IG bridge: el worker no publica, espera al humano
  | "failed";

export type SchedulePlatform = "tiktok" | "linkedin" | "instagram_bridge" | "facebook";

export interface ScheduledUpload {
  id: string;
  projectId: string;
  source: "short" | "long_form";
  scheduledAt: number; // epoch ms
  /** Plataforma destino (default tiktok para retro-compat con entries viejas) */
  platform: SchedulePlatform;
  /** Modo de upload TikTok (ignored para otras plataformas) */
  mode: "direct" | "inbox";
  privacyLevel?: PrivacyLevel;
  /** Caption / texto del post. Se elige según platform al crear la entry. */
  caption: string;
  /** Alias legacy del caption — se mantiene por compat con dashboards viejos */
  title: string;
  status: ScheduledStatus;
  /** TikTok publish_id (sólo platform=tiktok) */
  publishId?: string;
  /** TikTok public post id o LinkedIn post URN */
  publicPostId?: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

interface Store {
  uploads: ScheduledUpload[];
}

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const uploads = Array.isArray(parsed.uploads) ? parsed.uploads : [];
    // Migración: entries viejas sin platform → "tiktok", sin caption → title
    for (const u of uploads) {
      if (!u.platform) u.platform = "tiktok";
      if (!u.caption) u.caption = u.title ?? "";
    }
    return { uploads };
  } catch {
    return { uploads: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await writeJsonFileAtomic(STORE_FILE, store);
}

let writeLock: Promise<void> = Promise.resolve();
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeLock;
  let release!: () => void;
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous;
    return await fn();
  } finally {
    release();
  }
}

export async function listScheduled(): Promise<ScheduledUpload[]> {
  const store = await readStore();
  return store.uploads.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

export async function getScheduled(id: string): Promise<ScheduledUpload | null> {
  const store = await readStore();
  return store.uploads.find((u) => u.id === id) ?? null;
}

export async function createScheduled(
  upload: Omit<ScheduledUpload, "id" | "status" | "attempts" | "createdAt" | "updatedAt">
): Promise<ScheduledUpload> {
  return withLock(async () => {
    const store = await readStore();
    const now = Date.now();
    const entry: ScheduledUpload = {
      ...upload,
      id: `sched_${now}_${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.uploads.push(entry);
    await writeStore(store);
    return entry;
  });
}

export async function updateScheduled(
  id: string,
  patch: Partial<ScheduledUpload>
): Promise<ScheduledUpload | null> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.uploads.findIndex((u) => u.id === id);
    if (idx < 0) return null;
    store.uploads[idx] = {
      ...store.uploads[idx],
      ...patch,
      updatedAt: Date.now(),
    };
    await writeStore(store);
    return store.uploads[idx];
  });
}

export async function deleteScheduled(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.uploads.length;
    store.uploads = store.uploads.filter((u) => u.id !== id);
    if (store.uploads.length !== before) {
      await writeStore(store);
      return true;
    }
    return false;
  });
}

// ─── Worker ─────────────────────────────────────────────────────────────

// Guard de re-entrada: si un tick tarda >TICK_MS (un upload lento), el setInterval
// dispara otro tick que leería los MISMOS uploads "pending" antes de que el primero
// los marque "running" → doble publicación de un post real. Este flag serializa los ticks.
let tickRunning = false;

async function tick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await runTick();
  } finally {
    tickRunning = false;
  }
}

async function runTick(): Promise<void> {
  const store = await readStore();
  const now = Date.now();
  const due = store.uploads.filter(
    (u) =>
      (u.status === "pending" && u.scheduledAt <= now) ||
      // F4 — RETRY automático: un fallo transitorio (red, token, API caída) se
      // reintenta hasta 3 veces con 10 min de espera, dentro de las 24h del
      // horario programado. Después de eso queda "failed" definitivo.
      (u.status === "failed" &&
        u.attempts > 0 &&
        u.attempts < 3 &&
        now - u.updatedAt >= 10 * 60_000 &&
        now - u.scheduledAt < 24 * 60 * 60_000)
  );
  for (const upload of due) {
    await processUpload(upload);
  }
  // Refresh status: SOLO aplica a TikTok (LinkedIn publica sincrónico, IG bridge no publica).
  const uploaded = store.uploads.filter(
    (u) => u.platform === "tiktok" && u.status === "uploaded" && u.publishId
  );
  for (const upload of uploaded) {
    try {
      const result = await fetchPublishStatus(upload.publishId!);
      if (result.status === "PUBLISH_COMPLETE") {
        await updateScheduled(upload.id, {
          status: "published",
          publicPostId: result.publicAccessToken,
        });
      } else if (result.status === "FAILED") {
        await updateScheduled(upload.id, {
          status: "failed",
          lastError: result.failReason ?? "publish failed",
        });
      }
    } catch (err) {
      console.warn(`[scheduler] poll status failed for ${upload.id}:`, err);
    }
  }
}

// Tipo de notificación de fallo según la red (el poller del cliente los muestra como toast).
function failNotificationType(platform: SchedulePlatform): "tiktok_failed" | "linkedin_failed" | "publish_failed" {
  if (platform === "tiktok") return "tiktok_failed";
  if (platform === "linkedin") return "linkedin_failed";
  return "publish_failed";
}

async function processUpload(upload: ScheduledUpload): Promise<void> {
  await updateScheduled(upload.id, { status: "running", attempts: upload.attempts + 1 });
  try {
    const path_node = await import("node:path");
    const paths = await import("@/lib/paths");
    const rendersBase =
      upload.source === "long_form" ? paths.LF_RENDERS : paths.RENDERS_DIR;
    const filePath = path_node.join(rendersBase, `${upload.projectId}.mp4`);

    // El render pudo borrarse entre programar y publicar (limpieza / borrado manual).
    // Antes esto moría con "ENOENT" críptico y reintentaba 3 veces al pedo: un archivo
    // que no está no vuelve solo. Fallo DEFINITIVO con mensaje humano + notificación.
    try {
      const fsmod = await import("node:fs/promises");
      await fsmod.access(filePath);
    } catch {
      const msg = `El video generado ya no existe (${upload.projectId}.mp4). Genera el video de nuevo y reprográmalo.`;
      await updateScheduled(upload.id, { status: "failed", lastError: msg, attempts: 3 });
      await pushNotification({
        type: failNotificationType(upload.platform),
        projectId: upload.projectId,
        scheduleId: upload.id,
        scheduledAt: upload.scheduledAt,
        message: msg,
      });
      console.error(`[scheduler] ${upload.id} failed: render no existe (${filePath})`);
      return;
    }

    // DRY-RUN (env VIRAL_PUBLISH_DRYRUN=1): valida TODO el pipeline (cola → worker → estado →
    // calendario) SIN llamar a la API real de la red. Permite probar el flujo end-to-end sin
    // credenciales ni cuenta conectada. Default OFF → no afecta la publicación real.
    if (process.env.VIRAL_PUBLISH_DRYRUN === "1") {
      const fsmod = await import("node:fs/promises");
      await fsmod.access(filePath); // confirma que el render existe (como haría el publish real)
      await updateScheduled(upload.id, {
        status: "published",
        publicPostId: `dryrun_${upload.platform}_${upload.id}`,
      });
      console.log(
        `[scheduler] DRY-RUN ${upload.platform} ${upload.id} → published (simulado, sin API real)`
      );
      return;
    }

    switch (upload.platform) {
      case "tiktok": {
        const result = await uploadVideoToTikTok({
          filePath,
          title: upload.caption || upload.title,
          mode: upload.mode,
          privacyLevel: upload.privacyLevel,
        });
        await updateScheduled(upload.id, {
          status: "uploaded",
          publishId: result.publishId,
        });
        console.log(`[scheduler] tiktok ${upload.id} uploaded (publishId=${result.publishId})`);
        break;
      }
      case "linkedin": {
        // Miniatura custom (si el usuario subió una para este video) → LinkedIn la usa de thumbnail.
        const thumbnailPath = (await findThumbnail(upload.projectId)) ?? undefined;
        const result = await uploadVideoToLinkedIn({
          filePath,
          commentary: upload.caption || upload.title,
          visibility: "PUBLIC",
          thumbnailPath,
        });
        await updateScheduled(upload.id, {
          status: "published",
          publicPostId: result.postUrn,
        });
        console.log(`[scheduler] linkedin ${upload.id} published (postUrn=${result.postUrn})`);
        break;
      }
      case "facebook": {
        // Publica DIRECTO en la Página de Facebook (sube el archivo, sin túnel). Reusa la
        // conexión de Meta de Instagram (misma app). Síncrono como LinkedIn → "published".
        const result = await publishVideoToFacebook({
          videoId: upload.projectId,
          source: upload.source,
          caption: upload.caption || upload.title,
        });
        await updateScheduled(upload.id, {
          status: "published",
          publicPostId: result.videoPostId,
        });
        console.log(`[scheduler] facebook ${upload.id} published (videoPostId=${result.videoPostId})`);
        break;
      }
      case "instagram_bridge": {
        // No API call — solo notificamos al humano que es hora de subir.
        await updateScheduled(upload.id, { status: "pending_manual" });
        await pushNotification({
          type: "instagram_due",
          projectId: upload.projectId,
          scheduleId: upload.id,
          scheduledAt: upload.scheduledAt,
        });
        console.log(`[scheduler] instagram_bridge ${upload.id} → pending_manual + notification`);
        break;
      }
      default: {
        throw new Error(`Plataforma desconocida: ${upload.platform}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateScheduled(upload.id, { status: "failed", lastError: msg });
    console.error(`[scheduler] ${upload.id} failed:`, msg);
    // Si NO va a haber más reintentos (3 intentos o pasó la ventana de 24h), avisar al
    // usuario con una notificación (toast + beep). Antes el fallo final era invisible.
    const attemptsNow = upload.attempts + 1;
    const willRetry =
      attemptsNow < 3 && Date.now() - upload.scheduledAt < 24 * 60 * 60_000;
    if (!willRetry) {
      try {
        await pushNotification({
          type: failNotificationType(upload.platform),
          projectId: upload.projectId,
          scheduleId: upload.id,
          scheduledAt: upload.scheduledAt,
          message: msg,
        });
      } catch (e) {
        console.warn(`[scheduler] no se pudo notificar el fallo de ${upload.id}:`, e);
      }
    }
  }
}

// Singleton — evita iniciar 2 timers si el módulo se re-importa (HMR de Next.js).
declare global {
   
  var __viralSchedulerStarted: boolean | undefined;
}

export function startSchedulerIfNeeded() {
  if (globalThis.__viralSchedulerStarted) return;
  globalThis.__viralSchedulerStarted = true;
  console.log("[scheduler] starting tick loop every", TICK_MS, "ms");
  setInterval(() => {
    tick().catch((e) => console.error("[scheduler] tick error:", e));
  }, TICK_MS);
  // Tick inicial inmediato (no esperamos 60s al boot)
  tick().catch((e) => console.error("[scheduler] initial tick error:", e));
}
