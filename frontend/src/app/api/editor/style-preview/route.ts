/**
 * F4 — VISTA PREVIA por estilo (auditoría: "elegís el estilo a ciegas").
 *
 * POST {videoId, styleId, accentColor?, subtitleFont?, subtitleColor?}
 *   → arma el project del estilo sobre TU video (sin renderizarlo entero),
 *     saca UN still al 35% de la duración con los FX reales (subtítulos, color,
 *     fuente, gráficos del estilo) y devuelve la URL del PNG. ~15-40s.
 *   Cachea por combinación (video+estilo+color+fuente): la segunda vez es instantáneo.
 *
 * GET ?file=<nombre.png> → sirve el PNG (solo nombres saneados, sin paths).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT, REMOTION_DIR, TRANSCRIPTS_DIR } from "@/lib/paths";
import {
  applyWizardOverrides,
  type OverridableProject,
} from "@/lib/apply-wizard-overrides";
import { buildProjectForStyle, type BuildContext } from "@/lib/style-templates";
import { offthreadCacheFlag } from "@/lib/render-utils";
import { pickTopKeywords, type TranscriptWord } from "@/lib/content-title";
import { runProcess } from "@/lib/run-process";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import { withSerialLock } from "@/lib/serial-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PREVIEWS_DIR = path.join(DATA_ROOT, "previews");

/** Nombre seguro para archivos/props (sin espacios ni símbolos — evita el bug de
 *  quoting de spawn shell:true en Windows). */
