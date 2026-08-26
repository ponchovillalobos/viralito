"use client";

/**
 * GALERÍA DE STICKERS (Ola 1 — el diferenciador): destapa la biblioteca FANTASMA
 * de 6.605 iconos SVG (Phosphor + Tabler) + 609 ilustraciones Lottie (Noto) +
 * ilustraciones de personas CC0 multicolor (type:"illustration"), que antes el
 * usuario sólo "elegía" de un puñado curado.
 *
 * Cómo evita traer TODO de golpe (clave del rendimiento con 6.6k+ assets):
 *   1. /api/stickers/list devuelve sólo METADATA (id/name/category/tags/url) — el
 *      contenido pesado (SVG markup, JSON Lottie) NO viaja en esa respuesta.
 *   2. Grid VIRTUALIZADO (react-window v2): sólo se montan las celdas visibles
 *      (~30) de las miles que hay; el resto no existe en el DOM.
 *   3. SVG/PNG on-demand: cada celda visible carga su asset con <img src> (lazy +
 *      cache del browser). Nunca se bajan miles de imágenes a la vez.
 *   4. Lottie SÓLO en hover: la celda muestra un placeholder estático y recién al
 *      pasar el mouse hace fetch del JSON y lo anima. Nunca se traen 609 JSON juntos.
 *   5. Búsqueda fuzzy con Fuse.js OFFLINE (sin red, sin API key) sobre la metadata,
 *      DEBOUNCEADA (no re-filtra en cada tecla).
 *
 * UX (Ola 4): FAVORITOS ⭐ y RECIENTES 🕐 persistidos en localStorage; filtro por
 * TIPO (Iconos / Animaciones / Personas); conteos como prueba de valor.
 *
 * Al hacer click, empuja el sticker a project.iconStickers con el shape que el
 * render consume (IconSticker): los SVG usan icon="ph:<n>"/"tb:<n>" (el build
 * embebe el markup), los Lottie e ilustraciones usan lottieSrc / imageSrc = url.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { Grid, type CellComponentProps } from "react-window";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Sparkles, Star } from "lucide-react";
import { useLocalStorageList } from "@/lib/use-local-storage-list";

// ── Shape que el render consume (subset de IconSticker de remotion/src/schemas.ts).
//    `at` lo fija el padre al insertar (currentTime); el resto trae defaults sanos.
export interface IconStickerInput {
  at: number;
  duration: number;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center";
  size: number;
  color: string;
  bg: string;
  /** Para iconos SVG: "ph:<n>"/"tb:<n>" (el build embebe el SVG). "" para los demás. */
  icon: string;
  /** Para ilustraciones Lottie: URL del /api/lottie/stream. "" para los demás. */
  lottieSrc: string;
  fullscreen: boolean;
  label: string;
}

/** El tipo del catálogo. "illustration" = personas CC0 multicolor (PNG/SVG a color). */
type StickerType = "icon" | "lottie" | "illustration";

interface StickerEntry {
  id: string;
  type: StickerType;
  name: string;
  category: string;
  tags: string[];
  url: string;
}

interface ListResponse {
  stickers: StickerEntry[];
  categories: string[];
  // `illustrations` puede no venir aún (el índice se está ampliando en paralelo).
  counts: { icons: number; lottie: number; illustrations?: number };
  total: number;
}

interface Props {
  /** Empuja el sticker elegido al project (el padre hace updateProject). */
  onAdd: (sticker: IconStickerInput) => void;
  /** Momento actual del video — se usa como `at` del sticker insertado. */
  currentTime: number;
  /** Cuántos icon-stickers ya tiene el proyecto (para feedback). */
  selectedCount?: number;
}

const COLUMN_MIN = 88; // px por celda (icono + nombre)
const ROW_HEIGHT = 104;

// Cache de JSON Lottie por url, a nivel MÓDULO: persiste aunque la celda
// virtualizada se recicle al hacer scroll. Sin esto se re-fetchea el mismo JSON
// cada vez que una celda vuelve a entrar en viewport y recibe hover.
const lottieCache = new Map<string, object>();
const FAVORITES_KEY = "viralito.stickers.favorites";
const RECENTS_KEY = "viralito.stickers.recents";
const RECENTS_CAP = 24; // sólo recordamos los 24 stickers más recientes
const DEBOUNCE_MS = 180;

// Filtros virtuales por "tipo" en los chips. "fav"/"recent" son secciones especiales.
type TypeFilter = "all" | "icon" | "lottie" | "illustration" | "fav" | "recent";

