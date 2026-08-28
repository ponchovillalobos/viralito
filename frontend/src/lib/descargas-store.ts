/**
 * Cola de descargas por enlace — pegás varios links y se bajan de a uno.
 *
 * Antes sólo se podía pegar UN enlace y esperar: la petición se quedaba abierta
 * hasta que el video terminaba de bajar, con un tope de 30 minutos. Con once
 * videos de dos horas eso son once esperas seguidas, delante de la pantalla, y
 * cualquier recarga las pierde.
 *
 * Se apoya en la MISMA cola que el resto del proyecto (`job-queue`), no en una
 * propia. Este repo ya se llevó varios sustos con mecanismos escritos dos veces
 * (los estilos, los temas, las miniaturas): una segunda cola habría sido otro.
 *
 * Store: JSON al lado de los datos, escrito de forma atómica. Sobrevive a un
 * reinicio de la app, así que lo que quedó en cola se puede retomar.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { writeJsonFileAtomic } from "@/lib/atomic-write";

const ARCHIVO = path.join(path.dirname(DATA_ROOT), "descargas-cola.json");

export type EstadoDescarga = "en_cola" | "bajando" | "listo" | "fallo";

export interface Descarga {
  id: string;
  url: string;
  flujo: "corto" | "largo";
  estado: EstadoDescarga;
  /** id del video ya en disco (D##_slug), cuando terminó bien. */
  videoId?: string;
  duracionS?: number;
  error?: string;
  /** Marcas de tiempo en epoch ms. */
  creadoEn: number;
  terminadoEn?: number;
}

interface Store {
  descargas: Descarga[];
}

declare global {
  var __viral_descargas__: Store | undefined;
}

const MEM: Store = (globalThis.__viral_descargas__ ??= { descargas: [] });

let cargado = false;

async function cargar(): Promise<void> {
  if (cargado) return;
  cargado = true;
  try {
    const crudo = await fs.readFile(ARCHIVO, "utf-8");
    const d = JSON.parse(crudo) as Store;
    if (Array.isArray(d.descargas)) {
      // Lo que quedó "bajando" cuando la app se cerró no está bajando: nadie lo
      // está haciendo. Decirlo es más honesto que dejar una fila girando para
      // siempre — el usuario puede volver a encolarla.
      MEM.descargas = d.descargas.map((x) =>
        x.estado === "bajando"
          ? { ...x, estado: "fallo" as const, error: "la aplicación se cerró a mitad de la descarga" }
          : x
      );
    }
  } catch {
    /* primera vez: no hay archivo */
  }
}

async function guardar(): Promise<void> {
  // Se conservan las últimas 200: el historial sirve, pero no para siempre.
  MEM.descargas = MEM.descargas.slice(-200);
  await writeJsonFileAtomic(ARCHIVO, MEM).catch(() => {});
}

export async function listarDescargas(): Promise<Descarga[]> {
  await cargar();
  return [...MEM.descargas].sort((a, b) => b.creadoEn - a.creadoEn);
}

export async function crearDescarga(
  url: string,
  flujo: "corto" | "largo",
  ahora: number
): Promise<Descarga> {
  await cargar();
  const d: Descarga = {
    id: `dl_${ahora.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    url,
    flujo,
    estado: "en_cola",
    creadoEn: ahora,
  };
  MEM.descargas.push(d);
  await guardar();
  return d;
}

export async function actualizarDescarga(
  id: string,
  parche: Partial<Descarga>
): Promise<void> {
  await cargar();
  const i = MEM.descargas.findIndex((d) => d.id === id);
  if (i < 0) return;
  MEM.descargas[i] = { ...MEM.descargas[i], ...parche };
  await guardar();
}

/**
 * ¿Esta URL ya está en cola o bajando?
 *
 * Pegar la misma lista dos veces es de lo más normal —se recarga la página, se
 * duda de si el clic entró— y bajar dos horas de video por duplicado no lo
 * arregla nadie después.
 */
export async function yaEnCola(url: string): Promise<Descarga | undefined> {
  await cargar();
  return MEM.descargas.find(
    (d) => d.url === url && (d.estado === "en_cola" || d.estado === "bajando")
  );
}
