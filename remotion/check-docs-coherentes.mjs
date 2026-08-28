/**
 * check-docs-coherentes.mjs — la documentación tiene que decir la verdad.
 *
 * Comprueba que las CUENTAS que afirman los documentos vivos ("25 estilos",
 * "23 temas editoriales") coincidan con lo que el código tiene hoy.
 *
 * Existe por un pedido explícito: "todos estos problemas es porque no
 * documentas y no tienes un agente que revise la documentación". Y tenía razón
 * — al escribirlo aparecieron de una: README.md decía 23 estilos y 17 temas
 * cuando son 25 y 23, en seis sitios distintos.
 *
 * QUÉ NO REVISA, a propósito:
 *
 *  - Los documentos FECHADOS (`docs/AUDITORIA-*.md`, `docs/LOOP_LOG.md`). Son
 *    el registro de lo que era cierto ese día. Corregirlos sería falsificar un
 *    acta: si una auditoría de julio dice "23 estilos", eso es lo que había.
 *
 *  - Las líneas de cita (`> ...`). Este repo usa el bloque de cita para dejar
 *    escrito qué decía antes un documento y por qué estaba mal. Esas líneas
 *    CONTIENEN el dato viejo a propósito, y marcarlas convertiría la costumbre
 *    de explicarse en un error.
 *
 *  - Lo que depende del disco de cada quien (cuántos SFX, cuántos renders). En
 *    otra máquina el número es otro sin que nada esté mal. Se listan al final
 *    como información, sin hacer fallar.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

// ── Verdad de terreno, leída del código ──────────────────────────────────────
const registro = JSON.parse(
  readFileSync(path.join(REPO, "frontend/src/lib/style-registry.data.json"), "utf-8"),
);
const estilos = (Array.isArray(registro) ? registro : registro.styles).length;

const temasSrc = readFileSync(
  path.join(REPO, "frontend/src/lib/editorial-themes.ts"),
  "utf-8",
);
const temas = [...temasSrc.matchAll(/\bid:\s*"([a-z_0-9]+)"/g)].length;

/**
 * Cada afirmación: cómo se escribe en los documentos y cuánto vale de verdad.
 * El patrón lleva un grupo con el número.
 */
const AFIRMACIONES = [
  {
    nombre: "estilos visuales",
    real: estilos,
    // Los asteriscos de markdown se meten entre el número y la palabra. La
    // primera versión pedía número + espacio + palabra, y por eso se le escapó
    // justo la cuenta mal de CLAUDE.md, escrita como "**20** temas editoriales".
    patron: /(\d+)\*{0,2}\s+\*{0,2}estilos\b/gi,
    // "estilo" tambien se usa para los sets de ilustracion de DiceBear, que son
    // otra cuenta distinta ("listaba 23 estilos sacados de la pagina de
    // documentacion"). Si la linea habla de eso, no es esta afirmacion.
    ignorarSi: /ilustraci|dicebear|descargador|avatar/i,
    fuente: "frontend/src/lib/style-registry.data.json",
  },
  {
    // "temas" a secas es ambiguo en estos documentos: hay 54 temas de MÚSICA de
    // FreePD y 4 temas de FUENTE (`FONT_THEMES`), que no son esto. La primera
    // versión de este patrón los marcaba a los tres y habría empujado a
    // "corregir" números que estaban bien. Se exige la palabra completa.
    nombre: "temas editoriales",
    real: temas,
    patron: /(\d+)\*{0,2}\s+\*{0,2}temas\s+editoriales?\b/gi,
    fuente: "frontend/src/lib/editorial-themes.ts",
  },
];

// ── Qué documentos se revisan ────────────────────────────────────────────────
// Un nombre con fecha (`-2026-07`) es un "según lo que sabíamos entonces".
const FECHADOS = /^AUDITORIA-|^LOOP_LOG\.md$|^QUALITY_SCORECARD\.md$|-20\d\d-\d\d/;

/**
 * Un número junto a la palabra no siempre es un inventario.
 *
 *   "2-3 temas editoriales nuevos cada mes"  -> es un RITMO, no una cuenta
 *   "sumamos 3 temas editoriales"            -> es un INCREMENTO
 *
 * Marcarlos empujaría a "corregir" frases que están perfectas. Se mira lo que
 * rodea al número: un guion antes (rango) o un adjetivo de novedad después.
 */
/**
 * Lo TACHADO (`~~22 estilos~~`) es lo mismo que una línea de cita: se deja
 * escrito el dato viejo para que se entienda qué se corrigió. Marcarlo
 * castigaría justo la costumbre que se quiere premiar — dejar constancia.
 */
function estaTachado(linea, indice) {
  const spans = [...linea.matchAll(/~~[\s\S]*?~~/g)];
  return spans.some((s) => indice >= s.index && indice < s.index + s[0].length);
}

function esUnRitmoNoUnaCuenta(linea, indice, coincidencia) {
  const antes = linea.slice(Math.max(0, indice - 2), indice);
  const despues = linea.slice(indice + coincidencia.length, indice + coincidencia.length + 14);
  return /\d\s*[-–]$/.test(antes) || /^\s*(nuev|mas|más|adicional|extra)/i.test(despues);
}

function documentosVivos() {
  const docs = [];
  for (const f of ["CLAUDE.md", "README.md"]) {
    if (existsSync(path.join(REPO, f))) docs.push(f);
  }
  const dir = path.join(REPO, "docs");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".md") && !FECHADOS.test(f)) docs.push(path.join("docs", f));
    }
  }
  return docs;
}

// ── Revisión ─────────────────────────────────────────────────────────────────
const fallos = [];
let revisadas = 0;

for (const rel of documentosVivos()) {
  const lineas = readFileSync(path.join(REPO, rel), "utf-8").split(/\r?\n/);
  lineas.forEach((linea, i) => {
    // Cita = memoria de lo que decía antes. Lleva el dato viejo a propósito.
    if (/^\s*>/.test(linea)) return;
    for (const a of AFIRMACIONES) {
      if (a.ignorarSi && a.ignorarSi.test(linea)) continue;
      a.patron.lastIndex = 0;
      for (const m of linea.matchAll(a.patron)) {
        if (estaTachado(linea, m.index)) continue;
        if (esUnRitmoNoUnaCuenta(linea, m.index, m[0])) continue;
        revisadas++;
        const dicho = Number(m[1]);
        if (dicho !== a.real) {
          fallos.push({
            donde: `${rel}:${i + 1}`,
            que: a.nombre,
            dicho,
            real: a.real,
            fuente: a.fuente,
            texto: linea.trim().slice(0, 88),
          });
        }
      }
    }
  });
}

console.log("Coherencia de la documentación");
console.log(`  estilos en el registro: ${estilos} · temas editoriales: ${temas}`);
console.log(`  ${revisadas} afirmaciones numéricas revisadas en documentos vivos\n`);

if (fallos.length) {
  console.error(`✗ ${fallos.length} afirmación(es) que ya no son ciertas:\n`);
  for (const f of fallos) {
    console.error(`  ${f.donde}`);
    console.error(`    dice ${f.dicho} ${f.que}, son ${f.real}  (según ${f.fuente})`);
    console.error(`    "${f.texto}"`);
  }
  console.error(
    "\n  Si el número cambió a propósito, actualizá el documento. Si querés dejar\n" +
      "  constancia de lo que decía antes, ponelo en una línea de cita (>) — esas\n" +
      "  no se revisan, justamente para poder explicarse.",
  );
  process.exit(1);
}

console.log("✓ Las cuentas de los documentos coinciden con el código.");
