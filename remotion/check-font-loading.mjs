#!/usr/bin/env node
/**
 * Vigila la regla de carga de fuentes del proyecto.
 *
 * Por que existe: la regla ("nunca `@remotion/google-fonts`, nunca
 * `@remotion/fonts.loadFont`, nunca `delayRender` para una fuente") estaba
 * escrita en CLAUDE.md, en docs y en tres comentarios extensos dentro del
 * propio codigo... y aun asi `ViralVideo.tsx` la violaba: registraba 16 fuentes
 * de forma anticipada con la API prohibida, que es la causa raiz documentada de
 * "los videos no salian" bajo render concurrente.
 *
 * La leccion no fue que faltara documentacion, sino que una regla que solo vive
 * en prosa no se aplica sola. Esto la convierte en algo ejecutable.
 *
 * Uso:  node check-font-loading.mjs
 * Sale con codigo 1 si encuentra una violacion (sirve para CI).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "src");

// El unico modulo autorizado a implementar el registro de fuentes: ahi vive
// `registerLocalFont`, que es el patron correcto (FontFace + add, sin load).
const IMPLEMENTACION = path.join(SRC, "layers", "local-editorial-fonts.ts");

const PROHIBIDO = [
  {
    // Import del paquete de Google Fonts: carga desde gstatic a nivel de modulo.
    re: /from\s+["']@remotion\/google-fonts/,
    que: "importa @remotion/google-fonts",
    porque: "carga desde la red en cada render; sin internet aborta CUALQUIER estilo",
  },
  {
    // loadFont de @remotion/fonts: usa delayRender por dentro.
    re: /from\s+["']@remotion\/fonts["']/,
    que: "importa @remotion/fonts",
    porque: "su loadFont usa delayRender: bajo render concurrente la delayRender no se limpia y Remotion aborta el clip a los 58 s",
  },
  {
    // delayRender asociado a una fuente.
    re: /delayRender\s*\([^)]*(?:font|fuente|Font)/i,
    que: "usa delayRender para una fuente",
    porque: "es exactamente el mecanismo que dejaba clips colgados",
  },
];

/** Recorre src/ devolviendo los .ts y .tsx. */
function fuentes(dir) {
  const out = [];
  for (const entrada of readdirSync(dir)) {
    const p = path.join(dir, entrada);
    if (statSync(p).isDirectory()) out.push(...fuentes(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Quita comentarios: la regla se cita MUCHO en prosa, y citarla no es violarla. */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const violaciones = [];
let revisados = 0;

for (const archivo of fuentes(SRC)) {
  if (path.resolve(archivo) === path.resolve(IMPLEMENTACION)) continue;
  revisados++;
  const codigo = sinComentarios(readFileSync(archivo, "utf8"));
  const rel = path.relative(__dirname, archivo);
  for (const regla of PROHIBIDO) {
    if (!regla.re.test(codigo)) continue;
    const linea = codigo.split("\n").findIndex((l) => regla.re.test(l)) + 1;
    violaciones.push({ rel, linea, ...regla });
  }
}

console.log(`Carga de fuentes — ${revisados} archivos revisados en remotion/src`);

if (violaciones.length === 0) {
  console.log("\n✓ Regla cumplida: ninguna fuente se carga por una via que pueda abortar el render.");
  process.exit(0);
}

console.error(`\n✗ ${violaciones.length} violacion(es) de la regla de carga de fuentes:\n`);
for (const v of violaciones) {
  console.error(`  ${v.rel}:${v.linea}`);
  console.error(`    ${v.que}`);
  console.error(`    ${v.porque}\n`);
}
console.error("  Usa registerLocalFont de src/layers/local-editorial-fonts.ts:");
console.error("  new FontFace + document.fonts.add(), SIN .load() y SIN delayRender.\n");
process.exit(1);
