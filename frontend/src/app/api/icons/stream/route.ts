/**
 * GET /api/icons/stream?file=<pack>/<name>.svg — sirve un icono SVG de la
 * biblioteca local (assets/icons/{phosphor-duotone,tabler}) para PREVISUALIZARLO
 * en la galería de stickers. CORS abierto por si un preview de Remotion lo pidiera.
 *
 * Igual que sfx/lottie: aceptamos la ruta relativa con subcarpeta (pack), bloqueando
 * traversal (".."); el join + check de containment garantiza que no se escape de
 * ICONS_DIR. Los SVG de Phosphor/Tabler usan currentColor → el render embebe el
 * markup (editorial-icons.mjs); acá sólo lo servimos tal cual para el <img>/<object>.
 */
import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { fireRepair } from "@/lib/self-heal-assets";

export const dynamic = "force-dynamic";

const ICONS_DIR = path.join(DATA_ROOT, "assets", "icons");

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
  if (!norm || norm.includes("..") || !/^[a-z0-9_/-]+\.svg$/i.test(norm)) {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }
  const target = path.resolve(ICONS_DIR, norm);
  if (target !== ICONS_DIR && !target.startsWith(ICONS_DIR + path.sep)) {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }
  try {
    const buf = await fs.readFile(target);
    return new Response(new Uint8Array(buf), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch {
    // Un icono pedido que no está suele indicar que el set quedó incompleto
    // (descarga a medias). Disparamos el self-heal en background (idempotente,
    // con cooldown) y devolvemos 404 para este request.
    fireRepair("icons");
    return new Response("not found", { status: 404, headers: CORS_HEADERS });
  }
}
