import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, LF_ROOT, RAW_DIR, LF_RAW } from "@/lib/paths";
import { buildBackingChecker, longFormOwner } from "@/lib/orphan-sweep";
import { loadClipScores, matchClipScore, shortTitle } from "@/lib/viral-meta";

export const dynamic = "force-dynamic";

const LF_PROJECTS_DIR = path.join(LF_ROOT, "projects");

// ¿El raw de este proyecto viene de un audio (podcast sin imagen, ej. NotebookLM)?
// `synthesizeVideoFromAudio` deja un sidecar vacío `<mp4>.audiosrc` junto al RAW del
// video completo — pero `videoId` en un clip de largos es el del CLIP
// (`{raw}_c09_slug`), no el del raw. `longFormOwner` (mismo regex que usa el sweep
// de huérfanos para agrupar clips bajo su video real) recupera el raw primero.
// Se chequea con `existsSync` (no async) porque esto corre por cada uno de
// decenas/cientos de proyectos y ya está cacheado por el OS.
import { existsSync } from "node:fs";
function isAudioSourced(videoId: string | undefined, source: "short" | "long_form"): boolean {
  if (!videoId) return false;
  const rawDir = source === "long_form" ? LF_RAW : RAW_DIR;
  const rawId = source === "long_form" ? longFormOwner(videoId) : videoId;
  return existsSync(path.join(rawDir, `${rawId}.mp4.audiosrc`));
}

// Caché por archivo (mtime): esta ruta se golpea ~100 veces por sesión y leía + parseaba
// TODOS los JSON en cada request. Con el caché solo se re-lee lo que cambió en disco.
const projectFileCache = new Map<string, { mtimeMs: number; data: Record<string, unknown> }>();

// El shape mínimo que usa esta ruta; el resto de los campos del JSON viajan tal cual.
interface ProjectRecord extends Record<string, unknown> {
  id: string;
  source: "short" | "long_form";
  videoId?: string;
  updatedAt?: unknown;
  viralityScore?: number;
}

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
            const stat = await fs.stat(fp);
            const cached = projectFileCache.get(fp);
            const data =
              cached && cached.mtimeMs === stat.mtimeMs
                ? cached.data
                : (JSON.parse(await fs.readFile(fp, "utf-8")) as Record<string, unknown>);
            if (!cached || cached.mtimeMs !== stat.mtimeMs) {
              projectFileCache.set(fp, { mtimeMs: stat.mtimeMs, data });
            }
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
            return {
              ...data,
              id,
              source,
              updatedAt: data.updatedAt ?? mtime,
            } as ProjectRecord;
          } catch {
            return null;
          }
        })
    );
    return projects.filter((p): p is ProjectRecord => p !== null);
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
          audioSource: isAudioSourced(p.videoId, p.source),
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
