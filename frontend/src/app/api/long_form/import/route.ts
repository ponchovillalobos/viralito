/**
 * POST /api/long_form/import — multipart upload de un video largo desde la compu del usuario.
 *
 * Body: FormData con `file` (MP4/MOV/MKV/WEBM/M4V)
 * Acción: escribe + VALIDA el binario (ffprobe) y, si pasa, lo deja en LF_RAW.
 *
 * Gemelo de /api/videos/import pero apuntando a la carpeta de largos (LF_RAW).
 * La escritura + validación viven en lib/save-upload (rechaza uploads truncados/corruptos).
 */
import { NextRequest, NextResponse } from "next/server";
import { LF_RAW } from "@/lib/paths";
import { saveUploadedVideo, saveStreamedVideo, UploadError } from "@/lib/save-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 min para videos largos (pueden ser grandes)

// Sin límite práctico para cursos/charlas largas (un curso de 1-2h en alta calidad pesa
// decenas de GB). El único tope real lo pone la RAM: la subida por HTTP bufferea el
// archivo en memoria, así que para videos enormes conviene «importar por ruta»
// (/api/long_form/import-path, hardlink/copia, sin pasar por HTTP ni RAM).
const MAX_BYTES = 64 * 1024 * 1024 * 1024; // 64 GB

export async function POST(req: NextRequest) {
  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    let saved;
    if (ct.includes("multipart/form-data")) {
      // Camino multipart (compat): el navegador manda FormData, se bufferea en RAM.
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string" || !(file instanceof Blob)) {
        return NextResponse.json({ error: "file requerido" }, { status: 400 });
      }
      saved = await saveUploadedVideo(file as File, LF_RAW, MAX_BYTES);
    } else {
      // Camino STREAMING (archivos grandes): body crudo + nombre en header X-Filename.
      // No se buffea en RAM → un video de varios GB entra por el botón normal sin OOM.
      if (!req.body) {
        return NextResponse.json({ error: "body requerido" }, { status: 400 });
      }
      const rawName = decodeURIComponent(req.headers.get("x-filename") || "video.mp4");
      const declared = Number(req.headers.get("content-length") || "") || null;
      saved = await saveStreamedVideo(req.body, rawName, LF_RAW, declared, MAX_BYTES);
    }
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[long_form/import] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
