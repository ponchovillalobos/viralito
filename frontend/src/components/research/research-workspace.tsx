"use client";

// Thumbnails dinámicos de /api/research/[id]/thumb.
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Loader2,
  Music2,
  Camera,
  Tv,
  Telescope,
  Trash2,
  Heart,
  Eye,
  MessageSquare,
  Copy,
  Check,
  X,
  Star,
  Mic,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";
import { AdaptDialog } from "@/components/research/adapt-dialog";
import { CookiesPanel } from "@/components/research/cookies-panel";
import { BatchAdaptPanel } from "@/components/research/batch-adapt-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { SECTION_COLORS } from "@/lib/section-colors";

type Platform = "tiktok" | "instagram" | "youtube";
type Status = "queued" | "downloading" | "transcribing" | "ready" | "failed";
type UserMark = "save" | "skip" | "ready_to_record" | "recorded";

interface ResearchItem {
  id: string;
  url: string;
  platform: Platform;
  status: Status;
  addedAt: number;
  updatedAt: number;
  videoPath?: string;
  thumbnailPath?: string;
  metadata?: {
    author: string;
    title: string;
    caption: string;
    hashtags: string[];
    views: number;
    likes: number;
    comments_count: number;
    comments: { author: string; text: string; likes: number }[];
    duration: number;
    posted_at: string;
  };
  transcript?: {
    words: { word: string; start: number; end: number }[];
    duration: number;
    error?: string;
  };
  adaptedScript?: string;
  adaptedHook?: string;
  suggestedHashtags?: string[];
  userMarked?: UserMark;
  notes?: string;
  lastError?: string;
}

type ViewMode = "library" | "scripts";

const PLATFORM_META: Record<Platform, { icon: typeof Music2; label: string; color: string }> = {
  tiktok: { icon: Music2, label: "TikTok", color: "#ec4899" },
  instagram: { icon: Camera, label: "Instagram", color: "#f59e0b" },
  youtube: { icon: Tv, label: "YouTube", color: "#ef4444" },
};

