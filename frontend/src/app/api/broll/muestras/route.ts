import { NextRequest, NextResponse } from "next/server";

import { type BrollSource } from "@/lib/pexels";

/**
 * Miniaturas de ejemplo, una por fuente de B-roll.
 *
 * Nace de un problema concreto: el selector pedía elegir entre "Videos", "Fotos"
 * y "GIFs" a ciegas. Los nombres no dicen cómo se ve el resultado, y la
 * diferencia entre un clip de stock y un GIF de Giphy es justamente visual.
 *
 * Devuelve una imagen real de cada fuente para la palabra que se pida, así que
 * lo que se ve en el selector es material del mismo sitio del que va a salir el
 * B-roll — no un dibujito representativo.
 *
 * Es best-effort por diseño: una fuente que no responda (sin clave, sin red,
 * límite de peticiones) devuelve `null` y el selector muestra su tarjeta sin
 * miniatura. Nunca falla la petición entera por una fuente caída — el usuario
 * tiene que poder elegir aunque Giphy esté abajo.
 */

export const dynamic = "force-dynamic";

/** Una palabra neutra y visual: da resultados en las tres fuentes. */
const CONSULTA_POR_OMISION = "city";

/** Cache en memoria del proceso: las muestras no cambian entre pulsaciones. */
const CACHE = new Map<string, { url: string | null; cuando: number }>();
const VIGENCIA_MS = 30 * 60 * 1000;

/**
 * Un fotograma de un clip de la biblioteca local, extraido con ffmpeg.
 *
 * Se cachea en el propio arbol de assets: sacar un fotograma cuesta ~200ms y el
 * selector se abre muchas veces. Si no hay biblioteca todavia, devuelve null y
 * la tarjeta se muestra con su emoji.
 */
async function muestraDeLaBiblioteca(): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { DATA_ROOT } = await import("@/lib/paths");
    const dir = path.join(DATA_ROOT, "assets", "broll");
    const archivos = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith(".mp4"));
    if (!archivos.length) return null;

    // Determinista: el mismo clip cada vez, para que la miniatura no baile.
    const elegido = archivos.sort()[0];
    const destino = path.join(dir, ".muestra-selector.jpg");
    try {
      await fs.access(destino);
      return "/api/broll/muestras/imagen";
    } catch {
      /* todavia no existe: se genera abajo */
    }

    const { FFMPEG_EXE } = await import("@/lib/paths");
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve) => {
      const p = spawn(FFMPEG_EXE, [
        "-v", "error", "-ss", "1", "-i", path.join(dir, elegido),
        "-frames:v", "1", "-vf", "scale=320:-1", "-y", destino,
      ], { windowsHide: true });
      p.on("close", () => resolve());
      p.on("error", () => resolve());
    });
    await fs.access(destino);
    return "/api/broll/muestras/imagen";
  } catch {
    return null;
  }
}

async function muestraDe(fuente: BrollSource, q: string): Promise<string | null> {
  const clave = `${fuente}|${q}`;
  const guardada = CACHE.get(clave);
  if (guardada && Date.now() - guardada.cuando < VIGENCIA_MS) return guardada.url;

  let url: string | null = null;
  try {
    if (fuente === "giphy") {
      // Funcion dedicada: la miniatura no necesita que el resultado traiga MP4.
      const { buscarMuestraGiphy } = await import("@/lib/broll-giphy");
      url = await buscarMuestraGiphy(q);
    } else if (fuente === "cc0") {
      // "Mi biblioteca" es lo que YA esta descargado, asi que su vista previa
      // sale del disco. Traerla de Internet Archive seria incoherente: mostraria
      // material que esa opcion justamente NO va a usar.
      url = await muestraDeLaBiblioteca();
    } else {
      const key = process.env.PEXELS_API_KEY;
      if (key) {
        const { buscarMuestraPexels } = await import("@/lib/pexels");
        url = await buscarMuestraPexels(q, key, fuente === "pexels_photo");
      }
    }
  } catch {
    url = null; // fuente caída: la tarjeta se muestra sin miniatura
  }
  CACHE.set(clave, { url, cuando: Date.now() });
  return url;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || CONSULTA_POR_OMISION).slice(0, 40);
  const fuentes: BrollSource[] = ["pexels_video", "pexels_photo", "giphy", "cc0"];

  // En paralelo: son cuatro esperas de red independientes y el selector no
  // deberia tardar la suma de las cuatro.
  const resultados = await Promise.all(
    fuentes.map(async (f) => [f, await muestraDe(f, q)] as const)
  );

  return NextResponse.json({
    q,
    muestras: Object.fromEntries(resultados),
  });
}
