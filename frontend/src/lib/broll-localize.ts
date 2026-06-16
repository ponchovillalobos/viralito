/**
 * Descarga el b-roll REMOTO a disco local antes de renderizar (versión TS para las
 * rutas de render que arman props en el server, p.ej. el editor manual).
 *
 * Mismo motivo que remotion/broll-localize.mjs: si a Remotion <OffthreadVideo> se le
 * pasan URLs de internet (Pexels/CC0), seekea por HTTP en CADA frame → CPU ociosa y
 * un video de 1 min tarda ~30 min. Bajándolo una vez a {BROLL_DIR}/<sha>.mp4 (cacheado
 * + keyframes densos) el seek es de milisegundos. Best-effort: si algo falla para un
 * clip, se deja su URL remota (lento pero no rompe el render).
 *
 * El cache lo COMPARTE con el builder .mjs (mismo dir + mismo sha del url), así que un
 * clip ya bajado por el wizard no se vuelve a bajar en el editor y viceversa.
 */
import { createHash } from "node:crypto";
import { statSync, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BROLL_DIR, FFMPEG_EXE } from "@/lib/paths";

export interface LocalizableClip {
  url?: string;
  [k: string]: unknown;
}

function isUsable(file: string): boolean {
  try {
    return statSync(file).size > 50 * 1024;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} al bajar ${url}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
}

/** Re-codifica con keyframes densos (GOP corto) para seek instantáneo. Mantiene la
 *  resolución original; quita audio (el b-roll va mudo). true si ffmpeg sale 0. */
function normalize(src: string, dst: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      "-y", "-i", src,
      "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      dst,
    ];
    const p = spawn(FFMPEG_EXE, args, { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0 && isUsable(dst)));
  });
}

/**
 * Localiza los clips remotos de un array `bRoll`. Devuelve un array NUEVO con las URLs
 * remotas reescritas a `${host}/api/assets/broll/stream?file=<sha>.mp4`. Las URLs ya
 * locales/relativas se dejan intactas. Nunca lanza: ante un fallo deja la URL original.
 */
export async function localizeBrollClips<T extends LocalizableClip>(
  clips: T[] | undefined,
  opts: { host?: string } = {}
): Promise<T[] | undefined> {
  if (!Array.isArray(clips) || clips.length === 0) return clips;
  const host = opts.host ?? process.env.VIRAL_API_HOST ?? "http://localhost:3000";
  await mkdir(BROLL_DIR, { recursive: true });

  const out: T[] = [];
  for (const c of clips) {
    const url = c?.url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      out.push(c);
      continue;
    }
    try {
      const sha = createHash("sha1").update(url).digest("hex").slice(0, 16);
      const target = path.join(BROLL_DIR, `${sha}.mp4`);
      if (!isUsable(target)) {
        // Temporales ÚNICOS por proceso (pid + random) para evitar TOCTOU: el cache se
        // comparte con el builder .mjs y con renders paralelos. El `target` final sólo
        // aparece vía rename atómico de un archivo ya completo → un lector concurrente
        // lo ve entero o no lo ve (usa la URL remota), nunca a medio escribir.
        const tag = `${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
        const raw = path.join(BROLL_DIR, `${sha}.${tag}.src`);
        const part = path.join(BROLL_DIR, `${sha}.${tag}.part.mp4`);
        try {
          await download(url, raw);
          const ok = await normalize(raw, part);
          const finalSrc = ok ? part : raw;
          if (!isUsable(target)) {
            await rename(finalSrc, target).catch(() => {
              // otro proceso ya colocó el target: ok si quedó usable.
            });
          }
        } finally {
          await rm(raw, { force: true }).catch(() => {});
          await rm(part, { force: true }).catch(() => {});
        }
      }
      if (isUsable(target)) {
        out.push({ ...c, url: `${host}/api/assets/broll/stream?file=${sha}.mp4` });
      } else {
        out.push(c);
      }
    } catch {
      out.push(c);
    }
  }
  return out;
}
