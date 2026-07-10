/**
 * RENDER-SERVER (OLA 2 — edición ULTRA rápida)
 * ────────────────────────────────────────────────────────────────────────────
 * Proceso Node de larga vida que evita el costo de re-bundlear con webpack en
 * CADA render (15-40s perdidos por render con `npx remotion render`).
 *
 * QUÉ HACE:
 *   1. Corre `bundle()` UNA sola vez y cachea el resultado (dir del bundle).
 *      El bundle se invalida sólo si cambia el código Remotion: usamos un hash
 *      del mtime de `src/` (+ index.ts). Si nada cambió, se reusa el bundle.
 *   2. Escucha pedidos por STDIN en formato JSON-lines (una petición por línea).
 *   3. Por cada pedido hace `selectComposition()` (respeta el calculateMetadata
 *      de Root.tsx: duración/dimensiones dinámicas desde props) + `renderMedia()`
 *      con el MISMO cache de OffthreadVideo, concurrency y timeout que el camino
 *      `npx remotion render` actual. Devuelve la ruta del .mp4 por STDOUT.
 *
 * PROTOCOLO (JSON-lines, stdin → stdout):
 *   Petición  : {"id":"<reqId>","propsPath":"<abs .json>","outPath":"<abs .mp4>",
 *                "concurrency":8,"timeoutMs":120000,"scale":1,"offthreadCacheBytes":<n>}
 *   Respuesta : {"type":"result","id":"<reqId>","ok":true,"outPath":"..."}
 *               {"type":"result","id":"<reqId>","ok":false,"error":"..."}
 *   Listo     : {"type":"ready"}  (una vez que el bundle está armado)
 *   Progreso  : {"type":"progress","id":"<reqId>","renderedFrames":N,"totalFrames":M}
 *
 * IMPORTANTE: este server es una OPTIMIZACIÓN opt-in. El caller SIEMPRE debe
 * tener el fallback al `npx remotion render` probado. Si este proceso falla por
 * cualquier motivo, el caller cae al camino viejo. No introduce post-encode ni
 * mastering: eso lo sigue haciendo el caller sobre el .mp4 que este server
 * devuelve (idéntico al que produce `npx remotion render`).
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { readFileSync, statSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(__dirname, "src", "index.ts");
const COMPOSITION_ID = "ViralVideo";

// ── Perfil de hardware (hw_profile.py lo escribe en DATA_ROOT/cache/hw_profile.json).
//    Leemos SOLO `recommend` para pasar valores explícitos a Remotion:
//      • x264Preset/crf  → encode x264 más rápido a igual calidad (#4/#5).
//      • chromium_gl     → "angle" opt-in (#3); null = comportamiento actual.
//    Si el JSON no existe / está corrupto / le faltan campos → null por campo, y
//    Remotion usa sus defaults de siempre (camino viejo intacto).
const PRESET_WHITELIST = new Set([
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow", "placebo",
]);
const GL_WHITELIST = new Set([
  "angle", "angle-egl", "egl", "swangle", "swiftshader", "vulkan",
]);

function dataRoot() {
  const override = process.env.VIRAL_DATA_ROOT;
  if (override) return override;
  // Paridad con paths.ts / config.py: viral-data primero, hermes-data por compat.
  return "C:\\viral-data\\videos";
}

let _hwRec = null; // memo por proceso del bloque `recommend`
function hwRecommend() {
  if (_hwRec !== null) return _hwRec;
  _hwRec = {};
  try {
    const p = path.join(dataRoot(), "cache", "hw_profile.json");
    const j = JSON.parse(readFileSync(p, "utf-8"));
    if (j && typeof j === "object" && j.recommend && typeof j.recommend === "object") {
      _hwRec = j.recommend;
    }
  } catch {
    /* sin perfil → defaults de Remotion */
  }
  return _hwRec;
}

