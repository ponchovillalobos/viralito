import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OffthreadVideo cache (PARTE B): ~35% de la RAM para que b-roll/mirror/clone NO
// disparen "cache pruned" (Remotion descarta frames y re-decodea, lento). Tope
// razonable de 6 GB para no comerse toda la memoria en equipos grandes.
// OJO: el flag exacto es --offthreadvideo-cache-size-in-bytes (sin guion en "offthreadvideo").
function offthreadCacheBytes() {
  const thirtyFive = Math.floor(os.totalmem() * 0.35);
  return Math.max(512 * 1024 * 1024, Math.min(thirtyFive, 6 * 1024 * 1024 * 1024));
}
const OFFTHREAD_CACHE_FLAG = `--offthreadvideo-cache-size-in-bytes=${offthreadCacheBytes()}`;

const JOBS = [
  { videoId: "D02_3_errores_ventas", project: "D02_3_errores_ventas_hype" },
  { videoId: "D02_3_errores_ventas", project: "D02_3_errores_ventas_punch" },
  { videoId: "D03_postura_segura", project: "D03_postura_segura_hype" },
  { videoId: "D03_postura_segura", project: "D03_postura_segura_punch" },
  { videoId: "D04_mentalidad_negativa", project: "D04_mentalidad_negativa_hype" },
  { videoId: "D04_mentalidad_negativa", project: "D04_mentalidad_negativa_punch" },
];

import { existsSync as _existsSync } from "node:fs";
function pickDataRoot() {
  const o = process.env.VIRAL_DATA_ROOT;
  if (o) return o;
  for (const c of ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"]) {
    if (_existsSync(c)) return c;
  }
  return "C:\\viral-data\\videos";
}
const DATA_ROOT = pickDataRoot();
const PROJECTS_DIR = path.join(DATA_ROOT, "projects");
const RENDERS_DIR = path.join(DATA_ROOT, "renders");

// Codec de salida según el perfil de hardware (H3). hw_profile.json lo escribe
// Python; acá lo leemos para elegir el --codec de Remotion. NOTA: Remotion no
// expone NVENC/QSV/AMF (su renderer encodea en CPU), así que esto siempre resuelve
// a "h264"; el encoder de hardware real solo se reporta en el log. El re-encode por
// hardware (NVENC/QSV/AMF) lo hace después python/postencode.py sobre el .mp4 final.
import { readFileSync } from "node:fs";
function pickRemotionCodec() {
  try {
    const p = path.join(DATA_ROOT, "cache", "hw_profile.json");
    if (!existsSync(p)) return { codec: "h264", hw: "libx264" };
    const prof = JSON.parse(readFileSync(p, "utf-8"));
    const hw = String(prof?.recommend?.video_encoder ?? "libx264");
    return { codec: "h264", hw };
  } catch {
    return { codec: "h264", hw: "libx264" };
  }
}
const { codec: REMOTION_CODEC, hw: HW_ENCODER } = pickRemotionCodec();
console.log(
  `[encoder] recommend=${HW_ENCODER} → remotion --codec=${REMOTION_CODEC}` +
    (HW_ENCODER === "libx264" ? " (CPU x264)" : " (Remotion encodea en CPU; NVENC no expuesto)")
);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: __dirname, shell: process.platform === "win32", ...opts });
    proc.stdout.on("data", (d) => process.stdout.write(d.toString()));
    proc.stderr.on("data", (d) => process.stderr.write(d.toString()));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    proc.on("error", reject);
  });
}

async function main() {
  const summary = [];
  for (const job of JOBS) {
    const projectPath = path.join(PROJECTS_DIR, `${job.project}.json`);
    if (!existsSync(projectPath)) {
      console.log(`[skip] no existe ${projectPath}`);
      continue;
    }
    const outPath = path.join(RENDERS_DIR, `${job.project}.mp4`);
    console.log(`\n========== ${job.project} ==========`);
    const t0 = Date.now();
    try {
      await run("node", ["build-props.mjs", job.videoId, projectPath]);
      await run("npx.cmd", [
        "remotion",
        "render",
        "src/index.ts",
        "ViralVideo",
        outPath,
        "--props=props.json",
        `--codec=${REMOTION_CODEC}`,
        OFFTHREAD_CACHE_FLAG,
      ]);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      summary.push({ project: job.project, status: "ok", elapsed, out: outPath });
      console.log(`[ok] ${job.project} en ${elapsed}s`);
    } catch (err) {
      summary.push({ project: job.project, status: "fail", error: String(err) });
      console.log(`[fail] ${job.project}: ${err}`);
    }
  }
  console.log("\n========== SUMMARY ==========");
  for (const s of summary) console.log(JSON.stringify(s));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
