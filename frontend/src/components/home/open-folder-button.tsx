"use client";

import { FolderOpen } from "lucide-react";
import { useState } from "react";

/**
 * Botón del home: abre en el explorador la carpeta donde se guardan los videos
 * renderizados (long_form/renders — donde caen los clips y los reels de Mejores
 * Momentos). Fire-and-forget; muestra un guiño de confirmación al abrir.
 */
export function OpenFolderButton() {
  const [opened, setOpened] = useState(false);
  async function open() {
    try {
      await fetch("/api/open-folder", { method: "POST" });
      setOpened(true);
      setTimeout(() => setOpened(false), 2500);
    } catch {
      // el explorador es fire-and-forget; si algo falla, el usuario reintenta.
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      title="Abre la carpeta donde están tus videos ya generados"
      className="group inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/50 hover:text-foreground hover:shadow-md hover:shadow-primary/5"
    >
      <FolderOpen className="h-4 w-4 transition-colors group-hover:text-primary" />
      {opened ? "Abriendo la carpeta…" : "Abrir la carpeta de mis videos"}
    </button>
  );
}
