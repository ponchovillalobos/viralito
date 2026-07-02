"use client";

import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import type { AnimationMark } from "@/components/editor/workspace";

interface Props {
  animations: AnimationMark[];
  onChange: (a: AnimationMark[]) => void;
  currentTime: number;
}

const TYPES: AnimationMark["type"][] = ["zoom", "glow", "shake"];
const LABELS: Record<AnimationMark["type"], string> = {
  zoom: "Zoom on hook",
  glow: "Glow keyword",
  shake: "Shake emphasis",
};
const DESCRIPTIONS: Record<AnimationMark["type"], string> = {
  zoom: "Acerca cámara 8% durante 0.5s",
  glow: "Resplandor en bordes",
  shake: "Vibración rápida 0.5s",
};

export function AnimationsPanel({ animations, onChange, currentTime }: Props) {
  function addAt(type: AnimationMark["type"]) {
    const next: AnimationMark = { at: Math.round(currentTime * 10) / 10, type };
    onChange([...animations, next].sort((a, b) => a.at - b.at));
  }

  function remove(i: number) {
    onChange(animations.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Insertar en el tiempo actual ({currentTime.toFixed(1)}s)</Label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addAt(t)}
              aria-label={`Agregar animación: ${LABELS[t]}`}
              title={`Agregar animación: ${LABELS[t]}`}
              className="rounded-md border border-border bg-card p-3 text-left text-xs hover:border-foreground/30"
            >
              <div className="flex items-center gap-1.5 font-medium">
                <Plus className="h-3 w-3" />
                {LABELS[t]}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {DESCRIPTIONS[t]}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Marcas activas ({animations.length})</Label>
        {animations.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin animaciones. Agrega una arriba.</p>
        ) : (
          <ul className="space-y-1.5">
            {animations.map((a, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs"
              >
                <span className="font-mono-tab text-muted-foreground">
                  {a.at.toFixed(1)}s
                </span>
                <span className="flex-1">{LABELS[a.type]}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Borrar la marca de ${LABELS[a.type]} en ${a.at.toFixed(1)}s`}
                  title={`Borrar la marca de ${LABELS[a.type]} en ${a.at.toFixed(1)}s`}
                  className="rounded p-1 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
