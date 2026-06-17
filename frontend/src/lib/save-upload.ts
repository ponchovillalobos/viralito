/**
 * Guarda un video subido (multipart) de forma robusta y lo VALIDA antes de aceptarlo.
 *
 * Por qué: un upload que se corta a mitad (conexión caída, pestaña cerrada, proxy) deja
 * un MP4 truncado — típicamente sin el "moov atom" (que en videos de celular va al final).
 * Antes se guardaba igual y se devolvía ok:true; recién al transcribir, ffmpeg fallaba con
 * un error críptico y el job quedaba colgado. Ahora:
 *   1. Se escribe a un archivo temporal `.part` (streaming, sin bufferear de más).
 *   2. Se chequea el tamaño escrito.
 *   3. Se valida con ffprobe que sea un contenedor demuxable (atoms OK, tiene duración).
 *   4. Solo si pasa, rename atómico al nombre final. Si no, se borra y se tira UploadError.
 *
 * Así el archivo que queda en la carpeta SIEMPRE es válido, y el usuario se entera del
 * problema en la subida (no 5 pasos después en el render).
 */
import { promises as fs, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { FFPROBE_EXE } from "@/lib/paths";

const VALID_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

/** Error “de usuario” (mensaje mostrable) — la ruta lo mapea a 4xx, no a 500. */
export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name);
  return base.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 200);
}

async function uniquePath(dir: string, filename: string, ext: string): Promise<string> {
  let target = path.join(dir, filename);
  let counter = 1;
  // Buscar un nombre libre considerando también el .part en vuelo
  for (;;) {
    const exists = await fs
      .access(target)
      .then(() => true)
      .catch(() => false);
    const partExists = await fs
      .access(`${target}.part`)
      .then(() => true)
      .catch(() => false);
    if (!exists && !partExists) return target;
    const base = path.basename(filename, ext);
    target = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
    if (counter > 200) throw new UploadError("demasiadas colisiones de nombre", 500);
  }
}

/** Corre ffprobe sobre el archivo; lanza UploadError si está corrupto/incompleto. */
export async function validateVideo(filePath: string): Promise<void> {
  const args = [
    "-v", "error",
    "-show_entries", "format=format_name,duration",
    "-show_entries", "stream=codec_type",
    "-of", "json",
    filePath,
  ];
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      const proc = spawn(FFPROBE_EXE, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      // ffprobe colgado no debe dejar la request colgada para siempre.
      const timer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
        resolve({ code: -1, stdout, stderr: stderr + "\n[timeout]" });
      }, 30_000);
      proc.stdout.on("data", (c) => (stdout += c.toString()));
      proc.stderr.on("data", (c) => (stderr += c.toString()));
      proc.on("error", (e) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: String(e) });
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr });
      });
    }
  );

  const lower = result.stderr.toLowerCase();
  // Distinguir "falta ffprobe" (instalación rota) de "video corrupto": antes un
  // ENOENT de spawn culpaba al video del usuario y lo mandaba a re-subir en vano.
  if (lower.includes("enoent") || lower.includes("spawn")) {
    throw new UploadError(
      "La app no encuentra su procesador de video (ffprobe). Abre Configuración → " +
        "Verificar instalación — el video que subiste está bien."
    );
  }
  if (
    result.code !== 0 ||
    lower.includes("moov atom not found") ||
    lower.includes("invalid data")
  ) {
    throw new UploadError(
      "El video subido está incompleto o corrupto (probablemente la subida se cortó). " +
        "Vuelve a subirlo — si pesa mucho, espera a que termine la barra antes de cambiar de pantalla."
    );
  }
  let parsed: { format?: { duration?: string }; streams?: { codec_type?: string }[] } = {};
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new UploadError("El video subido no se pudo leer (contenedor inválido). Vuelve a subirlo.");
  }
  const hasDuration = parsed.format?.duration && parseFloat(parsed.format.duration) > 0;
  const hasVideo = (parsed.streams ?? []).some((s) => s.codec_type === "video");
  if (!hasDuration || !hasVideo) {
    throw new UploadError("El archivo no parece un video válido (sin pista de video o sin duración).");
  }
}

/**
 * Escribe + valida el upload en `destDir`. Devuelve el nombre final y tamaño.
 * Lanza UploadError (mensaje mostrable) ante extensión inválida, tamaño excedido,
 * subida incompleta o archivo corrupto.
 */
