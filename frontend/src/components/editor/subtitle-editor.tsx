"use client";

import { useEffect, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { Word } from "@/components/editor/workspace";

interface Props {
  words: Word[];
  onChange: (words: Word[]) => void;
  currentTime: number;
  style: "bebas" | "anton";
  color: string;
  highlight: string;
  onStyleChange: (s: "bebas" | "anton") => void;
  onColorChange: (c: string) => void;
  onHighlightChange: (c: string) => void;
}

export function SubtitleEditor({
  words,
  onChange,
  currentTime,
  style,
  color,
  highlight,
  onStyleChange,
  onColorChange,
  onHighlightChange,
}: Props) {
  const activeRef = useRef<HTMLLIElement>(null);
  const activeIndex = words.findIndex(
    (w) => currentTime >= w.start && currentTime <= w.end
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  if (words.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin transcripción aún. Da clic en «Transcribir» arriba.
      </p>
    );
  }

  function updateWord(i: number, value: string) {
    const next = [...words];
    next[i] = { ...next[i], word: value };
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Fuente</Label>
          <select
            value={style}
            onChange={(e) => onStyleChange(e.target.value as "bebas" | "anton")}
            aria-label="Fuente de los subtítulos"
            className="w-full rounded-md border border-border bg-muted/30 p-1.5 text-xs"
          >
            <option value="bebas">Bebas Neue</option>
            <option value="anton">Anton</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Color base</Label>
          <Input
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="h-9 p-1"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Highlight</Label>
          <Input
            type="color"
            value={highlight}
            onChange={(e) => onHighlightChange(e.target.value)}
            className="h-9 p-1"
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/20">
        <ul className="max-h-[480px] overflow-y-auto p-2">
          {words.map((w, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={i}
                ref={active ? activeRef : null}
                className={`grid grid-cols-[60px_1fr_40px] items-center gap-2 rounded px-2 py-1 text-xs ${
                  active ? "bg-brand-pink/15" : ""
                }`}
              >
                <span className="font-mono-tab text-[10px] text-muted-foreground">
                  {w.start.toFixed(2)}s
                </span>
                <input
                  value={w.word}
                  onChange={(e) => updateWord(i, e.target.value)}
                  className="rounded bg-transparent px-1 outline-none focus:bg-muted"
                />
                <span className="font-mono-tab text-[10px] text-muted-foreground">
                  {((w.end - w.start) * 1000).toFixed(0)}ms
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
