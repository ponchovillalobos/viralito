import { NextResponse } from "next/server";
import { listScheduled } from "@/lib/scheduled-uploads";

// Lista los uploads programados para el calendario de /publicar (sección estilo Postiz).
// Solo LECTURA sobre el store que ya existe (scheduled-uploads.json) — no cambia nada.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const uploads = await listScheduled();
    return NextResponse.json({ uploads });
  } catch (e) {
    return NextResponse.json(
      { uploads: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
