/**
 * POST /api/long_form/import-path — importa un video YA presente en el disco del usuario
 * (ej. C:\Users\...\Downloads\clase.mp4) sin subirlo por HTTP.
 *
 * Por qué: la app corre localmente y los videos largos pueden pesar GIGAS (un curso de
 * 80 min en HEVC puede ser ~10 GB). Subir eso por multipart/`req.formData()` es inviable
 * (se buffea en memoria y se trunca). Como el archivo ya está en la misma máquina, lo
 * importamos por filesystem: validamos con ffprobe y lo enganchamos en LF_RAW con un
 * hardlink (instantáneo, sin duplicar bytes si está en el mismo volumen) o, si no se
 * puede, con una copia.
 *
 * Body JSON: { path: "C:\\...\\video.mp4" }
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LF_RAW } from "@/lib/paths";
import { validateVideo, UploadError } from "@/lib/save-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 1800; // 30 min — el fallback de copia de un archivo de GIGAS tarda

const VALID_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);

/**
 * Allowlist de raíces desde donde se puede IMPORTAR un video del disco. Sin esto el
 * endpoint aceptaba CUALQUIER ruta del FS (un POST malicioso podía linkear/copiar
 * `C:\Windows\...\algo.mp4` o un archivo de otro usuario al LF_RAW). Limitamos a la
 * carpeta del usuario del SO (home + subcarpetas típicas de descargas/videos) más las
 * unidades de datos donde realmente viven los videos. Las rutas UNC (`\\host\share`) y
 * el prefijo `\\?\` se rechazan de plano: no se pueden anclar a una raíz local.
 */
function allowedRoots(): string[] {
  const home = os.homedir();
  const roots = new Set<string>([
    home,
    // El propio LF_RAW (re-importar algo que ya está dentro del data root no debe romper).
    LF_RAW,
  ]);
  // Subcarpetas habituales del usuario (en Windows existen en inglés aunque el SO esté
  // en español; si alguna no existe, da igual: solo se usa como prefijo).
  for (const sub of ["Downloads", "Desktop", "Documents", "Videos", "Movies", "OneDrive"]) {
    roots.add(path.join(home, sub));
  }
  // Unidades de datos comunes en Windows donde el usuario suele guardar videos. En
  // POSIX no aplica (no hay letras de unidad) y se ignora.
  if (process.platform === "win32") {
    for (const drive of ["C:", "D:", "E:", "F:"]) {
      roots.add(`${drive}\\`);
    }
  }
  // Override opcional: rutas extra separadas por `;` (o `:` en POSIX no, usamos `;`).
  const extra = (process.env.VIRAL_IMPORT_ROOTS ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const e of extra) roots.add(e);
  return [...roots].map((r) => path.resolve(r));
}

/** ¿`child` está DENTRO de `parent` (o es `parent`)? Compara rutas ya resueltas. */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  // Vacío = misma carpeta; sin `..` ni ruta absoluta = está debajo.
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Valida que `srcRaw` apunte a una ruta PERMITIDA. Devuelve la ruta resuelta o un
 * mensaje de error (string) para responder 400. NO toca el FS.
 */
function validateImportPath(srcRaw: string): { ok: true; resolved: string } | { ok: false; error: string } {
  // Rutas UNC y device paths: no se pueden anclar a una raíz local de confianza.
  if (srcRaw.startsWith("\\\\") || srcRaw.startsWith("//")) {
    return { ok: false, error: "Las rutas de red (\\\\servidor\\...) no están permitidas. Copia el archivo a tu carpeta de usuario primero." };
  }
  if (/^\\\\\?\\/.test(srcRaw) || srcRaw.startsWith("\\\\.\\")) {
    return { ok: false, error: "Ruta no permitida." };
  }
  const resolved = path.resolve(srcRaw);
  const roots = allowedRoots();
  if (!roots.some((root) => isInside(resolved, root))) {
    return {
      ok: false,
      error: "Esa ruta está fuera de las carpetas permitidas. Mueve el video a tu carpeta de usuario (Descargas, Escritorio, Documentos o Videos) e intenta de nuevo.",
    };
  }
  return { ok: true, resolved };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { path?: string };
    const srcRaw = (body.path ?? "").trim().replace(/^["']|["']$/g, ""); // sacar comillas pegadas
    if (!srcRaw) {
      return NextResponse.json({ error: "Pega la ruta del archivo en tu compu." }, { status: 400 });
    }

    // Allowlist: la ruta debe caer DENTRO de una raíz permitida (home del usuario, sus
    // subcarpetas típicas, unidades de datos comunes). Bloquea UNC/`\\?\` y todo lo demás.
    const check = validateImportPath(srcRaw);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    const srcPath = check.resolved;

    // El archivo tiene que existir y ser un archivo (no carpeta).
    let stat;
    try {
      stat = await fs.stat(srcPath);
    } catch {
      // Solo el nombre del archivo en el mensaje (sin rutas C:\ visibles).
      return NextResponse.json(
        { error: `No encontré el archivo «${path.basename(srcPath)}» en esa ruta. Revisa la ruta (clic derecho → Copiar como ruta de acceso).` },
        { status: 404 }
      );
    }
    if (!stat.isFile()) {
      return NextResponse.json({ error: "La ruta no es un archivo." }, { status: 400 });
    }

    const ext = path.extname(srcPath).toLowerCase();
    if (!VALID_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `extensión no soportada (${ext}). Permitidas: ${[...VALID_EXTS].join(", ")}` },
        { status: 400 }
      );
    }

    // Validar el ORIGINAL con ffprobe antes de copiar (no copiar 10 GB de basura).
    await validateVideo(srcPath);

    await fs.mkdir(LF_RAW, { recursive: true });

    // Nombre destino sin colisión.
    const baseName = path.basename(srcPath).replace(/[^a-zA-Z0-9._\- ]/g, "_");
    let destPath = path.join(LF_RAW, baseName);
    let counter = 1;
    while (
      await fs.access(destPath).then(() => true).catch(() => false)
    ) {
      const b = path.basename(baseName, ext);
      destPath = path.join(LF_RAW, `${b}_${counter}${ext}`);
      counter++;
      if (counter > 200) throw new Error("demasiadas colisiones de nombre");
    }

    // Hardlink (instantáneo, mismo volumen). Si falla (otro disco, EXDEV), copiar.
    let method = "hardlink";
    try {
      await fs.link(srcPath, destPath);
    } catch {
      method = "copia";
      await fs.copyFile(srcPath, destPath);
    }

    return NextResponse.json({
      ok: true,
      filename: path.basename(destPath),
      sizeBytes: stat.size,
      path: destPath,
      method,
    });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[long_form/import-path] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
