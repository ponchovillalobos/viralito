"use client";

/**
 * Qué se agrega ENCIMA del video: ilustraciones, iconos y gráficas.
 *
 * Antes esto no se elegía. Si el estilo las soportaba, entraban — y con ellas
 * entraba lo que el pedido señaló: «si el texto y las ilustraciones animadas ya
 * tienen un estilo y color particular, meter más elementos puede dañar el
 * estilo». En editorial, que vive de ser sobrio, tres capas de adornos encima
 * de una tipografía cuidada la arruinan.
 *
 * Las miniaturas son ilustraciones REALES del set, no un icono genérico que las
 * represente. Elegir `notionists` o `cutouts` por su nombre no es elegir: son
 * palabras que no le dicen nada a nadie. Tres dibujos, sí.
 *
 * Las muestras vienen repartidas a lo largo del set, no las tres primeras: en
 * un set generado por semilla las contiguas se parecen, y darían una idea falsa
 * de la variedad.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface Adornos {
  /** Figuras dibujadas que se sobreponen en una esquina. */
  ilustraciones: boolean;
  /** Sets concretos; vacío = los elige el sistema. */
  estilos: string[];
  /** Iconos animados con fondo de color. */
  iconos: boolean;
  /** Gráficas de datos (barras, progreso). */
  graficas: boolean;
}

export const ADORNOS_POR_OMISION: Adornos = {
  ilustraciones: true,
  estilos: [],
  iconos: true,
  graficas: true,
};

/** En editorial todo apagado: su fuerza es la tipografía, no los adornos. */
export const ADORNOS_EDITORIAL: Adornos = {
  ilustraciones: false,
  estilos: [],
  iconos: false,
  graficas: false,
};

interface EstiloApi {
  id: string;
  cantidad: number;
  familia: string;
  licencia: string;
  muestras: string[];
}

const FAMILIAS: Record<string, string> = {
  personas: "Personas",
  trazo: "Trazo suelto",
  plano: "Formas planas",
  pixel: "Pixel art",
  bichos: "Criaturas y robots",
  otros: "Otros",
};

export function AdornosPicker({
  valor,
  onChange,
}: {
  valor: Adornos;
  onChange: (v: Adornos) => void;
}) {
  const [estilos, setEstilos] = useState<EstiloApi[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    fetch("/api/illustrations/estilos")
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        setEstilos(d.estilos ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const set = (parche: Partial<Adornos>) => onChange({ ...valor, ...parche });

  const alternarEstilo = (id: string) => {
    const hay = valor.estilos.includes(id);
    set({ estilos: hay ? valor.estilos.filter((x) => x !== id) : [...valor.estilos, id] });
  };

  const porFamilia = estilos.reduce<Record<string, EstiloApi[]>>((acc, e) => {
    (acc[e.familia] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <div className="text-sm font-medium">🎨 Qué se agrega encima del video</div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Cada capa suma. En un estilo sobrio, menos es más: si el texto ya tiene
        carácter, los adornos compiten con él.
      </p>

      {/* Los tres tipos, encendibles por separado */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(
          [
            ["ilustraciones", "Ilustraciones", "Figuras dibujadas en una esquina"],
            ["iconos", "Iconos", "Símbolos animados con fondo de color"],
            ["graficas", "Gráficas", "Barras y porcentajes de lo que se dice"],
          ] as const
        ).map(([k, nombre, pista]) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ [k]: !valor[k] } as Partial<Adornos>)}
            aria-pressed={valor[k]}
            className={cn(
              "rounded-lg border p-2 text-left transition-all",
              valor[k]
                ? "border-violet-400 bg-violet-500/10 ring-1 ring-violet-400"
                : "border-border text-muted-foreground hover:border-foreground/30",
            )}
          >
            <span className="block text-xs font-medium">
              {valor[k] ? "✓ " : "○ "}
              {nombre}
            </span>
            <span className="block text-[10px] leading-tight text-muted-foreground">
              {pista}
            </span>
          </button>
        ))}
      </div>

      {/* Estilos de ilustración, con dibujos de verdad */}
      {valor.ilustraciones && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] text-muted-foreground">
            {cargando
              ? "Cargando estilos…"
              : `${total} ilustraciones en ${estilos.length} estilos. Sin elegir ninguno, el sistema decide; eligiendo, se usan sólo ésos.`}
          </p>

          {Object.entries(porFamilia).map(([familia, lista]) => (
            <div key={familia} className="mb-3">
              <div className="mb-1.5 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
                {FAMILIAS[familia] ?? familia}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {lista.map((e) => {
                  const activo = valor.estilos.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => alternarEstilo(e.id)}
                      aria-pressed={activo}
                      title={`${e.cantidad} ilustraciones · ${e.licencia}`}
                      className={cn(
                        "overflow-hidden rounded-lg border text-left transition-all",
                        activo
                          ? "border-violet-400 ring-1 ring-violet-400"
                          : "border-border hover:border-foreground/30",
                      )}
                    >
                      <div className="flex h-16 items-center justify-around bg-white/95 px-1">
                        {e.muestras.map((src) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={src}
                            src={src}
                            alt=""
                            className="h-14 w-1/3 object-contain"
                            loading="lazy"
                          />
                        ))}
                      </div>
                      <div className="truncate px-2 py-1 text-[10px]">
                        {activo ? "✓ " : ""}
                        {e.id}
                        <span className="ml-1 text-muted-foreground">({e.cantidad})</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
