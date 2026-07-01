// Paleta de colores por sección — match exacto con los colors del TabNav.
// Single source of truth para que un cambio aquí se refleje en nav + headers.

// Paleta Viralito: Inicio lleva el rosa de marca y Videos largos el violeta
// (los dos colores del icono); el resto conserva identidad propia sin chocar.
export const SECTION_COLORS = {
  inicio: "#fa3c8d",      // rosa Viralito (marca)
  editor: "#06b6d4",      // cyan
  produccion: "#f59e0b",  // amber
  publicar: "#10b981",    // emerald (programar y publicar)
  metricas: "#60a5fa",    // azul (antes violeta — lo cedió a largos)
  largos: "#ad23ee",      // violeta Viralito (marca)
  research: "#fb7185",    // rose
} as const;

export type SectionKey = keyof typeof SECTION_COLORS;
