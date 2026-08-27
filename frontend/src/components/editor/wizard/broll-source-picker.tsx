"use client";

import { useEffect, useState } from "react";

import { BROLL_SOURCES } from "@/lib/broll-sources";
import type { BrollSource } from "@/lib/pexels";

/**
 * Selector de fuentes de B-roll, compartido por los dos asistentes.
 *
 * Dos cosas que antes no se podían y ahora sí:
 *
 * 1. **Elegir varias.** Antes era una sola: fotos O videos O gifs. Ahora se
 *    combinan, y el buscador rota entre ellas momento a momento — agrupadas se
 *    verían como dos videos pegados, rotadas se ven como variedad.
 *
 * 2. **Ver antes de elegir.** Los nombres no dicen cómo queda: la diferencia
 *    entre un clip de stock y un GIF es justamente visual. Cada tarjeta trae una
 *    miniatura REAL del sitio del que va a salir el material.
 *
 * "Automático" es exclusivo a propósito: significa "decidí vos", así que
 * combinarlo con una elección concreta no querría decir nada.
 *
 * Si una fuente no responde (sin clave, sin red, límite de peticiones) su
 * tarjeta se muestra sin miniatura y se puede elegir igual. Nadie se queda sin
 * poder elegir porque Giphy esté caído.
 */
export function BrollSourcePicker({
  valor,
  onChange,
  consulta,
}: {
  valor: BrollSource[];
  onChange: (v: BrollSource[]) => void;
  /** Palabra para las miniaturas. Si se pasa el tema del video, se ven más fieles. */
  consulta?: string;
}) {
  const [muestras, setMuestras] = useState<Record<string, string | null>>({});
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    const url = consulta
      ? `/api/broll/muestras?q=${encodeURIComponent(consulta)}`
      : "/api/broll/muestras";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        setMuestras(d?.muestras ?? {});
        setCargando(false);
      })
      .catch(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [consulta]);

  const activa = (id: BrollSource) => valor.includes(id);

  function alternar(id: BrollSource) {
    if (id === "auto") {
      onChange(["auto"]); // exclusivo: "decidí vos" no se combina
      return;
    }
    const sinAuto = valor.filter((v) => v !== "auto");
    const nuevo = sinAuto.includes(id)
      ? sinAuto.filter((v) => v !== id)
      : [...sinAuto, id];
    // Quitar la última deja el selector sin sentido: se vuelve a automático.
    onChange(nuevo.length ? nuevo : ["auto"]);
  }

  const elegidas = valor.filter((v) => v !== "auto");

  return (
    <div className="mt-5 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
      <p className="mb-1 text-sm font-medium">🎞️ De dónde salen las imágenes de apoyo</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Puedes elegir <strong>varias</strong> y se van alternando a lo largo del video.
        Cambia el material que acompaña, no el estilo: los subtítulos, colores y
        movimiento salen igual.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {BROLL_SOURCES.map((f) => {
          const sel = activa(f.id);
          const miniatura = muestras[f.id];
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => alternar(f.id)}
              aria-pressed={sel}
              className={`overflow-hidden rounded-lg border text-left transition-all ${
                sel
                  ? "border-sky-400 ring-1 ring-sky-400"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              {/* Miniatura real de la fuente. "Automático" no tiene una propia:
                  su tarjeta muestra el emoji, que ya comunica "elige el sistema". */}
              <div className="relative flex h-20 w-full items-center justify-center bg-muted/40">
                {f.id !== "auto" && miniatura ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={miniatura}
                    alt={`Ejemplo de ${f.name}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-2xl leading-none">{f.emoji}</span>
                )}
                {sel && (
                  <span className="absolute right-1 top-1 rounded-full bg-sky-400 px-1.5 text-[10px] font-medium text-black">
                    ✓
                  </span>
                )}
              </div>
              <div className="p-2">
                <div className="text-sm font-medium">{f.name}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {f.hint}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {cargando && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Trayendo ejemplos de cada fuente…
        </p>
      )}

      {elegidas.length > 1 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Se alternan <strong>{elegidas.length} fuentes</strong> a lo largo del video:
          el primer momento sale de una, el siguiente de otra, y así.
        </p>
      )}

      {valor.includes("giphy") && (
        <p className="mt-2 text-xs text-muted-foreground">
          Los GIFs cuadrados no se estiran para llenar el cuadro: se acomodan al
          formato de tu video para que no se pierda el contenido.
        </p>
      )}
    </div>
  );
}
