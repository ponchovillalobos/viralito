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
  Music2,
} from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";

interface CopyableRowProps {
  label: string;
  value: string;
}

function CopyableRow({ label, value }: CopyableRowProps) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono-tab">
        {label}
      </Label>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
        <code className="flex-1 font-mono-tab text-xs text-foreground break-all">
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
  tiktok: {
    clientKey: string;
    hasClientSecret: boolean;
    hasAccessToken: boolean;
    connectedUsername: string;
  };
}

export function TikTokSetupClient() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [clientKey, setClientKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadSettings() {
    const r = await fetch("/api/settings");
    const d = await r.json();
    setSettings(d);
    setClientKey(d.tiktok?.clientKey ?? "");
  }

  // Carga inicial de settings desde el server. Patrón "load on mount" estándar:
  // el lint react-hooks/set-state-in-effect querría React 19 `use(promise)` o SWR,
  // pero el costo de migrarlo no se justifica para una pantalla de setup que se abre
  // contadas veces y donde un render extra es invisible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiktok: { clientKey: clientKey.trim(), clientSecret: clientSecret.trim() },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadSettings();
      setClientSecret("");
      toast.success("Credenciales guardadas. Ahora puedes conectar tu TikTok.");
    } catch (err) {
      toastError(err, "No se pudieron guardar las credenciales");
    } finally {
      setSaving(false);
    }
  }

  function connect() {
    window.location.href = "/api/auth/tiktok/login";
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/auth/tiktok/callback`;
  const privacyUrl = `${baseUrl}/privacy`;
  const termsUrl = `${baseUrl}/terms`;
  const isConnected = Boolean(settings?.tiktok.hasAccessToken);
  const hasCreds = Boolean(settings?.tiktok.clientKey && settings?.tiktok.hasClientSecret);

  return (
    // pb-28 deja aire para la barra fija de acción del fondo (que no tape contenido).
    <div className="space-y-6 pb-28">
      <header className="space-y-2">
        <p className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
          setup · tiktok content posting api
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Conectar TikTok paso a paso
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Una vez registrada y aprobada tu app en TikTok Developer, vas a poder
          programar publicaciones directo desde la app. Te llevo por cada
          campo del formulario con los valores exactos para copiar y pegar.
        </p>
      </header>

      {/* ── Estado actual ─────────────────── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-medium">
          Estado actual
        </h2>
        <ul className="space-y-1.5 font-mono-tab text-xs">
          <li className="flex items-center gap-2">
            {hasCreds ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <span className="inline-block h-3.5 w-3.5 rounded-full border border-muted-foreground" />
            )}
            Credenciales de app{" "}
            {hasCreds ? (
              <span className="text-emerald-400">configuradas</span>
            ) : (
              <span className="text-amber-400">faltan</span>
            )}
          </li>
          <li className="flex items-center gap-2">
            {isConnected ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <span className="inline-block h-3.5 w-3.5 rounded-full border border-muted-foreground" />
            )}
            Cuenta TikTok{" "}
            {isConnected ? (
              <>
                <span className="text-emerald-400">conectada</span>
                {settings?.tiktok.connectedUsername && (
                  <span className="text-pink-400">({settings.tiktok.connectedUsername})</span>
                )}
              </>
            ) : (
              <span className="text-amber-400">no conectada</span>
            )}
          </li>
        </ul>
        {isConnected && (
          <div className="mt-4 flex gap-2">
            <Link
              href="/produccion"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-pink px-4 text-sm font-medium text-white hover:bg-brand-pink/90"
            >
              Ir a Producción <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </Card>

      {/* ── Paso 1: ir al portal ────────────── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">
          1. Abrir TikTok for Developers
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Inicia sesión con tu cuenta personal de TikTok (la que vas a usar para publicar).
        </p>
        <a
          href="https://developers.tiktok.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-pink-500 px-4 text-sm font-medium text-white hover:bg-pink-400"
        >
          <Music2 className="h-3.5 w-3.5" />
          Abrir developers.tiktok.com
          <ExternalLink className="h-3 w-3" />
        </a>
      </Card>

      {/* ── Paso 2: crear app ─────────────── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">2. Crear una nueva app</h2>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Click en <strong>Manage apps</strong> arriba a la derecha.</li>
          <li>Click <strong>Connect a new app</strong>.</li>
          <li>Acepta los Developer Terms.</li>
        </ol>
        <p className="text-sm text-muted-foreground">
          En el formulario que aparece, completa con estos valores exactos (clic en
          📋 para copiar cada uno):
        </p>

        <div className="mt-3 space-y-3">
          <CopyableRow label="App name" value="Estrategia Viral Poncho" />
          <CopyableRow
            label="App description"
            value="Personal dashboard for scheduling viral short-form video content. Single-user, local-first, no analytics. Posts videos with captions to my own TikTok account on schedules I define."
          />
          <CopyableRow label="App category" value="Content / Creator tools" />
          <CopyableRow label="Website URL" value={baseUrl} />
          <CopyableRow label="Privacy policy URL" value={privacyUrl} />
          <CopyableRow label="Terms of service URL" value={termsUrl} />
        </div>

        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          <strong>Ojo:</strong> los URLs de Privacy y Terms apuntan a tu localhost.
          TikTok puede aceptarlos en Sandbox, pero durante el audit van a requerir
          URLs públicas. Cuando llegue ese momento, publica las páginas{" "}
          <code>/privacy</code> y <code>/terms</code> en GitHub Pages o similar y
          actualiza los URLs.
        </div>
      </Card>

      {/* ── Paso 3: products & scopes ─────── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">
          3. Agregar Content Posting API + scopes
        </h2>
        <ol className="space-y-2 pl-5 list-decimal text-sm text-muted-foreground">
          <li>
            En la pantalla de tu app, ve a <strong>Add products</strong>.
          </li>
          <li>
            Selecciona <strong>Login Kit</strong> y <strong>Content Posting API</strong>.
          </li>
          <li>
            En <strong>Scopes</strong> activa exactamente estos 3:
            <div className="mt-2 space-y-1.5">
              <code className="block rounded bg-muted/30 px-2 py-1 font-mono-tab text-xs text-foreground">
                user.info.basic
              </code>
              <code className="block rounded bg-muted/30 px-2 py-1 font-mono-tab text-xs text-foreground">
                video.upload
              </code>
              <code className="block rounded bg-muted/30 px-2 py-1 font-mono-tab text-xs text-foreground">
                video.publish
              </code>
            </div>
          </li>
          <li>
            En <strong>Login Kit → Redirect URIs</strong>, agrega:
          </li>
        </ol>
        <div className="mt-3">
          <CopyableRow label="Redirect URI" value={redirectUri} />
        </div>
      </Card>

      {/* ── Paso 4: copy Client Key + Secret ─── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">
          4. Pega tu Client Key y Client Secret
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Una vez que TikTok creó la app, te muestra el <strong>Client Key</strong> y{" "}
          <strong>Client Secret</strong> en el panel. Cópialos y pégalos aquí. Se guardan
          localmente en tu compu (en <code>C:\hermes-data\user-settings.json</code>), nunca
          se envían a ningún servidor.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Client Key</Label>
            <Input
              type="text"
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              placeholder="awzxxxxxxxxxxxxxx"
              className="font-mono-tab"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Client Secret
              {settings?.tiktok.hasClientSecret && (
                <span className="ml-2 font-mono-tab text-[10px] text-emerald-400">
                  (guardado · déjalo vacío para no cambiarlo)
                </span>
              )}
            </Label>
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={settings?.tiktok.hasClientSecret ? "••••••••••" : "secret"}
              className="font-mono-tab"
              autoComplete="new-password"
            />
          </div>
          <Button onClick={save} disabled={saving || (!clientKey && !clientSecret)}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Guardar credenciales
          </Button>
        </div>
      </Card>

      {/* ── Paso 5: OAuth ──────────────── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">5. Conectar tu cuenta de TikTok</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Una vez guardadas las credenciales, este botón te redirige a TikTok para que
          autorices a la app. TikTok te va a pedir confirmar los 3 scopes. Acepta y vuelves
          aquí automáticamente.
        </p>
        {!hasCreds ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
            Guarda primero Client Key + Client Secret en el paso 4.
          </p>
        ) : isConnected ? (
          <div className="space-y-3">
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              ✓ Conectado como {settings?.tiktok.connectedUsername}
            </p>
            <Link
              href="/produccion"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-pink px-4 text-sm font-medium text-white hover:bg-brand-pink/90"
            >
              Ir a Producción <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <Button onClick={connect} className="bg-pink-500 hover:bg-pink-400">
            <Music2 className="mr-1.5 h-3.5 w-3.5" />
            Conectar mi TikTok ahora
          </Button>
        )}
      </Card>

      {/* ── Paso 6: audit ──────────────── */}
      <Card className="border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">
          6. (Después) Aplicar al Audit para publicar público
        </h2>
        <p className="text-sm text-muted-foreground">
          Hasta que TikTok haga el audit de tu app, todas las publicaciones quedan{" "}
          <code>SELF_ONLY</code> (privadas — solo las ves tú). Para publicar público,
          ve a Manage apps → tu app → <strong>Submit for review</strong> y completa el
          formulario de audit. Tarda 1-3 semanas. Mientras tanto puedes probar con SELF_ONLY
          y cambiarlas a público manualmente desde la app de TikTok.
        </p>
      </Card>

      {/* Barra fija de acción: el botón principal accesible sin scroll. Reusa los
          mismos handlers/estado que los pasos 4 y 5 (aditivo, sin duplicar lógica). */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {isConnected
              ? `TikTok conectado ✓${settings?.tiktok.connectedUsername ? ` (${settings.tiktok.connectedUsername})` : ""}`
              : hasCreds
                ? "Credenciales listas — conecta tu cuenta de TikTok."
                : "Pega tu Client Key + Secret (paso 4) para continuar."}
          </p>
          {isConnected ? (
            <Link
              href="/produccion"
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-pink px-4 text-sm font-medium text-white hover:bg-brand-pink/90"
            >
              Ir a Producción <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : hasCreds ? (
            <Button onClick={connect} className="ml-auto bg-pink-500 hover:bg-pink-400">
              <Music2 className="mr-1.5 h-3.5 w-3.5" />
              Conectar mi TikTok ahora
            </Button>
          ) : (
            <Button
              onClick={save}
              disabled={saving || (!clientKey && !clientSecret)}
              className="ml-auto"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar credenciales
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
