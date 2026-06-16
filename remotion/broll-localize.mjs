// Descarga el b-roll REMOTO a disco local antes de renderizar.
//
// Por qué: si los clips de b-roll se le pasan a Remotion como URL remota (p.ej.
// https://videos.pexels.com/...), `<OffthreadVideo>` hace peticiones HTTP por RANGO
// a internet en CADA frame para seekear/decodificar → la CPU queda OCIOSA esperando
// la red y un video de 1 min tarda media hora. Bajando el clip UNA vez a disco local
// (y re-codificándolo con keyframes densos), el seek pasa a ser de milisegundos y el
// render vuela. Es la diferencia entre "no viable" y rápido.
//
// Cache: se guarda en {DATA_ROOT}/assets/broll/<sha>.mp4 (sha del url de origen). Si
// ya existe y es usable, se reusa sin re-descargar. Best-effort: si algo falla para un
// clip, se deja su URL remota original (render lento pero NO se rompe).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, readdirSync, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Resuelve el ffmpeg empaquetado igual que lib/paths.ts (carpeta tools/ffmpeg-.../bin).
function detectFfmpeg(dataRoot) {
  const override = process.env.VIRAL_FFMPEG_EXE;
  if (override && existsSync(override)) return override;
  // dataRoot = ...\hermes-data\videos  →  tools está en ...\hermes-data\tools
  const toolsDir = path.join(path.dirname(dataRoot), "tools");
  try {
    const folder = readdirSync(toolsDir).find((e) => e.startsWith("ffmpeg-"));
    if (folder) {
      const cand = path.join(toolsDir, folder, "bin", "ffmpeg.exe");
      if (existsSync(cand)) return cand;
    }
  } catch {
    // sin tools/
  }
  return "ffmpeg"; // confiar en PATH
}

function isUsable(file) {
  try {
    return statSync(file).size > 50 * 1024; // > 50KB = descarga real, no un error
  } catch {
    return false;
  }
}

/** Descarga `url` a `dest` (stream, sin cargar todo en memoria). */
async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} al bajar ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/**
 * Re-codifica `src` → `dst` con keyframes densos (GOP corto) para que OffthreadVideo
 * seekee instantáneo. Mantiene la resolución original (ya viene <=1920) para no
 * distorsionar; sólo normaliza GOP/fps y quita el audio (el b-roll va mudo).
 * Resuelve `true` si ffmpeg sale 0, `false` si falla (el caller usa el src crudo).
 */
function normalize(ffmpeg, src, dst) {
  return new Promise((resolve) => {
    const args = [
      "-y", "-i", src,
      "-an",                              // b-roll mudo
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", // keyframe cada ~1s
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      dst,
    ];
    const p = spawn(ffmpeg, args, { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0 && isUsable(dst)));
  });
}

/**
 * Localiza un array de clips [{start,end,url,...}]. Devuelve un array nuevo con los
 * `url` remotos reescritos a `${host}/api/assets/broll/stream?file=<sha>.mp4`.
 * Los urls ya locales/relativos se dejan intactos.
 */
export async function localizeBrollClips(clips, { dataRoot, host }) {
  if (!Array.isArray(clips) || clips.length === 0) return clips;
  const brollDir = path.join(dataRoot, "assets", "broll");
  mkdirSync(brollDir, { recursive: true });
  const ffmpeg = detectFfmpeg(dataRoot);

  const out = [];
  for (const c of clips) {
    const url = c?.url;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      out.push(c);
      continue;
    }
    try {
      const sha = createHash("sha1").update(url).digest("hex").slice(0, 16);
      const target = path.join(brollDir, `${sha}.mp4`);
      if (!isUsable(target)) {
        // Temporales ÚNICOS por proceso (pid + random) para evitar TOCTOU: largos
        // renderiza en paralelo con el MISMO brollDir, y el wizard/editor pueden
        // localizar el mismo url a la vez. El `target` final sólo aparece vía un
        // rename atómico de un archivo ya 100% escrito, así un lector concurrente
        // ve el .mp4 completo o no lo ve (y usa la URL remota), nunca a medio escribir.
        const tag = `${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
        const raw = path.join(brollDir, `${sha}.${tag}.src`);
        const part = path.join(brollDir, `${sha}.${tag}.part.mp4`);
        try {
          await download(url, raw);
          const ok = await normalize(ffmpeg, raw, part);
          // ffmpeg no disponible o falló → usar el archivo crudo descargado igual.
          const finalSrc = ok ? part : raw;
          if (!isUsable(target)) {
            await rename(finalSrc, target).catch(() => {
              // EEXIST/EPERM en Windows si otro proceso ya colocó el target: ok si quedó usable.
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
        out.push(c); // no se pudo localizar → URL remota original
      }
    } catch {
      out.push(c); // best-effort: nunca romper el render por el b-roll
    }
  }
  return out;
}