export function StickerPicker({ onAdd, currentTime, selectedCount = 0 }: Props) {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [gridWidth, setGridWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // currentTime cambia en cada tick del video padre. Lo leemos por ref dentro de
  // handlePick para que ese callback NO se recree cada tick (lo que re-renderizaría
  // todas las celdas virtualizadas vía cellProps).
  const currentTimeRef = useRef(currentTime);
  // Se actualiza en un efecto, no durante el render. Mutar un ref mientras React
  // renderiza es de las cosas que el compilador de React 19 puede reordenar u
  // omitir al optimizar, y entonces el callback leeria un tiempo viejo. El ref
  // solo se consulta dentro de `handlePick`, que corre cuando alguien hace clic
  // — mucho despues del render — asi que el efecto llega de sobra.
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // FAVORITOS y RECIENTES — persistidos en localStorage (sobreviven recargas).
  const favorites = useLocalStorageList(FAVORITES_KEY);
  const recents = useLocalStorageList(RECENTS_KEY, RECENTS_CAP);
  const favSet = useMemo(() => new Set(favorites.list), [favorites.list]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stickers/list")
      .then((r) => r.json())
      .then((d: ListResponse) => {
        if (cancelled) return;
        if (!d.stickers) throw new Error("sin stickers");
        setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "no se pudo cargar la galería");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce de la búsqueda: no re-filtramos 6.6k entradas en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Medir el ancho del contenedor para calcular columnas (responsive sin re-render loop).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setGridWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // Índice por id — para resolver favoritos/recientes (que guardan sólo ids) → entries.
  const byId = useMemo(() => {
    const m = new Map<string, StickerEntry>();
    data?.stickers.forEach((s) => m.set(s.id, s));
    return m;
  }, [data]);

  // Índice Fuse.js — se reconstruye sólo cuando llegan los datos (no por keystroke).
  // Busca en nombre + tags (español) + categoría; tags pesan más (sinónimos).
  const fuse = useMemo(() => {
    if (!data) return null;
    return new Fuse(data.stickers, {
      keys: [
        { name: "name", weight: 2 },
        { name: "tags", weight: 3 },
        { name: "category", weight: 1 },
      ],
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }, [data]);

  // Lista filtrada: sección (fav/recent) o búsqueda (Fuse) → tipo → categoría.
  // Todo en memoria, sin red.
  const filtered = useMemo(() => {
    if (!data) return [];
    let base: StickerEntry[];

    if (typeFilter === "fav") {
      // Favoritos en el orden guardado (más reciente primero); ignora los que ya no existen.
      base = favorites.list.map((id) => byId.get(id)).filter((s): s is StickerEntry => !!s);
    } else if (typeFilter === "recent") {
      base = recents.list.map((id) => byId.get(id)).filter((s): s is StickerEntry => !!s);
    } else {
      const q = debouncedQuery.trim();
      base = q.length >= 2 && fuse ? fuse.search(q).map((r) => r.item) : data.stickers;
      if (typeFilter !== "all") base = base.filter((s) => s.type === typeFilter);
    }

    if (activeCat) base = base.filter((s) => s.category === activeCat);
    return base;
  }, [data, fuse, debouncedQuery, typeFilter, activeCat, favorites.list, recents.list, byId]);

  const columnCount = Math.max(1, Math.floor((gridWidth || 1) / COLUMN_MIN) || 1);
  const rowCount = Math.ceil(filtered.length / columnCount);
  const columnWidth = gridWidth > 0 ? Math.floor(gridWidth / columnCount) : COLUMN_MIN;

  const recentsPush = recents.push;
  const favoritesToggle = favorites.toggle;
  const handlePick = useCallback(
    (s: StickerEntry) => {
      // Registrar como RECIENTE (se persiste solo).
      recentsPush(s.id);
      const base: IconStickerInput = {
        at: Math.round(currentTimeRef.current * 10) / 10,
        duration: 2,
        position: "top-right",
        size: 120,
        color: "#0a0a0a",
        bg: "#fbbf24",
        icon: "",
        lottieSrc: "",
        fullscreen: false,
        label: "",
      };
      if (s.type === "lottie" || s.type === "illustration") {
        // Lottie e ilustraciones (PNG/SVG a color) viajan por lottieSrc=url del stream.
        // El shape de inserción no cambia → el flujo click→iconStickers sigue intacto.
        onAdd({ ...base, lottieSrc: s.url });
      } else {
        // s.id ya viene como "ph:<n>"/"tb:<n>" — el build embebe el SVG.
        onAdd({ ...base, icon: s.id });
      }
    },
    [onAdd, recentsPush]
  );

  const handleToggleFav = useCallback(
    (s: StickerEntry) => favoritesToggle(s.id),
    [favoritesToggle]
  );

  // Props del Grid memoizadas: sin esto se crea un objeto nuevo en cada render del
  // padre (cada tick del video), forzando un re-render de TODAS las celdas montadas.
  const cellProps = useMemo<CellProps>(
    () => ({
      items: filtered,
      columnCount,
      onPick: handlePick,
      onToggleFav: handleToggleFav,
      favSet,
    }),
    [filtered, columnCount, handlePick, handleToggleFav, favSet]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando la galería de stickers…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/50 p-4 text-xs text-muted-foreground">
        No se pudo cargar la galería. {error}
      </div>
    );
  }

  const illustrationsCount = data.counts.illustrations ?? 0;
  const hasFav = favorites.list.length > 0;
  const hasRecent = recents.list.length > 0;

  return (
    <div className="space-y-3">
      {/* PRUEBA DE VALOR: los conteos reales de la biblioteca destapada. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <span className="font-medium">
          {data.counts.icons.toLocaleString("es-MX")} iconos ·{" "}
          {data.counts.lottie.toLocaleString("es-MX")} animaciones
          {illustrationsCount > 0 && (
            <> · {illustrationsCount.toLocaleString("es-MX")} ilustraciones</>
          )}
        </span>
        {selectedCount > 0 && (
          <span className="text-muted-foreground">· {selectedCount} en este video</span>
        )}
      </div>

      {/* Buscador en español (Fuse.js offline, debounceado). Busca en nombre + tags. */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar: dinero, fuego, cohete, corazón…"
          className="pl-8"
          aria-label="Buscar stickers"
        />
      </div>

      {/* Filtro de tipo + secciones especiales (Favoritos / Recientes). */}
      <div className="flex flex-wrap gap-1.5">
        {hasFav && (
          <TypeChip active={typeFilter === "fav"} onClick={() => setTypeFilter("fav")}>
            ⭐ Favoritos
          </TypeChip>
        )}
        {hasRecent && (
          <TypeChip active={typeFilter === "recent"} onClick={() => setTypeFilter("recent")}>
            🕐 Recientes
          </TypeChip>
        )}
        {(hasFav || hasRecent) && <span className="mx-0.5 self-center text-border">|</span>}
        {([
          ["all", "Todo"],
          ["icon", "Iconos"],
          ["lottie", "Animaciones"],
          ["illustration", "Personas"],
        ] as const).map(([val, lbl]) => (
          <TypeChip key={val} active={typeFilter === val} onClick={() => setTypeFilter(val)}>
            {lbl}
          </TypeChip>
        ))}
      </div>

      {/* Chips de categoría. */}
      <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
        <CategoryChip label="Todas" active={activeCat === null} onClick={() => setActiveCat(null)} />
        {data.categories.map((c) => (
          <CategoryChip
            key={c}
            label={c}
            active={activeCat === c}
            onClick={() => setActiveCat(activeCat === c ? null : c)}
          />
        ))}
      </div>

      <Label className="text-[10px] text-muted-foreground">
        {typeFilter === "fav"
          ? "Tus favoritos"
          : typeFilter === "recent"
            ? "Usados recientemente"
            : `${filtered.length.toLocaleString("es-MX")} resultados`}{" "}
        · clic para agregar en {currentTime.toFixed(1)}s
      </Label>

      {/* Grid VIRTUALIZADO: sólo se montan las celdas visibles. */}
      <div ref={containerRef} className="h-[360px] w-full overflow-hidden rounded-md border border-border">
        {gridWidth > 0 && filtered.length > 0 ? (
          <Grid
            cellComponent={Cell}
            cellProps={cellProps}
            columnCount={columnCount}
            columnWidth={columnWidth}
            rowCount={rowCount}
            rowHeight={ROW_HEIGHT}
            overscanCount={2}
            style={{ height: 360, width: gridWidth }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {typeFilter === "fav"
              ? "Aún no marcaste favoritos. Pasa el mouse sobre un sticker y toca la ⭐."
              : typeFilter === "recent"
                ? "Todavía no usaste ningún sticker."
                : `Sin resultados para «${query}».`}
          </div>
        )}
      </div>
    </div>
  );
}

function TypeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs ${
        active
          ? "border-foreground/40 bg-muted text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] ${
        active
          ? "border-brand-pink/50 bg-brand-pink/15 text-brand-pink"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ── Props que cada celda recibe vía cellProps (react-window v2). ──
interface CellProps {
  items: StickerEntry[];
  columnCount: number;
  onPick: (s: StickerEntry) => void;
  onToggleFav: (s: StickerEntry) => void;
  favSet: Set<string>;
}

function Cell({
  columnIndex,
  rowIndex,
  style,
  items,
  columnCount,
  onPick,
  onToggleFav,
  favSet,
}: CellComponentProps<CellProps>) {
  const index = rowIndex * columnCount + columnIndex;
  const item = items[index];
  if (!item) return <div style={style} />;
  return (
    <div style={style} className="p-1">
      <StickerCell
        item={item}
        onPick={onPick}
        onToggleFav={onToggleFav}
        isFav={favSet.has(item.id)}
      />
    </div>
  );
}

/** Celda individual: SVG/PNG vía <img> on-demand; Lottie animado SÓLO en hover. */
function StickerCell({
  item,
  onPick,
  onToggleFav,
  isFav,
}: {
  item: StickerEntry;
  onPick: (s: StickerEntry) => void;
  onToggleFav: (s: StickerEntry) => void;
  isFav: boolean;
}) {
  const [hover, setHover] = useState(false);
  // Arranca del cache de módulo si ya se bajó antes (celda reciclada al scrollear).
  const [lottieData, setLottieData] = useState<object | null>(
    () => lottieCache.get(item.url) ?? null
  );
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);

  // react-window recicla la MISMA instancia de celda para otro sticker al
  // scrollear (sin remontar): si cambia la url, re-sincronizamos lottieData con
  // el nuevo item (del cache si está) para no mostrar la animación del anterior.
  const [prevUrl, setPrevUrl] = useState(item.url);
  if (prevUrl !== item.url) {
    setPrevUrl(item.url);
    setLottieData(lottieCache.get(item.url) ?? null);
  }

  // Lottie: traer el JSON SÓLO al primer hover (nunca al montar). Una vez bajado,
  // queda en el cache de MÓDULO (por url) para todas las celdas y reciclajes.
  useEffect(() => {
    // El cache ya no se copia al estado: se lee directo mas abajo (`animacion`).
    // Copiarlo era un setState sincrono dentro del efecto — un render en cascada
    // para un dato que ya estaba en memoria y no necesitaba pasar por el estado.
    if (item.type !== "lottie" || !hover || lottieData) return;
    if (lottieCache.has(item.url)) return;
    let cancelled = false;
    fetch(item.url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) lottieCache.set(item.url, d);
        if (!cancelled && d) setLottieData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hover, item.type, item.url, lottieData]);

  // Lo que se dibuja: el estado si ya se bajo en ESTA celda, y si no el cache de
  // modulo (otra celda pudo haberlo bajado despues de que esta se monto). Se
  // DERIVA en vez de copiarse al estado — copiarlo era un setState sincrono
  // dentro del efecto, y ademas dejaba un hueco: una celda montada antes de que
  // el archivo entrara al cache se quedaba sin animacion para siempre, porque su
  // inicializacion perezosa ya habia corrido con el cache vacio.
  const animacion = lottieData ?? (hover ? lottieCache.get(item.url) ?? null : null);

  // Las ilustraciones (personas CC0) ya son a color → NO se tiñen (sin filtro invert).
  const isIllustration = item.type === "illustration";

  return (
    <div
      className="group relative h-full w-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={() => onPick(item)}
        title={`${item.name} · ${item.category}`}
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border border-transparent bg-card/40 p-1.5 transition hover:border-brand-pink/40 hover:bg-muted"
      >
        <div className="flex h-12 w-12 items-center justify-center">
          {item.type === "lottie" ? (
            hover && animacion ? (
              <Lottie
                lottieRef={lottieRef}
                animationData={animacion}
                loop
                autoplay
                style={{ width: 48, height: 48 }}
              />
            ) : (
              // Placeholder estático hasta el hover — evita bajar 609 JSON de golpe.
              <span className="text-2xl" aria-hidden>
                ✨
              </span>
            )
          ) : (
            // Iconos SVG y personas (PNG/SVG a color): <img> lazy → el browser sólo
            // pide los visibles y los cachea. Las personas NO se tiñen (van a color).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt={item.name}
              loading="lazy"
              width={40}
              height={40}
              className={
                isIllustration
                  ? "h-11 w-11 object-contain"
                  : "h-10 w-10 object-contain opacity-80 [filter:invert(0.85)]"
              }
            />
          )}
        </div>
        <span className="line-clamp-1 w-full text-center text-[9px] leading-tight text-muted-foreground">
          {item.name}
        </span>
      </button>

      {/* Estrella de favorito: aparece en hover (o siempre si ya es favorito). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav(item);
        }}
        aria-label={isFav ? "Quitar de favoritos" : "Marcar como favorito"}
        aria-pressed={isFav}
        title={isFav ? "Quitar de favoritos" : "Favorito"}
        className={`absolute right-0.5 top-0.5 rounded-full p-0.5 transition ${
          isFav
            ? "text-amber-400 opacity-100"
            : "text-muted-foreground opacity-0 hover:text-amber-400 group-hover:opacity-100"
        }`}
      >
        <Star className="h-3.5 w-3.5" fill={isFav ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
