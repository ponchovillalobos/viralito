/**
 * Cliente del RENDER-SERVER (OLA 2 — edición ULTRA rápida).
 * ────────────────────────────────────────────────────────────────────────────
 * Mantiene VIVO un único proceso `remotion/render-server.mjs` (bundle webpack
 * una sola vez) y le manda pedidos de render por stdin (JSON-lines). Cada render
 * que pasa por acá se ahorra los 15-40s de re-bundle de `npx remotion render`.
 *
 * FALLBACK (no negociable): este módulo es una OPTIMIZACIÓN opt-in. Si el server
 * no arranca, no responde, da timeout o devuelve error, `renderWithServer()`
 * lanza/resuelve en `ok:false` y el caller DEBE caer al camino `npx remotion
 * render` que ya funciona. El camino viejo queda intacto como red de seguridad.
 *
 * Activación: por defecto ENCENDIDO. Se puede apagar con
 *   VIRAL_RENDER_SERVER=0  → siempre usa el camino viejo.
 *
 * El post-encode NVENC, el mastering de audio y el LUT los sigue aplicando el
 * caller sobre el .mp4 que devuelve este server (idéntico al de `npx remotion
 * render`): este módulo NO los toca.
 */
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import os from "node:os";
import readline from "node:readline";
import { REMOTION_DIR } from "@/lib/paths";

/** ¿Está habilitado el render-server? Default sí; `VIRAL_RENDER_SERVER=0` lo apaga. */
export function renderServerEnabled(): boolean {
  return process.env.VIRAL_RENDER_SERVER !== "0";
}

interface PendingRender {
  resolve: (out: string) => void;
  reject: (err: Error) => void;
  onProgress?: (rendered: number, total: number) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ServerMsg {
  type: "ready" | "result" | "progress" | "fatal" | "pong";
  id?: string;
  ok?: boolean;
  outPath?: string;
  error?: string;
  renderedFrames?: number;
  totalFrames?: number;
  /** renders completados por el proceso (para el reciclado). */
  renderCount?: number;
  /** backend GL efectivo del proceso (null = swiftshader/swangle). */
  gl?: string | null;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<string, PendingRender>();

// ── Reciclado del proceso (#3) ───────────────────────────────────────────────
// angle tiene un memory-leak conocido en procesos de larga vida: reciclamos el
// render-server cada N renders. Sin angle (gl=null, swiftshader) el leak es mucho
// menor, así que reciclamos más esporádicamente. El respawn es perezoso: marcamos
// `needsRecycle` y el próximo `ensureServer()` arranca un proceso fresco.
const RECYCLE_EVERY_DEFAULT = 40;
const RECYCLE_EVERY_ANGLE = 25;
let serverGl: string | null = null; // gl del proceso vivo (se llena con el ready)
let needsRecycle = false;
// Si un render con angle falla, el próximo arranque fuerza SIN angle (fallback).
let forceNoAngle = false;

/** Mata el server (al apagar la app o ante un crash) y rechaza lo pendiente. */
function teardown(reason: string) {
  if (proc) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ya muerto */
    }
  }
  proc = null;
  readyPromise = null;
  serverGl = null;
  needsRecycle = false;
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`render-server caído: ${reason}`));
  }
  pending.clear();
}

/**
 * Recicla el proceso de forma SEGURA: sólo cuando no hay renders en vuelo (si los
 * hubiera, esperaríamos al próximo hueco). Mata el proceso vivo para que el
 * siguiente `ensureServer()` arranque uno fresco (bundle se rearma una vez).
 */
function recycleIfIdle(reason: string) {
  if (pending.size > 0) return; // hay un render activo: reciclar luego
  if (!proc) return;
  console.log(`[render-server] reciclando proceso (${reason})`);
  teardown(reason);
}

/**
 * Arranca el server si no está vivo y espera su `{"type":"ready"}` (bundle listo).
 * Cachea la promesa para no arrancar dos procesos en paralelo. Si el arranque o
 * el bundle inicial falla, rechaza → el caller hace fallback.
 */
