import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyBrollWipes } from "@/app/api/editor/auto-build/lib/fx-enrichments";
import type { ResolvedProject } from "@/app/api/editor/auto-build/lib/types";

/**
 * Barridos de color en los cortes a B-roll (`proTransitionSeries`).
 *
 * Estos tests ejecutan la funcion de verdad, no leen su codigo: las reglas de
 * CUANDO poner un barrido son decisiones de producto y hay que poder cambiarlas
 * viendo que se rompe.
 *
 * El caso que originó todo: la capa `ProTransitionSeriesLayer` estaba montada
 * en el composition, cableada en los DOS builders de props... y su array
 * llegaba siempre vacio, porque abortaba el render con
 *
 *   "The duration of a <TransitionSeries.Sequence /> must not be shorter than
 *    the duration of the next <TransitionSeries.Transition />"
 *
 * cada vez que se activaba (`pad = round(dur * 0.4)` es SIEMPRE menor que
 * `dur`). Nunca pudo funcionar. Nadie lo noto porque nadie llenaba el array.
 */

const base = (extra: Partial<ResolvedProject>): ResolvedProject =>
  ({ id: "x", videoId: "v", styleId: "hype", ...extra }) as ResolvedProject;

const barridos = (p: ResolvedProject) =>
  (p.proTransitionSeries ?? []) as {
    at: number;
    direction: string;
    color: string;
    kind: string;
    durationFrames: number;
  }[];

describe("barridos en los cortes a B-roll", () => {
  it("pone uno por corte, hasta tres, sobre los segmentos largos", () => {
    const p = base({
      bRoll: [
        { start: 2, end: 5 },
        { start: 9, end: 9.5 }, // 0.5s: demasiado corto para justificar un barrido
        { start: 14, end: 17 },
        { start: 22, end: 25 },
        { start: 30, end: 33 }, // por encima del tope de tres
      ],
    });
    applyBrollWipes(p, "#fb7185");
    expect(barridos(p).map((b) => b.at)).toEqual([2, 14, 22]);
  });

  it("no pone ninguno en modo pip: ahi el plano no corta", () => {
    const p = base({ bRollMode: "pip", bRoll: [{ start: 2, end: 5 }] });
    applyBrollWipes(p, "#fb7185");
    expect(barridos(p)).toEqual([]);
  });

  it("no pone ninguno sin B-roll, ni si todos son cortos", () => {
    const vacio = base({ bRoll: [] });
    applyBrollWipes(vacio, "#fb7185");
    expect(barridos(vacio)).toEqual([]);

    const cortos = base({ bRoll: [{ start: 2, end: 2.4 }, { start: 9, end: 9.3 }] });
    applyBrollWipes(cortos, "#fb7185");
    expect(barridos(cortos)).toEqual([]);
  });

  it("usa UN solo color, el acento del video", () => {
    const p = base({ bRoll: [{ start: 2, end: 5 }, { start: 9, end: 12 }] });
    applyBrollWipes(p, "#fb7185");
    const colores = new Set(barridos(p).flatMap((b) => [b.color, b.colorTo as string]));
    expect(colores).toEqual(new Set(["#fb7185"]));
  });

  it("alterna la direccion: tres iguales se leen como un tic", () => {
    const p = base({
      bRoll: [{ start: 2, end: 5 }, { start: 9, end: 12 }, { start: 16, end: 19 }],
    });
    applyBrollWipes(p, "#fb7185");
    const dirs = barridos(p).map((b) => b.direction);
    expect(new Set(dirs).size).toBe(3);
  });

  it("no pisa barridos que ya estuvieran puestos", () => {
    const p = base({
      proTransitionSeries: [{ at: 99, kind: "slide" }],
      bRoll: [{ start: 2, end: 5 }],
    });
    applyBrollWipes(p, "#fb7185");
    expect(barridos(p).map((b) => b.at)).toEqual([99, 2]);
  });

  it("la implementacion de largos aplica las MISMAS reglas", () => {
    // Paridad verificada, no declarada: los numeros que deciden (tope de tres,
    // minimo de 1.2s, cruce de 9 frames, exclusion de pip) tienen que estar en
    // las dos. Si una cambia y la otra no, los clips de largos y los cortos
    // salen distintos sin que nada avise.
    const py = readFileSync(
      join(__dirname, "..", "..", "..", "..", "python", "long_form_pipeline.py"),
      "utf-8",
    );
    const i = py.indexOf("def _barridos_de_broll");
    expect(i, "largos no implementa _barridos_de_broll").toBeGreaterThan(-1);
    const bloque = py.slice(i, i + 2200);
    expect(bloque, "falta el cruce de 9 frames").toContain("CRUCE = 9");
    expect(bloque, "falta el minimo de 1.2s").toContain("1.2");
    expect(bloque, "falta el tope de tres").toContain("[:3]");
    expect(bloque, "no excluye el modo pip").toContain('"pip"');
    expect(bloque, "no usa el acento del clip").toContain("accentColor");
  });

  it("la capa respeta la regla de Remotion que la hacia abortar el render", () => {
    // Remotion EXIGE: ninguna <Sequence> puede durar menos que la <Transition>
    // que tiene al lado. El codigo original usaba `pad = round(dur * 0.4)`,
    // siempre menor que `dur`, asi que la capa tiraba el render entero cada vez
    // que se activaba. Ademas el panel de COLOR necesita 2*dur: con solo `dur`
    // las dos transiciones se lo comen entero, se solapan y el barrido no
    // aparece en ningun fotograma (comprobado renderizando).
    const capa = readFileSync(
      join(__dirname, "..", "..", "..", "..", "remotion", "src", "layers", "pro-transition-series-layer.tsx"),
      "utf-8",
    );
    expect(capa, "volvio el `pad` que abortaba el render").not.toMatch(
      /const pad\s*=\s*Math\.max\(2,\s*Math\.round\(dur\s*\*\s*0\.4\)\)/,
    );
    expect(capa, "el panel de color debe durar 2*dur").toContain("const seqColor = dur * 2;");
    expect(capa, "los paneles vacios deben durar dur").toContain("const seqVacio = dur;");
    // Y tiene que haber paneles VACIOS: con dos opacos no barre, tapa.
    expect(capa, "faltan los paneles vacios que dejan ver el video").toContain("<Vacio />");
  });
});