function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      videoId?: string;
      styleId?: string;
      accentColor?: string;
      subtitleFont?: string;
      subtitleColor?: string;
      /** Tema del estilo Editorial (mismo shape que en auto-build). */
      editorialTheme?: { font?: string; background?: string; theme?: string };
      /** Fondo animado de los estilos motion_* ("auto" no viaja). */
      motionBackground?: "aurora" | "mesh" | "grid";
      /** Intensidad de FX de los estilos hype/supreme ("normal" no viaja). */
      fxIntensity?: "suave" | "max";
      /** true → clip de 3s EN MOVIMIENTO (mp4, ~60-120s) en vez de un still. */
      motion?: boolean;
    };
    const { videoId, styleId } = body;
    if (!videoId || !styleId) {
      return NextResponse.json({ error: "videoId y styleId requeridos" }, { status: 400 });
    }
    const accentColor = body.accentColor || "#fb7185";

    const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
    let transcript: { duration: number; words: TranscriptWord[] };
    try {
      transcript = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
    } catch {
      return NextResponse.json(
        { error: "el video no está transcrito todavía" },
        { status: 404 }
      );
    }

    await fs.mkdir(PREVIEWS_DIR, { recursive: true });
    const motion = body.motion === true;
    const ext = motion ? "mp4" : "png";
    // Los overrides del wizard también forman parte de la clave: cambiar tema
    // editorial / fondo animado / intensidad genera una vista previa nueva.
    const themeKey = body.editorialTheme
      ? `${body.editorialTheme.theme ?? ""}-${body.editorialTheme.font ?? ""}-${body.editorialTheme.background ?? ""}`
      : "auto";
    const cacheKey = safe(
      `${videoId}_${styleId}_${accentColor.replace("#", "")}_${body.subtitleFont ?? "auto"}_${(body.subtitleColor ?? "auto").replace("#", "")}_${themeKey}_${body.motionBackground ?? "auto"}_${body.fxIntensity ?? "normal"}${motion ? "_motion" : ""}`
    );
    const outPng = path.join(PREVIEWS_DIR, `${cacheKey}.${ext}`);
    const url = `/api/editor/style-preview?file=${encodeURIComponent(`${cacheKey}.${ext}`)}`;

    // Cache hit → instantáneo.
    if (await fs.access(outPng).then(() => true).catch(() => false)) {
      return NextResponse.json({ ok: true, url, motion, cached: true });
    }

    // Contexto mínimo (sin cinematic/b-roll: el still muestra subtítulos+FX+color).
    const ctx: BuildContext = {
      videoId,
      duration: transcript.duration,
      keywords: pickTopKeywords(transcript.words, 7),
      accentColor,
      caption: "",
      day: undefined,
      width: 1080,
      height: 1920,
      imageOverlays: [],
      filmGrain: false,
      subtitleCinematic: false,
      autoSfxMarks: [],
      autoCameraMoves: [],
      autoStutterMarks: [],
      cinematicDensity: "medium",
    };

    const project = {
      ...buildProjectForStyle(ctx, styleId as Parameters<typeof buildProjectForStyle>[1]),
      id: cacheKey,
      videoId,
      // El preview NO depende del _cut.mp4 (quizá no existe aún) ni de música.
      enableJumpCuts: false,
      musicTrack: null,
      ...(body.subtitleFont && body.subtitleFont !== "auto"
        ? { subtitleFont: body.subtitleFont }
        : {}),
      ...(body.subtitleColor && body.subtitleColor !== "auto"
        ? { subtitleColor: body.subtitleColor }
        : {}),
    };
    // Overrides del wizard (tema editorial / fondo animado / intensidad de FX):
    // el MISMO helper que usa auto-build → la vista previa es honesta.
    const overridable = project as unknown as OverridableProject;
    applyWizardOverrides(overridable, {
      editorialTheme: body.editorialTheme,
      motionBackground: body.motionBackground,
      fxIntensity: body.fxIntensity,
    });
    // El preview no depende del _cut.mp4 (quizá no existe aún): aunque la
    // intensidad "max" prenda jump cuts en el video final, acá siguen apagados.
    overridable.enableJumpCuts = false;
    const projectPath = path.join(PREVIEWS_DIR, `${cacheKey}.json`);
    await writeJsonFileAtomic(projectPath, project);

    const propsName = `props_preview_${cacheKey}.json`;

    // Serializamos el SPAWN de build-props + remotion still/render: cada preview lanza
    // un Chrome headless (Remotion). Varios clicks de "comparar estilos" a la vez
    // arrancaban N Chrome simultáneos y reventaban la RAM. Con el lock se encolan y
    // corren de a uno. Lo PESADO (spawn) va dentro; las respuestas se devuelven afuera.
    const spawnResult = await withSerialLock("style-preview", async (): Promise<
      | { kind: "error"; status: number; message: string }
      | { kind: "ok" }
    > => {
      const buildRun = await runProcess(
        "node",
        ["build-props.mjs", videoId, projectPath, propsName],
        REMOTION_DIR,
        undefined,
        120_000
      );
      if (!buildRun.ok) {
        return { kind: "error", status: 500, message: `build-props: ${buildRun.stderr.slice(-300)}` };
      }

      // Frame al 35% de la duración: suele haber cara + subtítulo activo.
      const frame = Math.max(1, Math.floor(transcript.duration * 0.35 * 30));
      const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
      const needsQuote = process.platform === "win32" && /\s/.test(outPng);
      const outArg = needsQuote ? `"${outPng}"` : outPng;
      // motion=true → 3 segundos (90 frames) EN MOVIMIENTO desde ese punto; si no, still.
      const args = motion
        ? [
            "remotion", "render", "src/index.ts", "ViralVideo",
            outArg, `--frames=${frame}-${frame + 89}`, `--props=${propsName}`,
            "--scale=0.4", "--concurrency=4", "--timeout=120000",
            offthreadCacheFlag(),
          ]
        : [
            "remotion", "still", "src/index.ts", "ViralVideo",
            outArg, `--frame=${frame}`, `--props=${propsName}`, "--scale=0.5",
            "--timeout=120000",
          ];
      const stillRun = await runProcess(
        npxExe,
        args,
        REMOTION_DIR,
        undefined,
        motion ? 280_000 : 240_000
      );
      // limpiar props temporal (best-effort)
      await fs.rm(path.join(REMOTION_DIR, propsName), { force: true }).catch(() => {});

      const exists = await fs.access(outPng).then(() => true).catch(() => false);
      if (!stillRun.ok || !exists) {
        return { kind: "error", status: 500, message: `preview falló: ${stillRun.stderr.slice(-300)}` };
      }
      return { kind: "ok" };
    });

    if (spawnResult.kind === "error") {
      return NextResponse.json({ error: spawnResult.message }, { status: spawnResult.status });
    }
    return NextResponse.json({ ok: true, url, motion, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file") ?? "";
  // Solo nombres saneados generados por este endpoint — sin separadores de path.
  if (!/^[a-zA-Z0-9_-]+\.(png|mp4)$/.test(file)) {
    return new Response("bad request", { status: 400 });
  }
  try {
    const buf = await fs.readFile(path.join(PREVIEWS_DIR, file));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": file.endsWith(".mp4") ? "video/mp4" : "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
