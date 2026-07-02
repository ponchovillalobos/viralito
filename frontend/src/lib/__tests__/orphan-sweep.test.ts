import { describe, it, expect } from "vitest";
import { longFormOwner } from "../orphan-sweep";

// El sweep BORRA del disco todo derivado cuyo "owner" no matchee un raw existente.
// Un owner mal derivado = borrar renders/projects legítimos (pasó con los supercuts).

describe("longFormOwner", () => {
  it("clips/renders/projects con _cNN_ → el id del video largo", () => {
    expect(longFormOwner("2026-06-17 15-58-09_c01_atencion-recurso_editorial.mp4")).toBe(
      "2026-06-17 15-58-09",
    );
    expect(longFormOwner("HDI_c12_tema_supreme.json")).toBe("HDI");
  });

  it("supercuts {id}_supercut_{style} → el id del video largo (regresión: se borraban)", () => {
    expect(longFormOwner("2026-06-17 15-58-09_supercut_editorial.mp4")).toBe(
      "2026-06-17 15-58-09",
    );
    expect(longFormOwner("HDI_supercut_supreme.json")).toBe("HDI");
  });

  it("clean {id}_clean → el id del video largo", () => {
    expect(longFormOwner("HDI_clean.mp4")).toBe("HDI");
  });

  it("archivos keyed por id exacto (transcripts/proposals) → el stem", () => {
    expect(longFormOwner("HDI.json")).toBe("HDI");
  });
});
