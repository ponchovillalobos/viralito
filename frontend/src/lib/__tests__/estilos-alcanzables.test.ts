/**
 * Candado contra estilos huérfanos.
 *
 * Este test nace de un bug real y silencioso: `pop_reels` y `editorial_full`
 * estaban implementados de punta a punta — registro, plantillas, motor de
 * render — pero ninguno de los dos asistentes los ofrecía, así que en la
 * práctica no existían. Nadie lo notó porque un estilo inalcanzable no falla:
 * simplemente nunca se usa.
 *
 * La causa era estructural. Cada asistente declaraba su PROPIA copia a mano del
 * union `StyleId`, y las dos copias derivaron en direcciones distintas (la de
 * largos tenía `editorial_full` y le faltaban otros; la de shorts al revés).
 * El compilador terminaba defendiendo el olvido: rechazaba agregar un id que no
 * estuviera en la copia local. Las copias ya se borraron y ambos asistentes
 * importan el tipo del registro, pero el tipo sólo protege contra ids
 * INVENTADOS — no obliga a OFRECER los que existen. Eso es lo que cuida acá.
 *
 * Si agregás un estilo al registro, este test falla hasta que le des una puerta
 * de entrada en algún asistente, o lo declares deliberadamente automático abajo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STYLE_IDS } from "@/lib/style-registry";

const RAIZ = join(__dirname, "..", "..");
const ASISTENTES = [
  join(RAIZ, "components", "editor", "wizard", "wizard-client.tsx"),
  join(RAIZ, "components", "largos", "long-form-wizard.tsx"),
];

/**
 * Estilos que el sistema aplica solo, sin que nadie los elija de una lista.
 * No es una lista de excepciones para tapar olvidos: cada entrada dice QUIÉN lo
 * aplica, y esa afirmación es verificable leyendo ese código.
 */
const AUTOMATICOS: Record<string, string> = {
  // Vacío a propósito: hoy los 25 estilos del registro son elegibles desde algún
  // asistente. El primer candidato a entrar acá fue `supreme` —la documentación
  // lo describía como "automático para clips de largos"— pero este mismo test
  // demostró que los DOS asistentes lo ofrecen en su lista. El pipeline además
  // se lo asigna solo a los clips; las dos cosas conviven. La nota vieja se
  // corrigió en CLAUDE.md.
};

/** Los ids que un archivo ofrece de verdad: `id: "algo"` dentro de su array. */
function idsOfrecidos(rutaArchivo: string): Set<string> {
  const texto = readFileSync(rutaArchivo, "utf8");
  const encontrados = new Set<string>();
  for (const m of texto.matchAll(/\bid:\s*"([a-z0-9_]+)"/g)) encontrados.add(m[1]);
  return encontrados;
}

describe("todos los estilos del registro son alcanzables", () => {
  const ofrecidos = new Set<string>();
  for (const ruta of ASISTENTES) for (const id of idsOfrecidos(ruta)) ofrecidos.add(id);

  it("ningún estilo del registro queda sin puerta de entrada", () => {
    const huerfanos = STYLE_IDS.filter((id) => !ofrecidos.has(id) && !(id in AUTOMATICOS));
    expect(
      huerfanos,
      `Estos estilos existen en el registro pero ningún asistente los ofrece, así que ` +
        `nadie puede elegirlos: ${huerfanos.join(", ")}. Agregalos al array STYLES de un ` +
        `asistente, o —si el sistema los aplica solo— documentalo en AUTOMATICOS.`,
    ).toEqual([]);
  });

  it("los declarados automáticos tampoco se ofrecen (si no, la nota miente)", () => {
    // Un estilo listado como "lo aplica el sistema" que además aparece en un
    // selector significa que la nota quedó vieja. Vale la pena enterarse.
    for (const [id, quien] of Object.entries(AUTOMATICOS)) {
      expect(ofrecidos.has(id), `"${id}" dice ser ${quien}, pero un asistente lo ofrece`).toBe(false);
    }
  });

  it("ningún asistente ofrece un id que no exista en el registro", () => {
    // La otra dirección: un typo en un selector produce un estilo que el motor
    // de render no sabe hacer. El tipo ya lo cubre, pero el tipo se puede
    // silenciar con un `as`; esto lee el archivo tal como está.
    const validos = new Set<string>(STYLE_IDS);
    for (const ruta of ASISTENTES) {
      // Los archivos traen otros `id:` que no son estilos (plataformas, presets);
      // sólo nos interesan los que se PARECEN a un estilo y no lo son.
      const sospechosos = [...idsOfrecidos(ruta)].filter(
        (id) => !validos.has(id) && STYLE_IDS.some((real) => real.startsWith(id.split("_")[0])),
      );
      expect(sospechosos, `${ruta} ofrece ids parecidos a estilos que no existen`).toEqual([]);
    }
  });
});
