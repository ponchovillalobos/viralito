import { PublishCalendar } from "@/components/publicar/publish-calendar";
import { ProductionList } from "@/components/produccion/production-list";
import { SectionHeader } from "@/components/ui/section-header";
import { SECTION_COLORS } from "@/lib/section-colors";

// Sección "Programar y publicar" (estilo Postiz). Es el HUB único: calendario + composer
// (arriba) + tus videos listos (abajo, absorbido de la vieja /produccion). No toca la
// creación de videos (render/wizard/editor).
export const dynamic = "force-dynamic";

export default function PublicarPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Programar y publicar"
          title="Calendario de publicaciones"
          description="Elige la red, la fecha y la hora. Deja tus videos programados y se publican solos a la hora elegida."
          color={SECTION_COLORS.publicar}
        />
        <PublishCalendar />
      </div>

      {/* Tus videos (antes /produccion) — desde acá también podés programar cada uno. */}
      <div className="space-y-6 border-t border-border pt-8">
        <SectionHeader
          eyebrow="Tus videos"
          title="Mis videos"
          description="Tus videos ya editados, listos para publicar. Desde cada uno podés generar su descripción y programarlo."
          color={SECTION_COLORS.produccion}
        />
        <ProductionList />
      </div>
    </div>
  );
}
