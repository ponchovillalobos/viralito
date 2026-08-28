/**
 * Que TODOS los iconos que el generador puede elegir se dibujen de verdad.
 *
 * `generate_graphics.py` elige un icono acorde a lo que se dice en cada momento.
 * Ese trabajo sólo llega a la pantalla si el motor de render sabe resolver el
 * nombre — y durante mucho tiempo no supo: `ICON_MAP` tenía 30 entradas escritas
 * a mano contra 253 nombres que el generador puede emitir. **233 (el 92 %) se
 * dibujaban como una chispa genérica.**
 *
 * No fallaba nada. El video salía, con el icono equivocado, y la única forma de
 * notarlo era mirar un render con atención sabiendo qué buscar.
 *
 * `check-lucide-names.mjs` (el que ya existía) valida que los nombres EXISTAN en
 * lucide. Este valida algo distinto: que el render los RESUELVA. Los dos hacen
 * falta — el primero atrapa un typo, éste atrapa un mapa que se quedó corto.
 *
 * Uso:  node check-icon-coverage.mjs
 */
// `lucide-react` vive en remotion/node_modules. Si falta, Node tira un
// ERR_MODULE_NOT_FOUND crudo, con un volcado de pila y sin decir que hacer — que
// es como se veia el fallo de CI que tuvo este repo doce corridas en rojo.
let Lucide;
try {
  Lucide = await import("lucide-react");
} catch (e) {
  console.error("Falta `lucide-react`, que este verificador necesita para saber");
  console.error("que iconos existen de verdad.");
  console.error("");
  console.error("  cd remotion && npm ci");
  console.error("");
  console.error("Ojo si esto pasa en CI: `npm test` de frontend encadena");
  console.error("verificadores que viven en remotion/, asi que las dependencias de");
  console.error("remotion tienen que instalarse ANTES de correrlo.");
  console.error("");
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));

function aPascal(n) {
  return n.split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

// Nombres curados del mapa (permiten alias que no son nombres de lucide).
const src = readFileSync(path.join(aqui, "src", "icon-map.ts"), "utf-8");
const bloque = src.slice(src.indexOf("ICON_MAP: Record"), src.indexOf("/** Fallback"));
const curados = new Set([...bloque.matchAll(/([a-z0-9_]+):\s*[A-Z]/g)].map((m) => m[1]));

// El pool real del generador, leído de su propio código.
const py = readFileSync(path.join(aqui, "..", "python", "generate_graphics.py"), "utf-8");
const listas = ["_FALLBACK_ICONS", "_LUCIDE_POOL"];
const pool = [];
for (const nombre of listas) {
  const i = py.indexOf(`${nombre} = [`);
  if (i < 0) continue;
  const fin = py.indexOf("]", i);
  for (const m of py.slice(i, fin).matchAll(/"([a-z][a-z0-9-]+)"/g)) pool.push(m[1]);
}
const unicos = [...new Set(pool)];

const sinResolver = unicos.filter((n) => !curados.has(n) && !Lucide[aPascal(n)]);

if (sinResolver.length) {
  console.error(
    `FALLA: ${sinResolver.length} de ${unicos.length} iconos del generador no se ` +
      `resuelven y se dibujarian como el icono generico:\n  ${sinResolver.join(", ")}\n\n` +
      `Agregalos al ICON_MAP curado de src/icon-map.ts (si son alias) o corregi el ` +
      `nombre en generate_graphics.py (si es un typo).`
  );
  process.exit(1);
}
console.log(`cobertura de iconos: ${unicos.length}/${unicos.length} se resuelven`);
