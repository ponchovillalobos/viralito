import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  CUTS_DIR,
  DATA_ROOT,
  PROJECTS_DIR,
  RAW_DIR,
  RENDERS_DIR,
  TRANSCRIPTS_DIR,
} from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";

const THUMB_DIR = path.join(DATA_ROOT, "assets", "thumbnails");

const SLUG_RE = /^[a-zA-Z0-9_\-]+$/;

async function moveIfExists(src: string, dst: string): Promise<boolean> {
  try {
    await fs.access(src);
    await fs.rename(src, dst);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isSafeId(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const body = (await req.json()) as { newId?: string };
  const newId = (body.newId ?? "").trim();

  if (!newId) {
    return NextResponse.json({ error: "newId requerido" }, { status: 400 });
  }
  if (!SLUG_RE.test(newId)) {
    return NextResponse.json(
      { error: "Sólo letras, números, guiones y guiones bajos. Sin espacios ni acentos." },
      { status: 400 }
    );
  }
  if (newId === id) {
    return NextResponse.json({ ok: true, id: newId, unchanged: true });
  }

  const files = await fs.readdir(RAW_DIR);
  const match = files.find((f) => path.basename(f, path.extname(f)) === id);
  if (!match) {
    return NextResponse.json({ error: "video no encontrado en raw/" }, { status: 404 });
  }

  const collision = files.find(
    (f) => path.basename(f, path.extname(f)) === newId
  );
  if (collision) {
    return NextResponse.json(
      { error: `Ya existe un video llamado "${newId}"` },
      { status: 409 }
    );
  }

  const ext = path.extname(match);
  const renamed: Record<string, boolean> = {};

  renamed.raw = await moveIfExists(
    path.join(RAW_DIR, match),
    path.join(RAW_DIR, `${newId}${ext}`)
  );
  renamed.transcript = await moveIfExists(
    path.join(TRANSCRIPTS_DIR, `${id}.json`),
    path.join(TRANSCRIPTS_DIR, `${newId}.json`)
  );
  renamed.cuts = await moveIfExists(
    path.join(CUTS_DIR, `${id}.json`),
    path.join(CUTS_DIR, `${newId}.json`)
  );
  renamed.render = await moveIfExists(
    path.join(RENDERS_DIR, `${id}.mp4`),
    path.join(RENDERS_DIR, `${newId}.mp4`)
  );
  renamed.thumbnail = await moveIfExists(
    path.join(THUMB_DIR, `${id}.jpg`),
    path.join(THUMB_DIR, `${newId}.jpg`)
  );

  try {
    const projPath = path.join(PROJECTS_DIR, `${id}.json`);
    const raw = await fs.readFile(projPath, "utf-8");
    const data = JSON.parse(raw);
    data.id = newId;
    data.videoId = newId;
    data.updatedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(PROJECTS_DIR, `${newId}.json`),
      JSON.stringify(data, null, 2),
      "utf-8"
    );
    await fs.unlink(projPath);
    renamed.project = true;
  } catch {
    renamed.project = false;
  }

  return NextResponse.json({ ok: true, oldId: id, newId, renamed });
}
