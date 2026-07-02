import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { PYTHON_EXE, PYTHON_DIR } from "@/lib/paths";
import { runProcess } from "@/lib/run-process";

// SUPERCUT (Mejora B): junta los top momentos YA renderizados de un video largo en
// un solo highlight reel (mismo estilo, loudness -14 LUFS) y lo publica en Mis videos.
// Corre python/supercut.py de forma síncrona (re-encode: ~1-3 min según duración).
export const dynamic = "force-dynamic";

interface Body {
  videoId: string;
  top?: number;
  maxSeconds?: number;
  style?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.videoId) {
      return NextResponse.json({ error: "videoId es requerido" }, { status: 400 });
    }
    const args = [
      path.join(PYTHON_DIR, "supercut.py"),
      body.videoId,
      "--top", String(Math.max(2, Math.min(10, body.top ?? 5))),
      "--max-seconds", String(Math.max(30, Math.min(300, body.maxSeconds ?? 120))),
      ...(body.style ? ["--style", body.style] : []),
    ];
    const run = await runProcess(PYTHON_EXE, args, PYTHON_DIR, undefined, 600_000);
    const lastJson = run.stdout
      .split(/\r?\n/)
      .reverse()
      .find((l) => l.trim().startsWith("{"));
    const data = lastJson
      ? (JSON.parse(lastJson) as {
          ok: boolean;
          error?: string;
          id?: string;
          style?: string;
          clips?: number;
          seconds?: number;
        })
      : null;
    if (!run.ok || !data?.ok) {
      return NextResponse.json(
        { error: data?.error ?? "No se pudo crear el supercut.", detail: run.stderr.slice(-300) },
        { status: 502 },
      );
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
