"use client";

/**
 * Vista de "videos seleccionados" — los más virales, en GRID de tarjetas (3 columnas) para ver
 * más de un vistazo. Cada tarjeta: miniatura del video (clic = reproducir) con la puntuación de
 * viralidad y el ranking encima, título HUMANO corto, copy viral, y botón de miniatura custom.
 * Datos: /api/viral-ranking. Acá el usuario revisa + sube las miniaturas; después se programan.
 */
import { useEffect, useState } from "react";
import { Flame, Play, Loader2 } from "lucide-react";
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

  useEffect(() => {
    fetch("/api/viral-ranking")
      .then((r) => r.json())
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos.slice(0, TOP_N) : []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  }, []);

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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v, i) => {
        const s = scoreStyle(v.score);
        return (
          <div
            key={v.id}
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-foreground/20"
          >
            {/* Miniatura del video (clic = reproducir) con score + ranking encima */}
            <a
              href={`/api/videos/${encodeURIComponent(v.id)}/stream?source=render`}
              target="_blank"
              rel="noreferrer"
              className="group relative block aspect-[4/5] overflow-hidden bg-zinc-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/videos/${encodeURIComponent(v.id)}/thumbnail`}
                alt={v.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
              />
              <span
                className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-sm font-bold shadow"
                style={{ backgroundColor: s.bg, color: s.text }}
                title={`Viralidad ${v.score}/100 — ${s.label}`}
              >
                <Flame className="h-3 w-3" />
                {Math.round(v.score)}
              </span>
              <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                #{i + 1}
              </span>
              <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-lg">
                  <Play className="h-4 w-4 fill-black text-black" />
                </span>
              </span>
            </a>

            {/* Contenido */}
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              <h3 className="line-clamp-2 text-[13px] font-semibold leading-tight" title={v.title}>
                {v.title}
              </h3>
              {v.caption && (
                <p className="line-clamp-3 flex-1 text-[11px] leading-snug text-muted-foreground">
                  {v.caption}
                </p>
              )}
              <div className="pt-0.5">
                <ThumbnailButton projectId={v.id} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
