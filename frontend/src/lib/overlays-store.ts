/**
 * Store de image overlays para el modo cinematográfico.
 *
 * Guarda en C:\hermes-data\overlays-library.json el registro de cada imagen
 * subida por el usuario para superponer sobre un video. Los binarios viven en
 * {OVERLAYS_DIR}/{videoId}/{overlayId}.{ext}.
 *
 * Cada overlay tiene timestamps + effect + motion + transitions que controlan
 * cómo aparece sobre el video. El render de Remotion (cinematic-layers.tsx)
 * lee estos campos y los aplica.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT, OVERLAYS_DIR } from "@/lib/paths";
import { writeJsonFileAtomic } from "@/lib/atomic-write";

const STORE_FILE = path.join(path.dirname(DATA_ROOT), "overlays-library.json");

export type OverlayEffect =
  | "tv_static"
  | "memory_flash"
  | "polaroid"
  | "vhs"
  | "newspaper"
  | "none";

export type OverlayMotion =
  | "ken_burns_in"
  | "ken_burns_out"
  | "pan_left"
  | "pan_right"
  | "zoom_bump"
  | "static";

export type OverlayTransition =
  | "fade"
  | "slide_up"
  | "slide_down"
  | "zoom_out"
  | "tv_off"
  | "escala_medida";

export type OverlayPosition = "center" | "top" | "bottom" | "left" | "right";

export interface ImageOverlay {
  id: string;
  /** A qué video se ata. Para cortos = videoId del raw; para largos = videoId del clip */
  videoId: string;
  /** Nombre original del archivo subido */
  filename: string;
  /** Path absoluto del archivo en disco */
  imagePath: string;
  /** Tipo MIME (image/jpeg, image/png, image/webp) */
  mimeType: string;
  sizeBytes: number;
  /** Descripción libre del usuario — para guiar al matching IA */
  description?: string;
  /**
   * Orden manual del usuario (1, 2, 3...). Si está seteado, el agente VFX
   * RESPETA este orden. Si dos overlays tienen el mismo userOrder o uno no lo
   * tiene, gana el matching semántico del transcript.
   */
  userOrder?: number;
  /** Cuándo aparece (segundos del video). null = sin asignar todavía */
  startTime?: number | null;
  endTime?: number | null;
  /** Cómo se ve la imagen */
  effect?: OverlayEffect;
  motion?: OverlayMotion;
  /** Transición de entrada y de salida */
  transitionIn?: OverlayTransition;
  transitionOut?: OverlayTransition;
  /** Dónde se posiciona en el frame */
  position?: OverlayPosition;
  /** Tamaño relativo al frame (0.0-1.0). Default 0.6 */
  sizeRatio?: number;
  /** SFX a inyectar en la entrada (referencia a un archivo de SFX_DIR) */
  sfxId?: string;
  createdAt: number;
  updatedAt: number;
}

interface Store {
  overlays: ImageOverlay[];
  version: number;
}

const EMPTY: Store = { overlays: [], version: 1 };

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      overlays: Array.isArray(parsed.overlays) ? parsed.overlays : [],
      version: parsed.version ?? 1,
    };
  } catch {
    return { ...EMPTY };
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

export async function listOverlays(videoId?: string): Promise<ImageOverlay[]> {
  const store = await readStore();
  const items = videoId
    ? store.overlays.filter((o) => o.videoId === videoId)
    : store.overlays;
  return items.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

export async function getOverlay(id: string): Promise<ImageOverlay | null> {
  const store = await readStore();
  return store.overlays.find((o) => o.id === id) ?? null;
}

export async function createOverlay(
  data: Omit<ImageOverlay, "id" | "createdAt" | "updatedAt">
): Promise<ImageOverlay> {
  return withLock(async () => {
    const store = await readStore();
    const now = Date.now();
    const entry: ImageOverlay = {
      ...data,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `ov_${(crypto as { randomUUID(): string }).randomUUID().slice(0, 8)}_${now.toString(36)}`
          : `ov_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    store.overlays.push(entry);
    await writeStore(store);
    return entry;
  });
}

export async function updateOverlay(
  id: string,
  patch: Partial<ImageOverlay>
): Promise<ImageOverlay | null> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.overlays.findIndex((o) => o.id === id);
    if (idx < 0) return null;
    store.overlays[idx] = {
      ...store.overlays[idx],
      ...patch,
      updatedAt: Date.now(),
    };
    await writeStore(store);
    return store.overlays[idx];
  });
}

export async function deleteOverlay(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const target = store.overlays.find((o) => o.id === id);
    if (!target) return false;
    store.overlays = store.overlays.filter((o) => o.id !== id);
    await writeStore(store);
    // Best-effort: borrar el binario en disco
    try {
      await fs.unlink(target.imagePath);
    } catch {
      // ignore
    }
    return true;
  });
}

export { OVERLAYS_DIR };
