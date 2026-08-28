import { NextRequest } from "next/server";
import path from "node:path";
import { promises as fs, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { RAW_DIR, RENDERS_DIR, LF_CLIPS, LF_RENDERS, PROJECTS_DIR } from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";

/**
 * El estilo `audiogram` dibuja la onda de la voz con `useWindowedAudioData`, que
 * lee el audio con `fetch()` — y `fetch` SI pasa por CORS, a diferencia de
 * `<OffthreadVideo>`, que Remotion resuelve por su cuenta.
 *
 * Sin estas cabeceras, el render sin ventana fallaba con
 *   "CORS error was suspected due to different origins" -> Failed to fetch
 *
 * Se descubrio porque `audiogram` era el UNICO estilo sin vista previa
 * generable (24 de 25). Pero no se queda en la miniatura: el render real toma
 * el mismo camino, asi que la onda saldria plana — un audiograma sin
 * audiograma, y sin un solo error a la vista.
 *
 * `*` es correcto aca: sirve archivos que el equipo ya tiene en disco, a un
 * renderizador que corre en esta misma maquina.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "range",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
} as const;

const CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB por chunk para playback fluido

function nodeToWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>;
}

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".m4v":
    case ".mp4":
      return "video/mp4";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "video/mp4";
  }
}

/**
 * Encuentra el video que coincide con `id` en una lista ordenada de directorios.
 * Para long-form renders, los archivos tienen sufijo `_styleId` (ej `_supreme.mp4`),
 * así que también probamos prefix match `id_*`.
 */
async function findVideo(
  dirs: string[],
  id: string,
  allowPrefix: boolean
): Promise<string | null> {
  for (const dir of dirs) {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const exact = files.find((f) => path.basename(f, path.extname(f)) === id);
    if (exact) return path.join(dir, exact);
    if (allowPrefix) {
      const pref = files.find((f) => path.basename(f, path.extname(f)).startsWith(id + "_"));
      if (pref) return path.join(dir, pref);
    }
  }
  return null;
}

/**
 * Si viene ?download=1, arma el header Content-Disposition: attachment con un nombre
 * humano: el título del proyecto si existe, si no el nombre del archivo en disco.
 * Incluye fallback ASCII + variante UTF-8 (RFC 5987) para que los acentos sobrevivan.
 */
async function buildDownloadHeaders(
  download: boolean,
  id: string,
  filePath: string
): Promise<Record<string, string>> {
  if (!download) return {};
  const ext = path.extname(filePath) || ".mp4";
  let nice = path.basename(filePath, path.extname(filePath));
  try {
    const project = JSON.parse(
      await fs.readFile(path.join(PROJECTS_DIR, `${id}.json`), "utf-8")
    ) as { title?: string };
    if (project?.title?.trim()) nice = project.title.trim();
  } catch {
    // sin JSON de proyecto (ej. video largo) → nombre del archivo
  }
  // Sanitizar: sin caracteres ilegales para nombre de archivo en Windows.
  nice = nice.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim() || "video";
  const ascii =
    nice
      .normalize("NFKD")
      .replace(/[^ -~]/g, "")
      .replace(/"/g, "")
      .trim() || "video";
  return {
    "Content-Disposition": `attachment; filename="${ascii}${ext}"; filename*=UTF-8''${encodeURIComponent(nice + ext)}`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isSafeId(id)) {
    return new Response("invalid id", { status: 400 });
  }
  const source = req.nextUrl.searchParams.get("source") ?? "raw"; // raw | render

  // Construí la lista de directorios a buscar — short primero, long-form como fallback.
  // Long-form: el "raw" del proyecto vive en LF_CLIPS (los clips son los segmentos editables);
  // los renders editados viven en LF_RENDERS con sufijo _styleId.
  let dirs: string[];
  let allowPrefix = false;
  if (source === "render") {
    dirs = [RENDERS_DIR, LF_RENDERS];
    allowPrefix = true; // long-form renders tienen sufijo _styleId
  } else {
    dirs = [RAW_DIR, LF_CLIPS];
  }

  const filePath = await findVideo(dirs, id, allowPrefix);
  if (!filePath) {
    return new Response("not found", { status: 404 });
  }

  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  const contentType = contentTypeFor(path.extname(filePath));
  const range = req.headers.get("range");

  const download = req.nextUrl.searchParams.get("download") === "1";
  const downloadHeaders = await buildDownloadHeaders(download, id, filePath);

  // HEAD: respondé sin body para que <video> conozca tamaño antes de pedir el primer rango
  if (req.method === "HEAD") {
    return new Response(null, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        ...CORS_HEADERS,
        ...downloadHeaders,
      },
    });
  }

  if (!range) {
    return new Response(nodeToWeb(createReadStream(filePath)), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        ...CORS_HEADERS,
        ...downloadHeaders,
      },
    });
  }

  // Soportar "bytes=START-", "bytes=START-END" y "bytes=-SUFFIX"
  const match2 = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match2) {
    return new Response("invalid range", {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }

  const [, startStr, endStr] = match2;
  let start: number;
  let end: number;
  if (startStr === "" && endStr !== "") {
    const suffix = parseInt(endStr, 10);
    start = Math.max(fileSize - suffix, 0);
    end = fileSize - 1;
  } else if (startStr !== "") {
    start = parseInt(startStr, 10);
    end = endStr ? parseInt(endStr, 10) : Math.min(start + CHUNK_BYTES - 1, fileSize - 1);
  } else {
    return new Response("invalid range", {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }

  if (start >= fileSize || end >= fileSize || start > end) {
    return new Response("range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }

  const chunkSize = end - start + 1;
  return new Response(nodeToWeb(createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      ...CORS_HEADERS,
      ...downloadHeaders,
    },
  });
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return GET(req, ctx);
}
