/**
 * Cola de notificaciones in-process.
 *
 * El worker de scheduling escribe aquí cuando una entry de Instagram bridge llega a su hora
 * (no podemos publicar automático, hay que avisar al humano). El cliente lee vía
 * /api/notifications con polling para mostrar toast + sonido.
 *
 * Store: JSON en C:\hermes-data\notifications.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";

const STORE_FILE = path.join(path.dirname(DATA_ROOT), "notifications.json");

export type NotificationType =
  | "instagram_due"
  | "tiktok_failed"
  | "linkedin_failed"
  // Fallo definitivo de publicación en cualquier otra red (facebook, etc.).
  | "publish_failed"
  | "render_done"
  | "render_failed";

export interface Notification {
  id: string;
  type: NotificationType;
  projectId: string;
  scheduleId?: string;
  scheduledAt: number;
  message?: string;
  ack: boolean;
  createdAt: number;
  ackedAt?: number;
}

interface Store {
  notifications: Notification[];
}

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [] };
  } catch {
    return { notifications: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf-8");
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

export async function pushNotification(
  payload: Omit<Notification, "id" | "ack" | "createdAt">
): Promise<Notification> {
  return withLock(async () => {
    const store = await readStore();
    const now = Date.now();
    const note: Notification = {
      ...payload,
      id: `notif_${now}_${Math.random().toString(36).slice(2, 8)}`,
      ack: false,
      createdAt: now,
    };
    // Dedup: si ya hay una idéntica sin ack para el mismo schedule, no la dupliques.
    const dupe = store.notifications.find(
      (n) =>
        !n.ack &&
        n.type === payload.type &&
        n.scheduleId === payload.scheduleId &&
        n.projectId === payload.projectId
    );
    if (dupe) return dupe;
    store.notifications.push(note);
    await writeStore(store);
    return note;
  });
}

export async function listPendingNotifications(): Promise<Notification[]> {
  const store = await readStore();
  return store.notifications.filter((n) => !n.ack).sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAllNotifications(): Promise<Notification[]> {
  const store = await readStore();
  return [...store.notifications].sort((a, b) => b.createdAt - a.createdAt);
}

export async function ackNotification(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.notifications.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    store.notifications[idx] = {
      ...store.notifications[idx],
      ack: true,
      ackedAt: Date.now(),
    };
    await writeStore(store);
    return true;
  });
}

export async function ackAllNotifications(): Promise<number> {
  return withLock(async () => {
    const store = await readStore();
    const now = Date.now();
    let count = 0;
    for (const n of store.notifications) {
      if (!n.ack) {
        n.ack = true;
        n.ackedAt = now;
        count++;
      }
    }
    if (count > 0) await writeStore(store);
    return count;
  });
}