function ensureServer(): Promise<void> {
  // Reciclado perezoso: si el proceso vivo pidió reciclarse y no hay nada en
  // vuelo, lo matamos acá antes de reusarlo → arranca uno fresco abajo.
  if (proc && readyPromise && needsRecycle && pending.size === 0) {
    teardown("reciclado por contador de renders");
  }
  if (proc && readyPromise) return readyPromise;

  const npxNode = process.execPath; // el node que corre Next: garantizado en PATH
  // Fallback de angle: si un render con angle falló, relanzamos el server SIN
  // angle para que el render-server lea gl=null (swiftshader) este arranque.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
  if (forceNoAngle) childEnv.VIRAL_RENDER_SERVER_NO_ANGLE = "1";
  const child = spawn(npxNode, ["render-server.mjs"], {
    cwd: REMOTION_DIR,
    env: childEnv,
  }) as ChildProcessWithoutNullStreams;
  proc = child;

  // stderr del server → log del server Next (diagnóstico), sin contaminar stdout.
  child.stderr.on("data", (d) => {
    const s = d.toString().trimEnd();
    if (s) console.log(`[render-server] ${s}`);
  });

  readyPromise = new Promise<void>((resolve, reject) => {
    // Tope para el bundle inicial: si no está listo en 90s, asumimos que algo
    // falló y caemos al camino viejo.
    const readyTimer = setTimeout(() => {
      reject(new Error("render-server no quedó listo en 90s"));
      teardown("timeout de arranque");
    }, 90_000);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(trimmed) as ServerMsg;
      } catch {
        return; // línea no-JSON: ignorar
      }
      if (msg.type === "ready") {
        clearTimeout(readyTimer);
        serverGl = msg.gl ?? null;
        resolve();
        return;
      }
      if (msg.type === "fatal") {
        clearTimeout(readyTimer);
        reject(new Error(`render-server fatal: ${msg.error ?? "desconocido"}`));
        teardown("fatal al bundlear");
        return;
      }
      if (msg.type === "progress" && msg.id) {
        const p = pending.get(msg.id);
        p?.onProgress?.(msg.renderedFrames ?? 0, msg.totalFrames ?? 0);
        return;
      }
      if (msg.type === "result" && msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        if (msg.ok && msg.outPath) {
          // Render OK: si llevamos suficientes renders, marcamos el reciclado.
          // Umbral más bajo con angle (memory-leak). El respawn ocurre cuando el
          // proceso queda idle (ahora mismo si no hay nada en vuelo).
          const limit =
            (serverGl ?? msg.gl) === "angle" ? RECYCLE_EVERY_ANGLE : RECYCLE_EVERY_DEFAULT;
          if (typeof msg.renderCount === "number" && msg.renderCount >= limit) {
            needsRecycle = true;
            recycleIfIdle(`${msg.renderCount} renders (gl=${serverGl ?? "null"})`);
          }
          p.resolve(msg.outPath);
        } else {
          p.reject(new Error(msg.error ?? "render-server devolvió ok:false"));
        }
      }
    });
  });

  child.on("exit", (code) => teardown(`el proceso salió (code=${code})`));
  child.on("error", (err) => teardown(`spawn error: ${String(err)}`));

  return readyPromise;
}

function defaultOffthreadCacheBytes(): number {
  const thirtyFive = Math.floor(os.totalmem() * 0.35);
  return Math.max(512 * 1024 * 1024, Math.min(thirtyFive, 6 * 1024 * 1024 * 1024));
}

export interface RenderServerOpts {
  /** Ruta absoluta al props.json ya construido por build-props.mjs. */
  propsPath: string;
  /** Ruta absoluta del .mp4 de salida (el temporal __rendering.mp4). */
  outPath: string;
  concurrency: number;
  /** delayRender timeout (ms) — paridad con --timeout del camino viejo. */
  timeoutMs: number;
  /** 0.5 para preview, 1 para final. */
  scale?: number;
  /** Tope DURO de todo el render por este server; si se excede, fallback. */
  hardTimeoutMs?: number;
  onProgress?: (rendered: number, total: number) => void;
}

/**
 * Intenta renderizar vía el server de larga vida. Resuelve con la ruta del .mp4
 * en éxito; RECHAZA ante cualquier problema (server no arranca, timeout, error
 * de render) para que el caller haga fallback al `npx remotion render`.
 */
export async function renderWithServer(opts: RenderServerOpts): Promise<string> {
  await ensureServer();
  // Recordamos si ESTE arranque corre con angle, para el fallback ante fallo.
  const ranWithAngle = serverGl === "angle";
  const id = String(nextId++);
  const hardTimeout = opts.hardTimeoutMs ?? 25 * 60 * 1000;

  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // Un render colgado puede haber dejado el server en mal estado: lo
        // reiniciamos para que el siguiente pedido empiece limpio.
        teardown("timeout de render");
        reject(new Error(`render-server: timeout (${hardTimeout}ms)`));
      }, hardTimeout);

      pending.set(id, { resolve, reject, onProgress: opts.onProgress, timer });

      const req = {
        id,
        propsPath: opts.propsPath,
        outPath: opts.outPath,
        concurrency: opts.concurrency,
        timeoutMs: opts.timeoutMs,
        scale: opts.scale ?? 1,
        offthreadCacheBytes: defaultOffthreadCacheBytes(),
      };
      try {
        proc!.stdin.write(JSON.stringify(req) + "\n");
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error(`no se pudo escribir al render-server: ${String(err)}`));
      }
    });
  } catch (err) {
    // #3 — fallback de angle: si el render corría con angle y falló, relanzamos
    // el server SIN angle y reintentamos UNA vez. angle es opt-in y propenso a
    // fallos (memory-leak/driver); sin angle es el camino estable. Si vuelve a
    // fallar, propagamos → el caller cae a `npx remotion render`.
    if (ranWithAngle && !forceNoAngle) {
      console.warn(
        `[render-server] render con angle falló (${String(err)}) — relanzando sin angle y reintentando`
      );
      forceNoAngle = true;
      teardown("fallback angle→sin angle");
      await ensureServer();
      const id2 = String(nextId++);
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id2);
          teardown("timeout de render (reintento sin angle)");
          reject(new Error(`render-server: timeout (${hardTimeout}ms)`));
        }, hardTimeout);
        pending.set(id2, { resolve, reject, onProgress: opts.onProgress, timer });
        const req = {
          id: id2,
          propsPath: opts.propsPath,
          outPath: opts.outPath,
          concurrency: opts.concurrency,
          timeoutMs: opts.timeoutMs,
          scale: opts.scale ?? 1,
          offthreadCacheBytes: defaultOffthreadCacheBytes(),
        };
        try {
          proc!.stdin.write(JSON.stringify(req) + "\n");
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id2);
          reject(new Error(`no se pudo escribir al render-server: ${String(e)}`));
        }
      });
    }
    throw err;
  }
}

