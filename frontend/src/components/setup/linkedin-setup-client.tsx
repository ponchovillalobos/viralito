"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ExternalLink,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Briefcase,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";

/**
 * Wizard guiado para conectar LinkedIn en ~2 minutos. Filosofía:
 *   - 1 paso visible a la vez (cada uno se marca ✓ al confirmar)
 *   - Todos los textos listos para copy-paste con 1 click
 *   - Después de guardar credenciales, dispara OAuth automático sin pasos extra
 *   - Si el OAuth ya está completado (vuelta del callback), salta a "listo"
 */

interface CopyableRowProps {
  label: string;
  value: string;
  multiline?: boolean;
}

function CopyableRow({ label, value, multiline }: CopyableRowProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono-tab">
        {label}
      </Label>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
        <code
          className={cn(
            "flex-1 font-mono-tab text-xs text-foreground break-all",
            multiline && "whitespace-pre-wrap"
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast.success(`${label} copiado`);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand-pink"
          title={`Copiar ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

interface SettingsState {
  linkedin: {
    clientId: string;
    hasClientSecret: boolean;
    hasAccessToken: boolean;
    connectedName: string;
    analyticsEnabled: boolean;
  };
}

type StepKey = "openPortal" | "createApp" | "configureProducts" | "addRedirect" | "credentials" | "oauth";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "openPortal", label: "Abrir LinkedIn Developers" },
  { key: "createApp", label: "Crear la app" },
  { key: "configureProducts", label: "Activar productos" },
  { key: "addRedirect", label: "Agregar redirect URL" },
  { key: "credentials", label: "Pegar Client ID + Secret" },
  { key: "oauth", label: "Conectar tu cuenta" },
];

export function LinkedInSetupClient() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Record<StepKey, boolean>>({
    openPortal: false,
    createApp: false,
    configureProducts: false,
    addRedirect: false,
    credentials: false,
    oauth: false,
  });

  async function loadSettings() {
    const r = await fetch("/api/settings");
    const d = await r.json();
    setSettings(d);
    setClientId(d.linkedin?.clientId ?? "");
    // Si ya hay credenciales guardadas, marcar pasos previos como done
    if (d.linkedin?.clientId && d.linkedin?.hasClientSecret) {
      setDone((s) => ({
        ...s,
        openPortal: true,
        createApp: true,
        configureProducts: true,
        addRedirect: true,
        credentials: true,
      }));
    }
    if (d.linkedin?.hasAccessToken) {
      setDone({
        openPortal: true,
        createApp: true,
        configureProducts: true,
        addRedirect: true,
        credentials: true,
        oauth: true,
      });
    }
  }

  // Load on mount — patrón válido pero el lint quiere `use(promise)` (React 19).
  // No migramos: pantalla de setup, abre pocas veces, un render extra es invisible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, []);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/auth/linkedin/callback`;
  const isConnected = Boolean(settings?.linkedin.hasAccessToken);
  const hasCreds = Boolean(settings?.linkedin.clientId && settings?.linkedin.hasClientSecret);

  async function saveAndConnect() {
    if (!clientId.trim()) {
      toast.error("Pega el Client ID antes de continuar");
      return;
    }
    if (!clientSecret.trim() && !settings?.linkedin.hasClientSecret) {
      toast.error("Pega el Client Secret antes de continuar");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin: {
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDone((s) => ({ ...s, credentials: true }));
      toast.success("Credenciales guardadas. Redirigiendo a LinkedIn para autorizar…");
      // Auto-redirect a OAuth — sin clic extra
      setTimeout(() => {
        window.location.href = "/api/auth/linkedin/login";
      }, 600);
    } catch (err) {
      toastError(err, "No se pudieron guardar las credenciales");
      setSaving(false);
    }
  }

  function markDone(key: StepKey) {
    setDone((s) => ({ ...s, [key]: true }));
  }

  async function toggleAnalytics(next: boolean) {
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin: { analyticsEnabled: next } }),
      });
      await loadSettings();
      toast.success(
        next
          ? "Métricas habilitadas. Reconecta LinkedIn para otorgar el permiso (requiere que tu app esté aprobada)."
          : "Métricas deshabilitadas."
      );
    } catch {
      toast.error("No se pudo guardar la preferencia.");
    }
  }

  // ─── Pasos individuales ───────────────────────────────────────────────────

  const completedCount = STEPS.filter((s) => done[s.key]).length;
  const progress = Math.round((completedCount / STEPS.length) * 100);

  return (
    // pb-28 deja aire para la barra fija de acción del fondo (que no tape contenido).
    <div className="space-y-6 pb-28">
      <header className="space-y-2">
        <p className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
          setup express · linkedin · ~2 minutos
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Conectar LinkedIn en 6 pasos
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          LinkedIn no permite que yo inicie sesión con tu contraseña (sería contra sus
          términos y podría suspenderte la cuenta). Lo que sí podemos hacer: te pre-cargo
          TODOS los textos a pegar, y cuando llegues al final, conecto solo. Tú haces ~6 clics.
        </p>
        {/* Progress bar */}
        <div className="space-y-1 pt-2">
          <div className="flex items-center justify-between font-mono-tab text-[10px] text-muted-foreground">
            <span>
              progreso {completedCount}/{STEPS.length}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-sky-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      {/* Si ya está todo conectado, success */}
      {isConnected && (
        <Card className="border-emerald-500/40 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <div className="flex-1">
              <p className="text-base font-medium text-emerald-200">
                LinkedIn conectado ✓
              </p>
              <p className="text-xs text-muted-foreground">
                Cuenta:{" "}
                <span className="text-sky-400">
                  {settings?.linkedin.connectedName || "(conectado)"}
                </span>
              </p>
            </div>
            <Link
              href="/produccion"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-pink px-4 text-sm font-medium text-white hover:bg-brand-pink/90"
            >
              Ir a Producción <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      )}

      {/* ── Paso 1: abrir portal ──────────────────────── */}
      <StepCard
        index={1}
        title="Abrir LinkedIn Developers"
        complete={done.openPortal}
        showCheck={done.openPortal && !isConnected}
      >
        <p className="text-sm text-muted-foreground">
          Te abro el portal en una pestaña nueva. Si no has iniciado sesión, te va a pedir
          tu correo + contraseña (de LinkedIn — yo no veo nada de eso).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://www.linkedin.com/developers/apps"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => markDone("openPortal")}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-sky-500 px-4 text-sm font-medium text-white hover:bg-sky-400"
          >
            <Briefcase className="h-3.5 w-3.5" />
            Abrir developers.linkedin.com/apps
            <ExternalLink className="h-3 w-3" />
          </a>
          {done.openPortal && (
            <span className="font-mono-tab text-[10px] text-emerald-400">✓ abierto</span>
          )}
        </div>
      </StepCard>

      {/* ── Paso 2: crear app ─────────────────────────── */}
      <StepCard
        index={2}
        title="Crear la app"
        complete={done.createApp}
        locked={!done.openPortal}
      >
        <p className="text-sm text-muted-foreground">
          En el portal: clic en <strong>Create app</strong>. Si te pide vincular a una{" "}
          <strong>LinkedIn Page</strong>, puedes usar cualquier página que administres (si
          no tienes, LinkedIn ofrece crear una rápido — tipo «página personal»).
        </p>
        <p className="text-sm text-muted-foreground">
          Pega estos valores con un clic:
        </p>
        <div className="space-y-2">
          <CopyableRow label="App name" value="Estrategia Viral Poncho" />
          <CopyableRow label="Privacy policy URL" value={`${baseUrl}/privacy`} />
        </div>
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
          Marca la casilla &quot;<strong>I have read and agree to these terms</strong>&quot; al final → clic en{" "}
          <strong>Create app</strong>.
        </p>
        <Button
          variant={done.createApp ? "outline" : "default"}
          onClick={() => markDone("createApp")}
          disabled={!done.openPortal}
        >
          {done.createApp ? "✓ App creada" : "App creada, siguiente paso"}
        </Button>
      </StepCard>

      {/* ── Paso 3: products ──────────────────────────── */}
      <StepCard
        index={3}
        title="Activar productos (auto-aprobados)"
        complete={done.configureProducts}
        locked={!done.createApp}
      >
        <p className="text-sm text-muted-foreground">
          Una vez creada la app, ve a la pestaña <strong>Products</strong> y pide acceso
          a estos dos. Son <em>self-serve</em> — se aprueban en ~30 segundos cada uno:
        </p>
        <div className="space-y-1.5">
          <code className="block rounded bg-muted/30 px-2 py-1 font-mono-tab text-xs text-foreground">
            ✓ Sign In with LinkedIn using OpenID Connect
          </code>
          <code className="block rounded bg-muted/30 px-2 py-1 font-mono-tab text-xs text-foreground">
            ✓ Share on LinkedIn
          </code>
        </div>
        <Button
          variant={done.configureProducts ? "outline" : "default"}
          onClick={() => markDone("configureProducts")}
          disabled={!done.createApp}
        >
          {done.configureProducts ? "✓ Productos activados" : "Productos activados, seguir"}
        </Button>
      </StepCard>

      {/* ── Paso 4: redirect URL ──────────────────────── */}
      <StepCard
        index={4}
        title="Agregar Redirect URL"
        complete={done.addRedirect}
        locked={!done.configureProducts}
      >
        <p className="text-sm text-muted-foreground">
          Pestaña <strong>Auth</strong> → sección <strong>OAuth 2.0 settings</strong> →{" "}
          <strong>Authorized redirect URLs for your app</strong> → clic en el lápiz (Edit).
          Agrega esta URL exacta:
        </p>
        <CopyableRow label="Authorized Redirect URL" value={redirectUri} />
        <p className="text-xs text-muted-foreground">
          Clic en <strong>Update</strong> abajo para guardar. Confirma que arriba los
          <strong> OAuth 2.0 scopes</strong> muestran <code>openid</code>,{" "}
          <code>profile</code> y <code>w_member_social</code> (deberían aparecer solos
          después del paso 3).
        </p>
        <Button
          variant={done.addRedirect ? "outline" : "default"}
          onClick={() => markDone("addRedirect")}
          disabled={!done.configureProducts}
        >
          {done.addRedirect ? "✓ Redirect agregada" : "Redirect agregada, siguiente"}
        </Button>
      </StepCard>

      {/* ── Paso 5: credentials ───────────────────────── */}
      <StepCard
        index={5}
        title="Pegar Client ID + Secret"
        complete={done.credentials}
        locked={!done.addRedirect}
      >
        <p className="text-sm text-muted-foreground">
          En la misma pestaña <strong>Auth</strong>, arriba ves <strong>Application credentials</strong>.
          Copia los dos valores y pégalos aquí. Se guardan en{" "}
          <code className="font-mono-tab text-[10px]">
            C:\hermes-data\user-settings.json
          </code>{" "}
          local — nunca salen de tu compu.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Client ID</Label>
            <Input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="77abcdefghij1k"
              className="font-mono-tab"
              disabled={!done.addRedirect}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Primary Client Secret
              {settings?.linkedin.hasClientSecret && (
                <span className="ml-2 font-mono-tab text-[10px] text-emerald-400">
                  (guardado · déjalo vacío para no cambiarlo)
                </span>
              )}
            </Label>
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={
                settings?.linkedin.hasClientSecret ? "••••••••••" : "WPL_xxxxxxxxx"
              }
              className="font-mono-tab"
              autoComplete="new-password"
              disabled={!done.addRedirect}
            />
          </div>
          <p className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] text-sky-200">
            <Sparkles className="mr-1 inline h-3 w-3" />
            Al guardar, te llevo directo a LinkedIn para que autorices la app. No tienes que
            tocar nada más — son 2 clics en la página de LinkedIn («Allow») y vuelves aquí
            con todo conectado.
          </p>
          <Button
            onClick={saveAndConnect}
            disabled={
              saving ||
              !done.addRedirect ||
              !clientId.trim() ||
              (!clientSecret.trim() && !settings?.linkedin.hasClientSecret)
            }
            className="bg-sky-500 hover:bg-sky-400 text-white"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {saving ? "Guardando + conectando…" : "Guardar y autorizar en LinkedIn"}
          </Button>
        </div>
      </StepCard>

      {/* ── Paso 6: OAuth (auto) ──────────────────────── */}
      <StepCard
        index={6}
        title="Conectar tu cuenta"
        complete={done.oauth}
        locked={!hasCreds}
      >
        {isConnected ? (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
            ✓ Conectado como {settings?.linkedin.connectedName}
          </p>
        ) : hasCreds ? (
          <>
            <p className="text-sm text-muted-foreground">
              Da clic en el botón de abajo si no se disparó solo del paso 5 (puede pasar
              si tu navegador bloquea el redirect automático).
            </p>
            <Button
              onClick={() => (window.location.href = "/api/auth/linkedin/login")}
              className="bg-sky-500 hover:bg-sky-400 text-white"
            >
              <Briefcase className="mr-1.5 h-3.5 w-3.5" />
              Conectar mi LinkedIn ahora
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Completa el paso 5 primero (guardar credenciales) y este paso se ejecuta solo.
          </p>
        )}
      </StepCard>

      {/* ── Avanzado: métricas reales (opt-in) ───────────────────────── */}
      <Card className="border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="li-analytics"
            checked={Boolean(settings?.linkedin.analyticsEnabled)}
            onChange={(e) => toggleAnalytics(e.target.checked)}
            className="mt-1 h-4 w-4 accent-sky-500"
          />
          <label htmlFor="li-analytics" className="space-y-1">
            <span className="text-sm font-medium">
              Métricas reales de LinkedIn (avanzado)
            </span>
            <p className="text-xs text-muted-foreground">
              Trae impresiones, reacciones, comentarios y reposts de tus posts directo a
              la app (botón &quot;Sincronizar LinkedIn&quot; en /metricas). Usa la
              <strong> Member Post Analytics API</strong>, que <strong>no es self-serve</strong>:
              LinkedIn tiene que <strong>aprobar tu app</strong> para esa API (formulario gratis).
              Al activarlo, el próximo &quot;Conectar&quot; pide el permiso{" "}
              <code className="font-mono-tab text-[10px]">r_member_postAnalytics</code> —
              si tu app aún no está aprobada, LinkedIn rechazará el login. Mientras tanto, deja
              esto apagado y carga las métricas a mano en /metricas.
            </p>
          </label>
        </div>
      </Card>

      {/* Footer help */}
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">¿Algo no funciona?</p>
        <ul className="mt-2 space-y-1">
          <li>
            • Si en el paso 4 LinkedIn no acepta la redirect URL, verifica que estés
            pegando exactamente <code>{redirectUri}</code> (sin barra al final).
          </li>
          <li>
            • Si el botón &quot;Conectar mi LinkedIn&quot; falla, ve a{" "}
            <Link href="/produccion" className="text-sky-400 hover:underline">
              /produccion
            </Link>{" "}
            y abre Configuración → reintenta desde ahí.
          </li>
          <li>
            • Los tokens duran 60 días — después la app te avisa y reconectas con un clic.
          </li>
        </ul>
      </div>

      {/* Barra fija de acción: el botón principal accesible sin scroll. Reusa el
          mismo handler/estado que los pasos 5 y 6 (aditivo, sin duplicar lógica). */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {isConnected
              ? `LinkedIn conectado ✓${settings?.linkedin.connectedName ? ` (${settings.linkedin.connectedName})` : ""}`
              : hasCreds
                ? "Credenciales listas — conecta tu cuenta de LinkedIn."
                : "Completa los pasos y pega tus credenciales para conectar."}
          </p>
          {isConnected ? (
            <Link
              href="/produccion"
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-pink px-4 text-sm font-medium text-white hover:bg-brand-pink/90"
            >
              Ir a Producción <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : hasCreds ? (
            <Button
              onClick={() => (window.location.href = "/api/auth/linkedin/login")}
              className="ml-auto bg-sky-500 hover:bg-sky-400 text-white"
            >
              <Briefcase className="mr-1.5 h-3.5 w-3.5" />
              Conectar mi LinkedIn ahora
            </Button>
          ) : (
            <Button
              onClick={saveAndConnect}
              disabled={
                saving ||
                !done.addRedirect ||
                !clientId.trim() ||
                (!clientSecret.trim() && !settings?.linkedin.hasClientSecret)
              }
              className="ml-auto bg-sky-500 hover:bg-sky-400 text-white"
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {saving ? "Guardando + conectando…" : "Guardar y autorizar en LinkedIn"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tarjeta de paso individual con indicador de complete + lock cuando depende del paso anterior.
 */
function StepCard({
  index,
  title,
  complete,
  locked,
  showCheck,
  children,
}: {
  index: number;
  title: string;
  complete: boolean;
  locked?: boolean;
  showCheck?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "border-border bg-card p-5 transition-opacity",
        complete && "border-emerald-500/30",
        locked && "opacity-50"
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
            complete ? "bg-emerald-500 text-black" : "bg-muted text-muted-foreground"
          )}
        >
          {complete || showCheck ? <Check className="h-3.5 w-3.5" /> : index}
        </span>
        <h2 className="text-base font-medium">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}
