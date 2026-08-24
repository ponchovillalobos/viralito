/**
 * F0.4 (auditoría) — Test de PARIDAD entre los estilos de shorts y largos.
 *
 * Los estilos viven duplicados en dos lenguajes:
 *   - shorts: frontend/src/lib/style-templates.ts
 *   - largos: remotion/style-templates.mjs
 * y ya divergieron una vez (2026-06: largos renderizaban sin LUT/scene-fx/kinetic).
 *
 * Este script hace un chequeo ESTÁTICO: parsea los bloques `if (styleId === "X")`
 * de ambos archivos y compara, por estilo:
 *   1. que el estilo exista en ambos
 *   2. las claves del objeto project (graphics, vignette, subtitleStyle, ...)
 *   3. las opciones de applyCapcutFx (lut, kinetic, mirror, endScreen, ...)
 *
 * Uso:   node check-style-parity.mjs        → exit 0 si hay paridad, 1 si diverge
 * Nota:  diferencias ESPERADAS van en EXPECTED_ONLY_TS / EXPECTED_DIFF_KEYS abajo,
 *        con el motivo — así el test sólo grita por divergencias NUEVAS.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TS_PATH = path.join(__dirname, "..", "frontend", "src", "lib", "style-templates.ts");
const MJS_PATH = path.join(__dirname, "style-templates.mjs");

// Estilos que SOLO tienen sentido en shorts (con motivo). No cuentan como divergencia.
const EXPECTED_ONLY_TS = {
  broll_full: "b-roll automático (Pexels) no está cableado en el pipeline de largos",
  broll_pip: "b-roll automático (Pexels) no está cableado en el pipeline de largos",
  text_behind: null, // si aparece acá es porque .mjs lo tiene — se auto-resuelve
  cinematic_pro: "modo cinematográfico usa overlays subidos por el user (solo shorts)",
};

// Claves de project/opts cuya diferencia es esperada, por estilo (con motivo).
const EXPECTED_DIFF_KEYS = {
  "*": new Set([
    "musicTrack", "musicVolume", // largos eligen música por clip (pickRandomMusicTrack)
    "beatSync", "removeBg", // dependen de pasos Python que largos cablea distinto
    "bRollMode", // sin b-roll en largos, el modo es decorativo
  ]),
};

/** Extrae bloques `if (styleId === "X" || styleId === "Y" || ...) { ... }`.
 *
 *  La condición admite CUALQUIER cantidad de alternativas. Antes el patrón sólo
 *  aceptaba una: el bloque de motion_pro/motion_beat/motion_grid tiene dos `||`
 *  y no coincidía con nada, así que esos 3 estilos quedaban FUERA del chequeo…
 *  y el script imprimía "Paridad OK" igualmente. Contaba 22 de 25 y daba
 *  confianza injustificada — justo el fallo que existe para prevenir.
 */
function extractStyleBlocks(src) {
  const blocks = {};
  // Captura la condición entera; los ids se extraen después uno a uno.
  const re = /if\s*\(\s*(styleId\s*===\s*"[\w]+"(?:\s*\|\|\s*styleId\s*===\s*"[\w]+")*)\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 1);
    for (const id of m[1].matchAll(/styleId\s*===\s*"([\w]+)"/g)) {
      blocks[id[1]] = body;
    }
  }
  return blocks;
}

