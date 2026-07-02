import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LF_ROOT, PYTHON_EXE, PYTHON_DIR } from "@/lib/paths";
import { runProcess } from "@/lib/run-process";

// Hooks A/B: 3 variantes de gancho para un clip de largos (los primeros 3s deciden
// el 71% de la retención). Corre python/hook_variants.py — providers OAuth con
// fallback a Ollama local (offline-aware). El usuario elige una y se guarda con el
// flujo de edición de clips existente.
export const dynamic = "force-dynamic";

const LF_TRANSCRIPTS = path.join(LF_ROOT, "transcripts");

interface Body {
  videoId: string;
  /** Ventana del clip en el transcript del video largo. */
  start: number;
  end: number;
  /** Hook actual (para que las variantes no lo repitan). */
  current?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body.videoId || typeof body.start !== "number" || typeof body.end !== "number") {
      return NextResponse.json(
        { error: "videoId, start y end son requeridos" },
        { status: 400 },
      );
    }

    // Texto del clip: palabras del transcript dentro de la ventana [start, end].
    let text = "";
    try {
      const raw = await fs.readFile(
        path.join(LF_TRANSCRIPTS, `${body.videoId}.json`),
        "utf-8",
      );
      const words = (JSON.parse(raw).words ?? []) as { word: string; start: number }[];
      text = words
        .filter((w) => w.start >= body.start - 0.2 && w.start <= body.end + 0.2)
        .map((w) => w.word)
        .join(" ")
        .trim();
    } catch {
      /* sin transcript → error humano abajo */
    }
    if (!text) {
      return NextResponse.json(
        { error: "No encontré la transcripción de este clip. Procesa el video de nuevo." },
        { status: 404 },
      );
    }

    const args = [
      path.join(PYTHON_DIR, "hook_variants.py"),
      "--text", text,
      ...(body.current ? ["--current", body.current] : []),
    ];
    const run = await runProcess(PYTHON_EXE, args, PYTHON_DIR, undefined, 300_000);
    // El script imprime UNA línea JSON al final ({ok, variants|error}).
    const lastJson = run.stdout
      .split(/\r?\n/)
      .reverse()
      .find((l) => l.trim().startsWith("{"));
    const data = lastJson ? (JSON.parse(lastJson) as { ok: boolean; variants?: string[]; provider?: string; error?: string }) : null;
    if (!run.ok || !data?.ok || !data.variants?.length) {
      return NextResponse.json(
        {
          error:
            "No se pudieron generar variantes. Revisa que la IA local (Ollama) esté prendida.",
          detail: data?.error ?? run.stderr.slice(-300),
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ variants: data.variants, provider: data.provider });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
