import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// El scheduler publica posts REALES: su store (crear/actualizar/borrar/migrar) no
// tenía NINGÚN test. Acá se cubre el CRUD + la migración + el lock de escritura.
// El worker (runTick/processUpload) llama APIs de redes y queda fuera de alcance.

// DATA_ROOT apunta a un temp dir → STORE_FILE = <temp>/scheduled-uploads.json
// (el módulo hace path.dirname(DATA_ROOT)). Nada toca C:\viral-data real.
const tmpBase = await fs.mkdtemp(path.join(tmpdir(), "sched-test-"));
const fakeDataRoot = path.join(tmpBase, "videos");
await fs.mkdir(fakeDataRoot, { recursive: true });

vi.mock("@/lib/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paths")>();
  return { ...actual, DATA_ROOT: fakeDataRoot };
});

const {
  createScheduled,
  listScheduled,
  getScheduled,
  updateScheduled,
  deleteScheduled,
} = await import("../scheduled-uploads");

const STORE_FILE = path.join(tmpBase, "scheduled-uploads.json");

const baseUpload = {
  projectId: "test_c01_tema_editorial",
  source: "long_form" as const,
  platform: "linkedin" as const,
  scheduledAt: Date.parse("2026-07-20T10:00:00-06:00"),
  mode: "inbox" as const,
  caption: "caption de prueba",
  title: "caption de prueba",
};

beforeEach(async () => {
  await fs.rm(STORE_FILE, { force: true });
});

afterEach(async () => {
  await fs.rm(STORE_FILE, { force: true });
});

describe("createScheduled", () => {
  it("crea la entry pending con id/attempts/timestamps y la persiste", async () => {
    const entry = await createScheduled(baseUpload);
    expect(entry.id).toMatch(/^sched_/);
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(0);
    expect(entry.createdAt).toBeGreaterThan(0);

    const onDisk = JSON.parse(await fs.readFile(STORE_FILE, "utf-8"));
    expect(onDisk.uploads).toHaveLength(1);
    expect(onDisk.uploads[0].projectId).toBe(baseUpload.projectId);
  });

  it("escrituras concurrentes no se pisan (lock)", async () => {
    await Promise.all([
      createScheduled(baseUpload),
      createScheduled({ ...baseUpload, projectId: "otro_c02_tema_supreme" }),
      createScheduled({ ...baseUpload, platform: "tiktok" as const }),
    ]);
    expect(await listScheduled()).toHaveLength(3);
  });
});

describe("listScheduled / getScheduled", () => {
  it("lista ordenada por scheduledAt ascendente", async () => {
    await createScheduled({ ...baseUpload, scheduledAt: 3000 });
    await createScheduled({ ...baseUpload, scheduledAt: 1000 });
    await createScheduled({ ...baseUpload, scheduledAt: 2000 });
    const list = await listScheduled();
    expect(list.map((u) => u.scheduledAt)).toEqual([1000, 2000, 3000]);
  });

  it("getScheduled devuelve la entry o null", async () => {
    const e = await createScheduled(baseUpload);
    expect((await getScheduled(e.id))?.id).toBe(e.id);
    expect(await getScheduled("sched_no_existe")).toBeNull();
  });

  it("migra entries viejas sin platform/caption", async () => {
    await fs.writeFile(
      STORE_FILE,
      JSON.stringify({
        uploads: [
          {
            id: "sched_legacy",
            projectId: "p1",
            source: "short",
            scheduledAt: 1,
            mode: "inbox",
            title: "titulo legacy",
            status: "pending",
            attempts: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
      "utf-8",
    );
    const [u] = await listScheduled();
    expect(u.platform).toBe("tiktok"); // default retro-compat
    expect(u.caption).toBe("titulo legacy"); // caption ← title
  });

  it("store corrupto ⇒ lista vacía (no explota)", async () => {
    await fs.writeFile(STORE_FILE, "{corrupto", "utf-8");
    expect(await listScheduled()).toEqual([]);
  });
});

describe("updateScheduled", () => {
  it("aplica el patch y actualiza updatedAt", async () => {
    const e = await createScheduled(baseUpload);
    const before = e.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateScheduled(e.id, { status: "failed", lastError: "boom" });
    expect(updated?.status).toBe("failed");
    expect(updated?.lastError).toBe("boom");
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("id inexistente ⇒ null sin tocar el store", async () => {
    await createScheduled(baseUpload);
    expect(await updateScheduled("sched_fantasma", { status: "failed" })).toBeNull();
    expect(await listScheduled()).toHaveLength(1);
  });
});

describe("deleteScheduled", () => {
  it("borra y devuelve true; false si no existe", async () => {
    const e = await createScheduled(baseUpload);
    expect(await deleteScheduled(e.id)).toBe(true);
    expect(await listScheduled()).toHaveLength(0);
    expect(await deleteScheduled(e.id)).toBe(false);
  });
});
