import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RAW_DIR } from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";

const USED_DIR = path.join(RAW_DIR, "used");

/**
 * BORRADO de un video subido: elimina del disco SOLO el archivo raw
 * ({id}.mp4/.mov/…) y su intermedio _cut, en RAW_DIR y used/.
 *
 * ⚠️ INVARIANTE (incidente 2026-07-03): borrar el video original NO toca sus
 * renders/proyectos — los videos YA GENERADOS son el producto del usuario y se
 * conservan en "Mis videos" aunque el original se borre. Antes esta ruta disparaba
 * el barrido de huérfanos que destruía renders terminados. Solo el usuario borra
 * sus videos generados, uno a uno, desde Mis videos.
 */
async function deleteMatching(dir: string, videoId: string): Promise<string[]> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const matches = files.filter((f) => {
    const base = path.basename(f, path.extname(f));
    return base === videoId || base === `${videoId}_cut`;
  });
  const deleted: string[] = [];
  for (const f of matches) {
    try {
      await fs.rm(path.join(dir, f), { force: true });
      deleted.push(f);
    } catch {
      /* best-effort */
    }
  }
  return deleted;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isSafeId(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const deleted = [
    ...(await deleteMatching(RAW_DIR, id)),
    ...(await deleteMatching(USED_DIR, id)),
  ];

  if (deleted.length === 0) {
    return NextResponse.json({ error: "video no encontrado", id }, { status: 404 });
  }

  // Los derivados (proyectos/renders) NO se tocan — ver invariante arriba.
  return NextResponse.json(
    { ok: true, deleted, derivedDeleted: 0 },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
