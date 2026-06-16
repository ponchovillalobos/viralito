"use client";

/**
 * Panel "Rendimiento" (H7): muestra cómo la app se adaptó a ESTE equipo.
 *
 * Lee GET /api/doctor/diagnose → { hardware, recommend, checks.nvenc } (escrito por
 * python/hw_profile.py). Muestra:
 *   - 4 specs: cores, RAM, GPU (o "Sin GPU NVIDIA"), VRAM total/libre.
 *   - "Configuración aplicada": las líneas de recommend, cada una con ✓. Si el render
 *     NO usa GPU pero podría (nvenc inutilizable por driver) → ⚠ con el motivo.
 *   - Uso EN VIVO de la GPU (opcional): GET /api/system/gpu cada 2.5s. Si no hay GPU
 *     o nvidia-smi falla, simplemente no se muestra (NUNCA inventa números).
 *
 * Sin tablas, estilo consistente con settings-dialog (secciones redondeadas, mono-tab).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Cpu,
  MemoryStick,
  Gpu,
  Activity,
  Mic,
  Film,
  Brain,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiagHardware {
  coresPhysical: number | null;
  coresLogical: number | null;
  ramGb: number | null;
  gpuName: string | null;
  driverVersion: string | null;
  vramTotalMb: number | null;
  vramFreeMb: number | null;
}
interface DiagRecommend {
  whisperModel: string | null;
  whisperDevice: string | null;
  whisperComputeType: string | null;
  videoEncoder: string | null;
  videoDecoderHwaccel: string | null;
  ollamaModel: string | null;
  remotionWorkers: number | null;
}
interface DiagNvenc {
  ok: boolean;
  applicable: boolean;
  unusableReason: string | null;
  fixUrl: string | null;
  gpuName: string | null;
}
interface DiagnoseResponse {
  hardware: DiagHardware | null;
  recommend: DiagRecommend | null;
  checks: { nvenc?: DiagNvenc };
}

interface GpuLive {
  available: boolean;
  gpuUtil?: number;
  memUsedMb?: number;
  memTotalMb?: number | null;
}

const ENCODER_LABEL: Record<string, string> = {
  h264_nvenc: "GPU NVIDIA (NVENC)",
  h264_qsv: "GPU Intel (QuickSync)",
  h264_amf: "GPU AMD (AMF)",
  libx264: "CPU (libx264)",
};
const DECODER_LABEL: Record<string, string> = {
  cuda: "GPU NVIDIA (CUDA)",
  qsv: "GPU Intel (QuickSync)",
  none: "CPU",
};

function gb(mb: number | null | undefined): string {
  if (mb == null) return "—";
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function PerformancePanel() {
  const [diag, setDiag] = useState<DiagnoseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<GpuLive | null>(null);
  const liveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/doctor/diagnose", { cache: "no-store" });
      const d = (await r.json()) as DiagnoseResponse;
      setDiag(d);
    } catch {
      setDiag(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Carga inicial del diagnóstico (load hace setLoading(true) sync): fetch-on-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Polleo de uso en vivo (opcional). Si la 1ª respuesta dice available:false,
  // dejamos de pollear (no hay GPU NVIDIA / nvidia-smi).
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/system/gpu", { cache: "no-store" });
        const d = (await r.json()) as GpuLive;
        if (cancelled) return;
        setLive(d);
        if (!d.available && liveTimer.current) {
          clearInterval(liveTimer.current);
          liveTimer.current = null;
        }
      } catch {
        if (!cancelled) setLive({ available: false });
      }
    }
    void tick();
    liveTimer.current = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      if (liveTimer.current) {
        clearInterval(liveTimer.current);
        liveTimer.current = null;
      }
    };
  }, []);

  const hw = diag?.hardware ?? null;
  const rec = diag?.recommend ?? null;
  const nvenc = diag?.checks?.nvenc;
  // El render podría usar GPU pero cayó a CPU por driver viejo.
  const driverBlocksRender =
    nvenc?.applicable === true &&
    nvenc.ok === false &&
    typeof nvenc.unusableReason === "string" &&
    nvenc.unusableReason.toLowerCase().includes("driver");

  if (loading && !diag) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> midiendo tu equipo…
      </div>
    );
  }

  // Sin perfil aún: hw_profile.py no se ha corrido (procesa un video primero).
  if (!hw && !rec) {
    return (
      <section className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <h3 className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
          Rendimiento
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Todavía no medimos tu equipo. La app detecta tu hardware la primera vez que
          procesas un video y luego muestra aquí la configuración que aplicó.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
        </Button>
      </section>
    );
  }

  const specs: { icon: typeof Cpu; label: string; value: string }[] = [
    {
      icon: Cpu,
      label: "Procesador",
      value:
        hw?.coresPhysical != null
          ? `${hw.coresPhysical} núcleos${hw.coresLogical ? ` (${hw.coresLogical} hilos)` : ""}`
          : "—",
    },
    {
      icon: MemoryStick,
      label: "Memoria RAM",
      value: hw?.ramGb != null ? `${hw.ramGb} GB` : "—",
    },
    {
      icon: Gpu,
      label: "Tarjeta gráfica",
      value: hw?.gpuName ?? "Sin GPU NVIDIA",
    },
    {
      icon: Activity,
      label: "VRAM (libre / total)",
      value: hw?.gpuName ? `${gb(hw.vramFreeMb)} / ${gb(hw.vramTotalMb)}` : "—",
    },
  ];

  const configLines: {
    icon: typeof Mic;
    label: string;
    value: string;
    warn?: string | null;
  }[] = [];
  if (rec) {
    configLines.push({
      icon: Mic,
      label: "Transcripción",
      value: rec.whisperModel
        ? `Whisper ${rec.whisperModel} en ${rec.whisperDevice ?? "cpu"}${
            rec.whisperComputeType ? ` (${rec.whisperComputeType})` : ""
          }`
        : "—",
    });
    configLines.push({
      icon: Film,
      label: "Render de video",
      value: rec.videoEncoder
        ? ENCODER_LABEL[rec.videoEncoder] ?? rec.videoEncoder
        : "—",
      warn: driverBlocksRender ? nvenc?.unusableReason ?? null : null,
    });
    configLines.push({
      icon: Layers,
      label: "Decodificación",
      value: rec.videoDecoderHwaccel
        ? DECODER_LABEL[rec.videoDecoderHwaccel] ?? rec.videoDecoderHwaccel
        : "—",
    });
    configLines.push({
      icon: Brain,
      label: "Análisis viral",
      value: rec.ollamaModel ?? "—",
    });
    configLines.push({
      icon: Cpu,
      label: "Workers de render (Remotion)",
      value: rec.remotionWorkers != null ? String(rec.remotionWorkers) : "—",
    });
  }

  return (
    <div className="space-y-4">
      {/* ── SPECS DEL EQUIPO ──────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
            Tu equipo
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => void load()}
          >
            <RefreshCw className="mr-1 h-3 w-3" /> Actualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {specs.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-pink" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="truncate text-xs text-foreground" title={s.value}>
                    {s.value}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Uso en vivo de la GPU (solo si nvidia-smi respondió). */}
        {live?.available && (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2">
            <Activity className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="text-[11px] text-muted-foreground">
              Uso GPU ahora:{" "}
              <span className="tabular-nums text-foreground">{live.gpuUtil}%</span>
              {live.memUsedMb != null && (
                <>
                  {" · VRAM "}
                  <span className="tabular-nums text-foreground">
                    {gb(live.memUsedMb)}
                    {live.memTotalMb ? ` / ${gb(live.memTotalMb)}` : ""}
                  </span>
                </>
              )}
            </span>
          </div>
        )}
      </section>

      {/* ── CONFIGURACIÓN APLICADA ────────────────── */}
      {rec && (
        <section className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <h3 className="font-mono-tab text-xs uppercase tracking-wider text-muted-foreground">
            Configuración aplicada
          </h3>
          <p className="text-[11px] text-muted-foreground">
            La app eligió esto automáticamente para sacarle el máximo a tu equipo.
          </p>
          <ul className="space-y-1.5 pt-1 text-xs">
            {configLines.map((line) => {
              const Icon = line.icon;
              return (
                <li key={line.label} className="space-y-0.5">
                  <div className="flex items-start gap-1.5">
                    {line.warn ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    )}
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground">{line.label}: </span>
                      <span className="text-muted-foreground">{line.value}</span>
                      {line.warn && (
                        <span className="mt-0.5 block text-[11px] text-amber-300/90">
                          {line.warn}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
