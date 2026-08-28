import { NextResponse, type NextRequest } from "next/server";
import { listarPublicado, marcar, REDES, type RedKey } from "@/lib/publicado-store";

/**
 * Marcas de "ya lo subí a esta red", puestas a mano desde el catálogo.
 *
 *   GET   → { videos: { [projectId]: { tiktok: 1756..., linkedin: 1756... } } }
 *   POST  → { projectId, red, marcado } → { marcas }
 *
 * No confundir con `/api/scheduled/*`, que refleja lo que la app publicó por su
 * cuenta. Esto es el registro de lo que la persona subió con sus propias manos.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ videos: await listarPublicado() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "no se pudo leer el registro" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      projectId?: unknown;
      red?: unknown;
      marcado?: unknown;
    };

    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      return NextResponse.json({ error: "falta projectId" }, { status: 400 });
    }
    if (typeof body.red !== "string" || !(REDES as readonly string[]).includes(body.red)) {
      return NextResponse.json(
        { error: `red inválida: se esperaba una de ${REDES.join(", ")}` },
        { status: 400 }
      );
    }
    // `marcado` explícito, no un toggle: el servidor no adivina el estado
    // previo, así que dos clics rápidos no dejan la marca al azar.
    if (typeof body.marcado !== "boolean") {
      return NextResponse.json({ error: "falta marcado (true/false)" }, { status: 400 });
    }

    const marcas = await marcar(projectId, body.red as RedKey, body.marcado);
    return NextResponse.json({ marcas });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "no se pudo guardar la marca" },
      { status: 500 }
    );
  }
}
