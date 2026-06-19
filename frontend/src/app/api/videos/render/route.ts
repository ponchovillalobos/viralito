import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import { REMOTION_DIR, RENDERS_DIR, RAW_DIR, PYTHON_EXE, PYTHON_DIR, DATA_ROOT } from "@/lib/paths";
import { humanizeError } from "@/lib/humanize-error";
import { canRender, registerRender } from "@/lib/license";
import { runProcess } from "@/lib/run-process";
import {
  acquireRenderLock,
  releaseRenderLock,
  sweepOrphanLocks,
  remotionConcurrency,
  renameWithRetry,
  REMOTION_DELAY_TIMEOUT_MS,
  offthreadCacheFlag,
} from "@/lib/render-utils";
import { embedIconStickerSvgs } from "@/lib/sticker-svg";
import { renderWithServer, renderServerEnabled } from "@/lib/render-server-client";
import { localizeBrollClips, type LocalizableClip } from "@/lib/broll-localize";
import { isSafeId } from "@/lib/safe-id";

// ── Preset/CRF de x264 desde hw_profile.json (#4/#5). Para el camino `npx remotion
//    render`: si el perfil recomienda un preset/crf válido, los pasamos por flags.
//    Sin perfil → no se agregan flags y Remotion usa sus defaults (camino viejo).
const _X264_PRESETS = new Set([
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow", "placebo",
]);
function x264PresetFlags(): string[] {
  try {
    const j = JSON.parse(
      readFileSync(path.join(DATA_ROOT, "cache", "hw_profile.json"), "utf-8")
    );
    const rec = j?.recommend ?? {};
    const flags: string[] = [];
    if (typeof rec.x264_preset === "string" && _X264_PRESETS.has(rec.x264_preset)) {
      flags.push(`--x264-preset=${rec.x264_preset}`);
    }
    if (Number.isInteger(rec.x264_crf) && rec.x264_crf >= 0 && rec.x264_crf <= 51) {
      flags.push(`--crf=${rec.x264_crf}`);
    }
    return flags;
  } catch {
    return [];
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 1800;

// Tope duro: si Remotion se cuelga, matamos el proceso a los 25 min en vez de bloquear
// el request (y el slot) para siempre.
const RENDER_TIMEOUT_MS = 25 * 60 * 1000;

interface RenderRequest {
  videoId: string;
  props: Record<string, unknown>;
  quality?: "preview" | "final";
}

export async function POST(req: NextRequest) {
  try {
    // PRUEBA GRATUITA — gate: si la prueba terminó y no hay licencia, no se
    // generan más videos. Esta ruta recibe props directos (no pasa por los
    // builders .mjs), así que la marca de agua también se inyecta aquí abajo.
    const lic = canRender();
    if (!lic.allowed) {
      return NextResponse.json({ error: lic.reason }, { status: 403 });
    }

    let body: RenderRequest;
    try {
      body = (await req.json()) as RenderRequest;
    } catch {
      return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
    }
    const { videoId, props, quality = "final" } = body;
    if (!videoId) {
      return NextResponse.json({ error: "videoId required" }, { status: 400 });
    }
    // Anti path-traversal: el videoId arma el output `${videoId}.mp4` /
    // `${videoId}.__rendering.mp4` en path.join → rechazar separadores / ".."
    // ANTES de tocar el FS o adquirir locks.
    if (!isSafeId(videoId)) {
      return NextResponse.json({ error: "videoId inválido" }, { status: 400 });
    }

    await fs.mkdir(RENDERS_DIR, { recursive: true });

    // Locks huérfanos de una sesión anterior (app cerrada a mitad de render):
    // se barren una vez por boot, antes del primer acquire.
    await sweepOrphanLocks();

    // Lock por video: dos renders simultáneos del mismo id corromperían el temporal.
    if (!(await acquireRenderLock(videoId))) {
      return NextResponse.json(
        {
          error:
            "Este video ya se está generando en este momento. Espera a que termine (mira el panel de tareas abajo a la derecha) y reintenta.",
        },
        { status: 409 }
      );
    }

    try {
      const finalOut = path.join(RENDERS_DIR, `${videoId}.mp4`);
      // Render ATÓMICO: escribimos a un temporal y renombramos al final sólo si sale OK.
      // Evita dejar un .mp4 parcial en la ruta final si el render falla o lo matan.
      const outFile = path.join(RENDERS_DIR, `${videoId}.__rendering.mp4`);
      await fs.rm(outFile, { force: true }).catch(() => {});

      let files: string[];
      try {
        files = await fs.readdir(RAW_DIR);
      } catch {
        return NextResponse.json(
          {
            error:
              "No se pudo abrir tu carpeta de videos. Revisa que exista y que Windows no la esté bloqueando.",
            technical: `no se pudo leer RAW_DIR: ${RAW_DIR}`,
          },
          { status: 500 }
        );
      }
      const match = files.find((f) => path.basename(f, path.extname(f)) === videoId);
      if (!match) {
        return NextResponse.json(
          {
            error:
              "No se encontró el video original. Puede que lo hayas movido o borrado de tu carpeta de videos; vuelve a subirlo e intenta de nuevo.",
            technical: `raw video not found: ${videoId} en ${RAW_DIR}`,
          },
          { status: 404 }
        );
      }

      const apiHost = process.env.VIRAL_API_HOST ?? "http://localhost:3000";
      const rawUrl = `${apiHost}/api/videos/${encodeURIComponent(videoId)}/stream?source=raw`;
      const fullProps: Record<string, unknown> = { ...props, rawVideoUrl: rawUrl };
      // Galería de stickers (Ola 1): esta ruta NO pasa por build-props.mjs, así que
      // embebemos acá el SVG de los icon-stickers "ph:"/"tb:" elegidos a mano (los
      // Lottie ya traen lottieSrc y se cargan por URL en el render).
      if (fullProps.iconStickers) {
        fullProps.iconStickers = await embedIconStickerSvgs(fullProps.iconStickers);
      }
      // La música llega como URL RELATIVA desde el editor (el cliente no sabe en
      // qué puerto corre el server: la app instalada usa 3100+, no 3000). Aquí la
      // absolutizamos con el mismo host que el video. Si llega absoluta (props
      // viejos / proyectos guardados), se respeta tal cual.
      if (typeof fullProps.musicUrl === "string" && fullProps.musicUrl.startsWith("/")) {
        fullProps.musicUrl = `${apiHost}${fullProps.musicUrl}`;
      }
      // B-ROLL LOCAL: esta ruta NO pasa por build-props.mjs, así que localizamos acá.
      // Si el editor mandó clips con URL remota (Pexels/CC0 — p.ej. del broll-picker o
      // un proyecto viejo), los bajamos a disco antes de renderizar; si no, OffthreadVideo
      // seekea por internet en CADA frame (CPU ociosa, render ~10x más lento). Cache
      // compartido con el wizard (mismo BROLL_DIR + sha del url) → no re-descarga.
      if (Array.isArray(fullProps.bRoll)) {
        fullProps.bRoll = await localizeBrollClips(
          fullProps.bRoll as LocalizableClip[],
          { host: apiHost }
        );
      }
      // PRUEBA GRATUITA — esta ruta no pasa por build-props.mjs, así que la
      // marca de agua se inyecta directo en los props del render.
      if (lic.watermark) {
        fullProps.trialWatermark = true;
      }

      // Props por ARCHIVO, no inline. En Windows el spawn con shell:true (necesario
      // para los .cmd) concatena los args SIN quoting y destroza las comillas del JSON
      // → Remotion recibe JSON inválido ("quotes very weirdly in the command line") y
      // el render falla SIEMPRE. Por eso el wizard (que ya escribe props.json y pasa
      // --props=archivo) funcionaba y el editor manual NO. Mismo patrón acá.
      const propsFileName = `props-${videoId}.json`;
      await fs.writeFile(
        path.join(REMOTION_DIR, propsFileName),
        JSON.stringify(fullProps),
        "utf-8"
      );
      // outFile es absoluto: si la ruta tiene espacios (la app instalada usa
      // C:\Users\<nombre con espacio>\ViralStudio\...), hay que quotearlo o shell:true
      // lo parte en el primer espacio y el .mp4 sale truncado.
      const needsQuote = process.platform === "win32" && /\s/.test(outFile);
      const outArg = needsQuote ? `"${outFile}"` : outFile;

      // ─── Camino viejo (FALLBACK probado): `npx remotion render`. Lo encapsulamos
      //     en una función para poder caer acá si el render-server falla. ─────────
      async function runNpxRender(): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
        const args = [
          "remotion",
          "render",
          "src/index.ts",
          "ViralVideo",
          outArg,
          "--concurrency",
          String(remotionConcurrency()),
          `--timeout=${REMOTION_DELAY_TIMEOUT_MS}`,
          offthreadCacheFlag(),
          // #4/#5 — preset x264 / crf explícitos del hw_profile (vacío si no aplica).
          ...x264PresetFlags(),
          `--props=${propsFileName}`,
        ];
        if (quality === "preview") {
          args.push("--scale", "0.5");
        }
        const npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
        const proc = spawn(npxExe, args, {
          cwd: REMOTION_DIR,
          shell: process.platform === "win32",
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        });
        let so = "";
        let se = "";
        let to = false;
        proc.stdout.on("data", (d) => (so += d.toString()));
        proc.stderr.on("data", (d) => (se += d.toString()));
        const timer = setTimeout(() => {
          to = true;
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, RENDER_TIMEOUT_MS);
        const c = await new Promise<number>((resolve) => {
          proc.on("close", (cc) => resolve(cc ?? 1));
          proc.on("error", () => resolve(1));
        });
        clearTimeout(timer);
        return { code: c, stdout: so, stderr: se, timedOut: to };
      }

      // ─── #1 RENDER-SERVER en el EDITOR MANUAL ──────────────────────────────────
      // Intentamos primero el server de larga vida (bundle webpack 1 sola vez →
      // ahorra 15-40s por render). Le pasamos el props-<id>.json absoluto y el MISMO
      // outFile temporal. Si el server falla por CUALQUIER motivo → fallback al
      // `npx remotion render` de siempre (red de seguridad). El post-encode NVENC y
      // el flag offthreadvideo se mantienen intactos abajo / en el camino npx.
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let code = 0;
      let serverOk = false;
      if (renderServerEnabled()) {
        try {
          await renderWithServer({
            propsPath: path.join(REMOTION_DIR, propsFileName),
            outPath: outFile,
            concurrency: remotionConcurrency(),
            timeoutMs: REMOTION_DELAY_TIMEOUT_MS,
            scale: quality === "preview" ? 0.5 : 1,
            hardTimeoutMs: RENDER_TIMEOUT_MS,
          });
          serverOk = true;
          console.log(`[videos/render] render-server ok: ${videoId}`);
        } catch (err) {
          console.warn(
            `[videos/render] render-server falló (${String(err)}) — fallback a npx remotion render`
          );
          await fs.rm(outFile, { force: true }).catch(() => {});
        }
      }

      if (!serverOk) {
        const r = await runNpxRender();
        stdout = r.stdout;
        stderr = r.stderr;
        timedOut = r.timedOut;
        code = r.code;
      }

      await fs.rm(path.join(REMOTION_DIR, propsFileName), { force: true }).catch(() => {});

      if (code !== 0 || timedOut) {
        await fs.rm(outFile, { force: true }).catch(() => {});
        // Nada de "render failed" crudo: el stderr pasa por humanizeError y el
        // usuario recibe un mensaje accionable; lo técnico va aparte.
        const raw = `${stderr}\n${stdout}`.trim();
        const human = humanizeError(
          timedOut ? `TIMEOUT: la generación superó el tope de 25 minutos.\n${raw}` : raw,
          timedOut
            ? "La generación tardó demasiado y se canceló. Intenta de nuevo, o prueba primero con calidad Preview."
            : "No se pudo generar el video. Intenta de nuevo; si vuelve a pasar, prueba con calidad Preview o reinicia la app."
        );
        return NextResponse.json(
          { error: human.message, technical: human.technical },
          { status: 500 }
        );
      }

      // POST-ENCODE NVENC (OLA 1) — Remotion encodea SIEMPRE en CPU x264 aunque la
      // máquina tenga NVENC/QSV/AMF ocioso. postencode.py re-encodea el MP4 con el
      // encoder por hardware recomendado por hw_profile (3-8× más rápido, calidad
      // equivalente), preservando el audio (-c:a copy). GATE: si el encoder
      // recomendado es libx264 (sin GPU usable) es NO-OP y deja el archivo intacto —
      // así NUNCA degrada un equipo CPU-only. Best-effort: si falla, se conserva el
      // render tal cual y se publica igual.
      try {
        const pe = await runProcess(
          PYTHON_EXE,
          [path.join(PYTHON_DIR, "postencode.py"), outFile],
          PYTHON_DIR,
          undefined,
          300_000
        );
        if (!pe.ok) {
          console.warn("[videos/render] post-encode NVENC falló, manteniendo render x264");
        }
      } catch (err) {
        console.warn("[videos/render] post-encode NVENC skipped:", err);
      }

      // Render OK → publicar atómicamente el archivo final (con retry ante locks
      // transitorios de OneDrive/antivirus sobre el archivo).
      await renameWithRetry(outFile, finalOut);

      // PRUEBA GRATUITA — contar 1 video generado con éxito (solo afecta el
      // tope de la prueba; con licencia activa no descuenta nada).
      registerRender();

      return NextResponse.json({
        ok: true,
        videoId,
        outPath: finalOut,
        streamUrl: `/api/videos/${videoId}/stream?source=render`,
      });
    } finally {
      await releaseRenderLock(videoId);
    }
  } catch (err) {
    const human = humanizeError(err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: human.message, technical: human.technical },
      { status: 500 }
    );
  }
}