/** Preset x264 recomendado, validado contra la whitelist. null si no aplica. */
function recommendedX264Preset() {
  const v = hwRecommend().x264_preset;
  return typeof v === "string" && PRESET_WHITELIST.has(v) ? v : null;
}
/** CRF recomendado (entero válido). null si no aplica → Remotion usa su default. */
function recommendedCrf() {
  const v = hwRecommend().x264_crf;
  return Number.isInteger(v) && v >= 0 && v <= 51 ? v : null;
}
/** Backend GL para Chromium. "angle" sólo si hw_profile lo recomienda (opt-in). */
function recommendedGl() {
  const v = hwRecommend().chromium_gl;
  return typeof v === "string" && GL_WHITELIST.has(v) ? v : null;
}
// Permite forzar el respawn SIN angle tras un fallo de angle (lo set-ea el caller
// por env al relanzar). Si está, ignoramos el gl recomendado.
function effectiveGl() {
  if (process.env.VIRAL_RENDER_SERVER_NO_ANGLE === "1") return null;
  return recommendedGl();
}

// ── Línea de salida estructurada (una por línea, JSON). Los logs informativos
//    van a stderr para no contaminar el canal de respuestas (stdout). ──────────
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function logErr(...a) {
  process.stderr.write("[render-server] " + a.join(" ") + "\n");
}

// ── Cache de OffthreadVideo por defecto (paridad con render-utils.ts) ─────────
function defaultOffthreadCacheBytes() {
  const thirtyFive = Math.floor(os.totalmem() * 0.35);
  return Math.max(512 * 1024 * 1024, Math.min(thirtyFive, 6 * 1024 * 1024 * 1024));
}
function defaultConcurrency() {
  const fromEnv = Number(process.env.VIRAL_REMOTION_CONCURRENCY);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  // Sube de 8 a 16: la rasterización en CPU es el cuello y con el cache grande de
  // OffthreadVideo ya no se ahoga el stream. En PC de muchos núcleos ≈ 2x.
  return Math.min(16, Math.max(1, os.cpus().length - 2));
}

// ── Hash barato del estado de src/ (mtime recursivo). Si cambia, re-bundleamos.
//    Recorre src/ + index.ts; suma mtimeMs. No necesita ser criptográfico: sólo
//    detectar "el código cambió desde que armamos el bundle". ──────────────────
function srcFingerprint() {
  const root = path.join(__dirname, "src");
  let acc = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(full);
      } else {
        try {
          acc = (acc + Math.floor(statSync(full).mtimeMs)) >>> 0;
        } catch {
          /* archivo borrado en carrera: ignorar */
        }
      }
    }
  };
  walk(root);
  return acc;
}

let bundlePromise = null; // Promise<string> del dir del bundle
let bundledFingerprint = null;
let renderCount = 0; // renders completados con éxito en este proceso (para reciclado)

async function getBundle() {
  const fp = srcFingerprint();
  // Si ya tenemos un bundle con el mismo fingerprint, reusarlo.
  if (bundlePromise && bundledFingerprint === fp) {
    return bundlePromise;
  }
  // Código cambió (o primer bundle): re-bundlear.
  bundledFingerprint = fp;
  logErr(`bundling (fingerprint=${fp})…`);
  const t0 = Date.now();
  bundlePromise = bundle({
    entryPoint: ENTRY,
    // webpackOverride por defecto (remotion.config.ts no se aplica a la API
    // programática, pero la config relevante de este proyecto es el entry).
    onProgress: () => {},
  }).then((dir) => {
    logErr(`bundle listo en ${((Date.now() - t0) / 1000).toFixed(1)}s → ${dir}`);
    return dir;
  });
  // Si el bundle falla, limpiar para reintentar en el próximo pedido.
  bundlePromise.catch((err) => {
    logErr("bundle falló:", String(err));
    bundlePromise = null;
    bundledFingerprint = null;
  });
  return bundlePromise;
}

