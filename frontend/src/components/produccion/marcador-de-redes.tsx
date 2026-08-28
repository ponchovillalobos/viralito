"use client";

/**
 * "Ya lo subí a…" — cuatro interruptores por video, uno por red.
 *
 * Es el registro de lo que la persona subió CON SUS MANOS, y por eso vive
 * aparte de los botones de "Subir ahora a:" que están justo arriba. Aquéllos
 * publican; éste sólo recuerda.
 *
 * El caso real: se producen veinte o treinta videos, se suben a mano desde el
 * teléfono a lo largo de la semana, y a los tres días "¿éste ya lo subí a
 * LinkedIn?" sólo lo contesta la memoria. El estado `pending_manual` existía en
 * el código y nada en toda la app lo cerraba nunca.
 *
 * Marcar es optimista: se pinta al instante y, si el guardado falla, se revierte
 * y se avisa. Con treinta tarjetas en pantalla, esperar al disco en cada clic
 * hace que la lista se sienta trabada.
 */
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type RedKey = "tiktok" | "instagram" | "linkedin" | "facebook";
export type MarcasDeVideo = Partial<Record<RedKey, number>>;

const REDES: { id: RedKey; nombre: string; corto: string; color: string }[] = [
  { id: "tiktok", nombre: "TikTok", corto: "TT", color: "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200" },
  { id: "instagram", nombre: "Instagram", corto: "IG", color: "border-amber-500/40 bg-amber-500/15 text-amber-200" },
  { id: "linkedin", nombre: "LinkedIn", corto: "LI", color: "border-sky-500/40 bg-sky-500/15 text-sky-200" },
  { id: "facebook", nombre: "Facebook", corto: "FB", color: "border-blue-500/40 bg-blue-500/15 text-blue-200" },
];

function cuando(ts: number): string {
  const dias = Math.floor((Date.now() - ts) / 86_400_000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  return new Date(ts).toLocaleDateString();
}

export function MarcadorDeRedes({
  projectId,
  marcas,
  onCambio,
}: {
  projectId: string;
  marcas: MarcasDeVideo;
  /** El padre guarda el estado: así la lista entera se pinta de una sola lectura. */
  onCambio: (projectId: string, marcas: MarcasDeVideo) => void;
}) {
  const [guardando, setGuardando] = useState<RedKey | null>(null);

  async function alternar(red: RedKey) {
    const marcado = !marcas[red];
    const previo = marcas;
    // Optimista: la marca se pinta antes de tocar el disco.
    const optimista: MarcasDeVideo = { ...marcas };
    if (marcado) optimista[red] = Date.now();
    else delete optimista[red];
    onCambio(projectId, optimista);
    setGuardando(red);

    try {
      const r = await fetch("/api/publicado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, red, marcado }),
      });
      if (!r.ok) throw new Error((await r.json())?.error ?? `HTTP ${r.status}`);
      const { marcas: guardadas } = (await r.json()) as { marcas: MarcasDeVideo };
      // El servidor manda la última palabra: si dos pestañas marcaron a la vez,
      // la pantalla queda como quedó el archivo, no como quedó este clic.
      onCambio(projectId, guardadas);
    } catch (e) {
      onCambio(projectId, previo);
      toast.error(
        `No se pudo guardar la marca: ${e instanceof Error ? e.message : "error desconocido"}`
      );
    } finally {
      setGuardando(null);
    }
  }

  const subidas = REDES.filter((r) => marcas[r.id]).length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        Ya lo subí a:
      </span>
      {REDES.map((r) => {
        const ts = marcas[r.id];
        const activo = Boolean(ts);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => alternar(r.id)}
            disabled={guardando === r.id}
            aria-pressed={activo}
            title={
              activo
                ? `Subido a ${r.nombre} ${cuando(ts as number)} — clic para desmarcar`
                : `Marcar como subido a ${r.nombre}`
            }
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all",
              activo
                ? r.color
                : "border-border/60 text-muted-foreground/70 hover:border-foreground/30 hover:text-foreground",
              guardando === r.id && "opacity-50"
            )}
          >
            <span aria-hidden>{activo ? "✓" : "○"}</span>
            {r.corto}
          </button>
        );
      })}
      {subidas > 0 && (
        <span className="text-[10px] text-muted-foreground/60">
          {subidas} de {REDES.length}
        </span>
      )}
    </div>
  );
}
