import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PROJECTS_DIR, PYTHON_EXE, PYTHON_DIR } from "@/lib/paths";

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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectPath = path.join(PROJECTS_DIR, `${id}.json`);

  let project: { videoId?: string };
  try {
    project = JSON.parse(await fs.readFile(projectPath, "utf-8"));
  } catch {
    return NextResponse.json({ error: "proyecto no encontrado" }, { status: 404 });
  }

  const videoId = project.videoId ?? id;

  // Provider y model opcionales desde query params
  const provider = _req.nextUrl.searchParams.get("provider") ?? "auto";
  const model = _req.nextUrl.searchParams.get("model");

  const args = [videoId, "--project-id", id, "--provider", provider];
  if (model) args.push("--model", model);

  // Lanzar generate_caption.py
  const result = await runPython("generate_caption.py", args);

  if (!result.ok) {
    return NextResponse.json(
      { error: "generate_caption falló", stderr: result.stderr.slice(-1000) },
      { status: 500 }
    );
  }

  // Parsear última línea JSON del stdout
  const lastLine = result.stdout.trim().split("\n").pop() ?? "";
  let copy: unknown = null;
  try {
    const parsed = JSON.parse(lastLine);
    copy = parsed.copy ?? null;
  } catch {
    // ignore
  }

  // Re-leer el proyecto para devolver el caption actualizado
  let updatedCaption = "";
  let captionMeta: unknown = null;
  try {
    const updated = JSON.parse(await fs.readFile(projectPath, "utf-8")) as {
      caption?: string;
      captionMeta?: unknown;
    };
    updatedCaption = updated.caption ?? "";
    captionMeta = updated.captionMeta ?? null;
  } catch {
    // ignore
  }

  // El `ok` sale de que el proyecto TENGA caption después, no de que el script
  // terminara. Esta ruta al menos re-lee el archivo, pero devolvía `ok: true`
  // fijo sin mirar lo que había leído: si la escritura falló, el usuario veía
  // "listo" y el caption seguía siendo el anterior.
  if (!updatedCaption) {
    return NextResponse.json(
      {
        error:
          "el caption se generó pero el proyecto quedó sin él: la escritura no llegó a disco",
        copy: copy ?? captionMeta,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, caption: updatedCaption, copy: copy ?? captionMeta });
}
