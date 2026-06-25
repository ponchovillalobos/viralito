/**
 * Store de métricas reales del creador (server-side JSON).
 *
 * Persistencia: <DATA_ROOT>/../metrics.json  → C:\hermes-data\metrics.json
 *
 * Reemplaza al localStorage que se usaba antes. Permite cruzar con project.json
 * y calcular insights (top hooks, ranking de captions, benchmarks).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import { withSerialLock } from "@/lib/serial-lock";

const STORE_FILE = path.join(path.dirname(DATA_ROOT), "metrics.json");

export type PlatformKey = "tiktok" | "instagram" | "linkedin" | "facebook";

export interface MetricEntry {
  id: string;
  /** ID del proyecto editado (matchea projects/*.json) — opcional para entries manuales */
  projectId?: string;
  platform: PlatformKey;
  /** Día relativo al lanzamiento (1, 2, 3...) — útil para gráficas comparativas */
  day: number;
  /** Fecha del snapshot (ISO date) */
  date?: string;
  /** Timestamp absoluto en epoch ms — útil para insights */
  postedAt?: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves?: number;
  follows?: number;
  /** Promedio de tiempo viewed (segundos) — para completion proxy */
  avgWatchTime?: number;
  /** Duración total del video (segundos) — para completion proxy */
  duration?: number;
  /** Retención al segundo 3 (%) — métrica north-star de TikTok 2026 */
  retention3s?: number;
  notes?: string;
  /** URN del post en la red (ej. LinkedIn urn:li:share:123) — para auto-sync de métricas. */
  postUrn?: string;
  createdAt: string;
  updatedAt?: string;
}

interface Store {
  entries: MetricEntry[];
  /** Versión del schema para migraciones futuras */
  version: number;
}

const EMPTY: Store = { entries: [], version: 1 };

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      version: parsed.version ?? 1,
    };
  } catch {
    return { ...EMPTY };
  }
}

async function writeStore(store: Store): Promise<void> {
  await writeJsonFileAtomic(STORE_FILE, store);
}

// Read-modify-write serializado con el helper compartido (serial-lock.ts): dos
// requests concurrentes que agregan/actualizan métricas no se pisan el JSON. Antes
// había un mutex casero acá; ahora usamos el lock global por clave "metrics".
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  return withSerialLock("metrics", fn);
}

export async function listEntries(): Promise<MetricEntry[]> {
  const store = await readStore();
  return store.entries.sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.day - b.day;
  });
}

export async function createEntry(
  entry: Omit<MetricEntry, "id" | "createdAt">
): Promise<MetricEntry> {
  return withLock(async () => {
    const store = await readStore();
    const newEntry: MetricEntry = {
      ...entry,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? (crypto as { randomUUID(): string }).randomUUID()
          : `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };
    store.entries.push(newEntry);
    await writeStore(store);
    return newEntry;
  });
}

export async function updateEntry(
  id: string,
  patch: Partial<MetricEntry>
): Promise<MetricEntry | null> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    store.entries[idx] = {
      ...store.entries[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeStore(store);
    return store.entries[idx];
  });
}

export async function deleteEntry(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.entries.length;
    store.entries = store.entries.filter((e) => e.id !== id);
    if (store.entries.length !== before) {
      await writeStore(store);
      return true;
    }
    return false;
  });
}

export async function bulkImport(entries: Omit<MetricEntry, "id" | "createdAt">[]): Promise<number> {
  return withLock(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    let count = 0;
    for (const e of entries) {
      store.entries.push({
        ...e,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? (crypto as { randomUUID(): string }).randomUUID()
            : `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${count}`,
        createdAt: now,
      });
      count++;
    }
    if (count > 0) await writeStore(store);
    return count;
  });
}

/**
 * Devuelve completion proxy: avgWatchTime / duration. Null si faltan datos.
 */
export function completionProxy(e: MetricEntry): number | null {
  if (!e.avgWatchTime || !e.duration || e.duration <= 0) return null;
  return Math.max(0, Math.min(1, e.avgWatchTime / e.duration));
}

/**
 * Engagement rate clásico: (likes + comments + shares + saves) / views.
 */
export function engagementRate(e: MetricEntry): number | null {
  if (!e.views || e.views <= 0) return null;
  const engagement = (e.likes ?? 0) + (e.comments ?? 0) + (e.shares ?? 0) + (e.saves ?? 0);
  return engagement / e.views;
}

/**
 * Save-share ratio: (shares + saves) / views — métrica que TikTok prioriza más que likes.
 */
export function viralRatio(e: MetricEntry): number | null {
  if (!e.views || e.views <= 0) return null;
  return ((e.shares ?? 0) + (e.saves ?? 0)) / e.views;
}
