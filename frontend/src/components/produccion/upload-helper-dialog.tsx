"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FolderOpen,
  Copy,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Music2,
  ArrowRight,
  Hand,
} from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";

interface UploadHelperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  caption: string;
  tiktokHandle?: string;
  source: "short" | "long_form";
}

export function UploadHelperDialog({
  open,
  onOpenChange,
  projectId,
  caption,
  tiktokHandle,
  source,
}: UploadHelperDialogProps) {
  const [renderPath, setRenderPath] = useState<string>("");
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [busy, setBusy] = useState<"start" | "openTiktok" | "copyPath" | "copyCaption" | null>(null);

  // Reset on open: patrón "store-and-compare" (recomendado por React docs) en
  // vez de useEffect+setState para evitar el render cascada.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setStep1Done(false);
      setStep2Done(false);
      setBusy(null);
    }
  }

  // Llama al endpoint que (a) copia el archivo al portapapeles, (b) abre Explorer
  // con el archivo seleccionado. Esto se hace en un solo click para que el usuario
  // sólo tenga que arrastrar.
  async function startUpload() {
    setBusy("start");
    try {
      // Abrir Explorer con el archivo seleccionado
      const revealRes = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/reveal-render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        }
      );
      const revealData = await revealRes.json();
      if (!revealRes.ok) throw new Error(revealData.error ?? `HTTP ${revealRes.status}`);
      setRenderPath(revealData.path ?? "");

      // También copiamos el archivo al portapapeles (sirve como fallback si quieres
      // pegar en el cuadro de "abrir archivo" de Windows)
      await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/copy-file-to-clipboard`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source }),
        }
      );

      setStep1Done(true);
      toast.success("Explorer abierto con el video. Arrástralo a TikTok →");
    } catch (err) {
      toastError(err, "No se pudo preparar el video");
    } finally {
      setBusy(null);
    }
  }

  function openTikTok() {
    setBusy("openTiktok");
    window.open("https://www.tiktok.com/upload", "_blank", "noopener,noreferrer");
    setTimeout(() => setBusy(null), 600);
  }

  async function copyPath() {
    setBusy("copyPath");
    try {
      await navigator.clipboard.writeText(renderPath);
      toast.success("Ruta copiada (Ctrl+V en el campo «Nombre» del selector de archivos)");
    } catch (err) {
      toastError(err, "No se pudo copiar la ruta");
    } finally {
      setBusy(null);
    }
  }

  async function copyCaption() {
    setBusy("copyCaption");
    try {
      await navigator.clipboard.writeText(caption);
      setStep2Done(true);
      toast.success("Descripción en el portapapeles. Pégala en TikTok (Ctrl+V).");
    } catch (err) {
      toastError(err, "No se pudo copiar la descripción");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Music2 className="h-5 w-5 text-pink-400" />
            Subir a TikTok{tiktokHandle ? ` como ${tiktokHandle}` : ""}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Seguí los 2 pasos. Es rápido: abrís la carpeta, arrastrás el video y pegás el texto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Paso 1: abrir carpeta y TikTok ───── */}
          <div
            className={`rounded-xl border p-4 ${
              step1Done
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-border bg-muted/30"
            }`}
          >
            <div className="mb-3 flex items-center gap-2.5">
              {step1Done ? (
                <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-400" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-violet text-sm font-bold text-white">
                  1
                </span>
              )}
              <span className="text-base font-semibold text-foreground">
                Abrí la carpeta y TikTok
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={startUpload}
                disabled={busy !== null}
                variant={step1Done ? "outline" : "default"}
                className="flex-col h-auto py-3"
              >
                {busy === "start" ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <FolderOpen className="h-6 w-6" />
                )}
                <span className="mt-1.5 text-sm font-medium">
                  {step1Done ? "Reabrir carpeta" : "Abrir carpeta"}
                </span>
              </Button>
              <Button
                onClick={openTikTok}
                disabled={busy !== null}
                variant="default"
                className="flex-col h-auto py-3 bg-pink-500 hover:bg-pink-400 text-white"
              >
                {busy === "openTiktok" ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Music2 className="h-6 w-6" />
                )}
                <span className="mt-1.5 text-sm font-medium">Abrir TikTok</span>
              </Button>
            </div>

            {step1Done && renderPath && (
              <div className="mt-3 space-y-2 rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2 text-sm text-foreground">
                  <Hand className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                  <span>
                    <strong>Arrastrá</strong> el video desde la carpeta que se abrió
                    hasta el área de subida de TikTok.
                  </span>
                </div>
                <div className="rounded bg-muted/40 px-2.5 py-2 font-mono-tab text-xs text-foreground/80 break-all">
                  {renderPath}
                </div>
                <button
                  type="button"
                  onClick={copyPath}
                  disabled={busy !== null}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {busy === "copyPath" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  Copiar ruta (por si no podés arrastrar)
                </button>
              </div>
            )}
          </div>

          {/* ── Paso 2: copiar caption ───── */}
          <div
            className={`rounded-xl border p-4 ${
              step2Done
                ? "border-emerald-500/40 bg-emerald-500/5"
                : step1Done
                  ? "border-border bg-muted/30"
                  : "border-border bg-muted/10 opacity-60"
            }`}
          >
            <div className="mb-3 flex items-center gap-2.5">
              {step2Done ? (
                <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-400" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-violet text-sm font-bold text-white">
                  2
                </span>
              )}
              <span className="text-base font-semibold text-foreground">
                Pegá la descripción
              </span>
            </div>

            <Button
              onClick={copyCaption}
              disabled={busy !== null || !step1Done || !caption}
              variant={step2Done ? "outline" : "default"}
              className="w-full py-3 text-sm font-medium"
            >
              {busy === "copyCaption" ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Copy className="mr-2 h-5 w-5" />
              )}
              {step2Done ? "Volver a copiar descripción" : "Copiar descripción viral"}
            </Button>

            <p className="mt-2.5 text-sm text-muted-foreground">
              Cuando el video termine de cargar en TikTok, tocá este botón y pegá con
              <strong> Ctrl+V</strong> en el campo de descripción.
            </p>
            {!caption && (
              <p className="mt-1.5 text-sm text-amber-400">
                Este video todavía no tiene descripción — generala con ✨ en la tarjeta.
              </p>
            )}
          </div>

          {/* ── Mini-guía siempre visible ─── */}
          <div className="space-y-2 rounded-lg border border-foreground/10 bg-muted/20 p-4 text-sm text-foreground/90">
            <p className="font-semibold text-foreground">Cómo arrastrar, en 3 toques</p>
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">1</span>
              <FolderOpen className="h-5 w-5 shrink-0 text-brand-violet" />
              <span>Se abre la carpeta y el video queda resaltado (seleccionado).</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">2</span>
              <Hand className="h-5 w-5 shrink-0 text-amber-400" />
              <span>Mantené el clic sobre el video y arrastralo a la pestaña de TikTok.</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">3</span>
              <ArrowRight className="h-5 w-5 shrink-0 text-pink-400" />
              <span>Soltalo en el recuadro grande de TikTok que dice «Select video».</span>
            </div>
          </div>

          {step1Done && step2Done && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">
              ✓ Listo para publicar. Revisá la vista previa en TikTok y tocá «Post»
              cuando estés conforme.
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <a
              href="https://www.tiktok.com/upload"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-pink-400"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              tiktok.com/upload
            </a>
            <a
              href="https://www.tiktok.com/tiktokstudio/upload"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-pink-400"
              title="Versión nueva de Studio (a veces funciona mejor que /upload)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              tiktokstudio/upload
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