const STATUS_LABEL: Record<Status, string> = {
  queued: "en cola",
  downloading: "descargando",
  transcribing: "transcribiendo",
  ready: "listo",
  failed: "falló",
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function transcriptText(item: ResearchItem): string {
  const words = item.transcript?.words ?? [];
  return words.map((w) => w.word).join(" ");
}

export function ResearchWorkspace() {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<ResearchItem | null>(null);
  const [adaptOpen, setAdaptOpen] = useState<ResearchItem | null>(null);
  const [view, setView] = useState<ViewMode>("library");
  const [filterPlatform, setFilterPlatform] = useState<Platform | "all">("all");
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterMarked, setFilterMarked] = useState<UserMark | "all">("all");
  const [search, setSearch] = useState("");

  const warnedLoadRef = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/research/list");
      const d = await r.json();
      setItems(d.items ?? []);
      warnedLoadRef.current = false;
    } catch (err) {
      // Avisa UNA vez (el polling reintenta cada 3s; toastear cada tick sería spam).
      if (!warnedLoadRef.current) {
        warnedLoadRef.current = true;
        toastError(err, "No se cargó la biblioteca de inspiración");
      }
    }
  }, []);

  // Load on mount + polling cada 3s. Patrón válido; el lint quiere `use(promise)` pero
  // no aplica para polling. No migramos.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Si el item seleccionado se actualiza desde el polling, refrescamos su data.
  // Patrón store-and-compare: el guard por updatedAt evita el loop infinito.
  if (selected) {
    const updated = items.find((it) => it.id === selected.id);
    if (updated && updated.updatedAt !== selected.updatedAt) {
      setSelected(updated);
    }
  }

  async function addUrl() {
    const u = url.trim();
    if (!u) {
      toast.error("Pega una URL primero");
      return;
    }
    setAdding(true);
    try {
      const r = await fetch("/api/research/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "no se pudo agregar");
      toast.success(`Agregado · ${d.item.platform}`);
      setUrl("");
      refresh();
    } catch (err) {
      toastError(err, "No se pudo agregar el video");
    } finally {
      setAdding(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("¿Eliminar este video de la biblioteca? Se borran archivos del disco.")) return;
    try {
      await fetch(`/api/research/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.success("Eliminado");
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch (err) {
      toastError(err, "No se pudo eliminar el video");
    }
  }

  async function markItem(id: string, mark: UserMark | null) {
    try {
      await fetch(`/api/research/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMarked: mark }),
      });
      refresh();
    } catch (err) {
      toastError(err, "No se pudo guardar la marca");
    }
  }

  // Filtrado client-side. Por default OCULTAMOS failed (post borrado / privado).
  // Solo si el usuario filtra explícitamente por "failed" los muestra.
  const showFailed = filterStatus === "failed";
  const filtered = items.filter((it) => {
    if (!showFailed && it.status === "failed") return false;
    if (filterPlatform !== "all" && it.platform !== filterPlatform) return false;
    if (filterStatus !== "all" && it.status !== filterStatus) return false;
    if (filterMarked !== "all" && it.userMarked !== filterMarked) return false;
    if (search.trim()) {
      const hay = `${it.url} ${it.metadata?.author ?? ""} ${it.metadata?.caption ?? ""} ${(it.metadata?.hashtags ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(search.toLowerCase().trim())) return false;
    }
    return true;
  });

  const failedCount = items.filter((it) => it.status === "failed").length;
  const readyWithoutAdapt = items.filter(
    (it) => it.status === "ready" && !it.adaptedScript
  ).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Inspiración · ideas que ya funcionaron"
        title="De un viral ajeno a tu propio guión"
        description="Pega el link de un video de TikTok, Instagram Reels o YouTube Shorts. El sistema lo descarga, saca el texto de lo que dice y los hashtags. Después, con «✨ Adaptar con IA», te genera una versión con tu propia voz para que la regrabes."
        color={SECTION_COLORS.research}
      />

      {/* Panel cookies para IG/TT */}
      <CookiesPanel />

      {/* Panel de adaptación batch con Claude */}
      <BatchAdaptPanel readyWithoutAdapt={readyWithoutAdapt} onComplete={refresh} />

      {/* Toggle view: Biblioteca / Mis guiones */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setView("library")}
          className={cn(
            "border-b-2 px-3 py-2 font-mono-tab text-xs uppercase tracking-wider transition-colors",
            view === "library"
              ? "border-cyan-400 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          📚 Biblioteca ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setView("scripts")}
          className={cn(
            "border-b-2 px-3 py-2 font-mono-tab text-xs uppercase tracking-wider transition-colors",
            view === "scripts"
              ? "border-cyan-400 text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          ✍ Mis guiones ({items.filter((it) => it.adaptedScript).length})
        </button>
      </div>

      {/* Input URL (solo en library view) */}
      {view === "library" && (
        <div className="flex gap-2">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addUrl();
            }}
            placeholder="https://www.tiktok.com/@... · https://www.instagram.com/reel/... · https://youtu.be/..."
            className="font-mono-tab text-xs flex-1"
            disabled={adding}
          />
          <Button onClick={addUrl} disabled={adding || !url.trim()}>
            {adding ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Telescope className="mr-1.5 h-4 w-4" />
            )}
            Agregar
          </Button>
        </div>
      )}

      {/* Vista "Mis guiones" — kanban */}
      {view === "scripts" && (
        <ScriptsKanban
          items={items.filter((it) => it.adaptedScript)}
          onOpen={(it) => setAdaptOpen(it)}
          onMark={markItem}
        />
      )}

      {view === "library" && (
        <>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
          plataforma:
        </span>
        <FilterChip active={filterPlatform === "all"} onClick={() => setFilterPlatform("all")} label="todas" />
        {(["tiktok", "instagram", "youtube"] as Platform[]).map((p) => (
          <FilterChip
            key={p}
            active={filterPlatform === p}
            onClick={() => setFilterPlatform(p)}
            label={PLATFORM_META[p].label}
          />
        ))}
        <span className="ml-3 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
          estado:
        </span>
        <FilterChip active={filterStatus === "all"} onClick={() => setFilterStatus("all")} label="todos" />
        {(["ready", "downloading", "transcribing", "queued", "failed"] as Status[]).map((s) => (
          <FilterChip
            key={s}
            active={filterStatus === s}
            onClick={() => setFilterStatus(s)}
            label={STATUS_LABEL[s]}
          />
        ))}
        <span className="ml-3 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
          mark:
        </span>
        <FilterChip active={filterMarked === "all"} onClick={() => setFilterMarked("all")} label="todos" />
        <FilterChip active={filterMarked === "save"} onClick={() => setFilterMarked("save")} label="⭐ save" />
        <FilterChip
          active={filterMarked === "ready_to_record"}
          onClick={() => setFilterMarked("ready_to_record")}
          label="✅ p/grabar"
        />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="buscar descripción / autor / hashtag…"
          className="ml-auto h-7 max-w-xs text-xs"
        />
      </div>

      {/* Indicador sutil de items no disponibles */}
      {!showFailed && failedCount > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{failedCount}</strong>{" "}
            {failedCount === 1 ? "post no disponible" : "posts no disponibles"} (borrados, privados o restringidos por Instagram)
          </span>
          <button
            type="button"
            onClick={() => setFilterStatus("failed")}
            className="rounded px-1.5 py-0.5 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ver detalles
          </button>
        </div>
      )}

      {/* Galería */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/50 p-8 text-center">
          <Telescope className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {items.length === 0
              ? "Pega tu primera URL arriba para empezar."
              : "No hay items que coincidan con los filtros."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((it) => (
            <ResearchCard
              key={it.id}
              item={it}
              onClick={() => setSelected(it)}
              onMark={(mark) => markItem(it.id, mark)}
              onDelete={() => deleteItem(it.id)}
            />
          ))}
        </div>
      )}

        </>
      )}

      {selected && (
        <ResearchDetailDialog
          item={selected}
          onClose={() => setSelected(null)}
          onMark={(mark) => markItem(selected.id, mark)}
          onDelete={() => deleteItem(selected.id)}
          onAdapt={() => {
            const it = selected;
            setSelected(null);
            setAdaptOpen(it);
          }}
        />
      )}

      {adaptOpen && (
        <AdaptDialog
          open={true}
          onOpenChange={(o) => !o && setAdaptOpen(null)}
          itemId={adaptOpen.id}
          originalTranscript={transcriptText(adaptOpen)}
          initialAdapted={adaptOpen.adaptedScript}
          initialHook={adaptOpen.adaptedHook}
          initialHashtags={adaptOpen.suggestedHashtags}
          onSaved={() => {
            refresh();
          }}
          onMarkReady={async () => {
            await markItem(adaptOpen.id, "ready_to_record");
            setAdaptOpen(null);
          }}
        />
      )}
    </div>
  );
}

function ScriptsKanban({
  items,
  onOpen,
  onMark,
}: {
  items: ResearchItem[];
  onOpen: (it: ResearchItem) => void;
  onMark: (id: string, mark: UserMark | null) => void;
}) {
  const columns: { key: UserMark | "draft"; title: string; filter: (it: ResearchItem) => boolean; color: string }[] = [
    {
      key: "draft",
      title: "📝 Borrador",
      color: "border-amber-500/30 bg-amber-500/5",
      filter: (it) => it.userMarked !== "ready_to_record" && it.userMarked !== "recorded",
    },
    {
      key: "ready_to_record",
      title: "🎙 Listo para grabar",
      color: "border-brand-pink/30 bg-brand-pink/5",
      filter: (it) => it.userMarked === "ready_to_record",
    },
    {
      key: "recorded",
      title: "✅ Grabado",
      color: "border-cyan-500/30 bg-cyan-500/5",
      filter: (it) => it.userMarked === "recorded",
    },
  ];

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/50 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Aún no adaptaste ningún guión. Andá a <strong>Biblioteca</strong>, click en una card y
          después <strong>✨ Adaptar con Claude</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {columns.map((col) => {
        const colItems = items.filter(col.filter);
        return (
          <div key={col.key} className={cn("rounded-lg border p-3", col.color)}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-mono-tab text-xs uppercase tracking-wider">
                {col.title}
              </h3>
              <span className="font-mono-tab text-[10px] text-muted-foreground">
                {colItems.length}
              </span>
            </div>
            <div className="space-y-2">
              {colItems.length === 0 ? (
                <p className="text-[11px] italic text-muted-foreground">vacío</p>
              ) : (
                colItems.map((it) => (
                  <ScriptCard
                    key={it.id}
                    item={it}
                    onOpen={() => onOpen(it)}
                    onMarkReady={() => onMark(it.id, "ready_to_record")}
                    onMarkRecorded={() => onMark(it.id, "recorded")}
                    onUnmark={() => onMark(it.id, null)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScriptCard({
  item,
  onOpen,
  onMarkReady,
  onMarkRecorded,
  onUnmark,
}: {
  item: ResearchItem;
  onOpen: () => void;
  onMarkReady: () => void;
  onMarkRecorded: () => void;
  onUnmark: () => void;
}) {
  const Icon = PLATFORM_META[item.platform].icon;
  const preview = (item.adaptedScript ?? "").slice(0, 180);
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3" style={{ color: PLATFORM_META[item.platform].color }} />
        <p className="line-clamp-1 font-mono-tab text-[10px] text-muted-foreground">
          {item.metadata?.author ? `@${item.metadata.author}` : item.url.slice(0, 40)}
        </p>
      </div>
      {item.adaptedHook && (
        <p className="mb-1 text-xs font-medium text-violet-300">{item.adaptedHook}</p>
      )}
      <p className="line-clamp-4 text-[11px] text-foreground/80">{preview}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={onOpen}
          className="rounded border border-border bg-muted/30 px-2 py-0.5 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ver / editar
        </button>
        {item.userMarked !== "ready_to_record" && item.userMarked !== "recorded" && (
          <button
            type="button"
            onClick={onMarkReady}
            className="rounded border border-brand-pink/30 bg-brand-pink/5 px-2 py-0.5 font-mono-tab text-[10px] text-brand-pink hover:bg-brand-pink/15"
          >
            <Mic className="mr-0.5 inline h-2.5 w-2.5" />
            listo
          </button>
        )}
        {item.userMarked === "ready_to_record" && (
          <button
            type="button"
            onClick={onMarkRecorded}
            className="rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5 font-mono-tab text-[10px] text-cyan-300 hover:bg-cyan-500/15"
          >
            <Check className="mr-0.5 inline h-2.5 w-2.5" />
            grabado
          </button>
        )}
        {item.userMarked && (
          <button
            type="button"
            onClick={onUnmark}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-red-400"
            title="Quitar mark"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 font-mono-tab text-[10px] uppercase tracking-wider transition-colors",
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function ResearchCard({
  item,
  onClick,
  onMark,
  onDelete,
}: {
  item: ResearchItem;
  onClick: () => void;
  onMark: (mark: UserMark | null) => void;
  onDelete: () => void;
}) {
  const Icon = PLATFORM_META[item.platform].icon;
  const color = PLATFORM_META[item.platform].color;
  const isReady = item.status === "ready";
  const isFailed = item.status === "failed";
  const isProcessing = item.status === "queued" || item.status === "downloading" || item.status === "transcribing";

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/30">
      {/* Thumbnail clickeable */}
      <button
        type="button"
        onClick={onClick}
        className="group relative aspect-[9/16] cursor-pointer overflow-hidden bg-zinc-900 text-left"
      >
        {item.thumbnailPath ? (
          <img
            src={`/api/research/${encodeURIComponent(item.id)}/thumb`}
            alt={item.metadata?.title ?? item.url}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {isProcessing ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : isFailed ? (
              <AlertCircle className="h-6 w-6 text-red-400" />
            ) : (
              <Telescope className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
        )}
        <span
          className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 font-mono-tab text-[10px]"
          style={{ color }}
        >
          <Icon className="h-3 w-3" />
          {PLATFORM_META[item.platform].label}
        </span>
        {!isReady && (
          <span
            className={cn(
              "absolute right-2 top-2 rounded px-1.5 py-0.5 font-mono-tab text-[9px] uppercase tracking-wider",
              isFailed && "bg-red-500/30 text-red-200",
              isProcessing && "bg-amber-500/30 text-amber-200"
            )}
          >
            {STATUS_LABEL[item.status]}
          </span>
        )}
      </button>

      {/* Footer con metadata + acciones */}
      <div className="space-y-2 p-3">
        {isFailed && item.lastError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-200">
            <p className="font-medium">⚠ Falló la descarga</p>
            <p className="line-clamp-3 text-red-300/80">{item.lastError}</p>
          </div>
        )}
        {item.metadata ? (
          <>
            <p className="line-clamp-1 text-sm font-medium" title={item.metadata.author}>
              @{item.metadata.author}
            </p>
            <p className="line-clamp-2 text-[11px] text-muted-foreground">{item.metadata.caption || "—"}</p>
            <div className="flex items-center gap-3 font-mono-tab text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{fmtNum(item.metadata.views)}</span>
              <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{fmtNum(item.metadata.likes)}</span>
              <span className="flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{fmtNum(item.metadata.comments_count)}</span>
            </div>
          </>
        ) : (
          <p className="font-mono-tab text-[11px] text-muted-foreground break-all">
            {item.url.length > 60 ? item.url.slice(0, 60) + "…" : item.url}
          </p>
        )}

        {/* Acciones */}
        <div className="flex items-center gap-1 pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMark(item.userMarked === "save" ? null : "save");
            }}
            className={cn(
              "rounded p-1 transition-colors",
              item.userMarked === "save"
                ? "bg-amber-500/20 text-amber-400"
                : "text-muted-foreground hover:bg-muted hover:text-amber-400"
            )}
            title="Marcar como save"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMark(item.userMarked === "ready_to_record" ? null : "ready_to_record");
            }}
            className={cn(
              "rounded p-1 transition-colors",
              item.userMarked === "ready_to_record"
                ? "bg-brand-pink/20 text-brand-pink"
                : "text-muted-foreground hover:bg-muted hover:text-brand-pink"
            )}
            title="Listo para grabar"
          >
            <Mic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClick}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Ver detalle / transcript"
          >
            <span className="font-mono-tab text-[10px]">ver</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400"
            title="Eliminar"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

type DetailTab = "transcript" | "caption" | "hashtags" | "comments";

const DETAIL_TAB_LABEL: Record<DetailTab, string> = {
  transcript: "transcripción",
  caption: "descripción",
  hashtags: "hashtags",
  comments: "comentarios",
};

function ResearchDetailDialog({
  item,
  onClose,
  onMark,
  onDelete,
  onAdapt,
}: {
  item: ResearchItem;
  onClose: () => void;
  onMark: (mark: UserMark | null) => void;
  onDelete: () => void;
  onAdapt: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("transcript");
  const [copied, setCopied] = useState<string | null>(null);

  const Icon = PLATFORM_META[item.platform].icon;
  const color = PLATFORM_META[item.platform].color;

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      toast.success(`Copiado: ${label}`);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  const tText = transcriptText(item);
  const hashtagsText = (item.metadata?.hashtags ?? []).map((h) => `#${h}`).join(" ");

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[95vw] p-0 bg-black sm:max-w-4xl md:max-w-5xl">
        <DialogTitle className="sr-only">Detalle research {item.id}</DialogTitle>
        <div className="grid grid-cols-1 gap-0 md:grid-cols-[auto_1fr] max-h-[88vh]">
          {/* Video left */}
          <div className="flex flex-col bg-black md:max-w-[360px]">
            {item.status === "ready" && item.videoPath ? (
              <video
                key={item.id}
                src={`/api/research/${encodeURIComponent(item.id)}/video`}
                controls
                autoPlay
                playsInline
                className="aspect-[9/16] w-full bg-black md:max-w-[360px]"
              />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center bg-zinc-900 md:max-w-[360px]">
                {item.status === "failed" ? (
                  <div className="px-4 text-center">
                    <AlertCircle className="mx-auto mb-2 h-8 w-8 text-red-400" />
                    <p className="text-xs text-red-300">{item.lastError ?? "fallo desconocido"}</p>
                  </div>
                ) : (
                  <div className="px-4 text-center">
                    <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-amber-400" />
                    <p className="font-mono-tab text-xs text-amber-300">
                      {STATUS_LABEL[item.status]}…
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1 border-t border-foreground/10 bg-card p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="h-3.5 w-3.5" style={{ color }} />
                @{item.metadata?.author ?? "?"}
              </p>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono-tab text-[10px] text-muted-foreground hover:text-foreground break-all"
              >
                {item.url}
              </a>
              {item.metadata && (
                <div className="flex flex-wrap gap-2 pt-1 font-mono-tab text-[10px] text-muted-foreground">
                  <span>👁 {fmtNum(item.metadata.views)}</span>
                  <span>❤️ {fmtNum(item.metadata.likes)}</span>
                  <span>💬 {fmtNum(item.metadata.comments_count)}</span>
                  <span>⏱ {item.metadata.duration}s</span>
                  {item.metadata.posted_at && <span>📅 {item.metadata.posted_at}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Right: tabs */}
          <div className="flex min-h-0 flex-col bg-card md:border-l md:border-foreground/10">
            {/* Tab bar */}
            <div className="flex items-center gap-0.5 border-b border-foreground/10 px-3 py-1.5">
              {(["transcript", "caption", "hashtags", "comments"] as DetailTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider",
                    tab === t
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {DETAIL_TAB_LABEL[t]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (tab === "transcript") copyText("Transcripción", tText);
                  else if (tab === "caption") copyText("Descripción", item.metadata?.caption ?? "");
                  else if (tab === "hashtags") copyText("Hashtags", hashtagsText);
                }}
                className="ml-auto flex items-center gap-1 rounded p-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-brand-pink"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                copiar
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed">
              {tab === "transcript" && (
                tText ? (
                  <p className="whitespace-pre-wrap text-foreground/90">{tText}</p>
                ) : item.transcript?.error ? (
                  <p className="text-xs text-red-300">Error: {item.transcript.error}</p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    {item.status === "ready"
                      ? "Sin transcripción disponible."
                      : "Esperando que termine la transcripción…"}
                  </p>
                )
              )}
              {tab === "caption" && (
                <p className="whitespace-pre-wrap text-foreground/90">
                  {item.metadata?.caption || "(sin descripción)"}
                </p>
              )}
              {tab === "hashtags" && (
                item.metadata?.hashtags && item.metadata.hashtags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {item.metadata.hashtags.map((h, i) => (
                      <span
                        key={i}
                        className="rounded bg-muted px-2 py-0.5 font-mono-tab text-xs text-foreground"
                      >
                        #{h}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs italic text-muted-foreground">Sin hashtags detectados.</p>
                )
              )}
              {tab === "comments" && (
                item.metadata?.comments && item.metadata.comments.length > 0 ? (
                  <ul className="space-y-2">
                    {item.metadata.comments.slice(0, 30).map((c, i) => (
                      <li key={i} className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <p className="font-medium text-foreground">@{c.author}</p>
                        <p className="text-muted-foreground">{c.text}</p>
                        {c.likes > 0 && (
                          <p className="font-mono-tab text-[9px] text-muted-foreground">
                            ❤️ {fmtNum(c.likes)}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs italic text-muted-foreground">Sin comentarios extraídos.</p>
                )
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center gap-2 border-t border-foreground/10 bg-muted/20 p-3">
              <button
                type="button"
                onClick={onAdapt}
                disabled={item.status !== "ready"}
                className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                title={item.status !== "ready" ? "Espera a que termine la transcripción" : "Reescribir con Claude a tu voz"}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {item.adaptedScript ? "Ver / editar adaptación" : "Adaptar con Claude"}
              </button>
              <button
                type="button"
                onClick={() => onMark(item.userMarked === "ready_to_record" ? null : "ready_to_record")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                  item.userMarked === "ready_to_record"
                    ? "bg-brand-pink/20 text-brand-pink border border-brand-pink/40"
                    : "border border-border bg-muted/30 hover:bg-muted text-foreground"
                )}
              >
                <Mic className="h-3.5 w-3.5" />
                {item.userMarked === "ready_to_record" ? "✓ Listo para grabar" : "Marcar listo p/grabar"}
              </button>
              <button
                type="button"
                onClick={() => onMark(item.userMarked === "save" ? null : "save")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                  item.userMarked === "save"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    : "border border-border bg-muted/30 hover:bg-muted text-foreground"
                )}
              >
                <Star className="h-3.5 w-3.5" />
                {item.userMarked === "save" ? "✓ Guardado" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="ml-auto rounded-md border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                Eliminar
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                <X className="mr-1 inline h-3.5 w-3.5" />
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
