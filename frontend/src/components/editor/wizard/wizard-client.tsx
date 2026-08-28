"use client";

// Thumbnails dinámicos de videos raw (sizes flexibles).
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { StyleId } from "@/lib/style-registry";
import type { BrollSource } from "@/lib/pexels";
import { BROLL_STYLE_IDS, BROLL_CAPABLE_STYLE_IDS, ADORNO_STYLE_IDS, EDITORIAL_THEME_STYLE_IDS } from "@/lib/broll-sources";
import { BrollSourcePicker } from "@/components/editor/wizard/broll-source-picker";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, ChevronLeft, ChevronRight, FileVideo, Mic, Send } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StyleMiniDemo } from "@/components/editor/wizard/style-mini-demo";
import { StyleMotionPreview } from "@/components/editor/wizard/style-motion-preview";
import { CinematicStep } from "@/components/editor/wizard/cinematic-step";
import { BrandKitPicker } from "@/components/editor/wizard/brand-kit-picker";
import { Confetti } from "@/components/ui/confetti";
import { EDITORIAL_THEMES } from "@/lib/editorial-themes";
import { BrollPositionPicker, type BrollPosition } from "@/components/editor/wizard/broll-position-picker";
import { AdornosPicker, ADORNOS_POR_OMISION, ADORNOS_EDITORIAL, type Adornos } from "@/components/editor/wizard/adornos-picker";
import {
  Montserrat, Poppins, Oswald, Bangers, Luckiest_Guy, Archivo_Black, Teko, Righteous,
  Bebas_Neue, Anton,
} from "next/font/google";

// Fuentes auto-hospedadas por Next (gratis, sin API key) SOLO para previsualizar cada
// tipografía en su propio estilo dentro del selector. El render real las carga aparte
// en Remotion. Así el usuario VE cómo se ve cada fuente, no solo el nombre.
const _mont = Montserrat({ subsets: ["latin"], weight: "700", display: "swap" });
const _pop = Poppins({ subsets: ["latin"], weight: "700", display: "swap" });
const _osw = Oswald({ subsets: ["latin"], weight: "600", display: "swap" });
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
  // Serif editorial: el preview cae a Georgia/serif si Playfair no está cargada en
  // el navegador, lo suficiente para transmitir el look (el render sí usa Playfair).
  playfair: "'Playfair Display', Georgia, serif",
};

// El tipo NO se declara acá: se toma del registro de estilos, que es la única
// fuente de verdad del catálogo. Antes había una copia literal de los ids escrita
// a mano en este archivo, y la copia se quedó atrás: le faltaban `pop_reels` y
// `editorial_full`, dos estilos completos que el motor de render sí sabía hacer.
// El resultado no fue un error visible sino algo peor: nadie podía elegirlos, y
// el compilador ayudaba a mantener el olvido rechazando cualquier intento de
// agregarlos. Importar el tipo hace que esa clase de deriva sea imposible.
type PlatformId = "tiktok" | "instagram" | "linkedin" | "facebook";

interface VideoEntry {
  id: string;
  filename: string;
  sizeMb: number;
  durationSec: number | null;
  status: { transcribed: boolean; cuts: boolean; rendered: boolean };
}

interface CaptionMeta {
  caption_short?: string;
  caption_long?: string;
  hashtags_tiktok?: string[];
  hashtags_instagram?: string[];
  hashtags_linkedin?: string[];
  hashtags_facebook?: string[];
  _provider?: string;
  _model?: string;
}

const TOTAL_STEPS = 5;

// Progreso persistente: si el usuario recarga la página a mitad de la creación,
// con esta clave se reanuda el paso 4 y el polling (los jobs viven en el server).
const ACTIVE_JOB_KEY = "wizard.activeJob";

function clearActiveJob() {
  try {
    window.localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    /* sin almacenamiento — no rompe */
  }
}

// Nombres en lenguaje de principiante (no los codenames internos). `recommended` marca
// el más fácil/rápido para un primer video. Orden: el recomendado primero.
const STYLES: { id: StyleId; name: string; tagline: string; emoji: string; recommended?: boolean }[] = [
  { id: "hype", name: "Viral", tagline: "Subtítulos grandes y dinámicos, estilo videos de YouTube. La mejor opción para empezar.", emoji: "🔥", recommended: true },
  { id: "punch", name: "Impacto", tagline: "Resalta las frases clave en los momentos importantes.", emoji: "🥊" },
  { id: "hype_max", name: "Viral intenso", tagline: "Suma cortes rápidos y zooms de reacción. Más energía.", emoji: "⚡" },
  { id: "hype_max_sfx", name: "Viral con sonidos", tagline: "Lo más llamativo: agrega efectos de sonido en los momentos clave.", emoji: "🎵" },
  { id: "supreme", name: "Premium", tagline: "Todo activado, la máxima calidad. Tarda un poco más.", emoji: "👑" },
  { id: "cinematic_pro", name: "Cinematográfico", tagline: "Look de cine: film grain, color teal&orange, viñeta y movimientos de cámara suaves. Opcional: sube imágenes para superponerlas.", emoji: "🎬" },
  { id: "silent", name: "Limpio", tagline: "Solo subtítulos, sin efectos. Sobrio y profesional.", emoji: "🤍" },
  { id: "broll_full", name: "Con videos de apoyo", tagline: "Agrega clips de archivo a pantalla completa según lo que dices.", emoji: "🎞️" },
  { id: "broll_pip", name: "Videos de apoyo (chico)", tagline: "Muestra clips de archivo en pequeño sobre tu video.", emoji: "🖼️" },
  { id: "text_behind", name: "Texto detrás de ti", tagline: "Efecto CapCut clásico: una palabra grande queda DETRÁS del sujeto.", emoji: "🧍" },
  { id: "graphics_pro", name: "Gráficos & Motion", tagline: "Suma gráficas animadas y titulares poderosos (de lo que dices) + zooms y transiciones.", emoji: "📊" },
  { id: "graphics_max", name: "Gráficos Max", tagline: "Gráficos al máximo: cortes rápidos, zooms de reacción y stutter. La más intensa.", emoji: "📈" },
  { id: "motion_pro", name: "Motion Pro", tagline: "Animación pura y LIMPIA: fondo aurora que pulsa con la música, gráficas, sin emojis.", emoji: "✨" },
  { id: "motion_beat", name: "Motion Beat", tagline: "El fondo late al ritmo de la música (gradiente vivo) + zooms al beat. Limpio y con energía.", emoji: "🎧" },
  { id: "motion_grid", name: "Motion Grid", tagline: "Look retro-tech futurista: cuadrícula en perspectiva + gráficas. Sin emojis.", emoji: "🌐" },
  { id: "editorial", name: "Editorial", tagline: "Estilo documental premium: tu video en un panel + titulares serif gigantes + ilustraciones doradas animadas. Sin subtítulos.", emoji: "📰" },
  { id: "editorial_broll", name: "Editorial con archivo", tagline: "El estilo Editorial + videos de archivo (Pexels) que ilustran lo que dices, en cortinillas sobre el lienzo. Documental premium con material de apoyo.", emoji: "🎞️" },
  { id: "kinetic_type", name: "Tipografía cinética", tagline: "Subtítulos gigantes palabra-por-palabra sobre un fondo que late con la música. Sin emojis.", emoji: "⌨️" },
  { id: "lottie_pop", name: "Animado con stickers", tagline: "Lleno de vida: stickers animados, íconos y fondo aurora. Juguetón y enérgico.", emoji: "✨" },
  { id: "paper_cut", name: "Papel recortado", tagline: "Collage editorial: tu video en un panel de papel recortado + titulares serif.", emoji: "✂️" },
  { id: "cine_clasico", name: "Cine clásico", tagline: "Cine antiguo: en los momentos dramáticos la voz suena a radio vieja y la imagen se vuelve blanco y negro, con efectos de máquina de escribir y proyector.", emoji: "🎞️" },
  { id: "vhs", name: "VHS Retro", tagline: "Cámara de los 90: grano, scanlines, ► PLAY con contador y glitch de tracking. Se siente grabado en cinta — lo 'imperfecto' que hoy se ve real.", emoji: "📼" },
  { id: "audiogram", name: "Audiograma", tagline: "Clip de podcast: una onda de barras baila con la voz + el nombre de tu show. Perfecto para entrevistas y episodios sin depender de la imagen.", emoji: "🎙️" },
  // Estos dos estaban implementados de punta a punta pero NO figuraban acá, así
  // que nadie podía elegirlos: existían en el registro de estilos y en el motor
  // de render, y eran inalcanzables desde la app. Un estilo sin puerta de
  // entrada es, en la práctica, un estilo que no existe.
  { id: "pop_reels", name: "Pop Reels", tagline: "Subtítulos en píldora de color sobre el video, palabra a palabra, al estilo de los reels que mejor retienen. Directo y muy legible.", emoji: "💊" },
  { id: "editorial_full", name: "Editorial a pantalla completa", tagline: "El estilo Editorial sin panel: tu video ocupa todo el cuadro y los titulares serif van encima. Más inmersivo, ideal para horizontal.", emoji: "🗞️" },
];

// IDs de estilo que pertenecen a alguna familia de preset del paso 2 (para el
// gate "Personalizado" de abajo). "text_behind" no entra en ninguna familia:
// vive solo en el modo avanzado.
const PRESET_STYLE_IDS = new Set<StyleId>([
  "hype", "hype_max", "hype_max_sfx", "supreme",
  "silent", "punch",
  "graphics_pro", "graphics_max", "motion_pro", "motion_beat", "motion_grid", "kinetic_type", "lottie_pop",
  "editorial", "editorial_broll", "paper_cut",
  "cinematic_pro", "cine_clasico", "vhs", "audiogram",
  "broll_full", "broll_pip",
]);

// Fuentes de subtítulo disponibles (Google Fonts gratis). "auto" = la del estilo.
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
  { id: "playfair", name: "Playfair (serif editorial)" },
];

// Familias de estilos con submenú propio (patrón "tema editorial"): el submenú
// solo aparece si hay un estilo de la familia seleccionado, y el default ("auto"/
// "normal") deja el render EXACTAMENTE como siempre — elegir nada = perfecto.
const MOTION_STYLES: StyleId[] = ["motion_pro", "motion_beat", "motion_grid", "kinetic_type", "lottie_pop"];
const HYPE_STYLES: StyleId[] = ["hype", "hype_max", "hype_max_sfx", "supreme"];
// Se toman del modulo compartido para que los dos asistentes no puedan divergir.
// Los estilos que PUEDEN mostrar material, no solo los que lo traen solos: el
// composition dibuja B-roll para los cuatro editoriales, y el selector aparecia
// en uno. En los otros tres la capacidad existia sin forma de encenderla.
const BROLL_STYLES: StyleId[] = [...BROLL_CAPABLE_STYLE_IDS];


// Estilos que LLEVAN música de fondo (los que setean musicTrack en
// style-templates.ts: broll_*, motion_*, editorial y cinematic_pro). Para ellos
// aparece el submenú "🎵 Música".
const MUSIC_STYLES: StyleId[] = [
  "broll_full",
  "broll_pip",
  "motion_pro",
  "motion_beat",
  "motion_grid",
  "editorial",
  "editorial_broll",
  "kinetic_type",
  "lottie_pop",
  "paper_cut",
  "cinematic_pro",
];

