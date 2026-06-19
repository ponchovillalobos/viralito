import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runPython } from "@/lib/run-python";
import { RAW_DIR, CUTS_DIR } from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { videoId?: string; minMs?: number };
  const videoId = body.videoId;
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }
  if (!isSafeId(videoId)) {
    return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
  }

  const files = await fs.readdir(RAW_DIR);
  const match = files.find((f) => path.basename(f, path.extname(f)) === videoId);
  if (!match) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const args = [path.join(RAW_DIR, match)];
  if (body.minMs) args.push("--min-ms", String(body.minMs));

  const result = await runPython("detect_silences.py", args);
  if (!result.ok) {
    return NextResponse.json(
      { error: "detect_silences failed", stderr: result.stderr.slice(-2000) },
      { status: 500 }
    );
  }

  const outPath = path.join(CUTS_DIR, `${videoId}.json`);
  const data = JSON.parse(await fs.readFile(outPath, "utf-8"));
  return NextResponse.json({ ok: true, videoId, cuts: data });
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
  if (!isSafeId(videoId)) {
    return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
  }
  const outPath = path.join(CUTS_DIR, `${videoId}.json`);
  try {
    const data = JSON.parse(await fs.readFile(outPath, "utf-8"));
    return NextResponse.json({ ok: true, videoId, cuts: data });
  } catch {
    return NextResponse.json({ error: "cuts not found" }, { status: 404 });
  }
}
