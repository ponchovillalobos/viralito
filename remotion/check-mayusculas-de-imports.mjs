/**
 * check-mayusculas-de-imports.mjs — que los imports funcionen en Linux.
 *
 * Windows y macOS no distinguen mayúsculas en los nombres de archivo; Linux sí.
 * Un `import "@/lib/Paths"` cuando el archivo es `paths.ts` funciona perfecto en
 * la máquina de desarrollo y revienta en el runner de CI, con un error que
 * habla de un módulo que "no existe" aunque esté ahí delante.
 *
 * Este verificador compara cada import contra el nombre REAL en disco, letra por
 * letra, leyendo el directorio en vez de preguntar si el archivo existe —
 * `existsSync` sobre Windows contesta que sí aunque la caja no coincida, que es
 * justo lo que hace invisible al problema.
 *
 * Se escribió persiguiendo un CI que llevaba doce corridas en rojo con las
 * suites verdes en local. Ver `memoria/trampas/en-mi-maquina-pasa-no-es-una-verificacion`.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const SRC = path.join(REPO, "frontend", "src");
const ALIAS = { "@/": SRC + path.sep };

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];

function archivos(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      archivos(p, acc);
    } else if (/\.(ts|tsx|mjs)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** ¿El nombre existe en su carpeta CON ESTA caja exacta? */
function cajaExacta(destino) {
  const dir = path.dirname(destino);
  const base = path.basename(destino);
  if (!existsSync(dir)) return false;
  let hermanos;
  try {
    hermanos = readdirSync(dir);
  } catch {
    return false;
  }
  if (hermanos.includes(base)) return true;
  // Está pero con otra caja: eso es el defecto que buscamos.
  const parecido = hermanos.find((h) => h.toLowerCase() === base.toLowerCase());
  return parecido ? { real: parecido } : false;
}

/** Resuelve un especificador a la ruta que Node/TS buscaría. */
function resolver(desde, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ALIAS["@/"], spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(desde), spec);
  else return null; // paquete de node_modules: no es cosa nuestra

  const candidatos = [base, ...EXTS.map((e) => base + e)];
  if (existsSync(base) && statSync(base).isDirectory()) {
    candidatos.push(...EXTS.map((e) => path.join(base, "index" + e)));
  }
  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const IMPORTS = /(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

const fallos = [];
let revisados = 0;

for (const f of archivos(SRC)) {
  const src = readFileSync(f, "utf-8");
  for (const m of src.matchAll(IMPORTS)) {
    const spec = m[1] || m[2];
    if (!spec || (!spec.startsWith(".") && !spec.startsWith("@/"))) continue;
    const destino = resolver(f, spec);
    if (!destino) continue; // lo resuelve TS por otra vía; no es este chequeo
    revisados++;

    // Se comprueba cada tramo de la ruta, no sólo el archivo: una CARPETA con
    // otra caja rompe igual en Linux.
    let cursor = destino;
    while (cursor.startsWith(SRC) && cursor !== SRC) {
      const r = cajaExacta(cursor);
      if (r !== true) {
        fallos.push({
          archivo: path.relative(REPO, f),
          spec,
          esperado: path.basename(cursor),
          real: r && r.real ? r.real : "(no está)",
        });
        break;
      }
      cursor = path.dirname(cursor);
    }
  }
}

console.log("Mayúsculas de los imports (lo que Linux sí distingue)");
console.log(`  ${revisados} imports internos resueltos y comparados con el disco\n`);

if (fallos.length) {
  console.error(`✗ ${fallos.length} import(s) que fallarían en Linux:\n`);
  for (const f of fallos) {
    console.error(`  ${f.archivo}`);
    console.error(`    importa "${f.spec}" -> busca "${f.esperado}", en disco es "${f.real}"`);
  }
  process.exit(1);
}

console.log("✓ Todos los imports internos coinciden en mayúsculas con el disco.");
