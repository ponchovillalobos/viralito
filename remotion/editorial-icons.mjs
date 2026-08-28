/**
 * Resolver de iconos editoriales EXTERNOS (Ola 4): los nombres con prefijo
 * "ph:" (Phosphor duotone, 1,512) o "tb:" (Tabler outline, 5,093) se resuelven
 * en BUILD-time leyendo el SVG de {DATA_ROOT}/assets/icons/ y embebiendo el
 * markup en card.iconSvg (los SVG usan currentColor → el render los pinta con
 * el acento del tema). Cero red en render; si el pack no está descargado
 * (python/download_editorial_icons.py), cae al ícono Lucide del pool.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";


import { pickDataRoot } from "./data-root.mjs";
const PACKS = {
  "ph:": { dir: "phosphor-duotone", file: (n) => `${n}-duotone.svg` },
  "tb:": { dir: "tabler", file: (n) => `${n}.svg` },
};

/**
 * Lee el SVG de un icono "ph:<n>"/"tb:<n>" desde disco y lo deja listo para
 * embeber (markup con width/height al 100%, sin comentarios). Devuelve "" si el
 * pack no está descargado o el nombre no existe.
 */
function readExternalIconSvg(root, icon) {
  const prefix = icon.startsWith("ph:") ? "ph:" : icon.startsWith("tb:") ? "tb:" : null;
  if (!prefix) return "";
  const pack = PACKS[prefix];
  const p = root && path.join(root, "assets", "icons", pack.dir, pack.file(icon.slice(prefix.length)));
  try {
    return readFileSync(p, "utf-8")
      // comentario de metadata de Tabler fuera (peso muerto en props)
      .replace(/<!--[\s\S]*?-->/g, "")
      // el tag raíz se estira al contenedor (el render fija el tamaño)
      .replace(/<svg([^>]*?)>/, (m, attrs) => {
        const cleaned = attrs.replace(/\s(width|height)="[^"]*"/g, "");
        return `<svg${cleaned} width="100%" height="100%">`;
      })
      .trim();
  } catch {
    return "";
  }
}

/** Muta las cards: agrega iconSvg a las que usan iconos externos. */
export function resolveEditorialCardIcons(cards) {
  if (!Array.isArray(cards)) return cards;
  const root = pickDataRoot({ permitirNulo: true });
  for (const card of cards) {
    const icon = (card && card.icon) || "";
    if (!icon.startsWith("ph:") && !icon.startsWith("tb:")) continue;
    const svg = readExternalIconSvg(root, icon);
    if (svg) card.iconSvg = svg;
    // Pack no descargado / nombre inexistente → sin icono externo; el render
    // intentará Lucide y, si tampoco, la tarjeta sale sin ilustración.
    else card.icon = "";
  }
  return cards;
}

/**
 * Galería de stickers (Ola 1): los icon-stickers que el usuario eligió de la
 * galería traen icon="ph:<n>"/"tb:<n>". Acá embebemos el SVG en `iconSvg` para
 * que IconStickerLayer lo dibuje (en build-time, cero red en render). Los stickers
 * Lottie (lottieSrc) y los Lucide curados (icon sin prefijo) pasan sin tocar.
 */
export function resolveIconStickerSvg(stickers) {
  if (!Array.isArray(stickers)) return stickers;
  const root = pickDataRoot({ permitirNulo: true });
  for (const s of stickers) {
    const icon = (s && s.icon) || "";
    if (!icon.startsWith("ph:") && !icon.startsWith("tb:")) continue;
    const svg = readExternalIconSvg(root, icon);
    if (svg) s.iconSvg = svg;
    // Si no se pudo leer, dejamos el icon como vino → IconStickerLayer cae al
    // FallbackIcon de Lucide (nunca rompe el render).
  }
  return stickers;
}
