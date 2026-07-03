import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// ⚠️ INVARIANTE (incidente 2026-07-03): NINGÚN sweep automático borra archivos del
// usuario. El sweep viejo destruía renders terminados cuando el raw se movía/borraba.
// Estos tests anclan que los sweeps SOLO reportan (deleted === 0, archivos intactos).

const tmpBase = await fs.mkdtemp(path.join(tmpdir(), "orphan-test-"));
const fakeDataRoot = path.join(tmpBase, "videos");
const LF = path.join(fakeDataRoot, "long_form");
for (const d of ["raw", "renders", "clips", "clean", "projects", "transcripts", "cuts", "proposals", "graphics", "face_tracks"]) {
  await fs.mkdir(path.join(LF, d), { recursive: true });
  await fs.mkdir(path.join(fakeDataRoot, d), { recursive: true }).catch(() => {});
}

vi.mock("@/lib/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paths")>();
  const p = await import("node:path");
  return {
    ...actual,
    DATA_ROOT: fakeDataRoot,
    RAW_DIR: p.join(fakeDataRoot, "raw"),
    RENDERS_DIR: p.join(fakeDataRoot, "renders"),
    PROJECTS_DIR: p.join(fakeDataRoot, "projects"),
    TRANSCRIPTS_DIR: p.join(fakeDataRoot, "transcripts"),
    CUTS_DIR: p.join(fakeDataRoot, "cuts"),
    LF_ROOT: LF,
    LF_RAW: p.join(LF, "raw"),
    LF_RENDERS: p.join(LF, "renders"),
    LF_CLIPS: p.join(LF, "clips"),
    LF_CLEAN: p.join(LF, "clean"),
  };
});
vi.mock("@/lib/paths-long-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paths-long-form")>();
  const p = await import("node:path");
  return {
    ...actual,
    LF_TRANSCRIPTS: p.join(LF, "transcripts"),
    LF_CUTS: p.join(LF, "cuts"),
    LF_PROPOSALS: p.join(LF, "proposals"),
    LF_PROJECTS_DIR: p.join(LF, "projects"),
  };
});

const { longFormOwner, sweepLongFormOrphans, sweepShortOrphans } = await import(
  "../orphan-sweep"
);

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

describe("INVARIANTE: los sweeps NO borran archivos del usuario", () => {
  it("largos: render huérfano (raw ausente) queda INTACTO y deleted === 0", async () => {
    // Un raw existente (para pasar la guarda raw.size>0) + derivados de OTRO video borrado.
    await fs.writeFile(path.join(LF, "raw", "video-vivo.mp4"), "raw");
    const orphanRender = path.join(LF, "renders", "video-borrado_c01_tema_editorial.mp4");
    const orphanClip = path.join(LF, "clips", "video-borrado_c01_tema.mp4");
    const orphanProposal = path.join(LF, "proposals", "video-borrado.json");
    await fs.writeFile(orphanRender, "render-producto-del-usuario");
    await fs.writeFile(orphanClip, "clip");
    await fs.writeFile(orphanProposal, "{}");

    const res = await sweepLongFormOrphans();

    expect(res.deleted).toBe(0);
    // TODO sigue en disco:
    await expect(fs.access(orphanRender)).resolves.toBeUndefined();
    await expect(fs.access(orphanClip)).resolves.toBeUndefined();
    await expect(fs.access(orphanProposal)).resolves.toBeUndefined();
    // Pero sí se DETECTÓ como huérfano (para la futura pantalla manual):
    expect(res.orphans).toContain("video-borrado");
    const report = JSON.parse(
      await fs.readFile(path.join(fakeDataRoot, "orphan-report.json"), "utf-8"),
    );
    expect(report.long_form.some((p: string) => p.includes("video-borrado"))).toBe(true);
  });

  it("largos: las CARPETAS del usuario (ej. renders/Publicados) nunca se tocan ni reportan", async () => {
    const userDir = path.join(LF, "renders", "Publicados");
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(path.join(userDir, "mi-video.mp4"), "publicado");

    const res = await sweepLongFormOrphans();

    await expect(fs.access(path.join(userDir, "mi-video.mp4"))).resolves.toBeUndefined();
    const report = JSON.parse(
      await fs.readFile(path.join(fakeDataRoot, "orphan-report.json"), "utf-8"),
    );
    expect(report.long_form.some((p: string) => p.includes("Publicados"))).toBe(false);
    expect(res.deleted).toBe(0);
  });

  it("shorts: render y project huérfanos quedan INTACTOS y deleted === 0", async () => {
    await fs.writeFile(path.join(fakeDataRoot, "raw", "short-vivo.mp4"), "raw");
    const orphanRender = path.join(fakeDataRoot, "renders", "short-borrado_hype.mp4");
    const orphanProject = path.join(fakeDataRoot, "projects", "short-borrado_hype.json");
    await fs.writeFile(orphanRender, "render");
    await fs.writeFile(orphanProject, JSON.stringify({ videoId: "short-borrado" }));

    const res = await sweepShortOrphans();

    expect(res.deleted).toBe(0);
    await expect(fs.access(orphanRender)).resolves.toBeUndefined();
    await expect(fs.access(orphanProject)).resolves.toBeUndefined();
  });
});
