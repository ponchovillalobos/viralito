/**
 * Anti-drift del registro central de estilos (Phase 0).
 *
 * Estos tests anclan que la ÚNICA fuente de verdad no se desincronice:
 *  - la tupla `STYLE_IDS` (de donde sale el union `StyleId`),
 *  - los ids del JSON `style-registry.data.json`,
 *  - y las llaves de `STYLE_INFO` (derivado) deben ser el MISMO conjunto.
 * Y que los mapas derivados (`STYLE_INFO`, `STYLE_SHORT_LABEL`) coincidan con
 * los que exportan los helpers del registro. Si alguien agrega un estilo al JSON
 * pero olvida la tupla (o viceversa), esto rompe en CI antes de un render.
 */
import { describe, it, expect } from "vitest";
import {
  STYLE_IDS,
  STYLE_REGISTRY,
  STYLE_INFO_FROM_REGISTRY,
  STYLE_SHORT_LABEL_FROM_REGISTRY,
} from "@/lib/style-registry";
import data from "@/lib/style-registry.data.json";
import { STYLE_INFO } from "@/lib/style-templates";
import { STYLE_SHORT_LABEL } from "@/app/api/editor/auto-build/lib/helpers";

const sorted = (xs: string[]) => [...xs].sort();

describe("style-registry — anti-drift", () => {
  it("STYLE_IDS, los ids del JSON y las llaves de STYLE_INFO son el MISMO conjunto", () => {
    const idsFromTuple = sorted([...STYLE_IDS]);
    const idsFromJson = sorted(data.map((e) => e.id));
    const idsFromInfo = sorted(Object.keys(STYLE_INFO));

    expect(idsFromTuple).toEqual(idsFromJson);
    expect(idsFromInfo).toEqual(idsFromJson);
  });

  it("no hay ids duplicados en la tupla ni en el JSON", () => {
    expect(new Set(STYLE_IDS).size).toBe(STYLE_IDS.length);
    expect(new Set(data.map((e) => e.id)).size).toBe(data.length);
    expect(STYLE_REGISTRY.length).toBe(STYLE_IDS.length);
  });

  it("STYLE_INFO re-exportado === el derivado del registro", () => {
    expect(STYLE_INFO).toEqual(STYLE_INFO_FROM_REGISTRY);
  });

  it("STYLE_SHORT_LABEL re-exportado === el derivado del registro", () => {
    expect(STYLE_SHORT_LABEL).toEqual(STYLE_SHORT_LABEL_FROM_REGISTRY);
  });

  it("cada entrada del registro tiene name/tagline/emoji/shortLabel no vacíos", () => {
    for (const e of STYLE_REGISTRY) {
      expect(e.name.length, e.id).toBeGreaterThan(0);
      expect(e.tagline.length, e.id).toBeGreaterThan(0);
      expect(e.emoji.length, e.id).toBeGreaterThan(0);
      expect(e.shortLabel.length, e.id).toBeGreaterThan(0);
    }
  });

  it("STYLE_INFO/STYLE_SHORT_LABEL derivados conservan los valores de cada entrada del JSON", () => {
    for (const e of data) {
      const id = e.id as keyof typeof STYLE_INFO_FROM_REGISTRY;
      expect(STYLE_INFO_FROM_REGISTRY[id]).toEqual({
        name: e.name,
        tagline: e.tagline,
        emoji: e.emoji,
      });
      expect(STYLE_SHORT_LABEL_FROM_REGISTRY[id]).toBe(e.shortLabel);
    }
  });
});
