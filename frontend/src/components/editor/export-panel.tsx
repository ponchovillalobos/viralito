"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, Download } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import type { Project } from "@/components/editor/workspace";

interface Props {
  project: Project;
  /** Duración real del video (segundos), del <video> en workspace. Antes estaba
   *  hardcodeada en 30 → cualquier video >30s se truncaba al exportar. */
  videoDurationSec?: number;
}

export function ExportPanel({ project, videoDurationSec }: Props) {
  const [rendering, setRendering] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [quality, setQuality] = useState<"preview" | "final">("preview");

  async function onRender() {
    setRendering(true);
    setOutput(null);
    try {
      const props = {
        // Duración real del video. Fallback a 30s solo si los metadatos aún no
        // cargaron (videoDurationSec llega en 0): mejor un default que truncar a 0.
        videoDurationSec:
          videoDurationSec && videoDurationSec > 0 ? videoDurationSec : 30,
        words: project.manualSubtitles,
        bRoll: project.bRoll,
        // URL RELATIVA a propósito: la app instalada corre en un puerto 3100+,
        // no en el 3000. El server (render/route.ts) la absolutiza con el host
        // real (VIRAL_API_HOST) antes de pasársela a Remotion.
        musicUrl: project.musicTrack
          ? `/api/music/stream?file=${encodeURIComponent(project.musicTrack)}`
          : null,
        musicVolume: project.musicVolume,
        subtitleStyle: project.subtitleStyle,
        subtitleColor: project.subtitleColor,
        subtitleHighlight: project.subtitleHighlight,
        animations: project.animations,
        // Ola 1 — Stickers de la galería (iconos SVG + ilustraciones Lottie). El
        // server embebe el SVG de los "ph:"/"tb:" antes de renderizar.
        iconStickers: project.iconStickers ?? [],
      };

      const res = await fetch("/api/videos/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: project.videoId, props, quality }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo generar el video");
      setOutput(data.streamUrl);
      toast.success("Video generado");
    } catch (err) {
      toastError(err, "No se pudo generar tu video", {
        action: { label: "Reintentar", onClick: () => void onRender() },
      });
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
        <p className="font-medium">Checklist antes de generar</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>· Subtítulos: {project.manualSubtitles.length} palabras</li>
          <li>· B-roll: {project.bRoll.length} clip(s)</li>
          <li>· Música: {project.musicTrack ?? "sin track"}</li>
          <li>· Animaciones: {project.animations.length} marca(s)</li>
          <li>· Stickers: {project.iconStickers?.length ?? 0}</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Calidad</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["preview", "final"] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              aria-pressed={quality === q}
              className={`rounded-md border p-2 text-xs ${
                quality === q
                  ? "border-foreground/40 bg-muted"
                  : "border-border bg-card"
              }`}
            >
              <div className="font-medium">
                {q === "preview" ? "Preview (rápido)" : "Final (1080p)"}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {q === "preview" ? "540×960, ~1 min" : "1080×1920, 3–8 min"}
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button onClick={onRender} disabled={rendering} className="w-full">
        {rendering ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generando…
          </>
        ) : (
          <>
            <Wand2 className="mr-2 h-4 w-4" />
            Generar video
          </>
        )}
      </Button>

      {output && (
        <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-400">Listo</p>
          <video src={output} controls className="w-full rounded" />
          <a
            href={output}
            download
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar MP4
          </a>
        </div>
      )}
    </div>
  );
}
