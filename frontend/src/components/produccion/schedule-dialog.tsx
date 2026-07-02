"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Loader2, Music2, Briefcase, Camera } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";

type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "SELF_ONLY"
  | "FOLLOWER_OF_CREATOR";

type SchedulePlatform = "tiktok" | "linkedin" | "instagram_bridge";

interface CaptionMap {
  tiktok?: string;
  linkedin?: string;
  instagram?: string;
}

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Caption legacy (TikTok). Si vienen captions{}, se ignora. */
  caption: string;
  /** Nuevo: 3 captions distintos según la plataforma destino. */
  captions?: CaptionMap;
  source: "short" | "long_form";
  onScheduled?: () => void;
}

const PLATFORM_CHOICES: {
  key: SchedulePlatform;
  label: string;
  icon: typeof Music2;
  color: string;
  hint: string;
}[] = [
  { key: "tiktok", label: "TikTok", icon: Music2, color: "text-pink-400", hint: "API directa" },
  { key: "linkedin", label: "LinkedIn", icon: Briefcase, color: "text-sky-400", hint: "API directa" },
  { key: "instagram_bridge", label: "Instagram", icon: Camera, color: "text-amber-400", hint: "te aviso a la hora — subes manual" },
];

/** Devuelve ISO datetime sin segundos para input type="datetime-local" — en zona local. */
function defaultScheduledAtLocalISO(): string {
  const d = new Date(Date.now() + 30 * 60_000); // default +30 min
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleDialog({
  open,
  onOpenChange,
  projectId,
  caption,
  captions,
  source,
  onScheduled,
}: ScheduleDialogProps) {
  const [scheduledAt, setScheduledAt] = useState<string>(defaultScheduledAtLocalISO());
  const [selected, setSelected] = useState<Set<SchedulePlatform>>(new Set(["tiktok"]));
  // Default "inbox" (borrador): las apps de TikTok SIN auditar no pueden publicar "direct" a
  // cuentas públicas (error unaudited_client_can_only_post_to_private_accounts). Inbox sube el
  // video a los borradores de TikTok y el usuario lo publica desde la app. Direct sirve una vez
  // que la app pasa la auditoría de TikTok.
  const [mode, setMode] = useState<"direct" | "inbox">("inbox");
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>("SELF_ONLY");
  const [captionByPlatform, setCaptionByPlatform] = useState<Record<SchedulePlatform, string>>({
    tiktok: "",
    linkedin: "",
    instagram_bridge: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // Default captions resolved from props (memoized to avoid re-running on every render).
  const initialCaptions = useMemo<Record<SchedulePlatform, string>>(
    () => ({
      tiktok: captions?.tiktok || caption || "",
      linkedin: captions?.linkedin || caption || "",
      instagram_bridge: captions?.instagram || caption || "",
    }),
    [captions, caption]
  );

  // Reset on open: patrón store-and-compare en vez de useEffect+setState.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setScheduledAt(defaultScheduledAtLocalISO());
      setSelected(new Set(["tiktok"]));
      setMode("inbox");
      setPrivacyLevel("SELF_ONLY");
      setCaptionByPlatform({ ...initialCaptions });
    }
  }

  function togglePlatform(p: SchedulePlatform) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function submit(publishNow: boolean) {
    if (selected.size === 0) {
      toast.error("Elige al menos una plataforma");
      return;
    }
    setSubmitting(true);
    try {
      const at = publishNow ? Date.now() : new Date(scheduledAt).getTime();
      if (!publishNow && (isNaN(at) || at < Date.now() - 60_000)) {
        toast.error("La fecha tiene que ser futura");
        setSubmitting(false);
        return;
      }
      const platforms = Array.from(selected);
      const results = await Promise.allSettled(
        platforms.map((platform) => {
          const captionText = captionByPlatform[platform] || caption;
          return fetch("/api/tiktok/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              source,
              scheduledAt: at,
              platform,
              caption: captionText,
              // Sólo aplican a TikTok pero el endpoint los ignora para otras
              mode,
              privacyLevel,
            }),
          }).then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(`${platform}: ${data.error ?? res.status}`);
            return { platform, data };
          });
        })
      );

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      if (successes.length > 0) {
        const labels = successes
          .map((r) => (r as PromiseFulfilledResult<{ platform: SchedulePlatform }>).value.platform)
          .join(", ");
        toast.success(
          publishNow
            ? `Disparado en ${labels} — se procesa en ≤60 s`
            : `Programado en ${labels} para ${new Date(at).toLocaleString("es")}`
        );
      }
      for (const f of failures) {
        toastError(f.reason, "No se pudo programar la publicación");
      }
      if (successes.length > 0) {
        onScheduled?.();
        onOpenChange(false);
      }
    } catch (err) {
      toastError(err, "No se pudo programar la publicación");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Programar publicación
          </DialogTitle>
          <DialogDescription className="font-mono-tab text-[11px]">
            {projectId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Plataformas destino */}
          <div className="space-y-2">
            <Label className="text-xs">Plataformas destino</Label>
            <div className="grid grid-cols-3 gap-2">
              {PLATFORM_CHOICES.map((p) => {
                const Icon = p.icon;
                const isSelected = selected.has(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => togglePlatform(p.key)}
                    aria-label={p.label}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] transition-colors",
                      isSelected
                        ? "border-foreground/40 bg-foreground/5"
                        : "border-border bg-muted/30 hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isSelected ? p.color : "text-muted-foreground")} />
                    <span className={cn(isSelected ? "text-foreground" : "text-muted-foreground")}>
                      {p.label}
                    </span>
                    <span className="font-mono-tab text-[9px] text-muted-foreground">
                      {p.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fecha + hora */}
          <div className="space-y-1">
            <Label className="text-xs">Fecha y hora</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="font-mono-tab"
            />
            <p className="font-mono-tab text-[10px] text-muted-foreground">
              Hora local. El scheduler chequea cada 60 segundos.
            </p>
          </div>

          {/* Opciones específicas de TikTok */}
          {selected.has("tiktok") && (
            <div className="space-y-3 rounded-md border border-pink-500/20 bg-pink-500/5 p-3">
              <h4 className="flex items-center gap-1.5 font-mono-tab text-[10px] uppercase tracking-wider text-pink-400">
                <Music2 className="h-3 w-3" /> Opciones TikTok
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Modo</Label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "direct" | "inbox")}
                    className="w-full rounded-md border border-border bg-muted/30 p-2 text-xs font-mono-tab"
                  >
                    <option value="direct">Direct Post</option>
                    <option value="inbox">Inbox (draft)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Privacidad</Label>
                  <select
                    value={privacyLevel}
                    onChange={(e) => setPrivacyLevel(e.target.value as PrivacyLevel)}
                    className="w-full rounded-md border border-border bg-muted/30 p-2 text-xs font-mono-tab"
                    disabled={mode === "inbox"}
                  >
                    <option value="SELF_ONLY">Solo yo</option>
                    <option value="MUTUAL_FOLLOW_FRIENDS">Amigos mutuos</option>
                    <option value="FOLLOWER_OF_CREATOR">Seguidores</option>
                    <option value="PUBLIC_TO_EVERYONE">Público</option>
                  </select>
                </div>
              </div>
              <p className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-[10px] text-amber-200">
                Sandbox: hasta que TikTok apruebe la app, todo sale SELF_ONLY.
              </p>
            </div>
          )}

          {/* Captions editables por plataforma seleccionada */}
          {Array.from(selected).map((platform) => {
            const choice = PLATFORM_CHOICES.find((p) => p.key === platform);
            if (!choice) return null;
            const Icon = choice.icon;
            const value = captionByPlatform[platform] || "";
            const limit = platform === "linkedin" ? 3000 : 2200;
            return (
              <div key={platform} className="space-y-1">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Icon className={cn("h-3 w-3", choice.color)} />
                  Caption {choice.label}
                </Label>
                <textarea
                  value={value}
                  onChange={(e) =>
                    setCaptionByPlatform((c) => ({ ...c, [platform]: e.target.value }))
                  }
                  rows={platform === "linkedin" ? 8 : 4}
                  className="w-full rounded-md border border-border bg-muted/30 p-2 text-xs font-mono-tab"
                  maxLength={limit}
                />
                <p className="font-mono-tab text-[10px] text-muted-foreground">
                  {value.length} / {limit} chars
                  {platform === "instagram_bridge" && (
                    <span className="ml-1 text-amber-400">
                      · IG bridge — copio este texto cuando te notifico
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(true)}
            disabled={submitting || selected.size === 0}
            title="Subir ahora mismo (el scheduler lo procesa en ≤60 s)"
          >
            Subir ahora
          </Button>
          <Button onClick={() => submit(false)} disabled={submitting || selected.size === 0}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Programar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Mantener export type para uso externo
export type { SchedulePlatform };
