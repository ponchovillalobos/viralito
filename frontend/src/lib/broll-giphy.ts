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
export async function buscarGifMp4(query: string): Promise<{ url: string; thumbnail?: string } | null> {
  const key = process.env.GIPHY_API_KEY;
  if (!key || !query.trim()) return null;

  const params = new URLSearchParams({
    api_key: key,
    q: query,
    limit: "5",
    rating: "pg-13",
    lang: "en",
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
      const mp4 =
        item.images?.original?.mp4 ||
        item.images?.downsized_medium?.mp4 ||
        item.images?.fixed_height?.mp4;
      if (mp4) {
        return { url: mp4, thumbnail: item.images?.original_still?.url };
      }
    }
    return null;
  } catch (e) {
    console.warn(`[giphy] fallo buscando "${query}": ${(e as Error).message}`);
    return null;
  }
}
