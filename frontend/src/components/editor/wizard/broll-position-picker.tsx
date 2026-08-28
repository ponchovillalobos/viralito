"use client";

/**
 * DÓNDE aparece el material de apoyo (videos, fotos, GIFs).
 *
 * El render ya decidía solo: si el material encaja en el lienzo lo pone a
 * pantalla completa, y si no encaja —un GIF cuadrado en un 9:16— lo baja a una
 * banda para no recortarle media imagen. Acierta la mayoría de las veces.
 *
 * El problema es cuando se equivoca: un clip vertical de archivo *sí* encaja,
 * así que tapa el cuadro entero — y con él la cara de quien está hablando. No
 * había forma de decirle que no.
 *
 * Las miniaturas son esquemas, no fotos: lo que hay que entender de un vistazo
 * es qué parte del cuadro se ocupa y qué parte queda para la persona. Una
 * miniatura real de Pexels aquí distrae de la única decisión que se está
 * tomando.
 */
import { cn } from "@/lib/utils";

export type BrollPosition = "auto" | "arriba" | "abajo" | "completa";

const OPCIONES: {
  id: BrollPosition;
  nombre: string;
  pista: string;
  /** Fracción del alto que ocupa el apoyo, y desde dónde. */
  esquema: { alto: number; desde: "arriba" | "abajo" | "todo" };
}[] = [
  {
    id: "auto",
    nombre: "Automático",
    pista: "Decide según la forma de cada material",
    esquema: { alto: 0.45, desde: "abajo" },
  },
  {
    id: "abajo",
    nombre: "Abajo",
    pista: "Nunca te tapa la cara",
    esquema: { alto: 0.45, desde: "abajo" },
  },
  {
    id: "arriba",
    nombre: "Arriba",
    pista: "Si hablás en la parte baja del cuadro",
    esquema: { alto: 0.45, desde: "arriba" },
  },
  {
    id: "completa",
    nombre: "Pantalla completa",
    pista: "Máximo impacto, tapa el video",
    esquema: { alto: 1, desde: "todo" },
  },
];

/** Esquema del lienzo: gris = tu video, color = el material de apoyo. */
function Esquema({
  alto,
  desde,
  activo,
}: {
  alto: number;
  desde: "arriba" | "abajo" | "todo";
  activo: boolean;
}) {
  const apoyo = (
    <div
      style={{ height: `${alto * 100}%` }}
      className={cn(
        "w-full transition-colors",
        activo ? "bg-violet-400/70" : "bg-foreground/25"
      )}
    />
  );
  return (
    <div className="flex h-14 w-9 flex-col overflow-hidden rounded border border-border/60 bg-muted/40">
      {desde === "arriba" && apoyo}
      {desde !== "todo" && <div className="flex-1" />}
      {desde === "abajo" && apoyo}
      {desde === "todo" && apoyo}
    </div>
  );
}

export function BrollPositionPicker({
  valor,
  onChange,
}: {
  valor: BrollPosition;
  onChange: (v: BrollPosition) => void;
}) {
  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <div className="text-sm font-medium">🖼️ ¿Dónde aparece el material?</div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Gris es tu video; violeta, el material de apoyo. Elegí{" "}
        <strong>Abajo</strong> si no querés que nada te tape la cara.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPCIONES.map((o) => {
          const activo = valor === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={activo}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2 text-left transition-all",
                activo
                  ? "border-violet-400 ring-1 ring-violet-400"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <Esquema {...o.esquema} activo={activo} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{o.nombre}</span>
                <span className="block text-[10px] leading-tight text-muted-foreground">
                  {o.pista}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
