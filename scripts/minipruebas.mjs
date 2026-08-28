/**
 * Mini-pruebas contra las APIs REALES: Giphy, Pexels y los endpoints locales.
 *
 * No usa mocks a proposito. Lo que hay que saber antes de producir en volumen es
 * si las claves valen, si las busquedas devuelven material y si los endpoints
 * responden — y eso un mock no lo contesta nunca.
 *
 * Lee las claves de frontend/.env.local, igual que la app.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = process.argv[2];
const ENV = path.join(RAIZ, "frontend", ".env.local");

const env = {};
for (const linea of readFileSync(ENV, "utf-8").split(/[\r\n]+/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const resultados = [];
function anotar(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  console.log(`  ${ok ? "OK  " : "FALLA"}  ${nombre}${detalle ? " — " + detalle : ""}`);
}

async function conTimeout(url, ms = 20000, headers = undefined) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal, headers });
  } finally {
    clearTimeout(t);
  }
}

// Pexels autentica por cabecera `Authorization`, no por query string. La primera
// version de esta prueba no la mandaba y reportaba "401 en videos, 200 en
// fotos" — un resultado imposible con la misma clave, que delataba el fallo en
// la prueba y no en la API. Sin cabecera, Pexels responde de forma inconsistente
// segun el endpoint, asi que el error se leia como un problema del producto.
const auth = () => ({ Authorization: env.PEXELS_API_KEY ?? "" });

// ── GIPHY ───────────────────────────────────────────────────────────────────
console.log("\n=== GIPHY ===");
const gkey = env.GIPHY_API_KEY;
if (!gkey) {
  anotar("clave GIPHY_API_KEY", false, "no esta en .env.local");
} else {
  anotar("clave GIPHY_API_KEY", true, `${gkey.slice(0, 6)}… (${gkey.length} chars)`);
  // Consultas en ESPANOL, que es lo que de verdad va a mandar el pipeline.
  for (const q of ["ventas", "dinero", "reunion de trabajo", "exito"]) {
    try {
      const p = new URLSearchParams({
        api_key: gkey, q, limit: "25", lang: "es", rating: "pg-13",
        bundle: "clips_grid_picker",
      });
      const r = await conTimeout(`https://api.giphy.com/v1/gifs/search?${p}`);
      if (!r.ok) { anotar(`buscar "${q}"`, false, `HTTP ${r.status}`); continue; }
      const d = await r.json();
      const items = d.data ?? [];
      const conMp4 = items.filter(
        (it) => it.images?.original?.mp4 || it.images?.downsized_medium?.mp4
      );
      anotar(
        `buscar "${q}"`,
        conMp4.length > 0,
        `${items.length} resultados, ${conMp4.length} con MP4`
      );
    } catch (e) {
      anotar(`buscar "${q}"`, false, String(e).slice(0, 80));
    }
  }
}

// ── PEXELS ──────────────────────────────────────────────────────────────────
console.log("\n=== PEXELS ===");
const pkey = env.PEXELS_API_KEY;
if (!pkey) {
  anotar("clave PEXELS_API_KEY", false, "no esta en .env.local");
} else {
  anotar("clave PEXELS_API_KEY", true, `${pkey.slice(0, 6)}… (${pkey.length} chars)`);
  for (const [tipo, url] of [
    ["videos verticales", "https://api.pexels.com/videos/search?query=business&orientation=portrait&per_page=5"],
    ["fotos verticales", "https://api.pexels.com/v1/search?query=business&orientation=portrait&per_page=5"],
  ]) {
    try {
      const r = await conTimeout(url, 20000, auth());
      if (!r.ok) { anotar(tipo, false, `HTTP ${r.status}`); continue; }
      const d = await r.json();
      const n = (d.videos ?? d.photos ?? []).length;
      anotar(tipo, n > 0, `${n} resultados`);
    } catch (e) {
      anotar(tipo, false, String(e).slice(0, 80));
    }
  }
  // Cuota restante: si esta agotada, el B-roll deja de aparecer sin decir por que.
  try {
    const r = await conTimeout(
      "https://api.pexels.com/videos/search?query=test&per_page=1", 20000, auth()
    );
    const restantes = r.headers.get("x-ratelimit-remaining");
    const limite = r.headers.get("x-ratelimit-limit");
    anotar("cuota de Pexels", restantes === null || Number(restantes) > 0,
      restantes ? `${restantes} de ${limite} restantes` : "sin cabecera de cuota");
  } catch (e) {
    anotar("cuota de Pexels", false, String(e).slice(0, 80));
  }
}

// ── ENDPOINTS LOCALES ───────────────────────────────────────────────────────
console.log("\n=== ENDPOINTS LOCALES ===");
const BASE = "http://localhost:3000";
const rutas = [
  ["catalogo de videos", "/api/projects"],
  ["marcas de publicacion", "/api/publicado"],
  ["muestras de B-roll", "/api/broll/muestras?consulta=ventas"],
  ["diagnostico", "/api/doctor"],
];
for (const [nombre, ruta] of rutas) {
  try {
    const r = await conTimeout(BASE + ruta, 45000);
    let extra = `HTTP ${r.status}`;
    if (r.ok) {
      const d = await r.json().catch(() => null);
      if (d) {
        if (Array.isArray(d)) extra += `, ${d.length} elementos`;
        else if (d.projects) extra += `, ${d.projects.length} videos`;
        else if (d.videos) extra += `, ${Object.keys(d.videos).length} con marcas`;
        else if (d.muestras) extra += `, ${Object.keys(d.muestras).length} fuentes`;
      }
    }
    anotar(nombre, r.ok, extra);
  } catch (e) {
    anotar(nombre, false, String(e).slice(0, 80));
  }
}

// ── RESUMEN ─────────────────────────────────────────────────────────────────
const fallan = resultados.filter((r) => !r.ok);
console.log(`\n=== RESUMEN: ${resultados.length - fallan.length}/${resultados.length} OK ===`);
if (fallan.length) {
  for (const f of fallan) console.log(`  FALLA: ${f.nombre} — ${f.detalle}`);
}
process.exit(fallan.length ? 1 : 0);
