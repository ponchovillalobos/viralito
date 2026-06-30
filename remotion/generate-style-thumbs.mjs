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
 *   node generate-style-thumbs.mjs                       → los 23 estilos (video "avatar")
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACCENT = "#fb7185"; // mismo default del wizard
const FPS = 30; // fps de ViralVideo (Root.tsx)

// ─── Rutas (mismo pickDataRoot que build-props.mjs / generate-theme-thumbs.mjs) ───
function pickDataRoot() {
  const o = process.env.VIRAL_DATA_ROOT;
  if (o) return o;
  for (const c of ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"]) {
    if (existsSync(c)) return c;
  }
  return "C:\\viral-data\\videos";
}
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

// Frame con contenido visible: 35% de la duración (igual criterio que style-preview),
// acotado a [2s, 8s] para no caer en intro/outro.
const thumbTimeSec = Math.min(8, Math.max(2, duration * 0.35));
const FRAME = Math.max(1, Math.round(thumbTimeSec * FPS));

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
console.log(`Generando ${idsToRun.length} miniaturas — video "${VIDEO_ID}" · frame ${FRAME} (${thumbTimeSec.toFixed(1)}s)`);

const ctxBase = {
  videoId: VIDEO_ID,
  duration,
  keywords,
  accentColor: DEFAULT_ACCENT,
  width: 1080,
  height: 1920, // 9:16, igual que las theme-thumbs (still --scale=0.25 → 270×480)
  caption: "",
};

const results = [];
for (const styleId of idsToRun) {
  const projectPath = path.join(TMP_DIR, `project_${styleId}.json`);
  const propsName = `props_sthumb_${styleId}.json`;
  const outPng = path.join(TMP_DIR, `${styleId}.png`);
  const finalPng = path.join(OUT_DIR, `${styleId}.png`);
  try {
    const project = buildProjectForStyle({ ...ctxBase }, styleId);
    project.id = `style_thumb_${styleId}`;
    project.musicTrack = null; project.musicVolume = 0; project.enableJumpCuts = false;
    writeFileSync(projectPath, JSON.stringify(project, null, 2), "utf-8");

    // 1) props (mismo build-props.mjs que style-preview)
    execFileSync("node", ["build-props.mjs", VIDEO_ID, projectPath, propsName], {
      cwd: __dirname, stdio: "pipe", timeout: 120_000,
    });
    // 2) still 0.25 → 270×480
    rmSync(outPng, { force: true });
    const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
    execFileSync(npxExe, [
      "remotion", "still", "src/index.ts", "ViralVideo",
      outPng, `--frame=${FRAME}`, `--props=${propsName}`, "--scale=0.25", "--timeout=120000",
    ], { cwd: __dirname, stdio: "pipe", timeout: 300_000, shell: true });

    const size = existsSync(outPng) ? statSync(outPng).size : 0;
    if (size < 10_240) throw new Error(`PNG sospechoso (${size} bytes — ¿frame negro/render roto?)`);
    copyFileSync(outPng, finalPng);
    results.push({ id: styleId, ok: true, kb: +(size / 1024).toFixed(1) });
    console.log(`  ✓ ${styleId}.png (${(size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    const msg = err?.stderr?.toString?.().slice(-300) || err?.message || String(err);
    results.push({ id: styleId, ok: false, error: msg });
    console.error(`  ✗ ${styleId}: ${msg}`);
  } finally {
    rmSync(path.join(__dirname, propsName), { force: true });
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\nListo: ${ok}/${results.length} miniaturas en ${OUT_DIR}`);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`Fallaron: ${failed.map((f) => f.id).join(", ")}`);
  process.exitCode = 1;
}