// Elección de música del wizard. "auto" = el sistema elige y rota (lo de siempre).
type MusicChoice = "auto" | "none" | { mood: string };

// Moods REALES de la biblioteca local (los nombres de archivo los codifican:
// "chosic-calm-…", "incompetech-epic-…"). Solo se ofrecen los que tienen pistas.
const MUSIC_MOODS: { id: string; name: string; emoji: string; hint: string }[] = [
  { id: "calm", name: "Tranquila", emoji: "🌿", hint: "Suave, no compite con tu voz" },
  { id: "epic", name: "Épica", emoji: "🎬", hint: "Cinemática, se siente grande" },
  { id: "energetic", name: "Enérgica", emoji: "⚡", hint: "Ritmo arriba, con empuje" },
  { id: "funny", name: "Divertida", emoji: "🤪", hint: "Ligera y juguetona" },
];

// Fondos animados de los estilos Motion (mismo "kind" que animatedBackground en
// style-templates). El preview es CSS puro — se VE cómo es cada fondo sin leer.
const MOTION_BACKGROUNDS: { id: string; name: string; hint: string; preview: CSSProperties }[] = [
  { id: "auto", name: "Automático", hint: "el de cada estilo", preview: { background: "linear-gradient(135deg, #1e293b, #0f172a)" } },
  { id: "aurora", name: "Aurora", hint: "ondas que pulsan", preview: { background: "radial-gradient(circle at 30% 35%, rgba(52,211,153,0.8), transparent 60%), radial-gradient(circle at 70% 70%, rgba(167,139,250,0.8), transparent 60%), #07070d" } },
  { id: "mesh", name: "Gradiente vivo", hint: "late con la música", preview: { background: "linear-gradient(135deg, #fb7185, #a78bfa 50%, #22d3ee)" } },
  { id: "grid", name: "Cuadrícula retro", hint: "look futurista", preview: { background: "linear-gradient(rgba(34,211,238,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.35) 1px, transparent 1px), #060912", backgroundSize: "11px 11px, 11px 11px, auto" } },
];

// Intensidad de los FX de los estilos Viral/Premium. "normal" = el balance con el
// que se diseñó cada estilo; "suave" recorta zooms/efectos; "max" los acentúa.
const FX_INTENSITIES: { id: string; name: string; emoji: string; hint: string }[] = [
  { id: "suave", name: "Suave", emoji: "🌙", hint: "Pocos zooms, todo más tranquilo. Ideal si quieres algo calmado y elegante." },
  { id: "normal", name: "Normal", emoji: "⚡", hint: "El balance recomendado: zooms y efectos justos, ni de más ni de menos." },
  { id: "max", name: "Máximo", emoji: "🔥", hint: "Zooms fuertes y cortes rápidos. Máxima energía para que enganche al instante." },
];

// Nombre humano de un estilo a partir de su id (acepta "videoId::style" del progreso).
function humanStyleName(rawId: string): string {
  const id = rawId.includes("::") ? rawId.split("::").pop()! : rawId;
  return STYLES.find((s) => s.id === id)?.name ?? id;
}

// Color del TEXTO de los subtítulos ("auto" = blanco / el del estilo). Colores
// brillantes pensados para leerse sobre video con sombra/borde oscuro.
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

const PALETTE = [
  { name: "rosa coral", value: "#fb7185", mood: "urgencia" },
  { name: "rojo", value: "#ef4444", mood: "pasión" },
  { name: "fucsia", value: "#d946ef", mood: "atrevido" },
  { name: "magenta", value: "#ec4899", mood: "intensidad" },
  { name: "rosa pastel", value: "#f9a8d4", mood: "dulzura" },
  { name: "violeta", value: "#a78bfa", mood: "autoridad" },
  { name: "violeta claro", value: "#c084fc", mood: "elegancia" },
  { name: "lavanda", value: "#b4a0ff", mood: "calma" },
  { name: "azul índigo", value: "#6366f1", mood: "IA" },
  { name: "azul cielo", value: "#38bdf8", mood: "confianza" },
  { name: "cian", value: "#06b6d4", mood: "claridad" },
  { name: "turquesa", value: "#22d3ee", mood: "tech" },
  { name: "teal", value: "#14b8a6", mood: "equilibrio" },
  { name: "esmeralda", value: "#34d399", mood: "crecimiento" },
  { name: "verde bosque", value: "#16a34a", mood: "naturaleza" },
  { name: "lima", value: "#a3e635", mood: "energía" },
  { name: "amarillo", value: "#fbbf24", mood: "claridad" },
  { name: "dorado", value: "#eab308", mood: "premium" },
  { name: "durazno", value: "#fdba74", mood: "calidez" },
  { name: "naranja", value: "#fb923c", mood: "acción" },
];

// Formato de salida del video: 3 tarjetas grandes (estilo home-card). Cada una
// con su color de identidad, emoji, dónde se usa y el tamaño exacto en píxeles.
// `box` define la forma de la mini-previsualización (proporción real del lienzo).
const FORMATS: {
  id: "9:16" | "1:1" | "16:9";
  emoji: string;
  title: string;
  where: string;
  size: string;
  color: string;
  box: CSSProperties;
}[] = [
  {
    id: "9:16",
    emoji: "📱",
    title: "Vertical 9:16",
    where: "TikTok · Reels",
    size: "1080 × 1920",
    color: "#fb7185",
    box: { width: 26, height: 46 },
  },
  {
    id: "1:1",
    emoji: "⬜",
    title: "Cuadrado 1:1",
    where: "Feed · Instagram",
    size: "1080 × 1080",
    color: "#a78bfa",
    box: { width: 40, height: 40 },
  },
  {
    id: "16:9",
    emoji: "🖥️",
    title: "Horizontal 16:9",
    where: "YouTube · LinkedIn",
    size: "1920 × 1080",
    color: "#22d3ee",
    box: { width: 52, height: 29 },
  },
];

// Editorial (y Editorial con archivo) no llevan subtítulos: su tipografía y
// colores vienen del TEMA elegido en el paso 2. A nivel módulo: lista constante.
// Los CUATRO que reusan editorialLayout, de la lista compartida: cada
// wizard tenia la suya y se habian separado.
const EDITORIAL_LAYOUT_STYLES: StyleId[] = [...EDITORIAL_THEME_STYLE_IDS];


