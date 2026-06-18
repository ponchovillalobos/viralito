/**
 * GET /api/illustrations/stream?file=<set>/<name>.svg — sirve una ilustración de
 * personas CC0 (assets/illustrations/{open-doodles,open-peeps}) para previsualizarla
 * en la galería de stickers y consumirla en el render. A diferencia de los iconos
 * (currentColor), estas son MULTICOLOR → se sirven tal cual; el tinte duotono por
 * tema lo aplica la capa de Remotion, no acá.
 *
 * Igual que icons/sfx/lottie: ruta relativa con subcarpeta (set), bloqueando
 * traversal (".."); el resolve + check de containment garantiza no escapar del dir.
 */
import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { countFiles, fireRepair } from "@/lib/self-heal-assets";

export const dynamic = "force-dynamic";

const ILLUS_DIR = path.join(DATA_ROOT, "assets", "illustrations");

// Self-heal: si las ilustraciones quedaron por debajo del mínimo, re-descargar
// en background sin bloquear el request.
const ILLUS_MIN_FILES = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
} as const;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file") ?? "";
  const norm = file.split("\\").join("/").replace(/^\/+/, "");
  if (!norm || norm.includes("..") || !/^[a-z0-9_/-]+\.(svg|png)$/i.test(norm)) {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }
  // Self-heal: contar las ilustraciones (recursivo sobre los sets). Si está corta,
  // disparar repair en background sin bloquear.
  const illusCount = await countFiles(ILLUS_DIR, true);
  if (illusCount < ILLUS_MIN_FILES) fireRepair("illustrations");
  const target = path.resolve(ILLUS_DIR, norm);
  if (target !== ILLUS_DIR && !target.startsWith(ILLUS_DIR + path.sep)) {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }
  try {
    const buf = await fs.readFile(target);
    const type = norm.toLowerCase().endsWith(".png") ? "image/png" : "image/svg+xml";
    return new Response(new Uint8Array(buf), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch {
    // No se pudo servir el archivo pedido. Si la carpeta está vacía, 503 + repair;
    // si hay otras ilustraciones, es un 404 honesto (archivo puntual no existe).
    if (illusCount === 0) {
      fireRepair("illustrations");
      return new Response(
        JSON.stringify({ ok: false, error: "Esta librería se está re-descargando — intentá en 1-2 minutos" }),
        { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404, headers: CORS_HEADERS });
  }
}
