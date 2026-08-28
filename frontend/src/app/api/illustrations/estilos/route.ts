import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/paths";

/**
 * GET /api/illustrations/estilos — los estilos disponibles, con MUESTRAS reales.
 *
 * Devuelve, por estilo: cuántas hay, su familia, su licencia y las URLs de tres
 * ilustraciones concretas para pintarlas en el selector.
 *
 * Existe porque elegir "ilustraciones" a ciegas no es elegir. El pedido fue
 * literal: «las miniaturas deben mostrar qué sticker o ilustraciones se
 * agregarán, para tener más control». Un nombre como `notionists` o `cutouts` no
 * le dice nada a nadie; tres dibujos, sí.
 *
 * La familia importa tanto como el estilo: mezclar trazos distintos dentro de un
 * mismo video es lo que rompe un estilo sobrio. Agrupadas, se ve de un vistazo
 * qué combina con qué.
 */
export const dynamic = "force-dynamic";

const ILLUS_DIR = path.join(DATA_ROOT, "assets", "illustrations");

interface Entrada {
  set?: string;
  familia?: string;
  license?: string;
  autor?: string;
}

/** Familia de los sets viejos, que no traen el campo en su manifest. */
const FAMILIA_HEREDADA: Record<string, string> = {
  "open-doodles": "trazo",
  "open-peeps": "personas",
  notionists: "personas",
  croodles: "personas",
};

export async function GET() {
  try {
    const dirs = await fs.readdir(ILLUS_DIR, { withFileTypes: true }).catch(() => []);
    const estilos = [];

    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const carpeta = path.join(ILLUS_DIR, d.name);
      const svgs = (await fs.readdir(carpeta).catch(() => [])).filter((f) =>
        f.toLowerCase().endsWith(".svg"),
      );
      if (svgs.length === 0) continue;

      let meta: Entrada = {};
      try {
        const raw = await fs.readFile(path.join(carpeta, "manifest.json"), "utf-8");
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr[0]) meta = arr[0] as Entrada;
      } catch {
        /* sets viejos sin manifest: se completa abajo */
      }

      // Tres repartidas a lo largo de la carpeta, no las tres primeras: en un
      // set generado por semilla las contiguas se parecen entre sí, y la
      // muestra daría una idea falsa de la variedad.
      const paso = Math.max(1, Math.floor(svgs.length / 3));
      const muestras = [0, paso, paso * 2]
        .map((i) => svgs[Math.min(i, svgs.length - 1)])
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((f) => `/api/illustrations/stream?file=${encodeURIComponent(`${d.name}/${f}`)}`);

      estilos.push({
        id: d.name,
        cantidad: svgs.length,
        familia: meta.familia ?? FAMILIA_HEREDADA[d.name] ?? "otros",
        licencia: meta.license ?? "desconocida",
        autor: meta.autor ?? null,
        muestras,
      });
    }

    estilos.sort(
      (a, b) => a.familia.localeCompare(b.familia) || b.cantidad - a.cantidad,
    );
    const total = estilos.reduce((n, e) => n + e.cantidad, 0);
    return NextResponse.json({ estilos, total });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "no se pudieron leer las ilustraciones" },
      { status: 500 },
    );
  }
}
