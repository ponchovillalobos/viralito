import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LF_ROOT, LF_RENDERS } from "@/lib/paths";

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
    for (const f of files) {
      try {
        const raw = await fs.readFile(path.join(propDir, f), "utf-8");
        const d = JSON.parse(raw);
        const arr: unknown[] = d.clips ?? d.proposals ?? (Array.isArray(d) ? d : []);
        for (const c of arr) {
          if (!c || typeof c !== "object") continue;
          const o = c as Record<string, unknown>;
          const slug = typeof o.slug === "string" ? o.slug : "";
          if (!slug) continue;
          const score = typeof o.viralityScore === "number" ? o.viralityScore : 0;
          const prev = clips.get(slug);
          if (!prev || score > prev.score) {
            clips.set(slug, {
              slug,
              score,
              hook: typeof o.hook === "string" ? o.hook : "",
              theme: typeof o.theme === "string" ? o.theme : "",
              caption: typeof o.caption === "string" ? o.caption : "",
              hashtags: Array.isArray(o.hashtags)
                ? (o.hashtags as unknown[]).filter((x): x is string => typeof x === "string")
                : [],
            });
          }
        }
      } catch {
        /* archivo corrupto */
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

    const matched: Array<{ id: string; clip: Clip }> = [];
    const seenSlug = new Set<string>();
    for (const r of renders) {
      const nr = norm(r);
      let best: Clip | null = null;
      for (const clip of clips.values()) {
        if (norm(clip.slug) && nr.includes(norm(clip.slug))) {
          if (!best || clip.score > best.score) best = clip;
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
        // copy unificado (caption + hashtags) para postear en LinkedIn/TikTok/Instagram.
        copy: buildCopy(m.clip.caption, m.clip.hashtags),
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
