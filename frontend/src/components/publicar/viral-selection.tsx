"use client";

/**
 * Vista de "videos seleccionados" — los más virales, en GRID de tarjetas (3 columnas). Cada
 * tarjeta: miniatura del video (clic = reproducir EN LA MISMA PÁGINA, modal) con la puntuación de
 * viralidad y el ranking encima, título HUMANO corto, copy unificado (caption + hashtags, listo
 * para LinkedIn/TikTok/Instagram) con botón de copiar, y botón de miniatura custom.
 * Datos: /api/viral-ranking. Acá el usuario revisa + sube las miniaturas; después se programan.
 */
import { useEffect, useState } from "react";
import { Flame, Play, Loader2, Copy, Check, X } from "lucide-react";
import { ThumbnailButton } from "@/components/produccion/thumbnail-button";

interface ViralVideo {
  id: string;
  source: "long_form";
  score: number;
  title: string;
  theme: string;
  copy: string;
}

const TOP_N = 24;

function scoreStyle(score: number): { bg: string; text: string; label: string } {
  if (score >= 60) return { bg: "#dc2626", text: "#fff", label: "🔥 Muy viral" };
  if (score >= 45) return { bg: "#f59e0b", text: "#fff", label: "Alto" };
  if (score >= 35) return { bg: "#10b981", text: "#fff", label: "Bueno" };
  return { bg: "#64748b", text: "#fff", label: "Medio" };
}

export function ViralSelection() {
  const [videos, setVideos] = useState<ViralVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null); // id del video reproduciéndose
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/viral-ranking")
      .then((r) => r.json())
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos.slice(0, TOP_N) : []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  }, []);

  async function copyCopy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard no disponible */
    }
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
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v, i) => {
          const s = scoreStyle(v.score);
          return (
            <div
              key={v.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-foreground/20"
            >
              {/* Miniatura → reproducir en modal (misma página) */}
              <button
                type="button"
                onClick={() => setPlaying(v.id)}
                className="group relative block aspect-[4/5] overflow-hidden bg-zinc-900 text-left"
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
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                  <span className="flex h-11 w-11 scale-90 items-center justify-center rounded-full bg-white/95 opacity-0 shadow-lg transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
                    <Play className="h-5 w-5 fill-black text-black" />
                  </span>
                </span>
              </button>

              {/* Contenido */}
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <h3 className="line-clamp-2 text-[13px] font-semibold leading-tight" title={v.title}>
                  {v.title}
                </h3>
                {v.copy && (
                  <p className="line-clamp-4 flex-1 whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">
                    {v.copy}
                  </p>
                )}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => copyCopy(v.id, v.copy)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition hover:border-foreground/40"
                    title="Copiar el copy (con hashtags) para pegarlo en cualquier red"
                  >
                    {copied === v.id ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copied === v.id ? "Copiado" : "Copiar copy"}
                  </button>
                  <ThumbnailButton projectId={v.id} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reproductor inline (modal en la misma página) */}
      {playing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPlaying(null)}
          role="presentation"
        >
          <div className="relative" onClick={(e) => e.stopPropagation()} role="presentation">
            <button
              type="button"
              onClick={() => setPlaying(null)}
              className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg hover:bg-white/90"
              title="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={`/api/videos/${encodeURIComponent(playing)}/stream?source=render`}
              controls
              autoPlay
              className="max-h-[85vh] max-w-[92vw] rounded-lg bg-black shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