/** Claves top-level que el bloque setea en el objeto project + opts de applyCapcutFx. */
function extractKeys(body) {
  const keys = new Set();
  // claves "foo:" tanto al inicio de línea (objeto multilinea) como inline tras "{" o ","
  // (objetos de una línea, ej. el bloque punch). Filtra props anidadas comunes.
  const IGNORE = new Set([
    "at", "duration", "scale", "intensity", "type", "sound", "volume", "phrase",
    "color", "width", "height", "start", "end", "url", "word", "position",
    "name", "size", "text", "handle", "emoji", "rotation", "bg", "from", "yOffset",
  ]);
  for (const keyRe of [/^\s{2,}([a-zA-Z_][\w]*)\s*:/gm, /[{,]\s*([a-zA-Z_][\w]*)\s*:/g]) {
    let m;
    while ((m = keyRe.exec(body)) !== null) {
      if (!IGNORE.has(m[1])) keys.add(m[1]);
    }
  }
  return keys;
}

/** Valores simples que importan para el look (lut, kinetic). */
function extractLook(body) {
  const lut = body.match(/lut:\s*"([^"]+)"/)?.[1] ?? null;
  const kinetic = body.match(/kinetic:\s*"([^"]+)"/)?.[1] ?? null;
  return { lut, kinetic };
}

const ts = readFileSync(TS_PATH, "utf-8");
const mjs = readFileSync(MJS_PATH, "utf-8");
const tsBlocks = extractStyleBlocks(ts);
const mjsBlocks = extractStyleBlocks(mjs);

let problems = 0;
const report = [];

// 1) Estilos faltantes en .mjs
for (const style of Object.keys(tsBlocks)) {
  if (!mjsBlocks[style]) {
    if (style in EXPECTED_ONLY_TS && EXPECTED_ONLY_TS[style]) {
      report.push(`  ~ ${style}: solo en shorts (esperado: ${EXPECTED_ONLY_TS[style]})`);
    } else {
      report.push(`  ✗ ${style}: existe en .ts pero FALTA en .mjs`);
      problems++;
    }
  }
}
// 2) Estilos en .mjs que no existen en .ts (raro, pero detectarlo)
for (const style of Object.keys(mjsBlocks)) {
  if (!tsBlocks[style]) {
    report.push(`  ✗ ${style}: existe en .mjs pero NO en .ts`);
    problems++;
  }
}

// 3) Diferencias de claves y de look por estilo compartido
for (const style of Object.keys(tsBlocks)) {
  if (!mjsBlocks[style]) continue;
  const tsKeys = extractKeys(tsBlocks[style]);
  const mjsKeys = extractKeys(mjsBlocks[style]);
  const expected = EXPECTED_DIFF_KEYS[style] ?? EXPECTED_DIFF_KEYS["*"];

  const missingInMjs = [...tsKeys].filter((k) => !mjsKeys.has(k) && !expected.has(k));
  const missingInTs = [...mjsKeys].filter((k) => !tsKeys.has(k) && !expected.has(k));
  if (missingInMjs.length) {
    report.push(`  ✗ ${style}: claves en .ts que faltan en .mjs → ${missingInMjs.join(", ")}`);
    problems++;
  }
  if (missingInTs.length) {
    report.push(`  ✗ ${style}: claves en .mjs que faltan en .ts → ${missingInTs.join(", ")}`);
    problems++;
  }

  const tsLook = extractLook(tsBlocks[style]);
  const mjsLook = extractLook(mjsBlocks[style]);
  for (const k of ["lut", "kinetic"]) {
    if (tsLook[k] !== mjsLook[k]) {
      report.push(`  ✗ ${style}: ${k} difiere → .ts="${tsLook[k]}" vs .mjs="${mjsLook[k]}"`);
      problems++;
    }
  }
}

const shared = Object.keys(tsBlocks).filter((s) => mjsBlocks[s]);
console.log(`Paridad de estilos shorts(.ts) ↔ largos(.mjs)`);
console.log(`  estilos .ts: ${Object.keys(tsBlocks).length} · .mjs: ${Object.keys(mjsBlocks).length} · compartidos: ${shared.length}`);
for (const line of report) console.log(line);

if (problems > 0) {
  console.error(`\n✗ ${problems} divergencia(s) REAL(es). Sincronizá style-templates.ts ↔ style-templates.mjs.`);
  process.exit(1);
}
console.log(`\n✓ Paridad OK (las diferencias listadas con ~ son esperadas y documentadas).`);
