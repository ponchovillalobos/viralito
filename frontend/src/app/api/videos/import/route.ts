/**
 * POST /api/videos/import — multipart upload de video desde la compu del usuario.
 *
 * Body: FormData con `file` (MP4/MOV/MKV/WEBM/M4V)
 * Acción: escribe + VALIDA el binario (ffprobe) y, si pasa, lo deja en RAW_DIR.
 *
 * La escritura + validación viven en lib/save-upload (rechaza uploads truncados/corruptos
 * antes de que el render falle con un error críptico).
 */
import { NextRequest, NextResponse } from "next/server";
import { RAW_DIR } from "@/lib/paths";
import { saveUploadedVideo, UploadError } from "@/lib/save-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 min para videos grandes

const MAX_BYTES = 16 * 1024 * 1024 * 1024; // 16 GB (antes 2 GB) — sin tope práctico para shorts

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file requerido" }, { status: 400 });
    }

    const saved = await saveUploadedVideo(file as File, RAW_DIR, MAX_BYTES);
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[videos/import] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
