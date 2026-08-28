"use client";

// Thumbnails dinámicos de /api/videos/[id]/thumbnail.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectCardSkeleton } from "@/components/ui/skeleton";
import { RefreshCcw, ExternalLink, Clock, Copy, Check, Sparkles, Loader2, Search, X, Play, Calendar, Camera, Trash2, CheckSquare, FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toastError } from "@/lib/toast-error";
import { ScheduleDialog } from "@/components/produccion/schedule-dialog";
import { ThumbnailButton } from "@/components/produccion/thumbnail-button";
import { InstagramHelperDialog } from "@/components/produccion/instagram-helper-dialog";
import { ScheduleStatusBadge } from "@/components/produccion/schedule-status-badge";
import { MarcadorDeRedes, type MarcasDeVideo } from "@/components/produccion/marcador-de-redes";
import { FilterChip } from "@/components/produccion/filter-chip";
import { ProjectPreviewDialog } from "@/components/produccion/project-preview-dialog";
import * as publishActions from "@/lib/produccion/publish-actions";
import * as scheduleHelpers from "@/lib/produccion/schedule-helpers";
import { PUBLISHING_ENABLED } from "@/lib/app-mode";
import * as transcriptHelpers from "@/lib/produccion/transcript-helpers";
import {
  STATUS_COLOR,
  STATUS_OPTIONS,
  PLATFORM_OPTIONS,
  STYLE_LABEL,
  pickCaptionForPlatform,
  type StatusFilter,
  type PlatformFilter,
  type ProjectExt,
} from "@/components/produccion/produccion-types";

