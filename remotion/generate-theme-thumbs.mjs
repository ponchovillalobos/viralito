/**
 * generate-theme-thumbs.mjs — Miniaturas REALES de los 17 temas editoriales.
 *
 * Script DEV-TIME (corre en la máquina de desarrollo, NO en la del cliente):
 * para cada tema de EDITORIAL_THEMES del wizard, arma un project del estilo
 * "editorial" sobre un video real (con transcript existente), replica los
 * overrides del wizard (font/background/theme/accent — igual que
 * apply-wizard-overrides.ts) y saca UN still con Remotion en el frame donde
 * la primera tarjeta tipográfica está visible. Los PNG (~270×480, 9:16) van a
 * frontend/public/theme-thumbs/{id}.png y el wizard los muestra como miniatura
 * de cada tema (con fallback CSS si faltan).
 *
 * Uso (requiere el server Next en http://localhost:3000 para el stream del video):
 *   node generate-theme-thumbs.mjs                  → los 17 temas
 *   node generate-theme-thumbs.mjs --video Inta     → otro video base
 *   node generate-theme-thumbs.mjs --only ft,vogue  → solo esos temas (lotes)
 */
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pickDataRoot } from "./data-root.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Los temas se LEEN de la fuente compartida, no se copian ───────────────
//
// Aca habia una lista escrita a mano, "copiada 1:1" del wizard, con 22 entradas
// contra las 23 reales. Al agregar `revista`, `dossier` y `cartel` nadie la
// actualizo, asi que `--only revista,dossier,cartel` respondia
// "Generando 0 miniaturas" — sin error, sin explicacion, y con el generador
// aparentemente funcionando.
//
// Es la octava copia de "la lista de X" que aparece en este proyecto. Se lee del
// TypeScript con una expresion regular porque este archivo es .mjs y no puede
// importar un modulo TS; feo, pero una sola verdad.
const _TEMAS_TS = readFileSync(
  path.join(__dirname, "..", "frontend", "src", "lib", "editorial-themes.ts"),
  "utf-8",
);
const THEMES = [...
  _TEMAS_TS.matchAll(
    /\{\s*id:\s*"([^"]+)"[^}]*?font:\s*"([^"]+)"[^}]*?background:\s*"([^"]+)"/g,
  ),
].map((m) => {
  const bloque = _TEMAS_TS.slice(m.index, m.index + 400);
  const theme = (bloque.match(/theme:\s*"([^"]*)"/) || [, ""])[1];
  const accent = (bloque.match(/accent:\s*"([^"]+)"/) || [])[1];
  return { id: m[1], font: m[2], background: m[3], theme, ...(accent ? { accent } : {}) };
});
if (THEMES.length === 0) {
  console.error("✗ no se pudieron leer los temas de editorial-themes.ts");
  process.exit(1);
}

// Mismo default de accent que el wizard cuando el tema no trae el suyo.
const DEFAULT_ACCENT = "#fb7185";
const FPS = 30; // fps de la composición ViralVideo (Root.tsx)

// ─── Rutas (mismo pickDataRoot que build-props.mjs) ───
const DATA_ROOT = pickDataRoot();
// Temp SIN espacios (el quoting de spawn shell:true en Windows rompe con espacios).
const TMP_DIR = path.join(DATA_ROOT, "tmp_theme_thumbs");
const OUT_DIR = path.join(__dirname, "..", "frontend", "public", "theme-thumbs");

// ─── CLI args ───
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const VIDEO_ID = argValue("--video") || "Inta";
const ONLY = (argValue("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);

// ─── Video base: transcript + (si existe) las tarjetas editoriales cacheadas
// en graphics/{videoId}.json (las genera generate_graphics.py en auto-build).
// Con tarjetas reales la miniatura muestra el titular serif del tema; sin
// ellas, caemos a 3 tarjetas demo para que el texto SIEMPRE sea visible. ───
const transcriptPath = path.join(DATA_ROOT, "transcripts", `${VIDEO_ID}.json`);
if (!existsSync(transcriptPath)) {
  console.error(`✗ No hay transcript para "${VIDEO_ID}" en ${transcriptPath}`);
  process.exit(1);
}
const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));