export async function saveUploadedVideo(
  blob: File,
  destDir: string,
  maxBytes: number
): Promise<{ filename: string; sizeBytes: number; path: string }> {
  const filename = sanitizeFilename(blob.name || "video.mp4");
  const ext = path.extname(filename).toLowerCase();
  if (!VALID_EXTS.has(ext)) {
    throw new UploadError(
      `extensión no soportada (${ext}). Permitidas: ${[...VALID_EXTS].join(", ")}`,
      400
    );
  }
  if (blob.size > maxBytes) {
    throw new UploadError(
      `archivo muy grande (${(blob.size / 1024 / 1024 / 1024).toFixed(1)} GB, máx. ${(
        maxBytes / 1024 / 1024 / 1024
      ).toFixed(1)} GB)`,
      400
    );
  }

  await fs.mkdir(destDir, { recursive: true });
  const finalPath = await uniquePath(destDir, filename, ext);
  const tmpPath = `${finalPath}.part`;

  try {
    // 1) Escribir al .part. Bufferear el File completo (req.formData() ya lo tiene en
    //    memoria de todos modos) y volcarlo de una — es el método probado; el streaming
    //    con Readable.fromWeb truncaba el archivo en este runtime.
    const buffer = Buffer.from(await blob.arrayBuffer());
    await fs.writeFile(tmpPath, buffer);
    const written = buffer.length;

    // 2) Sanity: lo escrito debe coincidir con el tamaño declarado por el cliente.
    if (blob.size && written !== blob.size) {
      throw new UploadError(
        `subida incompleta (${written} de ${blob.size} bytes). Intenta la subida de nuevo.`
      );
    }

    // 3) Validar que sea un MP4/MOV demuxable (atoms OK, tiene video + duración).
    //    Esto es lo que atrapa un upload que llegó cortado (moov atom ausente).
    await validateVideo(tmpPath);

    // 4) Publicar atómicamente: el nombre final aparece recién aquí, ya validado.
    await fs.rename(tmpPath, finalPath);
    return { filename: path.basename(finalPath), sizeBytes: written, path: finalPath };
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Guarda un upload por STREAMING (sin bufferear en RAM) — para archivos GRANDES (varios GB).
 *
 * El cliente manda el File como body crudo (no multipart) + el nombre en el header
 * `X-Filename`. Acá leemos `req.body` (ReadableStream) y lo volcamos a disco por chunks con
 * `pipeline` (maneja backpressure y espera el final REAL — no trunca). Un Transform cuenta
 * bytes y corta si excede `maxBytes` aunque el Content-Length mienta. Memoria ≈ constante,
 * así que un video de 7-20 GB entra por el botón normal sin reventar el server.
 */
export async function saveStreamedVideo(
  body: ReadableStream<Uint8Array>,
  rawName: string,
  destDir: string,
  declaredSize: number | null,
  maxBytes: number
): Promise<{ filename: string; sizeBytes: number; path: string }> {
  const filename = sanitizeFilename(rawName || "video.mp4");
  const ext = path.extname(filename).toLowerCase();
  if (!VALID_EXTS.has(ext)) {
    throw new UploadError(
      `extensión no soportada (${ext}). Permitidas: ${[...VALID_EXTS].join(", ")}`,
      400
    );
  }
  if (declaredSize != null && declaredSize > maxBytes) {
    throw new UploadError(
      `archivo muy grande (${(declaredSize / 1024 / 1024 / 1024).toFixed(1)} GB, máx. ${(
        maxBytes / 1024 / 1024 / 1024
      ).toFixed(1)} GB)`,
      400
    );
  }

  await fs.mkdir(destDir, { recursive: true });
  const finalPath = await uniquePath(destDir, filename, ext);
  const tmpPath = `${finalPath}.part`;

  let written = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > maxBytes) {
        cb(
          new UploadError(
            `archivo excede el máximo de ${(maxBytes / 1024 / 1024 / 1024).toFixed(1)} GB`,
            400
          )
        );
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    // Readable.fromWeb convierte el ReadableStream web (req.body) a stream de Node.
    // pipeline ESPERA el final completo y propaga errores → sin truncado silencioso.
    const src = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(src, meter, createWriteStream(tmpPath));

    if (written === 0) throw new UploadError("subida vacía (0 bytes). Intenta de nuevo.");
    if (declaredSize != null && declaredSize > 0 && written !== declaredSize) {
      throw new UploadError(
        `subida incompleta (${written} de ${declaredSize} bytes). Intenta la subida de nuevo.`
      );
    }

    // Validar demuxable (atrapa stream cortado: moov atom ausente, etc.).
    await validateVideo(tmpPath);
    await fs.rename(tmpPath, finalPath);
    return { filename: path.basename(finalPath), sizeBytes: written, path: finalPath };
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