async function handleRequest(req) {
  const { id, propsPath, outPath } = req;
  if (!id || !propsPath || !outPath) {
    emit({ type: "result", id: id ?? null, ok: false, error: "faltan id/propsPath/outPath" });
    return;
  }
  try {
    const inputProps = JSON.parse(readFileSync(propsPath, "utf-8"));
    const serveUrl = await getBundle();

    // gl=angle (opt-in) también se pasa a selectComposition para que el browser
    // headless que abre el calculateMetadata use el mismo backend. null → no se pasa.
    const gl = effectiveGl();
    // disableWebSecurity: SIEMPRE. Los layers audio-reactivos (audiogram + fondos
    // animatedBackground.audioReactive de motion_*/kinetic_type/lottie_pop) usan
    // useWindowedAudioData/visualizeAudio, que hacen fetch CLIENT-SIDE del audio. En el
    // render el bundle de Remotion vive en su propio puerto (≠ el server del API que
    // sirve /api/.../stream), así que ese fetch es cross-origin y sin este flag CORS lo
    // bloquea → el render de esos estilos FALLA ("Failed to fetch"). Música/video usan
    // <Audio>/<OffthreadVideo> (fetch server-side, sin CORS) → por eso NO se veía antes.
    const chromiumOptions = { disableWebSecurity: true, ...(gl ? { gl } : {}) };

    // selectComposition respeta calculateMetadata (duración/dims dinámicas).
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      ...(chromiumOptions ? { chromiumOptions } : {}),
    });

    const concurrency = Number.isFinite(req.concurrency) ? req.concurrency : defaultConcurrency();
    const offthreadBytes = Number.isFinite(req.offthreadCacheBytes)
      ? req.offthreadCacheBytes
      : defaultOffthreadCacheBytes();
    const timeoutMs = Number.isFinite(req.timeoutMs) ? req.timeoutMs : 120_000;
    const scale = Number.isFinite(req.scale) ? req.scale : 1;

    // Preset/CRF explícitos del hw_profile. Sin el JSON, quedan null y NO se pasan
    // → Remotion usa su default ('medium'), exactamente como antes (camino viejo).
    const x264Preset = recommendedX264Preset();
    const crf = recommendedCrf();

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      concurrency,
      // Paridad con el flag --offthreadvideo-cache-size-in-bytes del camino viejo.
      offthreadVideoCacheSizeInBytes: offthreadBytes,
      // Paridad con --timeout (delayRender) del camino viejo.
      timeoutInMilliseconds: timeoutMs,
      scale,
      // #4/#5 — preset x264 explícito (más rápido, misma calidad a igual CRF).
      ...(x264Preset ? { x264Preset } : {}),
      ...(crf !== null ? { crf } : {}),
      // #3 — gl=angle opt-in. Si null, no se pasa (swiftshader/swangle de siempre).
      ...(chromiumOptions ? { chromiumOptions } : {}),
      onProgress: ({ renderedFrames }) => {
        emit({
          type: "progress",
          id,
          renderedFrames,
          totalFrames: composition.durationInFrames,
        });
      },
    });

    // Contador de renders para el reciclado del proceso (memory-leak de angle en
    // procesos largos). El caller decide cuándo respawnear según renderCount/gl.
    renderCount += 1;
    emit({ type: "result", id, ok: true, outPath, renderCount, gl: gl ?? null });
  } catch (err) {
    emit({
      type: "result",
      id,
      ok: false,
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
    });
  }
}

// ── Serializamos los pedidos: un solo render a la vez (igual que el camino
//    actual, que toma un lock por video). Encolamos si llegan varios. ──────────
let chain = Promise.resolve();
function enqueue(req) {
  chain = chain.then(() => handleRequest(req)).catch((err) => logErr("handler error:", String(err)));
}

async function main() {
  // Pre-bundlear al arrancar para que el primer render ya encuentre el bundle.
  try {
    await getBundle();
    // Informamos el gl efectivo: el caller lo usa para decidir la agresividad del
    // reciclado (con angle activo recicla más seguido por el memory-leak conocido).
    emit({ type: "ready", gl: effectiveGl() ?? null });
  } catch (err) {
    // Si el bundle inicial falla, avisamos: el caller hará fallback al camino viejo.
    emit({ type: "fatal", error: String(err) });
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed === "ping") {
      emit({ type: "pong" });
      return;
    }
    if (trimmed === "shutdown") {
      process.exit(0);
    }
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      emit({ type: "result", id: null, ok: false, error: "JSON inválido en la petición" });
      return;
    }
    enqueue(req);
  });
  // Si el caller cierra stdin (mató el pipe), salir limpio.
  rl.on("close", () => process.exit(0));
}

main().catch((err) => {
  logErr("fatal:", String(err));
  process.exit(1);
});
