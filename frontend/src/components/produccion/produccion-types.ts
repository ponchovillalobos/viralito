// Constants, types y helpers compartidos por la lista de producción y sus sub-componentes.
// Extraído de production-list.tsx para mantener el archivo principal por debajo del límite
// de complejidad y para que ScheduleStatusBadge / FilterChip / CaptionTabs los compartan.

import type { Project } from "@/components/editor/workspace";

export const STATUS_COLOR: Record<Project["status"], string> = {
  borrador: "#fbbf24",
  aprobado: "#34d399",
  publicado: "#60a5fa",
};

export const STATUS_OPTIONS = ["all", "borrador", "aprobado", "publicado"] as const;
export const PLATFORM_OPTIONS = ["all", "tiktok", "instagram", "linkedin"] as const;
export type StatusFilter = (typeof STATUS_OPTIONS)[number];
export type PlatformFilter = (typeof PLATFORM_OPTIONS)[number];

export interface CaptionVariant {
  caption: string;
  hashtags: string[];
}

// Etiqueta legible del estilo de edición (los proyectos guardan el codename en styleId).
export const STYLE_LABEL: Record<string, string> = {
  silent: "Limpio",
  punch: "Punch",
  hype: "Viral",
  hype_max: "Viral intenso",
  hype_max_sfx: "Viral con sonidos",
  supreme: "Premium",
  cinematic_pro: "Cine",
  broll_full: "Con videos de apoyo",
  broll_pip: "Videos de apoyo (chico)",
  text_behind: "Texto detrás de ti",
  graphics_pro: "Con gráficas",
  graphics_max: "Gráficas intensas",
  motion_pro: "Fondo animado",
  motion_beat: "Animado al ritmo",
  motion_grid: "Animado en cuadrícula",
  editorial: "Editorial",
  vhs: "VHS Retro",
  audiogram: "Audiograma",
};

export interface ProjectExt extends Project {
  source?: "short" | "long_form";
  styleId?: string;
  /** Título corto basado en el contenido (lo arma auto-build para nombrar el archivo). */
  title?: string;
  /** Puntuación de viralidad (0-100) del clip, si /api/projects la resolvió del proposal. */
  viralityScore?: number | null;
  /** Nombre corto y humano (2-3 palabras) derivado del id — para mostrar en la lista. */
  shortTitle?: string;
  /** Nuevo: 3 variantes por plataforma generadas en una corrida de generate_caption.py */
  captions?: {
    tiktok?: CaptionVariant;
    linkedin?: CaptionVariant;
    instagram?: CaptionVariant;
  };
  captionMeta?: {
    caption_short?: string;
    caption_long?: string;
    hashtags_tiktok?: string[];
    hashtags_instagram?: string[];
    hashtags_linkedin?: string[];
    hashtags_facebook?: string[];
    captions?: ProjectExt["captions"];
  };
}

export type CaptionPlatform = "tiktok" | "linkedin" | "instagram";

/** Devuelve el caption combinado con hashtags para una plataforma — fallback al .caption legacy. */
export function pickCaptionForPlatform(p: ProjectExt, platform: CaptionPlatform): string {
  const variant = p.captions?.[platform] ?? p.captionMeta?.captions?.[platform];
  if (variant?.caption) {
    const tags = (variant.hashtags ?? [])
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .join(" ");
    return tags ? `${variant.caption}\n\n${tags}` : variant.caption;
  }
  return p.caption ?? "";
}
