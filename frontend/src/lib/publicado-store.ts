/**
 * Registro de "ya lo subí a esta red", marcado A MANO.
 *
 * Persistencia: <DATA_ROOT>/../publicado.json
 *
 * Por qué existe, si ya hay `scheduled-uploads.ts`: aquel registra las subidas
 * que hace la app (programadas, con OAuth, con reintentos) y su estado sale del
 * resultado de la API. Éste registra lo contrario — el video que la persona
 * subió con sus propias manos, abriendo TikTok y arrastrando el archivo.
 *
 * Ese caso no tenía dónde anotarse. El estado `pending_manual` existía, y nada
 * en toda la app lo cerraba: se quedaba en ámbar para siempre. Con veinte o
 * treinta videos en el catálogo, "¿éste ya lo subí a LinkedIn?" se vuelve una
 * pregunta que sólo contesta la memoria.
 *
 * Es deliberadamente tonto: un timestamp por (video, red). No verifica nada
 * contra la red, no sincroniza, no caduca. Lo que la persona marca es la
 * verdad, porque es la única que sabe si de verdad lo subió.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import { withSerialLock } from "@/lib/serial-lock";

const STORE_FILE = path.join(path.dirname(DATA_ROOT), "publicado.json");

/** Las mismas cuatro de `metrics-store.ts`, a propósito: un solo vocabulario. */
export type RedKey = "tiktok" | "instagram" | "linkedin" | "facebook";

export const REDES: readonly RedKey[] = ["tiktok", "instagram", "linkedin", "facebook"];

/** Marcas de un video: red → epoch ms en que se marcó. */
export type MarcasDeVideo = Partial<Record<RedKey, number>>;

interface Store {
  /** projectId → { red: timestamp } */
  videos: Record<string, MarcasDeVideo>;
  version: number;
}

function esRed(v: unknown): v is RedKey {
  return typeof v === "string" && (REDES as readonly string[]).includes(v);
}

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // Saneado defensivo: el archivo lo puede editar un humano, y un valor raro
    // no debe tumbar el catálogo entero.
    const videos: Record<string, MarcasDeVideo> = {};
    for (const [id, marcas] of Object.entries(parsed?.videos ?? {})) {
      if (!marcas || typeof marcas !== "object") continue;
      const limpio: MarcasDeVideo = {};
      for (const [red, ts] of Object.entries(marcas as Record<string, unknown>)) {
        if (esRed(red) && typeof ts === "number" && Number.isFinite(ts)) limpio[red] = ts;
      }
      if (Object.keys(limpio).length > 0) videos[id] = limpio;
    }
    return { videos, version: parsed?.version ?? 1 };
  } catch {
    return { videos: {}, version: 1 };
  }
}

async function writeStore(store: Store): Promise<void> {
  await writeJsonFileAtomic(STORE_FILE, store);
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  return withSerialLock("publicado", fn);
}

/** Todas las marcas, para pintar el catálogo de una sola vez. */
export async function listarPublicado(): Promise<Record<string, MarcasDeVideo>> {
  return (await readStore()).videos;
}

/** Marcas de un video concreto. */
export async function marcasDe(projectId: string): Promise<MarcasDeVideo> {
  return (await readStore()).videos[projectId] ?? {};
}

/**
 * Enciende o apaga una red para un video. Devuelve cómo quedó.
 *
 * `marcado` explícito en vez de un toggle ciego: dos clics rápidos, o dos
 * pestañas abiertas, no deben dejar el estado al azar de quién llegó último.
 */
export async function marcar(
  projectId: string,
  red: RedKey,
  marcado: boolean,
  cuando = Date.now()
): Promise<MarcasDeVideo> {
  return withLock(async () => {
    const store = await readStore();
    const actual = { ...(store.videos[projectId] ?? {}) };
    if (marcado) actual[red] = cuando;
    else delete actual[red];

    if (Object.keys(actual).length === 0) delete store.videos[projectId];
    else store.videos[projectId] = actual;

    await writeStore(store);
    return actual;
  });
}

/**
 * Olvida un video entero. Lo llama el borrado de proyectos: si el video ya no
 * existe, sus marcas son basura que crece para siempre.
 */
export async function olvidar(projectId: string): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    if (!(projectId in store.videos)) return;
    delete store.videos[projectId];
    await writeStore(store);
  });
}
