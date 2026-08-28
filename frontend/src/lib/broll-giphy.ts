/**
 * B-roll desde Giphy — GIFs animados como cortinilla.
 *
 * POR QUÉ EL MP4 Y NO EL .gif: el render detecta imágenes por extensión
 * (`pip-broll-layer.tsx`: jpg/png/webp van por `<Img>`), así que un `.gif`
 * entraría como imagen ESTÁTICA — se vería el primer fotograma congelado.
 * Giphy publica un `.mp4` de cada GIF en `images.original.mp4`, que entra por
 * `OffthreadVideo` y se anima igual que cualquier clip. Es la misma pieza,
 * servida en el formato que el render sí sabe mover.
 *
 * Server-only (usa GIPHY_API_KEY). Si no hay clave o falla la red devuelve null
 * y quien llama cae a otra fuente: nunca rompe el render.
 */

const GIPHY_API = "https://api.giphy.com/v1/gifs/search";

interface GiphyImagen {
  mp4?: string;
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyItem {
  images?: {
    original?: GiphyImagen;
    downsized_medium?: GiphyImagen;
    fixed_height?: GiphyImagen;
    original_still?: { url?: string };
  };
  title?: string;
}

function conTimeout(url: string, ms = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" }).finally(() => clearTimeout(t));
}

/**
 * Devuelve la URL del MP4 de un GIF que encaje con `query`, o null.
 *
 * `rating: pg-13` filtra el catálogo: es material que va a salir sobreimpreso
 * en un video que se publica, así que se descarta lo explícito de entrada.
 */
/**
 * Una imagen fija de Giphy, para la vista previa del selector.
 *
 * `buscarGifMp4` exige que la variante traiga MP4 — con razon, porque el render
 * necesita video. Pero la MINIATURA no: pedir un mp4 para mostrar una imagen
 * acoplaba la vista previa a un requisito que no le corresponde, y la dejaba
 * vacia cada vez que el primer resultado no tuviera esa variante.
 *
 * Devuelve `null` ante cualquier fallo: la tarjeta se muestra sin miniatura y se
 * puede elegir igual.
 */
export async function buscarMuestraGiphy(query: string): Promise<string | null> {
  const key = process.env.GIPHY_API_KEY;
  if (!key || !query.trim()) return null;
  try {
    const params = new URLSearchParams({
      api_key: key,
      q: query,
      // La miniatura solo tiene que dar idea del estilo del material, pero con
      // un unico candidato cualquier resultado raro se volvia LA muestra.
      limit: "8",
      lang: "es",
      rating: "g",
    });
    const res = await conTimeout(`${GIPHY_API}?${params}`);
    if (!res.ok) {
      console.warn(`[giphy] muestra "${query}" devolvio ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { data?: GiphyItem[] };
    // Recorre los candidatos hasta encontrar uno con imagen fija. Antes miraba
    // SOLO el primero, asi que si ese no traia ninguna de las cuatro variantes
    // la tarjeta se quedaba sin miniatura teniendo siete mas detras.
    for (const item of data.data ?? []) {
      const im = item.images as Record<string, { url?: string }> | undefined;
      // De mas chica a mas grande: alcanza con que se vea el estilo del material.
      for (const k of ["fixed_width_still", "480w_still", "original_still", "downsized_still"]) {
        const u = im?.[k]?.url;
        if (u) return u;
      }
    }
    return null;
  } catch {
    return null;
  }
}


export async function buscarGifMp4(
  query: string
): Promise<{ url: string; thumbnail?: string; width?: number; height?: number } | null> {
  const key = process.env.GIPHY_API_KEY;
  if (!key || !query.trim()) return null;

  const params = new URLSearchParams({
    api_key: key,
    q: query,
    // 25 en vez de 5. La busqueda descarta los resultados que no traen MP4 —el
    // render necesita video, no imagen— asi que con 5 candidatos bastaba con que
    // los primeros fueran solo-GIF para volver con las manos vacias y dejar el
    // momento sin material. Pedir mas no cuesta nada: es la misma llamada.
    limit: "25",
    // El contenido es en espanol, asi que la busqueda tambien. Estaba fijo en
    // "en", asi que Giphy interpretaba consultas espanolas con su indice ingles
    // y devolvia material peor o ninguno.
    lang: "es",
    // `rating` NO es una restriccion heredada: es que este material sale
    // sobreimpreso en un video que se publica. Se queda.
    rating: "pg-13",
    bundle: "clips_grid_picker",
  });

  try {
    const res = await conTimeout(`${GIPHY_API}?${params}`);
    if (!res.ok) {
      console.warn(`[giphy] búsqueda "${query}" devolvió ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { data?: GiphyItem[] };
    for (const item of data.data ?? []) {
      // original.mp4 es el de mejor calidad; downsized_medium existe cuando el
      // original pesa demasiado. Se toma el primero que traiga mp4 de verdad.
      const candidatas: (GiphyImagen | undefined)[] = [
        item.images?.original,
        item.images?.downsized_medium,
        item.images?.fixed_height,
      ];
      const variante = candidatas.find((v): v is GiphyImagen => Boolean(v?.mp4));
      if (variante?.mp4) {
        // Las dimensiones viajan con el clip: un GIF cuadrado o apaisado no
        // puede taparse a pantalla completa en un vertical sin perder los
        // lados, y el render necesita saberlo para decidir cómo colocarlo.
        const w = Number(variante.width);
        const h = Number(variante.height);
        return {
          url: variante.mp4,
          thumbnail: item.images?.original_still?.url,
          ...(Number.isFinite(w) && w > 0 ? { width: w } : {}),
          ...(Number.isFinite(h) && h > 0 ? { height: h } : {}),
        };
      }
    }
    return null;
  } catch (e) {
    console.warn(`[giphy] fallo buscando "${query}": ${(e as Error).message}`);
    return null;
  }
}
