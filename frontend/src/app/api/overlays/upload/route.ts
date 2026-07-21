/**
 * POST /api/overlays/upload — multipart upload de imagen para superponer al video.
 *
 * Body multipart fields:
 *   - videoId: string (a qué video se ata)
 *   - file: el binario
 *   - description?: string (opcional, para guiar al matching IA)
 *
 * Storage: {OVERLAYS_DIR}/{videoId}/{overlayId}.{ext}
 *
 * Validaciones:
 *   - Extensión .jpg/.jpeg/.png/.webp
 *   - Tamaño máximo 5 MB (las imágenes para overlay no deberían ser más grandes)
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { OVERLAYS_DIR } from "@/lib/paths";
import { createOverlay } from "@/lib/overlays-store";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
const VALID_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VALID_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const videoId = formData.get("videoId");
    const file = formData.get("file");
    const description = formData.get("description");

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json({ error: "videoId requerido" }, { status: 400 });
    }
    // El videoId se usa como NOMBRE DE CARPETA en path.join más abajo, y después se
    // hace mkdir + se escribe el binario. Sin este guard, un videoId con `..` era una
    // primitiva de ESCRITURA ARBITRARIA en el disco del usuario (crear carpetas y
    // dejar una imagen en cualquier lado, ej. la carpeta de Inicio de Windows).
    if (!isSafeId(videoId)) {
      return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
    }
    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json({ error: "file (imagen) requerido" }, { status: 400 });
    }

    const blob = file as File;
    const filename = blob.name || "image";
    const ext = path.extname(filename).toLowerCase();
    if (!VALID_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `extensión no soportada (${ext}). Permitidas: jpg, png, webp` },
        { status: 400 }
      );
    }
    if (blob.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `archivo muy grande (${blob.size} bytes, max ${MAX_BYTES})` },
        { status: 400 }
      );
    }
    if (!VALID_MIMES.has(blob.type)) {
      // MIME no es definitivo (algunos browsers no lo setean), pero log
      console.warn(`[overlays/upload] MIME no esperado: ${blob.type} (file=${filename})`);
    }

    // Persistir binario
    const dir = path.join(OVERLAYS_DIR, videoId);
    await fs.mkdir(dir, { recursive: true });

    // Crear entry primero para usar su id como filename
    const entry = await createOverlay({
      videoId,
      filename,
      imagePath: "", // se rellena abajo
      mimeType: blob.type || "image/png",
      sizeBytes: blob.size,
      description: typeof description === "string" ? description : undefined,
      // defaults razonables que la UI puede sobrescribir o auto-match recalcular
      effect: "memory_flash",
      motion: "ken_burns_in",
      transitionIn: "fade",
      transitionOut: "fade",
      position: "center",
      sizeRatio: 0.65,
    });

    const finalPath = path.join(dir, `${entry.id}${ext}`);
    const buffer = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(finalPath, buffer);

    // Actualizar el path en el store
    const { updateOverlay } = await import("@/lib/overlays-store");
    const updated = await updateOverlay(entry.id, { imagePath: finalPath });

    return NextResponse.json({ ok: true, overlay: updated ?? entry });
  } catch (err) {
    console.error("[overlays/upload] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
