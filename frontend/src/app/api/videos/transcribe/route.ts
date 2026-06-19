import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runPythonJson } from "@/lib/run-python";
import { humanizeError } from "@/lib/humanize-error";
import { withSerialLock } from "@/lib/serial-lock";
import { RAW_DIR, TRANSCRIPTS_DIR } from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { videoId?: string };
  const videoId = body.videoId;
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }
  if (!isSafeId(videoId)) {
    return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
  }

  const files = await fs.readdir(RAW_DIR);
  const match = files.find(
    (f) => path.basename(f, path.extname(f)) === videoId
  );
  if (!match) {
    return NextResponse.json({ error: "video not found in raw/" }, { status: 404 });
  }

  const videoPath = path.join(RAW_DIR, match);
  // SIN timeout total: la primera vez puede descargar el modelo (~1.5 GB) y un
  // video largo en CPU tarda. El idle-timeout de 8 min detecta cuelgues REALES
  // (descarga y transcripción vivas emiten progreso) sin matar trabajo legítimo.
  //
  // Candado serial: varias transcripciones a la vez saturan CPU/GPU (y en GPU
  // agotan la VRAM y se traba). Con el lock, los uploads en paralelo se encolan y
  // se transcriben uno por uno. No cambia el resultado, solo el orden.
  const result = await withSerialLock("transcribe", () =>
    runPythonJson("transcribe.py", [videoPath], {
      idleTimeoutMs: 8 * 60 * 1000,
    })
  );

  if (!result.ok) {
    const human = humanizeError(result.stderr, "No se pudo transcribir el video.");
    return NextResponse.json(
      { error: human.message, technical: human.technical },
      { status: 500 }
    );
  }

  const outPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  let transcript: unknown = null;
  try {
    transcript = JSON.parse(await fs.readFile(outPath, "utf-8"));
  } catch {
    return NextResponse.json({ error: "transcript file not written" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, videoId, transcript });
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }
  if (!isSafeId(videoId)) {
    return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
  }
  const outPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  try {
    const data = JSON.parse(await fs.readFile(outPath, "utf-8"));
    return NextResponse.json({ ok: true, videoId, transcript: data });
  } catch {
    return NextResponse.json({ error: "transcript not found" }, { status: 404 });
  }
}
