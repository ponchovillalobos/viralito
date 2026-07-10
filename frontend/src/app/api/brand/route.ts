/**
 * POST /api/brand — MARCA → style guide (F1.b).
 *
 * Deriva {accent, palette[], themeId, themeName, fontTitle} de una marca para
 * pre-cargar el "brand kit" del wizard en UN paso. Dos entradas:
 *
 *   1. multipart con `file` (logo/screenshot)  → 100% OFFLINE (python/brand_from_source.py --image)
 *   2. JSON  `{ url }`                          → baja og:image/theme-color (degradable sin red)
 *
 * El acento devuelto ya viene SNAPeado a la PALETTE canónica (mono-color +
 * contraste de subtítulos garantizado). El usuario siempre puede sobreescribir.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { runPythonJson } from "@/lib/run-python";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 6 * 1024 * 1024;
const VALID_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);

interface BrandResult {
  accent: string;
  accentRaw?: string;
  palette: string[];
  themeId: string;
  themeName: string;
  fontTitle: string;
  bgLuma: number;
  source: string;
  ok: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  const ctype = req.headers.get("content-type") ?? "";
  try {
    // ── Camino 1: logo/screenshot subido (100% offline) ──────────────────────
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string" || !(file instanceof Blob)) {
        return NextResponse.json({ error: "file (imagen) requerido" }, { status: 400 });
      }
      const blob = file as File;
      const ext = path.extname(blob.name || "logo.png").toLowerCase() || ".png";
      if (!VALID_EXTS.has(ext)) {
        return NextResponse.json({ error: `extensión no soportada (${ext})` }, { status: 400 });
      }
      if (blob.size > MAX_BYTES) {
        return NextResponse.json({ error: `archivo muy grande (max ${MAX_BYTES} bytes)` }, { status: 400 });
      }
      const dir = path.join(DATA_ROOT, "brand-tmp");
      await fs.mkdir(dir, { recursive: true });
      // nombre determinista por tamaño+tiempo evita colisiones sin depender de random.
      const tmp = path.join(dir, `logo_${blob.size}_${Date.now()}${ext}`);
      await fs.writeFile(tmp, Buffer.from(await blob.arrayBuffer()));
      try {
        const { parsed, ok, stderr } = await runPythonJson<BrandResult>(
          "brand_from_source.py",
          ["--image", tmp],
          { timeoutMs: 30_000 }
        );
        if (!parsed) {
          return NextResponse.json({ error: "no se pudo analizar la marca", detail: stderr.slice(-300) }, { status: 502 });
        }
        return NextResponse.json({ ...parsed, ok: parsed.ok && ok });
      } finally {
        // limpiar el temporal SIEMPRE (nunca dejamos basura).
        fs.rm(tmp, { force: true }).catch(() => {});
      }
    }

    // ── Camino 2: URL de la marca (baja og:image/theme-color; degradable) ─────
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const url = (body.url ?? "").trim();
    if (!url) {
      return NextResponse.json({ error: "url requerida (o subí un logo por multipart)" }, { status: 400 });
    }
    const { parsed, stderr } = await runPythonJson<BrandResult>(
      "brand_from_source.py",
      ["--url", url],
      { timeoutMs: 25_000 }
    );
    if (!parsed) {
      return NextResponse.json({ error: "no se pudo leer la marca desde la URL", detail: stderr.slice(-300) }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[api/brand] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
