import { describe, expect, it } from "vitest";
import {
  ANTICIPACION,
  desplazarMapa,
  elegirInicioMusica,
  planBeatSync,
  type MapaRitmico,
} from "@/app/api/editor/auto-build/lib/beat-sync";
import type { ResolvedProject } from "@/app/api/editor/auto-build/lib/types";

// Pista sintética a 120 bpm: un beat cada 0.5 s, downbeat cada 2 s.
function mapa(extra: Partial<MapaRitmico> = {}): MapaRitmico {
  const beats = Array.from({ length: 80 }, (_, i) => ({ t: i * 0.5, strength: 1 }));
  return {
    bpm: 120,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0).map((b) => b.t),
    sections: [
      { t0: 0, t1: 10, kind: "low", energy: 0.2 },
      { t0: 10, t1: 20, kind: "mid", energy: 0.5 },
      { t0: 20, t1: 40, kind: "high", energy: 0.9 },
    ],
    drops: [20],
    ...extra,
  };
}

const proyecto = (p: Partial<ResolvedProject> = {}) => ({ ...p }) as ResolvedProject;

describe("planBeatSync", () => {
  it("cuantiza un evento cercano al beat, un frame antes", () => {
    const p = proyecto({ zoomMarks: [{ at: 12.08, duration: 0.5, scale: 1.1 }] });
    planBeatSync(p, mapa(), 38);
    const z = (p.zoomMarks as { at: number }[])[0];
    expect(z.at).toBeCloseTo(12 - ANTICIPACION, 3);
  });

  it("no mueve un evento lejos de cualquier beat", () => {
    // A 120 bpm la tolerancia es min(150 ms, 125 ms) = 125 ms; 12.25 está a 250 ms.
    const p = proyecto({ reactionZooms: [{ at: 12.25, intensity: 1.3, duration: 0.2 }] });
    planBeatSync(p, mapa(), 38);
    expect((p.reactionZooms as { at: number }[])[0].at).toBe(12.25);
  });

  it("mueve el corte de B-roll al beat conservando su duración", () => {
    const p = proyecto({ bRoll: [{ start: 15.9, end: 18.9, url: "x" }] } as never);
    planBeatSync(p, mapa(), 38);
    const c = (p as unknown as { bRoll: { start: number; end: number }[] }).bRoll[0];
    expect(c.start).toBeCloseTo(16 - ANTICIPACION, 3);
    expect(c.end - c.start).toBeCloseTo(3, 3);
  });

  it("el drop recibe flash y punch, y cae antes del beat", () => {
    const p = proyecto();
    const r = planBeatSync(p, mapa(), 38);
    expect(r.drops).toBe(1);
    const flash = (p.proTransitions as { at: number; kind: string }[]).find((t) => t.kind === "flash");
    expect(flash?.at).toBeCloseTo(20 - ANTICIPACION, 3);
    expect((p.reactionZooms as unknown[]).length).toBe(1);
  });

  it("el drop lleva un destello de luz del color del acento", () => {
    const p = proyecto();
    planBeatSync(p, mapa(), 38, "#8b5cf6");
    expect(p.lightLeaks).toHaveLength(1);
    expect(p.lightLeaks?.[0].color).toBe("#8b5cf6");
    expect(p.lightLeaks?.[0].at).toBeCloseTo(20 - ANTICIPACION, 3);
  });

  it("sin drop dentro del clip, el golpe va en el mayor salto de energía", () => {
    const p = proyecto();
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: i * 2, e: i === 7 ? 0.9 : 0.4 }));
    const r = planBeatSync(p, mapa({ drops: [120], bars }), 38, "#f59e0b");
    expect(r.drops).toBe(1);
    expect(p.lightLeaks?.[0].at).toBeCloseTo(14 - ANTICIPACION, 3);
  });

  it("no pone golpes en las secciones bajas y respeta la separación mínima", () => {
    const p = proyecto();
    planBeatSync(p, mapa(), 38);
    const ats = (p.zoomMarks as { at: number }[]).map((z) => z.at).sort((a, b) => a - b);
    expect(ats.every((t) => t >= 10 - ANTICIPACION)).toBe(true);
    for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1]).toBeGreaterThanOrEqual(1.2 - 1e-6);
  });

  it("sin beats suficientes no toca nada", () => {
    const p = proyecto({ zoomMarks: [{ at: 3, duration: 0.5, scale: 1.1 }] });
    const r = planBeatSync(p, { beats: [{ t: 1, strength: 1 }] }, 38);
    expect(r).toEqual({ drops: 0, downbeats: 0, cuantizados: 0 });
    expect((p.zoomMarks as { at: number }[])[0].at).toBe(3);
  });
});

describe("inicio de la música", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: i * 2, e: i >= 30 && i < 45 ? 0.9 : 0.3 }));
  it("arranca en el tramo de más energía, en un downbeat", () => {
    const t = elegirInicioMusica({ dur: 120, bars, drops: [] }, 30);
    expect(t).toBe(60);
  });
  it("si la pista es más corta que el clip, arranca en 0", () => {
    expect(elegirInicioMusica({ dur: 25, bars: bars.slice(0, 12) }, 30)).toBe(0);
  });
  it("desplazar deja los tiempos en el reloj del video", () => {
    const m = desplazarMapa({ beats: [{ t: 61, strength: 1 }], downbeats: [62], drops: [70] }, 60);
    expect(m.beats?.[0].t).toBe(1);
    expect(m.downbeats?.[0]).toBe(2);
    expect(m.drops?.[0]).toBe(10);
  });
});
