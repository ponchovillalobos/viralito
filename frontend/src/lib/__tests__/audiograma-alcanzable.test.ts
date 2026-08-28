import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * El audiograma es el UNICO estilo que lee el audio con `fetch()`
 * (`useWindowedAudioData`), y `fetch` pasa por CORS — a diferencia de
 * `<OffthreadVideo>`, que Remotion resuelve por su cuenta.
 *
 * Sin cabeceras CORS en la ruta que sirve el video, el estilo falla con
 * "Failed to fetch". Comprobado quitandolas a proposito: la miniatura pasa de
 * 1/1 a 0/1. Y el render REAL toma el mismo camino, asi que la onda saldria
 * plana sin un solo error a la vista — la clase de falla que mas caro sale en
 * este proyecto.
 *
 * Se descubrio porque `audiogram` era el unico estilo sin miniatura de los 25.
 */
const RAIZ = path.join(__dirname, "..", "..", "..");
const RUTA_STREAM = path.join(
  RAIZ, "src", "app", "api", "videos", "[id]", "stream", "route.ts",
);

describe("audiograma: lo que necesita para no salir plano", () => {
  it("la ruta que sirve el video manda Access-Control-Allow-Origin", () => {
    const src = readFileSync(RUTA_STREAM, "utf-8");
    expect(src).toContain("Access-Control-Allow-Origin");
  });

  it("las manda en TODAS las respuestas, no solo en una", () => {
    const src = readFileSync(RUTA_STREAM, "utf-8");
    const respuestas = (src.match(/\.\.\.downloadHeaders,/g) ?? []).length;
    const conCors = (src.match(/\.\.\.CORS_HEADERS,/g) ?? []).length;
    expect(respuestas).toBeGreaterThan(0);
    expect(conCors).toBe(respuestas);
  });

  it("tiene miniatura y vista previa, igual que los demas estilos", () => {
    const reg = JSON.parse(
      readFileSync(path.join(RAIZ, "src", "lib", "style-registry.data.json"), "utf-8"),
    );
    const ids: string[] = (Array.isArray(reg) ? reg : reg.styles).map(
      (s: { id: string }) => s.id,
    );
    expect(ids).toContain("audiogram");

    // El id se ancla entero: partir por "_" leia "hype_max" como "hype" y daba
    // por faltantes estilos que estaban.
    for (const [carpeta, sufijo] of [
      ["style-thumbs", /_(v|h)_\d+$/],
      ["style-previews", /_(v|h)$/],
    ] as const) {
      const dir = path.join(RAIZ, "public", carpeta);
      if (!existsSync(dir)) continue;
      const stems = readdirSync(dir).map((f) => f.replace(/\.[^.]+$/, ""));
      const sinArchivo = ids.filter(
        (id) => !stems.some((s) => s.startsWith(`${id}_`) &&
          sufijo.test(s.slice(id.length))),
      );
      expect(sinArchivo, `${carpeta} sin archivo`).toEqual([]);
    }
  });
});
