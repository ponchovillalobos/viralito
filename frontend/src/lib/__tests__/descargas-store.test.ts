import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * La cola de descargas tiene que sobrevivir a un reinicio de la aplicacion, y
 * decir la verdad sobre lo que quedo a medias.
 *
 * El store lo afirma en su comentario: "lo que quedo bajando cuando la app se
 * cerro no esta bajando: nadie lo esta haciendo". Eso era una afirmacion sin
 * comprobar — justo la clase de cosa que en este proyecto ya salio cara varias
 * veces. Este test la comprueba.
 *
 * Se usa una carpeta temporal propia via VIRAL_DATA_ROOT para no tocar los
 * datos reales, y se recarga el modulo para simular el arranque de la app.
 */
let tmp: string;
let previo: string | undefined;

beforeEach(async () => {
  previo = process.env.VIRAL_DATA_ROOT;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "viral-cola-"));
  // El store guarda AL LADO de DATA_ROOT (path.dirname), asi que se apunta a
  // una subcarpeta para que el archivo caiga dentro del temporal.
  process.env.VIRAL_DATA_ROOT = path.join(tmp, "videos");
  await fs.mkdir(process.env.VIRAL_DATA_ROOT, { recursive: true });
  globalThis.__viral_descargas__ = undefined;
});

afterEach(async () => {
  if (previo === undefined) delete process.env.VIRAL_DATA_ROOT;
  else process.env.VIRAL_DATA_ROOT = previo;
  globalThis.__viral_descargas__ = undefined;
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

async function cargarStore() {
  // Modulo nuevo en cada llamada: sin esto se reusa el ya importado, con su
  // DATA_ROOT viejo, y el test mediria otra cosa.
  //
  // Se usa `vi.resetModules()` y no un `?t=` en la ruta: la cadena de consulta
  // hace que vitest trate el archivo como JS y el `export type` de la primera
  // linea revienta con "Unexpected token".
  vi.resetModules();
  return import("@/lib/descargas-store");
}

describe("cola de descargas", () => {
  it("no encola dos veces el mismo enlace", async () => {
    const s = await cargarStore();
    const url = "https://youtu.be/repetido";
    await s.crearDescarga(url, "largo", 1000);

    expect(await s.yaEnCola(url)).toBeTruthy();
    expect(await s.yaEnCola("https://youtu.be/otro")).toBeFalsy();
  });

  it("una descarga terminada deja de bloquear ese enlace", async () => {
    const s = await cargarStore();
    const url = "https://youtu.be/terminado";
    const d = await s.crearDescarga(url, "largo", 1000);
    await s.actualizarDescarga(d.id, { estado: "listo", videoId: "D01_x" });

    // Ya no esta en cola: se puede volver a pedir si hace falta.
    expect(await s.yaEnCola(url)).toBeFalsy();
    const todas = await s.listarDescargas();
    expect(todas.find((x: { id: string }) => x.id === d.id)?.videoId).toBe("D01_x");
  });

  it("lo que quedo 'bajando' al cerrarse la app NO sigue bajando", async () => {
    const s1 = await cargarStore();
    const d = await s1.crearDescarga("https://youtu.be/cortado", "largo", 1000);
    await s1.actualizarDescarga(d.id, { estado: "bajando" });

    // La app se cierra: se pierde la memoria, queda el archivo.
    globalThis.__viral_descargas__ = undefined;
    const s2 = await cargarStore();
    const tras = (await s2.listarDescargas()).find(
      (x: { id: string }) => x.id === d.id
    );

    expect(tras, "la descarga se perdio al reiniciar").toBeTruthy();
    expect(tras.estado, "sigue diciendo 'bajando' y nadie la esta bajando").toBe(
      "fallo"
    );
    expect(tras.error).toMatch(/cerr/i);
  });

  it("sobrevive el reinicio con su historial", async () => {
    const s1 = await cargarStore();
    await s1.crearDescarga("https://youtu.be/uno", "largo", 1000);
    await s1.crearDescarga("https://youtu.be/dos", "largo", 2000);

    globalThis.__viral_descargas__ = undefined;
    const s2 = await cargarStore();
    const urls = (await s2.listarDescargas()).map((x: { url: string }) => x.url);
    expect(urls).toContain("https://youtu.be/uno");
    expect(urls).toContain("https://youtu.be/dos");
  });
});
