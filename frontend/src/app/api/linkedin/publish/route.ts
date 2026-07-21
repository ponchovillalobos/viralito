import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { uploadVideoToLinkedIn } from "@/lib/linkedin-upload";
import { createEntry } from "@/lib/metrics-store";
import { PROJECTS_DIR, LF_ROOT, RENDERS_DIR, LF_RENDERS } from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // upload + processing + publish puede tardar varios minutos

const LF_PROJECTS_DIR = path.join(LF_ROOT, "projects");

interface PublishBody {
  projectId: string;
  source?: "short" | "long_form";
  /** Caption (commentary) — opcional. Si no viene, se lee de project.captions.linkedin */
  caption?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PublishBody;
    if (!body.projectId) {
      return NextResponse.json({ error: "projectId requerido" }, { status: 400 });
    }
    // El projectId arma la ruta del .mp4 que se SUBE A LINKEDIN. Sin validar, un
    // projectId con `..` publicaba un video arbitrario del disco del usuario.
    if (!isSafeId(body.projectId)) {
      return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
    }
    const source = body.source ?? "short";
    const projectsBase = source === "long_form" ? LF_PROJECTS_DIR : PROJECTS_DIR;
    const rendersBase = source === "long_form" ? LF_RENDERS : RENDERS_DIR;

    const renderPath = path.join(rendersBase, `${body.projectId}.mp4`);
    try {
      await fs.access(renderPath);
    } catch {
      return NextResponse.json(
        { error: `El video generado ya no existe (${path.basename(renderPath)}). Genéralo de nuevo.` },
        { status: 404 }
      );
    }

    // Resolver caption: body > project.captions.linkedin > project.caption
    let commentary = body.caption ?? "";
    if (!commentary) {
      try {
        const proj = JSON.parse(
          await fs.readFile(path.join(projectsBase, `${body.projectId}.json`), "utf-8")
        );
        const linkedinVariant = proj?.captions?.linkedin;
        if (linkedinVariant?.caption) {
          const hashtags = Array.isArray(linkedinVariant.hashtags)
            ? (linkedinVariant.hashtags as string[])
                .map((h) => (h.startsWith("#") ? h : `#${h}`))
                .join(" ")
            : "";
          commentary = hashtags
            ? `${linkedinVariant.caption}\n\n${hashtags}`
            : linkedinVariant.caption;
        } else if (proj?.caption) {
          commentary = proj.caption;
        }
      } catch {
        // caption queda vacío
      }
    }

    if (!commentary.trim()) {
      return NextResponse.json(
        { error: "No hay descripción para publicar — genera una con ✨ primero" },
        { status: 400 }
      );
    }

    const result = await uploadVideoToLinkedIn({
      filePath: renderPath,
      commentary,
      visibility: "PUBLIC",
    });

    // Registrar el post (con su URN) en métricas, para poder auto-sincronizar después
    // vía /api/linkedin/sync-metrics. Si falla, no rompe la publicación.
    if (result.postUrn) {
      try {
        let projDay = 0;
        try {
          const proj = JSON.parse(
            await fs.readFile(path.join(projectsBase, `${body.projectId}.json`), "utf-8")
          );
          if (typeof proj?.day === "number") projDay = proj.day;
        } catch {
          /* day=0 si no se puede leer */
        }
        await createEntry({
          projectId: body.projectId,
          platform: "linkedin",
          day: projDay,
          date: new Date().toISOString().slice(0, 10),
          postedAt: Date.now(),
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          postUrn: result.postUrn,
        });
      } catch (e) {
        console.warn("[linkedin/publish] no se pudo registrar el post para métricas:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      postUrn: result.postUrn,
      videoUrn: result.videoUrn,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
