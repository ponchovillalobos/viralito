/**
 * Self-heal de librerías de assets para las rutas de stream.
 *
 * Si una carpeta de assets quedó corta en runtime (descarga interrumpida, PC
 * nueva que nunca corrió "Configurar todo"), disparamos `repair_assets.py <lib>`
 * en BACKGROUND — sin await, sin bloquear el request — y seguimos sirviendo lo
 * que haya. La idempotencia/lock vive en el script Python, así que llamarlo de
 * más es inofensivo.
 */
import { promises as fs } from "node:fs";
import { PYTHON_EXE, PYTHON_DIR } from "@/lib/paths";
import { runProcess } from "@/lib/run-process";

export type RepairLib = "music" | "sfx" | "lottie" | "icons" | "illustrations";

/** Cuenta archivos (no carpetas) bajo `dir`, opcionalmente recursivo. */
export async function countFiles(dir: string, recursive: boolean): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true, recursive });
    let n = 0;
    for (const e of entries) if (e.isFile()) n++;
    return n;
  } catch {
    return 0;
  }
}

// Evita re-disparar el mismo repair en ráfaga dentro del mismo proceso Node
// (cada request a /stream lo chequearía). El lock real es del script Python; esto
// es sólo para no spawnear 50 procesos en 1 segundo. 60s de gracia.
const lastFired: Record<string, number> = {};
const FIRE_COOLDOWN_MS = 60_000;

/**
 * Dispara la reparación de `lib` en background (fire-and-forget). No lanza ni
 * espera: traga cualquier error de spawn. No-op si ya se disparó hace < 60s.
 */
export function fireRepair(lib: RepairLib): void {
  const now = Date.now();
  if (lastFired[lib] && now - lastFired[lib] < FIRE_COOLDOWN_MS) return;
  lastFired[lib] = now;
  // runProcess nunca rechaza, pero igual encadenamos un .catch por las dudas.
  void Promise.resolve(
    runProcess(PYTHON_EXE, ["repair_assets.py", lib], PYTHON_DIR, undefined, 3_600_000)
  ).catch(() => {});
}
