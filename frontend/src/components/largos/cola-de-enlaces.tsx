"use client";

/**
 * Pegá VARIOS enlaces de YouTube y se bajan de a uno.
 *
 * Antes había una casilla para un enlace, y la petición se quedaba abierta hasta
 * que el video terminaba de bajar. Con once videos de dos horas eso son once
 * esperas seguidas delante de la pantalla, y una recarga las pierde.
 *
 * Acá se pegan todos juntos —como vengan: uno por línea, con comas, con espacios
 * de más— y la respuesta vuelve enseguida. La descarga sigue en la cola
 * compartida del proyecto, así que se puede cerrar la pantalla.
 *
 * Se bajan de a uno a propósito, no todos a la vez: bajar en paralelo pelea por
 * el disco y la red con lo que se esté renderizando, y en este proyecto ya está
 * medido que dos cosas pesadas a la vez tardan más que una detrás de otra.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Download, Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Descarga {
  id: string;
  url: string;
  estado: "en_cola" | "bajando" | "listo" | "fallo";
  videoId?: string;
  duracionS?: number;
  error?: string;
}

const ICONO = {
  en_cola: Clock,
  bajando: Loader2,
  listo: Check,
  fallo: X,
} as const;

const COLOR = {
  en_cola: "text-muted-foreground",
  bajando: "text-red-300",
  listo: "text-emerald-400",
  fallo: "text-red-400",
} as const;

/** "https://youtu.be/MJ02WMyyrtA" -> "MJ02WMyyrtA", para no pintar 60 caracteres. */
function corta(url: string): string {
  try {
    const u = new URL(url);
    return u.searchParams.get("v") || u.pathname.replace(/^\//, "") || url;
  } catch {
    return url.slice(0, 24);
  }
}

export function ColaDeEnlaces({ onListo }: { onListo?: () => void }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [descargas, setDescargas] = useState<Descarga[]>([]);
  const listosVistos = useRef<Set<string>>(new Set());

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch("/api/videos/descargar-url/cola");
      const d = (await r.json()) as { descargas?: Descarga[] };
      const lista = d.descargas ?? [];
      setDescargas(lista);

      // Cuando uno termina, la lista de videos de arriba tiene que enterarse.
      // Sin esto el video estaba en disco y no aparecía hasta recargar a mano.
      for (const x of lista) {
        if (x.estado === "listo" && !listosVistos.current.has(x.id)) {
          listosVistos.current.add(x.id);
          onListo?.();
        }
      }
    } catch {
      /* el sondeo puede fallar sin consecuencias: se reintenta al siguiente */
    }
  }, [onListo]);

  // Sondeo cada 4 s mientras quede algo en marcha. Cuando no queda nada, se
  // deja de preguntar: una pantalla abierta toda la tarde no debe golpear la
  // API para siempre.
  useEffect(() => {
    refrescar();
    const activas = descargas.some(
      (d) => d.estado === "en_cola" || d.estado === "bajando"
    );
    if (!activas) return;
    const t = setInterval(refrescar, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refrescar, descargas.some((d) => d.estado === "en_cola" || d.estado === "bajando")]);

  const cuantos = texto.split(/[\s,;]+/).filter((x) => x.trim().startsWith("http")).length;

  async function encolar() {
    if (!cuantos) {
      toast.error("Pegá al menos un enlace que empiece con http.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/videos/descargar-url/cola", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: texto, flujo: "largo" }),
      });
      const d = (await r.json()) as {
        encoladas?: number;
        repetidas?: string[];
        rechazadas?: { url: string; motivo: string }[];
        error?: string;
        descargas?: Descarga[];
      };
      if (!r.ok) {
        toast.error("No se pudo encolar", { description: d.error });
        return;
      }
      setDescargas(d.descargas ?? []);
      setTexto("");

      // Se cuenta lo que NO entró, y por qué. Un "3 encoladas" a secas cuando
      // pegaste 5 deja pensando cuáles faltan.
      const partes = [`${d.encoladas ?? 0} en cola`];
      if (d.repetidas?.length) partes.push(`${d.repetidas.length} ya estaban`);
      if (d.rechazadas?.length) partes.push(`${d.rechazadas.length} no son enlaces`);
      toast.success(partes.join(" · "), {
        description: "Se bajan de a uno. Podés cerrar esta pantalla.",
      });
    } catch (e) {
      toast.error("No se pudo encolar", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setEnviando(false);
    }
  }

  const enMarcha = descargas.filter(
    (d) => d.estado === "en_cola" || d.estado === "bajando"
  ).length;

  return (
    <div className="mb-4 rounded-md border border-red-500/25 bg-red-500/5 p-3">
      <p className="mb-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-red-200">¿Están en YouTube?</span> Pegá
        los enlaces —uno por línea, o separados por comas— y se bajan de a uno.
        Se traen en H.264 hasta 1080p, que es lo que el resto del pipeline
        procesa más rápido.
      </p>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={4}
        placeholder={"https://youtu.be/…\nhttps://youtu.be/…\nhttps://www.youtube.com/watch?v=…"}
        className="w-full resize-y rounded-md border border-border bg-background p-2 font-mono-tab text-xs outline-none focus:border-red-400/60"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {cuantos > 0
            ? `${cuantos} enlace${cuantos === 1 ? "" : "s"} listo${cuantos === 1 ? "" : "s"} para encolar`
            : "Podés pegar varios de una vez"}
        </span>
        <Button
          size="sm"
          onClick={encolar}
          disabled={enviando || !cuantos}
          className="shrink-0 bg-red-500 text-white hover:bg-red-400"
        >
          {enviando ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-4 w-4" />
          )}
          Encolar {cuantos > 1 ? `los ${cuantos}` : ""}
        </Button>
      </div>

      {descargas.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <div className="mb-1.5 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
            Cola {enMarcha > 0 && `· ${enMarcha} en marcha`}
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {descargas.slice(0, 30).map((d) => {
              const Icono = ICONO[d.estado];
              return (
                <div key={d.id} className="flex items-center gap-2 text-[11px]">
                  <Icono
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      COLOR[d.estado],
                      d.estado === "bajando" && "animate-spin"
                    )}
                  />
                  <span className="font-mono-tab text-muted-foreground">{corta(d.url)}</span>
                  <span className="truncate">
                    {d.estado === "listo" && d.videoId ? (
                      <>
                        {d.videoId}
                        {d.duracionS ? (
                          <span className="ml-1 text-muted-foreground">
                            · {Math.round(d.duracionS / 60)} min
                          </span>
                        ) : null}
                      </>
                    ) : d.estado === "fallo" ? (
                      <span className="text-red-400">{d.error}</span>
                    ) : d.estado === "bajando" ? (
                      "bajando…"
                    ) : (
                      "en cola"
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
