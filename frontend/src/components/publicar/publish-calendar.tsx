"use client";

/**
 * Calendario de publicaciones — Fase 0 de la sección "Programar y publicar" (estilo Postiz).
 * SOLO LECTURA sobre los datos que YA existen (`scheduled-uploads.json` vía /api/scheduled/list):
 * no cambia el comportamiento del scheduler ni de la publicación. Muestra un mes con los posts
 * programados como chips coloreados por red, + un sidebar de canales (como el de Postiz).
 * El composer (crear post) llega en la Fase 1; "Nuevo post" por ahora lleva a Mis videos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Circle, CheckCircle2 } from "lucide-react";
import { PLATFORMS, type PlatformKey } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { PublishComposer } from "./publish-composer";

type SchedulePlatform = "tiktok" | "linkedin" | "instagram_bridge";
interface ScheduledUpload {
  id: string;
  projectId: string;
  scheduledAt: number;
  platform: SchedulePlatform;
  caption: string;
  title: string;
  status: string;
}

// La red del scheduler → la key de PLATFORMS (para color/label). instagram_bridge = instagram.
function platformKey(p: SchedulePlatform): PlatformKey {
  if (p === "instagram_bridge") return "instagram";
  return p as PlatformKey;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Programado",
  running: "Publicando…",
  uploaded: "Subido",
  published: "Publicado",
  pending_manual: "Esperando (manual)",
  failed: "Falló",
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Celdas de un mes empezando en LUNES (6 filas × 7). Devuelve fechas (incluye días de relleno). */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=Dom … 6=Sáb. Queremos Lun=0.
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function PublishCalendar() {
  const [uploads, setUploads] = useState<ScheduledUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const loadUploads = useCallback(() => {
    fetch("/api/scheduled/list")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.uploads)) setUploads(d.uploads);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const today = new Date();

  // Posts por día (epoch → Date local).
  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledUpload[]>();
    for (const u of uploads) {
      const d = new Date(u.scheduledAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(u);
      map.set(key, arr);
    }
    return map;
  }, [uploads]);

  function prevMonth() {
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }));
  }
  function nextMonth() {
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }));
  }

  const channels = (Object.keys(PLATFORMS) as PlatformKey[]).map((k) => PLATFORMS[k]);

  // Estado de conexión por red (Conectado/Conectar en el sidebar). Facebook reusa la conexión
  // de Meta de Instagram → está conectado cuando IG lo está, y su link de conectar es el de IG.
  const [conn, setConn] = useState<Record<string, { connected: boolean; name?: string }>>({});
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        const igConnected = Boolean(s?.instagram?.hasAccessToken);
        setConn({
          instagram: { connected: igConnected, name: s?.instagram?.connectedUsername },
          facebook: { connected: igConnected, name: s?.instagram?.connectedUsername },
          linkedin: { connected: Boolean(s?.linkedin?.hasAccessToken), name: s?.linkedin?.connectedName },
          tiktok: { connected: Boolean(s?.tiktok?.hasAccessToken), name: s?.tiktok?.connectedUsername },
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      {/* Sidebar de canales (estilo Postiz) */}
      <aside className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tus redes
          </p>
          <ul className="space-y-2">
            {channels.map((p) => {
              const c = conn[p.key];
              // Facebook reusa el OAuth de Meta (Instagram).
              const loginKey = p.key === "facebook" ? "instagram" : p.key;
              return (
                <li key={p.key} className="flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.label.slice(0, 2)}
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-medium">
                    {p.label}
                    {c?.connected && c.name && (
                      <span className="block truncate text-[10px] font-normal text-muted-foreground">
                        {c.name}
                      </span>
                    )}
                  </span>
                  {c?.connected ? (
                    <span
                      className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-400"
                      title={`${p.label} conectado`}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Conectado
                    </span>
                  ) : (
                    <a
                      href={`/api/auth/${loginKey}/login`}
                      className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                      title={`Conectar ${p.label}`}
                    >
                      <Circle className="h-2.5 w-2.5" /> Conectar
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
            Conecta una vez y tus videos se programan y publican solos a la hora elegida.
          </p>
        </div>
      </aside>

      {/* Calendario */}
      <div className="rounded-xl border border-border bg-card">
        {/* Header del mes */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold capitalize">
              {MONTHS[cursor.month]} {cursor.year}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prevMonth}
              className="rounded-md border border-border p-1.5 transition hover:border-foreground/40"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs transition hover:border-foreground/40"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={nextMonth}
              className="rounded-md border border-border p-1.5 transition hover:border-foreground/40"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="ml-2 flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-400"
            >
              <Plus className="h-3.5 w-3.5" /> Nuevo post
            </button>
          </div>
        </div>

        {/* Grilla */}
        <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === cursor.month;
            const isToday = sameDay(d, today);
            const posts = byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? [];
            return (
              <div
                key={i}
                className={cn(
                  "min-h-[92px] border-b border-r border-border/60 p-1.5",
                  !inMonth && "bg-muted/20",
                  i % 7 === 6 && "border-r-0",
                )}
              >
                <div
                  className={cn(
                    "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday ? "bg-emerald-500 font-semibold text-white" : "text-muted-foreground",
                    !inMonth && "opacity-40",
                  )}
                >
                  {d.getDate()}
                </div>
                <div className="space-y-1">
                  {posts.slice(0, 3).map((u) => {
                    const pk = platformKey(u.platform);
                    const color = PLATFORMS[pk]?.color ?? "#888";
                    return (
                      <div
                        key={u.id}
                        className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: color }}
                        title={`${PLATFORMS[pk]?.label} · ${STATUS_LABEL[u.status] ?? u.status}\n${u.caption || u.title}`}
                      >
                        {new Date(u.scheduledAt).toLocaleTimeString("es", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        {u.caption || u.title || "post"}
                      </div>
                    );
                  })}
                  {posts.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{posts.length - 3} más</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {loading && (
          <p className="p-4 text-center text-xs text-muted-foreground">Cargando calendario…</p>
        )}
        {!loading && uploads.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Aún no hay publicaciones programadas. Tocá &quot;Nuevo post&quot; para programar una.
          </p>
        )}
      </div>

      <PublishComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onScheduled={loadUploads}
      />
    </div>
  );
}
