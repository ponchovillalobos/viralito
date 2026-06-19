"use client";

// Thumbnails de Pexels (URLs externas dinámicas). next/image requeriría width/height
// fijos y remotePatterns por cada dominio; el costo no se justifica para previews.
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import type { BRollClip } from "@/components/editor/workspace";

interface PexelsVideo {
  id: number;
  duration: number;
  width: number;
  height: number;
  image: string;
  video_files: Array<{ link: string; quality: string; width: number; height: number }>;
}

interface Props {
  clips: BRollClip[];
  onChange: (clips: BRollClip[]) => void;
  currentTime: number;
}

export function BrollPicker({ clips, onChange, currentTime }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PexelsVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/pexels/search?q=${encodeURIComponent(query)}&type=videos&orientation=portrait`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "search failed");
      setResults(data.videos ?? []);
      setSearched(true);
    } catch (err) {
      toastError(err, "No se pudo buscar en Pexels");
    } finally {
      setLoading(false);
    }
  }

  function addClip(v: PexelsVideo) {
    const file = v.video_files.find((f) => f.quality === "hd") ?? v.video_files[0];
    if (!file) return;
    const start = Math.max(0, Math.floor(currentTime * 10) / 10);
    const next: BRollClip = {
      start,
      end: start + 3,
      url: file.link,
      thumbnail: v.image,
    };
    onChange([...clips, next].sort((a, b) => a.start - b.start));
    toast.success(`B-roll agregado en ${start.toFixed(1)}s`);
  }

  function removeClip(i: number) {
    onChange(clips.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="ej: laptop, oficina, código, ventas..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <Button onClick={search} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => addClip(v)}
              className="group relative overflow-hidden rounded-md border border-border bg-card aspect-[9/16]"
            >
              <img
                src={v.image}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/60 group-hover:opacity-100">
                <Plus className="h-6 w-6 text-brand-pink" />
              </div>
              <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono-tab text-[9px]">
                {v.duration}s
              </span>
            </button>
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-card/50 p-4 text-center text-xs text-muted-foreground">
          Sin resultados para esa búsqueda. Probá otros términos.
        </p>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Clips agregados ({clips.length})</Label>
        {clips.length === 0 ? (
          <p className="text-xs text-muted-foreground">Busca y agrega clips arriba.</p>
        ) : (
          <ul className="space-y-1.5">
            {clips.map((c, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2"
              >
                {c.thumbnail && (
                  <img
                    src={c.thumbnail}
                    loading="lazy"
                    className="h-10 w-7 rounded object-cover"
                    alt=""
                  />
                )}
                <div className="flex-1 text-xs">
                  <div className="font-mono-tab">
                    {c.start.toFixed(1)}s → {c.end.toFixed(1)}s
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                    {c.url.split("/").pop()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeClip(i)}
                  className="rounded p-1 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
