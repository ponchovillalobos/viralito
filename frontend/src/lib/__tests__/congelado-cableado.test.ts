import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El congelado (`freezeMarks`) tiene que estar cableado de punta a punta o no
 * existe. La cadena completa son CINCO eslabones, y romper cualquiera lo deja
 * mudo sin dar un solo error:
 *
 *   1. `fx-enrichments.ts`  — el director emocional lo ESCRIBE en el pico.
 *   2. `types.ts`           — `ResolvedProject` lo DECLARA (si no, el enricher
 *                             lo escribe con un `as` y nadie sabe que existe).
 *   3. `build-props.mjs`    — lo COPIA al props.json de los shorts.
 *   4. `build-clip-props.mjs` — lo copia al props.json de los clips de largos.
 *   5. `ViralVideo.tsx`     — el schema lo acepta y el `<Freeze>` lo APLICA.
 *
 * El eslabon 3/4 es el que ya se rompio una vez: el efecto estaba implementado
 * y escrito, pero ningun builder lo pasaba, asi que el composition recibia
 * siempre la lista vacia. Compilaba, renderizaba, y no congelaba nada.
 */

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf-8");

describe("congelado: la cadena entera esta cableada", () => {
  it("1. el director emocional lo escribe en el pico", () => {
    const src = leer(join("frontend", "src", "app", "api", "editor", "auto-build", "lib", "fx-enrichments.ts"));
    expect(src).toMatch(/project\.freezeMarks\s*=/);
  });

  it("2. ResolvedProject lo declara con tipo propio", () => {
    const src = leer(join("frontend", "src", "app", "api", "editor", "auto-build", "lib", "types.ts"));
    expect(src).toMatch(/freezeMarks\?:\s*Array<\{\s*at:\s*number/);
  });

  it("3. build-props.mjs lo copia (shorts)", () => {
    expect(leer(join("remotion", "build-props.mjs"))).toMatch(/freezeMarks:/);
  });

  it("4. build-clip-props.mjs lo copia (clips de largos)", () => {
    expect(leer(join("remotion", "build-clip-props.mjs"))).toMatch(/freezeMarks:/);
  });

  it("5. el composition lo declara en el schema y lo aplica con <Freeze>", () => {
    const src = leer(join("remotion", "src", "ViralVideo.tsx"));
    expect(src, "falta en el schema").toMatch(/freezeMarks:\s*z/);
    expect(src, "falta el <Freeze> que lo aplica").toContain("<Freeze");
  });

  it("build-clip-props no llama a filterAndRemap, que ahi no existe", () => {
    // Los clips de largos no hacen jump cuts: sus tiempos ya vienen relativos
    // al corte. Llamar a `filterAndRemap` en ese archivo seria un
    // ReferenceError en el primer render — ya paso al cablear esto.
    const src = leer(join("remotion", "build-clip-props.mjs"));
    const usa = /^\s*[^/\s].*filterAndRemap\(/m.test(src);
    const define = /function filterAndRemap/.test(src);
    expect(usa && !define, "usa filterAndRemap sin definirla ni importarla").toBe(false);
  });
});
