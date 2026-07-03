"use client";

// Thumbnails dinámicos de /api/videos/[id]/thumbnail. next/image requeriría
// width/height fijos por video y reservar layout, lo que choca con el aspect-9:16
// flexible que usamos. <img> con loading="lazy" cubre la performance bien.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCcw, FileVideo, CheckCircle2, Circle, Pencil, Archive, ArchiveRestore, Upload, Loader2, Trash2 } from "lucide-react";
import { RenameDialog } from "@/components/editor/rename-dialog";
import { HelpHint } from "@/components/ui/help-hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";

interface VideoEntry {
  id: string;
  filename: string;
  sizeMb: number;
  modified: string;
  durationSec: number | null;
  archived: boolean;
  status: {
    transcribed: boolean;
    cuts: boolean;
    rendered: boolean;
    projectExists: boolean;
  };
}

function formatDuration(s: number | null): string {
  if (s === null) return "?";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VideoList() {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Video pendiente de borrado definitivo — abre el diálogo de confirmación propio.
  const [deleting, setDeleting] = useState<VideoEntry | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sube videos desde la compu del usuario (multipart) → /api/videos/import → RAW_DIR.
  // Misma lógica que el wizard, para que el editor también sea un punto de entrada claro.
  async function importVideos(files: FileList | File[]) {
    setImporting(true);
    let ok = 0;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/videos/import", { method: "POST", body: form });
        if (r.ok) {
          ok++;
        } else {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          toastError(data.error ?? `HTTP ${r.status}`, `No se pudo subir «${file.name}»`);
        }
      }
      if (ok > 0) {
        toast.success(ok === 1 ? "1 video subido ✓" : `${ok} videos subidos ✓`);
      }
      load();
    } catch (err) {
      toastError(err, "No se pudieron subir tus videos");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/list?archived=${showArchived}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setVideos(data.videos);
      setActiveCount(data.activeCount ?? 0);
      setArchivedCount(data.archivedCount ?? 0);
    } catch (err) {
      toastError(err, "No se pudieron cargar tus videos");
      setError("No se pudieron cargar tus videos. Revisa que la app siga abierta y toca «Recargar».");
    } finally {
      setLoading(false);
    }
  }

  async function archive(video: VideoEntry) {
    if (!confirm(`¿Mover «${video.filename}» a "usados"?\n\nTus shorts ya generados se conservan; solo se oculta de la lista principal.`)) return;
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(video.id)}/archive`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`«${video.filename}» movido a usados`);
      load();
    } catch (err) {
      toastError(err, "No se pudo mover el video a usados");
    }
  }

  async function unarchive(video: VideoEntry) {
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(video.id)}/archive`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`«${video.filename}» restaurado`);
      load();
    } catch (err) {
      toastError(err, "No se pudo restaurar el video");
    }
  }

  // Borrado DEFINITIVO: elimina el archivo del disco + sus derivados (proyectos,
  // renders, etc.). Irreversible → diálogo de confirmación propio (ver JSX abajo).
  async function removeVideo(video: VideoEntry) {
    setDeletingBusy(true);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(video.id)}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`«${video.filename}» borrado`);
      setDeleting(null);
      load();
    } catch (err) {
      toastError(err, "No se pudo borrar el video");
    } finally {
      setDeletingBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono-tab text-xs text-muted-foreground">
            {activeCount} activos
            {archivedCount > 0 && ` · ${archivedCount} usados`}
          </span>
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            ¿Qué significan las etiquetas?
            <HelpHint label="Qué significan las etiquetas de cada video" width="w-72">
              Cada video muestra su progreso: <strong>Transcripción</strong> = ya le sacamos
              el texto de lo que se dice; <strong>Cortes</strong> = le quitamos los silencios;{" "}
              <strong>Listo</strong> = ya tiene un video final generado.
            </HelpHint>
          </span>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              aria-label={showArchived ? "Ocultar los videos usados" : "Mostrar los videos usados"}
              className="rounded border border-border bg-card px-2 py-1 text-[10px] hover:bg-muted"
            >
              {showArchived ? "Ocultar usados" : "Mostrar usados"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && e.target.files.length > 0 && importVideos(e.target.files)}
          />
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Subir uno o más videos desde tu computadora"
          >
            {importing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Subir desde mi compu
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            Recargar
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </Card>
      )}

      {!loading && videos.length === 0 && !error && (
        <Card className="border-dashed border-border bg-card p-10 text-center">
          <FileVideo className="mx-auto mb-3 h-10 w-10 text-muted-foreground opacity-60" />
          <p className="text-base font-medium text-foreground">
            Tu próximo short empieza aquí — sube cualquier video hablado y la IA hace el resto.
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Sube tu primer video desde tu compu. Después toca{" "}
            <strong className="text-foreground">«Crear automático»</strong> y la IA lo edita
            por ti: subtítulos, efectos, música y descripción listos para publicar.
          </p>
          <Button
            className="mt-4"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Subir mi primer video
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {videos.map((v) => (
          <div
            key={v.id}
            className={`group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:border-foreground/30 ${
              v.archived ? "opacity-60 border-dashed border-border" : "border-border"
            }`}
          >
            {v.archived && (
              <div className="absolute top-2 left-2 z-10 rounded bg-zinc-900/90 px-2 py-0.5 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
                usado
              </div>
            )}
            <Link href={`/editor/${encodeURIComponent(v.id)}`} className="block">
              <div className="relative aspect-[9/16] bg-zinc-900">
                <img
                  src={`/api/videos/${encodeURIComponent(v.id)}/thumbnail`}
                  alt={v.filename}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono-tab text-[10px]">
                  {formatDuration(v.durationSec)}
                </span>
              </div>
            </Link>
            <div className="space-y-1.5 p-2.5">
              <div className="flex items-start gap-1.5">
                <h3 className="line-clamp-2 flex-1 text-xs font-medium leading-snug">{v.filename}</h3>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setRenaming(v.id);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Renombrar ${v.filename}`}
                    title="Renombrar"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {v.archived ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        unarchive(v);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand-pink"
                      title="Restaurar"
                    >
                      <ArchiveRestore className="h-3 w-3" />
                    </button>
                  ) : v.status.rendered ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        archive(v);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Mover a usados (conserva los shorts ya hechos)"
                    >
                      <Archive className="h-3 w-3" />
                    </button>
                  ) : null}
                  {/* Borrar SIEMPRE disponible: elimina el video del disco para que
                      desaparezca de todo el portal. Irreversible (pide confirmación). */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setDeleting(v);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400"
                    aria-label={`Borrar ${v.filename} para siempre (del disco)`}
                    title="Borrar para siempre (del disco)"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                <StatusBadge label="Transcripción" on={v.status.transcribed} />
                <StatusBadge label="Cortes" on={v.status.cuts} />
                <StatusBadge label="Listo" on={v.status.rendered} />
              </div>
              <p className="font-mono-tab text-[10px] text-muted-foreground">
                {v.sizeMb} MB · {new Date(v.modified).toLocaleString("es")}
              </p>
            </div>
          </div>
        ))}
      </div>

      {renaming && (
        <RenameDialog
          currentId={renaming}
          open={true}
          onOpenChange={(o) => !o && setRenaming(null)}
          onRenamed={() => {
            setRenaming(null);
            load();
          }}
        />
      )}

      {/* Confirmación de borrado definitivo — diálogo propio con el nombre del archivo. */}
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && !deletingBusy && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Borrar «{deleting?.filename}» para siempre?</DialogTitle>
            <DialogDescription>
              Se elimina SOLO este video original. Los videos ya generados con él se
              conservan en Mis videos. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setDeleting(null)}
              disabled={deletingBusy}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && removeVideo(deleting)}
              disabled={deletingBusy}
            >
              {deletingBusy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Borrar para siempre
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${
        on
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {on ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}
