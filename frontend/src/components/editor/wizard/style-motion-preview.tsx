"use client";

/**
 * Preview EN MOVIMIENTO de un estilo: 3s reales pre-renderizados con el motor real
 * (frontend/public/style-previews/{id}_{v|h}.mp4, generados por
 * remotion/generate-style-previews.mjs). Se reproduce en loop, muted.
 *
 * Fallback silencioso: si el MP4 no existe (estilo nuevo sin regenerar, repo sin
 * assets), el componente se oculta solo — los stills de style-thumbs siguen abajo.
 */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StyleMotionPreview({
  styleId,
  horizontal = false,
  className,
  fallback = null,
}: {
  styleId: string;
  /** true → usa el MP4 16:9; false → el 9:16. */
  horizontal?: boolean;
  className?: string;
  /** Qué mostrar si el MP4 no existe (ej. el mini-demo CSS). Default: nada. */
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
     
    <video
      src={`/style-previews/${styleId}_${horizontal ? "h" : "v"}.mp4`}
      autoPlay
      loop
      muted
      playsInline
      onError={() => setFailed(true)}
      title="Así se ve este estilo en movimiento"
      className={cn(
        "mb-1.5 rounded-md border border-white/10 object-cover",
        horizontal ? "aspect-video w-full" : "mx-auto aspect-[9/16] w-1/2 min-w-[120px]",
        className,
      )}
    />
  );
}
