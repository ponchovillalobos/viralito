import { NextResponse } from "next/server";
import { listScheduled, startSchedulerIfNeeded } from "@/lib/scheduled-uploads";

// Lista los uploads programados para el calendario de /publicar (sección estilo Postiz).
// Solo LECTURA del store, PERO también ARRANCA el worker si no está corriendo (Fase 2):
// así, al abrir /publicar tras un reinicio del server, el scheduler se levanta y su tick
// inicial recupera los programados vencidos mientras la app estuvo cerrada.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    startSchedulerIfNeeded();
    const uploads = await listScheduled();
    return NextResponse.json({ uploads });
  } catch (e) {
    return NextResponse.json(
      { uploads: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
