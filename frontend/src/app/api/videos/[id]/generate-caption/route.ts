import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PYTHON_EXE, PYTHON_DIR, TRANSCRIPTS_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function runPython(script: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_EXE, [script, ...args], { cwd: PYTHON_DIR, shell: false });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    proc.on("error", () => resolve({ ok: false, stdout, stderr }));
  });
}

/**
 * Genera copy viral (caption + hashtags) para un video sin requerir que exista un proyecto.
 * Útil desde el wizard, antes de renderizar.
 *
 * GET /api/videos/[id]/generate-caption?provider=auto
 *   → { copy: { caption_short, caption_long, hashtags_tiktok, ... } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validar que exista el transcript
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${id}.json`);
  try {
    await fs.access(transcriptPath);
  } catch {
    return NextResponse.json(
      { error: "Falta transcript. Transcribí el video antes de generar caption." },
      { status: 400 }
    );
  }

  const provider = req.nextUrl.searchParams.get("provider") ?? "auto";
  const model = req.nextUrl.searchParams.get("model");

  const args = [id, "--provider", provider];
  if (model) args.push("--model", model);

  const result = await runPython("generate_caption.py", args);

  if (!result.ok) {
    return NextResponse.json(
      { error: "generate_caption falló", stderr: result.stderr.slice(-1000) },
      { status: 500 }
    );
  }

  // El script imprime la última línea como JSON: { ok, copy, escritos, fallidos }
  //
  // Este `ok` se escribía a mano en `true` con tal de que el JSON parseara,
  // ignorando lo que el script dijera. El script puede generar el texto
  // perfectamente y no guardarlo en ningún proyecto — porque no hay ninguno en
  // disco, o porque la escritura falló — y desde la interfaz eso era
  // indistinguible del éxito: decía "listo" y el caption seguía siendo el viejo.
  const lastLine = result.stdout.trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed.ok === false) {
      return NextResponse.json(
        {
          error:
            "el caption se generó pero no se guardó en ningún proyecto",
          fallidos: parsed.fallidos ?? [],
          copy: parsed.copy ?? null,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      copy: parsed.copy ?? null,
      escritos: parsed.escritos ?? [],
    });
  } catch {
    return NextResponse.json(
      { error: "no se pudo parsear el output", stdout: result.stdout.slice(-500) },
      { status: 500 }
    );
  }
}
