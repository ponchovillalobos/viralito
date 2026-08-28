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
  Download,
  Loader2,
  Play,
  Clapperboard,
  RefreshCcw,
  Scissors,
  Sparkles,
  Trash2,
  XCircle,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { StyleMiniDemo } from "@/components/editor/wizard/style-mini-demo";
import { StyleMotionPreview } from "@/components/editor/wizard/style-motion-preview";
import { BrandKitPicker } from "@/components/editor/wizard/brand-kit-picker";

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

// Segunda copia a mano del catálogo que también se quedó atrás (ver la nota en
// `wizard-client.tsx`). Ésta traía `editorial_full` pero le faltaban otros; la de
// shorts traía otros pero no `editorial_full`. Dos listas escritas a mano derivan
// en direcciones distintas: eso es lo que hace que el problema sea estructural y
// no un descuido. El tipo ahora viene del registro para las dos.
import type { StyleId } from "@/lib/style-registry";
import type { BrollSource } from "@/lib/pexels";
import { BROLL_STYLE_IDS } from "@/lib/broll-sources";
import { BrollSourcePicker } from "@/components/editor/wizard/broll-source-picker";
import { EDITORIAL_THEMES } from "@/lib/editorial-themes";
import { BrollPositionPicker, type BrollPosition } from "@/components/editor/wizard/broll-position-picker";
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
    /** Tipo de corrida: "analyze" = solo encontrar momentos; "render-approved" = generar aprobados; "highlights" = 1 video de mejores momentos. */
    mode?: "full" | "analyze" | "render-approved" | "highlights";
  };
  startedAt: number;
  finishedAt?: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  overallProgress: number;
  steps: JobStep[];
  log: string[];
  clipsCount?: number;
  /** Request original persistido — permite REANUDAR el trabajo con un clic
   *  (el pipeline salta lo ya hecho: transcript/clips/renders existentes). */
  request?: Record<string, unknown>;
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

// Estilos que usan imagenes de apoyo. Del modulo compartido, no copiados: los
// dos asistentes ya tuvieron su propia copia del catalogo de estilos una vez, y
// las copias derivaron hasta dejar dos estilos sin puerta de entrada.
const BROLL_STYLES: StyleId[] = [...BROLL_STYLE_IDS];

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
  { id: "editorial_full", name: "Editorial pantalla completa", tagline: "El video original COMPLETO (sin recortar) + tipografía editorial encima. Para 16:9: mantiene tu formato horizontal", emoji: "🖥️" },
  { id: "editorial_broll", name: "Editorial con archivo", tagline: "Editorial + videos de archivo (Pexels) que ilustran lo que dices", emoji: "🎞️" },
  { id: "kinetic_type", name: "Tipografía cinética", tagline: "Subtítulos gigantes + fondo que late, sin emojis", emoji: "⌨️" },
  { id: "lottie_pop", name: "Animado con stickers", tagline: "Stickers animados + íconos + fondo aurora", emoji: "✨" },
  { id: "paper_cut", name: "Papel recortado", tagline: "Collage editorial: panel de papel + titulares serif", emoji: "✂️" },
  { id: "cine_clasico", name: "Cine clásico", tagline: "Cine antiguo: en los momentos dramáticos la voz suena a radio vieja y la imagen se vuelve B&N", emoji: "🎞️" },
  { id: "vhs", name: "VHS Retro", tagline: "Cámara de los 90: grano, scanlines, ► PLAY con contador y glitch de tracking — se siente grabado en cinta", emoji: "📼" },
  { id: "audiogram", name: "Audiograma", tagline: "Clip de podcast: una onda de barras baila con la voz del clip + el nombre de tu show. Ideal para entrevistas y episodios.", emoji: "🎙️" },
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

const TOTAL_STEPS = 4;

