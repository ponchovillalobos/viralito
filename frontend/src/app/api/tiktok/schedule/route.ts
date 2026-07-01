import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createScheduled,
  listScheduled,
  startSchedulerIfNeeded,
  type SchedulePlatform,
} from "@/lib/scheduled-uploads";
import { PROJECTS_DIR, LF_ROOT, RENDERS_DIR, LF_RENDERS } from "@/lib/paths";
import type { PrivacyLevel } from "@/lib/tiktok-upload";

export const dynamic = "force-dynamic";

// Arrancá el worker la primera vez que se importa este módulo
startSchedulerIfNeeded();

const LF_PROJECTS_DIR = path.join(LF_ROOT, "projects");

interface ScheduleBody {
  projectId: string;
  source?: "short" | "long_form";
  scheduledAt: number;
  /** Plataforma destino. Default tiktok para retro-compat. */
  platform?: SchedulePlatform;
  /** Override del título/caption. Si vacío, se lee de project.captions[platform] o project.caption */
  caption?: string;
  /** Alias legacy de caption */
  title?: string;
  /** TikTok-only */
  mode?: "direct" | "inbox";
  privacyLevel?: PrivacyLevel;
}

export async function GET() {
  const uploads = await listScheduled();
  return NextResponse.json({ uploads });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ScheduleBody;
    if (!body.projectId || !body.scheduledAt) {
      return NextResponse.json(
        { error: "projectId y scheduledAt (epoch ms) son requeridos" },
        { status: 400 }
      );
    }
    const source = body.source ?? "short";
    const platform: SchedulePlatform = body.platform ?? "tiktok";
    const projectsBase = source === "long_form" ? LF_PROJECTS_DIR : PROJECTS_DIR;
    const rendersBase = source === "long_form" ? LF_RENDERS : RENDERS_DIR;

    // Validar que existe render
    const renderPath = path.join(rendersBase, `${body.projectId}.mp4`);
    try {
      await fs.access(renderPath);
    } catch {
      return NextResponse.json(
        { error: `El video generado ya no existe (${path.basename(renderPath)}). Genéralo de nuevo.` },
        { status: 404 }
      );
    }

    // Resolver caption según plataforma:
    //   1. Si vino body.caption → usar eso.
    //   2. Si vino body.title (legacy) → usar eso.
    //   3. Leer project.captions[platform].caption + hashtags.
    //   4. Fallback: project.caption (legacy).
    let caption = body.caption ?? body.title ?? "";
    if (!caption) {
      try {
        const proj = JSON.parse(
          await fs.readFile(path.join(projectsBase, `${body.projectId}.json`), "utf-8")
        );
        const platformKey =
          platform === "instagram_bridge" ? "instagram" : platform;
        const variant = proj?.captions?.[platformKey];
        if (variant?.caption) {
          const hashtags = Array.isArray(variant.hashtags)
            ? (variant.hashtags as string[])
                .map((h) => (h.startsWith("#") ? h : `#${h}`))
                .join(" ")
            : "";
          caption = hashtags
            ? `${variant.caption}\n\n${hashtags}`.trim()
            : variant.caption;
        } else if (proj?.caption) {
          caption = proj.caption;
        }
      } catch {
        // sin caption — el upload va a fallar después
      }
    }

    // Evitar doble publicación en la MISMA red: si ya hay una entry activa (no fallida) para
    // este video + plataforma, no crear otra.
    const existing = (await listScheduled()).find(
      (u) => u.projectId === body.projectId && u.platform === platform && u.status !== "failed",
    );
    if (existing) {
      const STATUS_ES: Record<string, string> = {
        pending: "ya está programado",
        running: "se está publicando",
        uploaded: "ya se subió",
        published: "ya se publicó",
        pending_manual: "está esperando publicación manual",
      };
      const redName = platform === "instagram_bridge" ? "Instagram" : platform;
      return NextResponse.json(
        {
          error: `Este video ${STATUS_ES[existing.status] ?? "ya está en cola"} en ${redName}. No se publica dos veces en la misma red.`,
          duplicate: true,
        },
        { status: 409 },
      );
    }

    const entry = await createScheduled({
      projectId: body.projectId,
      source,
      platform,
      scheduledAt: body.scheduledAt,
      // Default "inbox" (borrador): apps de TikTok sin auditar no pueden publicar "direct" a
      // cuentas públicas. Inbox sube a los borradores y el usuario publica desde la app.
      mode: body.mode ?? "inbox",
      privacyLevel: body.privacyLevel,
      caption,
      title: caption,
    });
    return NextResponse.json(entry);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
