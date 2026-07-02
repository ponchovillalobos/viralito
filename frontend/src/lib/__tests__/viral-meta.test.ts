import { describe, it, expect } from "vitest";
import {
  shortTitle,
  styleFromId,
  videoLabel,
  contentSlugFromId,
  matchClipScore,
  type ClipScore,
} from "../viral-meta";

// Nombres cortos/estilo/score: es lo que identifica a CADA video en toda la app
// (Mis videos, ranking viral, calendario). Una regresión acá rompe la localización
// visual de los videos — por eso estas funciones puras tienen su propio lote.

describe("contentSlugFromId", () => {
  it("quita el prefijo base_cNN_ y el sufijo de estilo", () => {
    expect(
      contentSlugFromId("Vid 20260323 135543_c09_lo-mas-dificil-entenderla_editorial"),
    ).toBe("lo-mas-dificil-entenderla");
  });

  it("quita sufijos de estilo compuestos", () => {
    expect(contentSlugFromId("HDI_c01_atencion-ocho-segundos_hype_max_sfx")).toBe(
      "atencion-ocho-segundos",
    );
    expect(contentSlugFromId("X_c02_tema_editorial_broll")).toBe("tema");
    expect(contentSlugFromId("X_c03_tema_cine_clasico")).toBe("tema");
  });

  it("deja intacto un id sin prefijo ni estilo", () => {
    expect(contentSlugFromId("mi-video-simple")).toBe("mi-video-simple");
  });
});

describe("shortTitle", () => {
  it("saca 2-3 palabras significativas y capitaliza", () => {
    const t = shortTitle("HDI_c01_atencion-ocho-segundos-scroll_editorial");
    expect(t.toLowerCase()).toContain("atencion");
    expect(t[0]).toBe(t[0].toUpperCase());
    expect(t.split(" ").length).toBeLessThanOrEqual(3);
  });

  it("convierte números en palabras a dígitos", () => {
    expect(shortTitle("X_c01_atencion-ocho-segundos_editorial")).toContain("8");
  });

  it("filtra stopwords", () => {
    const t = shortTitle("X_c01_la-clave-de-el-exito_supreme").toLowerCase();
    expect(t).not.toMatch(/\bla\b|\bde\b|\bel\b/);
  });

  it("devuelve el input si no quedan palabras", () => {
    expect(shortTitle("de-la-el")).toBe("de-la-el");
  });
});

describe("styleFromId", () => {
  it("detecta estilos simples y compuestos por sufijo", () => {
    expect(styleFromId("X_c01_tema_editorial")).toBe("editorial");
    expect(styleFromId("X_c01_tema_editorial_full")).toBe("editorial_full");
    expect(styleFromId("X_c01_tema_hype_max_sfx")).toBe("hype_max_sfx");
    expect(styleFromId("X_c01_tema_cine_clasico")).toBe("cine_clasico");
  });

  it("null cuando no hay sufijo de estilo", () => {
    expect(styleFromId("X_c01_tema-sin-estilo")).toBeNull();
  });
});

describe("videoLabel", () => {
  it("arma [score] · título · estilo", () => {
    expect(videoLabel({ score: 78, title: "Atencion 8 segundos", style: "editorial" })).toBe(
      "78 · Atencion 8 segundos · editorial",
    );
  });

  it("omite score nulo/cero y estilo ausente", () => {
    expect(videoLabel({ score: null, title: "Titulo" })).toBe("Titulo");
    expect(videoLabel({ score: 0, title: "Titulo", style: null })).toBe("Titulo");
  });
});

describe("matchClipScore", () => {
  const map = new Map<string, ClipScore>([
    ["atencion-ocho-segundos", { slug: "atencion-ocho-segundos", score: 78, hook: "h1" }],
    ["entenderla-uno-mismo", { slug: "entenderla-uno-mismo", score: 55, hook: "h2" }],
  ]);

  it("camino rápido: slug extraído del id → lookup directo", () => {
    const m = matchClipScore("HDI_c01_atencion-ocho-segundos_editorial", map);
    expect(m?.score).toBe(78);
  });

  it("fallback substring para ids con otro formato", () => {
    // El slug NO queda solo al quitar prefijo/estilo (hay texto extra) → scan.
    const m = matchClipScore("extra atencion ocho segundos extra", map);
    expect(m?.score).toBe(78);
  });

  it("null cuando nada matchea", () => {
    expect(matchClipScore("video-totalmente-distinto", map)).toBeNull();
  });

  it("con dos matches gana el de mayor score", () => {
    const both = new Map<string, ClipScore>([
      ["tema", { slug: "tema", score: 10, hook: "" }],
      ["tema-completo", { slug: "tema-completo", score: 90, hook: "" }],
    ]);
    // "tema" y "tema-completo" están contenidos en el id → gana 90.
    expect(matchClipScore("X_c01_tema-completo_editorial", both)?.score).toBe(90);
  });
});
