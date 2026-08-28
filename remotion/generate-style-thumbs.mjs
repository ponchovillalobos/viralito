/**
 * generate-style-thumbs.mjs — Miniaturas REALES pre-generadas, UNA por estilo.
 *
 * Hermano de generate-theme-thumbs.mjs (que cubre los temas editoriales). Este
 * recorre TODOS los estilos del registro (frontend/src/lib/style-registry.data.json)
 * y, para cada uno, arma su project con buildProjectForStyle(ctx, styleId) — el MISMO
 * builder que usa el render real y el style-preview, así la miniatura es honesta —,
 * saca UN still con Remotion y lo guarda en frontend/public/style-thumbs/{id}.png
 * (~270×480, 9:16). El wizard los muestra como miniatura por estilo, con fallback CSS
 * (StyleMiniDemo) si falta el PNG.
 *
 * DEV-TIME: corre en la máquina de desarrollo, NO en la del cliente. Los PNG se
 * versionan y viajan en el bundle.
 *
 * Uso (requiere el server Next en http://localhost:3000 para el stream del video):
 *   node generate-style-thumbs.mjs                       → TODOS los estilos del registro (--video es obligatorio si "avatar" no está en tu raíz de datos)
 *   node generate-style-thumbs.mjs --video VID_XXX       → otro video base (necesita transcript)
 *   node generate-style-thumbs.mjs --only hype,editorial → solo esos (lotes)
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

// ─── Rutas (mismo pickDataRoot que build-props.mjs / generate-theme-thumbs.mjs) ───
const DATA_ROOT = pickDataRoot();
const TMP_DIR = path.join(DATA_ROOT, "tmp_style_thumbs"); // sin espacios (quoting de spawn)
const OUT_DIR = path.join(__dirname, "..", "frontend", "public", "style-thumbs");

// ─── CLI ───
const argv = process.argv.slice(2);
const argValue = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const VIDEO_ID = argValue("--video") || "avatar";
const ONLY = (argValue("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);

// ─── Estilos: fuente de verdad = el registry (mismos ids que StyleId) ───
const registry = JSON.parse(
  readFileSync(path.join(__dirname, "..", "frontend", "src", "lib", "style-registry.data.json"), "utf-8")
);
const ALL_IDS = registry.map((s) => s.id);
const idsToRun = ONLY.length > 0 ? ALL_IDS.filter((id) => ONLY.includes(id)) : ALL_IDS;

// ─── Video base: transcript (obligatorio) + keywords resueltas con timestamps
// (shape {word,start,end} que espera buildProjectForStyle). graphics/{id}.json
// (tarjetas editoriales) lo mergea build-props.mjs si existe. ───
const transcriptPath = path.join(DATA_ROOT, "transcripts", `${VIDEO_ID}.json`);
if (!existsSync(transcriptPath)) {
  console.error(`✗ No hay transcript para "${VIDEO_ID}" en ${transcriptPath}`);
  process.exit(1);
}
const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
const words = transcript.words || [];
const duration = transcript.duration || (words.length ? words[words.length - 1].end : 30);

const STOP = new Set(["para","como","pero","esto","esta","este","los","las","una","con","por","sin","del","sus","mas","muy","que","los","una"]);
const keywords = [];
for (const w of words) {
  if (keywords.length >= 6) break;
  const clean = String(w.word || "").toLowerCase().replace(/[^a-záéíóúñ0-9]/gi, "");
  if (clean.length > 4 && !STOP.has(clean) && !keywords.some((k) => k.word.toLowerCase() === clean)) {
    keywords.push({ word: w.word, start: w.start, end: w.end ?? w.start + 0.5 });
  }
}

// 3 ESCENAS por estilo: tres momentos distintos del clip (≈28%, 50%, 72% de la
// duración, acotados a [2s, duración-2s]) → el usuario ve cómo se ve el output en
// varias partes, no un solo frame. Cada uno se guarda como {id}_1/2/3.png.
const SCENE_FRACS = [0.28, 0.5, 0.72];
const sceneFrames = SCENE_FRACS.map((f) => {
  const t = Math.min(Math.max(2, duration * f), Math.max(2, duration - 2));
  return Math.max(1, Math.round(t * FPS));
});

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
console.log(`Generando ${idsToRun.length} estilos × ${sceneFrames.length} escenas — video "${VIDEO_ID}" · frames ${sceneFrames.join(", ")}`);

const ctxBase = {
  videoId: VIDEO_ID,
  duration,
  keywords,
  accentColor: DEFAULT_ACCENT,
  caption: "",
};
// Dos orientaciones: el layout de cada estilo depende de width/height (ej. editorial
// panel, reencuadre), así que se construye un project por aspecto. Archivos:
// {id}_v_1..3.png (vertical 9:16) y {id}_h_1..3.png (horizontal 16:9). El "Ver ejemplo"
// del wizard muestra el set que matchea el formato elegido.
const ASPECTS = [
  { tag: "v", width: 1080, height: 1920 },
  { tag: "h", width: 1920, height: 1080 },
];

const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
const results = [];
for (const styleId of idsToRun) {
  try {
    let okScenes = 0;
    for (const asp of ASPECTS) {
      const projectPath = path.join(TMP_DIR, `project_${styleId}_${asp.tag}.json`);
      const propsName = `props_sthumb_${styleId}_${asp.tag}.json`;
      const project = buildProjectForStyle({ ...ctxBase, width: asp.width, height: asp.height }, styleId);
      project.id = `style_thumb_${styleId}_${asp.tag}`;
      project.musicTrack = null; project.musicVolume = 0; project.enableJumpCuts = false;
      writeFileSync(projectPath, JSON.stringify(project, null, 2), "utf-8");
      execFileSync("node", ["build-props.mjs", VIDEO_ID, projectPath, propsName], {
        cwd: __dirname, stdio: "pipe", timeout: 120_000,
      });
      try {
        for (let i = 0; i < sceneFrames.length; i++) {
          const outPng = path.join(TMP_DIR, `${styleId}_${asp.tag}_${i + 1}.png`);
          const finalPng = path.join(OUT_DIR, `${styleId}_${asp.tag}_${i + 1}.png`);
          rmSync(outPng, { force: true });
          execFileSync(npxExe, [
            "remotion", "still", "src/index.ts", "ViralVideo",
            outPng, `--frame=${sceneFrames[i]}`, `--props=${propsName}`, "--scale=0.25", "--timeout=120000",
          ], { cwd: __dirname, stdio: "pipe", timeout: 300_000, shell: true });
          const size = existsSync(outPng) ? statSync(outPng).size : 0;
          if (size < 10_240) throw new Error(`${asp.tag} escena ${i + 1} PNG sospechoso (${size} bytes)`);
          copyFileSync(outPng, finalPng);
          okScenes++;
        }
      } finally {
        rmSync(path.join(__dirname, propsName), { force: true });
      }
    }
    results.push({ id: styleId, ok: true, scenes: okScenes });
    console.log(`  ✓ ${styleId} (${okScenes} escenas: v+h)`);
  } catch (err) {
    const msg = err?.stderr?.toString?.().slice(-300) || err?.message || String(err);
    results.push({ id: styleId, ok: false, error: msg });
    console.error(`  ✗ ${styleId}: ${msg}`);
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\nListo: ${ok}/${results.length} miniaturas en ${OUT_DIR}`);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`Fallaron: ${failed.map((f) => f.id).join(", ")}`);
  process.exitCode = 1;
}
