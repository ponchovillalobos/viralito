"use client";

/**
 * Panel de licencia para Configuración → pestaña "🔑 Licencia".
 *
 * Al montarse consulta GET /api/license y muestra el estado:
 *  - trial          → badge ámbar + días/videos restantes + campo para activar
 *  - trial_expired  → badge rojo + invitación a activar + campo
 *  - active         → badge verde + datos de la licencia (sin campo)
 *
 * La activación es POST /api/license { key }. El error del server se muestra
 * BAJO el campo (no en un toast genérico) para que el usuario corrija ahí mismo.
 * Todo es offline: la clave se valida en la compu del usuario.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";

interface LicenseInfo {
  status: "trial" | "active" | "trial_expired";
  daysLeft?: number;
  rendersLeft?: number;
  name?: string;
  tier?: "personal" | "agencia";
  machines?: number;
  /** YYYY-MM-DD; año ≥ 2099 significa "de por vida". */
  updatesUntil?: string;
  trialDays: number;
  trialRenders: number;
}

/** "2027-03-15" → "15 de marzo de 2027" (es-MX), o "de por vida" si año ≥ 2099.
 *  Parseamos a mano para evitar el corrimiento de día por zona horaria UTC. */
function formatUpdatesUntil(updatesUntil: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(updatesUntil.trim());
  if (!m) return updatesUntil;
  const year = Number(m[1]);
  if (year >= 2099) return "de por vida";
  const date = new Date(year, Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

export function LicensePanel() {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);
  /** Error que devolvió el server al activar — se muestra bajo el campo. */
  const [keyError, setKeyError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/license", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setInfo((await r.json()) as LicenseInfo);
    } catch (err) {
      toastError(err, "No se pudo consultar tu licencia");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carga inicial de la licencia (refresh hace setLoading(true) sync): fetch-on-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function activate() {
    const trimmed = key.trim();
    if (!trimmed) {
      setKeyError("Pega tu clave de licencia primero.");
      return;
    }
    setActivating(true);
    setKeyError(null);
    try {
      const r = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const d = (await r.json()) as { ok: boolean; error?: string };
      if (!r.ok || !d.ok) {
        // Error del server (clave inválida, etc.) → bajo el campo, no toast.
        setKeyError(d.error ?? "La clave no es válida. Revisa que la copiaste completa.");
        return;
      }
      toast.success("¡Licencia activada! Gracias por tu compra 🎉");
      setKey("");
      await refresh();
    } catch (err) {
      // Falla de red/app (no hubo respuesta del server) → toast humano.
      toastError(err, "No se pudo activar la licencia");
    } finally {
      setActivating(false);
    }
  }

  if (loading && !info) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> consultando tu licencia…
      </div>
    );
  }

  if (!info) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-center">
        <p className="text-xs text-muted-foreground">
          No se pudo consultar tu licencia. Intenta de nuevo.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          Reintentar
        </Button>
      </div>
    );
  }

  const isActive = info.status === "active";
  const isTrial = info.status === "trial";

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
        {/* ── Badge de estado ─────────────────────────── */}
        <div className="flex items-center gap-2">
          {isActive ? (
            <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-emerald-400">
              <ShieldCheck className="h-3 w-3" /> Licencia activa ✓
            </span>
          ) : isTrial ? (
            <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-amber-400">
              Versión de prueba
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-red-400">
              Prueba terminada
            </span>
          )}
        </div>

        {/* ── Detalle según estado ────────────────────── */}
        {isActive ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              A nombre de <span className="text-foreground">{info.name}</span> · plan{" "}
              {info.tier === "agencia" ? "Agencia" : "Personal"} ({info.machines} máquinas)
            </p>
            {info.updatesUntil && (
              <p>Actualizaciones incluidas hasta {formatUpdatesUntil(info.updatesUntil)}</p>
            )}
          </div>
        ) : isTrial ? (
          <p className="text-xs text-muted-foreground">
            Te quedan <span className="text-amber-300">{info.daysLeft} días</span> y{" "}
            <span className="text-amber-300">{info.rendersLeft} videos</span>. Los videos de
            prueba llevan una marca de agua discreta.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tu prueba gratuita terminó. Activa tu licencia para seguir creando sin límites.
          </p>
        )}

        {/* ── Campo + botón de activación (solo sin licencia) ── */}
        {!isActive && (
          <div className="space-y-2 pt-1">
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5 text-xs">
                <KeyRound className="h-3.5 w-3.5" /> Tu clave de licencia
              </Label>
              <Input
                type="text"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (keyError) setKeyError(null);
                }}
                placeholder="EVP1.…"
                className="font-mono-tab text-xs"
                autoComplete="off"
                spellCheck={false}
              />
              {keyError && <p className="text-[11px] text-red-400">{keyError}</p>}
            </div>
            <Button type="button" size="sm" onClick={activate} disabled={activating}>
              {activating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Activar licencia
            </Button>
          </div>
        )}
      </section>

      {/* ── Nota al pie: privacidad y permanencia ───── */}
      <p className="text-[11px] text-muted-foreground">
        Tu licencia se valida en tu compu — sin internet, sin cuentas. La app nunca deja de
        funcionar aunque venzan las actualizaciones.
      </p>
    </div>
  );
}
