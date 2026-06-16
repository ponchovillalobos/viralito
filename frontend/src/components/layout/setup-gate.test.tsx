// @vitest-environment jsdom
//
// Pruebas del pre-flight gate (T5). NO se corren todavía: el proyecto aún no
// tiene vitest + jsdom + @testing-library/react configurados para componentes
// React. Cuando se configure (entorno "jsdom" y los setup files), este archivo
// debería pasar tal cual.
//
// Casos cubiertos:
//   (a) diagnose ok:true        → renderiza children, NO llama setup/full.
//   (b) diagnose ok:false (assets) → llama POST /api/setup/full (reparable).
//   (c) diagnose ok:false (ffmpeg) → muestra "reinstalar", NO llama setup/full.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SetupGate } from "./setup-gate";

// Diagnose "todo ok": cada check con ok:true.
function diagnoseAllOk() {
  return {
    ok: true,
    checks: {
      dataRoot: { ok: true },
      ffmpeg: { ok: true },
      ffprobe: { ok: true },
      python: { ok: true },
      whisperModel: { ok: true },
      alignmentModel: { ok: true },
      ollama: { ok: true },
      torch: { ok: true },
      assets: {
        music: { ok: true },
        sfx: { ok: true },
        lottie: { ok: true },
        icons: { ok: true },
        fonts: { ok: true },
        luts: { ok: true },
      },
    },
  };
}

// Base "todo ok" pero con overrides para simular fallas puntuales.
function diagnoseWith(overrides: Record<string, unknown>) {
  const d = diagnoseAllOk();
  return { ...d, ok: false, checks: { ...d.checks, ...overrides } };
}

/** Stub de fetch que despacha por URL. Devuelve el mock para inspeccionarlo. */
function mockFetch(diagnose: unknown) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/doctor/diagnose")) {
      return { ok: true, json: async () => diagnose } as Response;
    }
    if (url.includes("/api/setup/full")) {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      // GET poll: ya terminó bien.
      return {
        ok: true,
        json: async () => ({ running: false, done: true, ok: true, lastLine: "", stages: [] }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("open", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SetupGate", () => {
  it("(a) con diagnose ok:true renderiza los children y no llama a setup/full", async () => {
    const f = mockFetch(diagnoseAllOk());
    vi.stubGlobal("fetch", f);

    render(
      <SetupGate>
        <div>contenido principal</div>
      </SetupGate>
    );

    await waitFor(() => expect(screen.getByText("contenido principal")).toBeTruthy());

    const setupPost = f.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/api/setup/full") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(setupPost).toBeUndefined();
  });

  it("(b) con diagnose ok:false por assets dispara POST /api/setup/full", async () => {
    const f = mockFetch(diagnoseWith({ assets: { ...diagnoseAllOk().checks.assets, music: { ok: false } } }));
    vi.stubGlobal("fetch", f);

    render(
      <SetupGate>
        <div>contenido principal</div>
      </SetupGate>
    );

    await waitFor(() => {
      const setupPost = f.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/setup/full") &&
          (init as RequestInit | undefined)?.method === "POST"
      );
      expect(setupPost).toBeDefined();
    });

    // La UI principal NO debe estar visible mientras repara.
    expect(screen.queryByText("contenido principal")).toBeNull();
  });

  it("(c) con ffmpeg AUSENTE (present:false) muestra 'reinstalar' y NO llama setup/full", async () => {
    // FATAL = falta un binario del sistema en disco (present:false). Un ffmpeg que
    // EXISTE pero falló (ok:false sin present:false) es 'repairable' por diseño
    // (ver classify(): evita el falso "reinstala" en PCs sanas).
    const f = mockFetch(diagnoseWith({ ffmpeg: { ok: false, present: false } }));
    vi.stubGlobal("fetch", f);

    render(
      <SetupGate>
        <div>contenido principal</div>
      </SetupGate>
    );

    await waitFor(() => expect(screen.getByText(/reinstalar Viralito/i)).toBeTruthy());

    expect(screen.queryByText("contenido principal")).toBeNull();

    const setupPost = f.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/api/setup/full") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(setupPost).toBeUndefined();
  });
});
