"use client";

/**
 * Composer de publicación — Fase 1 de la sección "Programar y publicar" (estilo Postiz).
 * Escribís/elegís UNA vez: video (de tus renders) → redes → descripción → fecha/hora →
 * queda programado. Reusa la API que YA existe (/api/tiktok/schedule POST crea la entry para
 * cualquier red y lee el caption del proyecto). No copia código Postiz — replica su UX.
 * Aditivo: no toca el scheduler ni la publicación existentes.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, CalendarClock, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { cn } from "@/lib/utils";

// Solo las redes que el scheduler sabe manejar hoy (tiktok, linkedin, instagram vía bridge).
const SCHEDULABLE: { key: PlatformKey; platform: string }[] = [
  { key: "instagram", platform: "instagram_bridge" },
  { key: "linkedin", platform: "linkedin" },
  { key: "tiktok", platform: "tiktok" },
];

interface ProjectItem {
  id: string;
  source?: "short" | "long_form";
  caption?: string;
  captions?: Record<string, string>;
  updatedAt?: number;
}

function defaultWhenLocal(): string {
  // Mañana a las 10:00, formato datetime-local (YYYY-MM-DDTHH:mm).
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PublishComposer({
  open,
  onOpenChange,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onScheduled: () => void;
}) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [videoId, setVideoId] = useState<string>("");
  const [nets, setNets] = useState<Set<PlatformKey>>(new Set(["instagram"]));
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState(defaultWhenLocal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar los videos disponibles al abrir.
  useEffect(() => {
    if (!open) return;
    setLoadingProjects(true);
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list: ProjectItem[] = Array.isArray(d) ? d : d.projects ?? [];
        setProjects(list.filter((p) => p && p.id));
      })
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, [open]);

  const selected = useMemo(() => projects.find((p) => p.id === videoId), [projects, videoId]);

  // Al elegir video, pre-cargar el caption (del primer red seleccionada o el general).
  useEffect(() => {
    if (!selected) return;
    const firstNet = [...nets][0];
    const fromNet = firstNet && selected.captions?.[firstNet];
    setCaption(fromNet || selected.caption || "");
  }, [selected, nets]);

  function toggleNet(k: PlatformKey) {
    setNets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (!videoId) return setError("Elegí un video.");
    if (nets.size === 0) return setError("Elegí al menos una red.");
    const ts = new Date(when).getTime();
    if (!ts || Number.isNaN(ts)) return setError("Fecha/hora inválida.");
    if (ts < Date.now()) return setError("La fecha debe ser en el futuro.");

    setSubmitting(true);
    try {
      const platforms = [...nets]
        .map((k) => SCHEDULABLE.find((s) => s.key === k)?.platform)
        .filter(Boolean) as string[];
      // Una entry por red (reusa la API que valida render + persiste + la levanta el worker).
      const results = await Promise.all(
        platforms.map((platform) =>
          fetch("/api/tiktok/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: videoId,
              source: selected?.source ?? "short",
              platform,
              scheduledAt: ts,
              caption: caption.trim(),
            }),
          }).then((r) => r.ok),
        ),
      );
      if (results.every(Boolean)) {
        onScheduled();
        onOpenChange(false);
        // reset
        setVideoId("");
        setCaption("");
        setWhen(defaultWhenLocal());
      } else {
        setError("Alguna red no se pudo programar. Revisá que el video tenga render.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al programar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-emerald-400" /> Nuevo post
          </DialogTitle>
          <DialogDescription>
            Elegí el video, las redes, la descripción y la fecha. Se programa y publica solo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Video</label>
            {loadingProjects ? (
              <p className="text-xs text-muted-foreground">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Cargando tus videos…
              </p>
            ) : (
              <select
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— Elegí un video —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Redes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Redes</label>
            <div className="flex flex-wrap gap-2">
              {SCHEDULABLE.map(({ key }) => {
                const p = PLATFORMS[key];
                const on = nets.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleNet(key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                      on ? "border-transparent text-white" : "border-border hover:border-foreground/40",
                    )}
                    style={on ? { backgroundColor: p.color } : undefined}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Descripción */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Descripción
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="La descripción del post (se pre-carga del video)…"
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Fecha/hora */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Fecha y hora
            </label>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm transition hover:border-foreground/40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Programar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
