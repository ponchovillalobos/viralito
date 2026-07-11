"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Film,
  Loader2,
  RotateCcw,
  Scissors,
  XCircle,
  X,
  Minus,
} from "lucide-react";

/**
 * Panel global de la cola de edición. Polling 3s a /api/jobs/queue.
 * Se monta en layout.tsx para que sobreviva la navegación entre páginas.
 *
 * Se muestra como card fixed bottom-right cuando hay trabajos en curso, en espera
 * O terminados de las últimas 24h que el usuario todavía no cerró (los cierres se
 * guardan en localStorage para que un refresh no los reviva).
 */

interface QueueEntryView {
  kind: "editor" | "long_form" | "research";
  jobId: string;
  videoId?: string;
  status: string;
  progress: number;
  position: number | null;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
  /** ETA en segundos para trabajos en curso (estimado por velocidad de progreso). */
  etaSec?: number | null;
  /** Título humano del video (cuando el server pudo derivarlo). */
  title?: string;
  /** Motivo humano del fallo (sólo status failed). */
  error?: string;
  /** Params originales para reintentar (sólo editor). */
  params?: { videoId: string; styles: string[]; accentColor: string };
}

/** "~12 min" / "~45 s" legible para el ETA. */
function formatEta(sec: number): string {
  if (sec < 90) return `~${Math.max(5, Math.round(sec / 5) * 5)} s`;
  return `~${Math.round(sec / 60)} min`;
}

interface QueueResponse {
  maxConcurrent: number;
  active: QueueEntryView[];
  pending: QueueEntryView[];
  finished?: QueueEntryView[];
  totalActive: number;
  totalPending: number;
}

const POLL_INTERVAL_MS = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISS_KEY = "viral_queue_dismissed_v1";

/** Cierres persistidos: { jobId: timestampDelCierre }. Sobreviven al refresh. */
function loadDismissed(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Nombre legible del trabajo: el título del video si existe; si no, derivamos
 * "Video del 12 dic, 11:16" de ids tipo VID_20251212_111639; último recurso, el id.
 */
function humanJobName(e: { title?: string; videoId?: string; jobId: string }): string {
  if (e.title) return e.title;
  const id = e.videoId ?? "";
  const m = /(20\d{2})(\d{2})(\d{2})[_\-T]?(\d{2})(\d{2})/.exec(id);
  if (m) {
    const mon = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `Video del ${day} ${MESES_CORTOS[mon - 1]}, ${m[4]}:${m[5]}`;
    }
  }
  return id || `Video (${e.jobId.slice(-6)})`;
}

