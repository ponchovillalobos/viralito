"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Music, Play, Pause, Check } from "lucide-react";

interface MusicTrack {
  name: string;
  filename: string;
  url: string;
}

interface Props {
  selected: string | null;
  volume: number;
  onSelect: (t: string | null) => void;
  onVolumeChange: (v: number) => void;
}

export function MusicPicker({ selected, volume, onSelect, onVolumeChange }: Props) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [musicDir, setMusicDir] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/music/list")
      .then((r) => r.json())
      .then((d) => {
        setTracks(d.tracks ?? []);
        setMusicDir(typeof d.dir === "string" ? d.dir : null);
      })
      .catch(() => setTracks([]));
  }, []);

  function togglePlay(t: MusicTrack) {
    if (playing === t.filename) {
      audio?.pause();
      setPlaying(null);
      return;
    }
    audio?.pause();
    const a = new Audio(t.url);
    // El preview suena al VOLUMEN ELEGIDO (no a 0.6 fijo) para que escuches cómo va a
    // quedar la música en el video. Se actualiza en vivo al mover el slider (useEffect).
    a.volume = Math.max(0, Math.min(1, volume ?? 0.35));
    a.onended = () => setPlaying(null);
    a.play().catch(() => {});
    setAudio(a);
    setPlaying(t.filename);
  }

  // Mover el slider mientras un track suena baja/sube el preview en tiempo real.
  useEffect(() => {
    // Mutar la propiedad del elemento <audio> del DOM es el uso correcto de un effect
    // (sincronizar con un sistema externo); el React Compiler lo marca por precaución.
    // eslint-disable-next-line react-hooks/immutability
    if (audio) audio.volume = Math.max(0, Math.min(1, volume ?? 0.35));
  }, [volume, audio]);

  // Detener y resetear el preview al desmontar: sin esto el track sigue sonando
  // al navegar fuera del wizard.
  useEffect(() => {
    return () => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [audio]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Volumen de música</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round((volume ?? 0.35) * 100)}%
          </span>
        </div>
        <Slider
          aria-label="Volumen de música"
          min={0}
          max={100}
          step={1}
          value={Math.round((volume ?? 0.35) * 100)}
          onValueChange={(v) => onVolumeChange(v / 100)}
        />
        <p className="text-[10px] text-muted-foreground">
          Sugerido: 30-40% bajo voz hablada. El ducking automático la baja cuando hablas.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Tracks disponibles ({tracks.length})</Label>
        {tracks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/50 p-4 text-xs text-muted-foreground">
            Sin tracks. Pega MP3 en{" "}
            {musicDir ? (
              <span className="font-mono-tab">{musicDir}</span>
            ) : (
              <span className="font-mono-tab">la carpeta assets\music de tus datos</span>
            )}
          </div>
        ) : (
          <ul className="space-y-1.5">
            <li>
              <button
                type="button"
                onClick={() => onSelect(null)}
                className={`flex w-full items-center justify-between rounded-md border p-2 text-xs ${
                  selected === null
                    ? "border-foreground/40 bg-muted"
                    : "border-border bg-card"
                }`}
              >
                <span className="text-muted-foreground">Sin música</span>
                {selected === null && <Check className="h-3.5 w-3.5" />}
              </button>
            </li>
            {tracks.map((t) => {
              const isSelected = selected === t.filename;
              const isPlaying = playing === t.filename;
              return (
                <li
                  key={t.filename}
                  className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
                    isSelected ? "border-foreground/40 bg-muted" : "border-border bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => togglePlay(t)}
                    aria-label={isPlaying ? "Pausar la muestra" : "Escuchar la muestra"}
                    title={isPlaying ? "Pausar la muestra" : "Escuchar la muestra"}
                    className="rounded p-1 hover:bg-muted"
                  >
                    {isPlaying ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(t.filename)}
                    aria-label={`Elegir la pista ${t.name}`}
                    aria-pressed={isSelected}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Music className="h-3 w-3 text-muted-foreground" />
                      <span>{t.name}</span>
                    </div>
                  </button>
                  {isSelected && <Check className="h-3.5 w-3.5 text-brand-pink" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
