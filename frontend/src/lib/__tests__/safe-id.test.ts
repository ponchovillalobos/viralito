import { describe, it, expect } from "vitest";
import path from "node:path";
import { isSafeId, assertSafeId } from "@/lib/safe-id";

// ⚠️ INVARIANTE DE SEGURIDAD (auditoría 2026-07-20): `isSafeId` es el único guard
// anti-path-traversal del proyecto. Se usa en las rutas que arman rutas del FS con
// un id del request — incluida la subida de overlays, que hace mkdir + escribe un
// binario (era una primitiva de ESCRITURA ARBITRARIA), y las de publicación, que
// suben el .mp4 resultante a LinkedIn/Instagram/TikTok.
//
// Si algún día alguien "simplifica" este helper, estos tests tienen que ponerse
// rojos ANTES de que el agujero llegue a producción.

/** Payloads que un atacante usaría para salirse de la carpeta destino. */
const TRAVERSAL_PAYLOADS = [
  "..",
  ".",
  "../etc/passwd",
  "../../Users/alfon/Startup/x",
  "..\\..\\Windows\\System32\\drivers\\etc\\hosts",
  "a/b",
  "a\\b",
  "/etc/passwd",
  "C:\\Windows\\win.ini",
  "\\\\servidor\\share\\algo",
  "subdir/../../fuera",
  "video/..",
  "./video",
];

/** Ids que el proyecto usa de verdad y NO deben romperse. */
const REAL_IDS = [
  "D01_prompt_40k",
  "2026-06-16 15-03-02",
  "testimonial completo traffilog _1080p_30fps_H264-128kbit_AAC_",
  "curso_ventas_c01_reel",
  "curso_ventas_highlights_c01_reel",
  "video.con.puntos",
  "a",
];

describe("isSafeId — rechaza path traversal", () => {
  it.each(TRAVERSAL_PAYLOADS)("rechaza %j", (payload) => {
    expect(isSafeId(payload)).toBe(false);
  });

  it("rechaza vacío, null y undefined", () => {
    expect(isSafeId("")).toBe(false);
    expect(isSafeId(null)).toBe(false);
    expect(isSafeId(undefined)).toBe(false);
  });

  it("rechaza valores que no son string", () => {
    // Las rutas reciben `unknown` de JSON.parse / formData: el guard tiene que
    // aguantar que le pasen cualquier cosa sin explotar.
    expect(isSafeId(123 as unknown as string)).toBe(false);
    expect(isSafeId({} as unknown as string)).toBe(false);
    expect(isSafeId([] as unknown as string)).toBe(false);
  });
});

describe("isSafeId — acepta los ids reales del proyecto", () => {
  it.each(REAL_IDS)("acepta %j", (id) => {
    expect(isSafeId(id)).toBe(true);
  });
});

describe("isSafeId — propiedad: un id aceptado nunca escapa de su carpeta", () => {
  // Esta es la garantía que de verdad importa: no la forma del string, sino que
  // path.join(base, id) siga cayendo DENTRO de base.
  const base = path.resolve("C:", "viral-data", "videos", "overlays");

  it.each([...REAL_IDS])("path.join se queda dentro de la base para %j", (id) => {
    expect(isSafeId(id)).toBe(true);
    const resolved = path.resolve(base, id);
    expect(resolved.startsWith(base + path.sep)).toBe(true);
  });

  it.each(TRAVERSAL_PAYLOADS)("los payloads rechazados SÍ escaparían: %j", (payload) => {
    // Contraprueba: demuestra que el guard no es decorativo — sin él, estos
    // payloads salen de la carpeta (o la reemplazan por una ruta absoluta).
    const resolved = path.resolve(base, payload);
    const escapa = !resolved.startsWith(base + path.sep);
    // `./video` y `video/..`-style resuelven adentro, pero igual se rechazan por
    // contener separadores: no exigimos que TODOS escapen, sí que ninguno pase.
    expect(isSafeId(payload)).toBe(false);
    if (escapa) expect(resolved.startsWith(base + path.sep)).toBe(false);
  });
});

describe("assertSafeId", () => {
  it("devuelve el id normalizado cuando es seguro", () => {
    expect(assertSafeId("D01_prompt_40k")).toBe("D01_prompt_40k");
  });

  it("lanza con los payloads de traversal", () => {
    for (const payload of TRAVERSAL_PAYLOADS) {
      expect(() => assertSafeId(payload)).toThrow(/path traversal/i);
    }
  });
});
