"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Montserrat,
  Poppins,
  Oswald,
  Bangers,
  Luckiest_Guy,
  Archivo_Black,
  Teko,
  Righteous,
  Bebas_Neue,
  Anton,
} from "next/font/google";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SECTION_COLORS } from "@/lib/section-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileVideo,
  FolderOpen,
  Loader2,
  Play,
  RefreshCcw,
  Scissors,
  Sparkles,
  XCircle,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { StyleMiniDemo } from "@/components/editor/wizard/style-mini-demo";

// ─── Fuentes para el preview (mismas que el wizard de shorts; gratis, self-host) ──
const _mont = Montserrat({ subsets: ["latin"], weight: "800", display: "swap" });
const _pop = Poppins({ subsets: ["latin"], weight: "800", display: "swap" });
const _osw = Oswald({ subsets: ["latin"], weight: "700", display: "swap" });
const _ban = Bangers({ subsets: ["latin"], weight: "400", display: "swap" });
const _luck = Luckiest_Guy({ subsets: ["latin"], weight: "400", display: "swap" });
const _arch = Archivo_Black({ subsets: ["latin"], weight: "400", display: "swap" });
const _teko = Teko({ subsets: ["latin"], weight: "600", display: "swap" });
const _right = Righteous({ subsets: ["latin"], weight: "400", display: "swap" });
const _bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap" });
const _anton = Anton({ subsets: ["latin"], weight: "400", display: "swap" });

const FONT_PREVIEW: Record<string, string> = {
  auto: "",
  bebas: _bebas.style.fontFamily,
  anton: _anton.style.fontFamily,
  montserrat: _mont.style.fontFamily,
  poppins: _pop.style.fontFamily,
  oswald: _osw.style.fontFamily,
  bangers: _ban.style.fontFamily,
  luckiest: _luck.style.fontFamily,
  archivo: _arch.style.fontFamily,
  teko: _teko.style.fontFamily,
  righteous: _right.style.fontFamily,
};

const SUBTITLE_FONTS: { id: string; name: string }[] = [
  { id: "auto", name: "Automática" },
  { id: "bebas", name: "Bebas (clásica)" },
  { id: "anton", name: "Anton (peso)" },
  { id: "montserrat", name: "Montserrat (limpia)" },
  { id: "poppins", name: "Poppins (redonda)" },
  { id: "oswald", name: "Oswald (condensada)" },
  { id: "bangers", name: "Bangers (cómic)" },
  { id: "luckiest", name: "Luckiest Guy (divertida)" },
  { id: "archivo", name: "Archivo Black (sólida)" },
  { id: "teko", name: "Teko (fina alta)" },
  { id: "righteous", name: "Righteous (retro)" },
];

// Color del TEXTO de los subtítulos ("auto" = el del estilo, normalmente blanco).
const SUBTITLE_COLORS: { id: string; name: string; value: string }[] = [
  { id: "auto", name: "Automático", value: "#ffffff" },
  { id: "#ffffff", name: "Blanco", value: "#ffffff" },
  { id: "#fde047", name: "Amarillo", value: "#fde047" },
  { id: "#fbbf24", name: "Ámbar", value: "#fbbf24" },
  { id: "#6ee7b7", name: "Menta", value: "#6ee7b7" },
  { id: "#7dd3fc", name: "Celeste", value: "#7dd3fc" },
  { id: "#f9a8d4", name: "Rosa", value: "#f9a8d4" },
  { id: "#c4b5fd", name: "Lila", value: "#c4b5fd" },
  { id: "#fdba74", name: "Naranja", value: "#fdba74" },
  { id: "#a3e635", name: "Lima", value: "#a3e635" },
];

// ─── Tipos ────────────────────────────────────────────────────────────────

type StyleId =
  | "silent" | "punch" | "hype" | "hype_max" | "hype_max_sfx" | "supreme"
  | "cinematic_pro"
  | "graphics_pro" | "graphics_max"
  | "motion_pro" | "motion_beat" | "motion_grid"
  | "editorial"
  | "kinetic_type" | "lottie_pop" | "paper_cut";
type PlatformId = "tiktok" | "instagram" | "linkedin" | "facebook";

interface RawVideoEntry {
  videoId: string;
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  hasTranscript: boolean;
  hasClean: boolean;
  hasProposals: boolean;
  clipsExtracted: number;
  rendersAvailable: number;
}

interface ListResponse {
  rawDir: string;
  videos: RawVideoEntry[];
  orphans: RawVideoEntry[];
}

