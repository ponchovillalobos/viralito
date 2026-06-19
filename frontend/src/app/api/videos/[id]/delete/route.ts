import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RAW_DIR } from "@/lib/paths";
import { sweepShortOrphans } from "@/lib/orphan-sweep";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";

const USED_DIR = path.join(RAW_DIR, "used");

/**
 * BORRADO DEFINITIVO de un video subido. Elimina del disco el archivo raw
 * ({id}.mp4/.mov/…) y su variante _cut, tanto en RAW_DIR como en used/. Después
 * dispara el barrido de huérfanos para limpiar sus derivados (proyectos, renders,
 * transcripts, cuts) — así el video desaparece de TODAS las pantallas del portal.
 *
 * Es irreversible (a diferencia de "archivar", que solo mueve a used/). El botón en
 * la UI pide confirmación antes de llamar aquí.
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

  // Limpiar derivados (proyectos/renders/transcripts/cuts) del video ya borrado.
  let sweptCount = 0;
  try {
    sweptCount = (await sweepShortOrphans()).deleted;
  } catch {
    /* el video ya se borró; el barrido es best-effort */
  }

  return NextResponse.json(
    { ok: true, deleted, derivedDeleted: sweptCount },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
