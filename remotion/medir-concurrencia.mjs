/**
 * Barrido de concurrencia CONTRA EL POOL REAL (render-server.mjs).
 *
 * La medicion anterior se hizo con `npx remotion render` directo, que re-empaqueta
 * el bundle en cada corrida. Eso mete un costo fijo grande e igual en todas las
 * mediciones, que diluye la diferencia que se quiere medir. El pool arma el
 * bundle UNA vez y despues solo renderiza — es el camino de produccion.
 *
 * Se mide cada valor dos veces y se toma la mejor: el render no es determinista y
 * una sola corrida puede caer en un momento malo de la maquina.

 *
 * USO
 *   1. Arma los props de un clip real:
 *        node build-clip-props.mjs <clip_id> <estilo>
 *   2. Corre el barrido (el 2do argumento es la lista, el 3ro las repeticiones):
 *        node medir-concurrencia.mjs . props.json salida.mp4 "3,6,8,10,12" 2
 *   3. Si el optimo no es el que da hw_profile.py, ajusta la formula ahi
 *      y deja los numeros medidos en el comentario, como estan los de ahora.
 *
 * Tarda: cada valor x cada repeticion es un render entero. Con 5 valores y 2
 * repeticiones sobre un clip de 47 s fueron ~20 minutos.
 */
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REMOTION = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = process.argv[2];
const PROPS = process.argv[3];
const SALIDA = process.argv[4];
const VALORES = (process.argv[5] || "3,6,8,12").split(",").map(Number);
const REPES = Number(process.argv[6] || 2);

function arrancar() {
  return new Promise((resolve, reject) => {
    const p = spawn("node", ["render-server.mjs"], {
      cwd: DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let listo = false;
    p.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const linea = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linea) continue;
        let msg;
        try {
          msg = JSON.parse(linea);
        } catch {
          continue;
        }
        if (msg.type === "ready" && !listo) {
          listo = true;
          resolve({ proc: p, pendientes });
        } else if (msg.type === "result") {
          const f = pendientes.get(msg.id);
          if (f) {
            pendientes.delete(msg.id);
            f(msg);
          }
        }
      }
    });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d.toString();
    });
    p.on("exit", (c) => {
      if (!listo) reject(new Error(`el server salio con ${c}: ${err.slice(-500)}`));
    });
    const pendientes = new Map();
  });
}

function pedir(proc, pendientes, req) {
  return new Promise((resolve) => {
    pendientes.set(req.id, resolve);
    proc.stdin.write(JSON.stringify(req) + "\n");
  });
}

const { proc, pendientes } = await arrancar();
console.log("  bundle armado, el server esta listo\n");
console.log(`  ${"concurrency".padEnd(13)}${"mejor".padStart(9)}${"peor".padStart(9)}`);
console.log("  " + "-".repeat(31));

const filas = [];
for (const c of VALORES) {
  const tiempos = [];
  for (let r = 0; r < REPES; r++) {
    if (existsSync(SALIDA)) unlinkSync(SALIDA);
    const t0 = process.hrtime.bigint();
    const res = await pedir(proc, pendientes, {
      id: `c${c}r${r}`,
      propsPath: PROPS,
      outPath: SALIDA,
      concurrency: c,
      timeoutMs: 900000,
      scale: 1,
    });
    const seg = Number(process.hrtime.bigint() - t0) / 1e9;
    if (!res.ok) {
      console.log(`  concurrency ${c}: FALLO — ${String(res.error).slice(0, 90)}`);
      tiempos.length = 0;
      break;
    }
    tiempos.push(seg);
  }
  if (!tiempos.length) continue;
  const mejor = Math.min(...tiempos);
  const peor = Math.max(...tiempos);
  filas.push({ c, mejor, peor });
  console.log(
    `  ${String(c).padEnd(13)}${mejor.toFixed(1).padStart(8)}s${peor.toFixed(1).padStart(8)}s`,
  );
}

proc.stdin.end();
proc.kill();

if (filas.length > 1) {
  const base = filas[0];
  const top = filas.reduce((a, b) => (b.mejor < a.mejor ? b : a));
  console.log(
    `\n  El mejor es concurrency ${top.c}: ${top.mejor.toFixed(1)}s contra ` +
      `${base.mejor.toFixed(1)}s de concurrency ${base.c} — ` +
      `${(((base.mejor - top.mejor) / base.mejor) * 100).toFixed(1)} % menos.`,
  );
}
