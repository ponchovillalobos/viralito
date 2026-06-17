import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RENDERS_DIR, LF_RENDERS } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * Abre el render del proyecto en el explorador de archivos del SO con el archivo seleccionado.
 * Sirve para el flujo "subir a TikTok manual" — el usuario arrastra el archivo a tiktok.com/upload.
 *
 * Body opcional: { source?: "short" | "long_form" }  (default: "short")
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let source: "short" | "long_form" = "short";
  try {
    const body = await req.json();
    if (body?.source === "long_form") source = "long_form";
  } catch {
    // no body, default short
  }

  const baseDir = source === "long_form" ? LF_RENDERS : RENDERS_DIR;
  const filePath = path.join(baseDir, `${id}.mp4`);

  // Path traversal protection: el path resuelto debe estar dentro del dir base.
  const resolved = path.resolve(filePath);
  const baseResolved = path.resolve(baseDir);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Si el render existe → lo seleccionamos en el explorador. Si NO existe (aún no se
  // generó, o el id no coincide con el nombre del archivo), NO fallamos: abrimos igual
  // la carpeta contenedora (que siempre existe) para que "Abrir carpeta" nunca tire
  // error. Antes devolvía 404 y el usuario veía "no se puede abrir la carpeta".
  let fileExists = true;
  try {
    await fs.access(resolved);
  } catch {
    fileExists = false;
  }
  // Asegurar que la carpeta de salida exista (primera vez / data root nuevo).
  await fs.mkdir(baseResolved, { recursive: true }).catch(() => {});

  // Abrir en el file manager nativo. Fire-and-forget; si falla, igual devolvemos OK.
  if (process.platform === "win32") {
    // explorer /select,"file" resalta el archivo; explorer "folder" abre la carpeta.
    exec(fileExists ? `explorer /select,"${resolved}"` : `explorer "${baseResolved}"`, () => {});
  } else if (process.platform === "darwin") {
    exec(fileExists ? `open -R "${resolved}"` : `open "${baseResolved}"`, () => {});
  } else {
    exec(`xdg-open "${fileExists ? path.dirname(resolved) : baseResolved}"`, () => {});
  }

  return NextResponse.json({ ok: true, path: fileExists ? resolved : baseResolved, fileExists });
}