export function ProductionList() {
  const [projects, setProjects] = useState<ProjectExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectExt | null>(null);
  const [instagramHelperTarget, setInstagramHelperTarget] = useState<ProjectExt | null>(null);
  const [publishingToLinkedin, setPublishingToLinkedin] = useState<string | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ProjectExt | null>(null);
  const [tiktokHandle, setTiktokHandle] = useState<string>("");
  const [instagramHandle, setInstagramHandle] = useState<string>("");
  const [instagramConnected, setInstagramConnected] = useState<boolean>(false);
  const [publishingToInstagram, setPublishingToInstagram] = useState<string | null>(null);
  const [linkedinHandle, setLinkedinHandle] = useState<string>("");
  const [linkedinConnected, setLinkedinConnected] = useState<boolean>(false);
  const [scheduledByProjectId, setScheduledByProjectId] = useState<
    Record<string, Partial<Record<"tiktok" | "linkedin" | "instagram_bridge", { status: string; scheduledAt: number }>>>
  >({});
  // "Ya lo subí a…" — marcas puestas a mano, una lectura para toda la lista.
  const [publicadoPorId, setPublicadoPorId] = useState<Record<string, MarcasDeVideo>>({});
  const [transcriptByVideoId, setTranscriptByVideoId] = useState<Record<string, string>>({});
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterPlatform, setFilterPlatform] = useState<PlatformFilter>("all");
  // Selección múltiple para borrar en lote.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // Confirmación de borrado con nuestro propio diálogo (nada de confirm() nativo).
  const [deleteTarget, setDeleteTarget] = useState<ProjectExt | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  // Variante de estilo activa por grupo (clip con varios estilos): key del grupo → id del proyecto.
  const [activeVariant, setActiveVariant] = useState<Record<string, string>>({});

  // Deep-link: /publicar?q=<texto> pre-filtra la lista (p.ej. el botón "ver mi video de
  // Mejores Momentos" del wizard abre acá filtrado directo al reel recién creado).
  // El filtro inicial sale del hook de Next, no de leer `window` en un efecto.
  //
  // Con el efecto la lista se pintaba UNA VEZ sin filtrar y despues se corregia
  // — un parpadeo visible cuando venis del enlace del asistente. Y era un
  // setState sincrono dentro de un efecto, el render en cascada que React 19
  // marca como error. `useSearchParams` funciona igual en el render del servidor
  // y en el del navegador, asi que no hay desajuste de hidratacion.
  const parametros = useSearchParams();
  const qInicial = parametros.get("q") ?? "";
  const [prevQ, setPrevQ] = useState(qInicial);
  if (prevQ !== qInicial) {
    setPrevQ(qInicial);
    if (qInicial) setSearch(qInicial);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return projects.filter((p) => {
      if (filterStatus !== "all" && p.status !== filterStatus) return false;
      if (filterPlatform !== "all" && !(p.platforms?.includes(filterPlatform) ?? false)) return false;
      if (q) {
        const haystack = `${p.id} ${p.title ?? ""} ${p.caption ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, filterStatus, filterPlatform]);

  // Agrupa las VARIANTES de estilo del MISMO clip en un solo grupo → una tarjeta en vez
  // de N "repetidas". El base se obtiene quitando el sufijo `_{styleId}` del id (un clip de
  // largos `..._editorial` y `..._supreme` comparten base). Los cortos suelen quedar solos
  // (sus ids no terminan en `_{styleId}`). El orden se preserva: la 1ª variante (la más
  // reciente, por el sort de /api/projects) fija la posición del grupo.
  const groups = useMemo(() => {
    const baseKey = (p: ProjectExt) =>
      p.styleId && p.id.endsWith(`_${p.styleId}`)
        ? p.id.slice(0, -(p.styleId.length + 1))
        : p.id;
    const out: { key: string; variants: ProjectExt[] }[] = [];
    const idx = new Map<string, number>();
    for (const p of filtered) {
      const k = baseKey(p);
      const i = idx.get(k);
      if (i != null) out[i].variants.push(p);
      else {
        idx.set(k, out.length);
        out.push({ key: k, variants: [p] });
      }
    }
    return out;
  }, [filtered]);

  const hasActiveFilters = search !== "" || filterStatus !== "all" || filterPlatform !== "all";

  function clearFilters() {
    setSearch("");
    setFilterStatus("all");
    setFilterPlatform("all");
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch (err) {
      toastError(err, "No se pudieron cargar tus videos", {
        action: { label: "Intentar de nuevo", onClick: load },
      });
    } finally {
      setLoading(false);
    }
  }

  // Borra el video de "Mis videos" (su JSON + el archivo generado). No toca el video
  // original. Optimista: lo saco de la lista ya; si falla, aviso y recargo para restaurar.
  async function doRemoveProject(p: ProjectExt) {
    setDeleteTarget(null);
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      toastError(err, "No se pudo borrar el video", {
        action: { label: "Intentar de nuevo", onClick: () => doRemoveProject(p) },
      });
      load(); // restaurar si algo falló
    }
  }

  // Abre la carpeta donde está el archivo del video, con el archivo seleccionado.
  async function revealRender(p: ProjectExt) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}/reveal-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: p.source ?? "short" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      toastError(err, "No se pudo abrir la carpeta");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  // Borra TODOS los videos seleccionados (su JSON + el archivo generado).
  // No toca los videos originales. Reporta cuántos no se pudieron borrar.
  async function doRemoveSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchConfirmOpen(false);
    setDeleting(true);
    setProjects((prev) => prev.filter((x) => !selectedIds.has(x.id)));
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" })
            .then((r) => r.ok)
            .catch(() => false)
        )
      );
      const failedCount = results.filter((ok) => !ok).length;
      if (failedCount > 0) {
        toastError(
          new Error(`fallaron ${failedCount} de ${ids.length} borrados`),
          failedCount === 1
            ? "No se pudo borrar 1 de los videos"
            : `No se pudieron borrar ${failedCount} de los videos`
        );
      }
    } finally {
      setDeleting(false);
      exitSelectMode();
      load(); // refrescar contra el estado real del disco
    }
  }

  const copyCaption = (p: ProjectExt) => publishActions.copyCaption(p, setCopiedId);

  const publishToLinkedIn = (p: ProjectExt) =>
    publishActions.publishToLinkedIn(p, setPublishingToLinkedin);
  const publishToInstagram = (p: ProjectExt) =>
    publishActions.publishToInstagram(p, setPublishingToInstagram);
  const regenerate = (p: ProjectExt, provider: string = "auto") =>
    publishActions.regenerate(p, setRegenerating, load, provider);

  // Carga el transcript del video. Cacheado por videoId.
  const loadTranscript = (videoId: string) =>
    transcriptHelpers.loadTranscript(
      videoId,
      transcriptByVideoId,
      setLoadingTranscript,
      setTranscriptByVideoId
    );
  const copyTranscript = (videoId: string) =>
    transcriptHelpers.copyTranscript(videoId, transcriptByVideoId, setTranscriptCopied);

  const loadSchedule = () => scheduleHelpers.loadSchedule(setScheduledByProjectId);

  // Load on mount: proyectos + schedules + settings. Patrón válido aunque el lint
  // quiere `use(promise)` (React 19); no migramos porque la pantalla tiene polling
  // y manejo de errores que mejor quedan aquí.
  useEffect(() => {
    load();
    loadSchedule();
    // Las marcas manuales no bloquean nada: si el archivo no existe todavia,
    // la lista se pinta igual y cada interruptor arranca apagado.
    fetch("/api/publicado")
      .then((r) => r.json())
      .then((d) => setPublicadoPorId(d.videos ?? {}))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setTiktokHandle(d.handles?.tiktok ?? "");
        setInstagramHandle(d.handles?.instagram ?? "");
        setInstagramConnected(Boolean(d.instagram?.hasAccessToken));
        setLinkedinHandle(d.handles?.linkedin ?? "");
        setLinkedinConnected(Boolean(d.linkedin?.hasAccessToken));
      })
      .catch((err) => toastError(err, "No se pudo verificar la conexión de tus redes"));
  }, []);

  // Cuando se abre el preview, carga el transcript y resetea el feedback de copiado.
  // Patrón store-and-compare en vez de useEffect+setState.
  const previewVideoId = previewProject?.videoId;
  const [prevPreviewVideoId, setPrevPreviewVideoId] = useState<string | undefined>(previewVideoId);
  if (prevPreviewVideoId !== previewVideoId) {
    setPrevPreviewVideoId(previewVideoId);
    setTranscriptCopied(false);
    if (previewVideoId) loadTranscript(previewVideoId);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o descripción…"
              className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-1.5 text-sm placeholder:text-foreground/55 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="font-mono-tab text-xs text-muted-foreground">
              {hasActiveFilters
                ? `${filtered.length} de ${projects.length}`
                : projects.length}{" "}
              video{filtered.length === 1 ? "" : "s"}
            </span>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              Recargar
            </Button>
            <Button
              variant={selectMode ? "default" : "ghost"}
              size="sm"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              disabled={loading || projects.length === 0}
            >
              <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
              {selectMode ? "Cancelar" : "Seleccionar"}
            </Button>
          </div>
        </div>

        {/* Barra de acciones del modo selección — borrar varios a la vez. */}
        {selectMode && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <span className="font-mono-tab text-xs text-muted-foreground">
              {selectedIds.size} seleccionado{selectedIds.size === 1 ? "" : "s"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set(filtered.map((p) => p.id)))}
              disabled={filtered.length === 0}
            >
              Seleccionar todos ({filtered.length})
            </Button>
            {selectedIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                Limpiar selección
              </Button>
            )}
            <div className="ml-auto">
              <Button
                size="sm"
                onClick={() => setBatchConfirmOpen(true)}
                disabled={selectedIds.size === 0 || deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Borrar {selectedIds.size > 0 ? `(${selectedIds.size})` : "seleccionados"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground/70">
            estado:
          </span>
          {STATUS_OPTIONS.map((s) => (
            <FilterChip
              key={s}
              active={filterStatus === s}
              onClick={() => setFilterStatus(s)}
              label={s === "all" ? "todos" : s}
            />
          ))}

          <span className="ml-3 font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground/70">
            plataforma:
          </span>
          {PLATFORM_OPTIONS.map((pl) => (
            <FilterChip
              key={pl}
              active={filterPlatform === pl}
              onClick={() => setFilterPlatform(pl)}
              label={pl === "all" ? "todas" : pl}
            />
          ))}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" /> limpiar
            </button>
          )}
        </div>
      </div>

      {projects.length === 0 && loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      )}

      {projects.length === 0 && !loading && (
        <EmptyState
          icon={Sparkles}
          tone="brand"
          title="Todavía no tienes videos generados"
          description="Aquí van a aparecer tus videos ya editados, listos para subir a tus redes. Crea el primero eligiendo un video y un estilo."
          cta={{ label: "Crear mi primer video", href: "/editor" }}
        />
      )}

      {projects.length > 0 && filtered.length === 0 && (
        <EmptyState
          icon={Search}
          tone="muted"
          title="Sin coincidencias para los filtros actuales"
          description="Prueba cambiar el término de búsqueda o el filtro de estado/plataforma."
          cta={{ label: "Limpiar filtros", onClick: clearFilters }}
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2">
        {groups.map((g) => {
          // Variante activa del grupo: la elegida con los chips, o la 1ª (más reciente).
          const p = g.variants.find((v) => v.id === activeVariant[g.key]) ?? g.variants[0];
          return (
          <Card
            key={g.key}
            className={`group overflow-hidden bg-card p-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 ${
              selectMode && selectedIds.has(p.id)
                ? "border-red-500 ring-2 ring-red-500/50"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="grid grid-cols-[140px_1fr] gap-0">
              <button
                type="button"
                onClick={() => (selectMode ? toggleSelect(p.id) : setPreviewProject(p))}
                title={selectMode ? "Toca para seleccionarlo" : "Toca para verlo"}
                aria-label={
                  selectMode
                    ? `Seleccionar ${p.shortTitle || p.title || p.id}`
                    : `Ver ${p.shortTitle || p.title || p.id}`
                }
                className="group relative aspect-[9/16] cursor-pointer overflow-hidden bg-zinc-900 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {/* Casilla de selección (solo en modo selección). */}
                {selectMode && (
                  <span
                    className={`absolute left-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-md border-2 ${
                      selectedIds.has(p.id)
                        ? "border-red-500 bg-red-500 text-white"
                        : "border-white/80 bg-black/50 text-transparent"
                    }`}
                  >
                    <Check className="h-4 w-4" />
                  </span>
                )}
                <img
                  src={`/api/videos/${encodeURIComponent(p.videoId)}/thumbnail`}
                  alt={p.id}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
                {/* Play overlay on hover: backdrop oscuro + botón con scale-in. */}
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-11 w-11 scale-75 items-center justify-center rounded-full bg-white/95 opacity-0 shadow-lg transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
                    <Play className="h-5 w-5 fill-black text-black" />
                  </div>
                </div>
                <span
                  className="absolute right-1 top-1 rounded-md px-1.5 py-0.5 font-mono-tab text-[9px] uppercase"
                  style={{
                    background: `${STATUS_COLOR[p.status]}22`,
                    color: STATUS_COLOR[p.status],
                    border: `1px solid ${STATUS_COLOR[p.status]}55`,
                  }}
                >
                  {p.status}
                </span>
                {p.day && (
                  <span className="absolute left-1 top-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono-tab text-[9px]">
                    D{p.day.toString().padStart(2, "0")}
                  </span>
                )}
              </button>

              <div className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  {/* Nombre corto y localizable: [score] Título 2-3 palabras · estilo. */}
                  <h3
                    className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-tight"
                    title={p.id}
                  >
                    {typeof p.viralityScore === "number" && p.viralityScore > 0 && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold text-white"
                        style={{
                          backgroundColor:
                            p.viralityScore >= 60
                              ? "#dc2626"
                              : p.viralityScore >= 45
                                ? "#f59e0b"
                                : p.viralityScore >= 35
                                  ? "#10b981"
                                  : "#64748b",
                        }}
                        title={`Viralidad ${Math.round(p.viralityScore)}/100`}
                      >
                        {Math.round(p.viralityScore)}
                      </span>
                    )}
                    <span className="truncate">{p.shortTitle || p.title || p.id}</span>
                    {p.styleId && (
                      <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                        · {STYLE_LABEL[p.styleId] ?? p.styleId}
                      </span>
                    )}
                  </h3>
                  {g.variants.length > 1 ? (
                    // Varios estilos del mismo clip → chips para cambiar entre ellos (una sola
                    // tarjeta, sin "repetidos"). El chip activo es el que se ve/reproduce.
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {g.variants.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setActiveVariant((m) => ({ ...m, [g.key]: v.id }))}
                          aria-pressed={v.id === p.id}
                          className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                            v.id === p.id
                              ? "bg-brand-pink/20 text-brand-pink ring-1 ring-inset ring-brand-pink/40"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                          aria-label={`Ver la versión ${STYLE_LABEL[v.styleId ?? ""] ?? v.styleId}`}
                          title={`Ver la versión ${STYLE_LABEL[v.styleId ?? ""] ?? v.styleId}`}
                        >
                          {STYLE_LABEL[v.styleId ?? ""] ?? v.styleId ?? "—"}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {STYLE_LABEL[p.styleId ?? ""] ?? p.styleId ?? "—"}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {p.platforms?.map((plat) => (
                    <span
                      key={plat}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize transition-colors hover:bg-muted/80"
                    >
                      {plat}
                    </span>
                  ))}
                  {p.source === "long_form" && (
                    <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300 ring-1 ring-inset ring-violet-500/20">
                      Video largo
                    </span>
                  )}
                </div>

                {/* CAPTION VIRAL - destacado */}
                <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      Descripción para publicar
                    </span>
                    <div className="flex items-center gap-1">
                      <div className="group/regen relative">
                        <button
                          type="button"
                          onClick={() => regenerate(p, "auto")}
                          disabled={regenerating === p.id}
                          aria-label="Regenerar la descripción (la IA elige la mejor opción por ti)"
                          title="Regenerar la descripción (la IA elige la mejor opción por ti)"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {regenerating === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                        </button>
                        {/* Menú flotante de providers OAuth (sin API keys) */}
                        <div className="invisible absolute right-0 top-full z-10 mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-lg group-hover/regen:visible">
                          <button
                            type="button"
                            onClick={() => regenerate(p, "claude")}
                            className="block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-muted"
                            title="Usa tu suscripción Claude.ai vía OAuth"
                          >
                            Claude CLI (OAuth)
                          </button>
                          <button
                            type="button"
                            onClick={() => regenerate(p, "codex")}
                            className="block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-muted"
                            title="Usa tu suscripción ChatGPT Plus vía OAuth"
                          >
                            Codex CLI (OAuth)
                          </button>
                          <button
                            type="button"
                            onClick={() => regenerate(p, "ollama")}
                            className="block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-muted"
                          >
                            Ollama local
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyCaption(p)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand-pink"
                        aria-label="Copiar la descripción completa"
                        title="Copiar la descripción completa"
                      >
                        {copiedId === p.id ? (
                          <Check className="h-3 w-3 animate-in zoom-in-50 duration-200 text-primary" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  {p.caption ? (
                    <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-foreground/90">
                      {p.caption}
                    </pre>
                  ) : (
                    <p className="text-[11px] text-muted-foreground italic">
                      Todavía no tiene descripción. Toca el botón ✨ para crearla con IA.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 text-[10px] text-muted-foreground">
                  {/* Fila 1 — programar (multi-plataforma) + editor + updated */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/editor/${encodeURIComponent(p.videoId)}`}
                        className="flex items-center gap-1 hover:text-brand-pink"
                      >
                        <ExternalLink className="h-3 w-3" /> Editor
                      </Link>
                      {PUBLISHING_ENABLED && (
                        <button
                          type="button"
                          onClick={() => setScheduleTarget(p)}
                          disabled={!p.caption}
                          title={
                            !p.caption
                              ? "Genera una descripción primero con ✨"
                              : "Programar publicación en una o varias redes"
                          }
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono-tab uppercase tracking-wider hover:bg-muted hover:text-brand-pink disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Calendar className="h-3 w-3" />
                          programar
                        </button>
                      )}
                      {PUBLISHING_ENABLED && <ThumbnailButton projectId={p.id} />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("es") : "—"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(p)}
                        aria-label="Borrar este video (tu video original no se toca)"
                        title="Borrar este video (tu video original no se toca)"
                        className="flex items-center rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {/* Fila 2 — publicación directa por plataforma. SOLO en modo personal
                      (PUBLISHING_ENABLED): la versión escritorio publica copiando el
                      texto por red + abriendo el archivo — sin OAuth ni apps aprobadas. */}
                  {PUBLISHING_ENABLED && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Subir ahora a:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        instagramConnected ? publishToInstagram(p) : setInstagramHelperTarget(p)
                      }
                      disabled={!p.caption || publishingToInstagram === p.id}
                      title={
                        !p.caption
                          ? "Genera una descripción primero con ✨"
                          : instagramConnected
                            ? `Publicar AHORA en Instagram${instagramHandle ? ` (${instagramHandle})` : ""}`
                            : `Publicar en Instagram con un paso extra (te copia el video y abre IG)${instagramHandle ? ` — ${instagramHandle}` : ""}. Conecta IG en Configuración para publicar directo.`
                      }
                      className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {publishingToInstagram === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Camera className="h-3.5 w-3.5" />
                      )}
                      Instagram
                      <ScheduleStatusBadge state={scheduledByProjectId[p.id]?.instagram_bridge} />
                    </button>
                    <button
                      type="button"
                      onClick={() => publishToLinkedIn(p)}
                      disabled={!p.caption || !linkedinConnected || publishingToLinkedin === p.id}
                      title={
                        !p.caption
                          ? "Genera una descripción primero con ✨"
                          : !linkedinConnected
                            ? "Conecta LinkedIn en Configuración primero"
                            : `Publicar AHORA en LinkedIn${linkedinHandle ? ` (${linkedinHandle})` : ""}`
                      }
                      className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/5 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {publishingToLinkedin === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      LinkedIn
                      <ScheduleStatusBadge state={scheduledByProjectId[p.id]?.linkedin} />
                    </button>
                  </div>
                  )}

                  {/* Registro manual. Va FUERA del `PUBLISHING_ENABLED` a
                      proposito: quien sube a mano lo necesita justamente cuando
                      la publicacion automatica no esta disponible. */}
                  <MarcadorDeRedes
                    projectId={p.id}
                    marcas={publicadoPorId[p.id] ?? {}}
                    onCambio={(id, marcas) =>
                      setPublicadoPorId((prev) => ({ ...prev, [id]: marcas }))
                    }
                  />
                </div>
              </div>
            </div>
          </Card>
          );
        })}
      </div>

      {/* Footer — recordatorio de dónde viven los archivos. */}
      {projects.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>Tus videos se guardan en tu compu.</span>
          <Button variant="ghost" size="sm" onClick={() => revealRender(projects[0])}>
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            Abrir la carpeta
          </Button>
        </div>
      )}

      {/* Confirmación de borrado individual — diálogo propio, nada de confirm() nativo. */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar este video?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `"${deleteTarget.title ?? deleteTarget.id}" se elimina de Mis videos. ` : ""}
              Tu video original no se toca.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Mejor no
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => deleteTarget && doRemoveProject(deleteTarget)}
            >
              Sí, borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado en lote */}
      <Dialog open={batchConfirmOpen} onOpenChange={(open) => !open && setBatchConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              ¿Borrar {selectedIds.size === 1 ? "este video" : `estos ${selectedIds.size} videos`}?
            </DialogTitle>
            <DialogDescription>
              {selectedIds.size === 1
                ? "Se elimina de Mis videos. Tu video original no se toca."
                : "Se eliminan de Mis videos. Tus videos originales no se tocan."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBatchConfirmOpen(false)}>
              Mejor no
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={doRemoveSelected}
            >
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Sí, borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {instagramHelperTarget && (
        <InstagramHelperDialog
          open={!!instagramHelperTarget}
          onOpenChange={(open) => !open && setInstagramHelperTarget(null)}
          projectId={instagramHelperTarget.id}
          caption={pickCaptionForPlatform(instagramHelperTarget, "instagram") || (instagramHelperTarget.caption ?? "")}
          instagramHandle={instagramHandle}
          source={instagramHelperTarget.source ?? "short"}
        />
      )}

      {scheduleTarget && (
        <ScheduleDialog
          open={!!scheduleTarget}
          onOpenChange={(open) => !open && setScheduleTarget(null)}
          projectId={scheduleTarget.id}
          caption={pickCaptionForPlatform(scheduleTarget, "tiktok") || (scheduleTarget.caption ?? "")}
          captions={{
            tiktok: pickCaptionForPlatform(scheduleTarget, "tiktok"),
            linkedin: pickCaptionForPlatform(scheduleTarget, "linkedin"),
            instagram: pickCaptionForPlatform(scheduleTarget, "instagram"),
          }}
          source={scheduleTarget.source ?? "short"}
          onScheduled={() => {
            loadSchedule();
          }}
        />
      )}

      <ProjectPreviewDialog
        project={previewProject}
        onClose={() => setPreviewProject(null)}
        tiktokHandle={tiktokHandle}
        transcriptByVideoId={transcriptByVideoId}
        loadingTranscript={loadingTranscript}
        transcriptCopied={transcriptCopied}
        onCopyTranscript={copyTranscript}
      />
    </div>
  );
}

