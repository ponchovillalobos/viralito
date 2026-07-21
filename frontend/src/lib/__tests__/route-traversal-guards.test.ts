import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

// ⚠️ INVARIANTE DE SEGURIDAD (auditoría 2026-07-20).
//
// `isSafeId` (src/lib/safe-id.ts) tiene sus propios tests unitarios, pero eso no
// impide el fallo real que la auditoría encontró: el helper existía, estaba bien
// escrito, y SIMPLEMENTE NO SE LLAMABA en 7 rutas. Un caso literal:
// `long_form/proposals/[videoId]` validaba en el PATCH y no en el GET del MISMO
// archivo.
//
// Este test escanea el fuente de las rutas que arman una ruta del filesystem a
// partir de un id que viene del request, y falla si alguna dejó de invocar el
// guard. Es una prueba de CABLEADO, no de comportamiento: barata, y ataca
// exactamente la forma en que este proyecto se rompió.

const API = path.join(process.cwd(), "src", "app", "api");

/**
 * Rutas que reciben un id del request y lo usan para construir rutas del FS.
 * Cada una con el motivo, para que quien agregue o quite una entienda el riesgo.
 */
const GUARDED_ROUTES: { file: string; porque: string }[] = [
  {
    file: "overlays/upload/route.ts",
    porque: "hace mkdir + escribe un binario → escritura arbitraria en disco",
  },
  {
    file: "long_form/proposals/[videoId]/route.ts",
    porque: "lee un .json del disco y lo devuelve en la respuesta",
  },
  {
    file: "linkedin/publish/route.ts",
    porque: "arma el .mp4 que se sube a LinkedIn",
  },
  {
    file: "instagram/publish/route.ts",
    porque: "arma el .mp4 que se publica en Instagram",
  },
  {
    file: "tiktok/schedule/route.ts",
    porque: "arma el .mp4 que se agenda para publicar",
  },
  {
    file: "editor/auto-build/route.ts",
    porque: "concatena el videoId a rutas y lo pasa como argv a Python",
  },
  {
    file: "long_form/process/route.ts",
    porque: "concatena el videoId a rutas y lo pasa como argv a Python",
  },
];

describe("guards anti-traversal cableados en las rutas de API", () => {
  it.each(GUARDED_ROUTES)("$file llama a isSafeId ($porque)", async ({ file }) => {
    const src = await fs.readFile(path.join(API, file), "utf-8");
    expect(src, `${file} debe importar el guard compartido`).toContain(
      'from "@/lib/safe-id"'
    );
    expect(src, `${file} debe INVOCAR isSafeId, no solo importarlo`).toMatch(
      /isSafeId\s*\(/
    );
  });

  it("todas las rutas listadas existen (la lista no quedó vieja)", async () => {
    for (const { file } of GUARDED_ROUTES) {
      await expect(
        fs.access(path.join(API, file)),
        `${file} ya no existe: actualizá esta lista`
      ).resolves.toBeUndefined();
    }
  });
});