interface JobStep {
  key: string;
  label: string;
  status: "pending" | "running" | "ok" | "fail" | "skipped";
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

interface JobState {
  id: string;
  videoId: string;
  videoPath: string;
  options: {
    model?: string;
    render: boolean;
    maxClips?: number;
    skipTranscribe?: boolean;
    useHeuristic?: boolean;
    styles?: string[];
    accentColor?: string;
    platforms?: string[];
    /** Tipo de corrida: "analyze" = solo encontrar momentos; "render-approved" = generar aprobados. */
    mode?: "full" | "analyze" | "render-approved";
  };
  startedAt: number;
  finishedAt?: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  overallProgress: number;
  steps: JobStep[];
  log: string[];
  clipsCount?: number;
}

interface IaLocalStatus {
  running: boolean;
  models: string[];
}

interface ProposalClip {
  index?: number;
  slug?: string;
  title?: string;
  hook?: string;
  theme?: string;
  keywords?: string[];
  start: number;
  end: number;
  duration?: number;
  viralityScore?: number;
  viralityReasons?: string[];
  /** Desglose 0-100 por factor (gancho/emoción/datos/ritmo/duración/CTA). Proposals viejos no lo traen. */
  factors?: Record<string, number>;
  /** Explicación corta de la IA local: por qué puede pegar + título sugerido. */
  whyViral?: string;
  /** Flujo REVISAR: false = descartado por el usuario (no se genera). Ausente = aprobado. */
  approved?: boolean;
}

interface ProposalsResponse {
  video_id?: string;
  clips: ProposalClip[];
  fallback_heuristic?: boolean;
}

// ─── Constantes (replica de wizard-client.tsx) ────────────────────────────

const STYLES: { id: StyleId; name: string; tagline: string; emoji: string }[] = [
  { id: "supreme", name: "Premium", tagline: "Todo activado, la máxima calidad. El mejor para largos.", emoji: "👑" },
  { id: "cinematic_pro", name: "Cinematográfico", tagline: "Look de cine: film grain, color teal&orange, viñeta y camera moves suaves.", emoji: "🎬" },
  { id: "silent", name: "Limpio", tagline: "Solo subtítulos, sin efectos. Sobrio y profesional.", emoji: "🤍" },
  { id: "punch", name: "Impacto", tagline: "Resalta las frases clave en los momentos importantes.", emoji: "🥊" },
  { id: "hype", name: "Viral", tagline: "Subtítulos grandes y dinámicos, estilo videos de YouTube.", emoji: "🔥" },
  { id: "hype_max", name: "Viral intenso", tagline: "Suma cortes rápidos y zooms de reacción. Más energía.", emoji: "⚡" },
  { id: "hype_max_sfx", name: "Viral con sonidos", tagline: "Lo más llamativo: efectos de sonido en los momentos clave.", emoji: "🎵" },
  { id: "graphics_pro", name: "Gráficos & Motion", tagline: "Charts + íconos + karaoke", emoji: "📊" },
  { id: "graphics_max", name: "Gráficos Max", tagline: "Gráficos + la edición más intensa", emoji: "📈" },
  { id: "motion_pro", name: "Motion Pro", tagline: "Animación pura y limpia, sin emojis", emoji: "✨" },
  { id: "motion_beat", name: "Motion Beat", tagline: "El fondo late con la música", emoji: "🎧" },
  { id: "motion_grid", name: "Motion Grid", tagline: "Retro-tech: cuadrícula + gráficas", emoji: "🌐" },
  { id: "editorial", name: "Editorial", tagline: "Documental: panel + titulares serif + line-art dorado", emoji: "📰" },
  { id: "kinetic_type", name: "Tipografía cinética", tagline: "Subtítulos gigantes + fondo que late, sin emojis", emoji: "⌨️" },
  { id: "lottie_pop", name: "Animado con stickers", tagline: "Stickers animados + íconos + fondo aurora", emoji: "✨" },
  { id: "paper_cut", name: "Papel recortado", tagline: "Collage editorial: panel de papel + titulares serif", emoji: "✂️" },
];

const PALETTE = [
  { name: "rosa coral", value: "#fb7185", mood: "urgencia" },
  { name: "violeta", value: "#a78bfa", mood: "autoridad" },
  { name: "amarillo", value: "#fbbf24", mood: "claridad" },
  { name: "emerald", value: "#34d399", mood: "crecimiento" },
  { name: "cyan", value: "#22d3ee", mood: "tech" },
  { name: "magenta", value: "#ec4899", mood: "intensidad" },
  { name: "naranja", value: "#fb923c", mood: "acción" },
  { name: "lime", value: "#a3e635", mood: "energía" },
  { name: "indigo", value: "#6366f1", mood: "IA" },
  { name: "violeta claro", value: "#c084fc", mood: "elegancia" },
];

const TOTAL_STEPS = 5;

/** Nombre humano de un estilo (nunca mostrar el id crudo tipo "hype_max_sfx"). */
function styleName(id: string): string {
  return STYLES.find((s) => s.id === id)?.name ?? id;
}

// Temas del estilo Editorial (paridad con el wizard de shorts): 4 clásicos +
// 13 sub-temas de clase mundial (Ola 3 — ver remotion/src/layers/editorial-themes.tsx).
const EDITORIAL_THEMES = [
  { id: "clasico", name: "Clásico", theme: "", font: "playfair", background: "dark", bg: "#0a0908", text: "#f3ede1", demoFont: "Georgia, serif" },
  { id: "tinta", name: "Tinta", theme: "", font: "dmserif", background: "ink", bg: "#0a0f16", text: "#e9eef5", demoFont: "'Times New Roman', serif" },
  { id: "crema", name: "Crema", theme: "", font: "lora", background: "cream", bg: "#f5efe3", text: "#1c1611", demoFont: "Georgia, serif" },
  { id: "bold", name: "Bold", theme: "", font: "abril", background: "dark", bg: "#0a0908", text: "#f3ede1", demoFont: "'Arial Black', serif" },
  { id: "prensa", name: "Prensa 1900", theme: "prensa", accent: "#8e2a1e", font: "playfair", background: "cream", bg: "#e8e1cf", text: "#1c1812", demoFont: "'Times New Roman', serif" },
  { id: "vogue", name: "Vogue noir", theme: "vogue", accent: "#c9a96a", font: "bodoni", background: "dark", bg: "#0c0b0a", text: "#f4f0e6", demoFont: "'Didot', 'Bodoni MT', serif" },
  { id: "kinfolk", name: "Kinfolk calma", theme: "kinfolk", accent: "#b06b4c", font: "lora", background: "cream", bg: "#f6f3ec", text: "#33302a", demoFont: "'Garamond', serif" },
  { id: "riso", name: "Zine riso", theme: "riso", accent: "#FF48B0", font: "abril", background: "cream", bg: "#f1ece0", text: "#141414", demoFont: "'Arial Black', sans-serif" },
  { id: "grabado", name: "Grabado", theme: "grabado", accent: "#8a6d3b", font: "playfair", background: "cream", bg: "#ece3cd", text: "#2a2118", demoFont: "'Book Antiqua', serif" },
  { id: "constructivista", name: "Constructivista", theme: "constructivista", accent: "#cf2618", font: "abril", background: "cream", bg: "#ece2cf", text: "#181613", demoFont: "'Arial Narrow', sans-serif" },
  { id: "bauhaus", name: "Bauhaus", theme: "bauhaus", accent: "#be1e2d", font: "lora", background: "cream", bg: "#f2e9d8", text: "#1f1d1a", demoFont: "'Century Gothic', sans-serif" },
  { id: "swiss", name: "Suizo grid", theme: "swiss", accent: "#e30613", font: "lora", background: "cream", bg: "#f4f4f1", text: "#0d0d0d", demoFont: "'Helvetica', 'Arial', sans-serif" },
  { id: "brutal", name: "Brutalista", theme: "brutal", accent: "#ff4d00", font: "lora", background: "cream", bg: "#efefea", text: "#000000", demoFont: "'Consolas', monospace" },
  { id: "mincho", name: "Japón mincho", theme: "mincho", accent: "#b3342c", font: "lora", background: "cream", bg: "#f5f3ed", text: "#26241f", demoFont: "'MS Mincho', serif" },
  { id: "stripe", name: "Stripe press", theme: "stripe", accent: "#635bff", font: "newsreader", background: "ink", bg: "#0a2540", text: "#f6f9fc", demoFont: "Georgia, serif" },
  { id: "docu", name: "Docu rojo", theme: "docu", accent: "#e3120b", font: "lora", background: "cream", bg: "#f9f7f1", text: "#121212", demoFont: "'Franklin Gothic Medium', sans-serif" },
  { id: "ft", name: "FT salmón", theme: "ft", accent: "#0d7680", font: "lora", background: "cream", bg: "#fff1e5", text: "#33302e", demoFont: "'Franklin Gothic Medium', sans-serif" },
  { id: "art_deco", name: "Art Déco", theme: "art_deco", accent: "#bd9a4e", font: "playfair", background: "cream", bg: "#f3ead6", text: "#16130d", demoFont: "'Cinzel', serif" },
  { id: "blueprint", name: "Blueprint", theme: "blueprint", accent: "#34c6d8", font: "dmserif", background: "ink", bg: "#0b2138", text: "#dbe9f4", demoFont: "'Consolas', monospace" },
  { id: "noir", name: "Noir", theme: "noir", accent: "#d8d2c4", font: "playfair", background: "dark", bg: "#0a0a0a", text: "#f2f2f0", demoFont: "'Playfair Display', serif" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Como fmtTime pero con décimas — para los steppers de ajuste fino (±0.5 s). */
function fmtTimeFine(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function fmtElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// ─── Componente ───────────────────────────────────────────────────────────

export function LongFormWizard() {
  // ─── State del listado + job ────────────────────────────────────────────
  const [list, setList] = useState<ListResponse | null>(null);
  // Multi-select: el wizard de largos también acepta varios videos.
  // La cola serial procesa de a uno; el JobView muestra el primero activo.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingList, setLoadingList] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingPath, setImportingPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeJob, setActiveJob] = useState<JobState | null>(null);
  const [proposals, setProposals] = useState<ProposalsResponse | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  // Semáforo de la IA local (modo inteligente): null = todavía no se chequeó.
  const [iaStatus, setIaStatus] = useState<IaLocalStatus | null>(null);
  const [checkingIa, setCheckingIa] = useState(false);
  // Flujo REVISAR: video cuyos momentos ya analizados se están revisando SIN job activo
  // (entrada directa desde el paso 5 cuando el análisis se hizo antes).
  const [reviewVideoId, setReviewVideoId] = useState<string | null>(null);

  // ─── State del wizard (6 pasos) ─────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [useHeuristic, setUseHeuristic] = useState(false); // default: modo inteligente (encuentra lo viral)
  const [graphicsMode, setGraphicsMode] = useState(false); // Modo Gráficos & Motion (charts + titulares)
  const [maxClips, setMaxClips] = useState<string>("");
  const [ollamaModel, setOllamaModel] = useState<string>("");
  const [skipTranscribe, setSkipTranscribe] = useState(false);
  const [selectedStyles, setSelectedStyles] = useState<StyleId[]>(["supreme"]);
  const [accent, setAccent] = useState<string>("#fb7185");
  // Fuente + color del TEXTO de subtítulos (paridad con el wizard de shorts).
  const [subtitleFont, setSubtitleFont] = useState<string>("auto");
  const [subtitleColor, setSubtitleColor] = useState<string>("auto");
  // Tema del estilo Editorial (fuente serif + fondo). Solo aplica si eliges 📰.
  const [editorialTheme, setEditorialTheme] = useState<string>("clasico");
  // 17 temas abruman: se muestran 8 y "Ver todos" despliega el resto (paridad shorts).
  const [showAllThemes, setShowAllThemes] = useState(false);
  // Redes fijas: los captions por red se generan SOLOS (visibles en /produccion).
  // Ya no hay botones de redes en el wizard.
  const selectedPlatforms: PlatformId[] = ["instagram", "linkedin"];
  const [doRender, setDoRender] = useState(true);
  // Aspect ratio. Para largos default 9:16 también (extract_clips hace center-crop si el source es 16:9).
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9">("9:16");
  // Face tracking: si el aspect cambia, ¿centrar el crop en la cara detectada?
  const [faceTracking, setFaceTracking] = useState<"off" | "single" | "per-frame">("single");

  const pollRef = useRef<number | null>(null);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/long_form/list");
      const data = (await r.json()) as ListResponse;
      setList(data);
      // Auto-seleccionar el primero si la lista está vacía (UX mejorada)
      if (selectedIds.size === 0 && data.videos.length > 0) {
        setSelectedIds(new Set([data.videos[0].videoId]));
      }
    } catch (err) {
      toastError(err, "No se pudo cargar la lista de videos");
    } finally {
      setLoadingList(false);
    }
  }, [selectedIds.size]);

  // Chequea si la IA local está prendida (para el semáforo del modo inteligente).
  const checkIaLocal = useCallback(async (): Promise<IaLocalStatus> => {
    setCheckingIa(true);
    try {
      const r = await fetch("/api/ollama/status");
      const data = (await r.json()) as Partial<IaLocalStatus>;
      const status: IaLocalStatus = {
        running: !!data.running,
        models: Array.isArray(data.models) ? data.models : [],
      };
      setIaStatus(status);
      return status;
    } catch {
      const status: IaLocalStatus = { running: false, models: [] };
      setIaStatus(status);
      return status;
    } finally {
      setCheckingIa(false);
    }
  }, []);

  function toggleVideo(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Sube videos largos desde la compu del usuario por STREAMING → /api/long_form/import → LF_RAW.
  // El File se manda como body crudo (no FormData): el server lo vuelca a disco por chunks
  // (memoria ≈ constante), así un video de varios GB entra por el botón normal sin OOM.
  // El nombre viaja en el header X-Filename (encodeURIComponent: soporta acentos/espacios).
  async function importVideos(files: FileList | File[]) {
    const arr = Array.from(files);
    setImporting(true);
    let ok = 0;
    try {
      for (const file of arr) {
        const r = await fetch("/api/long_form/import", {
          method: "POST",
          body: file,
          headers: { "X-Filename": encodeURIComponent(file.name) },
        });
        if (r.ok) {
          ok++;
        } else {
          // Mostrar el motivo real (ej. «video incompleto/corrupto, resúbelo»).
          // El server ya devuelve mensajes humanizados: se muestran tal cual.
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          toast.error(`No se pudo subir «${file.name}»`, {
            description: data.error || undefined,
          });
        }
      }
      if (ok > 0) toast.success(`${ok} video(s) subido(s) ✓`);
      await refreshList();
    } catch (err) {
      toastError(err, "No se pudo subir el video");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Importa un video grande YA en disco por su ruta (sin subir por HTTP).
  async function importByPath() {
    const p = pathInput.trim();
    if (!p) {
      toast.error("Pega la ruta del archivo (clic derecho → «Copiar como ruta de acceso»).");
      return;
    }
    setImportingPath(true);
    try {
      const r = await fetch("/api/long_form/import-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string; filename?: string };
      if (r.ok) {
        toast.success(`«${data.filename}» importado ✓`);
        setPathInput("");
        await refreshList();
      } else {
        // El server ya devuelve mensajes humanizados: se muestran tal cual.
        toast.error("No se pudo importar el video", { description: data.error || undefined });
      }
    } catch (err) {
      toastError(err, "No se pudo importar el video");
    } finally {
      setImportingPath(false);
    }
  }

  // Load on mount + tick cada 1s para "hace N segundos". Patrón válido.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshList();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [refreshList]);

  // Semáforo IA local: chequear al entrar al paso 2 con modo inteligente elegido
  // (y cada vez que el usuario vuelve a seleccionar ese modo).
  useEffect(() => {
    if (step === 2 && !useHeuristic) {
      // checkIaLocal hace setState al iniciar (semáforo "consultando"): es la carga
      // al entrar al paso 2, no un loop de render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      checkIaLocal();
    }
  }, [step, useHeuristic, checkIaLocal]);

  async function loadProposals(videoId: string) {
    try {
      const r = await fetch(`/api/long_form/proposals/${encodeURIComponent(videoId)}`);
      if (r.ok) {
        const data = (await r.json()) as ProposalsResponse;
        setProposals(data);
      }
    } catch {
      // ignore
    }
  }

  // Polling del job activo (también mientras espera en fila)
  useEffect(() => {
    const isLive = activeJob && (activeJob.status === "running" || activeJob.status === "queued");
    if (!isLive) {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/long_form/progress?jobId=${activeJob.id}`);
        if (!r.ok) return;
        const data = (await r.json()) as JobState;
        setActiveJob(data);
        if (data.status === "done") {
          loadProposals(data.videoId);
        }
      } catch {
        // ignore
      }
    }, 2500);
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeJob]);

  function toggleStyle(s: StyleId) {
    setSelectedStyles((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  /**
   * Arranca el pipeline.
   *   "analyze" → SOLO encuentra los momentos (flujo REVISAR, acto 1); al terminar
   *               se muestra el paso de revisión para aprobar/descartar/ajustar.
   *   "full"    → modo clásico de un jalón (fallback): analiza+recorta+genera todo.
   */
  async function startPipeline(runMode: "analyze" | "full" = "full") {
    if (selectedIds.size === 0) {
      toast.error("Elige al menos un video primero");
      return;
    }
    if (runMode === "full" && doRender && selectedStyles.length === 0) {
      toast.error("Elige al menos un estilo para generar los videos");
      return;
    }
    setSubmitting(true);
    setProposals(null);
    setReviewVideoId(null);
    const videoIds = Array.from(selectedIds);
    try {
      // Modo inteligente: verificar la IA local ANTES de arrancar. Mejor bloquear
      // aquí con un mensaje claro que dejar que el proceso falle a los 10 minutos.
      if (!useHeuristic) {
        const status = await checkIaLocal();
        if (!status.running) {
          toast.error("La IA local está apagada", {
            description:
              "Abre la app Ollama desde el menú Inicio, o usa el modo rápido.",
          });
          return;
        }
      }
      const body: Record<string, unknown> = {
        videoIds,
        mode: runMode,
        // En análisis no se genera nada: el render llega después, ya aprobados.
        render: runMode === "analyze" ? false : doRender,
        skipTranscribe,
        useHeuristic,
        graphicsMode,
        styles: selectedStyles,
        accentColor: accent,
        subtitleFont,
        subtitleColor,
        platforms: selectedPlatforms,
        aspectRatio,
        faceTracking,
      };
      if (maxClips.trim()) body.maxClips = parseInt(maxClips, 10);
      if (ollamaModel.trim()) body.model = ollamaModel.trim();
      if (selectedStyles.includes("editorial")) {
        const t = EDITORIAL_THEMES.find((x) => x.id === editorialTheme);
        if (t) body.editorialTheme = { font: t.font, background: t.background, theme: t.theme || undefined };
      }

      const r = await fetch("/api/long_form/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        // El server ya devuelve mensajes humanizados: se muestran tal cual.
        toast.error("No se pudo iniciar el procesamiento", {
          description: typeof data.error === "string" ? data.error : undefined,
        });
        return;
      }
      const jobIds: string[] = data.jobIds ?? (data.jobId ? [data.jobId] : []);
      if (jobIds.length === 0) throw new Error("no se encoló ningún proceso");
      if (jobIds.length > 1) {
        toast.success(`${jobIds.length} videos en fila — se procesan de uno en uno`);
      } else if (runMode === "analyze") {
        toast.success("Buscando los mejores momentos — al terminar los revisas antes de generar");
      } else {
        toast.success("Procesamiento iniciado — puedes seguir el avance aquí abajo");
      }
      // Mostrar el primer job en el JobView; los demás se ven en QueuePanel global.
      const jobRes = await fetch(`/api/long_form/progress?jobId=${jobIds[0]}`);
      const jobData = (await jobRes.json()) as JobState;
      setActiveJob(jobData);
    } catch (err) {
      toastError(err, "No se pudo iniciar el procesamiento");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Flujo REVISAR (acto 2): genera SOLO los momentos aprobados. `indices` son las
   * posiciones 0-based en el proposals JSON (estables: el backend no re-ordena).
   */
  async function startRenderApproved(videoId: string, indices: number[]) {
    if (indices.length === 0) {
      toast.error("Aprueba al menos un momento para generar");
      return;
    }
    if (doRender && selectedStyles.length === 0) {
      toast.error("Elige al menos un estilo para generar los videos");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        videoId,
        mode: "render-approved",
        clips: indices,
        render: doRender,
        useHeuristic,
        graphicsMode,
        styles: selectedStyles,
        accentColor: accent,
        subtitleFont,
        subtitleColor,
        platforms: selectedPlatforms,
        aspectRatio,
        faceTracking,
      };
      if (ollamaModel.trim()) body.model = ollamaModel.trim();
      if (selectedStyles.includes("editorial")) {
        const t = EDITORIAL_THEMES.find((x) => x.id === editorialTheme);
        if (t) body.editorialTheme = { font: t.font, background: t.background, theme: t.theme || undefined };
      }
      const r = await fetch("/api/long_form/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error("No se pudo iniciar la generación", {
          description: typeof data.error === "string" ? data.error : undefined,
        });
        return;
      }
      const jobIds: string[] = data.jobIds ?? (data.jobId ? [data.jobId] : []);
      if (jobIds.length === 0) throw new Error("no se encoló ningún proceso");
      toast.success(
        `Generando ${indices.length} clip${indices.length === 1 ? "" : "s"} aprobado${indices.length === 1 ? "" : "s"}`
      );
      setReviewVideoId(null);
      setProposals(null);
      const jobRes = await fetch(`/api/long_form/progress?jobId=${jobIds[0]}`);
      const jobData = (await jobRes.json()) as JobState;
      setActiveJob(jobData);
    } catch (err) {
      toastError(err, "No se pudo iniciar la generación");
    } finally {
      setSubmitting(false);
    }
  }

  /** Abre la revisión de momentos YA analizados antes (sin volver a correr nada). */
  async function openExistingReview(videoId: string) {
    try {
      const r = await fetch(`/api/long_form/proposals/${encodeURIComponent(videoId)}`);
      if (!r.ok) {
        toast.error("Todavía no hay momentos analizados para este video", {
          description: "Usa «Encontrar los mejores momentos» primero.",
        });
        return;
      }
      const data = (await r.json()) as ProposalsResponse;
      if (!data.clips || data.clips.length === 0) {
        toast.error("El análisis anterior no encontró momentos — vuelve a analizarlo");
        return;
      }
      setProposals(data);
      setReviewVideoId(videoId);
    } catch (err) {
      toastError(err, "No se pudieron cargar los momentos analizados");
    }
  }

  // Cancela el job activo: si está en fila lo saca de la cola; si corre, mata el proceso.
  async function cancelActiveJob() {
    if (!activeJob) return;
    setCancelling(true);
    try {
      const r = await fetch("/api/long_form/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.id }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "no se pudo cancelar");
      toast.success("Análisis cancelado");
      // Refrescar el estado para mostrar el panel "cancelado".
      const jr = await fetch(`/api/long_form/progress?jobId=${activeJob.id}`);
      if (jr.ok) setActiveJob((await jr.json()) as JobState);
    } catch (err) {
      toastError(err, "No se pudo cancelar el análisis");
    } finally {
      setCancelling(false);
    }
  }

  function cancelView() {
    setActiveJob(null);
    setProposals(null);
    setReviewVideoId(null);
    setStep(1);
    refreshList();
  }

  // Filtra los videos seleccionados; usamos el toggle "skipTranscribe" condicional
  // sólo cuando TODOS tienen transcript ya hecho.
  const selectedList = list?.videos.filter((v) => selectedIds.has(v.videoId)) ?? [];
  const allSelectedHaveTranscript = selectedList.length > 0 && selectedList.every((v) => v.hasTranscript);

  // Editorial no lleva subtítulos: su tipografía/colores vienen del tema. Si es el ÚNICO
  // estilo elegido, los selectores de texto de subtítulos no aplican y se ocultan.
  const hasEditorial = selectedStyles.includes("editorial");
  const editorialOnly = hasEditorial && selectedStyles.every((s) => s === "editorial");

  // ─── Render: si hay job activo, mostrar JobView (panel dedicado) ────────
  if (activeJob) {
    // Flujo REVISAR: cuando un análisis termina, en vez del panel "completado" se
    // muestra el paso de revisión (aprobar/descartar/ajustar antes de generar).
    const reviewClips =
      activeJob.status === "done" &&
      activeJob.options?.mode === "analyze" &&
      proposals?.clips &&
      proposals.clips.length > 0
        ? proposals.clips
        : null;
    return (
      <div className="space-y-6">
        <WizardHeader />
        {reviewClips ? (
          <ReviewView
            key={activeJob.id}
            videoId={activeJob.videoId}
            initialClips={reviewClips}
            fallbackHeuristic={!!proposals?.fallback_heuristic}
            willRender={doRender}
            generating={submitting}
            onGenerate={(indices) => startRenderApproved(activeJob.videoId, indices)}
            onClose={cancelView}
          />
        ) : (
          <JobView
            job={activeJob}
            now={now}
            proposals={proposals}
            onClose={cancelView}
            onCancel={cancelActiveJob}
            cancelling={cancelling}
          />
        )}
      </div>
    );
  }

  // ─── Render: revisión de momentos ya analizados (sin job corriendo) ──────
  if (reviewVideoId && proposals?.clips && proposals.clips.length > 0) {
    return (
      <div className="space-y-6">
        <WizardHeader />
        <ReviewView
          key={`review_${reviewVideoId}`}
          videoId={reviewVideoId}
          initialClips={proposals.clips}
          fallbackHeuristic={!!proposals.fallback_heuristic}
          willRender={doRender}
          generating={submitting}
          onGenerate={(indices) => startRenderApproved(reviewVideoId, indices)}
          onClose={cancelView}
        />
      </div>
    );
  }

  // ─── Render: wizard de 6 pasos ──────────────────────────────────────────
  return (
    <div className="space-y-6">
      <WizardHeader />

      {/* Stepper visual */}
      <div className="flex items-center gap-2 text-xs">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                step >= n
                  ? "border-violet-400 bg-violet-500/20 text-violet-300"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {step > n ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
            </div>
            {n < TOTAL_STEPS && (
              <div className={`h-px w-8 ${step > n ? "bg-violet-400" : "bg-border"}`} />
            )}
          </div>
        ))}
        <span className="ml-3 text-muted-foreground">
          Paso {step} de {TOTAL_STEPS}
        </span>
      </div>

      {/* STEP 1 — Videos (multi-select) */}
      {step === 1 && (
        <Card className="border-border bg-card p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">1. Elige los videos largos</h2>
            <div className="flex items-center gap-2">
              <span className="font-mono-tab text-[10px] text-muted-foreground">
                {selectedIds.size} seleccionado{selectedIds.size === 1 ? "" : "s"} · puedes elegir varios
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.mkv,.webm,.m4v,video/mp4,video/quicktime"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && e.target.files.length > 0 && importVideos(e.target.files)}
              />
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title="Subir uno o más videos largos desde tu computadora"
                className="bg-violet-500 text-white hover:bg-violet-400"
              >
                {importing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Subir desde mi compu
              </Button>
              <button
                type="button"
                onClick={refreshList}
                disabled={loadingList}
                className="flex items-center gap-1 rounded p-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {loadingList ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                Actualizar
              </button>
            </div>
          </div>

          {/* Importar por ruta — para videos GRANDES (cursos largos de varios GB). El
              navegador no puede subir archivos así por HTTP; aquí se importa directo del
              disco (la app corre en tu misma compu). */}
          <div className="mb-4 rounded-md border border-violet-500/25 bg-violet-500/5 p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-violet-200">¿Video grande (más de ~1.5 GB)?</span>{" "}
              No lo subas con el botón de arriba (se corta). En el Explorador haz clic
              derecho sobre el archivo → «Copiar como ruta de acceso», pégala aquí y se
              importa directo del disco.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") importByPath();
                }}
                placeholder="C:\Users\…\Downloads\clase.mp4"
                className="font-mono-tab text-xs"
              />
              <Button
                size="sm"
                onClick={importByPath}
                disabled={importingPath}
                className="shrink-0 bg-violet-500 text-white hover:bg-violet-400"
              >
                {importingPath ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="mr-1.5 h-4 w-4" />
                )}
                Importar por ruta
              </Button>
            </div>
          </div>

          {list && list.videos.length === 0 ? (
            <div className="space-y-3">
              <EmptyState
                icon={FolderOpen}
                tone="violet"
                title="Todavía no tienes videos largos"
                description="Sube un curso, charla o entrevista desde tu compu y el sistema lo recorta en clips virales."
                cta={{
                  label: importing ? "Subiendo…" : "Subir desde mi compu",
                  onClick: () => fileInputRef.current?.click(),
                }}
              />
              <details className="rounded-md border border-border bg-muted/20 p-3">
                <summary className="cursor-pointer font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
                  ¿Prefieres copiar el archivo a mano?
                </summary>
                <div className="mt-2">
                  <CopyableText label="Path para copiar tus videos" value={list.rawDir} />
                </div>
              </details>
            </div>
          ) : (
            <>
              {list && list.videos.length > 1 && (
                <div className="mb-3 flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(list.videos.map((v) => v.videoId)))}
                    className="rounded border border-border bg-muted/30 px-2 py-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Seleccionar todos ({list.videos.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    disabled={selectedIds.size === 0}
                    className="rounded border border-border bg-muted/30 px-2 py-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    Quitar selección
                  </button>
                </div>
              )}
              <div className="space-y-2">
                {list?.videos.map((v) => {
                  const sel = selectedIds.has(v.videoId);
                  return (
                    <button
                      key={v.videoId}
                      type="button"
                      onClick={() => toggleVideo(v.videoId)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                        sel
                          ? "border-violet-500/40 bg-violet-500/5 ring-1 ring-violet-400/40"
                          : "border-border bg-muted/30 hover:bg-muted"
                      )}
                    >
                      {/* Miniatura real del video (frame al 35%, cacheada). Si falla,
                          queda el ícono de respaldo. */}
                      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/videos/${encodeURIComponent(v.videoId)}/thumbnail?source=long_form`}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <FileVideo
                          className={cn(
                            "absolute left-1/2 top-1/2 -z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2",
                            sel ? "text-violet-300" : "text-muted-foreground"
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-mono-tab text-xs text-foreground">{v.filename}</p>
                        <p className="font-mono-tab text-[10px] text-muted-foreground">
                          {fmtBytes(v.sizeBytes)} · modificado{" "}
                          {new Date(v.modifiedAt).toLocaleString("es")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {/* Etiquetas en lenguaje simple (antes: jerga "transcript"/"clean") */}
                          <StatusPill ok={v.hasTranscript} label="texto" title="Lo que se dice en el video ya está convertido a texto" />
                          <StatusPill ok={v.hasClean} label="sin silencios" title="Ya se detectaron y marcaron los silencios para recortar" />
                          <StatusPill ok={v.hasProposals} label="momentos elegidos" title="La IA ya eligió los mejores momentos para los clips" />
                          <StatusPill ok={v.clipsExtracted > 0} label={`${v.clipsExtracted} clips`} title="Clips cortos ya recortados de este video" />
                          {v.rendersAvailable > 0 && (
                            <StatusPill ok label={`${v.rendersAvailable} videos listos`} color="violet" title="Clips ya editados, listos en Mis videos" />
                          )}
                        </div>
                      </div>
                      {sel && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-violet-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {list && list.orphans.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
              <p className="mb-2 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
                Largos procesados antes (video original eliminado pero clips disponibles)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {list.orphans.map((o) => (
                  <span
                    key={o.videoId}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono-tab text-[10px] text-muted-foreground"
                    title={`${o.clipsExtracted} clips · ${o.rendersAvailable} renders`}
                  >
                    {o.videoId} ({o.clipsExtracted}/{o.rendersAvailable})
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* STEP 2 — Modo de análisis */}
      {step === 2 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">2. ¿Cómo encontrar los clips icónicos?</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            El paso de análisis decide qué momentos del video se convierten en clips de 30-60 seg.
          </p>

          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={() => setUseHeuristic(true)}
              className={cn(
                "rounded-lg border p-4 text-left transition-all",
                useHeuristic
                  ? "border-amber-500/40 bg-amber-500/5 ring-1 ring-amber-400/40"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">⚡</span>
                <span className="font-medium">Modo rápido — bloques parejos</span>
                {useHeuristic && <CheckCircle2 className="h-4 w-4 text-amber-400" />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Corta bloques de ~50 segundos espaciados parejo por el video (minuto 0, 10, 20…).{" "}
                <strong className="text-foreground">~minutos</strong>. NO lee qué se dice — no elige por
                viralidad. Útil solo para tener material rápido.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setUseHeuristic(false)}
              className={cn(
                "rounded-lg border p-4 text-left transition-all",
                !useHeuristic
                  ? "border-brand-violet/40 bg-brand-violet/5 ring-1 ring-brand-violet/40"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">🧠</span>
                <span className="font-medium">Modo inteligente — encuentra lo más viral</span>
                <span className="rounded bg-brand-violet/20 px-1.5 py-0.5 text-[9px] font-medium text-brand-violet">RECOMENDADO</span>
                {!useHeuristic && <CheckCircle2 className="h-4 w-4 text-brand-violet" />}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Transcribe el video en trozos (sin colgarse, aunque dure 90 min) y la IA local lee TODO
                para elegir los momentos más virales — <strong className="text-foreground">mínimo 15 clips, más si hay</strong> —
                con hook + caption + hashtags listos. <strong className="text-foreground">~30-50 min</strong> en segundo plano.
              </p>
              {/* Semáforo de la IA local: se chequea al seleccionar este modo. */}
              <div className="mt-2">
                {checkingIa && iaStatus === null ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[10px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Revisando la IA local…
                  </span>
                ) : iaStatus?.running ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
                    ✓ IA local lista
                  </span>
                ) : iaStatus ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-medium text-red-300">
                    <XCircle className="h-3 w-3 shrink-0" />
                    La IA local está apagada — abre la app Ollama desde el menú Inicio, o usa el modo rápido
                  </span>
                ) : null}
              </div>
            </button>

            {/* Semáforo en rojo → reparación automática con un clic (despierta/instala
                la IA local y baja el modelo, con barra de progreso). */}
            {!useHeuristic && iaStatus && !iaStatus.running && (
              <IaFixPanel onReady={checkIaLocal} />
            )}
          </div>

          {!useHeuristic && (
            <details className="mt-4 rounded-md border border-border bg-muted/20 p-3">
              <summary className="cursor-pointer font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
                ⚙️ Avanzado (opcional — el default funciona solo)
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">
                    Modelo de IA local <span className="text-muted-foreground">(Ollama)</span>
                  </Label>
                  <Input
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    placeholder="automático (qwen3:1.7b)"
                    className="font-mono-tab"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Cantidad máxima de clips
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={maxClips}
                    onChange={(e) => setMaxClips(e.target.value)}
                    placeholder="automático: mínimo 15, más si el video es largo"
                    className="font-mono-tab"
                  />
                </div>
              </div>
            </details>
          )}

          {allSelectedHaveTranscript && (
            <label className="mt-4 flex items-start gap-3 cursor-pointer rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
              <input
                type="checkbox"
                checked={skipTranscribe}
                onChange={(e) => setSkipTranscribe(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border bg-muted accent-sky-500"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-sky-200">
                  Saltar la transcripción ({selectedIds.size === 1 ? "ya existe" : "todos los seleccionados ya la tienen"})
                </p>
                <p className="text-xs text-muted-foreground">Ahorra 3-10 min por video.</p>
              </div>
            </label>
          )}
        </Card>
      )}

      {/* STEP 3 — Estilos + Aspect ratio */}
      {step === 3 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">3. Estilo(s) de edición y formato</h2>

          {/* Modo Gráficos & Motion — opt-in, aditivo sobre el estilo elegido */}
          <button
            type="button"
            onClick={() => setGraphicsMode((v) => !v)}
            className={cn(
              "mb-5 w-full rounded-lg border p-4 text-left transition-all",
              graphicsMode
                ? "border-fuchsia-500/50 bg-fuchsia-500/5 ring-1 ring-fuchsia-400/40"
                : "border-border hover:border-foreground/30"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">📊</span>
              <span className="font-medium">Modo Gráficos &amp; Motion</span>
              <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] font-medium text-fuchsia-300">
                NUEVO
              </span>
              {graphicsMode && <CheckCircle2 className="ml-auto h-4 w-4 text-fuchsia-400" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Suma gráficas animadas (contador, barras, línea, dona) y titulares poderosos
              (glitch, shimmer, draw-on…) generados <strong className="text-foreground">automáticamente</strong>{" "}
              desde lo que se dice en cada clip. Las gráficas solo aparecen cuando hay datos reales
              (%, &ldquo;3 veces&rdquo;, &ldquo;de 23 a 78&rdquo;). Se combina con el estilo que elijas abajo.
            </p>
          </button>

          {/* Aspect ratio toggle */}
          <div className="mb-5">
            <p className="mb-2 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
              Formato de salida (si tu video no coincide, se aplica un recorte centrado automático)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAspectRatio("9:16")}
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3 transition-all",
                  aspectRatio === "9:16"
                    ? "border-violet-400 ring-1 ring-violet-400 bg-violet-500/5"
                    : "border-border hover:border-foreground/30"
                )}
              >
                <div className="flex h-10 w-6 items-center justify-center rounded-sm border-2 border-current text-violet-300 shrink-0">
                  <span className="text-[8px]">9:16</span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">Vertical 9:16</p>
                  <p className="font-mono-tab text-[10px] text-muted-foreground">
                    TikTok · Reels · Stories
                  </p>
                </div>
                {aspectRatio === "9:16" && <CheckCircle2 className="ml-auto h-4 w-4 text-violet-400" />}
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio("16:9")}
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3 transition-all",
                  aspectRatio === "16:9"
                    ? "border-violet-400 ring-1 ring-violet-400 bg-violet-500/5"
                    : "border-border hover:border-foreground/30"
                )}
              >
                <div className="flex h-6 w-10 items-center justify-center rounded-sm border-2 border-current text-violet-300 shrink-0">
                  <span className="text-[8px]">16:9</span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">Horizontal 16:9</p>
                  <p className="font-mono-tab text-[10px] text-muted-foreground">
                    LinkedIn · YouTube · cursos
                  </p>
                </div>
                {aspectRatio === "16:9" && <CheckCircle2 className="ml-auto h-4 w-4 text-violet-400" />}
              </button>
            </div>

            {/* Face tracking — solo útil si el aspect cambia respecto al source */}
            <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="mb-2 font-mono-tab text-[10px] uppercase tracking-wider text-amber-300">
                Encuadre inteligente (seguir la cara)
              </p>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Si tu video no coincide con el formato elegido, ¿centrar el recorte en la cara
                detectada en vez del recorte centrado automático?
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setFaceTracking("off")}
                  className={cn(
                    "rounded-md border p-2 text-left transition-all",
                    faceTracking === "off"
                      ? "border-foreground/40 bg-foreground/5"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  <p className="text-xs font-medium">Apagado</p>
                  <p className="font-mono-tab text-[9px] text-muted-foreground">Recorta el centro (puede cortar caras)</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFaceTracking("single")}
                  className={cn(
                    "rounded-md border p-2 text-left transition-all",
                    faceTracking === "single"
                      ? "border-amber-400/40 bg-amber-500/10"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  <p className="text-xs font-medium">Sencillo (recomendado)</p>
                  <p className="font-mono-tab text-[9px] text-muted-foreground">Encuadra la cara una vez (~1 s por clip)</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFaceTracking("per-frame")}
                  className={cn(
                    "rounded-md border p-2 text-left transition-all",
                    faceTracking === "per-frame"
                      ? "border-amber-400/40 bg-amber-500/10"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  <p className="text-xs font-medium">Preciso</p>
                  <p className="font-mono-tab text-[9px] text-muted-foreground">Sigue la cara todo el tiempo (~5-10 s por clip)</p>
                </button>
              </div>
            </div>
          </div>

          <p className="mb-4 text-xs text-muted-foreground">
            Cada estilo seleccionado genera un MP4 por clip. Si eliges 2 estilos y se recortan 5 clips,
            se generan 10 archivos.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STYLES.map((s) => {
              const sel = selectedStyles.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStyle(s.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-all",
                    sel
                      ? "border-violet-400 ring-1 ring-violet-400 bg-violet-500/5"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  {/* Mini-demo EN MOVIMIENTO del estilo: se entiende sin leer. */}
                  <StyleMiniDemo styleId={s.id} accent={accent} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      {sel && <CheckCircle2 className="h-4 w-4 text-violet-400" />}
                    </div>
                    <p className="text-xs text-muted-foreground">{s.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
          {/* Tema editorial: aparece solo si elegiste 📰 Editorial (paridad con shorts). */}
          {hasEditorial && (
            <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="mb-2 text-sm font-medium">📰 Tema del estilo Editorial</p>
              {/* 17 temas sin abrumar: primero los 8 favoritos, el resto detrás de
                  "Ver todos" (paridad con el wizard de shorts). */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(showAllThemes ? EDITORIAL_THEMES : EDITORIAL_THEMES.slice(0, 8)).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setEditorialTheme(t.id);
                      // Sub-temas con identidad fuerte: sugerir su acento.
                      if ("accent" in t && t.accent) setAccent(t.accent);
                    }}
                    className={cn(
                      "overflow-hidden rounded-lg border text-left transition-all",
                      editorialTheme === t.id
                        ? "border-amber-400 ring-1 ring-amber-400"
                        : "border-border hover:border-foreground/30"
                    )}
                  >
                    {/* mini-preview del tema: fondo + serif + acento */}
                    <div className="flex h-14 flex-col justify-center overflow-hidden px-2" style={{ background: t.bg }}>
                      <span className="truncate text-[7px] uppercase tracking-[0.3em]" style={{ color: t.text, opacity: 0.5 }}>
                        La verdad
                      </span>
                      <span className="truncate text-sm font-bold leading-tight" style={{ color: t.text, fontFamily: t.demoFont }}>
                        Título <em style={{ color: accent }}>clave.</em>
                      </span>
                    </div>
                    <div className="truncate px-2 py-1 text-[10px] text-muted-foreground">{t.name}</div>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowAllThemes((v) => !v)}
                className="mt-2 w-full rounded-md border border-border/60 py-1.5 text-xs text-muted-foreground transition hover:border-amber-400/50 hover:text-foreground"
              >
                {showAllThemes
                  ? "▲ Ver menos temas"
                  : `▼ Ver todos los temas (${EDITORIAL_THEMES.length})`}
              </button>
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            {selectedStyles.length === 0
              ? "Selecciona al menos uno"
              : `${selectedStyles.length} estilo${selectedStyles.length === 1 ? "" : "s"} seleccionado${selectedStyles.length === 1 ? "" : "s"}`}
          </p>

          <label className="mt-4 flex items-start gap-3 cursor-pointer rounded-md border border-border bg-muted/20 p-3">
            <input
              type="checkbox"
              checked={doRender}
              onChange={(e) => setDoRender(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border bg-muted accent-brand-violet"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">Generar los videos al terminar de recortar</p>
              <p className="text-xs text-muted-foreground">
                Si lo apagas, solo se recortan los clips sin editar. Puedes generar los videos
                después desde Mis videos.
              </p>
            </div>
          </label>
        </Card>
      )}

      {/* STEP 4 — Color + tipografía de subtítulos */}
      {step === 4 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">4. Color principal</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {editorialOnly
              ? "En el estilo Editorial este color pinta las palabras destacadas de los titulares y las ilustraciones animadas."
              : "Un solo color para todos los clips del lote (subtítulos highlight, stickers, vignette, border)."}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PALETTE.map((c) => {
              const sel = accent === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setAccent(c.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-3 transition-all",
                    sel ? "border-foreground" : "border-border hover:border-foreground/30"
                  )}
                >
                  <div
                    className="h-12 w-12 rounded-full"
                    style={{
                      background: c.value,
                      boxShadow: sel ? `0 0 24px ${c.value}66` : "none",
                    }}
                  />
                  <span className="text-xs font-medium">{c.name}</span>
                  <span className="font-mono-tab text-[10px] text-muted-foreground">{c.mood}</span>
                </button>
              );
            })}
          </div>

          {/* Editorial-solo: la tipografía/colores vienen del TEMA elegido en el paso 3. */}
          {editorialOnly && (
            <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium">📰 El estilo Editorial no lleva subtítulos</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Usa titulares serif gigantes con la tipografía y el fondo del tema que elegiste
                en el paso anterior. Por eso aquí no hay nada más que configurar: solo el color
                principal de arriba.
              </p>
            </div>
          )}

          {!editorialOnly && (
            <>
          {hasEditorial && (
            <p className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              📰 Lo de abajo no afecta al estilo Editorial (usa la tipografía de su tema); solo
              aplica a los demás estilos elegidos.
            </p>
          )}
          {/* Color del TEXTO de los subtítulos (paridad con el wizard de shorts) */}
          <h3 className="mb-2 mt-6 text-sm font-medium">Color del texto de los subtítulos</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            El color de las palabras (el resaltado usa el color principal de arriba).
            &quot;Automático&quot; usa el del estilo.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SUBTITLE_COLORS.map((c) => {
              const sel = subtitleColor === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSubtitleColor(c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 transition-all",
                    sel
                      ? "border-foreground bg-muted/40 ring-1 ring-foreground/30"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  <span
                    className="flex h-8 w-10 items-center justify-center rounded bg-zinc-950 text-sm font-black uppercase"
                    style={{ color: c.value, textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
                  >
                    {c.id === "auto" ? "Aa" : "Abc"}
                  </span>
                  <span className="text-xs font-medium">{c.name}</span>
                </button>
              );
            })}
          </div>

          {/* Preview en vivo: color + resaltado + fuente elegidos. */}
          <div className="mt-4 flex items-center justify-center rounded-lg bg-zinc-950 px-4 py-5">
            <span
              className="text-3xl font-black uppercase tracking-wide"
              style={{
                color: subtitleColor === "auto" ? "#ffffff" : subtitleColor,
                fontFamily: FONT_PREVIEW[subtitleFont] || undefined,
                textShadow: "0 2px 8px rgba(0,0,0,0.9)",
              }}
            >
              Así se ven{" "}
              <span style={{ color: accent, textShadow: `0 0 18px ${accent}88` }}>tus</span>{" "}
              clips
            </span>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-medium">Tipografía de los subtítulos</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            &quot;Automática&quot; usa la del estilo. La miniatura muestra cada fuente real.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {SUBTITLE_FONTS.map((f) => {
              const sel = subtitleFont === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSubtitleFont(f.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 transition-all",
                    sel
                      ? "border-foreground bg-muted/40 ring-1 ring-foreground/30"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  <span
                    className="text-2xl leading-none"
                    style={{ fontFamily: FONT_PREVIEW[f.id] || undefined }}
                  >
                    {f.id === "auto" ? "Aa" : "Viral"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{f.name}</span>
                </button>
              );
            })}
          </div>
            </>
          )}
        </Card>
      )}

      {/* STEP 5 — Redes + confirmar + arrancar */}
      {step === 5 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">5. Confirmar y arrancar</h2>

          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
            <p className="mb-2 font-medium">Resumen</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                · Video{selectedIds.size === 1 ? "" : "s"} ({selectedIds.size}):{" "}
                <span className="font-mono-tab text-foreground">
                  {Array.from(selectedIds).slice(0, 3).join(", ")}
                  {selectedIds.size > 3 && ` +${selectedIds.size - 3} más`}
                </span>
              </li>
              <li>· Modo: <span className="text-foreground">{useHeuristic ? "Rápido (bloques parejos, sin IA)" : "Inteligente (la IA local encuentra lo viral, mínimo 15 clips)"}</span>
                {!useHeuristic && ollamaModel && <span className="text-muted-foreground"> · modelo {ollamaModel}</span>}
              </li>
              <li>· Generar videos: <span className="text-foreground">{doRender ? "sí" : "no (solo recortar clips)"}</span></li>
              {doRender && (
                <>
                  <li>· Estilo{selectedStyles.length === 1 ? "" : "s"}: <span className="text-foreground">{selectedStyles.map(styleName).join(", ")}</span></li>
                  <li>
                    · Formato:{" "}
                    <span className="text-foreground">
                      {aspectRatio === "9:16" ? "Vertical 9:16 (1080×1920)" : "Horizontal 16:9 (1920×1080)"}
                    </span>
                  </li>
                  <li>· Color: <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: accent }} />{" "}
                    <span className="font-mono-tab text-foreground">{accent}</span>
                  </li>
                  {!editorialOnly && (
                    <li>
                      · Subtítulos:{" "}
                      <span className="text-foreground">
                        {SUBTITLE_FONTS.find((f) => f.id === subtitleFont)?.name ?? subtitleFont}
                        {subtitleColor !== "auto" && (
                          <>
                            {" · texto "}
                            <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: subtitleColor }} />{" "}
                            <span className="font-mono-tab">{subtitleColor}</span>
                          </>
                        )}
                      </span>
                    </li>
                  )}
                  {hasEditorial && (
                    <li>
                      · Tema editorial:{" "}
                      <span className="text-foreground">
                        {EDITORIAL_THEMES.find((t) => t.id === editorialTheme)?.name ?? editorialTheme}
                      </span>
                    </li>
                  )}
                </>
              )}
              {maxClips && <li>· Máximo de clips: <span className="text-foreground">{maxClips}</span></li>}
              {/* Estimado HONESTO: rango según el modo (la duración del video no está
                  disponible en /api/long_form/list, así que se habla en rangos). */}
              <li className="text-amber-400">
                {useHeuristic ? (
                  <>
                    Estimado: encontrar los momentos tarda unos minutos. Después los revisas
                    {doRender && <> y cada clip que apruebes tarda ~2-3 min en generarse</>}{" "}
                    (depende de tu compu). Puedes cerrar esta pantalla, sigue solo.
                  </>
                ) : (
                  <>
                    Estimado: análisis ~30-50 min para un video de 1 hora (puedes cerrar esta
                    pantalla, sigue solo). Después revisas los momentos
                    {doRender && (
                      <>
                        {" "}y cada clip que apruebes tarda ~2-3 min (propone{" "}
                        {maxClips.trim() ? `hasta ${maxClips.trim()}` : "mínimo 15"})
                      </>
                    )}
                    .
                  </>
                )}
              </li>
            </ul>
          </div>

          {/* Acto 1 del flujo REVISAR: primero solo el análisis; al terminar se
              muestran los momentos para aprobar/descartar/ajustar antes de generar. */}
          <Button
            onClick={() => startPipeline("analyze")}
            disabled={submitting || selectedIds.size === 0}
            className="mt-4 w-full bg-violet-500 hover:bg-violet-400 text-white"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <span className="mr-2">🔍</span>
            )}
            {submitting ? "Arrancando…" : "Encontrar los mejores momentos"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Primero el análisis. Al terminar revisas los momentos propuestos y eliges
            cuáles generar — nada se genera sin tu visto bueno.
          </p>

          {/* Entrada directa a la revisión si este video ya se analizó antes. */}
          {selectedIds.size === 1 && selectedList[0]?.hasProposals && (
            <Button
              variant="outline"
              onClick={() => openExistingReview(selectedList[0].videoId)}
              disabled={submitting}
              className="mt-3 w-full"
            >
              🔁 Revisar los momentos ya encontrados (sin volver a analizar)
            </Button>
          )}

          {/* Fallback: el modo clásico de un jalón (analiza + recorta + genera todo). */}
          <button
            type="button"
            onClick={() => startPipeline("full")}
            disabled={
              submitting ||
              selectedIds.size === 0 ||
              (doRender && selectedStyles.length === 0)
            }
            className="mt-3 w-full rounded-md border border-border py-2 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
          >
            <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
            Hacer todo de una vez sin revisar (modo clásico)
          </button>
        </Card>
      )}

      {/* Navegación */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          // Sin render, el paso 4 (color/tipografía) no aplica: se salta en ambos sentidos.
          onClick={() => setStep(step === 5 && !doRender ? 3 : Math.max(1, step - 1))}
          disabled={step === 1 || submitting}
        >
          <ChevronLeft className="mr-1.5 h-4 w-4" />
          Atrás
        </Button>
        {step < TOTAL_STEPS && (
          <Button
            onClick={() => setStep(step === 3 && !doRender ? 5 : step + 1)}
            disabled={
              (step === 1 && selectedIds.size === 0) ||
              (step === 3 && doRender && selectedStyles.length === 0)
            }
          >
            Siguiente
            <ChevronRight className="ml-1.5 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────

function WizardHeader() {
  return (
    <SectionHeader
      eyebrow="Videos largos → clips cortos"
      title="De un video largo a varios clips virales"
      description="Sube un video largo (un curso, charla o entrevista) y el sistema encuentra los mejores momentos de tu video (15 o más en modo inteligente) y los recorta en clips de 30 a 60 segundos, con el estilo que elijas."
      color={SECTION_COLORS.largos}
    />
  );
}

function StatusPill({
  ok,
  label,
  color,
  title,
}: {
  ok: boolean;
  label: string;
  color?: "emerald" | "violet";
  /** Tooltip en lenguaje simple: qué significa este estado. */
  title?: string;
}) {
  const colorClass = !ok
    ? "bg-muted text-muted-foreground"
    : color === "violet"
      ? "bg-violet-500/20 text-violet-300"
      : "bg-emerald-500/20 text-emerald-300";
  return (
    <span
      title={title}
      className={cn(
        "rounded px-1.5 py-0.5 font-mono-tab text-[9px] uppercase tracking-wider",
        colorClass
      )}
    >
      {ok ? "✓" : "·"} {label}
    </span>
  );
}

function CopyableText({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono-tab">
        {label}
      </Label>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
        <code className="flex-1 font-mono-tab text-xs text-foreground break-all">{value}</code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success(`${label} copiado`);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-brand-violet"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function JobView({
  job,
  now,
  proposals,
  onClose,
  onCancel,
  cancelling,
}: {
  job: JobState;
  now: number;
  proposals: ProposalsResponse | null;
  onClose: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const elapsed = (job.finishedAt ?? now) - job.startedAt;
  const isLive = job.status === "running" || job.status === "queued";
  // Confirmación propia del botón Cancelar (dos pasos, sin window.confirm).
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Flujo REVISAR: en una corrida de aprobados solo se generaron los clips con
  // approved !== false — el panel final no muestra los descartados.
  const doneClips = proposals?.clips
    ? job.options?.mode === "render-approved"
      ? proposals.clips.filter((c) => c.approved !== false)
      : proposals.clips
    : null;

  return (
    <Card className="border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">
            Procesando <span className="font-mono-tab text-violet-400">{job.videoId}</span>
          </h2>
          <p className="font-mono-tab text-[10px] text-muted-foreground">
            <Clock className="inline h-3 w-3" /> {fmtElapsed(elapsed)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {job.status === "queued" && (
            <span className="flex items-center gap-1.5 rounded bg-sky-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-sky-300">
              <Clock className="h-3 w-3" />
              en fila
            </span>
          )}
          {job.status === "running" && (
            <span className="flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-amber-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              en proceso
            </span>
          )}
          {job.status === "done" && (
            <span className="flex items-center gap-1.5 rounded bg-emerald-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />
              completado
            </span>
          )}
          {job.status === "failed" && (
            <span className="flex items-center gap-1.5 rounded bg-red-500/20 px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-red-300">
              <XCircle className="h-3 w-3" />
              falló
            </span>
          )}
          {job.status === "cancelled" && (
            <span className="flex items-center gap-1.5 rounded bg-muted px-2 py-1 font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
              <XCircle className="h-3 w-3" />
              cancelado
            </span>
          )}
          {/* Cancelar: siempre visible mientras corre o espera en fila. */}
          {isLive && !confirmCancel && (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              disabled={cancelling}
              className="flex items-center gap-1.5 rounded border border-red-500/40 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cerrar y volver
          </button>
        </div>
      </div>

      {isLive && confirmCancel && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs font-medium text-red-200">
            ¿Cancelar el análisis? El avance se pierde.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmCancel(false);
                onCancel();
              }}
              disabled={cancelling}
              className="rounded bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-400 disabled:opacity-50"
            >
              Sí, cancelar
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="rounded border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              No, seguir
            </button>
          </div>
        </div>
      )}

      <div className="mb-5 space-y-1">
        <div className="flex items-center justify-between font-mono-tab text-[10px] text-muted-foreground">
          <span>Progreso global</span>
          <span>{job.overallProgress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full transition-all duration-500",
              job.status === "failed"
                ? "bg-red-500"
                : job.status === "cancelled"
                  ? "bg-muted-foreground/40"
                  : job.status === "done"
                    ? "bg-emerald-500"
                    : "bg-amber-500"
            )}
            style={{ width: `${job.overallProgress}%` }}
          />
        </div>
      </div>

      <ol className="space-y-2.5">
        {job.steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-3">
            <StepIcon status={step.status} index={i + 1} />
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm",
                  step.status === "running" && "text-foreground font-medium",
                  step.status === "ok" && "text-foreground",
                  step.status === "skipped" && "text-muted-foreground italic",
                  step.status === "pending" && "text-muted-foreground",
                  step.status === "fail" && "text-red-300"
                )}
              >
                {step.label}
              </p>
              {step.message && (
                <p className="font-mono-tab text-[10px] text-muted-foreground">{step.message}</p>
              )}
              {step.startedAt && step.finishedAt && (
                <p className="font-mono-tab text-[10px] text-muted-foreground">
                  {fmtElapsed(step.finishedAt - step.startedAt)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <details className="mt-5 rounded-md border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
          Detalle del proceso{job.log.length > 0 && ` (${job.log.length} líneas)`}
        </summary>
        {/* El identificador técnico vive aquí, colapsado — no en el encabezado. */}
        <p className="mt-2 font-mono-tab text-[10px] text-muted-foreground">
          id técnico: {job.id}
        </p>
        {job.log.length > 0 && (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono-tab text-[10px] text-foreground/70">
            {job.log.slice(-30).join("\n")}
          </pre>
        )}
      </details>

      {job.status === "done" && proposals && doneClips && (
        <div className="mt-5 space-y-3">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              {doneClips.length} clips generados
              {job.clipsCount != null && ` (${job.clipsCount} recortados bien)`}
              {proposals.fallback_heuristic && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono-tab text-[9px] text-amber-300">
                  modo rápido
                </span>
              )}
            </p>
            <p className="mt-1 font-mono-tab text-[10px] text-muted-foreground">
              {job.options?.render
                ? `Videos generados con estilo(s): ${(job.options.styles ?? []).map(styleName).join(", ")} — listos para publicar desde Mis videos.`
                : "Sin video final — abre Mis videos para generarlo."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {doneClips.slice(0, 12).map((c, i) => (
              <ProposalClipCard key={c.index ?? i + 1} clip={c} idx={c.index ?? i + 1} videoId={job.videoId} />
            ))}
          </div>

          <Link
            href="/produccion"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-gradient px-4 text-sm font-medium text-white hover:opacity-90"
          >
            <Play className="h-3.5 w-3.5" />
            Abrir Mis videos para ver y publicar
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {job.status === "failed" && (
        <div className="mt-5 rounded-md border border-red-500/30 bg-red-500/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-red-200">
            <XCircle className="h-4 w-4" />
            El procesamiento falló
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Causas comunes: la IA local está apagada (ábrela desde el menú Inicio), el video
            no tiene voz, o el archivo está dañado. El detalle está arriba, en «Detalle del proceso».
          </p>
        </div>
      )}

      {job.status === "cancelled" && (
        <div className="mt-5 rounded-md border border-border bg-muted/20 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <XCircle className="h-4 w-4 text-muted-foreground" />
            Análisis cancelado
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cancelado por ti. Puedes volver a empezar cuando quieras con «Cerrar y volver».
          </p>
        </div>
      )}
    </Card>
  );
}

// ─── Paso "Revisa los momentos" (flujo REVISAR antes de generar) ──────────
// Grid de tarjetas con los momentos propuestos: todas aprobadas por default,
// toggle aprobar/descartar, ajuste fino inicio/fin (±0.5 s) que persiste con
// PATCH, y el botón que genera SOLO los aprobados.

function ReviewView({
  videoId,
  initialClips,
  fallbackHeuristic,
  willRender,
  generating,
  onGenerate,
  onClose,
}: {
  videoId: string;
  initialClips: ProposalClip[];
  fallbackHeuristic: boolean;
  /** false = solo se recortan los clips, sin generar el video editado. */
  willRender: boolean;
  generating: boolean;
  onGenerate: (indices: number[]) => void;
  onClose: () => void;
}) {
  // Copia de trabajo: todas aprobadas por default (approved ausente = aprobado).
  const [clips, setClips] = useState<ProposalClip[]>(() =>
    initialClips.map((c) => ({ ...c, approved: c.approved !== false }))
  );
  // Solo una tarjeta con el panel de ajuste abierto a la vez.
  const [adjustingIdx, setAdjustingIdx] = useState<number | null>(null);
  // Ajustes pendientes de persistir (debounce: PATCH "al soltar" los steppers).
  const pendingPatch = useRef<Map<number, { start: number; end: number }>>(new Map());
  const patchTimer = useRef<number | null>(null);

  const sendPatch = useCallback(
    async (items: { index: number; approved?: boolean; start?: number; end?: number }[]) => {
      try {
        const r = await fetch(`/api/long_form/proposals/${encodeURIComponent(videoId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clips: items }),
        });
        if (!r.ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
      } catch (err) {
        toastError(err, "No se pudo guardar el cambio del clip");
      }
    },
    [videoId]
  );

  const flushPatch = useCallback(() => {
    if (patchTimer.current != null) {
      window.clearTimeout(patchTimer.current);
      patchTimer.current = null;
    }
    if (pendingPatch.current.size === 0) return;
    const items = Array.from(pendingPatch.current.entries()).map(([index, v]) => ({
      index,
      start: v.start,
      end: v.end,
    }));
    pendingPatch.current.clear();
    void sendPatch(items);
  }, [sendPatch]);

  // Al desmontar (p.ej. arranca la generación) no se pierde ningún ajuste pendiente.
  useEffect(() => flushPatch, [flushPatch]);

  function toggleApproved(i: number) {
    const cur = clips[i];
    const newApproved = cur.approved === false; // descartado → aprobar; aprobado → descartar
    const next = [...clips];
    next[i] = { ...cur, approved: newApproved };
    setClips(next);
    void sendPatch([{ index: i, approved: newApproved }]);
  }

  function adjustClip(i: number, which: "start" | "end", delta: number) {
    const c = clips[i];
    let start = c.start;
    let end = c.end;
    if (which === "start") start = Math.max(0, Math.round((start + delta) * 2) / 2);
    else end = Math.round((end + delta) * 2) / 2;
    const dur = end - start;
    // Mismos límites que el backend: inicio antes del fin, duración 5-180 s.
    if (start >= end || dur < 5 || dur > 180) return;
    const next = [...clips];
    next[i] = { ...c, start, end, duration: dur };
    setClips(next);
    pendingPatch.current.set(i, { start, end });
    if (patchTimer.current != null) window.clearTimeout(patchTimer.current);
    patchTimer.current = window.setTimeout(flushPatch, 600);
  }

  const approvedIndices = clips
    .map((c, i) => (c.approved !== false ? i : -1))
    .filter((i) => i >= 0);
  const n = approvedIndices.length;

  return (
    <Card className="border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">
            Revisa los momentos de <span className="font-mono-tab text-violet-400">{videoId}</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Todos vienen aprobados. Descarta los que no te gusten o ajusta dónde empieza y
            termina cada uno — nada se genera hasta que tú lo apruebes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fallbackHeuristic && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono-tab text-[9px] text-amber-300">
              modo rápido
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Cerrar y volver
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {clips.map((c, i) => (
          <ProposalClipCard
            key={`${videoId}_${i}`}
            clip={c}
            idx={c.index ?? i + 1}
            videoId={videoId}
            review={{
              approved: c.approved !== false,
              onToggle: () => toggleApproved(i),
              adjusting: adjustingIdx === i,
              onToggleAdjust: () => {
                if (adjustingIdx === i) {
                  // Al cerrar el panel se persiste lo pendiente (PATCH al cerrar).
                  flushPatch();
                  setAdjustingIdx(null);
                } else {
                  flushPatch();
                  setAdjustingIdx(i);
                }
              },
              onAdjust: (which, delta) => adjustClip(i, which, delta),
            }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-violet-500/25 bg-violet-500/5 p-3">
        <p className="text-sm">
          Se generar{n === 1 ? "á" : "án"}{" "}
          <span className="font-semibold text-violet-300">{n}</span> clip{n === 1 ? "" : "s"}
          {willRender && n > 0 && (
            <span className="text-muted-foreground"> · ~{n * 2}-{n * 3} min</span>
          )}
          {!willRender && (
            <span className="text-muted-foreground"> (solo recorte, sin video editado)</span>
          )}
        </p>
        <Button
          onClick={() => {
            flushPatch();
            onGenerate(approvedIndices);
          }}
          disabled={generating || n === 0}
          className="bg-violet-500 text-white hover:bg-violet-400"
        >
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {generating ? "Arrancando…" : `✨ Generar los ${n} aprobados`}
        </Button>
      </div>
      {n === 0 && (
        <p className="mt-2 text-center text-[11px] text-amber-300">
          Descartaste todos los momentos — aprueba al menos uno para poder generar.
        </p>
      )}
    </Card>
  );
}

// ─── Semáforo IA: reparación automática con un clic ───────────────────────
// Cablea el contrato POST/GET /api/ollama/setup (lo construye otro flujo):
//   POST {action:"auto"} arranca en background (despertar exe → instalar → bajar modelo)
//   GET → {phase, pct?, detail?} con phase idle|starting|installing|downloading_model|ready|error
// Mientras esas rutas no existan (404), se muestra la instrucción manual.

const FIX_PHASE_LABELS: Record<string, string> = {
  idle: "Preparando…",
  starting: "Despertando la IA local…",
  installing: "Instalando la IA local…",
  downloading_model: "Descargando el modelo de IA (puede tardar varios minutos)…",
};

function IaFixPanel({ onReady }: { onReady: () => void }) {
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  // true = la reparación automática no está disponible o falló → instrucción manual.
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Limpieza al desmontar (cambiar de paso/modo no deja el polling vivo).
  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/ollama/setup");
      if (r.status === 404) {
        // La ruta todavía no existe: caer al camino manual sin romper nada.
        stopPolling();
        setWorking(false);
        setFailed(true);
        return;
      }
      if (!r.ok) return; // error pasajero: se reintenta en el siguiente tick
      const d = (await r.json()) as { phase?: string; pct?: number; detail?: string };
      setPhase(d.phase ?? null);
      setPct(typeof d.pct === "number" ? d.pct : null);
      setDetail(typeof d.detail === "string" ? d.detail : null);
      if (d.phase === "ready") {
        stopPolling();
        setWorking(false);
        toast.success("La IA local quedó lista ✓");
        onReady();
      } else if (d.phase === "error") {
        stopPolling();
        setWorking(false);
        setFailed(true);
      }
    } catch {
      // red caída momentánea: el siguiente tick reintenta
    }
  }, [onReady, stopPolling]);

  async function startFix() {
    setFailed(false);
    setPhase(null);
    setPct(null);
    setDetail(null);
    setWorking(true);
    try {
      const r = await fetch("/api/ollama/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto" }),
      });
      if (r.status === 404) {
        // Reparación automática no disponible todavía → instrucción manual.
        setWorking(false);
        setFailed(true);
        return;
      }
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      // Polling cada 2 s hasta ready/error.
      stopPolling();
      timerRef.current = window.setInterval(() => void poll(), 2000);
      void poll();
    } catch (err) {
      setWorking(false);
      setFailed(true);
      toastError(err, "No se pudo arrancar la reparación de la IA local");
    }
  }

  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
      {!working && !failed && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            ¿No quieres lidiar con esto? Se puede arreglar solo: despierta la IA local,
            la instala si falta y descarga el modelo.
          </p>
          <Button size="sm" onClick={startFix} className="shrink-0 bg-red-500/80 text-white hover:bg-red-400">
            🛠️ Arreglarlo por mí
          </Button>
        </div>
      )}

      {working && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs text-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {FIX_PHASE_LABELS[phase ?? "idle"] ?? "Trabajando…"}
            {pct != null && <span className="font-mono-tab text-muted-foreground">{Math.round(pct)}%</span>}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full bg-brand-violet transition-all duration-700",
                pct == null && "w-1/3 animate-pulse"
              )}
              style={pct != null ? { width: `${Math.max(2, Math.min(100, pct))}%` } : undefined}
            />
          </div>
          {detail && <p className="font-mono-tab text-[10px] text-muted-foreground">{detail}</p>}
        </div>
      )}

      {failed && (
        <p className="text-xs text-red-200">
          No se pudo arreglar en automático{detail ? ` (${detail})` : ""}. Hazlo a mano:
          descarga e instala la app desde{" "}
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline hover:text-red-100"
          >
            ollama.com/download
          </a>
          , ábrela y vuelve a intentar.{" "}
          <button type="button" onClick={startFix} className="underline hover:text-red-100">
            Reintentar
          </button>
        </p>
      )}
    </div>
  );
}

// Etiquetas humanas (mexicano) de los factores del score viral — espejo de
// python/virality.py: hook/emotion/data/pace/length/cta.
const FACTOR_LABELS: { key: string; label: string }[] = [
  { key: "hook", label: "Gancho" },
  { key: "emotion", label: "Emoción" },
  { key: "data", label: "Datos concretos" },
  { key: "pace", label: "Ritmo" },
  { key: "length", label: "Duración ideal" },
  { key: "cta", label: "Llamado a la acción" },
];

/** Controles extra cuando la tarjeta está en el paso "Revisa los momentos". */
interface ReviewControls {
  approved: boolean;
  onToggle: () => void;
  /** ¿Está abierto el panel de ajuste fino (steppers inicio/fin)? */
  adjusting: boolean;
  onToggleAdjust: () => void;
  /** Mueve inicio o fin en ±0.5 s (el padre valida límites y persiste con PATCH). */
  onAdjust: (which: "start" | "end", delta: number) => void;
}

function ProposalClipCard({
  clip: c,
  idx,
  videoId,
  review,
}: {
  clip: ProposalClip;
  idx: number;
  videoId: string;
  /** Presente solo en el paso de revisión: aprobar/descartar + ajustar inicio/fin. */
  review?: ReviewControls;
}) {
  // "¿Por qué este clip?" — el badge 🔥 se expande solo si el proposal trae el
  // desglose de factores (los viejos no lo tienen y el badge queda como antes).
  const [open, setOpen] = useState(false);
  const score = c.viralityScore;
  const factorRows = c.factors
    ? FACTOR_LABELS.filter((f) => typeof c.factors?.[f.key] === "number")
    : [];
  const expandable = typeof score === "number" && factorRows.length > 0;
  const badgeStyle =
    typeof score === "number"
      ? {
          background: score >= 70 ? "#10b98122" : score >= 45 ? "#f59e0b22" : "#71717a22",
          color: score >= 70 ? "#34d399" : score >= 45 ? "#fbbf24" : "#a1a1aa",
        }
      : undefined;

  // En revisión la miniatura usa t con resolución de medio segundo para que el src
  // cambie con cada clic del stepper (el server cachea por segundo redondeado, así
  // que el frame visible se refresca al cruzar cada segundo).
  const thumbT = review
    ? Math.max(0, Math.round(c.start * 2) / 2)
    : Math.max(0, Math.round(c.start));
  const duration = c.end - c.start;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/30 p-3 transition-opacity",
        review && !review.approved && "opacity-45"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Miniatura del momento exacto donde arranca el clip (frame en t=inicio). */}
        <div className="relative h-16 w-10 shrink-0 overflow-hidden rounded border border-border bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={thumbT}
            src={`/api/videos/${encodeURIComponent(videoId)}/thumbnail?source=long_form&t=${thumbT}`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <FileVideo className="absolute left-1/2 top-1/2 -z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 font-mono-tab text-[10px] text-violet-300">
          c{idx.toString().padStart(2, "0")}
        </span>
        {typeof score === "number" &&
          (expandable ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title={`Potencial viral: ${score}/100 — ¿Por qué este clip? Haz clic para ver el desglose`}
              className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-mono-tab text-[10px] font-semibold transition-all hover:brightness-125"
              style={badgeStyle}
            >
              🔥 {score}
              <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")} />
            </button>
          ) : (
            <span
              title={`Potencial viral: ${score}/100${c.viralityReasons?.length ? " — " + c.viralityReasons.join(" · ") : ""}`}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono-tab text-[10px] font-semibold"
              style={badgeStyle}
            >
              🔥 {score}
            </span>
          ))}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium">
            {c.title || c.slug || `Clip ${idx}`}
          </p>
          <p className="font-mono-tab text-[10px] text-muted-foreground">
            {fmtTime(c.start)} → {fmtTime(c.end)}
            {c.duration && ` · ${Math.round(c.duration)}s`}
          </p>
          {c.hook && (
            <p className="mt-1 text-[11px] text-foreground/80">
              <Sparkles className="mr-1 inline h-2.5 w-2.5 text-amber-400" />
              {c.hook}
            </p>
          )}
          {c.viralityReasons && c.viralityReasons.length > 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {c.viralityReasons.join(" · ")}
            </p>
          )}
        </div>
      </div>

      {expandable && open && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          <p className="font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
            ¿Por qué este clip?
          </p>
          {factorRows.map((f) => {
            const v = Math.max(0, Math.min(100, Math.round(c.factors![f.key])));
            return (
              <div key={f.key} className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-[10px] text-muted-foreground">{f.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${v}%`,
                      background: v >= 70 ? "#34d399" : v >= 45 ? "#fbbf24" : "#71717a",
                    }}
                  />
                </div>
                <span className="w-7 shrink-0 text-right font-mono-tab text-[10px] text-muted-foreground">
                  {v}
                </span>
              </div>
            );
          })}
          {c.whyViral && (
            <p className="pt-1 text-[11px] italic text-foreground/80">
              <Sparkles className="mr-1 inline h-3 w-3 text-amber-400" />
              {c.whyViral}
            </p>
          )}
        </div>
      )}

      {/* ── Controles de revisión: aprobar/descartar + ajuste fino inicio/fin ── */}
      {review && (
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
          <button
            type="button"
            onClick={review.onToggle}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
              review.approved
                ? "bg-brand-violet/20 text-brand-violet hover:bg-brand-violet/30"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
            title={review.approved ? "Este clip SÍ se genera — clic para descartarlo" : "Descartado — clic para volver a incluirlo"}
          >
            {review.approved ? (
              <>
                <CheckCircle2 className="h-3 w-3" /> Se genera
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3" /> Descartado
              </>
            )}
          </button>
          <button
            type="button"
            onClick={review.onToggleAdjust}
            className={cn(
              "ml-auto flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors",
              review.adjusting
                ? "border-violet-400/50 bg-violet-500/10 text-violet-300"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Scissors className="h-3 w-3" />
            Ajustar
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", review.adjusting && "rotate-180")} />
          </button>
        </div>
      )}

      {review?.adjusting && (
        <div className="mt-2 space-y-2 rounded-md border border-violet-500/25 bg-violet-500/5 p-2.5">
          <TimeStepper
            label="Inicio"
            value={c.start}
            onStep={(d) => review.onAdjust("start", d)}
            disableMinus={c.start <= 0 || duration + 0.5 > 180}
            disablePlus={duration - 0.5 < 5}
          />
          <TimeStepper
            label="Fin"
            value={c.end}
            onStep={(d) => review.onAdjust("end", d)}
            disableMinus={duration - 0.5 < 5}
            disablePlus={duration + 0.5 > 180}
          />
          <p className="text-center font-mono-tab text-[10px] text-muted-foreground">
            Duración resultante:{" "}
            <span className="font-semibold text-foreground">{(Math.round(duration * 10) / 10).toFixed(1)} s</span>
            {" "}(entre 5 y 180 s)
          </p>
        </div>
      )}
    </div>
  );
}

/** Stepper ±0.5 s para ajustar inicio/fin de un momento en la revisión. */
function TimeStepper({
  label,
  value,
  onStep,
  disableMinus,
  disablePlus,
}: {
  label: string;
  value: number;
  onStep: (delta: number) => void;
  disableMinus?: boolean;
  disablePlus?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={() => onStep(-0.5)}
        disabled={disableMinus}
        className="rounded border border-border px-2 py-0.5 font-mono-tab text-[11px] text-foreground hover:bg-muted disabled:opacity-30"
        title={`Mover el ${label.toLowerCase()} 0.5 s hacia atrás`}
      >
        −0.5 s
      </button>
      <span className="flex-1 text-center font-mono-tab text-xs text-foreground">{fmtTimeFine(value)}</span>
      <button
        type="button"
        onClick={() => onStep(0.5)}
        disabled={disablePlus}
        className="rounded border border-border px-2 py-0.5 font-mono-tab text-[11px] text-foreground hover:bg-muted disabled:opacity-30"
        title={`Mover el ${label.toLowerCase()} 0.5 s hacia adelante`}
      >
        +0.5 s
      </button>
    </div>
  );
}

function StepIcon({ status, index }: { status: JobStep["status"]; index: number }) {
  if (status === "ok")
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black">
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "fail")
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
        <XCircle className="h-3.5 w-3.5" />
      </span>
    );
  if (status === "running")
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-black">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  if (status === "skipped")
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-muted-foreground text-[10px]">
        <Scissors className="h-3 w-3" />
      </span>
    );
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-muted-foreground text-muted-foreground text-xs font-mono-tab">
      {index}
    </span>
  );
}
