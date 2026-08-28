/**
 * anotar-fallos-de-vitest.mjs — que CI pueda contar qué falló, sin ser admin.
 *
 * Los logs de GitHub Actions exigen permisos de administrador del repositorio.
 * Quien no los tiene ve que el paso falló y nada más: ni qué test, ni por qué.
 * Perseguir un CI rojo así es adivinar.
 *
 * Las ANOTACIONES sí se leen sin permisos especiales. Este guion toma el informe
 * JSON de vitest y emite una anotación `::error::` por cada test caído, con su
 * archivo y su mensaje. Así el fallo se lee desde fuera:
 *
 *   GET /repos/{owner}/{repo}/check-runs/{id}/annotations
 *
 * Uso (en el paso `if: failure()` del workflow):
 *   npx vitest run --reporter=json --outputFile=vitest.json || true
 *   node ../remotion/anotar-fallos-de-vitest.mjs frontend/vitest.json
 */
import { readFileSync, existsSync } from "node:fs";

const ruta = process.argv[2];

if (!ruta || !existsSync(ruta)) {
  console.log(`::error::No se genero el informe de vitest (${ruta ?? "sin ruta"}).`);
  process.exit(0); // no enmascarar el fallo original con uno propio
}

let informe;
try {
  informe = JSON.parse(readFileSync(ruta, "utf-8"));
} catch (e) {
  console.log(`::error::El informe de vitest no es JSON valido: ${e.message}`);
  process.exit(0);
}

const caidos = [];
for (const archivo of informe.testResults ?? []) {
  for (const t of archivo.assertionResults ?? []) {
    if (t.status !== "failed") continue;
    caidos.push({
      archivo: archivo.name ?? "(archivo desconocido)",
      titulo: [...(t.ancestorTitles ?? []), t.title].join(" > "),
      // Los mensajes traen colores ANSI y saltos de linea; una anotacion es una
      // sola linea, asi que se aplana.
      mensaje: (t.failureMessages ?? [])
        .join(" | ")
        .replace(/\[[0-9;]*m/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 700),
    });
  }
}

if (!caidos.length) {
  console.log("::error::vitest fallo pero el informe no lista ningun test caido.");
  console.log("::error::Suele ser un error al CARGAR un archivo de test (import roto,");
  console.log("::error::modulo que no resuelve) y no un assert. Mira el paso anterior.");
  process.exit(0);
}

console.log(`::error::${caidos.length} test(s) caidos:`);
for (const c of caidos) {
  console.log(`::error file=${c.archivo}::${c.titulo} — ${c.mensaje}`);
}
