"use client";

/**
 * Vista de "videos seleccionados" — los más virales, en GRID de tarjetas (3 columnas). Cada
 * tarjeta: miniatura del video (clic = reproducir EN LA MISMA PÁGINA, modal) con la puntuación de
 * viralidad y el ranking encima, título HUMANO corto, copy unificado (caption + hashtags, listo
 * para LinkedIn/TikTok/Instagram) con botón de copiar, y botón de miniatura custom.
 * Datos: /api/viral-ranking. Acá el usuario revisa + sube las miniaturas; después se programan.
 */
import { useEffect, useState } from "react";
import { Flame, Play, Loader2, Copy, Check, X, CheckCircle2 } from "lucide-react";
import { ThumbnailButton } from "@/components/produccion/thumbnail-button";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { toastError } from "@/lib/toast-error";

const NET_STATUS: Record<string, string> = {
  pending: "programado",
  running: "publicando…",
  uploaded: "subido",
  published: "publicado",
  pending_manual: "esperando",
};

interface ViralVideo {
  id: string;
  source: "long_form";
  score: number;
  title: string;
  theme: string;
  style: string | null;
  copy: string;
  /** Score explicable: por qué puntúa así (hook, emoción, datos, ritmo…). */
  reasons?: string[];
  factors?: Record<string, number> | null;
}

const FACTOR_LABEL: Record<string, string> = {
  hook: "Gancho",
  emotion: "Emoción",
  data: "Datos",
  pace: "Ritmo",
  length: "Duración",
  cta: "Cierre",
};

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
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null); // id del video reproduciéndose
  const [copied, setCopied] = useState<string | null>(null);
  // Por video: en qué redes ya está (para la etiqueta "ya en X red").
  const [byProject, setByProject] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    fetch("/api/viral-ranking")
      .then((r) => r.json())
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos.slice(0, TOP_N) : []))
      .catch((err) => {
        // Distinguir "falló la carga" de "no hay videos" (antes mostraba el mensaje equivocado).
        setLoadError(true);
        toastError(err, "No se cargó el ranking de videos virales");
      })
      .finally(() => setLoading(false));
    fetch("/api/scheduled/by-project")
      .then((r) => r.json())
      .then((d) => setByProject(d.byProject ?? {}))
      .catch((err) => toastError(err, "No se cargaron las etiquetas de redes"));
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
        {loadError
          ? "No se pudo cargar el ranking. Recarga la página para intentar de nuevo."
          : "No hay videos con puntuación de viralidad todavía."}
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
                  title={[
                    `Viralidad ${v.score}/100 — ${s.label}`,
                    ...(v.reasons?.length ? ["¿Por qué? " + v.reasons.join(" · ")] : []),
                    ...(v.factors
                      ? [
                          Object.entries(v.factors)
                            .map(([k, val]) => `${FACTOR_LABEL[k] ?? k} ${val}`)
                            .join(" · "),
                        ]
                      : []),
                  ].join("\n")}
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
                {v.style && (
                  <span className="-mt-0.5 w-fit rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {v.style}
                  </span>
                )}
                {v.reasons && v.reasons.length > 0 && (
                  <p
                    className="line-clamp-1 text-[10px] text-emerald-400/90"
                    title={`¿Por qué ${v.score}/100? ${v.reasons.join(" · ")}`}
                  >
                    🔥 {v.reasons.join(" · ")}
                  </p>
                )}
                {byProject[v.id] && Object.keys(byProject[v.id]).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(byProject[v.id]).map(([plat, status]) => {
                      const p = PLATFORMS[plat as PlatformKey];
                      return (
                        <span
                          key={plat}
                          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                          style={{ backgroundColor: p?.color ?? "#10b981" }}
                          title={`Ya ${NET_STATUS[status] ?? status} en ${p?.label ?? plat} — no se publica dos veces`}
                        >
                          <CheckCircle2 className="h-2.5 w-2.5" /> {p?.label ?? plat} · {NET_STATUS[status] ?? status}
                        </span>
                      );
                    })}
                  </div>
                )}
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
