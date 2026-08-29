import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_ROOT } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Plantillas guardables: combos favoritos de estilo+color+fuente+plataformas que el
// usuario reusa con un click. Se guardan en un JSON local (no en el repo).
const TEMPLATES_FILE = path.join(DATA_ROOT, "templates.json");

interface Template {
  id: string;
  name: string;
  styles: string[];
  accentColor: string;
  subtitleFont: string;
  /** Color del TEXTO de los subtítulos ("auto" = el del estilo). */
  subtitleColor?: string;
  /** Música de fondo: "auto" | "none" | { mood }. Default "auto". */
  music?: "auto" | "none" | { mood: string };
  platforms: string[];
  aspectRatio: "9:16" | "16:9";
  createdAt: string;
  /** Si vino del feed de plantillas del estudio, el id curado (para no re-ofrecerla). */
  feedId?: string;
}

async function readTemplates(): Promise<Template[]> {
  try {
    const raw = await fs.readFile(TEMPLATES_FILE, "utf-8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeTemplates(list: Template[]): Promise<void> {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.writeFile(TEMPLATES_FILE, JSON.stringify(list, null, 2), "utf-8");
}

const noStore = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET() {
  return NextResponse.json({ templates: await readTemplates() }, noStore);
}

export async function POST(req: NextRequest) {
  let body: Partial<Template>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "falta el nombre" }, { status: 400 });
  if (!Array.isArray(body.styles) || body.styles.length === 0) {
    return NextResponse.json({ error: "falta al menos un estilo" }, { status: 400 });
  }

  const tpl: Template = {
    id: randomUUID().slice(0, 8),
    name: name.slice(0, 60),
    styles: body.styles,
    accentColor: body.accentColor || "#fb7185",
    subtitleFont: body.subtitleFont || "auto",
    subtitleColor: body.subtitleColor || "auto",
    music: body.music ?? "auto",
    platforms: Array.isArray(body.platforms) ? body.platforms : [],
    aspectRatio: body.aspectRatio === "16:9" ? "16:9" : "9:16",
    createdAt: new Date().toISOString(),
    feedId: typeof body.feedId === "string" && body.feedId.trim() ? body.feedId.trim().slice(0, 60) : undefined,
  };

  const list = await readTemplates();
  // Si ya existe una con el mismo nombre, la reemplaza (update). Si no, agrega.
  const idx = list.findIndex((t) => t.name.toLowerCase() === tpl.name.toLowerCase());
  // Iba en una línea con el operador coma (`tpl.id = ..., (list[idx] = tpl)`).
  // Hacía lo correcto, pero se lee como si la segunda mitad fuera un descuido.
  if (idx >= 0) {
    tpl.id = list[idx].id; // conserva el id de la plantilla que reemplaza
    list[idx] = tpl;
  } else {
    list.unshift(tpl);
  }
  await writeTemplates(list);
  return NextResponse.json({ ok: true, template: tpl }, noStore);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "falta id" }, { status: 400 });
  const list = await readTemplates();
  const next = list.filter((t) => t.id !== id);
  await writeTemplates(next);
  return NextResponse.json({ ok: true, deleted: list.length - next.length }, noStore);
}
