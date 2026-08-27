import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { LF_ROOT } from "@/lib/paths";
import { autoMatchBroll, type BrollSource } from "@/lib/pexels";

/**
 * B-roll para un clip de LARGOS. El pipeline (long_form_pipeline._apply_broll) llama
 * acá cuando el estilo es de archivo (editorial_broll / broll_full / broll_pip) y
 * parchea project.bRoll con lo que devolvemos.
 *
 * CLAVE — orientación según el aspecto: 16:9 → `landscape` (no portrait, que dejaba
 * b-roll vertical en un canvas horizontal). 9:16 → `portrait`. Con PEXELS_API_KEY usa
 * Pexels (stock 16:9 real); sin key, autoMatchBroll cae a CC0 (Internet Archive +
 * Openverse). Best-effort: si no hay clips, devolvemos bRoll vacío (el render sigue).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    clipId?: string;
    aspectRatio?: string;
    // De donde salen las imagenes de apoyo. Una fuente, o varias que se
    // alternan momento a momento.
    source?: BrollSource | BrollSource[];
    count?: number;
  };
  const clipId = (body.clipId ?? "").trim();
  if (!clipId) {
    return NextResponse.json({ error: "clipId requerido" }, { status: 400 });
  }
  // Sanitizar: el clipId arma un nombre de archivo; no permitir separadores de ruta.
  if (clipId.includes("/") || clipId.includes("\\") || clipId.includes("..")) {
    return NextResponse.json({ error: "clipId inválido" }, { status: 400 });
  }

  const aspectRatio = body.aspectRatio === "16:9" ? "16:9" : "9:16";
  const orientation = aspectRatio === "16:9" ? "landscape" : "portrait";

  const transcriptPath = path.join(LF_ROOT, "transcripts", `${clipId}.json`);
  let transcript: {
    words?: { word: string; start: number; end: number }[];
    duration?: number;
  };
  try {
    transcript = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
  } catch {
    return NextResponse.json(
      { error: `sin transcript para ${clipId}`, bRoll: [] },
      { status: 404 }
    );
  }

  const words = transcript.words ?? [];
  if (words.length === 0) {
    return NextResponse.json({ bRoll: [], source: "none", orientation });
  }
  const duration =
    transcript.duration ?? words[words.length - 1]?.end ?? 30;
  // ~1 clip cada 16s, mínimo 5, máximo 40 (cada uno = 1 request a Pexels).
  const count =
    body.count && body.count > 0
      ? body.count
      : Math.max(5, Math.min(40, Math.round(duration / 16)));

  try {
    const bRoll = await autoMatchBroll(words, duration, {
      count,
      clipDur: 3,
      orientation,
      // Sin `source` el comportamiento es el de siempre ("auto"), asi que esto no
      // cambia nada para quien no lo elija.
      source: body.source,
    });
    return NextResponse.json({
      bRoll,
      source: body.source ?? (process.env.PEXELS_API_KEY ? "pexels" : "cc0"),
      orientation,
      requested: count,
    });
  } catch (err) {
    // Nunca rompemos el render por b-roll: devolvemos vacío con el error informado.
    return NextResponse.json(
      { bRoll: [], error: String(err), orientation },
      { status: 200 }
    );
  }
}
