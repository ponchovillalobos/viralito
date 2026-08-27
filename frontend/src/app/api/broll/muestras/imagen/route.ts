import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_ROOT } from "@/lib/paths";

/**
 * Sirve el fotograma de muestra de la biblioteca local.
 *
 * Vive fuera del arbol publico (esta en la carpeta de datos del usuario, no en
 * el repo), asi que necesita una ruta que lo lea del disco. Es un solo archivo
 * con nombre fijo que genera `/api/broll/muestras`.
 */
export async function GET() {
  try {
    const ruta = path.join(DATA_ROOT, "assets", "broll", ".muestra-selector.jpg");
    const datos = await fs.readFile(ruta);
    return new NextResponse(new Uint8Array(datos), {
      headers: {
        "Content-Type": "image/jpeg",
        // Cambia solo si se regenera la biblioteca: vale la pena cachearlo.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
