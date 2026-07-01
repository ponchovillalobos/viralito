import path from "node:path";
import { existsSync, readdirSync } from "node:fs";

/**
 * Paths del proyecto. Todo derivado automáticamente.
 *
 * Variables de entorno opcionales para overridear:
 *   VIRAL_PROJECT_ROOT — root del repo (default: 1 nivel arriba de frontend/)
 *   VIRAL_DATA_ROOT    — datos del usuario (default: C:\viral-data\videos)
 *   VIRAL_FFMPEG_EXE   — path explícito a ffmpeg
 *   VIRAL_FFPROBE_EXE  — path explícito a ffprobe
 *   VIRAL_API_HOST     — host del dev server (default: http://localhost:3000)
 */

function pickDataRoot(): string {
  const override = process.env.VIRAL_DATA_ROOT;
  if (override) return override;

  // Defaults: viral-data primero, fallback a hermes-data por compat con instalaciones viejas
  const candidates = ["C:\\viral-data\\videos", "C:\\hermes-data\\videos"];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // crear viral-data por default si nada existe
}

export const PROJECT_ROOT =
  process.env.VIRAL_PROJECT_ROOT ?? path.resolve(process.cwd(), "..");

export const DATA_ROOT = pickDataRoot();

export const RAW_DIR = path.join(DATA_ROOT, "raw");
export const TRANSCRIPTS_DIR = path.join(DATA_ROOT, "transcripts");
export const CUTS_DIR = path.join(DATA_ROOT, "cuts");
export const RENDERS_DIR = path.join(DATA_ROOT, "renders");
export const PROJECTS_DIR = path.join(DATA_ROOT, "projects");
// Miniaturas custom que el usuario sube por video (JPG/PNG). Se usan como thumbnail del post
// (ej. LinkedIn uploadThumbnail). Vertical u horizontal según el video — el usuario provee el aspecto.
export const THUMBS_DIR = path.join(DATA_ROOT, "thumbnails");
export const BROLL_DIR = path.join(DATA_ROOT, "assets", "broll");
export const MUSIC_DIR = path.join(DATA_ROOT, "assets", "music");
export const SFX_DIR = path.join(DATA_ROOT, "assets", "sfx", "curated");
// C1 — Voz IA (Piper): WAVs por proyecto.
export const VOICEOVER_DIR = path.join(DATA_ROOT, "assets", "voiceovers");

export const LF_ROOT = path.join(DATA_ROOT, "long_form");
export const LF_RAW = path.join(LF_ROOT, "raw");
export const LF_CLEAN = path.join(LF_ROOT, "clean");
export const LF_CLIPS = path.join(LF_ROOT, "clips");
export const LF_RENDERS = path.join(LF_ROOT, "renders");
export const LF_THUMBS = path.join(LF_ROOT, "thumbnails");

// Modo cinematográfico — imágenes que el usuario sube para superponer al video.
// Estructura: {OVERLAYS_DIR}/{videoId}/{overlayId}.{jpg|png|webp}
export const OVERLAYS_DIR = path.join(DATA_ROOT, "overlays");

// VIRAL_PYTHON_EXE: el instalador distribuible usa Python EMBEDDABLE
// (payload/python/runtime/python.exe) en vez del venv de desarrollo.
export const PYTHON_EXE =
  process.env.VIRAL_PYTHON_EXE ??
  path.join(PROJECT_ROOT, "python", "venv", "Scripts", "python.exe");
export const PYTHON_DIR = path.join(PROJECT_ROOT, "python");
export const REMOTION_DIR = path.join(PROJECT_ROOT, "remotion");

function detectFFmpegBin(binary: "ffmpeg" | "ffprobe"): string {
  const overrideVar = binary === "ffmpeg" ? "VIRAL_FFMPEG_EXE" : "VIRAL_FFPROBE_EXE";
  const override = process.env[overrideVar];
  if (override && existsSync(override)) return override;

  // Auto-detect en {DATA_ROOT}/../tools/ffmpeg-*/bin/
  const toolsDir = path.join(path.dirname(DATA_ROOT), "tools");
  if (existsSync(toolsDir)) {
    try {
      const entries = readdirSync(toolsDir);
      const ffmpegFolder = entries.find((e) => e.startsWith("ffmpeg-"));
      if (ffmpegFolder) {
        const candidate = path.join(toolsDir, ffmpegFolder, "bin", `${binary}.exe`);
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // ignore
    }
  }

  return `${binary}.exe`;
}

export const FFMPEG_EXE = detectFFmpegBin("ffmpeg");
export const FFPROBE_EXE = detectFFmpegBin("ffprobe");

export function videoIdFromPath(p: string): string {
  return path.basename(p, path.extname(p));
}
