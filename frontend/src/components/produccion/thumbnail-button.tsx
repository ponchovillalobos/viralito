"use client";

/**
 * Botón compacto para subir/ver la miniatura custom de un video. Autocontenido: consulta
 * /api/projects/[id]/thumbnail (GET sirve la imagen si existe), sube con POST (multipart),
 * borra con DELETE. La miniatura se usa como thumbnail del post (ej. LinkedIn). Aditivo.
 */
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Check, X } from "lucide-react";

export function ThumbnailButton({ projectId }: { projectId: string }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [bust, setBust] = useState(0); // cache-buster para el preview
  const inputRef = useRef<HTMLInputElement>(null);
  const url = `/api/projects/${encodeURIComponent(projectId)}/thumbnail`;

  useEffect(() => {
    let cancelled = false;
    fetch(url, { method: "HEAD" })
      .then((r) => !cancelled && setHas(r.ok))
      .catch(() => !cancelled && setHas(false));
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(url, { method: "POST", body: fd });
      if (r.ok) {
        setHas(true);
        setBust((b) => b + 1);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      await fetch(url, { method: "DELETE" });
      setHas(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFile}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition hover:border-foreground/40 disabled:opacity-50"
        title={has ? "Cambiar miniatura del post" : "Subir miniatura para el post (vertical u horizontal)"}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : has ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <ImageIcon className="h-3 w-3" />
        )}
        {has ? "Miniatura ✓" : "Miniatura"}
      </button>
      {has && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${url}?t=${bust}`}
            alt="miniatura"
            className="h-6 w-6 rounded object-cover"
          />
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-muted-foreground transition hover:text-red-400"
            title="Quitar miniatura"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
