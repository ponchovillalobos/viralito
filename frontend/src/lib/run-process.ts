/**
 * Helper genérico para spawnear procesos (Python, ffmpeg, node, npx) con timeouts
 * y captura de stdout/stderr. Centraliza un patrón que se duplicaba en varias rutas.
 *
 * Características:
 *   - `timeoutMs`     → tope de tiempo total (mata el proceso al expirar).
 *   - `idleTimeoutMs` → tope por INACTIVIDAD (mata si no emite NADA por N ms).
 *                      Ideal para procesos largos pero "habladores" (render Remotion,
 *                      pipelines Python): un render que avanza emite progreso, así que
 *                      sólo se mata si DE VERDAD se trabó — sin matar renders largos.
 *   - `onProgress`    → callback con cada chunk de stdout/stderr (para parsear progreso).
 *
 * Devuelve `{ ok, stdout, stderr }`. NUNCA rechaza la promesa; los errores de spawn o
 * timeout vienen como `ok:false` con detalle en `stderr` — más simple para callers.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { logProcesoPython } from "./telemetry";

export interface RunProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Nombre legible del proceso para el log (el script .py o el binario). */
function nombreProceso(cmd: string, args: string[]): string {
  const script = args.find((a) => /\.(py|mjs|js)$/i.test(a));
  return script ? path.basename(script) : path.basename(cmd);
}

export function runProcess(
  cmd: string,
  args: string[],
  cwd?: string,
  onProgress?: (data: string) => void,
  timeoutMs?: number,
  idleTimeoutMs?: number,
  /**
   * Se llama con el PID apenas arranca el proceso.
   *
   * Existe para poder MATARLO despues. `forceUnstuck` mataba el arbol de procesos
   * solo en los jobs de largos, porque solo esos registraban su PID; un job de
   * shorts atascado liberaba el slot de la cola y se marcaba fallido, pero el
   * render seguia vivo detras, escribiendo. El siguiente job arrancaba en
   * paralelo real con ese zombi.
   */
  onPid?: (pid: number) => void
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    // Node 17+ rechaza .cmd/.bat con shell:false en Windows (CVE-2024-27980 → EINVAL).
    // npx.cmd y otros wrappers necesitan shell:true. Para .exe nativos mantenemos shell:false.
    const isWindowsScript = process.platform === "win32" && /\.(cmd|bat|ps1)$/i.test(cmd);
    // PYTHONIOENCODING/PYTHONUTF8: en Windows, Python hereda cp1252 y corrompe acentos
    // ("Año" → mojibake) en el JSON de stdout, rompiendo parseLastJsonLine. Forzamos UTF-8
    // para TODOS los subprocess (inofensivo para ffmpeg/node).
    const proc = spawn(cmd, args, {
      cwd,
      shell: isWindowsScript,
      // PYTHONUNBUFFERED: sin esto, el progreso de descargas/transcripciones
      // llega en ráfagas tardías y la UI parece colgada ("Conectando…" 4 min).
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
    });
    if (proc.pid !== undefined) onPid?.(proc.pid);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stderr += `\n[runProcess] TIMEOUT ${timeoutMs}ms — killing\n`;
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, timeoutMs)
      : null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (!idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        stderr += `\n[runProcess] IDLE TIMEOUT ${idleTimeoutMs}ms sin salida — proceso colgado, killing\n`;
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, idleTimeoutMs);
    };
    armIdle();
    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
    };
    proc.stdout.on("data", (d) => {
      armIdle();
      const s = d.toString();
      stdout += s;
      onProgress?.(s);
    });
    proc.stderr.on("data", (d) => {
      armIdle();
      const s = d.toString();
      stderr += s;
      onProgress?.(s);
    });
    proc.on("close", (code) => {
      clearTimers();
      const ok = !timedOut && code === 0;
      // Telemetría: cada proceso que falla queda registrado con su stderr, para
      // que dejemos de estar a ciegas con lo que falla en la máquina del usuario.
      if (!ok) {
        try {
          logProcesoPython(nombreProceso(cmd, args), stderr || `exit code ${code}`, {
            cmd: path.basename(cmd),
            timedOut,
            code,
          });
        } catch {}
      }
      resolve({ ok, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimers();
      // El error de spawn (ej. ENOENT: el ejecutable no existe) ES el diagnóstico —
      // sin esto, un python/ffmpeg faltante devolvía stderr vacío y nadie sabía por qué.
      const detail =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `[runProcess] ENOENT: no existe el ejecutable "${cmd}" — instalación incompleta`
          : `[runProcess] ${String(err)}`;
      try {
        logProcesoPython(nombreProceso(cmd, args), `${stderr}\n${detail}`, { cmd: path.basename(cmd), spawnError: true });
      } catch {}
      resolve({ ok: false, stdout, stderr: `${stderr}\n${detail}` });
    });
  });
}

/**
 * Parsea el ÚLTIMO JSON-object encontrado en el stdout de un script. Patrón estándar
 * en este proyecto: los scripts Python imprimen logs en stderr y un JSON final en stdout
 * (sometimes después de logs informativos en stdout también). Filtra líneas que empiecen
 * con `{` y devuelve la última. Si no hay JSON parseable, devuelve `null`.
 */
export function parseLastJsonLine<T = unknown>(stdout: string): T | null {
  const candidate = stdout
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("{"))
    .pop();
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