export function QueuePanel() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Minimizado = pastilla chiquita en la esquina, para que NO tape botones como
  // "Siguiente" del wizard (el panel fijo bottom-right los cubría).
  const [minimized, setMinimized] = useState(false);
  const [showFinished, setShowFinished] = useState(true);
  const [dismissed, setDismissed] = useState<Record<string, number>>(() => loadDismissed());
  // Cuando llega un trabajo nuevo, re-abrir el panel
  const [lastSeenJobIds, setLastSeenJobIds] = useState<Set<string>>(new Set());

  function dismiss(jobId: string) {
    setDismissed((prev) => {
      const next: Record<string, number> = { ...prev, [jobId]: Date.now() };
      // Poda: cierres de hace más de 72h ya no aplican a nada (el store purga antes).
      const cutoff = Date.now() - 3 * DAY_MS;
      for (const [k, v] of Object.entries(next)) {
        if (v < cutoff) delete next[k];
      }
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
      } catch {
        /* sin localStorage igual funciona (solo no persiste) */
      }
      return next;
    });
  }

  // Tras un reinicio de la app, reanudar los videos que quedaron SOLO en cola (la cola
  // vive en memoria y se perdía al reiniciar → "se interrumpió porque la app se reinició").
  // Una sola vez al montar (el panel vive en el layout → se monta 1 vez por arranque).
  useEffect(() => {
    let done = false;
    (async () => {
      try {
        const r = await fetch("/api/jobs/resume", { method: "POST" });
        if (!r.ok || done) return;
        const d = (await r.json()) as { resumed?: number };
        if (d.resumed && d.resumed > 0) {
          toast.info(
            d.resumed === 1
              ? "Reanudando 1 video que quedó en cola al reiniciar la app."
              : `Reanudando ${d.resumed} videos que quedaron en cola al reiniciar la app.`
          );
          setCollapsed(false);
        }
      } catch {
        // silencioso — si falla, los jobs quedan visibles como "pausados" igual
      }
    })();
    return () => {
      done = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const r = await fetch("/api/jobs/queue");
        if (!r.ok) return;
        const d = (await r.json()) as QueueResponse;
        if (cancelled) return;
        setData(d);

        // Detectar trabajos nuevos (incluye recién terminados) para des-colapsar el panel
        const currentIds = new Set(
          [...d.active, ...d.pending, ...(d.finished ?? [])].map((e) => e.jobId)
        );
        const newIds = Array.from(currentIds).filter((id) => !lastSeenJobIds.has(id));
        if (newIds.length > 0) {
          setLastSeenJobIds(currentIds);
          setCollapsed(false);
        }
      } catch {
        // silencioso — corre cada 3s, no spamear errores
      }
    }

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [lastSeenJobIds]);

  if (!data) return null;

  // Filtrar cerrados (trabajos que el usuario ya marcó como "ya vi")
  const active = data.active.filter((e) => !dismissed[e.jobId]);
  const pending = data.pending.filter((e) => !dismissed[e.jobId]);
  const finished = (data.finished ?? []).filter(
    // Mostrar sólo lo terminado en las últimas 24h. Date.now() en el filtro re-evalúa
    // en cada poll (cada 3s), que es justo lo que queremos; granularidad de día.
    // eslint-disable-next-line react-hooks/purity
    (e) => !dismissed[e.jobId] && (e.finishedAt ?? 0) > Date.now() - DAY_MS
  );

  if (active.length === 0 && pending.length === 0 && finished.length === 0) {
    return null;
  }

  const headerLabel =
    active.length + pending.length > 0
      ? `Editando (${active.length} en curso · ${pending.length} en espera)`
      : `Videos terminados (${finished.length})`;

  // MINIMIZADO: solo una pastilla chiquita en la esquina (no tapa nada). Click → restaura.
  if (minimized) {
    const enCurso = active.length + pending.length;
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        title="Ver el progreso de tus videos"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-xl backdrop-blur hover:border-foreground/30"
      >
        {enCurso > 0 ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-pink" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        )}
        <span>{enCurso > 0 ? `Editando (${enCurso})` : `Listos (${finished.length})`}</span>
        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 max-w-[calc(100vw-32px)]",
        collapsed ? "w-auto" : "w-96"
      )}
    >
      <div className="rounded-lg border border-border bg-card shadow-xl backdrop-blur">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="flex min-w-0 items-center gap-2 text-sm font-medium hover:text-foreground/80"
          >
            <Scissors className="h-3.5 w-3.5 shrink-0 text-brand-pink" />
            <span className="truncate">{headerLabel}</span>
            {collapsed ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {/* Minimizar a pastilla: para que el panel no tape el botón "Siguiente". */}
          <button
            type="button"
            onClick={() => setMinimized(true)}
            title="Minimizar (que no tape los botones)"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>

        {!collapsed && (
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {/* En curso */}
            {active.map((e) => (
              <QueueRow key={e.jobId} entry={e} onDismiss={() => dismiss(e.jobId)} />
            ))}
            {/* En espera */}
            {pending.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <p className="mb-1 px-1 font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground">
                  En espera
                </p>
                {pending.map((e) => (
                  <QueueRow key={e.jobId} entry={e} onDismiss={() => dismiss(e.jobId)} />
                ))}
                <p className="px-1 text-[9px] text-muted-foreground">
                  Se edita de a {data.maxConcurrent} para no saturar tu compu.
                </p>
              </div>
            )}

            {/* Terminados (últimas 24h, hasta que los cierres) */}
            {finished.length > 0 && (
              <div className={cn("border-t border-border pt-2", (active.length > 0 || pending.length > 0) && "mt-2")}>
                <button
                  type="button"
                  onClick={() => setShowFinished((s) => !s)}
                  className="mb-1 flex w-full items-center justify-between px-1 font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <span>Terminados ({finished.length})</span>
                  {showFinished ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {showFinished &&
                  finished.map((e) => (
                    <FinishedRow key={e.jobId} entry={e} onDismiss={() => dismiss(e.jobId)} />
                  ))}
              </div>
            )}

            {/* Footer link */}
            <div className="mt-2 border-t border-border pt-2 text-center">
              <Link
                href="/produccion"
                className="font-mono-tab text-[10px] text-muted-foreground hover:text-brand-pink"
              >
                Ir a Mis videos →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({ entry, onDismiss }: { entry: QueueEntryView; onDismiss: () => void }) {
  const KindIcon = entry.kind === "long_form" ? Film : Scissors;
  const kindColor = entry.kind === "long_form" ? "text-violet-400" : "text-brand-pink";
  const isFinal = entry.status === "done" || entry.status === "failed";
  const [cancelling, setCancelling] = useState(false);

  async function cancelThis() {
    setCancelling(true);
    try {
      const r = await fetch(`/api/jobs/queue?action=cancel&jobId=${encodeURIComponent(entry.jobId)}`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      toastError(err, "No se pudo cancelar — quizá ya empezó a editarse");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      className={cn(
        "mb-1.5 rounded-md border p-2 text-xs",
        entry.status === "running" && "border-amber-500/30 bg-amber-500/5",
        entry.status === "queued" && "border-border bg-muted/30",
        entry.status === "done" && "border-emerald-500/30 bg-emerald-500/5",
        entry.status === "failed" && "border-red-500/30 bg-red-500/5"
      )}
    >
      <div className="mb-1 flex items-start gap-2">
        <KindIcon className={cn("mt-0.5 h-3 w-3 shrink-0", kindColor)} />
        <div className="flex-1 min-w-0">
          <p className="truncate text-[11px] text-foreground" title={entry.videoId}>
            {humanJobName(entry)}
          </p>
          {entry.detail && (
            <p className="truncate font-mono-tab text-[9px] text-muted-foreground">{entry.detail}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* ETA estimado (sólo en curso con progreso medible) */}
          {entry.status === "running" && entry.etaSec != null && (
            <span className="font-mono-tab text-[9px] text-amber-300/90" title="Tiempo restante estimado">
              {formatEta(entry.etaSec)}
            </span>
          )}
          <StatusBadge status={entry.status} position={entry.position} />
          {/* Cancelar un trabajo que todavía no arrancó */}
          {entry.status === "queued" && (
            <button
              type="button"
              onClick={cancelThis}
              disabled={cancelling}
              className="rounded p-0.5 text-muted-foreground hover:bg-red-500/20 hover:text-red-300 disabled:opacity-50"
              title="Cancelar"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {isFinal && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Cerrar"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {/* Barra de progreso (sólo en curso) — más grande y visual: gruesa, con gradiente,
          brillo animado y el porcentaje a la vista, para que la espera se sienta viva. */}
      {entry.status === "running" && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="relative h-full rounded-full bg-gradient-to-r from-amber-400 to-pink-500 transition-all duration-500"
              style={{ width: `${Math.max(4, entry.progress)}%` }}
            >
              <span className="absolute inset-0 animate-pulse bg-white/25" />
            </div>
          </div>
          <span className="shrink-0 font-mono-tab text-[10px] font-semibold tabular-nums text-amber-300">
            {Math.round(entry.progress)}%
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Fila de un trabajo terminado: "Listo ✓" con link a Mis videos, o "Falló" con el
 * motivo humano expandible + botón Reintentar (re-encola el mismo video y estilos).
 * Para largos, Reintentar REANUDA: re-encola el request persistido del job y el
 * pipeline salta lo ya hecho (transcript/análisis/clips/renders existentes).
 */
function FinishedRow({ entry, onDismiss }: { entry: QueueEntryView; onDismiss: () => void }) {
  const ok = entry.status === "done";
  const [showReason, setShowReason] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const canRetry =
    entry.kind === "long_form" ||
    Boolean(entry.params?.videoId && entry.params.styles?.length);

  async function retryLongForm() {
    // El job de largos persiste su request original — lo re-encolamos tal cual.
    const pr = await fetch(`/api/long_form/progress?jobId=${encodeURIComponent(entry.jobId)}`);
    if (!pr.ok) throw new Error(`HTTP ${pr.status}`);
    const job = (await pr.json()) as { request?: Record<string, unknown> };
    if (!job?.request) {
      throw new Error("este trabajo no guardó su configuración — arrancalo de nuevo desde Videos largos");
    }
    const r = await fetch("/api/long_form/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job.request),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => null);
      throw new Error(
        data && typeof data.error === "string" ? data.error : `HTTP ${r.status}`
      );
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      if (entry.kind === "long_form") {
        await retryLongForm();
        toast.success("Trabajo reanudado ✓", {
          description: "Retoma saltando lo que ya estaba hecho.",
        });
      } else {
        if (!entry.params) return;
        const r = await fetch("/api/editor/auto-build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: entry.params.videoId,
            styles: entry.params.styles,
            accentColor: entry.params.accentColor,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success("Va de nuevo — lo verás aquí mientras se edita.");
      }
      onDismiss();
    } catch (err) {
      toastError(err, "No se pudo reintentar la edición", {
        action: { label: "Intentar de nuevo", onClick: retry },
      });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className={cn(
        "mb-1.5 rounded-md border p-2 text-xs",
        ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
      )}
    >
      <div className="flex items-start gap-2">
        {ok ? (
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-[11px] text-foreground" title={entry.videoId}>
            {humanJobName(entry)}
          </p>
          <p className={cn("text-[9px]", ok ? "text-emerald-300" : "text-red-300")}>
            {ok ? "Listo ✓" : "Falló"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {ok ? (
            <Link
              href={`/publicar?q=${encodeURIComponent(entry.videoId ?? "")}`}
              className="rounded border border-brand-pink/30 px-1.5 py-0.5 text-[10px] text-brand-pink hover:bg-brand-pink/15"
            >
              Verlo
            </Link>
          ) : (
            <>
              {entry.error && (
                <button
                  type="button"
                  onClick={() => setShowReason((s) => !s)}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {showReason ? "Ocultar" : "¿Por qué?"}
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  onClick={retry}
                  disabled={retrying}
                  className="flex items-center gap-1 rounded border border-red-500/30 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/15 disabled:opacity-50"
                >
                  {retrying ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-2.5 w-2.5" />
                  )}
                  {entry.kind === "long_form" ? "Reanudar" : "Reintentar"}
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Cerrar"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      {!ok && showReason && entry.error && (
        <p className="mt-1.5 rounded bg-red-500/10 p-1.5 text-[10px] leading-snug text-red-200">
          {entry.error}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status, position }: { status: string; position: number | null }) {
  if (status === "queued" && position != null) {
    return (
      <span className="flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground">
        <Clock className="h-2.5 w-2.5" />
        #{position}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] tracking-wider text-amber-300">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Editando…
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex items-center gap-0.5 rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] tracking-wider text-emerald-300">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Listo ✓
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-0.5 rounded bg-red-500/20 px-1 py-0.5 text-[9px] tracking-wider text-red-300">
        <XCircle className="h-2.5 w-2.5" />
        Falló
      </span>
    );
  }
  return (
    <span className="rounded bg-muted px-1 py-0.5 font-mono-tab text-[9px] uppercase tracking-wider text-muted-foreground">
      {status}
    </span>
  );
}
