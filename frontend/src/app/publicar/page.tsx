import { PublishCalendar } from "@/components/publicar/publish-calendar";
import { SectionHeader } from "@/components/ui/section-header";
import { SECTION_COLORS } from "@/lib/section-colors";

// Sección "Programar y publicar" (estilo Postiz). Fase 0: calendario + canales, LECTURA
// sobre lo que ya existe. El composer para crear posts llega en la Fase 1. No toca la
// creación de videos (render/wizard/editor).
export const dynamic = "force-dynamic";

export default function PublicarPage() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Programar y publicar"
        title="Calendario de publicaciones"
        description="Elige la red, la fecha y la hora. Deja tus videos programados y se publican solos a la hora elegida."
        color={SECTION_COLORS.publicar}
      />
      <PublishCalendar />
    </div>
  );
}