/**
 * LIMPIEZA DE HUÉRFANOS AL BOOT — mata procesos `render-server.mjs` que quedaron vivos
 * de una sesión ANTERIOR del server Next. Cuando Next se reinicia (crash, recarga dura,
 * cierre brusco), el `child` que manejaba este módulo se pierde de la memoria pero el
 * proceso Node + su Chrome headless siguen corriendo y comiendo RAM para siempre. Como
 * esto corre ANTES del warmup (que es quien arranca NUESTRO render-server), cualquier
 * `render-server.mjs` vivo en este momento es necesariamente de una sesión vieja → seguro
 * matarlo. Best-effort y conservador: identifica por cmdline `render-server.mjs` y excluye
 * el PID propio. Si no puede identificar con certeza, no mata nada.
 */
function sweepOrphanRenderServers(): Promise<void> {
  return new Promise<void>((resolve) => {
    const selfPid = process.pid;

    const killPid = (pid: number) => {
      if (!Number.isFinite(pid) || pid <= 0 || pid === selfPid) return;
      try {
        if (process.platform === "win32") {
          // /T mata también el árbol (el Chrome headless que cuelga del render-server).
          execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
        } else {
          process.kill(pid, "SIGKILL");
        }
      } catch {
        /* ya muerto o sin permiso: best-effort */
      }
    };

    try {
      if (process.platform === "win32") {
        // Lista PID + CommandLine de todos los node.exe; filtramos los que corren
        // render-server.mjs. Usamos PowerShell/CIM (CommandLine fiable, sin parsear CSV).
        const ps =
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          "Where-Object { $_.CommandLine -like '*render-server.mjs*' } | " +
          "Select-Object -ExpandProperty ProcessId";
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", ps],
          { windowsHide: true, timeout: 8000 },
          (err, stdout) => {
            if (!err && stdout) {
              for (const line of stdout.split(/\r?\n/)) {
                const pid = parseInt(line.trim(), 10);
                if (Number.isFinite(pid)) killPid(pid);
              }
            }
            resolve();
          }
        );
      } else {
        // POSIX: pgrep -f matchea contra la cmdline completa.
        execFile("pgrep", ["-f", "render-server.mjs"], { timeout: 8000 }, (err, stdout) => {
          if (!err && stdout) {
            for (const line of stdout.split(/\r?\n/)) {
              const pid = parseInt(line.trim(), 10);
              if (Number.isFinite(pid)) killPid(pid);
            }
          }
          resolve();
        });
      }
    } catch {
      resolve(); // nunca debe romper el boot
    }
  });
}

/**
 * PRE-CALENTADO (#7) — arranca el render-server (y por ende arma el bundle webpack)
 * de forma best-effort, SIN bloquear ni propagar errores. Lo llama instrumentation.ts
 * al iniciar la app para que el primer render ya encuentre el bundle listo en vez de
 * pagar los 15-40s de bundle en caliente. Si está deshabilitado, es no-op.
 *
 * Antes de arrancar el nuestro, barre render-servers HUÉRFANOS de sesiones anteriores
 * (Chrome zombie comiendo RAM). El sweep es best-effort y NO bloquea el warmup.
 */
export function warmup(): void {
  if (!renderServerEnabled()) return;
  try {
    // Matar huérfanos primero, LUEGO arrancar el nuestro. Encadenamos pero tragamos
    // cualquier error del sweep para que un fallo ahí no impida el arranque del server.
    void sweepOrphanRenderServers()
      .catch(() => {})
      .then(() => ensureServer().catch(() => {}));
  } catch {
    /* nunca debe romper el arranque de la app */
  }
}
