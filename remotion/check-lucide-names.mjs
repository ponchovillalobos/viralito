/**
 * Valida que los nombres de íconos Lucide usados por el generador editorial
 * (python/generate_graphics.py) existan de verdad en la versión instalada de
 * lucide-react. Un nombre con typo renderiza NADA (LineArtLucide devuelve null)
 * → tarjeta sin ilustración en silencio.
 *
 * Uso:  node check-lucide-names.mjs nombres.json   (array JSON de nombres kebab)
 *       node check-lucide-names.mjs                (valida el pool del .py via regex)
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function toPascal(name) {
  return name.split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

let names;
if (process.argv[2]) {
  names = JSON.parse(readFileSync(process.argv[2], "utf-8"));
} else {
  // Extraer todos los strings kebab de _LUCIDE_POOL y los valores de vocabulario del .py
  const py = readFileSync(path.join(__dirname, "..", "python", "generate_graphics.py"), "utf-8");
  const m = py.match(/_LUCIDE_POOL\s*=\s*\[([\s\S]*?)\]/);
  if (!m) {
    console.error("no encontré _LUCIDE_POOL en generate_graphics.py");
    process.exit(1);
  }
  names = [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]);
}

// Los 28 dibujados a mano NO son lucide — se excluyen de la validación.
const HAND_DRAWN = new Set([
  "clock", "calendar", "funnel", "faucet", "radar", "chart", "lightbulb", "target",
  "rocket", "brain", "lock", "megaphone", "scale", "gears", "trophy", "route",
  "fire", "hourglass", "money", "diamond", "eye", "mountain", "magnet", "compass",
  "network", "shield", "coin", "heart",
]);

const bad = [];
const ok = [];
for (const n of names) {
  if (HAND_DRAWN.has(n)) { ok.push(n); continue; }
  if (Lucide[toPascal(n)]) ok.push(n);
  else bad.push(n);
}
console.log(`validados: ${ok.length} OK · ${bad.length} INVÁLIDOS`);
if (bad.length) {
  console.log("INVÁLIDOS (no existen en lucide-react):");
  for (const b of bad) console.log("  -", b);
  process.exit(1);
}