/** Nombre humano de un estilo (nunca mostrar el id crudo tipo "hype_max_sfx"). */
function styleName(id: string): string {
  return STYLES.find((s) => s.id === id)?.name ?? id;
}

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
  // Progreso visible del upload ("Subiendo 52 de 120 MB") — antes solo giraba el spinner.
  const [uploadProgress, setUploadProgress] = useState<{
    name: string;
    pct: number;
    doneMB: number;
    totalMB: number;
  } | null>(null);
  const [pathInput, setPathInput] = useState("");
  // Traer de YouTube. Mismo destino que subir o importar por ruta, asi que a
  // partir de ahi el pipeline es identico: no hay un "camino de YouTube" aparte.
  const [urlInput, setUrlInput] = useState("");
  const [bajandoUrl, setBajandoUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeJob, setActiveJob] = useState<JobState | null>(null);
  const [proposals, setProposals] = useState<ProposalsResponse | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  // Semáforo de la IA local (modo inteligente): null = todavía no se chequeó.
  const [iaStatus, setIaStatus] = useState<IaLocalStatus | null>(null);
  const [checkingIa, setCheckingIa] = useState(false);
  // Flujo REVISAR: video cuyos momentos ya analizados se están revisando SIN job activo
  // (entrada directa desde el paso 5 cuando el análisis se hizo antes).
  const [reviewVideoId, setReviewVideoId] = useState<string | null>(null);
  // Borrado de un video largo: guarda el que se va a borrar (abre el Dialog de
  // confirmación) y el flag mientras corre el DELETE.
  const [videoToDelete, setVideoToDelete] = useState<RawVideoEntry | null>(null);
  const [deletingVideo, setDeletingVideo] = useState(false);

  // ─── State del wizard (4 pasos) ─────────────────────────────────────────
  const [step, setStep] = useState(1);
  // El análisis SIEMPRE es inteligente (la IA local lee todo y encuentra lo viral).
  // Cortar sin análisis no sirve, así que ya no hay paso para elegir el modo: la
  // constante se sigue mandando al backend como `false` (= modo inteligente).
  const useHeuristic = false;
  const graphicsMode = false; // toggle quitado del wizard (redundante con graphics_pro/max)
  const [maxClips, setMaxClips] = useState<string>("");
  const [ollamaModel, setOllamaModel] = useState<string>("");
  const [skipTranscribe, setSkipTranscribe] = useState(false);
  const [selectedStyles, setSelectedStyles] = useState<StyleId[]>(["supreme"]);
  const [accent, setAccent] = useState<string>("#fb7185");
  // Fuente + color del TEXTO de subtítulos (paridad con el wizard de shorts).
  const [subtitleFont, setSubtitleFont] = useState<string>("auto");
  const [subtitleColor, setSubtitleColor] = useState<string>("auto");
  // Volumen de música 0–100% (factor sobre el del estilo). 100 = sin override; bajalo
  // para que la música no tape el audio original del video.
  const [musicVolumePct, setMusicVolumePct] = useState<number>(100);
  // Preview de audio: la barra sola no se oye → un <audio> compartido toca un sample al
  // volumen elegido y se actualiza EN VIVO al mover la barra (pedido del usuario).
  const volAudioRef = useRef<HTMLAudioElement | null>(null);
  const [volTracks, setVolTracks] = useState<string[]>([]);
  const [volPreviewOn, setVolPreviewOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/music/list")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.tracks)) {
          setVolTracks(
            d.tracks.filter((t: { url?: string }) => t.url).map((t: { url: string }) => t.url)
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (volAudioRef.current) {
      volAudioRef.current.volume = Math.max(0, Math.min(1, musicVolumePct / 100));
    }
  }, [musicVolumePct]);
  function toggleVolPreview() {
    const a = volAudioRef.current;
    if (!a) return;
    if (volPreviewOn) {
      a.pause(); // onPause limpia volPreviewOn
      return;
    }
    if (volTracks.length === 0) {
      // Antes fallaba en silencio: el botón no hacía nada y el usuario no sabía por qué.
      toast.error("No hay pistas de música para probar el volumen", {
        description: "Revisa tu biblioteca de música en el editor.",
      });
      return;
    }
    a.src = volTracks[Math.floor(volTracks.length / 2)] ?? volTracks[0];
    a.volume = Math.max(0, Math.min(1, musicVolumePct / 100));
    a.currentTime = 0;
    a.play().then(() => setVolPreviewOn(true)).catch(() => {});
  }
  // Tema del estilo Editorial (fuente serif + fondo). Solo aplica si eliges 📰.
  const [editorialTheme, setEditorialTheme] = useState<string>("clasico");
  const [brollSources, setBrollSources] = useState<BrollSource[]>(["auto"]);
  // Donde aparece el material. `auto` = lo decide la forma, como siempre.
  const [brollPosition, setBrollPosition] = useState<BrollPosition>("auto");
  // 17 temas abruman: se muestran 8 y "Ver todos" despliega el resto (paridad shorts).
  const [showAllThemes, setShowAllThemes] = useState(false);
  // "Ver ejemplo": estilo cuya expansión de escenas (miniaturas reales) está abierta.
  const [exampleStyle, setExampleStyle] = useState<string | null>(null);
  // Redes fijas: los captions por red se generan SOLOS (visibles en /produccion).
  // Ya no hay botones de redes en el wizard.
  const selectedPlatforms: PlatformId[] = ["instagram", "linkedin"];
  // Casilla quitada del wizard: SIEMPRE se generan los videos (constante true).
  // Para solo-recortar está el modo "revisar momentos antes".
  const doRender = true;
  // Aspect ratio. Para largos default 9:16 también (extract_clips hace center-crop si el source es 16:9).
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9">("9:16");
  // Face tracking: si el aspect cambia, ¿seguir la cara detectada al recortar?
  // Default "per-frame": sigue al que habla cuadro a cuadro (no se sale del recuadro
  // si se mueve). "single" centra una vez (rápido pero estático).
  const faceTracking: "off" | "single" | "per-frame" = "per-frame"; // casilla quitada; default fijo (sigue la cara)

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

  // Borra DEFINITIVO un video largo + sus clips/renders/transcripts del disco y
  // refresca la lista. Lo dispara el Dialog de confirmación (acción destructiva).
  async function deleteVideo(videoId: string) {
    setDeletingVideo(true);
    try {
      const r = await fetch(`/api/long_form/${encodeURIComponent(videoId)}/delete`, {
        method: "POST",
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "no se pudo borrar");
      toast.success("Video borrado");
      // Quitar de la selección si estaba elegido.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
      setVideoToDelete(null);
      await refreshList();
    } catch (err) {
      toastError(err, "No se pudo borrar el video");
    } finally {
      setDeletingVideo(false);
    }
  }

  // Sube videos largos desde la compu del usuario por STREAMING → /api/long_form/import → LF_RAW.
  // El File se manda como body crudo (no FormData): el server lo vuelca a disco por chunks
  // (memoria ≈ constante), así un video de varios GB entra por el botón normal sin OOM.
  // El nombre viaja en el header X-Filename (encodeURIComponent: soporta acentos/espacios).
  // XMLHttpRequest (no fetch) porque fetch NO expone progreso de subida: acá sale
  // el "Subiendo X de Y MB" en vivo. El body sigue siendo el File crudo (streaming).
  function uploadWithProgress(file: File): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/long_form/import");
      xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setUploadProgress({
          name: file.name,
          pct: Math.min(100, Math.round((e.loaded / e.total) * 100)),
          doneMB: Math.round(e.loaded / 1048576),
          totalMB: Math.max(1, Math.round(e.total / 1048576)),
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ ok: true });
          return;
        }
        let error: string | undefined;
        try {
          error = (JSON.parse(xhr.responseText) as { error?: string }).error;
        } catch {
          /* respuesta no-JSON */
        }
        resolve({ ok: false, error });
      };
      xhr.onerror = () => resolve({ ok: false });
      xhr.send(file);
    });
  }

  async function importVideos(files: FileList | File[]) {
    const arr = Array.from(files);
    setImporting(true);
    let ok = 0;
    try {
      for (const file of arr) {
        const r = await uploadWithProgress(file);
        if (r.ok) {
          ok++;
        } else {
          // Mostrar el motivo real (ej. «video incompleto/corrupto, resúbelo»).
          // El server ya devuelve mensajes humanizados: se muestran tal cual.
          toast.error(`No se pudo subir «${file.name}»`, {
            description: r.error || undefined,
          });
        }
      }
      if (ok > 0) toast.success(`${ok} video(s) subido(s) ✓`);
      await refreshList();
    } catch (err) {
      toastError(err, "No se pudo subir el video");
    } finally {
      setImporting(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Importa un video grande YA en disco por su ruta (sin subir por HTTP).
  async function bajarDeUrl() {
    const u = urlInput.trim();
    if (!u) {
      toast.error("Pegá el enlace del video de YouTube.");
      return;
    }
    setBajandoUrl(true);
    const aviso = toast.loading("Bajando el video… puede tardar unos minutos.");
    try {
      const r = await fetch("/api/videos/descargar-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, flujo: "largo" }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string; pista?: string; id?: string; duracion_s?: number; sugerencia?: string;
      };
      if (r.ok) {
        const min = Math.round((data.duracion_s ?? 0) / 60);
        toast.success(`«${data.id}» listo ✓`, {
          id: aviso,
          // Si lo bajado es corto, se DICE — no se cambia de flujo por su
          // cuenta: quien pidio largo puede querer largo igual.
          description:
            data.sugerencia === "corto"
              ? `Dura ${min} min: para algo tan corto suele ir mejor el flujo de un solo video.`
              : `${min} min de video.`,
        });
        setUrlInput("");
        await refreshList();
      } else {
        toast.error("No se pudo bajar el video", {
          id: aviso,
          description: [data.error, data.pista].filter(Boolean).join(" — ") || undefined,
        });
      }
    } catch (err) {
      toast.dismiss(aviso);
      toastError(err, "No se pudo bajar el video");
    } finally {
      setBajandoUrl(false);
    }
  }

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

  // Semáforo IA local: el análisis SIEMPRE es inteligente (usa la IA local), así que
  // chequeamos al entrar al paso de confirmar (último paso) para avisar si Ollama está
  // apagado antes de arrancar. startPipeline también revalida antes de lanzar.
  useEffect(() => {
    if (step === TOTAL_STEPS) {
      // checkIaLocal hace setState al iniciar (semáforo "consultando"): es la carga
      // al entrar al paso de confirmar, no un loop de render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      checkIaLocal();
    }
  }, [step, checkIaLocal]);

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
  async function startPipeline(runMode: "analyze" | "full" | "highlights" = "full") {
    if (selectedIds.size === 0) {
      toast.error("Elige al menos un video primero");
      return;
    }
    if (runMode === "full" && doRender && selectedStyles.length === 0) {
      toast.error("Elige al menos un estilo para generar los videos");
      return;
    }
    if (runMode === "highlights" && selectedStyles.length === 0) {
      toast.error("Elige un estilo para tu video de mejores momentos");
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
        // En análisis no se genera nada; en mejores momentos SIEMPRE se arma el video.
        render: runMode === "analyze" ? false : runMode === "highlights" ? true : doRender,
        skipTranscribe,
        useHeuristic,
        graphicsMode,
        styles: selectedStyles,
        accentColor: accent,
        subtitleFont,
        subtitleColor,
        musicVolume: musicVolumePct / 100,
        platforms: selectedPlatforms,
        aspectRatio,
        faceTracking,
      };
      if (maxClips.trim()) body.maxClips = parseInt(maxClips, 10);
      if (ollamaModel.trim()) body.model = ollamaModel.trim();
      if (selectedStyles.some((s) => s === "editorial" || s === "editorial_broll" || s === "editorial_full")) {
        const t = EDITORIAL_THEMES.find((x) => x.id === editorialTheme);
        if (t) body.editorialTheme = { font: t.font, background: t.background, theme: t.theme || undefined };
      }
      // Solo viaja si se eligio algo: "auto" deja el resultado identico al de antes.
      if (
        brollSources.length &&
        !brollSources.includes("auto") &&
        selectedStyles.some((x) => BROLL_STYLES.includes(x))
      ) {
        body.brollSource = brollSources;
      }
      // Donde aparece el material. "auto" no viaja: es el default de siempre.
      // Va en LOS DOS caminos de envio (modo completo y modo analisis): dejarlo
      // en uno solo haria que el mismo wizard diera resultados distintos segun
      // por que boton se salio.
      if (brollPosition !== "auto") {
        body.brollPosition = brollPosition;
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
        musicVolume: musicVolumePct / 100,
        platforms: selectedPlatforms,
        aspectRatio,
        faceTracking,
      };
      if (ollamaModel.trim()) body.model = ollamaModel.trim();
      if (selectedStyles.some((s) => s === "editorial" || s === "editorial_broll" || s === "editorial_full")) {
        const t = EDITORIAL_THEMES.find((x) => x.id === editorialTheme);
        if (t) body.editorialTheme = { font: t.font, background: t.background, theme: t.theme || undefined };
      }
      // Solo viaja si se eligio algo: "auto" deja el resultado identico al de antes.
      if (
        brollSources.length &&
        !brollSources.includes("auto") &&
        selectedStyles.some((x) => BROLL_STYLES.includes(x))
      ) {
        body.brollSource = brollSources;
      }
      // Donde aparece el material. "auto" no viaja: es el default de siempre.
      // Va en LOS DOS caminos de envio (modo completo y modo analisis): dejarlo
      // en uno solo haria que el mismo wizard diera resultados distintos segun
      // por que boton se salio.
      if (brollPosition !== "auto") {
        body.brollPosition = brollPosition;
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
          description: "Usa «Empezar a editar» primero.",
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

  // REANUDA un trabajo fallido/interrumpido: re-encola su request original.
  // El pipeline salta lo ya hecho (transcript/clips/renders existentes), así que
  // retoma donde iba en vez de repetir horas de trabajo.
  async function resumeActiveJob() {
    if (!activeJob) return;
    if (!activeJob.request) {
      toast.error("Este trabajo no guardó su configuración", {
        description: "Arrancalo de nuevo desde el paso 1 — lo ya generado se salta solo.",
      });
      return;
    }
    setResuming(true);
    try {
      const r = await fetch("/api/long_form/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeJob.request),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${r.status}`);
      const jobIds: string[] = data.jobIds ?? (data.jobId ? [data.jobId] : []);
      if (jobIds.length === 0) throw new Error("no se encoló el trabajo");
      toast.success("Trabajo reanudado ✓", {
        description: "Retoma saltando lo que ya estaba hecho.",
      });
      const jr = await fetch(`/api/long_form/progress?jobId=${jobIds[0]}`);
      if (jr.ok) setActiveJob((await jr.json()) as JobState);
    } catch (err) {
      toastError(err, "No se pudo reanudar el trabajo");
    } finally {
      setResuming(false);
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

  // Editorial (y Editorial con archivo) no llevan subtítulos: su tipografía/colores
  // vienen del tema. Si solo hay estilos editoriales, los selectores de texto de
  // subtítulos no aplican y se ocultan.
  const EDITORIAL_LAYOUT_STYLES: StyleId[] = ["editorial", "editorial_broll", "editorial_full"];
  const hasEditorial = selectedStyles.some((s) => EDITORIAL_LAYOUT_STYLES.includes(s));
  const editorialOnly =
    hasEditorial && selectedStyles.every((s) => EDITORIAL_LAYOUT_STYLES.includes(s));

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
            onResume={resumeActiveJob}
            resuming={resuming}
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

  // ─── Render: wizard de 4 pasos ──────────────────────────────────────────
  return (
    <div className="space-y-6 pb-28">
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

          {/* Barra de progreso del upload — "Subiendo X de Y MB" en vivo */}
          {importing && uploadProgress && (
            <div className="mb-4 rounded-md border border-violet-500/25 bg-violet-500/5 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-violet-200">
                  Subiendo «{uploadProgress.name}»
                </span>
                <span className="shrink-0 font-mono-tab text-muted-foreground">
                  {uploadProgress.doneMB} de {uploadProgress.totalMB} MB · {uploadProgress.pct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
                  style={{ width: `${uploadProgress.pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Traer de YouTube. Deja el archivo en el MISMO sitio que subir o
              importar por ruta, asi que el pipeline desde ahi es identico. */}
          <div className="mb-4 rounded-md border border-red-500/25 bg-red-500/5 p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-red-200">¿Está en YouTube?</span>{" "}
              Pegá el enlace y se baja directo, sin descargarlo a mano. Se trae en
              H.264 hasta 1080p, que es lo que el resto del pipeline procesa más
              rápido.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") bajarDeUrl();
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                className="font-mono-tab text-xs"
              />
              <Button
                size="sm"
                onClick={bajarDeUrl}
                disabled={bajandoUrl}
                className="shrink-0 bg-red-500 text-white hover:bg-red-400"
              >
                {bajandoUrl ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" />
                )}
                Traer de YouTube
              </Button>
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
                    // Wrapper relativo: la tarjeta-botón + el botón de basura van como
                    // HERMANOS (no <button> dentro de <button> → rompería la hidratación).
                    <div key={v.videoId} className="relative">
                    <button
                      type="button"
                      onClick={() => toggleVideo(v.videoId)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-md border p-3 pr-12 text-left transition-colors",
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
                        <CheckCircle2 className="absolute right-10 top-3 h-4 w-4 shrink-0 text-violet-400" />
                      )}
                    </button>
                    {/* Botón de basura: borra DEFINITIVO este video + sus clips. Abre
                        el Dialog de confirmación (acción destructiva). */}
                    <button
                      type="button"
                      onClick={() => setVideoToDelete(v)}
                      title="Borrar este video original (los clips y videos generados se conservan)"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    </div>
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

      {/* STEP 2 — Estilos + Aspect ratio */}
      {step === 2 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">2. Estilo(s) de edición y formato</h2>

          {/* (Quitado: toggle "Modo Gráficos & Motion" — redundante con los estilos
              graphics_pro / graphics_max. Para gráficas, elegí esos estilos.) */}

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

            {/* (Quitado: casilla "Encuadre inteligente (seguir la cara)" — en 16:9 no
                aplica (video completo) y en 9:16 el default "per-frame" ya es el mejor.
                El seguimiento de cara sigue activo por defecto, sin elección manual.) */}
          </div>

          <p className="mb-4 text-xs text-muted-foreground">
            Cada estilo seleccionado genera un MP4 por clip. Si eliges 2 estilos y se recortan 5 clips,
            se generan 10 archivos.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STYLES.map((s) => {
              const sel = selectedStyles.includes(s.id);
              const open = exampleStyle === s.id;
              return (
                // No es <button> (adentro va el botón "Ver ejemplo" → button-in-button
                // rompe la hidratación). Área de selección = <div role="button">.
                <div
                  key={s.id}
                  className={cn(
                    "rounded-lg border bg-card transition-all",
                    sel
                      ? "border-violet-400 ring-1 ring-violet-400 bg-violet-500/5"
                      : "border-border hover:border-foreground/30"
                  )}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleStyle(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleStyle(s.id);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-3 p-4 text-left"
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
                  </div>
                  {/* Ver ejemplo: despliega 3 ESCENAS REALES de cómo se verá el output
                      (frontend/public/style-thumbs/{id}_1..3.png) + la descripción. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      // stopPropagation: sin esto el click sube al <div role="button">
                      // de la tarjeta y DESELECCIONA el estilo → desaparecían los
                      // subtipos editoriales al abrir "Ver ejemplo".
                      e.stopPropagation();
                      setExampleStyle(open ? null : s.id);
                    }}
                    className="w-full border-t border-border/60 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
                  >
                    {open ? "▲ Ocultar ejemplo" : "▼ Ver ejemplo"}
                  </button>
                  {open && (
                    <div className="px-3 pb-3" onClick={(e) => e.stopPropagation()}>
                      {/* Preview EN MOVIMIENTO: 3s reales del estilo (style-previews/{id}_{v|h}.mp4,
                          pre-generado con generate-style-previews.mjs). Si falta el MP4, se oculta
                          solo y quedan las 3 escenas estáticas de siempre. */}
                      <StyleMotionPreview
                        styleId={s.id}
                        horizontal={aspectRatio === "16:9"}
                      />
                      {/* Las escenas matchean el FORMATO elegido: horizontal (16:9) muestra
                          los {id}_h_n apilados; vertical (9:16) los {id}_v_n lado a lado. */}
                      <div
                        className={cn(
                          "grid gap-1.5",
                          aspectRatio === "16:9" ? "grid-cols-1" : "grid-cols-3"
                        )}
                      >
                        {[1, 2, 3].map((n) => (
                          <img
                            key={`${aspectRatio}-${n}`}
                            src={`/style-thumbs/${s.id}_${aspectRatio === "16:9" ? "h" : "v"}_${n}.png`}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                            className={cn(
                              "w-full rounded-md border border-white/10 object-cover",
                              aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"
                            )}
                          />
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                        {aspectRatio === "16:9" ? "Horizontal · " : "Vertical · "}
                        {s.tagline}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {selectedStyles.some((x) => BROLL_STYLES.includes(x)) && (
            <>
              <BrollSourcePicker valor={brollSources} onChange={setBrollSources} />
              <BrollPositionPicker valor={brollPosition} onChange={setBrollPosition} />
            </>
          )}
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
                    <div className="px-2 py-1">
                      <div className="truncate text-[10px] text-muted-foreground">{t.name}</div>
                      {/* La linea que explica el tema. Estaba solo en el wizard
                          de cortos: aca se elegia entre 20 nombres a ciegas. */}
                      <div className="truncate text-[9px] text-muted-foreground/70" title={t.hint}>
                        {t.hint}
                      </div>
                    </div>
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

          {/* (Quitada la casilla "Generar los videos al terminar de recortar": confunde
              y casi siempre se quiere generar. Ahora SIEMPRE genera; para solo-recortar
              está el modo "revisar momentos antes".) */}

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

      {/* STEP 3 — Color + tipografía de subtítulos */}
      {step === 3 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">3. Color principal</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {editorialOnly
              ? "En el estilo Editorial este color pinta las palabras destacadas de los titulares y las ilustraciones animadas."
              : "Un solo color para todos los clips del lote (subtítulos highlight, stickers, vignette, border)."}
          </p>
          {/* F1.b — Marca automática: deriva acento + tema del logo/URL en un paso. */}
          <BrandKitPicker
            themeIds={EDITORIAL_THEMES.map((t) => t.id)}
            onApply={(r) => {
              setAccent(r.accent);
              if (hasEditorial && EDITORIAL_THEMES.some((t) => t.id === r.themeId)) {
                setEditorialTheme(r.themeId);
              }
            }}
          />
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

          {/* Editorial-solo: la tipografía/colores vienen del TEMA elegido en el paso 2. */}
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

          {/* Volumen de música — aplica a TODOS los estilos (también editorial). */}
          <h3 className="mb-1 mt-6 text-sm font-medium">Volumen de música</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Bajalo si la música tapa el audio original del video. 100% = el volumen del estilo.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleVolPreview}
              disabled={volTracks.length === 0}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:border-foreground/40 disabled:opacity-40"
              title="Escuchar una pista a este volumen (se actualiza al mover la barra)"
            >
              {volPreviewOn ? "⏸ Pausar" : "▶ Escuchar"}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={musicVolumePct}
              onChange={(e) => setMusicVolumePct(Number(e.target.value))}
              className="flex-1 accent-foreground"
              aria-label="Volumen de música"
            />
            <span className="w-12 text-right font-mono-tab text-sm tabular-nums">
              {musicVolumePct}%
            </span>
          </div>
          {/* <audio> compartido del preview: loop para poder ajustar mientras suena. */}
          <audio
            ref={volAudioRef}
            loop
            onPause={() => setVolPreviewOn(false)}
            onEnded={() => setVolPreviewOn(false)}
            className="hidden"
          />
        </Card>
      )}

      {/* STEP 4 — Confirmar + arrancar */}
      {step === 4 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">4. Confirmar y arrancar</h2>

          {/* Resumen visual en tarjetas grandes (paridad con el wizard de shorts). */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* VIDEOS */}
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Video{selectedIds.size === 1 ? "" : "s"} ({selectedIds.size})
              </p>
              <p className="mt-1 font-mono-tab text-sm text-foreground break-all">
                {Array.from(selectedIds).slice(0, 3).join(", ")}
                {selectedIds.size > 3 && ` +${selectedIds.size - 3} más`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Modo inteligente: la IA local lee todo y encuentra lo viral (mínimo 15 clips).
                {ollamaModel && <> · modelo {ollamaModel}</>}
              </p>
            </div>

            {/* GENERAR VIDEOS */}
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Generar videos</p>
              <p className="mt-1 text-lg font-semibold">
                {doRender ? "Sí" : "No (solo recortar clips)"}
              </p>
            </div>

            {doRender && (
              <>
                {/* FORMATO */}
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Formato</p>
                  <p className="mt-1 text-lg font-semibold">
                    {aspectRatio === "9:16" ? "📱 Vertical 9:16" : "🖥️ Horizontal 16:9"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {aspectRatio === "9:16" ? "1080×1920 · TikTok · Reels" : "1920×1080 · LinkedIn · YouTube"}
                  </p>
                </div>

                {/* COLOR */}
                <div className="rounded-xl border p-4" style={{ borderColor: `${accent}40`, backgroundColor: `${accent}0d` }}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Color principal</p>
                  <div className="mt-1 flex items-center gap-3">
                    <span
                      className="h-10 w-10 shrink-0 rounded-full"
                      style={{ background: accent, boxShadow: `0 0 16px ${accent}66` }}
                    />
                    <p className="font-mono-tab text-lg font-semibold">{accent}</p>
                  </div>
                </div>

                {/* ESTILOS — resumen VISUAL: la miniatura REAL de cada estilo elegido en
                    el formato seleccionado (los ejemplos que el usuario aprobó), no solo
                    un chip. Da claridad de cómo quedará el output antes de generar. */}
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Estilo{selectedStyles.length === 1 ? "" : "s"} ({selectedStyles.length}) ·{" "}
                    {aspectRatio === "16:9" ? "Horizontal" : "Vertical"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {selectedStyles.map((sid) => (
                      <div key={sid} className="overflow-hidden rounded-lg border border-border bg-card">
                        <img
                          src={`/style-thumbs/${sid}_${aspectRatio === "16:9" ? "h" : "v"}_1.png`}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            // Fallback: si falta el PNG, mostramos el mini-demo animado.
                            e.currentTarget.style.display = "none";
                            const demo = e.currentTarget.nextElementSibling as HTMLElement | null;
                            if (demo) demo.style.display = "flex";
                          }}
                          className={cn(
                            "w-full object-cover",
                            aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"
                          )}
                        />
                        <div className="hidden items-center justify-center bg-card p-2">
                          <StyleMiniDemo styleId={sid} accent={accent} />
                        </div>
                        <p className="px-2 py-1.5 text-center text-sm font-semibold">{styleName(sid)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SUBTÍTULOS / TEMA EDITORIAL */}
                {!editorialOnly && (
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Subtítulos</p>
                    <p
                      className="mt-1 text-2xl font-semibold leading-none"
                      style={{ fontFamily: FONT_PREVIEW[subtitleFont] || undefined }}
                    >
                      {subtitleFont === "auto" ? "Automática" : "Viral"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {SUBTITLE_FONTS.find((f) => f.id === subtitleFont)?.name ?? subtitleFont}
                      {subtitleColor !== "auto" && (
                        <>
                          {" · texto "}
                          <span className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: subtitleColor }} />{" "}
                          <span className="font-mono-tab">{subtitleColor}</span>
                        </>
                      )}
                    </p>
                  </div>
                )}
                {hasEditorial && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">📰 Tema editorial</p>
                    <p className="mt-1 text-lg font-semibold">
                      {EDITORIAL_THEMES.find((t) => t.id === editorialTheme)?.name ?? editorialTheme}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ESTIMADO DE TIEMPO */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:col-span-2">
              <p className="text-sm text-amber-400">
                ⏱️ Estimado: análisis ~30-50 min para un video de 1 hora (puedes cerrar esta
                pantalla, sigue solo). Después revisas los momentos
                {doRender && (
                  <>
                    {" "}y cada clip que apruebes tarda ~2-3 min (propone{" "}
                    {maxClips.trim() ? `hasta ${maxClips.trim()}` : "mínimo 15"})
                  </>
                )}
                .
              </p>
            </div>
          </div>

          {/* Avanzado (opcional): modelo de IA local + máximo de clips. */}
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
                <Label className="text-xs">Cantidad máxima de clips</Label>
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

          {/* Semáforo de la IA local: el análisis siempre usa la IA local, así que
              avisamos aquí si Ollama está apagado antes de arrancar. */}
          <div className="mt-3">
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
                La IA local está apagada — abre la app Ollama desde el menú Inicio
              </span>
            ) : null}
          </div>
          {/* Semáforo en rojo → reparación automática con un clic. */}
          {iaStatus && !iaStatus.running && <div className="mt-2"><IaFixPanel onReady={checkIaLocal} /></div>}

          {/* Acción FINAL del wizard: ya elegiste video, estilo, color, tipografía y todo.
              Un solo "Crear" hace TODO de un saque (encontrar los mejores momentos +
              recortar + generar los videos), sin un segundo paso de revisar/aprobar. */}
          <Button
            onClick={() => startPipeline("full")}
            disabled={submitting || selectedIds.size === 0}
            className="mt-4 w-full bg-violet-500 hover:bg-violet-400 text-white"
          >
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <span className="mr-2">✨</span>
            )}
            {submitting
              ? "Arrancando…"
              : doRender
                ? "Crear todos los videos"
                : "Recortar los clips"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Hace todo de una: encuentra los mejores momentos
            {doRender ? " y genera los videos con tu estilo." : " y los recorta."} Podés cerrar
            esta pantalla, sigue solo.
          </p>

          {/* Alternativa (2 pasos): primero solo analizar, revisar los momentos propuestos y
              elegir cuáles generar. Para quien prefiere aprobar antes de generar. */}
          <Button
            variant="outline"
            onClick={() => startPipeline("analyze")}
            disabled={submitting || selectedIds.size === 0}
            className="mt-3 w-full"
          >
            🔍 Prefiero revisar los momentos antes de generar
          </Button>

          {/* 5TA OPCIÓN — MEJORES MOMENTOS: en vez de N clips sueltos, UN solo video de
              ≤3 min con lo mejor de la charla, secuenciado por emoción (one-shot). */}
          <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <span>🏆</span> Mejores Momentos
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Un solo video con los momentos más increíbles de la charla, pegados en
              secuencia por emoción. Hasta 3 min (o menos si el material no da para tanto).
            </p>
            <Button
              onClick={() => startPipeline("highlights")}
              disabled={submitting || selectedIds.size === 0}
              className="mt-2 w-full bg-amber-500 hover:bg-amber-400 text-black"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <span className="mr-2">🎬</span>
              )}
              Crear video de mejores momentos (≤3 min)
            </Button>
          </div>

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
        </Card>
      )}

      {/* Navegación — barra FIJA al fondo del viewport: "Siguiente" SIEMPRE visible sin
          scroll, incluso al cargar un paso largo. `fixed` se ancla a la pantalla (sticky
          no servía). La raíz lleva pb-28 para que el contenido no quede tapado. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3">
          <Button
            // variant="outline" (no "ghost"): el ghost no tenía borde ni fondo y se
            // perdía en el fondo oscuro. Outline = borde visible. Tamaño lg para parejo.
            variant="outline"
            size="lg"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1 || submitting}
          >
            <ChevronLeft className="mr-1.5 h-4 w-4" />
            Atrás
          </Button>
          {step < TOTAL_STEPS && (
            <Button
              onClick={() => setStep(step === 2 && !doRender ? 4 : step + 1)}
              disabled={
                (step === 1 && selectedIds.size === 0) ||
                (step === 2 && doRender && selectedStyles.length === 0)
              }
            >
              Siguiente
              <ChevronRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Confirmación de borrado (acción destructiva, irreversible). */}
      <Dialog
        open={videoToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deletingVideo) setVideoToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar este video?</DialogTitle>
            <DialogDescription>
              Esto borra SOLO el video original{" "}
              <span className="font-mono-tab text-foreground break-all">
                {videoToDelete?.filename}
              </span>
              . Los clips y videos ya generados se conservan en Mis videos. No se puede
              deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVideoToDelete(null)}
              disabled={deletingVideo}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => videoToDelete && deleteVideo(videoToDelete.videoId)}
              disabled={deletingVideo}
              className="bg-red-500 text-white hover:bg-red-400"
            >
              {deletingVideo ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Borrando…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Sí, borrar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onResume,
  resuming,
}: {
  job: JobState;
  now: number;
  proposals: ProposalsResponse | null;
  onClose: () => void;
  onCancel: () => void;
  cancelling: boolean;
  /** Re-encola el request original del job (retoma saltando lo hecho). */
  onResume: () => void;
  resuming: boolean;
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

      {job.status === "failed" &&
        (() => {
          // Panel de fallo ARRIBA del todo: el botón de recuperación no puede vivir
          // escondido al fondo (bajo «Detalle del proceso» nadie lo veía). Mensaje
          // HONESTO según la causa — Reanudar retoma saltando lo ya hecho
          // (transcript/análisis/clips/renders existentes no se repiten).
          const interrupted = job.steps.some((s) =>
            /interrumpido por reinicio|pausado porque la app se reinició/i.test(s.message ?? ""),
          );
          const timedOut = job.steps.some((s) => /dejó de responder/i.test(s.message ?? ""));
          return (
            <div className="mb-5 rounded-md border border-red-500/30 bg-red-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-red-200">
                <XCircle className="h-4 w-4" />
                {interrupted
                  ? "El trabajo se interrumpió"
                  : timedOut
                    ? "El trabajo se detuvo por falta de señales"
                    : "El procesamiento falló"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {interrupted
                  ? "La app se reinició a mitad del trabajo — tu video está bien. Tocá «Reanudar» y retoma saltando lo que ya estaba hecho."
                  : timedOut
                    ? "El proceso pasó 20 minutos sin reportar avance y se detuvo por seguridad. Tu video está bien y lo ya avanzado se conservó — tocá «Reanudar» y retoma donde iba."
                    : "Causas comunes: la IA local está apagada (ábrela desde el menú Inicio), el video no tiene voz, o el archivo está dañado. El detalle está abajo, en «Detalle del proceso»."}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={onResume}
                  disabled={resuming}
                  className="bg-violet-500 text-white hover:bg-violet-400"
                >
                  {resuming ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {resuming ? "Reanudando…" : "Reanudar trabajo"}
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  Retoma donde iba — lo ya generado no se repite.
                </span>
              </div>
            </div>
          );
        })()}

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
              {/* LATIDO del paso en curso: tiempo transcurrido EN VIVO. Aunque el paso
                  no emita sub-progreso, el usuario VE que la app sigue trabajando
                  (feedback: 17 min sin señales = "¿crasheó?"). `now` ya tickea. */}
              {step.status === "running" && step.startedAt && (
                <p className="font-mono-tab text-[10px] text-amber-300/90">
                  <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />
                  trabajando… lleva {fmtElapsed(Math.max(0, now - step.startedAt))}
                </p>
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

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/produccion"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-gradient px-4 text-sm font-medium text-white hover:opacity-90"
            >
              <Play className="h-3.5 w-3.5" />
              Abrir Mis videos para ver y publicar
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            {/* SUPERCUT: junta los top momentos renderizados en un highlight reel. */}
            {job.options?.render && <SupercutButton videoId={job.videoId} />}
          </div>
        </div>
      )}

      {/* MEJORES MOMENTOS (highlights): este modo NO tiene proposals/doneClips (arma UN
          solo video), así que el bloque de arriba no aplica. Damos su propio resultado
          con un botón claro que abre el reel en Mis videos (deep-link ?q=). */}
      {job.status === "done" && job.options?.mode === "highlights" && (
        <div className="mt-5 space-y-3">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
              <CheckCircle2 className="h-4 w-4" />
              🏆 Tu video de Mejores Momentos está listo
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Guardado en <strong>Mis videos</strong> (junto a tus otros renders de videos
              largos). Ábrelo para verlo, descargarlo o publicarlo.
            </p>
          </div>
          <Link
            href={`/publicar?q=${encodeURIComponent(job.videoId)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-amber-500 px-4 text-sm font-semibold text-black hover:bg-amber-400"
          >
            <Play className="h-4 w-4" />
            Ver mi video de Mejores Momentos
            <ArrowRight className="h-4 w-4" />
          </Link>
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
    async (items: { index: number; approved?: boolean; start?: number; end?: number; hook?: string }[]) => {
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
              onPickHook: (hook) => {
                const next = [...clips];
                next[i] = { ...clips[i], hook };
                setClips(next);
                void sendPatch([{ index: i, hook }]);
              },
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
  /** Hooks A/B: guarda el gancho elegido (el padre persiste con PATCH). */
  onPickHook: (hook: string) => void;
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
  // Hooks A/B — 3 variantes de gancho generadas por la IA local (solo en revisión).
  const [variants, setVariants] = useState<string[] | null>(null);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState(false);

  async function loadHookVariants() {
    if (variantsOpen) {
      setVariantsOpen(false);
      return;
    }
    if (variants) {
      setVariantsOpen(true);
      return;
    }
    setLoadingVariants(true);
    try {
      const r = await fetch("/api/long_form/hook-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, start: c.start, end: c.end, current: c.hook ?? "" }),
      });
      const d = (await r.json()) as { variants?: string[]; error?: string };
      if (!r.ok || !d.variants?.length) throw new Error(d.error ?? `HTTP ${r.status}`);
      setVariants(d.variants);
      setVariantsOpen(true);
    } catch (err) {
      toastError(err, "No se pudieron generar los ganchos alternativos");
    } finally {
      setLoadingVariants(false);
    }
  }

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
            onClick={loadHookVariants}
            disabled={loadingVariants}
            title="Genera 3 ganchos alternativos con la IA (pregunta / cifra / declaración) y elige el que más detenga el scroll"
            className={cn(
              "ml-auto flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors",
              variantsOpen
                ? "border-amber-400/50 bg-amber-500/10 text-amber-300"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {loadingVariants ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Ganchos
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", variantsOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={review.onToggleAdjust}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors",
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

      {/* ── Hooks A/B: 3 variantes de gancho (pregunta / cifra / declaración) ── */}
      {review && variantsOpen && variants && (
        <div className="mt-2 space-y-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5">
          <p className="font-mono-tab text-[10px] uppercase tracking-wider text-muted-foreground">
            Elige el gancho de los primeros 3 segundos
          </p>
          {[c.hook, ...variants.filter((v) => v !== c.hook)].filter(Boolean).map((v, k) => {
            const isCurrent = v === c.hook;
            return (
              <button
                key={`${k}-${v}`}
                type="button"
                onClick={() => {
                  if (!isCurrent && v) review.onPickHook(v);
                }}
                className={cn(
                  "block w-full rounded border px-2 py-1.5 text-left text-[11px] transition-colors",
                  isCurrent
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                    : "border-border text-foreground/85 hover:border-amber-400/40 hover:bg-amber-500/10"
                )}
                title={isCurrent ? "Este es el gancho actual" : "Usar este gancho"}
              >
                {isCurrent && <span className="mr-1 font-mono-tab text-[9px] text-amber-400">ACTUAL</span>}
                {v}
              </button>
            );
          })}
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

/** SUPERCUT (Mejora B): un clic → junta los top momentos renderizados (mismo estilo)
 *  en un highlight reel con loudness -14 LUFS, y lo deja en Mis videos. */
function SupercutButton({ videoId }: { videoId: string }) {
  const [creating, setCreating] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    try {
      const r = await fetch("/api/long_form/supercut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const d = (await r.json()) as {
        error?: string;
        id?: string;
        clips?: number;
        seconds?: number;
      };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setDoneId(d.id ?? "ok");
      toast.success(`Supercut listo · ${d.clips} momentos · ${Math.round(d.seconds ?? 0)}s`, {
        description: "Lo encuentras en Mis videos, listo para publicar.",
      });
    } catch (err) {
      toastError(err, "No se pudo crear el supercut");
    } finally {
      setCreating(false);
    }
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={creating || doneId !== null}
      title="Junta los mejores momentos ya generados en UN solo video resumen (mismo estilo)"
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-4 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
    >
      {creating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Clapperboard className="h-3.5 w-3.5" />
      )}
      {creating ? "Creando supercut… (1-3 min)" : doneId ? "Supercut creado ✓" : "Crear supercut (top 5)"}
    </button>
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
