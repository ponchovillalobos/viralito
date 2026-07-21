import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LF_PROPOSALS } from "@/lib/paths-long-form";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import { isSafeId } from "@/lib/safe-id";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ videoId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { videoId } = await ctx.params;
  // Mismo guard que el PATCH de abajo: sin esto el GET leía CUALQUIER .json del
  // disco (`../../../../algo`) y lo devolvía en la respuesta.
  if (!isSafeId(videoId)) {
    return NextResponse.json({ error: "video no válido" }, { status: 400 });
  }
  const filePath = path.join(LF_PROPOSALS, `${videoId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "no hay propuestas", videoId }, { status: 404 });
  }
}

// ── PATCH: flujo REVISAR antes de generar ───────────────────────────────────
// Body: { clips: [{ index, approved?, start?, end? }] }
//   - index   → posición 0-based del clip en el arreglo del proposals JSON.
//   - approved → true/false (descartado se ve atenuado en el wizard y no se genera).
//   - start/end → ajuste fino de los límites del momento (steppers ±0.5 s).
// Validación: start < end y duración entre 5 y 180 s. Escritura ATÓMICA
// (tmp + rename) para nunca dejar el JSON a medias si algo se corta.

/** Duración permitida de un clip ajustado a mano (segundos). */
const MIN_CLIP_SECONDS = 5;
const MAX_CLIP_SECONDS = 180;

interface ClipPatch {
  index: number;
  approved?: boolean;
  start?: number;
  end?: number;
  /** Hooks A/B: gancho elegido por el usuario (reemplaza el generado). */
  hook?: string;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { videoId } = await ctx.params;
  // Nunca dejar que el id navegue fuera de la carpeta de proposals. Se unificó al
  // helper compartido: el regex de antes no descartaba "." ni ids que no coinciden
  // con su propio basename.
  if (!isSafeId(videoId)) {
    return NextResponse.json({ error: "video no válido" }, { status: 400 });
  }
  const filePath = path.join(LF_PROPOSALS, `${videoId}.json`);

  let data: { clips?: Record<string, unknown>[] };
  try {
    data = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return NextResponse.json(
      { error: "Todavía no hay momentos analizados para este video.", videoId },
      { status: 404 }
    );
  }
  const clips = Array.isArray(data.clips) ? data.clips : null;
  if (!clips) {
    return NextResponse.json(
      { error: "El archivo de momentos está dañado — vuelve a correr el análisis." },
      { status: 409 }
    );
  }

  let body: { clips?: ClipPatch[] };
  try {
    body = (await req.json()) as { clips?: ClipPatch[] };
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }
  if (!Array.isArray(body.clips) || body.clips.length === 0) {
    return NextResponse.json(
      { error: "Falta indicar qué clips actualizar (clips: [{index, …}])." },
      { status: 400 }
    );
  }

  for (const p of body.clips) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= clips.length) {
      return NextResponse.json(
        { error: `El clip ${p?.index} no existe (hay ${clips.length} momentos).` },
        { status: 400 }
      );
    }
    const target = clips[p.index];
    const curStart = Number(target.start ?? 0);
    const curEnd = Number(target.end ?? 0);
    const newStart = p.start != null ? Number(p.start) : curStart;
    const newEnd = p.end != null ? Number(p.end) : curEnd;

    if (p.start != null || p.end != null) {
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd) || newStart < 0) {
        return NextResponse.json(
          { error: "Los tiempos del clip no son válidos." },
          { status: 400 }
        );
      }
      if (newStart >= newEnd) {
        return NextResponse.json(
          { error: "El inicio del clip debe quedar antes que el fin." },
          { status: 400 }
        );
      }
      const dur = newEnd - newStart;
      if (dur < MIN_CLIP_SECONDS || dur > MAX_CLIP_SECONDS) {
        return NextResponse.json(
          {
            error: `La duración debe quedar entre ${MIN_CLIP_SECONDS} y ${MAX_CLIP_SECONDS} segundos (quedó de ${Math.round(dur)} s).`,
          },
          { status: 400 }
        );
      }
      target.start = Math.round(newStart * 100) / 100;
      target.end = Math.round(newEnd * 100) / 100;
      // Algunos proposals traen "duration" precalculado: mantenerlo consistente.
      if ("duration" in target) {
        target.duration = Math.round(dur * 100) / 100;
      }
    }
    if (typeof p.approved === "boolean") {
      target.approved = p.approved;
    }
    if (typeof p.hook === "string") {
      const hook = p.hook.trim();
      if (hook.length < 3 || hook.length > 140) {
        return NextResponse.json(
          { error: "El gancho debe tener entre 3 y 140 caracteres." },
          { status: 400 }
        );
      }
      target.hook = hook;
    }
  }

  try {
    await writeJsonFileAtomic(filePath, data);
  } catch {
    return NextResponse.json(
      { error: "No se pudieron guardar los cambios. Intenta de nuevo." },
      { status: 500 }
    );
  }
  return NextResponse.json(data);
}
