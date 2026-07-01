import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { findThumbnail, saveThumbnail, deleteThumbnail } from "@/lib/thumbnails";

// Miniatura custom por video. POST sube la imagen, GET la sirve (para preview), DELETE la borra.
// Aditivo: si no hay miniatura, la publicación usa el default de la red.
export const dynamic = "force-dynamic";

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const p = await findThumbnail(id);
  if (!p) return NextResponse.json({ hasThumbnail: false }, { status: 404 });
  const buf = await fs.readFile(p);
  const ext = p.split(".").pop()?.toLowerCase() ?? "jpg";
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": CONTENT_TYPE[ext] ?? "image/jpeg", "Cache-Control": "no-store" },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo de imagen (campo 'file')." }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "La imagen supera 10 MB." }, { status: 400 });
    }
    const name = file.name || "";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "jpg";
    const buf = Buffer.from(await file.arrayBuffer());
    const saved = await saveThumbnail(id, buf, ext);
    return NextResponse.json({ ok: true, path: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteThumbnail(id);
  return NextResponse.json({ ok: true });
}
