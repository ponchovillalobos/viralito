/**
 * generate-style-previews.mjs — Previews EN MOVIMIENTO pre-generadas, UNA por estilo.
 *
 * Hermano de generate-style-thumbs.mjs (stills): este renderiza ~3 SEGUNDOS reales de
 * cada estilo con el MISMO builder del render real (buildProjectForStyle) y los guarda
 * en frontend/public/style-previews/{id}_{v|h}.mp4 (muted, ~0.25 scale, H264 crf alto).
 * El wizard los reproduce en loop (autoPlay muted) al elegir estilo — "ver el estilo
 * EN MOVIMIENTO antes de renderizar 8 min" — con fallback a los PNG de style-thumbs.
 *
 * DEV-TIME: corre en la máquina de desarrollo, NO en la del cliente. Los MP4 se
 * versionan y viajan en el bundle (~200-500 KB c/u).
 *
 * Uso (requiere el server Next para el stream del video base):
 *   node generate-style-previews.mjs                       → TODOS los estilos del registro (--video es obligatorio si "avatar" no está en tu raíz de datos)
 *   node generate-style-previews.mjs --video VID_XXX       → otro video base (necesita transcript)
 *   node generate-style-previews.mjs --only hype,editorial → solo esos (lotes)
 *   node generate-style-previews.mjs --seconds 4           → duración distinta
 */
import { execFileSync } from "node:child_process";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync, rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProjectForStyle } from "./style-templates.mjs";

import { pickDataRoot } from "./data-root.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACCENT = "#fb7185"; // mismo default del wizard
const FPS = 30; // fps de ViralVideo (Root.tsx)

// ─── Rutas (mismo pickDataRoot que generate-style-thumbs.mjs) ───
const DATA_ROOT = pickDataRoot();
const TMP_DIR = path.join(DATA_ROOT, "tmp_style_previews"); // sin espacios (quoting de spawn)
const OUT_DIR = path.join(__dirname, "..", "frontend", "public", "style-previews");

// ─── CLI ───
const argv = process.argv.slice(2);
const argValue = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const VIDEO_ID = argValue("--video") || "avatar";
const ONLY = (argValue("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const SECONDS = Math.max(2, Math.min(6, Number(argValue("--seconds") || 3)));

// ─── Estilos: fuente de verdad = el registry ───
const registry = JSON.parse(
  readFileSync(path.join(__dirname, "..", "frontend", "src", "lib", "style-registry.data.json"), "utf-8")
);
const ALL_IDS = registry.map((s) => s.id);
const idsToRun = ONLY.length > 0 ? ALL_IDS.filter((id) => ONLY.includes(id)) : ALL_IDS;

// ─── Video base: transcript obligatorio + keywords con timestamps ───
const transcriptPath = path.join(DATA_ROOT, "transcripts", `${VIDEO_ID}.json`);
if (!existsSync(transcriptPath)) {
  console.error(`✗ No hay transcript para "${VIDEO_ID}" en ${transcriptPath}`);
  process.exit(1);
}
const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
const words = transcript.words || [];
const duration = transcript.duration || (words.length ? words[words.length - 1].end : 30);

const STOP = new Set(["para","como","pero","esto","esta","este","los","las","una","con","por","sin","del","sus","mas","muy","que"]);
const keywords = [];
for (const w of words) {
  if (keywords.length >= 6) break;
  const clean = String(w.word || "").toLowerCase().replace(/[^a-záéíóúñ0-9]/gi, "");
  if (clean.length > 4 && !STOP.has(clean) && !keywords.some((k) => k.word.toLowerCase() === clean)) {
    keywords.push({ word: w.word, start: w.start, end: w.end ?? w.start + 0.5 });
  }
}

// Ventana del preview: arranca al 40% del clip (zona con contenido, lejos de bordes),
// dura SECONDS. Acotado para no salirse de la duración.
const startSec = Math.min(Math.max(2, duration * 0.4), Math.max(2, duration - SECONDS - 1));
const startFrame = Math.max(0, Math.round(startSec * FPS));
const endFrame = startFrame + Math.round(SECONDS * FPS) - 1;

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
console.log(
  `Generando ${idsToRun.length} previews de ${SECONDS}s — video "${VIDEO_ID}" · frames ${startFrame}-${endFrame}`
);

const ctxBase = {
  videoId: VIDEO_ID,
  duration,
  keywords,
  accentColor: DEFAULT_ACCENT,
  caption: "",
};
// Dos orientaciones (el layout depende de width/height): {id}_v.mp4 y {id}_h.mp4.
const ASPECTS = [
  { tag: "v", width: 1080, height: 1920 },
  { tag: "h", width: 1920, height: 1080 },
];

const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
const results = [];
for (const styleId of idsToRun) {
  try {
    for (const asp of ASPECTS) {
      const projectPath = path.join(TMP_DIR, `project_${styleId}_${asp.tag}.json`);
      const propsName = `props_sprev_${styleId}_${asp.tag}.json`;
      const project = buildProjectForStyle({ ...ctxBase, width: asp.width, height: asp.height }, styleId);
      project.id = `style_preview_${styleId}_${asp.tag}`;
      // Sin música (el wizard lo reproduce muted igual) y sin jump cuts (ventana corta).
      project.musicTrack = null; project.musicVolume = 0; project.enableJumpCuts = false;
      writeFileSync(projectPath, JSON.stringify(project, null, 2), "utf-8");
      execFileSync("node", ["build-props.mjs", VIDEO_ID, projectPath, propsName], {
        cwd: __dirname, stdio: "pipe", timeout: 120_000,
      });
      try {
        const outMp4 = path.join(TMP_DIR, `${styleId}_${asp.tag}.mp4`);
        const finalMp4 = path.join(OUT_DIR, `${styleId}_${asp.tag}.mp4`);
        rmSync(outMp4, { force: true });
        execFileSync(npxExe, [
          "remotion", "render", "src/index.ts", "ViralVideo", outMp4,
          `--props=${propsName}`,
          `--frames=${startFrame}-${endFrame}`,
          "--scale=0.25",
          "--crf=30",
          "--muted",
          "--timeout=120000",
        ], { cwd: __dirname, stdio: "pipe", timeout: 600_000, shell: true });
        const size = existsSync(outMp4) ? statSync(outMp4).size : 0;
        if (size < 20_480) throw new Error(`${asp.tag} MP4 sospechoso (${size} bytes)`);
        copyFileSync(outMp4, finalMp4);
      } finally {
        rmSync(path.join(__dirname, propsName), { force: true });
      }
    }
    results.push({ id: styleId, ok: true });
    console.log(`  ✓ ${styleId} (v+h)`);
  } catch (err) {
    const msg = err?.stderr?.toString?.().slice(-300) || err?.message || String(err);
    results.push({ id: styleId, ok: false, error: msg });
    console.error(`  ✗ ${styleId}: ${msg}`);
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\nListo: ${ok}/${results.length} previews en ${OUT_DIR}`);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`Fallaron: ${failed.map((f) => f.id).join(", ")}`);
  process.exitCode = 1;
}
