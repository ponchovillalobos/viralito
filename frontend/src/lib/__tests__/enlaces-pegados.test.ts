import { describe, it, expect } from "vitest";
import { interpretarEnlaces, esEnlaceUsable } from "@/lib/enlaces-pegados";

/**
 * Los enlaces se pegan a mano y vienen como vengan. Estos casos salen de la
 * tanda real que motivó la cola: once enlaces de YouTube copiados de un chat.
 */
describe("enlaces pegados de cualquier manera", () => {
  it("uno por linea, que es como se pegan", () => {
    const r = interpretarEnlaces(
      "https://youtu.be/MJ02WMyyrtA\nhttps://youtu.be/8TuvOvQ3dKg\nhttps://youtu.be/YUZqBPTlK1c"
    );
    expect(r.buenas).toHaveLength(3);
    expect(r.buenas[0]).toBe("https://youtu.be/MJ02WMyyrtA");
    expect(r.rechazadas).toEqual([]);
  });

  it("separados por comas, o con espacios de mas", () => {
    const r = interpretarEnlaces(
      "  https://youtu.be/a1 ,https://youtu.be/b2 ;  https://youtu.be/c3  "
    );
    expect(r.buenas).toEqual([
      "https://youtu.be/a1",
      "https://youtu.be/b2",
      "https://youtu.be/c3",
    ]);
  });

  it("no encola dos veces el mismo enlace", () => {
    // Bajar dos horas de video por duplicado no lo arregla nadie despues.
    const r = interpretarEnlaces(
      "https://youtu.be/x\nhttps://youtu.be/x\nhttps://youtu.be/y"
    );
    expect(r.buenas).toEqual(["https://youtu.be/x", "https://youtu.be/y"]);
    expect(r.repetidas).toEqual(["https://youtu.be/x"]);
  });

  it("descarta lo que no es un enlace, sin tirar el resto", () => {
    const r = interpretarEnlaces("mira estos: https://youtu.be/z y avisame");
    expect(r.buenas).toEqual(["https://youtu.be/z"]);
    expect(r.rechazadas.map((x) => x.texto)).toContain("mira");
  });

  it("le quita el punto final que arrastran los enlaces de un documento", () => {
    const r = interpretarEnlaces("https://youtu.be/q1. https://youtu.be/q2)");
    expect(r.buenas).toEqual(["https://youtu.be/q1", "https://youtu.be/q2"]);
  });

  it("no deja pasar esquemas que no sean http(s)", () => {
    // Un `file:///` o un `--flag` disfrazado llegaria a la linea de comandos de
    // yt-dlp; esta es la unica barrera antes de eso.
    for (const malo of [
      "file:///C:/Windows/System32/calc.exe",
      "--exec=rm -rf /",
      "javascript:alert(1)",
      "ftp://ejemplo.com/x.mp4",
    ]) {
      expect(esEnlaceUsable(malo), `dejo pasar ${malo}`).toBe(false);
    }
    expect(esEnlaceUsable("https://youtu.be/ok")).toBe(true);
    expect(esEnlaceUsable("http://youtu.be/ok")).toBe(true);
  });

  it("con la entrada vacia no inventa nada", () => {
    for (const vacio of ["", "   ", "\n\n"]) {
      const r = interpretarEnlaces(vacio);
      expect(r.buenas).toEqual([]);
    }
  });
});
