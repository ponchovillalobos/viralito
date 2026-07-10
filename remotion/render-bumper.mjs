#!/usr/bin/env node
/**
 * render-bumper.mjs (F2.b) — renderiza UN bumper (intro u outro) de la composición
 * BrandBumper a un mp4. Lo llaman auto-build (shorts) y long_form_pipeline (largos)
 * antes de concatenar con python/bumper_concat.py.
 *
 * Uso:
 *   node render-bumper.mjs --mode intro --out intro.mp4 \
 *     --tagline "ESTRATEGIA VIRAL" --subtitle "@poncho" --accent "#a78bfa" \
 *     --logo "" --background dark --width 1080 --height 1920 --sec 1.4
 *
 * Invoca el CLI de Remotion DIRECTO con node (sin npx) como el pipeline de clips.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const mode = arg("mode", "intro");
const out = arg("out");
if (!out) {
  console.error("[render-bumper] falta --out");
  process.exit(2);
}
const width = parseInt(arg("width", "1080"), 10);
const height = parseInt(arg("height", "1920"), 10);
const sec = parseFloat(arg("sec", mode === "outro" ? "1.6" : "1.4"));

const props = {
  mode,
  logoUrl: arg("logo", ""),
  tagline: arg("tagline", ""),
  subtitle: arg("subtitle", ""),
  accent: arg("accent", "#fb7185"),
  background: arg("background", "dark"),
  bumperSec: sec,
  width,
  height,
};

// props a un temporal (evita problemas de quoting de JSON en la shell).
const propsPath = path.join(os.tmpdir(), `bumper_props_${mode}_${width}x${height}.json`);
writeFileSync(propsPath, JSON.stringify(props), "utf-8");

// Resolver el CLI de Remotion (mismo criterio que long_form_pipeline).
function remotionCli() {
  const cands = [
    path.join(__dirname, "node_modules", "@remotion", "cli", "remotion-cli.js"),
    path.join(__dirname, "node_modules", ".bin", "remotion"),
  ];
  return cands.find((c) => existsSync(c));
}

const cli = remotionCli();
const nodeBin = process.execPath;
const args = cli
  ? [cli, "render", "src/index.ts", "BrandBumper", out, `--props=${propsPath}`, "--log=error"]
  : null;

let r;
if (args) {
  r = spawnSync(nodeBin, args, { cwd: __dirname, stdio: "inherit" });
} else {
  // Fallback: npx
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  r = spawnSync(
    npx,
    ["remotion", "render", "src/index.ts", "BrandBumper", out, `--props=${propsPath}`, "--log=error"],
    { cwd: __dirname, stdio: "inherit" }
  );
}

if (r.status !== 0 || !existsSync(out)) {
  console.error(`[render-bumper] falló el render del bumper (${mode})`);
  process.exit(1);
}
console.error(`[render-bumper] ${mode} → ${out} (${width}x${height}, ${sec}s)`);
