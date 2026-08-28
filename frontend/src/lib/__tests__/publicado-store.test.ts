import { afterEach, describe, expect, it } from "vitest";
import { rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";
import { listarPublicado, marcar, marcasDe, olvidar, REDES } from "@/lib/publicado-store";

/**
 * Registro de "ya lo subí a esta red", marcado a mano.
 *
 * Ejercita el store de verdad contra el disco: lo que importa aquí es que la
 * marca SOBREVIVA, y eso no se comprueba con un mock. El agujero que tapa era
 * justamente que no había nada persistente — el estado `pending_manual` existía
 * en el código y nada en toda la app lo cerraba.
 */

const ARCHIVO = path.join(path.dirname(DATA_ROOT), "publicado.json");
const V1 = "_zzz_test_video_uno";
const V2 = "_zzz_test_video_dos";

afterEach(async () => {
  await olvidar(V1);
  await olvidar(V2);
});

describe("marcas de publicación", () => {
  it("marca, persiste y desmarca", async () => {
    expect(await marcasDe(V1)).toEqual({});

    await marcar(V1, "tiktok", true);
    const tras = await marcasDe(V1);
    expect(Object.keys(tras)).toEqual(["tiktok"]);
    expect(typeof tras.tiktok).toBe("number");

    // Sobrevive a releer del disco, que es el punto de todo esto.
    expect(existsSync(ARCHIVO)).toBe(true);
    expect((await listarPublicado())[V1]?.tiktok).toBe(tras.tiktok);

    await marcar(V1, "tiktok", false);
    expect(await marcasDe(V1)).toEqual({});
  });

  it("cada red es independiente", async () => {
    await marcar(V1, "tiktok", true);
    await marcar(V1, "linkedin", true);
    await marcar(V1, "instagram", true);
    expect(Object.keys(await marcasDe(V1)).sort()).toEqual([
      "instagram",
      "linkedin",
      "tiktok",
    ]);

    await marcar(V1, "linkedin", false);
    expect(Object.keys(await marcasDe(V1)).sort()).toEqual(["instagram", "tiktok"]);
  });

  it("cada video es independiente", async () => {
    await marcar(V1, "tiktok", true);
    await marcar(V2, "linkedin", true);
    expect(Object.keys(await marcasDe(V1))).toEqual(["tiktok"]);
    expect(Object.keys(await marcasDe(V2))).toEqual(["linkedin"]);
  });

  it("marcar dos veces la misma red no la duplica", async () => {
    await marcar(V1, "tiktok", true, 1000);
    await marcar(V1, "tiktok", true, 2000);
    // `marcado` es explícito, no un toggle: repetir true deja true, no apaga.
    expect(await marcasDe(V1)).toEqual({ tiktok: 2000 });
  });

  it("olvidar borra el video entero del registro", async () => {
    await marcar(V1, "tiktok", true);
    await marcar(V1, "linkedin", true);
    await olvidar(V1);
    expect(await marcasDe(V1)).toEqual({});
    expect(V1 in (await listarPublicado())).toBe(false);
  });

  it("un video sin marcas no deja entrada vacía en el archivo", async () => {
    await marcar(V1, "tiktok", true);
    await marcar(V1, "tiktok", false);
    // Si quedara `{ "_zzz_test_video_uno": {} }`, el archivo crecería con basura
    // por cada video que alguna vez se marcó y luego se desmarcó.
    expect(V1 in (await listarPublicado())).toBe(false);
  });

  it("un archivo corrupto no tumba el catálogo", async () => {
    // Lo puede editar un humano, y un valor raro no debe romper la lista.
    const previo = existsSync(ARCHIVO) ? readFileSync(ARCHIVO, "utf-8") : null;
    try {
      writeFileSync(
        ARCHIVO,
        JSON.stringify({
          videos: {
            bueno: { tiktok: 123 },
            malo: { tiktok: "ayer", redQueNoExiste: 5 },
            peor: "esto no es un objeto",
          },
        }),
        "utf-8",
      );
      const todos = await listarPublicado();
      expect(todos.bueno).toEqual({ tiktok: 123 });
      expect(todos.malo).toBeUndefined(); // ningún valor válido → no entra
      expect(todos.peor).toBeUndefined();
    } finally {
      if (previo === null) rmSync(ARCHIVO, { force: true });
      else writeFileSync(ARCHIVO, previo, "utf-8");
    }
  });

  it("las redes son las mismas cuatro que usa el store de métricas", () => {
    // Un solo vocabulario: si divergen, cruzar marcas con métricas deja de
    // funcionar sin que nada avise.
    expect([...REDES].sort()).toEqual(["facebook", "instagram", "linkedin", "tiktok"]);
  });
});
