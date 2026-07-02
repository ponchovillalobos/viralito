import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LF_ROOT, LF_RENDERS } from "@/lib/paths";
import { styleFromId, contentSlugFromId } from "@/lib/viral-meta";

// Ranking de viralidad de los clips ya renderizados. Une los proposals (que tienen viralityScore,
// hook, caption por slug) con los renders existentes, deduplica por tema y devuelve el top ordenado.
// Da un TÍTULO HUMANO corto por video (del hook) para la lista, en vez del id feo del archivo.
export const dynamic = "force-dynamic";

interface Clip {
  slug: string;
  score: number;
  hook: string;
  theme: string;
  caption: string;
  hashtags: string[];
  /** Score EXPLICABLE: por qué este clip puntúa así (de virality.py). */
  reasons: string[];
  /** Desglose 0-100 por factor (hook/emotion/data/pace/length/cta). */
  factors: Record<string, number> | null;
}

/** Copy unificado para postear en LinkedIn/TikTok/Instagram: caption viral (hook+valor+CTA) +
 *  hashtags en español sin acentos. La IA ya generó ambos; acá se combinan en un solo texto. */
function buildCopy(caption: string, hashtags: string[]): string {
  const c = (caption || "").trim();
  const tags = hashtags.filter((h) => typeof h === "string" && h.trim());
  return tags.length ? `${c}\n\n${tags.join(" ")}` : c;
}

/** Título humano corto desde el hook (o el slug si no hay hook). */
function humanTitle(hook: string, slug: string): string {
  let t = (hook || "").trim();
  if (!t) t = slug.replace(/-/g, " ");
  // primera letra mayúscula, cortar en ~52 chars sin partir palabra
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length > 52) {
    t = t.slice(0, 52);
    t = t.slice(0, t.lastIndexOf(" ")) + "…";
  }
  return t;
}

const STOP = new Set(
  "de la el en un una y a que se es su tu los las por con para no del al lo".split(" "),
);

function signature(slug: string, theme: string): string {
  const words = slug
    .toLowerCase()
    .split(/[-_ ]+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .sort()
    .slice(0, 3);
  return words.length ? words.join("|") : theme.toLowerCase();
}

// Caché por archivo (mtime): los proposals casi no cambian y esta ruta se consulta seguido.
const proposalCache = new Map<string, { mtimeMs: number; clips: Clip[] }>();

export async function GET() {
  try {
    const propDir = path.join(LF_ROOT, "proposals");
    const clips = new Map<string, Clip>();
    let files: string[] = [];
    try {
      files = (await fs.readdir(propDir)).filter((f) => f.endsWith(".json"));
    } catch {
      /* sin proposals */
    }
    // Lecturas en PARALELO (antes eran seriales) + caché por mtime.
    const perFile = await Promise.all(
      files.map(async (f): Promise<Clip[]> => {
        const fp = path.join(propDir, f);
        try {
          const stat = await fs.stat(fp);
          const cached = proposalCache.get(fp);
          if (cached && cached.mtimeMs === stat.mtimeMs) return cached.clips;
          const d = JSON.parse(await fs.readFile(fp, "utf-8"));
          const arr: unknown[] = d.clips ?? d.proposals ?? (Array.isArray(d) ? d : []);
          const out: Clip[] = [];
          for (const c of arr) {
            if (!c || typeof c !== "object") continue;
            const o = c as Record<string, unknown>;
            const slug = typeof o.slug === "string" ? o.slug : "";
            if (!slug) continue;
            out.push({
              slug,
              score: typeof o.viralityScore === "number" ? o.viralityScore : 0,
              hook: typeof o.hook === "string" ? o.hook : "",
              theme: typeof o.theme === "string" ? o.theme : "",
              caption: typeof o.caption === "string" ? o.caption : "",
              hashtags: Array.isArray(o.hashtags)
                ? (o.hashtags as unknown[]).filter((x): x is string => typeof x === "string")
                : [],
              reasons: Array.isArray(o.viralityReasons)
                ? (o.viralityReasons as unknown[]).filter((x): x is string => typeof x === "string")
                : [],
              factors:
                o.factors && typeof o.factors === "object" && !Array.isArray(o.factors)
                  ? (o.factors as Record<string, number>)
                  : null,
            });
          }
          proposalCache.set(fp, { mtimeMs: stat.mtimeMs, clips: out });
          return out;
        } catch {
          return []; /* archivo corrupto */
        }
      }),
    );
    for (const list of perFile) {
      for (const c of list) {
        const prev = clips.get(c.slug);
        if (!prev || c.score > prev.score) clips.set(c.slug, c);
      }
    }

    // renders existentes
    let renders: string[] = [];
    try {
      renders = (await fs.readdir(LF_RENDERS))
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => f.slice(0, -4));
    } catch {
      /* sin renders */
    }
    const norm = (s: string) => s.replace(/[-_ ]/g, "").toLowerCase();

    // Índice slug-normalizado → clip: match O(1) por render (antes era renders × clips).
    const bySlugNorm = new Map<string, Clip>();
    for (const clip of clips.values()) {
      const key = norm(clip.slug);
      if (!key) continue;
      const prev = bySlugNorm.get(key);
      if (!prev || clip.score > prev.score) bySlugNorm.set(key, clip);
    }

    const matched: Array<{ id: string; clip: Clip }> = [];
    const seenSlug = new Set<string>();
    for (const r of renders) {
      // Camino rápido: slug extraído del id → lookup directo.
      let best: Clip | null = bySlugNorm.get(norm(contentSlugFromId(r))) ?? null;
      if (!best) {
        // Fallback para ids con otro formato: scan por substring como antes.
        const nr = norm(r);
        for (const clip of clips.values()) {
          if (norm(clip.slug) && nr.includes(norm(clip.slug))) {
            if (!best || clip.score > best.score) best = clip;
          }
        }
      }
      if (best && !seenSlug.has(best.slug)) {
        seenSlug.add(best.slug);
        matched.push({ id: r, clip: best });
      }
    }
    matched.sort((a, b) => b.clip.score - a.clip.score);

    // dedup por tema/firma → variedad
    const seenSig = new Set<string>();
    const ranked = [];
    for (const m of matched) {
      const sig = signature(m.clip.slug, m.clip.theme);
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);
      ranked.push({
        id: m.id,
        source: "long_form" as const,
        score: m.clip.score,
        title: humanTitle(m.clip.hook, m.clip.slug),
        theme: m.clip.theme,
        style: styleFromId(m.id),
        // copy unificado (caption + hashtags) para postear en LinkedIn/TikTok/Instagram.
        copy: buildCopy(m.clip.caption, m.clip.hashtags),
        // Score EXPLICABLE — por qué puntúa así (para el tooltip/desglose de la tarjeta).
        reasons: m.clip.reasons,
        factors: m.clip.factors,
      });
    }

    return NextResponse.json({ total: ranked.length, videos: ranked });
  } catch (e) {
    return NextResponse.json(
      { videos: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