let cards = [];
const graphicsPath = path.join(DATA_ROOT, "graphics", `${VIDEO_ID}.json`);
if (existsSync(graphicsPath)) {
  try {
    const g = JSON.parse(readFileSync(graphicsPath, "utf-8"));
    if (Array.isArray(g.editorialCards)) cards = g.editorialCards.slice(0, 3);
  } catch {
    /* cache ilegible → tarjetas demo */
  }
}
if (cards.length === 0) {
  cards = [
    {
      at: 1.0,
      duration: 9.0,
      kicker: "LA VERDAD",
      title: "La estrategia que sí funciona.",
      accent: "estrategia",
      subtitle: "",
      number: "",
      statValue: "",
      statUnit: "",
      icon: "",
    },
  ];
}

// Frame con texto visible: a mitad de la primera tarjeta (su titular serif ya
// terminó de animarse). Fallback: frame 90 (3s).
const firstCard = cards[0];
const thumbTimeSec = firstCard ? firstCard.at + Math.min(4, firstCard.duration / 2) : 3;
const FRAME = Math.max(1, Math.round(thumbTimeSec * FPS));

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const themesToRun = ONLY.length > 0 ? THEMES.filter((t) => ONLY.includes(t.id)) : THEMES;
console.log(
  `Generando ${themesToRun.length} miniaturas — video "${VIDEO_ID}" · frame ${FRAME} ` +
    `(${thumbTimeSec.toFixed(1)}s) · ${cards.length} tarjetas`
);

const results = [];
for (const theme of themesToRun) {
  const accent = theme.accent || DEFAULT_ACCENT;
  // Project del estilo editorial, espejo de buildProjectForStyle("editorial") en
  // frontend/src/lib/style-templates.ts + el override del wizard (Object.assign
  // de font/background/theme sobre editorialLayout, ver apply-wizard-overrides.ts).
  // Igual que style-preview: sin música ni jump cuts (no aplican a un still).
  const project = {
    id: `theme_thumb_${theme.id}`,
    videoId: VIDEO_ID,
    styleId: "editorial",
    accentColor: accent,
    subtitleColor: "#ffffff",
    subtitleHighlight: accent,
    musicTrack: null,
    musicVolume: 0,
    enableJumpCuts: false,
    subtitleStyle: "anton",
    vignette: false,
    captionBounce: false,
    width: 1080,
    height: 1920,
    graphics: true,
    editorialLayout: {
      panel: "right",
      panelWidth: 0.46, // 9:16 → casi media pantalla (igual que el template)
      accent,
      texture: "paper",
      fps12: true,
      cohesion: true,
      font: theme.font,
      background: theme.background,
      theme: theme.theme || "",
    },
    editorialCards: cards,
    dataViz: [],
  };

  const projectPath = path.join(TMP_DIR, `project_${theme.id}.json`);
  const propsName = `props_thumb_${theme.id}.json`;
  const outPng = path.join(TMP_DIR, `${theme.id}.png`);
  const finalPng = path.join(OUT_DIR, `${theme.id}.png`);
  writeFileSync(projectPath, JSON.stringify(project, null, 2), "utf-8");

  try {
    // 1) props (mismo mecanismo que style-preview: build-props.mjs con props propio)
    execFileSync("node", ["build-props.mjs", VIDEO_ID, projectPath, propsName], {
      cwd: __dirname,
      stdio: "pipe",
      timeout: 120_000,
    });

    // 2) still — scale 0.25 → 270×480 (9:16)
    rmSync(outPng, { force: true });
    const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
    execFileSync(
      npxExe,
      [
        "remotion", "still", "src/index.ts", "ViralVideo",
        outPng, `--frame=${FRAME}`, `--props=${propsName}`,
        "--scale=0.25", "--timeout=120000",
      ],
      { cwd: __dirname, stdio: "pipe", timeout: 300_000, shell: true }
    );

    const size = existsSync(outPng) ? statSync(outPng).size : 0;
    if (size < 10_240) {
      throw new Error(`PNG sospechoso (${size} bytes — ¿frame negro o render roto?)`);
    }
    copyFileSync(outPng, finalPng);
    results.push({ id: theme.id, ok: true, kb: +(size / 1024).toFixed(1) });
    console.log(`  ✓ ${theme.id}.png (${(size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    const msg = err?.stderr?.toString?.().slice(-300) || err?.message || String(err);
    results.push({ id: theme.id, ok: false, error: msg });
    console.error(`  ✗ ${theme.id}: ${msg}`);
  } finally {
    // Limpiar el props temporal del directorio de remotion (best-effort).
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
