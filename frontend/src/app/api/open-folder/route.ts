import { NextRequest, NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RENDERS_DIR, LF_RENDERS } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * Abre en el explorador de archivos del SO la carpeta donde se guardan los videos
 * renderizados. Default: los de videos largos (long_form/renders), donde caen los
 * clips y los reels de Mejores Momentos. `?which=short` abre la de cortos.
 * Fire-and-forget: si el explorador falla, igual devuelve ok.
 */
export async function POST(req: NextRequest) {
  const which = new URL(req.url).searchParams.get("which");
  const dir = which === "short" ? RENDERS_DIR : LF_RENDERS;
  const resolved = path.resolve(dir);
  // La carpeta existe casi siempre; la creamos por si es un data-root nuevo.
  await fs.mkdir(resolved, { recursive: true }).catch(() => {});
  if (process.platform === "win32") {
    exec(`explorer "${resolved}"`, () => {});
  } else if (process.platform === "darwin") {
    exec(`open "${resolved}"`, () => {});
  } else {
    exec(`xdg-open "${resolved}"`, () => {});
  }
  return NextResponse.json({ ok: true, path: resolved });
}
