import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Los dos asistentes tienen que ensenar LO MISMO del mismo estilo.
 *
 * No lo hacian. Las miniaturas reales (25 estilos x 2 orientaciones x 3 escenas
 * en public/style-thumbs) se generaban y se versionaban, el asistente de largos
 * las mostraba, y el de cortos no las mostraba en ningun lado — pintaba un
 * simulacro en CSS. La capacidad estaba, y no tenia puerta.
 *
 * Y el diálogo de cortos pedia la vista previa sin decir la orientacion, asi que
 * quien elegia 16:9 veia el MP4 vertical. Tampoco daba error: mostraba el video
 * equivocado.
 *
 * Este test no compara pixeles; comprueba que las dos pantallas consuman las
 * mismas fuentes y respeten la orientacion elegida.
 */
const SRC = path.join(__dirname, "..", "..");
const CORTOS = path.join(SRC, "components", "editor", "wizard", "wizard-client.tsx");
const LARGOS = path.join(SRC, "components", "largos", "long-form-wizard.tsx");

const leer = (p: string) => readFileSync(p, "utf-8");

describe("los dos asistentes ensenan lo mismo", () => {
  it("ambos muestran los stills reales de style-thumbs", () => {
    for (const [nombre, ruta] of [["cortos", CORTOS], ["largos", LARGOS]] as const) {
      expect(leer(ruta), `${nombre} no muestra style-thumbs`).toContain("/style-thumbs/");
    }
  });

  it("ambos muestran la vista previa en movimiento", () => {
    expect(leer(CORTOS)).toContain("StyleMotionPreview");
    expect(leer(LARGOS)).toMatch(/StyleMotionPreview|\/style-previews\//);
  });

  it("cortos respeta la orientacion elegida, no asume vertical", () => {
    const src = leer(CORTOS);
    // El componente usa el MP4 vertical salvo que se le pase `horizontal`.
    // Pedirlo sin la prop mostraba 9:16 aunque el usuario eligiera 16:9.
    const usos = src.match(/<StyleMotionPreview[\s\S]{0,400}?\/>/g) ?? [];
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) {
      expect(uso, "StyleMotionPreview sin `horizontal`").toContain("horizontal=");
    }
    // Y los stills tienen que elegir el sufijo _h/_v por la misma razon.
    expect(src).toMatch(/style-thumbs\/\$\{[^}]+\}_\$\{aspectRatio/);
  });
});
