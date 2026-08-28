/**
 * POST /api/videos/descargar-url — trae un video de YouTube y lo deja listo para editar.
 *
 * Body: { url, flujo: "corto" | "largo", id? }
 * Acción: corre `python/descargar_de_url.py`, que lo deja en `raw/` o en
 * `long_form/raw/` con la convención `D##_slug`, y devuelve el id + la duración
 * MEDIDA del archivo (no la que dice la metadata del sitio).
 *
 * Gemelo por URL de `/api/videos/import` (subida) e `import-path` (ruta local).
 * Las tres dejan el archivo en el mismo sitio, así que desde ahí el pipeline es
 * exactamente el mismo — no hay un "camino de YouTube" aparte que pueda
 * comportarse distinto.
 */
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { PYTHON_DIR, PYTHON_EXE } from "@/lib/paths";
import { runProcess, parseLastJsonLine } from "@/lib/run-process";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";
// Un curso de una hora en 1080p tarda: el tope es generoso a propósito.
export const maxDuration = 1800;

interface Salida {
  ok: boolean;
  id?: string;
  ruta?: string;
  duracion_s?: number;
  flujo?: string;
  sugerencia?: string;
  ya_estaba?: boolean;
  error?: string;
  pista?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: unknown; flujo?: unknown; id?: unknown };

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json({ error: "falta la URL" }, { status: 400 });
    }
    // Sólo http(s). Sin esto, una URL como `file:///…` o un `--flag` disfrazado
    // llegaría a la línea de comandos de yt-dlp.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "la URL no es válida" }, { status: 400 });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return NextResponse.json(
        { error: "sólo se aceptan enlaces http/https" },
        { status: 400 }
      );
    }

    const flujo = body.flujo === "largo" ? "largo" : body.flujo === "corto" ? "corto" : null;
    if (!flujo) {
      return NextResponse.json(
        { error: 'flujo tiene que ser "corto" o "largo"' },
        { status: 400 }
      );
    }

    const args = [path.join(PYTHON_DIR, "descargar_de_url.py"), url, "--flujo", flujo];

    // El id se vuelve nombre de archivo: pasa por el mismo guard anti-traversal
    // que el resto de las rutas.
    if (typeof body.id === "string" && body.id.trim()) {
      const id = body.id.trim();
      if (!isSafeId(id)) {
        return NextResponse.json({ error: "id inválido" }, { status: 400 });
      }
      args.push("--id", id);
    }

    const run = await runProcess(PYTHON_EXE, args, PYTHON_DIR, undefined, 1_800_000);
    const datos = parseLastJsonLine<Salida>(run.stdout || "");

    if (!datos) {
      return NextResponse.json(
        {
          error: "el descargador no devolvió resultado",
          detalle: (run.stderr || "").slice(-400),
        },
        { status: 500 }
      );
    }
    if (!datos.ok) {
      // `pista` viene del script y dice qué hacer (p. ej. guardar cookies si el
      // video pide inicio de sesión). Se pasa tal cual: es el mensaje útil.
      return NextResponse.json(
        { error: datos.error ?? "no se pudo bajar", pista: datos.pista },
        { status: 502 }
      );
    }

    return NextResponse.json(datos);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "error al bajar el video" },
      { status: 500 }
    );
  }
}
