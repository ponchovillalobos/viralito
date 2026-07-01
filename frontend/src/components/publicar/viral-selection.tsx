"use client";

/**
 * Vista de "videos seleccionados" — los más virales, ordenados por puntuación. Diseño limpio y
 * escaneable: título HUMANO corto (no el id feo del archivo), la puntuación de viralidad EN GRANDE,
 * el copy viral, botón de miniatura y de ver. Acá el usuario revisa + sube las miniaturas; después
 * se programan. Datos: /api/viral-ranking.
 */
import { useEffect, useState } from "react";
import { Flame, Play, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { ThumbnailButton } from "@/components/produccion/thumbnail-button";

interface ViralVideo {
  id: string;
  source: "long_form";
  score: number;
  title: string;
  theme: string;
  caption: string;
}

const TOP_N = 24;

// Color de la puntuación por tramo (más viral = más caliente).
function scoreStyle(score: number): { bg: string; text: string; label: string } {
  if (score >= 60) return { bg: "#dc2626", text: "#fff", label: "🔥 Muy viral" };
  if (score >= 45) return { bg: "#f59e0b", text: "#fff", label: "Alto" };
  if (score >= 35) return { bg: "#10b981", text: "#fff", label: "Bueno" };
  return { bg: "#64748b", text: "#fff", label: "Medio" };
}

export function ViralSelection() {
  const [videos, setVideos] = useState<ViralVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/viral-ranking")
      .then((r) => r.json())
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos.slice(0, TOP_N) : []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  if (loading) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Calculando el ranking viral…
      </p>
    );
  }
  if (!videos.length) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No hay videos con puntuación de viralidad todavía.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {videos.map((v, i) => {
        const s = scoreStyle(v.score);
        const isOpen = expanded.has(v.id);
        return (
          <div
            key={v.id}
            className="flex gap-3 rounded-xl border border-border bg-card p-3 transition hover:border-foreground/20"
          >
            {/* Miniatura del video (preview) con la puntuación EN GRANDE encima */}
            <div className="relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/videos/${encodeURIComponent(v.id)}/thumbnail`}
                alt={v.title}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span
                className="absolute left-1 top-1 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm font-bold shadow"
                style={{ backgroundColor: s.bg, color: s.text }}
                title={`Viralidad ${v.score}/100 — ${s.label}`}
              >
                <Flame className="h-3 w-3" />
                {Math.round(v.score)}
              </span>
            </div>

            {/* Contenido */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-semibold leading-tight">
                  <span className="mr-1.5 text-xs font-normal text-muted-foreground">#{i + 1}</span>
                  {v.title}
                </h3>
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${s.bg}22`, color: s.bg }}>
                  {s.label}
                </span>
              </div>

              {/* Copy viral (clamp a 2 líneas, expandible) */}
              {v.caption && (
                <div className="mt-1">
                  <p className={`text-xs text-muted-foreground ${isOpen ? "" : "line-clamp-2"}`}>
                    {v.caption}
                  </p>
                  {v.caption.length > 120 && (
                    <button
                      type="button"
                      onClick={() => toggle(v.id)}
                      className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isOpen ? "menos" : "ver copy completo"}
                    </button>
                  )}
                </div>
              )}

              {/* Acciones limpias */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={`/api/videos/${encodeURIComponent(v.id)}/stream?source=render`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition hover:border-foreground/40"
                >
                  <Play className="h-3 w-3" /> Ver
                </a>
                <ThumbnailButton projectId={v.id} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
