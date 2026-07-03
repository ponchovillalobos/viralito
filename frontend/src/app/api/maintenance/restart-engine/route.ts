import { NextResponse } from "next/server";

// REINICIAR MOTOR (botón en Ajustes): responde OK y termina el proceso node.
// El WATCHDOG de la app de escritorio (desktop/src-tauri) detecta la muerte y lo
// revive solo en ~2-4 segundos, recargando la ventana cuando vuelve a responder.
// Sin la app de escritorio (server lanzado a mano), esto simplemente lo apaga.
export const dynamic = "force-dynamic";

export async function POST() {
  setTimeout(() => {
    console.log("[maintenance] reinicio del motor solicitado desde Ajustes — saliendo…");
    process.exit(0);
  }, 400);
  return NextResponse.json({ ok: true, restarting: true });
}
