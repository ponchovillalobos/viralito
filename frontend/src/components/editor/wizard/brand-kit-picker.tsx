"use client";

/**
 * BrandKitPicker (F1.b) — deriva acento + tema editorial de una marca en UN paso.
 *
 * El usuario pega la URL de su web o sube su logo → POST /api/brand → propone
 * {accent (snapeado a la PALETTE), themeId, palette}. Al "Aplicar", el wizard
 * setea su accentColor + editorialTheme. Opcional y no intrusivo: si no se usa,
 * el flujo del wizard queda idéntico. El usuario SIEMPRE puede sobreescribir
 * después con el selector de color y el de temas.
 */
import { useRef, useState } from "react";
import { Loader2, Sparkles, Upload, Check } from "lucide-react";

export interface BrandResult {
  accent: string;
  accentRaw?: string;
  palette: string[];
  themeId: string;
  themeName: string;
  fontTitle: string;
  ok: boolean;
}

export function BrandKitPicker({
  onApply,
  themeIds,
}: {
  /** El wizard aplica el acento + tema (si el themeId existe en su lista). */
  onApply: (r: BrandResult) => void;
  /** IDs de temas que el wizard soporta — si el detectado no está, no se fuerza. */
  themeIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrandResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function analyzeUrl() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await r.json()) as BrandResult & { error?: string };
      if (!r.ok || !data.ok) {
        throw new Error(data.error || "No se pudo leer la marca (¿sin internet? subí el logo)");
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function analyzeFile(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/brand", { method: "POST", body: fd });
      const data = (await r.json()) as BrandResult & { error?: string };
      if (!r.ok || !data.ok) {
        throw new Error(data.error || "No se pudo analizar el logo");
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const themeSupported = result ? themeIds.includes(result.themeId) : false;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-dashed border-violet-500/40 bg-violet-500/5 px-4 py-3 text-left text-sm text-violet-200 hover:border-violet-500/60"
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">¿Tienes marca?</span> Sacá los colores y el tema
          automáticos de tu web o tu logo.
        </span>
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-violet-200">
        <Sparkles className="h-4 w-4" />
        Marca automática
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-[11px] font-normal text-muted-foreground hover:text-foreground"
        >
          cerrar
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && analyzeUrl()}
          placeholder="tumarca.com"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/60"
        />
        <button
          type="button"
          onClick={analyzeUrl}
          disabled={loading || !url.trim()}
          className="flex items-center justify-center gap-1.5 rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Analizar
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex items-center justify-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm hover:border-foreground/30 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Subir logo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) analyzeFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        El logo se analiza en tu máquina (sin subir nada). La URL baja solo los colores
        públicos de tu web.
      </p>

      {error && (
        <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error}</p>
      )}

      {result && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/60 p-3">
          <div className="flex items-center gap-2">
            <div
              className="h-9 w-9 rounded-full"
              style={{ background: result.accent, boxShadow: `0 0 18px ${result.accent}66` }}
            />
            <div className="text-xs">
              <p className="font-medium">Color detectado</p>
              <p className="font-mono-tab text-[10px] text-muted-foreground">{result.accent}</p>
            </div>
          </div>
          <div className="text-xs">
            <p className="font-medium">Tema sugerido</p>
            <p className="text-[10px] text-muted-foreground">
              {result.themeName}
              {!themeSupported && " (no aplica a este estilo)"}
            </p>
          </div>
          {result.palette.length > 0 && (
            <div className="flex items-center gap-1">
              {result.palette.slice(0, 5).map((c, i) => (
                <div key={i} className="h-5 w-5 rounded" style={{ background: c }} title={c} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onApply(result)}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-400"
          >
            <Check className="h-3.5 w-3.5" />
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
