import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { publishReelToInstagram } from "@/lib/instagram-upload";
import { PROJECTS_DIR, LF_ROOT, RENDERS_DIR, LF_RENDERS } from "@/lib/paths";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // crear container + transcode IG + publish puede tardar

const LF_PROJECTS_DIR = path.join(LF_ROOT, "projects");

interface PublishBody {
  projectId: string;
  source?: "short" | "long_form";
  /** Caption — opcional. Si no viene, se lee de project.captions.instagram o project.caption */
  caption?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PublishBody;
    if (!body.projectId) {
      return NextResponse.json({ error: "projectId requerido" }, { status: 400 });
    }
    // El projectId arma la ruta del .mp4 que se PUBLICA en Instagram. Sin validar,
    // un projectId con `..` publicaba un video arbitrario del disco.
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

    // Resolver caption: body > project.captions.instagram > project.caption
    let caption = body.caption ?? "";
    if (!caption) {
      try {
        const proj = JSON.parse(
          await fs.readFile(path.join(projectsBase, `${body.projectId}.json`), "utf-8")
        );
        const igVariant = proj?.captions?.instagram;
        if (igVariant?.caption) {
          const hashtags = Array.isArray(igVariant.hashtags)
            ? (igVariant.hashtags as string[]).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
            : "";
          caption = hashtags ? `${igVariant.caption}\n\n${hashtags}` : igVariant.caption;
        } else if (proj?.caption) {
          caption = proj.caption;
        }
      } catch {
        // caption queda vacío
      }
    }

    if (!caption.trim()) {
      return NextResponse.json(
        { error: "No hay descripción para publicar — genera una con ✨ primero" },
        { status: 400 }
      );
    }

    const result = await publishReelToInstagram({
      videoId: body.projectId,
      caption,
    });

    return NextResponse.json({ ok: true, mediaId: result.mediaId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
