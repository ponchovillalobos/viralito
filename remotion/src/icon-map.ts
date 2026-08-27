/**
 * B5 — Iconos curados (lucide-react, offline, MIT). El motor de render usa este mapa
 * para que cualquier icon-sticker pueda pedir un icono por NOMBRE (string), sin que
 * cada caller tenga que conocer la API de lucide.
 *
 * Si el nombre no está en el mapa, el caller debe caerse a `Sparkles` (default visual).
 */
import * as LucideIcons from "lucide-react";
import {
  Flame, Rocket, Target, Lightbulb, Heart, Star, Zap, TrendingUp, ThumbsUp, Eye,
  Crown, Sparkles, Brain, MessageCircle, DollarSign, Award, Bell, CheckCircle,
  AlertTriangle, Music, Camera, Film, Hash, Bookmark, Share2, Play, Coffee, Smile,
  Gem, Sun, BarChart3, Settings, Coins,
} from "lucide-react";

export type IconComponent = React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export const ICON_MAP: Record<string, IconComponent> = {
  fire: Flame, rocket: Rocket, target: Target, lightbulb: Lightbulb, heart: Heart,
  star: Star, zap: Zap, trending: TrendingUp, thumbsup: ThumbsUp, eye: Eye,
  crown: Crown, sparkles: Sparkles, brain: Brain, message: MessageCircle,
  money: DollarSign, award: Award, bell: Bell, check: CheckCircle, warn: AlertTriangle,
  music: Music, camera: Camera, film: Film, hash: Hash, bookmark: Bookmark,
  share: Share2, play: Play, coffee: Coffee, smile: Smile, gem: Gem, sun: Sun,
  // Alias que el generador emite y lucide no tiene con ese nombre exacto. Sin
  // esto caian al icono generico: "chart" (BarChart3), "gears" (Settings) y
  // "coin" (Coins, en plural). Medido: con el resolvedor quedan 250 de 253
  // nombres del pool; estos tres cierran la lista.
  chart: BarChart3, gears: Settings, coin: Coins,
};

/** Fallback canónico cuando un nombre de icono no se puede resolver. */
export const FallbackIcon = Sparkles;

/** kebab/lower → PascalCase de lucide ("trending-up" → "TrendingUp"). */
function aPascal(nombre: string): string {
  return nombre
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

/**
 * Resuelve CUALQUIER nombre de ícono de lucide, no sólo los 30 del mapa curado.
 *
 * El mapa de arriba tiene 30 entradas escritas a mano. El generador de gráficos
 * puede emitir **253** nombres distintos (`_LUCIDE_POOL` + `_FALLBACK_ICONS` en
 * `generate_graphics.py`), todos validados contra lucide-react por
 * `check-lucide-names.mjs` — 237 OK, 0 inválidos.
 *
 * O sea que 233 de 253 nombres (**el 92 %**) caían al ícono genérico: el sistema
 * elegía cuidadosamente un ícono acorde a lo que se dice y el render dibujaba una
 * chispa. No fallaba nada; simplemente el trabajo de elegir bien no llegaba a la
 * pantalla.
 *
 * Las tarjetas editoriales nunca tuvieron el problema porque `LineArtLucide`
 * resuelve por nombre con esta misma conversión. Era sólo el icon-sticker el que
 * pasaba por el mapa corto. Se unifica el criterio: primero el mapa curado (que
 * permite alias como "fire" → Flame o "money" → DollarSign, que no son nombres
 * de lucide), y si no está, el nombre real.
 */
export function resolverIcono(nombre: string): IconComponent {
  const clave = (nombre || "").toLowerCase().trim();
  if (!clave) return FallbackIcon;
  const curado = ICON_MAP[clave];
  if (curado) return curado;
  const deLucide = (LucideIcons as unknown as Record<string, IconComponent>)[aPascal(clave)];
  return deLucide ?? FallbackIcon;
}
