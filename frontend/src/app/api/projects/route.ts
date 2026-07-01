import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, LF_ROOT } from "@/lib/paths";
import { buildBackingChecker } from "@/lib/orphan-sweep";
import { loadClipScores, matchClipScore, shortTitle } from "@/lib/viral-meta";

export const dynamic = "force-dynamic";

const LF_PROJECTS_DIR = path.join(LF_ROOT, "projects");

async function readProjectsFromDir(dir: string, source: "short" | "long_form") {
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const projects = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            const fp = path.join(dir, f);
            const [raw, stat] = await Promise.all([fs.readFile(fp, "utf-8"), fs.stat(fp)]);
            const data = JSON.parse(raw);
            // El nombre de archivo es la fuente de verdad del `id`: el endpoint
            // [id]/route.ts resuelve `${id}.json` y los renders se escriben como
            // `${id}.mp4`. Algunos JSON (renders test A/B/C) guardaron un `id`
            // interno sin el sufijo `_test_X`, lo que (a) colisionaba en React
            // como key duplicada, (b) rompía los lookups por-proyecto con 404, y
            // (c) hacía que el preview de B/C cayera por prefix-match al de A.
            // Derivar del filename garantiza un id único y consistente con disco.
            const id = path.basename(f, ".json");
            // mtime = cuándo se creó/rendió DE VERDAD. Los clips de largos no setean
            // `updatedAt` en su JSON → sin esto caían al FINAL de "Mis videos". Ahora
            // los nuevos quedan al PRINCIPIO (orden por fecha real, más nuevo primero).
            const mtime = stat.mtime.toISOString();
            return { ...data, id, source, updatedAt: data.updatedAt ?? mtime };
          } catch {
            return null;
          }
        })
    );
    return projects.filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const [shorts, longClips, backingExists, clipScores] = await Promise.all([
      readProjectsFromDir(PROJECTS_DIR, "short"),
      readProjectsFromDir(LF_PROJECTS_DIR, "long_form"),
      buildBackingChecker(),
      loadClipScores(),
    ]);
    // Filtrar proyectos cuyo video de respaldo (raw fuente o render producido) ya no
    // existe: si el usuario borró el archivo, el proyecto no debe seguir apareciendo.
    // Y enriquecer con un nombre corto y consistente: viralityScore + shortTitle (2-3 palabras),
    // para localizar cualquier video de un vistazo en toda la app.
    const projects = [...shorts, ...longClips]
      .filter((p) => backingExists(p.id, p.videoId, p.source))
      .map((p) => {
        const match = matchClipScore(p.id as string, clipScores);
        return {
          ...(p as Record<string, unknown>),
          viralityScore: match?.score ?? (p as { viralityScore?: number }).viralityScore ?? null,
          shortTitle: shortTitle(p.id as string),
        };
      });
    projects.sort((a, b) =>
      String((b as { updatedAt?: unknown }).updatedAt ?? "").localeCompare(
        String((a as { updatedAt?: unknown }).updatedAt ?? ""),
      ),
    );
    return NextResponse.json(
      { projects },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
