import { NextResponse } from "next/server";
import { listScheduled } from "@/lib/scheduled-uploads";

// Por cada video, en qué redes ya está programado/publicado (para mostrar la etiqueta y no
// publicar dos veces en la misma red). Devuelve { byProject: { [projectId]: { linkedin: status, ... } } }.
export const dynamic = "force-dynamic";

// Estado "más avanzado" gana (published > uploaded > running > pending).
const RANK: Record<string, number> = {
  pending: 1,
  running: 2,
  pending_manual: 2,
  uploaded: 3,
  published: 4,
};

export async function GET() {
  try {
    const uploads = await listScheduled();
    const byProject: Record<string, Record<string, string>> = {};
    for (const u of uploads) {
      if (u.status === "failed") continue;
      const platform = u.platform === "instagram_bridge" ? "instagram" : u.platform;
      const map = (byProject[u.projectId] ??= {});
      const prev = map[platform];
      if (!prev || (RANK[u.status] ?? 0) > (RANK[prev] ?? 0)) {
        map[platform] = u.status;
      }
    }
    return NextResponse.json({ byProject });
  } catch (e) {
    return NextResponse.json(
      { byProject: {}, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
