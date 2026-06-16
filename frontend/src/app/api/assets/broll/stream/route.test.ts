// @vitest-environment node
//
// Pruebas del endpoint que sirve el b-roll localizado a Remotion <OffthreadVideo>.
// Cubre lo crítico: el guard de path-traversal (sin esto, ?file=../../algo leería
// fuera de BROLL_DIR) y el soporte Range/206 (sin el cual OffthreadVideo seekea mal
// y el render se rompe o va lentísimo). Usamos un BROLL_DIR temporal REAL con un
// archivo real para ejercitar el fs y el cálculo de rangos de verdad.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

// Path del dir temporal calculado en hoisting (sin tocar el fs todavía) para inyectarlo
// en el mock de @/lib/paths. Sólo usa `process` (global) → no requiere imports/require.
const { BROLL_DIR } = vi.hoisted(() => {
  const tmp = process.env.TEMP || process.env.TMPDIR || "/tmp";
  return { BROLL_DIR: `${tmp}/broll-test-${process.pid}` };
});

vi.mock("@/lib/paths", () => ({ BROLL_DIR }));

// Importado DESPUÉS del mock (vitest lo hoistea, pero somos explícitos).
import { GET, OPTIONS } from "./route";

const SIZE = 1000;
const FILE = "clip.mp4";

beforeAll(() => {
  mkdirSync(BROLL_DIR, { recursive: true });
  // Contenido determinista: byte i = i % 256, para verificar rangos exactos.
  const buf = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i++) buf[i] = i % 256;
  writeFileSync(path.join(BROLL_DIR, FILE), buf);
});

afterAll(() => {
  rmSync(BROLL_DIR, { recursive: true, force: true });
});

function reqFor(file: string | null, range?: string): NextRequest {
  const url = file === null
    ? "http://localhost/api/assets/broll/stream"
    : `http://localhost/api/assets/broll/stream?file=${encodeURIComponent(file)}`;
  return new NextRequest(url, range ? { headers: { range } } : undefined);
}

describe("GET /api/assets/broll/stream — guard de path-traversal", () => {
  it("rechaza '..' con 400", async () => {
    expect((await GET(reqFor("../secret.mp4"))).status).toBe(400);
  });
  it("rechaza '/' con 400", async () => {
    expect((await GET(reqFor("sub/clip.mp4"))).status).toBe(400);
  });
  it("rechaza '\\\\' con 400", async () => {
    expect((await GET(reqFor("sub\\clip.mp4"))).status).toBe(400);
  });
  it("sin parámetro file → 400", async () => {
    expect((await GET(reqFor(null))).status).toBe(400);
  });
});

describe("GET /api/assets/broll/stream — entrega", () => {
  it("archivo inexistente → 404", async () => {
    expect((await GET(reqFor("no-existe.mp4"))).status).toBe(404);
  });

  it("GET completo → 200 con Content-Length = tamaño y Accept-Ranges", async () => {
    const res = await GET(reqFor(FILE));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(SIZE));
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect((await res.arrayBuffer()).byteLength).toBe(SIZE);
  });

  it("Range 'bytes=0-99' → 206 con Content-Range y 100 bytes", async () => {
    const res = await GET(reqFor(FILE, "bytes=0-99"));
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-99/${SIZE}`);
    expect(res.headers.get("Content-Length")).toBe("100");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("Range abierto 'bytes=500-' → 206 desde 500 hasta el final", async () => {
    const res = await GET(reqFor(FILE, "bytes=500-"));
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 500-${SIZE - 1}/${SIZE}`);
    expect(res.headers.get("Content-Length")).toBe(String(SIZE - 500));
    await res.arrayBuffer(); // drena el stream antes de que afterAll borre el dir
  });

  it("Range con fin más allá del tamaño se clampa al último byte", async () => {
    const res = await GET(reqFor(FILE, "bytes=900-99999"));
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 900-${SIZE - 1}/${SIZE}`);
    expect(res.headers.get("Content-Length")).toBe(String(SIZE - 900));
    await res.arrayBuffer();
  });

  it("Range con inicio fuera de rango cae al 200 completo", async () => {
    const res = await GET(reqFor(FILE, "bytes=99999-"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(SIZE));
    await res.arrayBuffer();
  });
});

describe("OPTIONS /api/assets/broll/stream — CORS", () => {
  it("responde 204 con CORS abierto", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Range");
  });
});
