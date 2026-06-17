/**
 * GET /api/stickers/list — catálogo UNIFICADO y buscable de stickers:
 *   - 6.605 iconos SVG (Phosphor duotone MIT + Tabler MIT) de assets/icons
 *   - 609 ilustraciones Lottie (catálogo Noto, Apache-2.0) de assets/lottie/noto/catalog
 *
 * Cada entrada: { id, type:"icon"|"lottie", name, category, tags[], url }.
 * El índice se construye UNA vez y se cachea en {DATA_ROOT}/cache/sticker-index.json
 * (ver sticker-index.ts) — NO se re-escanean ~6.6k archivos por request.
 *
 * La respuesta es grande (~6.6k entradas) pero estática → cache HTTP agresivo; el
 * picker la baja una sola vez y filtra en cliente con Fuse.js (offline, sin red).
 */
import { NextResponse } from "next/server";
import { getStickerIndex } from "@/lib/sticker-index";
import { fireRepair } from "@/lib/self-heal-assets";

export const dynamic = "force-dynamic";

// Set completo de iconos ≈ 11.000 (Phosphor + Tabler + Material + Lucide). Si hay
// MENOS, la descarga quedó a medias (típicamente faltan Material/Lucide, que el
// repair viejo no re-bajaba). Disparamos el self-heal en background — el picker
// igual muestra lo que haya y completa en la próxima apertura.
const ICONS_MIN_EXPECTED = 9000;

export async function GET() {
  try {
    const idx = await getStickerIndex();
    if (idx.counts.icons < ICONS_MIN_EXPECTED) fireRepair("icons");
    // Categorías únicas (en español) para los chips de filtro, ordenadas alfabéticamente.
    const categories = [...new Set(idx.stickers.map((s) => s.category))].sort((a, b) =>
      a.localeCompare(b, "es")
    );
    return NextResponse.json(
      {
        stickers: idx.stickers,
        categories,
        counts: idx.counts,
        total: idx.stickers.length,
      },
      {
        headers: {
          // Estático para la sesión — el browser lo cachea y no re-baja por tab.
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