export function WizardClient({ initialStyle }: { initialStyle?: string } = {}) {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [rawDir, setRawDir] = useState<string>("");
  const [step, setStep] = useState(1);
  // Multi-select: el wizard procesa N videos a la vez (todos con la misma config).
  // Si seleccionas 3 videos × 2 estilos, se encolan 3 jobs (cola serial: 1 a la vez).
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  // Estilo inicial: si la home llega con ?style=<id> (p.ej. tarjeta
  // "Cinematográfico"), arranca con ese estilo PRE-seleccionado; si no, "hype".
  // Se valida contra STYLES para no aceptar un id basura de la URL.
  const [selectedStyles, setSelectedStyles] = useState<StyleId[]>(
    initialStyle && STYLES.some((s) => s.id === initialStyle)
      ? [initialStyle as StyleId]
      : ["hype"]
  );
  const [accent, setAccent] = useState<string>("#fb7185");
  // F2.b — Bumper de marca (intro/outro). Opt-in; default apagado = render idéntico.
  const [bumperEnabled, setBumperEnabled] = useState(false);
  // Banda inferior de nombre/cargo (lower-third). Opcional: sin nombre,
  // `word_callouts.py` devuelve la lista vacia y no se dibuja ninguna banda.
  // Traer de YouTube. Mismo destino que "importar desde mi compu", asi que el
  // pipeline desde ahi es identico.
  const [urlYt, setUrlYt] = useState("");
  const [bajandoYt, setBajandoYt] = useState(false);
  const [speakerName, setSpeakerName] = useState("");
  const [speakerRole, setSpeakerRole] = useState("");
  const [bumperTagline, setBumperTagline] = useState("");
  const [bumperSubtitle, setBumperSubtitle] = useState("");
  const [bumperLogoUrl, setBumperLogoUrl] = useState("");
  const [bumperOutro, setBumperOutro] = useState(true);
  const [subtitleFont, setSubtitleFont] = useState<string>("auto");
  // Color del TEXTO de los subtítulos ("auto" = el del estilo, normalmente blanco).
  const [subtitleColor, setSubtitleColor] = useState<string>("auto");
  const [editorialTheme, setEditorialTheme] = useState<string>("clasico");
  const [brollSources, setBrollSources] = useState<BrollSource[]>(["auto"]);
  // Donde aparece el material. `auto` = lo decide la forma, como siempre.
  const [brollPosition, setBrollPosition] = useState<BrollPosition>("auto");
  // Que se agrega ENCIMA del video. En editorial arranca todo apagado: su
  // fuerza es la tipografia, y tres capas de adornos encima la arruinan.
  const [adornos, setAdornos] = useState<Adornos>(ADORNOS_POR_OMISION);
  // 17 temas abruman: se muestran 8 y "Ver todos" despliega el resto.
  const [showAllThemes, setShowAllThemes] = useState(false);
  // 👁️ Estilo cuyo ejemplo GRANDE se está viendo en el modal (null = cerrado).
  // Muestra el mismo StyleMiniDemo (CSS, sin render) a tamaño grande.
  const [previewStyleId, setPreviewStyleId] = useState<StyleId | null>(null);
  // Fondo animado (estilos motion_*). "auto" = el fondo propio de cada estilo.
  const [motionBackground, setMotionBackground] = useState<string>("auto");
  // 🎵 Música de fondo (estilos broll_*/motion_*/editorial). "auto" = el sistema
  // elige y rota como siempre; "none" = sin música; {mood} = pista de ese mood.
  const [music, setMusic] = useState<MusicChoice>("auto");
  // Pistas reales de /api/music/list para los botones ▶ Escuchar.
  const [musicTracks, setMusicTracks] = useState<{ filename: string; url: string }[]>([]);
  // Mood que está sonando ahora (un solo <audio> compartido para todo el panel).
  const [playingMood, setPlayingMood] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Miniaturas de temas editoriales que no cargaron (404/falta el PNG): esos
  // temas caen al mini-preview CSS de siempre.
  const [thumbErrors, setThumbErrors] = useState<Set<string>>(new Set());
  // Intensidad de FX (estilos hype*/supreme). "normal" = el estilo tal cual.
  const [fxIntensity, setFxIntensity] = useState<string>("normal");
  // true cuando el usuario eligió un color A MANO en el paso 3: a partir de ahí,
  // elegir un tema editorial ya NO le pisa el color.
  const [accentTouched, setAccentTouched] = useState(false);
  // Transcripción visible: lote en curso (para el panel "Estamos escuchando…")
  // y videos cuyo audio no se pudo escuchar (cada uno con su botón Reintentar).
  const [transcribeQueue, setTranscribeQueue] = useState<VideoEntry[]>([]);
  const [transcribeErrors, setTranscribeErrors] = useState<VideoEntry[]>([]);
  // Combo "videoId::estilo" que se está re-creando desde el paso final.
  const [retryingStyle, setRetryingStyle] = useState<string | null>(null);

  // Redes fijas: la descripción se genera SOLA para todas (en /produccion están los
  // copys por red). Ya no hay botones de redes en el wizard — un paso menos de fricción.
  const selectedPlatforms: PlatformId[] = ["instagram", "linkedin"];
  // Aspect ratio del output. 9:16 vertical (TikTok/Reels) default, 1:1 cuadrado (Feed/Instagram), 16:9 horizontal (LinkedIn/YouTube).
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [caption, setCaption] = useState<string>("");
  const [captionMeta, setCaptionMeta] = useState<CaptionMeta | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [building, setBuilding] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Configuración del modo cinematográfico (opt-in). Cuando enabled=true, el sistema
  // sube imágenes, convoca asamblea de agentes IA, y aplica film grain + vignette +
  // subtítulos cinematográficos al render.
  const [cinematicConfig, setCinematicConfig] = useState<import("./cinematic-step").CinematicConfig>({
    enabled: false,
    overlayIds: [],
    filmGrain: false,
    vignette: false,
    subtitleStyleCinematic: false,
    assemblyResult: null,
  });
  // Con multi-video, styleId tiene formato "videoId::style" para distinguir el origen
  const [results, setResults] = useState<Array<{ styleId: string; ok: boolean; output?: string; error?: string }>>([]);
  const [jobProgress, setJobProgress] = useState<{
    overallProgress: number;
    currentStyle?: string;
    steps: Array<{
      styleId: string;
      status: string;
      progress: number;
      currentFrame?: number;
      totalFrames?: number;
    }>;
  } | null>(null);

  async function loadVideos() {
    try {
      const r = await fetch("/api/videos/list");
      const d = await r.json();
      setVideos(d.videos ?? []);
      if (d.rawDir) setRawDir(d.rawDir);
    } catch (err) {
      toastError(err, "No se pudieron cargar tus videos", {
        action: { label: "Reintentar", onClick: loadVideos },
      });
    }
  }

  // Load on mount: lista de videos raw. Patrón válido aunque el lint quiera use(promise).
  useEffect(() => {
     
    loadVideos();
  }, []);

  // Progreso persistente: si hay una creación en curso guardada (<2h), reanudar
  // el paso 4 y el polling — los jobs viven en el server y sobreviven al refresh.
  function restoreActiveJob() {
    try {
      const raw = window.localStorage.getItem(ACTIVE_JOB_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        jobIds?: string[];
        videoIds?: string[];
        styles?: string[];
        ts?: number;
      };
      const fresh =
        typeof saved.ts === "number" && Date.now() - saved.ts < 2 * 60 * 60 * 1000;
      if (!fresh || !Array.isArray(saved.jobIds) || saved.jobIds.length === 0) {
        clearActiveJob();
        return;
      }
      if (Array.isArray(saved.videoIds)) setSelectedVideos(new Set(saved.videoIds));
      if (Array.isArray(saved.styles) && saved.styles.length > 0) {
        setSelectedStyles(saved.styles as StyleId[]);
      }
      setBuilding(true);
      setStep(4);
      startPolling(saved.jobIds, saved.videoIds ?? [], { restored: true });
    } catch {
      clearActiveJob();
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    restoreActiveJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedVideoList = videos.filter((v) => selectedVideos.has(v.id));
  const firstSelected = selectedVideoList[0];

  // Editorial (y Editorial con archivo) no llevan subtítulos: su tipografía y colores
  // vienen del TEMA elegido en el paso 2. Si solo hay estilos editoriales, los
  // selectores de texto no aplican y se ocultan.
  const hasEditorial = selectedStyles.some((s) => EDITORIAL_LAYOUT_STYLES.includes(s));
  const editorialOnly =
    hasEditorial && selectedStyles.every((s) => EDITORIAL_LAYOUT_STYLES.includes(s));

  // 🎬 Cinematográfico es ahora un ESTILO de primera clase (tarjeta del menú).
  // Cuando se elige, el modo cinematográfico se enciende solo con defaults sensatos
  // (film grain + vignette + subtítulos cine) para que enrichCinematic corra los
  // camera-moves/SFX y el panel inline de overlays aparezca en el paso 2.
  const hasCinematic = selectedStyles.includes("cinematic_pro");
  // Sincroniza cinematicConfig.enabled con la selección del estilo cinematic_pro,
  // SIN pisar los toggles/overlays que el user haya ajustado a mano (solo togglea
  // `enabled` y aplica defaults la PRIMERA vez que se enciende).
  // Va durante el RENDER, comparando contra el valor anterior, en vez de en un
  // efecto: es el patron que React documenta para ajustar estado cuando una prop
  // cambia. Con el efecto, el paso 2 alcanzaba a pintarse una vez con la config
  // vieja antes de corregirse.
  const [prevCinematic, setPrevCinematic] = useState(hasCinematic);
  if (prevCinematic !== hasCinematic) {
    setPrevCinematic(hasCinematic);
    setCinematicConfig((prev) => {
      if (hasCinematic && !prev.enabled) {
        // Al activar el estilo: encender con defaults cine (no toca overlays ya subidos).
        return {
          ...prev,
          enabled: true,
          filmGrain: true,
          vignette: true,
          subtitleStyleCinematic: true,
        };
      }
      if (!hasCinematic && prev.enabled) {
        // Al quitar el estilo del set: apagar (conserva overlayIds por si vuelve a elegirlo).
        return { ...prev, enabled: false };
      }
      return prev;
    });
  }

  // Mapeo inverso preset ← selectedStyles (DERIVADO, sin estado extra): con
  // EXACTAMENTE 1 estilo que pertenece a una familia, esa tarjeta+chip se
  // resaltan — funciona igual al aplicar una plantilla o restaurar wizard.activeJob.
  // Multi-selección o text_behind (modo avanzado) ⇒ null = estado "Personalizado".
  const activePreset =
    selectedStyles.length === 1 && PRESET_STYLE_IDS.has(selectedStyles[0]);

  function toggleVideo(id: string) {
    setSelectedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Importar videos desde la compu del usuario. Sube por multipart al endpoint
   * /api/videos/import que los copia a RAW_DIR. Después refresca la lista.
   */
  async function bajarDeYoutube() {
    const u = urlYt.trim();
    if (!u) return;
    setBajandoYt(true);
    const aviso = toast.loading("Bajando el video…");
    try {
      const r = await fetch("/api/videos/descargar-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, flujo: "corto" }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        error?: string; pista?: string; id?: string; duracion_s?: number; sugerencia?: string;
      };
      if (r.ok) {
        const min = Math.round((d.duracion_s ?? 0) / 60);
        toast.success(`«${d.id}» listo`, {
          id: aviso,
          // Si es largo se DICE, no se cambia de flujo solo.
          description:
            d.sugerencia === "largo"
              ? `Dura ${min} min: de algo asi salen mejores clips con «Videos largos».`
              : undefined,
        });
        setUrlYt("");
        await loadVideos();
      } else {
        toast.error("No se pudo bajar el video", {
          id: aviso,
          description: [d.error, d.pista].filter(Boolean).join(" — ") || undefined,
        });
      }
    } catch (err) {
      toast.dismiss(aviso);
      toastError(err, "No se pudo bajar el video");
    } finally {
      setBajandoYt(false);
    }
  }

  async function importVideos(files: FileList | File[]) {
    setImporting(true);
    let ok = 0, fail = 0;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch("/api/videos/import", { method: "POST", body: form });
        if (r.ok) ok++; else fail++;
      }
      if (ok > 0) toast.success(ok === 1 ? "1 video importado ✓" : `${ok} videos importados ✓`);
      if (fail > 0) {
        toast.error(
          fail === 1 ? "1 video no se pudo importar" : `${fail} videos no se pudieron importar`
        );
      }
      loadVideos();
    } catch (err) {
      toastError(err, "No se pudo importar tu video", {
        action: { label: "Reintentar", onClick: () => importVideos(files) },
      });
    } finally {
      setImporting(false);
    }
  }

  // 🎵 Cargar la lista real de pistas una vez (para los botones ▶ Escuchar).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/music/list")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d.tracks)) return;
        setMusicTracks(
          d.tracks
            .filter((t: { filename?: string; url?: string }) => t.filename && t.url)
            .map((t: { filename: string; url: string }) => ({ filename: t.filename, url: t.url }))
        );
      })
      .catch(() => {
        /* sin lista — los botones Escuchar avisan al hacer click */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Al cambiar de paso, parar cualquier pista que esté sonando.
  useEffect(() => {
    audioRef.current?.pause();
  }, [step]);

  // ▶ Escuchar ~10s de una pista del mood en UN solo <audio> compartido.
  // Segundo click sobre el mismo mood = pausa; otro mood = cambia la pista.
  function toggleMusicPreview(mood: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingMood === mood) {
      audio.pause(); // onPause limpia playingMood
      return;
    }
    const token = `-${mood}-`;
    const pool = musicTracks.filter((t) => t.filename.toLowerCase().includes(token));
    if (pool.length === 0) {
      toast.error("No encontré pistas de este mood en tu biblioteca de música");
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    audio.src = pick.url;
    audio.currentTime = 0;
    audio
      .play()
      .then(() => setPlayingMood(mood))
      .catch(() => toast.error("No se pudo reproducir la pista — intenta de nuevo"));
  }

  // La descripción se genera SOLA al llegar al paso final (sin tocar botones).
  // El botón "Regenerar" queda para pedir otra versión. Si el video AÚN no tiene
  // transcripción (wizard homogéneo: se escucha recién al crear), se salta — el
  // job genera la descripción solo, por video, al final.
  useEffect(() => {
    if (step === 4 && !caption && !generatingCaption && firstSelected?.status.transcribed) {
      generateCaptionAI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Overrides del paso a paso que viajan IGUAL a la creación final y a la vista
  // previa (mismo mapeo): tema editorial, fondo animado e intensidad de FX.
  // "auto"/"normal" = undefined = el render sale como siempre.
  function overridesPayload() {
    const t = EDITORIAL_THEMES.find((x) => x.id === editorialTheme);
    return {
      editorialTheme: t
        ? { font: t.font, background: t.background, theme: t.theme || undefined }
        : undefined,
      motionBackground:
        motionBackground === "aurora" || motionBackground === "mesh" || motionBackground === "grid"
          ? motionBackground
          : undefined,
      fxIntensity:
        fxIntensity === "suave" || fxIntensity === "max"
          ? (fxIntensity as "suave" | "max")
          : undefined,
    };
  }

  // La vista previa REAL ("Mira cómo queda TU video") se quitó a pedido del usuario:
  // los estilos ya muestran miniaturas reales + previews EN MOVIMIENTO pre-generados
  // (style-thumbs / style-previews), y además requería transcript a mitad del wizard.

  function toggleStyle(s: StyleId) {
    setSelectedStyles((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  // Escucha (transcribe) en paralelo un lote de videos. Devuelve true si TODOS
  // quedaron listos. Los que fallan quedan en transcribeErrors, cada uno con su
  // mensaje humano y botón Reintentar en el paso 1.
  async function runTranscription(list: VideoEntry[]): Promise<boolean> {
    if (list.length === 0) return true;
    setTranscribing(true);
    setTranscribeQueue(list);
    // Si se reintenta un video que ya estaba en errores, sacarlo de la lista.
    setTranscribeErrors((prev) => prev.filter((e) => !list.some((v) => v.id === e.id)));
    try {
      const settled = await Promise.allSettled(
        list.map((v) =>
          fetch("/api/videos/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId: v.id }),
          }).then(async (res) => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "no se pudo escuchar el audio");
          })
        )
      );
      const failed = list.filter((_, i) => settled[i].status === "rejected");
      const ok = list.length - failed.length;
      if (ok > 0) {
        toast.success(
          ok === 1 && list.length === 1
            ? "Tu video ya tiene subtítulos ✓"
            : `${ok} de ${list.length} videos ya tienen subtítulos`
        );
      }
      if (failed.length > 0) setTranscribeErrors((prev) => [...prev, ...failed]);
      await loadVideos();
      return failed.length === 0;
    } catch (err) {
      toastError(err, "No se pudo escuchar tu video", {
        action: { label: "Reintentar", onClick: () => runTranscription(list) },
      });
      return false;
    } finally {
      setTranscribing(false);
      setTranscribeQueue([]);
    }
  }

  // Avanza al paso 2 DIRECTO (wizard homogéneo con largos): ya no se escucha el
  // video a mitad del flujo — TODO el trabajo (transcribir → construir → renderizar)
  // ocurre al final, cuando el usuario ya eligió todo. auto-build transcribe solo
  // si falta la transcripción (primer paso del job).
  async function advanceFromStep1() {
    if (selectedVideos.size === 0) return;
    setStep(2);
  }

  // Elige la descripción correcta según la primera plataforma seleccionada.
  function captionForPlatforms(copy: CaptionMeta): string {
    const tagJoin = (arr?: string[]) => (arr && arr.length ? "\n\n" + arr.join(" ") : "");
    if (selectedPlatforms.includes("linkedin")) {
      return (copy.caption_long ?? "") + tagJoin(copy.hashtags_linkedin);
    }
    if (selectedPlatforms.includes("instagram")) {
      return (copy.caption_short ?? "") + tagJoin(copy.hashtags_instagram);
    }
    if (selectedPlatforms.includes("facebook")) {
      return (copy.caption_short ?? "") + tagJoin(copy.hashtags_facebook);
    }
    return (copy.caption_short ?? "") + tagJoin(copy.hashtags_tiktok);
  }

  async function generateCaptionAI() {
    // Generamos el caption del PRIMER video del set; los demás se autogeneran
    // por video en el processJob si no traen captionMeta.
    if (!firstSelected) return;
    setGeneratingCaption(true);
    try {
      const res = await fetch(
        `/api/videos/${encodeURIComponent(firstSelected.id)}/generate-caption?provider=auto`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok || !data.copy) throw new Error(data.error ?? "no se generó la descripción");
      const copy = data.copy as CaptionMeta;
      setCaptionMeta(copy);
      setCaption(captionForPlatforms(copy));
      toast.success("✅ Tu descripción está lista");
    } catch (err) {
      toastError(err, "No se pudo generar la descripción", {
        action: { label: "Reintentar", onClick: generateCaptionAI },
      });
    } finally {
      setGeneratingCaption(false);
    }
  }

  // Cuerpo común del pedido a auto-build (lo usan handleBuild y el reintento
  // de un solo estilo, para que el reintento salga con LA MISMA configuración).
  function buildRequestBody(videoIds: string[], styles: StyleId[] | string[]) {
    return {
      videoIds,
      styles,
      accentColor: accent,
      // Vacio = sin banda. El backend solo pasa --name/--role si vienen.
      ...(speakerName.trim() ? { speakerName: speakerName.trim() } : {}),
      ...(speakerRole.trim() ? { speakerRole: speakerRole.trim() } : {}),
      subtitleFont,
      subtitleColor,
      // Submenús opcionales: solo viajan si el user cambió el default —
      // "auto"/"normal" = undefined = el render sale como siempre.
      ...overridesPayload(),
      // 🎵 Música: viaja SOLO a auto-build (no va en overridesPayload porque ese
      // payload también alimenta style-preview, y los stills no llevan audio).
      ...(music !== "auto" ? { music } : {}),
      // Igual que música: sólo viaja si se eligió algo. Sin esto el backend
      // decide como siempre, así que el default deja el render idéntico.
      // Viaja la lista solo si se eligio algo concreto. Con ["auto"] no viaja,
      // asi que el resultado es identico al de antes para quien no lo use.
      ...(brollSources.length && !brollSources.includes("auto")
        ? { brollSource: brollSources }
        : {}),
      // Misma regla: "auto" es el comportamiento historico, asi que no viaja.
      ...(brollPosition !== "auto" ? { brollPosition } : {}),
      // Que se agrega encima. Solo viaja lo que difiere del default, asi que
      // quien no lo toca obtiene exactamente el resultado de antes.
      ...(adornos.ilustraciones !== ADORNOS_POR_OMISION.ilustraciones
        ? { ilustraciones: adornos.ilustraciones } : {}),
      ...(adornos.iconos !== ADORNOS_POR_OMISION.iconos
        ? { iconosAnimados: adornos.iconos } : {}),
      ...(adornos.graficas !== ADORNOS_POR_OMISION.graficas
        ? { graficas: adornos.graficas } : {}),
      ...(adornos.estilos.length ? { estilosIlustracion: adornos.estilos } : {}),
      platforms: selectedPlatforms,
      aspectRatio,
      caption: caption || undefined,
      captionMeta: captionMeta ?? undefined,
      // Modo cinematográfico (opt-in). Si enabled=false, el render sale idéntico a antes.
      cinematic: cinematicConfig.enabled
        ? {
            overlayIds: cinematicConfig.overlayIds,
            filmGrain: cinematicConfig.filmGrain,
            vignette: cinematicConfig.vignette,
            subtitleCinematic: cinematicConfig.subtitleStyleCinematic,
          }
        : undefined,
      // F2.b — Bumper de marca (intro/outro). Opt-in: si no está activo, no viaja.
      brandBumper: bumperEnabled
        ? {
            enabled: true,
            tagline: bumperTagline || undefined,
            subtitle: bumperSubtitle || undefined,
            logoUrl: bumperLogoUrl || undefined,
            outro: bumperOutro,
            background: "dark" as const,
          }
        : undefined,
    };
  }

  // Polling cada 2s del progreso AGREGADO de los jobs. Compartido por la
  // creación normal, la reanudación tras un refresh (restored) y el botón
  // "Reintentar este estilo" del paso final (mergeInto = solo pisa ese combo).
  function startPolling(
    jobIds: string[],
    videoIds: string[],
    opts: { restored?: boolean; mergeInto?: string } = {}
  ) {
    let emptyPolls = 0;
    const poll = async () => {
      try {
        const responses = await Promise.allSettled(
          jobIds.map((jid) => fetch(`/api/editor/progress?jobId=${jid}`).then((r) => r.json()))
        );
        const jobs = responses
          .filter((r): r is PromiseFulfilledResult<{ job: { status: string; overallProgress: number; currentStyle?: string; steps: { styleId: string; status: string; progress: number; currentFrame?: number; totalFrames?: number; output?: string; error?: string }[] } }> => r.status === "fulfilled" && Boolean(r.value?.job))
          .map((r) => r.value.job);

        if (jobs.length === 0) {
          emptyPolls += 1;
          // Tras un refresh o reintento: si el job ya no existe (la app se
          // reinició y la cola se perdió), avisar en vez de esperar para siempre.
          if ((opts.restored || opts.mergeInto) && emptyPolls >= 2) {
            clearActiveJob();
            setBuilding(false);
            setJobProgress(null);
            setRetryingStyle(null);
            toast.error("Se interrumpió la creación — vuelve a intentarlo");
            return;
          }
          setTimeout(poll, 3000);
          return;
        }

        // Promedio de overallProgress de todos los jobs
        const avgProgress = Math.round(
          jobs.reduce((acc, j) => acc + j.overallProgress, 0) / jobs.length
        );
        // El "currentStyle" es del primer job running (los otros están queued o ya terminaron)
        const runningJob = jobs.find((j) => j.status === "running");
        // Agregar todos los steps de todos los jobs en una sola lista (prefijando videoId)
        const aggregatedSteps = jobs.flatMap((j, i) =>
          j.steps.map((s) => ({ ...s, styleId: `${videoIds[i]}::${s.styleId}` }))
        );

        if (!opts.mergeInto) {
          setJobProgress({
            overallProgress: avgProgress,
            currentStyle: runningJob?.currentStyle,
            steps: aggregatedSteps,
          });
        }

        const allDone = jobs.every((j) => j.status === "done" || j.status === "failed");
        if (allDone) {
          const allResults = jobs.flatMap((j, i) =>
            j.steps.map((s) => ({
              styleId: `${videoIds[i]}::${s.styleId}`,
              ok: s.status === "ok",
              output: s.output,
              error: s.error,
            }))
          );

          // Reintento de UN estilo desde el paso final: pisa solo ese resultado.
          if (opts.mergeInto) {
            const comboId = opts.mergeInto;
            const updated = allResults[0];
            setRetryingStyle(null);
            if (updated) {
              setResults((prev) =>
                prev.map((p) => (p.styleId === comboId ? { ...updated, styleId: comboId } : p))
              );
              if (updated.ok) {
                toast.success(`¡Listo! El estilo ${humanStyleName(comboId)} ya quedó perfecto`);
              } else {
                toastError(updated.error ?? "volvió a fallar", "Este estilo no se pudo crear", {
                  action: { label: "Reintentar", onClick: () => retryOneStyle(comboId) },
                });
              }
            }
            return;
          }

          setResults(allResults);
          const okCount = allResults.filter((r) => r.ok).length;
          if (okCount > 0) {
            toast.success(`¡Listo! ${okCount} de ${allResults.length} videos quedaron perfectos`);
          } else {
            toastError(
              allResults[0]?.error ?? "ningún estilo se pudo crear",
              "No se pudieron crear tus videos"
            );
          }
          clearActiveJob();
          setBuilding(false);
          setStep(5);
          return;
        }
        setTimeout(poll, 2000);
      } catch {
        setTimeout(poll, 4000);
      }
    };
    poll();
  }

  // Dispara la creación. `stylesOverride` permite arrancar con estilos explícitos
  // (lo usa "Hazlo por mí", que setea el preset y crea en el mismo tick: el estado
  // selectedStyles aún no se actualizó, así que NO se puede leer del closure).
  async function handleBuild(stylesOverride?: StyleId[]) {
    const styles = stylesOverride ?? selectedStyles;
    if (selectedVideos.size === 0 || styles.length === 0) return;
    setBuilding(true);
    setResults([]);
    setJobProgress(null);
    const videoIds = Array.from(selectedVideos);
    try {
      const res = await fetch("/api/editor/auto-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(videoIds, styles)),
      });
      const data = await res.json();
      if (!res.ok || !data.jobIds || data.jobIds.length === 0) {
        toastError(data.error ?? "no se pudo poner en fila", "No se pudo arrancar la creación", {
          action: { label: "Reintentar", onClick: () => handleBuild(stylesOverride) },
        });
        setBuilding(false);
        return;
      }
      const jobIds: string[] = data.jobIds;
      if (jobIds.length > 1) {
        toast.success(`${jobIds.length} videos en fila — se crean de a uno`);
      }
      // Progreso persistente: si recargas la página, el paso 4 se reanuda solo.
      try {
        window.localStorage.setItem(
          ACTIVE_JOB_KEY,
          JSON.stringify({ jobIds, videoIds, styles, ts: Date.now() })
        );
      } catch {
        /* sin almacenamiento — la creación sigue igual, solo no sobrevive al refresh */
      }
      startPolling(jobIds, videoIds);
    } catch (err) {
      toastError(err, "No se pudo arrancar la creación", {
        action: { label: "Reintentar", onClick: () => handleBuild(stylesOverride) },
      });
      setBuilding(false);
    }
  }

  // Re-encola SOLO un combo "videoId::estilo" que falló (botón del paso final).
  // Mismo cuerpo que handleBuild pero con un único video y un único estilo.
  async function retryOneStyle(comboId: string) {
    const parts = comboId.split("::");
    const styleId = parts.pop()!;
    const videoId = parts.length > 0 ? parts.join("::") : Array.from(selectedVideos)[0];
    if (!videoId || !styleId) return;
    setRetryingStyle(comboId);
    try {
      const res = await fetch("/api/editor/auto-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody([videoId], [styleId])),
      });
      const data = await res.json();
      if (!res.ok || !data.jobIds || data.jobIds.length === 0) {
        throw new Error(data.error ?? "no se pudo poner en fila");
      }
      startPolling(data.jobIds, [videoId], { mergeInto: comboId });
    } catch (err) {
      setRetryingStyle(null);
      toastError(err, "No se pudo arrancar la creación", {
        action: { label: "Reintentar", onClick: () => retryOneStyle(comboId) },
      });
    }
  }

  // Submenús del paso 2 definidos UNA vez y rendereados donde toque: dentro de su
  // tarjeta-preset activa, o sueltos cuando el estilo vino del modo avanzado
  // (la lógica condicional por selectedStyles se conserva tal cual).

  // Tema editorial (los 17 temas: 8 visibles + "Ver todos", con hints).

  const editorialThemePanel = (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="mb-2 text-sm font-medium">📰 Tema del estilo Editorial</p>
      {/* 17 temas sin abrumar: primero los 8 favoritos, el resto detrás de
          "Ver todos" (un niño elige entre pocos; el curioso despliega). */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(showAllThemes ? EDITORIAL_THEMES : EDITORIAL_THEMES.slice(0, 8)).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setEditorialTheme(t.id);
              // Sub-temas con identidad fuerte: sugerir su acento, pero
              // NUNCA pisar un color que el usuario ya eligió a mano.
              if ("accent" in t && t.accent && !accentTouched) {
                setAccent(t.accent);
                toast.info("Este tema trae su propio color — puedes cambiarlo en el paso 3");
              }
            }}
            className={`overflow-hidden rounded-lg border text-left transition-all ${
              editorialTheme === t.id
                ? "border-amber-400 ring-1 ring-amber-400"
                : "border-border hover:border-foreground/30"
            }`}
          >
            {/* Miniatura REAL del tema: un frame renderizado con Remotion sobre un
                video de verdad (generado dev-time por remotion/generate-theme-thumbs.mjs
                → /theme-thumbs/{id}.png). Si el PNG no existe, cae al mini-preview
                CSS de siempre (fondo + serif + SU acento). */}
            {thumbErrors.has(t.id) ? (
              <div className="flex h-14 flex-col justify-center overflow-hidden px-2" style={{ background: t.bg }}>
                <span className="truncate text-[7px] uppercase tracking-[0.3em]" style={{ color: t.text, opacity: 0.5 }}>
                  La verdad
                </span>
                <span className="truncate text-sm font-bold leading-tight" style={{ color: t.text, fontFamily: t.demoFont }}>
                  Título <em style={{ color: ("accent" in t && t.accent) || accent }}>clave.</em>
                </span>
              </div>
            ) : (
              <img
                src={`/theme-thumbs/${t.id}.png`}
                alt={`Tema ${t.name}`}
                loading="lazy"
                className="aspect-[9/16] w-full rounded-t-lg object-cover"
                onError={() =>
                  setThumbErrors((prev) => {
                    const next = new Set(prev);
                    next.add(t.id);
                    return next;
                  })
                }
              />
            )}
            <div className="px-2 py-1">
              <p className="truncate text-[10px] font-medium">{t.name}</p>
              <p className="truncate text-[9px] text-muted-foreground" title={t.hint}>
                {t.hint}
              </p>
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
  );

  // Fondo animado (estilos motion_*). "Automático" = el fondo ideal de cada estilo.
  const motionBackgroundPanel = (
    <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
      <p className="mb-1 text-sm font-medium">✨ Fondo animado</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Opcional: con &quot;Automático&quot; cada estilo Motion usa su fondo ideal.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MOTION_BACKGROUNDS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setMotionBackground(b.id)}
            className={`overflow-hidden rounded-lg border text-left transition-all ${
              motionBackground === b.id
                ? "border-cyan-400 ring-1 ring-cyan-400"
                : "border-border hover:border-foreground/30"
            }`}
          >
            <div className="h-12" style={b.preview} />
            <div className="px-2 py-1">
              <p className="truncate text-[11px] font-medium">{b.name}</p>
              <p className="truncate text-[9px] text-muted-foreground">{b.hint}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // Intensidad de FX (estilos hype*/supreme). "Normal" viene elegido —
  // no tocar nada = el balance original de cada estilo.
  const FX_COLOR = "#fb923c"; // naranja (identidad del panel de intensidad)
  const fxIntensityPanel = (
    <div className="mt-3 rounded-xl border border-orange-500/30 bg-orange-500/5 p-5">
      <p className="mb-1 text-base font-semibold">🔥 ¿Cuánta energía quieres?</p>
      <p className="mb-4 text-sm text-muted-foreground">
        Controla la fuerza de los <strong className="text-foreground">zooms</strong> y los{" "}
        <strong className="text-foreground">efectos</strong> de los estilos Viral y Premium.
        Es opcional: con &quot;Normal&quot; queda en el balance recomendado.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FX_INTENSITIES.map((f, fi) => {
          const selected = fxIntensity === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFxIntensity(f.id)}
              className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
              style={{
                borderColor: selected ? FX_COLOR : `${FX_COLOR}40`,
                backgroundColor: selected ? `${FX_COLOR}1f` : `${FX_COLOR}0d`,
                boxShadow: selected ? `0 0 0 2px ${FX_COLOR}, 0 10px 30px -12px ${FX_COLOR}` : undefined,
              }}
            >
              {selected && (
                <CheckCircle2 className="absolute right-3 top-3 h-5 w-5" style={{ color: FX_COLOR }} />
              )}
              {/* mini-preview GRANDE: 1/2/3 rayos latiendo a la velocidad del nivel */}
              <div className="flex h-12 items-center justify-center gap-1.5 rounded-lg bg-black/40">
                {Array.from({ length: fi + 1 }).map((_, j) => (
                  <span
                    key={j}
                    className="animate-pulse text-2xl"
                    style={{ animationDuration: `${1.6 - fi * 0.5}s`, animationDelay: `${j * 0.15}s` }}
                  >
                    ⚡
                  </span>
                ))}
              </div>
              <div>
                <p className="text-lg font-semibold">
                  {f.emoji} {f.name}
                </p>
                <p className="mt-1 text-sm leading-snug text-muted-foreground">{f.hint}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // 🎵 Música de fondo (estilos broll_*/motion_*/editorial — los que llevan
  // música). "Automática" viene elegida: no tocar nada = el sistema elige y
  // rota la pista como siempre. Cada mood tiene ▶ Escuchar (~10s de muestra).
  const isMoodChoice = typeof music === "object";
  const musicPanel = (
    <div className="mt-3 rounded-lg border border-pink-500/30 bg-pink-500/5 p-4">
      <p className="mb-1 text-sm font-medium">🎵 Música de fondo</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Opcional: este estilo lleva música. Elige el mood, o déjalo en automático y el
        sistema escoge una pista distinta para cada video.
      </p>
      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMusic("auto");
          }}
          className={`rounded-lg border p-3 text-left transition-all ${
            music === "auto"
              ? "border-pink-400 ring-1 ring-pink-400 bg-pink-500/10"
              : "border-border hover:border-foreground/30"
          }`}
        >
          <p className="text-sm font-medium">✨ Automática</p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            Recomendada — el sistema elige la pista y la va rotando entre videos
          </p>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMusic("none");
          }}
          className={`rounded-lg border p-3 text-left transition-all ${
            music === "none"
              ? "border-pink-400 ring-1 ring-pink-400 bg-pink-500/10"
              : "border-border hover:border-foreground/30"
          }`}
        >
          <p className="text-sm font-medium">🔇 Sin música</p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            Solo tu voz (y los efectos del estilo, si los tiene)
          </p>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MUSIC_MOODS.map((m) => {
          const selected = isMoodChoice && music.mood === m.id;
          const playing = playingMood === m.id;
          return (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setMusic({ mood: m.id });
              }}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setMusic({ mood: m.id });
                }
              }}
              className={`cursor-pointer rounded-lg border p-3 text-left transition-all ${
                selected
                  ? "border-pink-400 ring-1 ring-pink-400 bg-pink-500/10"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              <p className="truncate text-sm font-medium">
                {m.emoji} {m.name}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{m.hint}</p>
              <button
                type="button"
                onClick={(e) => {
                  // Que escuchar la muestra NO seleccione el mood ni suba el click.
                  e.stopPropagation();
                  toggleMusicPreview(m.id);
                }}
                className={`mt-2 w-full rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  playing
                    ? "border-pink-400 bg-pink-500/20 text-pink-300"
                    : "border-border/70 text-muted-foreground hover:border-pink-400/50 hover:text-foreground"
                }`}
              >
                {playing ? "⏸ Pausar" : "▶ Escuchar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  // 🎬 Panel cinematográfico (estilo cinematic_pro): aparece INLINE en el paso 2
  // —igual que el tema editorial— cuando el estilo está elegido. Trae el picker de
  // overlays (opcional) + toggles de film grain/vignette/subtítulos cine. El estilo
  // ya produce un look de cine válido sin subir nada; esto es para personalizar.
  const cinematicPanel = firstSelected ? (
    <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
      <CinematicStep
        videoId={firstSelected.id}
        transcriptPath={
          firstSelected.status.transcribed
            ? `${rawDir.replace(/[/\\]raw[/\\]?$/, "")}/transcripts/${firstSelected.id}.json`
            : null
        }
        videoDurationSec={firstSelected.durationSec ?? undefined}
        value={cinematicConfig}
        onChange={setCinematicConfig}
      />
    </div>
  ) : null;

  return (
    <div className="space-y-6 pb-28">
      {/* UN solo <audio> compartido para las muestras de música del paso 2:
          reproducir un mood pausa el anterior, y a los ~10s se detiene solo. */}
      <audio
        ref={audioRef}
        className="hidden"
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime >= 10) e.currentTarget.pause();
        }}
        onPause={() => setPlayingMood(null)}
        onEnded={() => setPlayingMood(null)}
      />
      {/* Stepper visual — muestra el recorrido completo para que el usuario sepa dónde está.
          Pasos hechos: check verde, paso actual: bg primary con glow, futuros: gris. */}
      <div className="flex items-start gap-1 text-xs sm:gap-2">
        {["Video", "Estilo", "Color", "Crear", "Listo"].map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const current = step === n;
          return (
            <div key={n} className="flex items-start gap-1 sm:gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all duration-300",
                    current && "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/40 scale-110",
                    done && "border-primary/60 bg-primary/15 text-primary",
                    !current && !done && "border-border bg-card text-muted-foreground"
                  )}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : n}
                </div>
                <span
                  className={cn(
                    "text-[10px] transition-colors",
                    current && "font-semibold text-foreground",
                    done && "font-medium text-foreground/80",
                    !current && !done && "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
              {n < TOTAL_STEPS && (
                <div
                  className={cn(
                    "mt-4 h-0.5 w-5 rounded-full transition-colors duration-300 sm:w-8",
                    done ? "bg-gradient-to-r from-primary to-primary/60" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* STEP 1: videos (multi-select) */}
      {step === 1 && (
        <Card className="border-border bg-card p-6">
          {/* Traer de YouTube. Deja el archivo en la MISMA carpeta que
              "importar desde mi compu", asi que desde ahi el pipeline es
              identico: no hay un camino aparte que pueda comportarse distinto. */}
          <div className="mb-4 rounded-md border border-red-500/25 bg-red-500/5 p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-red-200">¿Está en YouTube?</span>{" "}
              Pegá el enlace y se baja solo, en H.264 hasta 1080p — que es lo que
              el resto del pipeline procesa más rápido.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={urlYt}
                onChange={(e) => setUrlYt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") bajarDeYoutube();
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono-tab text-xs outline-none focus:border-red-500/60"
              />
              <button
                type="button"
                onClick={bajarDeYoutube}
                disabled={bajandoYt || !urlYt.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-400 disabled:opacity-40"
              >
                {bajandoYt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Traer de YouTube
              </button>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-lg font-medium">1. Elige tus videos</h2>
            <div className="flex items-center gap-2">
              <span className="font-mono-tab text-[10px] text-muted-foreground">
                {selectedVideos.size} de {videos.length} seleccionado{selectedVideos.size === 1 ? "" : "s"}
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-brand-pink/40 bg-brand-pink/10 px-2.5 py-1 text-xs font-medium text-brand-pink hover:bg-brand-pink/20">
                {importing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <FileVideo className="h-3 w-3" />
                )}
                {importing ? "importando…" : "importar desde mi compu"}
                <input
                  ref={importInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm"
                  multiple
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => e.target.files && importVideos(e.target.files)}
                />
              </label>
            </div>
          </div>

          {videos.length === 0 ? (
            <EmptyState
              icon={FileVideo}
              tone="amber"
              title="Trae tu primer video"
              description="Elige un video de tu computadora (MP4, MOV o similar) y la app lo edita por ti."
              cta={{
                label: importing ? "Importando…" : "Importar desde mi compu",
                onClick: () => importInputRef.current?.click(),
              }}
            />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedVideos(new Set(videos.map((v) => v.id)))}
                  className="rounded border border-border bg-muted/30 px-2 py-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  seleccionar todos ({videos.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedVideos(new Set())}
                  disabled={selectedVideos.size === 0}
                  className="rounded border border-border bg-muted/30 px-2 py-1 font-mono-tab text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  quitar selección
                </button>
                <span className="ml-auto font-mono-tab text-[10px] text-muted-foreground">
                  ↕ scroll para ver más
                </span>
              </div>
              {/* Grid compacto + scroll. Más columnas = thumbs más chicos. */}
              <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border/50 bg-background/30 p-2">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                  {videos.map((v) => {
                    const sel = selectedVideos.has(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => toggleVideo(v.id)}
                        className={`group relative flex flex-col overflow-hidden rounded border bg-card text-left transition-all ${
                          sel
                            ? "border-brand-pink ring-1 ring-brand-pink"
                            : "border-border hover:border-foreground/30"
                        }`}
                      >
                        {sel && (
                          <div className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-brand-pink text-white shadow">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          </div>
                        )}
                        <div className="aspect-[9/16] overflow-hidden bg-zinc-900">
                          <img
                            src={`/api/videos/${encodeURIComponent(v.id)}/thumbnail`}
                            alt={v.filename}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="px-1.5 py-1">
                          <p className="line-clamp-1 text-[10px] font-medium" title={v.filename}>
                            {v.filename}
                          </p>
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-mono-tab text-[9px] text-muted-foreground">
                              {v.durationSec
                                ? `${Math.floor(v.durationSec / 60)}:${(Math.floor(v.durationSec % 60))
                                    .toString()
                                    .padStart(2, "0")}`
                                : "?"}
                            </p>
                            {v.status.transcribed ? (
                              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />
                            ) : (
                              <Mic className="h-2.5 w-2.5 text-amber-400" />
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* El camino es "Siguiente" (abajo) → elegir estilo, formato y colores. */}
              <div className="mt-4 flex flex-col items-center gap-2 text-center">
                <p className="text-sm">
                  Toca <b className="text-foreground">«Siguiente»</b> (abajo) para elegir
                  el <b className="text-foreground">estilo</b>, el{" "}
                  <b className="text-foreground">formato</b> y los{" "}
                  <b className="text-foreground">colores</b>.
                </p>
              </div>
            </>
          )}

          {/* Transcripción VISIBLE: mientras la app escucha los videos para crear
              los subtítulos, se dice claro qué pasa y cuánto puede tardar. */}
          {transcribing && (() => {
            const totalSec = transcribeQueue.reduce((a, v) => a + (v.durationSec ?? 0), 0);
            // Estimado conservador: ~1 min de espera por minuto de video.
            const est = totalSec > 0 ? Math.max(1, Math.ceil(totalSec / 60)) : null;
            return (
              <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-400" />
                  <span>
                    🎧 Estamos escuchando {transcribeQueue.length === 1 ? "tu video" : "tus videos"}{" "}
                    para crear los subtítulos…{est ? ` (~${est} min)` : ""}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Esto se hace una sola vez por video. Deja esta pantalla abierta mientras tanto.
                </p>
              </div>
            );
          })()}

          {/* Videos cuyo audio no se pudo escuchar: mensaje humano + Reintentar. */}
          {!transcribing && transcribeErrors.length > 0 && (
            <div className="mt-4 space-y-2">
              {transcribeErrors.map((v) => (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm"
                >
                  <p>
                    No pudimos escuchar el audio de «{v.filename}». Revisa que el video tenga voz.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => runTranscription([v])}>
                    Reintentar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* STEP 2: estilos + aspect ratio */}
      {step === 2 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">2. Elige formato y estilo(s)</h2>

          {/* Formato de salida: 3 TARJETAS GRANDES (estilo home-card), incluido el
              cuadrado 1:1. Se arman desde FORMATS para no repetir markup. */}
          <div className="mb-5">
            <p className="mb-2 text-sm font-medium">¿Para dónde es el video?</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {FORMATS.map((f) => {
                const active = aspectRatio === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setAspectRatio(f.id)}
                    className="group relative flex flex-col items-center gap-1.5 rounded-xl border p-4 text-center transition-all duration-200 hover:-translate-y-0.5"
                    style={{
                      borderColor: active ? f.color : `${f.color}40`,
                      backgroundColor: active ? `${f.color}1f` : `${f.color}0d`,
                      boxShadow: active
                        ? `0 0 0 2px ${f.color}, 0 8px 24px -10px ${f.color}`
                        : undefined,
                    }}
                  >
                    {/* Forma REAL del lienzo, para que se vea de un vistazo. */}
                    <span className="flex h-12 items-center justify-center">
                      <span
                        className="rounded-sm"
                        style={{
                          ...f.box,
                          backgroundColor: f.color,
                          boxShadow: `0 0 14px ${f.color}66`,
                        }}
                      />
                    </span>
                    <span className="text-base font-semibold">
                      {f.emoji} {f.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{f.where}</span>
                    <span className="font-mono-tab text-[10px] text-muted-foreground/70">{f.size}</span>
                    {active && (
                      <span
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: f.color }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Elegí <strong className="text-foreground">uno o varios estilos</strong> abajo, cada uno
            con su vista previa y descripción (se crea un video por cada uno y los comparás). El
            color, la letra y la música se ajustan en el paso siguiente y en los submenús de cada estilo.
          </p>

          {/* Estado "Personalizado": multi-selección o un estilo sin familia
              (text_behind) elegidos en el modo avanzado — ninguna tarjeta activa
              y este pill lo dice claro, sin pelearse con la selección. */}
          {!activePreset && selectedStyles.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs">
              <span className="font-medium text-violet-300">🎛️ Personalizado</span>
              <span className="rounded-full border border-violet-400/40 px-2 py-0.5 font-mono-tab text-[10px] text-violet-200">
                Estilos elegidos: {selectedStyles.length}
              </span>
              <span className="text-muted-foreground">
                — armaste tu propia combinación en el modo avanzado de abajo.
              </span>
            </div>
          )}


          {/* La vista previa REAL también vive acá: elegir estilo viendo cómo queda. */}


          <p className="mt-4 text-xs text-muted-foreground">
            {selectedStyles.length === 0
              ? "Elige al menos un estilo"
              : `${selectedStyles.length} estilo${selectedStyles.length === 1 ? "" : "s"} elegido${selectedStyles.length === 1 ? "" : "s"}`}
          </p>

          {/* TODOS LOS ESTILOS, visibles por defecto y como selector PRINCIPAL:
              multi-selección (prende/apaga varios → se crea un video por cada uno).
              Antes estaba colapsado en "modo avanzado" y la gente no veía los 15-18
              estilos ni podía elegir varios (las 5 tarjetas-preset de arriba son de
              selección única). Incluye text_behind, que no entra en ninguna familia. */}
          <details open className="mt-5 rounded-lg border-2 border-primary/30 bg-card">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold hover:text-foreground">
              🎨 Todos los estilos — elige uno o VARIOS (cada uno con su vista previa)
            </summary>
            <div className="border-t border-border p-4">
              <p className="mb-3 text-xs text-muted-foreground">
                Toca para prender/apagar cada estilo. Puedes elegir <b>varios a la vez</b> para
                comparar — se crea un video por cada estilo. El color, la tipografía y la música
                se ajustan en el siguiente paso y en los submenús de cada estilo.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {STYLES.map((s) => {
                  const selected = selectedStyles.includes(s.id);
                  return (
                    // Tarjeta GRANDE seleccionable. Es <div role="button"> (no
                    // <button>) para poder anidar el botón "Ver ejemplo" sin
                    // romper hidratación (regla del proyecto: nada de button-en-button).
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleStyle(s.id)}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          toggleStyle(s.id);
                        }
                      }}
                      className={`relative flex cursor-pointer items-center gap-4 rounded-xl border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                        selected
                          ? "border-primary ring-2 ring-primary bg-primary/5"
                          : "border-border hover:border-foreground/30"
                      }`}
                    >
                      {s.recommended && (
                        <span className="absolute -top-2 left-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          Recomendado
                        </span>
                      )}
                      {/* Mini-demo EN MOVIMIENTO del estilo: se entiende sin leer. */}
                      <StyleMiniDemo styleId={s.id} accent={accent} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold">{s.name}</span>
                          {BROLL_CAPABLE_STYLE_IDS.includes(
                            s.id as (typeof BROLL_CAPABLE_STYLE_IDS)[number]
                          ) && (
                            // Se dice ANTES de elegir. Antes solo se descubria
                            // seleccionando el estilo y viendo si aparecia el
                            // selector de fuentes mas abajo.
                            <span
                              title="Acepta videos, fotos o GIFs de apoyo — la fuente se elige mas abajo"
                              className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-300"
                            >
                              + material
                            </span>
                          )}
                          {selected && <CheckCircle2 className="h-5 w-5 text-primary" />}
                        </div>
                        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{s.tagline}</p>
                        {/* 👁️ Ver cómo se vería: abre el modal con el demo GRANDE
                            (sin renderizar nada). stopPropagation: no togglea la tarjeta. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewStyleId(s.id);
                          }}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                        >
                          👁️ Ver cómo se vería
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>

          {/* Submenús del estilo elegido: van DEBAJO de la grilla, no encima.
              Estaban arriba, y la grilla vive dentro de un desplegable al final
              del paso — así que elegías un estilo abajo del todo y su opción
              aparecía muy por encima, fuera de la pantalla. La opción existía y
              no se veía, que para quien la usa es igual que no existir.

              Acá abajo aparecen justo despues de la eleccion, en el orden en que
              se leen: primero de dónde salen las imágenes, después el aspecto. */}
          {selectedStyles.some((s) => BROLL_STYLES.includes(s)) && (
            <>
              <BrollSourcePicker valor={brollSources} onChange={setBrollSources} />
              <BrollPositionPicker valor={brollPosition} onChange={setBrollPosition} />
            </>
          )}
            {selectedStyles.some((s) => ADORNO_STYLE_IDS.includes(s as (typeof ADORNO_STYLE_IDS)[number])) && (
              <AdornosPicker valor={adornos} onChange={setAdornos} />
            )}
          {selectedStyles.some((s) => EDITORIAL_LAYOUT_STYLES.includes(s)) && editorialThemePanel}
          {selectedStyles.some((s) => MOTION_STYLES.includes(s)) && motionBackgroundPanel}
          {selectedStyles.some((s) => HYPE_STYLES.includes(s)) && fxIntensityPanel}
          {/* 🎬 Cinematográfico: picker de overlays + toggles cine, inline. */}
          {hasCinematic && cinematicPanel}
          {/* 🎵 Música: si hay algún estilo con música elegido. */}
          {selectedStyles.some((s) => MUSIC_STYLES.includes(s)) && musicPanel}
        </Card>
      )}

      {/* STEP 3: color */}
      {step === 3 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-medium">3. Elige el color principal</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {editorialOnly
              ? "En el estilo Editorial este color pinta las palabras destacadas de los titulares y las ilustraciones animadas."
              : "Este color se usa en todo el video: el resaltado de los subtítulos, los stickers y los detalles. Elige el que mejor vaya con tu marca o tu mensaje."}
          </p>
          {/* F1.b — Marca automática: deriva acento + tema del logo/URL en un paso. */}
          <BrandKitPicker
            themeIds={EDITORIAL_THEMES.map((t) => t.id)}
            onApply={(r) => {
              setAccent(r.accent);
              setAccentTouched(true);
              if (hasEditorial && EDITORIAL_THEMES.some((t) => t.id === r.themeId)) {
                setEditorialTheme(r.themeId);
              }
            }}
          />

          {/* F2.b — Bumper de marca (intro/outro con logo animado + tagline). Opt-in. */}
                    <div className="rounded-lg border border-border/60 p-3">
            <span className="text-sm font-medium">🏷️ Banda con tu nombre</span>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Aparece una vez al principio, como en una entrevista de tele. Dejalo
              vacío si no la querés.
            </p>
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={speakerName}
                onChange={(e) => setSpeakerName(e.target.value)}
                placeholder="Nombre (ej. Poncho Villalobos)"
                maxLength={40}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/60"
              />
              <input
                type="text"
                value={speakerRole}
                onChange={(e) => setSpeakerRole(e.target.value)}
                placeholder="Cargo o descripción (ej. Estratega de contenido)"
                maxLength={40}
                disabled={!speakerName.trim()}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/60 disabled:opacity-40"
              />
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-border bg-muted/20 p-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={bumperEnabled}
                onChange={(e) => setBumperEnabled(e.target.checked)}
                className="h-4 w-4 accent-violet-500"
              />
              <span className="text-sm font-medium">🎬 Agregar intro/outro de marca</span>
            </label>
            <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
              Un sting corto con tu logo animado + una frase, al inicio (y cierre) del video.
            </p>
            {bumperEnabled && (
              <div className="mt-3 space-y-2 pl-6">
                <input
                  type="text"
                  value={bumperTagline}
                  onChange={(e) => setBumperTagline(e.target.value)}
                  placeholder="Frase principal (ej. ESTRATEGIA VIRAL)"
                  maxLength={40}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/60"
                />
                <input
                  type="text"
                  value={bumperSubtitle}
                  onChange={(e) => setBumperSubtitle(e.target.value)}
                  placeholder="Subtexto opcional (ej. @tu_handle)"
                  maxLength={30}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/60"
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={bumperOutro}
                    onChange={(e) => setBumperOutro(e.target.checked)}
                    className="h-3.5 w-3.5 accent-violet-500"
                  />
                  También al final (outro)
                </label>
                {/* El logo. El backend lo soporta de punta a punta —schema,
                    BrandBumper, build-props— y el UNICO eslabon que faltaba era
                    este: no habia donde escribirlo, asi que `setBumperLogoUrl`
                    no se llamaba nunca y el sting salia siempre sin logo,
                    mientras el texto de arriba prometia "tu logo animado". */}
                <input
                  type="url"
                  value={bumperLogoUrl}
                  onChange={(e) => setBumperLogoUrl(e.target.value)}
                  placeholder="URL de tu logo (PNG con fondo transparente)"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-violet-500/60"
                />
                {bumperLogoUrl ? (
                  <p className="text-[10px] text-emerald-400">✓ Usando el logo de tu marca</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Sin logo, el sting sale solo con la frase.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(() => {
              // Si hay tema editorial con acento propio, se antepone como swatch
              // "Del tema ⭐" — así el selector nunca queda sin selección cuando
              // el tema sugirió su color.
              const themeDef = hasEditorial
                ? EDITORIAL_THEMES.find((x) => x.id === editorialTheme)
                : undefined;
              const themeAccent =
                themeDef && "accent" in themeDef && themeDef.accent ? themeDef.accent : null;
              const swatches = themeAccent
                ? [
                    { name: "Del tema ⭐", value: themeAccent, mood: "recomendado" },
                    ...PALETTE.filter((c) => c.value !== themeAccent),
                  ]
                : PALETTE;
              return swatches.map((c) => {
              const selected = accent === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setAccent(c.value);
                    // El usuario eligió color a mano: los temas ya no lo pisan.
                    setAccentTouched(true);
                  }}
                  className={`flex flex-col items-center gap-2 rounded-lg border p-3 transition-all ${
                    selected ? "border-foreground" : "border-border hover:border-foreground/30"
                  }`}
                >
                  <div
                    className="h-12 w-12 rounded-full"
                    style={{ background: c.value, boxShadow: selected ? `0 0 24px ${c.value}66` : "none" }}
                  />
                  <span className="text-xs font-medium">{c.name}</span>
                  <span className="font-mono-tab text-[10px] text-muted-foreground">{c.mood}</span>
                </button>
              );
              });
            })()}
          </div>

          {/* Editorial-solo: la tipografía/colores del texto vienen del TEMA del paso 2,
              así que los selectores de subtítulos no aplican y se ocultan. */}
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
          <h3 className="mb-2 mt-6 text-sm font-medium">Color del texto de los subtítulos</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            El color de las palabras (el resaltado de la palabra activa usa el color principal de
            arriba). &quot;Automático&quot; usa el del estilo.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SUBTITLE_COLORS.map((c) => {
              const selected = subtitleColor === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSubtitleColor(c.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                    selected ? "border-foreground bg-muted/40 ring-1 ring-foreground/30" : "border-border hover:border-foreground/30"
                  }`}
                >
                  {/* Muestra del color sobre fondo oscuro, como se ve en el video. */}
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

          {/* Preview en vivo: cómo se ven los subtítulos con color + resaltado + fuente. */}
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
              subtítulos
            </span>
          </div>
            </>
          )}

          {/* F4 — Vista previa REAL (compartida con el paso 2). */}


          {!editorialOnly && (
            <>
          <h3 className="mb-2 mt-6 text-sm font-medium">Tipografía de los subtítulos</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            &quot;Automática&quot; usa la del estilo. O elige una para darle otra personalidad.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {SUBTITLE_FONTS.map((f) => {
              const selected = subtitleFont === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSubtitleFont(f.id)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 transition-all ${
                    selected ? "border-foreground bg-muted/40 ring-1 ring-foreground/30" : "border-border hover:border-foreground/30"
                  }`}
                >
                  {/* Miniatura: muestra en la fuente real para que se vea cómo es. */}
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

      {/* STEP 4: redes + caption + confirmar */}
      {step === 4 && (
        <Card className="border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-medium">4. Revisa y crea tu video</h2>
          {/* La descripción para cada red se genera SOLA en segundo plano y aparece
              lista junto al video en "Mis videos". No se muestra acá: el menú de
              editar/regenerar confundía al usuario. (Sigue en el payload + /produccion.) */}

          {/* El modo cinematográfico dejó de ser una opción enterrada en este paso:
              ahora es la tarjeta de estilo "Cinematográfico" (cinematic_pro) del paso 2,
              con su picker de overlays inline. El resumen de abajo reporta si está activo. */}

          {/* RESUMEN en TARJETAS GRANDES: todo lo elegido, fácil de revisar de
              un vistazo, con la miniatura de cada estilo. */}
          {(() => {
            const fmt = FORMATS.find((f) => f.id === aspectRatio);
            const colorName = (() => {
              const p = PALETTE.find((c) => c.value === accent);
              if (p) return p.name;
              const t = EDITORIAL_THEMES.find((x) => "accent" in x && x.accent === accent);
              return t ? `del tema ${t.name}` : accent;
            })();
            const fontName = SUBTITLE_FONTS.find((f) => f.id === subtitleFont)?.name ?? "Automática";
            const musicLabel =
              music === "auto"
                ? "Automática"
                : music === "none"
                  ? "Sin música"
                  : MUSIC_MOODS.find((m) => m.id === music.mood)?.name ?? "Elegida";
            const fxLabel = FX_INTENSITIES.find((f) => f.id === fxIntensity)?.name ?? "Normal";
            const hasMusicStyle = selectedStyles.some((s) => MUSIC_STYLES.includes(s));
            const hasFxStyle = selectedStyles.some((s) => HYPE_STYLES.includes(s));
            const totalVideos = selectedVideos.size * selectedStyles.length;
            return (
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* FORMATO */}
                <div className="rounded-xl border p-4" style={{ borderColor: `${fmt?.color ?? "#fb7185"}40`, backgroundColor: `${fmt?.color ?? "#fb7185"}0d` }}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Formato</p>
                  <p className="mt-1 text-lg font-semibold">{fmt?.emoji} {fmt?.title}</p>
                  <p className="text-sm text-muted-foreground">{fmt?.where} · {fmt?.size}</p>
                </div>

                {/* COLOR */}
                <div className="rounded-xl border p-4" style={{ borderColor: `${accent}40`, backgroundColor: `${accent}0d` }}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Color principal</p>
                  <div className="mt-1 flex items-center gap-3">
                    <span
                      className="h-10 w-10 shrink-0 rounded-full"
                      style={{ background: accent, boxShadow: `0 0 16px ${accent}66` }}
                    />
                    <p className="text-lg font-semibold capitalize">{colorName}</p>
                  </div>
                </div>

                {/* ESTILOS con miniatura */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Estilo{selectedStyles.length === 1 ? "" : "s"} ({selectedStyles.length})
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {selectedStyles.map((sid) => (
                      <div key={sid} className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5">
                        <StyleMiniDemo styleId={sid} accent={accent} />
                        <span className="text-sm font-semibold">{humanStyleName(sid)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LETRA / FUENTE */}
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Letra de los subtítulos</p>
                  <p
                    className="mt-1 text-2xl font-semibold leading-none"
                    style={{ fontFamily: FONT_PREVIEW[subtitleFont] || undefined }}
                  >
                    {subtitleFont === "auto" ? "Automática" : "Viral"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{fontName}</p>
                </div>

                {/* MÚSICA / INTENSIDAD (solo si aplica al/los estilo/s elegido/s) */}
                {(hasMusicStyle || hasFxStyle) && (
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    {hasMusicStyle && (
                      <>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">🎵 Música</p>
                        <p className="mt-1 text-lg font-semibold">{musicLabel}</p>
                      </>
                    )}
                    {hasFxStyle && (
                      <>
                        <p className={`text-xs font-medium uppercase tracking-wider text-muted-foreground ${hasMusicStyle ? "mt-3" : ""}`}>🔥 Intensidad</p>
                        <p className="mt-1 text-lg font-semibold">{fxLabel}</p>
                      </>
                    )}
                  </div>
                )}

                {/* VIDEOS + TIEMPO */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:col-span-2">
                  <p className="text-sm">
                    Vas a generar{" "}
                    <span className="font-semibold text-foreground">
                      {totalVideos} video{totalVideos === 1 ? "" : "s"}
                    </span>
                    {selectedStyles.length > 1 &&
                      ` (${selectedVideos.size} video${selectedVideos.size === 1 ? "" : "s"} en ${selectedStyles.length} estilos)`}
                    .
                  </p>
                  <p className="mt-1 text-sm text-amber-400">
                    ⏱️ Va a tardar alrededor de {4 * totalVideos} minutos. Se crean de a uno —
                    puedes seguir usando la app mientras tanto.
                  </p>
                  {cinematicConfig.enabled && (
                    <p className="mt-1 text-sm text-violet-300">
                      🎬 Modo cinematográfico ACTIVO: {cinematicConfig.overlayIds.length}{" "}
                      {cinematicConfig.overlayIds.length === 1 ? "imagen" : "imágenes"}
                      {cinematicConfig.filmGrain ? " · film grain" : ""}
                      {cinematicConfig.vignette ? " · vignette" : ""}
                      {cinematicConfig.subtitleStyleCinematic ? " · subs cine" : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Vista previa REAL del video con el estilo elegido, justo antes de crear:
              el usuario ve una foto/gif de cómo queda antes de tocar "Crear". */}


          {/* Botón GRANDE y prominente: el momento clave del wizard. */}
          <Button
            onClick={() => handleBuild()}
            disabled={building}
            className="mt-6 h-16 w-full text-lg font-bold shadow-lg shadow-primary/30 transition-transform hover:scale-[1.01]"
          >
            {building ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Creando tus videos…
              </>
            ) : (
              <>
                ✨ Crear mis videos
                <ChevronRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>

          {building && jobProgress && (
            <div className="mt-6 space-y-4">
              {/* Barra global */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Generando tus videos…
                  </span>
                  <span className="font-mono-tab text-primary">
                    {jobProgress.overallProgress}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-brand-gradient shadow-[0_0_18px_rgba(250,60,141,0.55)] transition-all duration-500"
                    style={{ width: `${jobProgress.overallProgress}%` }}
                  />
                </div>
              </div>

              {/* Por estilo */}
              <ul className="space-y-2">
                {jobProgress.steps.map((step) => (
                  <li key={step.styleId} className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {step.status === "ok" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : step.status === "fail" ? (
                          <span className="h-3.5 w-3.5 text-red-400">✗</span>
                        ) : step.status === "rendering" || step.status === "building" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-pink" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground" />
                        )}
                        <span className="font-medium">{humanStyleName(step.styleId)}</span>
                        <span className="text-muted-foreground">
                          {step.status === "ok"
                            ? "· listo"
                            : step.status === "fail"
                              ? "· falló"
                              : step.status === "building"
                                ? "· preparando…"
                                : step.status === "rendering"
                                  ? "· generando…"
                                  : "· en espera"}
                        </span>
                      </div>
                      <span className="font-mono-tab text-muted-foreground">
                        {step.progress}%
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full transition-all duration-500 ${
                          step.status === "ok"
                            ? "bg-emerald-400"
                            : step.status === "fail"
                              ? "bg-red-400"
                              : "bg-brand-pink/60"
                        }`}
                        style={{ width: `${step.progress}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* STEP 5: resultados — cierre celebratorio */}
      {step === 5 && (
        <Card className="border-border bg-card p-6">
          {results.some((r) => r.ok) && <Confetti />}
          {(() => {
            const okCount = results.filter((r) => r.ok).length;
            const allOk = okCount === results.length && okCount > 0;
            return (
              <div className="mb-5 px-2 text-center sm:px-0">
                <div className="mx-auto mb-2 text-3xl sm:text-5xl">
                  {allOk ? "🎉" : okCount > 0 ? "✅" : "⚠️"}
                </div>
                <h2 className="text-xl font-semibold sm:text-2xl">
                  {okCount === 0
                    ? "No se pudo generar el video"
                    : okCount === 1
                      ? "¡Tu video está listo!"
                      : `¡Listo! Se generaron ${okCount} videos`}
                </h2>
                {okCount > 0 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ya puedes verlo y publicarlo en tus redes.
                  </p>
                )}
              </div>
            );
          })()}
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-md border p-3 text-sm ${
                  r.ok ? "border-primary/40 bg-primary/5" : "border-red-500/40 bg-red-500/5"
                }`}
              >
                {r.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : (
                  <span className="h-4 w-4 text-red-400">✗</span>
                )}
                <div className="flex-1">
                  <p className="font-medium">
                    {humanStyleName(r.styleId)} {r.ok ? "· listo" : "· falló"}
                  </p>
                  {!r.ok && (
                    <div className="mt-1 space-y-1.5">
                      <p className="text-xs text-red-300">Este estilo no se pudo crear.</p>
                      {r.error && (
                        <details className="text-[10px] text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground">
                            Detalle técnico
                          </summary>
                          <p className="mt-1 whitespace-pre-wrap break-all text-red-400/80">
                            {r.error}
                          </p>
                        </details>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryingStyle !== null}
                        onClick={() => retryOneStyle(r.styleId)}
                      >
                        {retryingStyle === r.styleId ? (
                          <>
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                            Creando de nuevo…
                          </>
                        ) : (
                          "Reintentar este estilo"
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/produccion"
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Send className="h-4 w-4" />
              Ver mis videos y publicar
            </Link>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                clearActiveJob();
                setStep(1);
                setResults([]);
                setSelectedVideos(new Set());
                setCaption("");
                setCaptionMeta(null);
                setJobProgress(null);
                setRetryingStyle(null);
              }}
            >
              <FileVideo className="mr-1.5 h-4 w-4" />
              Crear otro video
            </Button>
          </div>
        </Card>
      )}

      {/* Navegación — barra FIJA al fondo del viewport: "Siguiente" SIEMPRE visible
          sin scroll, incluso al cargar un paso largo. `fixed` se ancla a la pantalla
          (sticky no servía: al cargar arriba, el botón seguía abajo del fold). La raíz
          lleva pb-28 para que el contenido no quede tapado por la barra. */}
      {step < 5 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-3">
            <Button
              variant="ghost"
              onClick={() => setStep(Math.max(1, step - 1))}
              disabled={step === 1 || building || transcribing}
            >
              <ChevronLeft className="mr-1.5 h-4 w-4" />
              Atrás
            </Button>
            {step < 4 && (
              <Button
                onClick={step === 1 ? advanceFromStep1 : () => setStep(step + 1)}
                disabled={
                  transcribing ||
                  (step === 1 && selectedVideos.size === 0) ||
                  (step === 2 && selectedStyles.length === 0)
                }
              >
                {step === 1 && transcribing ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Escuchando tu video…
                  </>
                ) : (
                  <>
                    {step === 1 ? "Siguiente: elegir estilo" : "Siguiente"}
                    <ChevronRight className="ml-1.5 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 👁️ Modal "Ver cómo se vería": muestra el MISMO mini-demo del estilo a
          tamaño GRANDE (CSS animado, sin renderizar nada). Así el usuario ve el
          estilo sin esperar un render. */}
      <Dialog
        open={previewStyleId !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewStyleId(null);
        }}
      >
        <DialogContent>
          {(() => {
            const s = STYLES.find((x) => x.id === previewStyleId);
            if (!s) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {s.emoji} {s.name}
                  </DialogTitle>
                  <DialogDescription>{s.tagline}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center gap-3 py-2">
                  {/* Preview REAL en movimiento (3s del motor de render); si falta el
                      MP4 pre-generado, cae al mini-demo CSS de siempre. */}
                  <StyleMotionPreview
                    styleId={s.id}
                    className="max-h-[46vh] w-auto"
                    fallback={<StyleMiniDemo styleId={s.id} accent={accent} big />}
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    Así se mueve este estilo. Tu video real saldrá con TU contenido y este look.
                  </p>
                </div>
                <DialogFooter>
                  {!selectedStyles.includes(s.id) && (
                    <Button
                      onClick={() => {
                        toggleStyle(s.id);
                        setPreviewStyleId(null);
                      }}
                    >
                      Usar este estilo
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setPreviewStyleId(null)}>
                    Cerrar
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
