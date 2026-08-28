#!/usr/bin/env node
/**
 * Guardián: ningún campo del composition puede quedar sin quien lo PRODUZCA.
 *
 * En un solo día aparecieron CUATRO efectos implementados, cableados y
 * completamente inalcanzables. Ninguno daba error: el video salía igual, sólo
 * que sin el efecto.
 *
 *   escala_medida         faltaba en la lista del prompt del agente VFX
 *   freezeMarks           ningún builder de props lo copiaba
 *   proTransitionSeries   la capa abortaba el render al activarse
 *   statPops/lowerThirds  nadie ejecutaba word_callouts.py
 *
 * Lo que los hacía invisibles es que los `build-*.mjs` REENVÍAN todo
 * (`campo: project.campo || []`). Mirar a los builders no delata nada: hay que
 * mirar quién ESCRIBE el valor por primera vez — un enricher del frontend o el
 * pipeline de Python.
 *
 * Este guardián busca exactamente eso, y sólo eso. No comprueba que el efecto
 * se VEA (para eso están los tests que renderizan), sino que exista al menos un
 * sitio capaz de encenderlo.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(AQUI, "..");

/** Campos que se llenan fuera del código que este guardián puede leer. */
const EXENTOS = new Map([
  ["rawVideoUrl", "lo arma cada builder con la URL del stream"],
  ["trialWatermark", "lo pone el chequeo de licencia en los builders"],
]);

function archivos(dir, exts, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entradas) {
    if (e === "node_modules" || e === "__tests__" || e === "venv" || e === ".next") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) archivos(p, exts, acc);
    else if (exts.some((x) => e.endsWith(x)) && !e.includes(".test.")) acc.push(p);
  }
  return acc;
}

const composition = readFileSync(path.join(AQUI, "src", "ViralVideo.tsx"), "utf-8");
const i = composition.indexOf("export const viralVideoSchema");
const j = composition.indexOf("\n});", i);
if (i < 0 || j < 0) {
  console.error("✗ no encontré viralVideoSchema en ViralVideo.tsx");
  process.exit(1);
}
const esquema = composition.slice(i, j);
const campos = [
  ...new Set(
    [...esquema.matchAll(/^ {2}(\w+):\s*z[\s.]/gm)].map((m) => m[1])
  ),
];

// PRODUCTORES: enrichers/rutas del frontend y el pipeline de Python.
// Los build-*.mjs quedan fuera A PROPÓSITO: reenvían, no deciden.
const fuentes = [
  ...archivos(path.join(REPO, "frontend", "src"), [".ts", ".tsx"]),
  ...archivos(path.join(REPO, "python"), [".py"]),
];
const lineas = fuentes.flatMap((f) => readFileSync(f, "utf-8").split(/[\r\n]+/));

const huerfanos = [];
for (const c of campos) {
  if (EXENTOS.has(c)) continue;
  // SIN expresiones regulares, a proposito.
  //
  // La primera version de este guardian las usaba y TODAS estaban corruptas:
  // los escapes perdieron un nivel al escribir el archivo, asi que `` quedo
  // como un caracter de retroceso y `["campo"]` como una CLASE DE CARACTERES
  // que coincide con casi cualquier linea. El guardian pasaba siempre, por la
  // razon equivocada — que es exactamente la clase de defecto que vino a
  // vigilar. Se descubrio rompiendo a proposito la produccion de `freezeMarks`
  // y viendo que seguia en verde.
  //
  // Comparar cadenas no tiene escapes que perder.
  const produce = lineas.some((l) => {
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("#")) return false;
    // asignacion directa: project.campo = ... / proj["campo"] = ... / fullProps.campo = ...
    if (t.includes("project." + c + " =")) return true;
    if (t.includes("fullProps." + c + " =")) return true;
    if (t.includes('proj["' + c + '"] =')) return true;
    if (t.includes('["' + c + '"] =')) return true;
    // clave en un literal que NO sea un reenvio del propio campo
    if (t.startsWith(c + ":") && !t.includes("project." + c) && !t.includes("proj.")) return true;
    if (t.startsWith('"' + c + '":') && !t.includes("project." + c)) return true;
    if (t.startsWith("..." + "(") && t.includes(c + ":")) return true;
    return false;
  });
  if (!produce) huerfanos.push(c);
}

console.log(`Campos alcanzables — ${campos.length} en el composition`);
console.log(`  exentos: ${EXENTOS.size} · sin productor: ${huerfanos.length}`);

if (huerfanos.length > 0) {
  console.error("");
  console.error("✗ Estos campos del composition no los ESCRIBE nadie:");
  for (const c of huerfanos) console.error(`    ${c}`);
  console.error("");
  console.error("  Los build-*.mjs no cuentan: reenvían (`campo: project.campo || []`),");
  console.error("  así que el composition recibe el default vacío y el efecto no existe.");
  console.error("  Sin error, sin test rojo, sin render roto: el video sale sin el efecto.");
  console.error("");
  console.error("  O lo cableás a un enricher / al pipeline de Python, o lo sacás del");
  console.error("  esquema. Si se llena por una vía que este guardián no puede leer,");
  console.error("  agregalo a EXENTOS con el motivo.");
  process.exit(1);
}

console.log("");
console.log("✓ Todo campo del composition tiene al menos un sitio que lo enciende.");
