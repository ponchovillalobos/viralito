import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BROLL_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Sirve el b-roll YA descargado a disco (lib broll-localize lo baja a BROLL_DIR) para
// que Remotion <OffthreadVideo> lea desde localhost en vez de internet. CORS abierto:
// el render headless lee desde el bundle (otro origen) y necesita Range para seekear.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
} as const;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return new Response("bad request", { status: 400, headers: CORS_HEADERS });
  }
  const filePath = path.join(BROLL_DIR, file);
  try {
    const stat = await fs.stat(filePath);
    // El b-roll no siempre es video: el respaldo CC0 sirve fotos de Openverse y
    // Pexels tiene modo foto. Si a una imagen se le manda "video/mp4" el
    // navegador no la pinta y el compositor de Remotion falla al decodificarla.
    const ext = path.extname(file).toLowerCase();
    const TIPOS: Record<string, string> = {
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mp4": "video/mp4",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    const contentType = TIPOS[ext] ?? "video/mp4";

    // Soporte REAL de Range (206): OffthreadVideo pide el video por rangos al seekear.
    const range = req.headers.get("range");
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
        if (start <= end && start < stat.size) {
          const stream = createReadStream(filePath, { start, end });
          return new Response(stream as unknown as ReadableStream, {
            status: 206,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": contentType,
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${stat.size}`,
              "Accept-Ranges": "bytes",
            },
          });
        }
      }
    }

    const stream = createReadStream(filePath);
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
      },
    });
  } catch {
    return new Response("not found", { status: 404, headers: CORS_HEADERS });
  }
}
