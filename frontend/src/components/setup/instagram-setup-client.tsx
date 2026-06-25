"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Copy, Check, Loader2, CheckCircle2, ArrowRight, Camera, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";

/**
 * Wizard guiado para conectar Instagram (Graph API de Meta).
 * Pre-carga los textos a copiar (redirect URI, permisos) y al final dispara el OAuth.
 * El paso extra vs LinkedIn: la URL pública (un túnel), porque Instagram DESCARGA el
 * video desde una URL HTTPS — localhost no le sirve.
 */
function CopyableRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono-tab">
        {label}
      </Label>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
        <code className="flex-1 font-mono-tab text-xs text-foreground break-all">{value}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
            toast.success(`${label} copiado`);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-amber-400"
          title={`Copiar ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-amber-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

interface IgSettings {
  instagram: {
    appId: string;
    hasAppSecret: boolean;
    hasAccessToken: boolean;
    connectedUsername: string;
    publicBaseUrl: string;
  };
}

export function InstagramSetupClient() {
  const [settings, setSettings] = useState<IgSettings | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadSettings() {
    const r = await fetch("/api/settings");
    const d = await r.json();
    setSettings(d);
    setAppId(d.instagram?.appId ?? "");
    setPublicBaseUrl(d.instagram?.publicBaseUrl ?? "");
  }

  // Load on mount — patrón válido pero el lint quiere `use(promise)` (React 19).
  // No migramos: pantalla de setup, abre pocas veces, un render extra es invisible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, []);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/auth/instagram/callback`;
  const isConnected = Boolean(settings?.instagram.hasAccessToken);

  async function saveAndConnect() {
    if (!appId.trim()) return toast.error("Pega el App ID");
    if (!appSecret.trim() && !settings?.instagram.hasAppSecret) return toast.error("Pega el App Secret");
    if (!publicBaseUrl.trim()) return toast.error("Pega la URL pública del túnel (la necesita Instagram para bajar el video)");
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagram: {
            appId: appId.trim(),
            appSecret: appSecret.trim(),
            publicBaseUrl: publicBaseUrl.trim(),
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Guardado. Redirigiendo a Meta para autorizar…");
      setTimeout(() => {
        window.location.href = "/api/auth/instagram/login";
      }, 600);
    } catch (err) {
      toastError(err, "No se pudieron guardar las credenciales");
      setSaving(false);
    }
  }

  return (
    // pb-28 deja aire para la barra fija de acción del fondo (que no tape contenido).
    <div className="space-y-6 pb-28">
      <header className="space-y-2">
        <p className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
          setup · instagram · graph api
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Conectar Instagram</h1>
        <p className="max-w-2xl text-muted-foreground">
          Es la API oficial de Meta (legal). Para tu propia cuenta funciona en modo desarrollo,
          sin revisión larga. Requiere: cuenta IG <strong>Business/Creator</strong> vinculada a una
          Página de Facebook, una app de Meta, y una <strong>URL pública</strong> (un túnel) porque
          Instagram baja el video desde sus servidores.
        </p>
      </header>

      {isConnected && (
        <Card className="border-emerald-500/40 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <div className="flex-1">
              <p className="text-base font-medium text-emerald-200">Instagram conectado ✓</p>
              <p className="text-xs text-muted-foreground">
                Cuenta: <span className="text-amber-400">@{settings?.instagram.connectedUsername || "(conectado)"}</span>
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

      {/* Paso 1 — Meta for Developers */}
      <Card className="border-border bg-card p-5 space-y-3">
        <h2 className="text-base font-medium">1 · Crear la app en Meta</h2>
        <p className="text-sm text-muted-foreground">
          Abre Meta for Developers y crea una app de tipo <strong>Business</strong>. Después, en{" "}
          <strong>Add Products</strong>, agrega <strong>Instagram</strong> (Graph API).
        </p>
        <a
          href="https://developers.facebook.com/apps"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-500 px-4 text-sm font-medium text-black hover:bg-amber-400"
        >
          Abrir developers.facebook.com/apps <ExternalLink className="h-3 w-3" />
        </a>
        <div className="space-y-2 pt-1">
          <CopyableRow label="Privacy policy URL" value={`${baseUrl}/privacy`} />
        </div>
      </Card>

      {/* Paso 2 — cuenta business */}
      <Card className="border-border bg-card p-5 space-y-2">
        <h2 className="text-base font-medium">2 · Cuenta IG Business + Página FB</h2>
        <p className="text-sm text-muted-foreground">
          Tu Instagram tiene que ser <strong>Business</strong> o <strong>Creator</strong> y estar
          vinculado a una <strong>Página de Facebook</strong> (en la app de IG: Configuración →
          Cuenta → Cambiar a profesional, y vincular Página). Si no, la conexión no encuentra la cuenta.
        </p>
      </Card>

      {/* Paso 3 — redirect URI + permisos */}
      <Card className="border-border bg-card p-5 space-y-3">
        <h2 className="text-base font-medium">3 · Redirect URI + permisos</h2>
        <p className="text-sm text-muted-foreground">
          En la config de <strong>Facebook Login</strong> de la app → <strong>Valid OAuth Redirect URIs</strong>,
          pega esta URL exacta:
        </p>
        <CopyableRow label="Valid OAuth Redirect URI" value={redirectUri} />
        <p className="text-xs text-muted-foreground">
          Permisos que pide la app (se aprueban para tu propia cuenta en modo dev):
        </p>
        <div className="space-y-1.5">
          {["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"].map((s) => (
            <code key={s} className="block rounded bg-muted/30 px-2 py-1 font-mono-tab text-xs text-foreground">
              ✓ {s}
            </code>
          ))}
        </div>
      </Card>

      {/* Paso 4 — URL pública / túnel */}
      <Card className="border-border bg-card p-5 space-y-3">
        <h2 className="text-base font-medium">4 · URL pública (túnel)</h2>
        <p className="text-sm text-muted-foreground">
          Instagram <strong>descarga</strong> el video desde una URL HTTPS pública — localhost no
          sirve. Lo más fácil y gratis: un túnel de Cloudflare apuntando a tu :3000. En una terminal:
        </p>
        <CopyableRow label="Comando del túnel" value="cloudflared tunnel --url http://localhost:3000" />
        <p className="text-xs text-muted-foreground">
          Te va a dar una URL tipo <code>https://algo-random.trycloudflare.com</code>. Pégala abajo.
          (Tiene que estar corriendo al momento de publicar.)
        </p>
      </Card>

      {/* Paso 5 — credenciales + conectar */}
      <Card className="border-border bg-card p-5 space-y-3">
        <h2 className="text-base font-medium">5 · Pegar credenciales y conectar</h2>
        <p className="text-sm text-muted-foreground">
          En <strong>App settings → Basic</strong> copia <strong>App ID</strong> y{" "}
          <strong>App Secret</strong>. Se guardan local en{" "}
          <code className="font-mono-tab text-[10px]">C:\hermes-data\user-settings.json</code>.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">App ID</Label>
            <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="1234567890" className="font-mono-tab" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              App Secret
              {settings?.instagram.hasAppSecret && (
                <span className="ml-2 font-mono-tab text-[10px] text-emerald-400">(guardado · déjalo vacío para no cambiarlo)</span>
              )}
            </Label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={settings?.instagram.hasAppSecret ? "••••••••••" : "abcdef123456"}
              className="font-mono-tab"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">URL pública del túnel (HTTPS)</Label>
            <Input
              value={publicBaseUrl}
              onChange={(e) => setPublicBaseUrl(e.target.value)}
              placeholder="https://algo-random.trycloudflare.com"
              className="font-mono-tab"
            />
          </div>
          <Button onClick={saveAndConnect} disabled={saving} className="bg-amber-500 hover:bg-amber-400 text-black">
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {saving ? "Guardando + conectando…" : "Guardar y autorizar en Meta"}
          </Button>
        </div>
      </Card>

      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          <Camera className="mr-1 inline h-3 w-3" /> Notas
        </p>
        <ul className="mt-2 space-y-1">
          <li>• El token dura ~60 días — después reconectas con un clic.</li>
          <li>• Si cambia la URL del túnel, actualízala aquí antes de publicar.</li>
          <li>• El redirect URI tiene que ser idéntico (sin barra final) o Meta lo rechaza.</li>
        </ul>
      </div>

      {/* Barra fija de acción: el botón principal accesible sin scroll. Reusa el
          mismo handler/estado que el botón del paso 5 (aditivo, sin duplicar lógica). */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {isConnected
              ? "Instagram conectado ✓"
              : "Pega tus credenciales (paso 5) y conecta tu cuenta."}
          </p>
          {isConnected ? (
            <Link
              href="/produccion"
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-pink px-4 text-sm font-medium text-white hover:bg-brand-pink/90"
            >
              Ir a Producción <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Button
              onClick={saveAndConnect}
              disabled={saving}
              className="ml-auto bg-amber-500 hover:bg-amber-400 text-black"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              {saving ? "Guardando + conectando…" : "Guardar y autorizar en Meta"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
