import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LF_RAW, LF_CLEAN } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * BORRADO de un video largo: elimina del disco SOLO el raw en LF_RAW y su
 * intermedio _clean en LF_CLEAN.
 *
 * ⚠️ INVARIANTE (incidente 2026-07-03): borrar el video original NO toca sus
 * CLIPS ni sus RENDERS ni sus proposals/transcripts — los videos generados son el
 * producto del usuario (siguen en Mis videos, publicables, con su score) y los
 * clips permiten re-generar otros estilos aunque el original ya no esté. Antes
 * esta ruta borraba TODO en cascada y destruyó renders terminados.
 *
 * SEGURIDAD: el videoId viene de la URL → se valida que NO contenga separadores de
 * ruta ni "..", y se normaliza con path.basename para cerrar el path traversal.
 * El borrado es best-effort: si un archivo no existe, se continúa.
 */
async function deleteMatching(dir: string, videoId: string): Promise<string[]> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  // Coinciden el raw exacto ({videoId}.ext) y todo derivado cuyo nombre arranca con
  // el videoId (clips {videoId}_c##…, clean {videoId}_clean…, renders, etc.).
  const matches = files.filter((f) => {
    const base = path.basename(f, path.extname(f));
    return base === videoId || f.startsWith(`${videoId}_`) || f.startsWith(`${videoId}.`);
  });
  const deleted: string[] = [];
  for (const f of matches) {
    try {
      await fs.rm(path.join(dir, f), { force: true });
      deleted.push(f);
    } catch {
      /* best-effort: si no se puede borrar uno, seguimos con los demás */
    }
  }
  return deleted;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId: rawVideoId } = await params;

  // Rechazo de path traversal: nada de separadores ni "..".
  if (
    !rawVideoId ||
    rawVideoId.includes("/") ||
    rawVideoId.includes("\\") ||
    rawVideoId.includes("..")
  ) {
    return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
  }
  // Normalización extra: nos quedamos solo con el nombre base.
  const videoId = path.basename(rawVideoId);
  if (!videoId || videoId === "." || videoId === "..") {
    return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
  }

  // SOLO raw + clean (intermedio de proceso). Clips/renders/metadata se conservan.
  const dirs = [LF_RAW, LF_CLEAN];
  const deleted: string[] = [];
  for (const dir of dirs) {
    deleted.push(...(await deleteMatching(dir, videoId)));
  }

  return NextResponse.json(
    { ok: true, deleted },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
