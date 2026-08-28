import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyCallouts } from "@/app/api/editor/auto-build/lib/fx-enrichments";
import { TRANSCRIPTS_DIR } from "@/lib/paths";
import type { ResolvedProject } from "@/app/api/editor/auto-build/lib/types";

/**
 * Cifras que el hablante menciona, apareciendo cuando las dice.
 *
 * Este test EJECUTA el pipeline real —escribe un transcript, llama a la
 * funcion, que lanza `word_callouts.py`— porque el defecto que arregla no era
 * de logica sino de conexion: el script existia entero y NADIE lo invocaba. Un
 * test que solo leyera codigo habria pasado igual de verde antes y despues.
 *
 * Es la cuarta aparicion del mismo patron en el proyecto: implementado,
 * cableado en los dos builders, dibujado por el composition, y sin nadie que
 * lo dispare.
 */

const VIDEO_ID = "_zzz_prueba_callouts";
const RUTA = join(TRANSCRIPTS_DIR, `${VIDEO_ID}.json`);

const FRASE = "en solo 8 segundos el 50% de la gente decide y eso multiplica por 3x tu alcance";
const PALABRAS = FRASE.split(" ").map((word, i) => ({
  word,
  start: +(i * 0.35).toFixed(2),
  end: +(i * 0.35 + 0.3).toFixed(2),
}));

const base = (): ResolvedProject =>
  ({ id: "x", videoId: VIDEO_ID, styleId: "hype" }) as ResolvedProject;

afterAll(() => rmSync(RUTA, { force: true }));

describe("callouts: cifras y banda de nombre", () => {
  it("detecta las cifras que se mencionan, con su tiempo", async () => {
    mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    writeFileSync(RUTA, JSON.stringify({ words: PALABRAS }), "utf-8");

    const p = base();
    await applyCallouts(p, VIDEO_ID);
    const pops = (p.statPops ?? []) as { at: number; value: string }[];

    expect(pops.map((x) => x.value)).toEqual(["8", "50%", "3x"]);
    // Sincronizadas a la palabra: la primera cifra es la 3a palabra (indice 2).
    expect(pops[0].at).toBeCloseTo(0.7, 1);
  }, 60_000);

  it("sin nombre no dibuja ninguna banda", async () => {
    const p = base();
    await applyCallouts(p, VIDEO_ID);
    expect((p.lowerThirds ?? []).length).toBe(0);
  }, 60_000);

  it("con nombre y cargo pone la banda", async () => {
    const p = base();
    await applyCallouts(p, VIDEO_ID, "Silvia", "Testimonio");
    const bandas = (p.lowerThirds ?? []) as { name: string; role: string }[];
    expect(bandas.length).toBe(1);
    expect(bandas[0].name).toBe("Silvia");
    expect(bandas[0].role).toBe("Testimonio");
  }, 60_000);

  it("sin transcript no rompe y no inventa nada", async () => {
    const p = base();
    await applyCallouts(p, "_zzz_no_existe_este_video");
    expect(p.statPops).toBeUndefined();
    expect(p.lowerThirds).toBeUndefined();
  }, 60_000);

  it("largos aplica lo mismo sobre el transcript del clip", () => {
    const py = readFileSync(
      join(__dirname, "..", "..", "..", "..", "python", "long_form_pipeline.py"),
      "utf-8",
    );
    const i = py.indexOf("def _apply_callouts");
    expect(i, "largos no implementa _apply_callouts").toBeGreaterThan(-1);
    const bloque = py.slice(i, i + 2400);
    expect(bloque).toContain("word_callouts.py");
    expect(bloque).toContain("statPops");
    // `check=False`: con el default, el `if r.returncode` de abajo seria codigo
    // muerto porque run_capture levantaria la excepcion antes.
    expect(bloque, "run_capture con check=True deja muerto el chequeo de returncode")
      .toContain("check=False");
    // Y tiene que estar INVOCADA, no solo definida: es justo lo que fallaba.
    expect(py, "_apply_callouts esta definida pero nadie la llama")
      .toMatch(/^\s*_apply_callouts\(clip_id, style_id\)/m);
  });
});
