"""MARCA → STYLE GUIDE (F1.b) — deriva paleta + acento + tema editorial de una marca.

Entrada: un logo/screenshot LOCAL (--image) o una URL (--url). Salida: JSON con
  { accent, palette[], themeId, themeName, fontTitle, bgLuma, source, ok }

Todo 100% offline con libs YA instaladas (Pillow, numpy en requirements.txt). El
camino --url baja el og:image / theme-color de la web (degradable: sin red, cae al
default). NUNCA aborta: ante cualquier error emite un default sano y ok=false.

Reglas del proyecto que respeta:
  - MONO-COLOR: el acento se SNAPea a la PALETTE canónica (10 colores del wizard) →
    un único color vivo, con contraste garantizado para subtítulos.
  - Fuentes: el "fontTitle" es el del TEMA editorial (TTF local), nunca una fuente
    detectada por red. Detectar la tipografía real de una marca es inviable offline.
  - El usuario SIEMPRE puede sobreescribir acento/tema en el wizard.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from io import BytesIO
from pathlib import Path

# ─── PALETTE canónica (mismos 10 hex que frontend/src/lib/style-templates.ts) ────
# El acento SNAPea a uno de estos → mono-color + contraste de subtítulos garantizado.
PALETTE = [
    ("rosa coral", "#fb7185"), ("violeta", "#a78bfa"), ("amarillo", "#fbbf24"),
    ("emerald", "#34d399"), ("cyan", "#22d3ee"), ("magenta", "#ec4899"),
    ("naranja", "#fb923c"), ("lime", "#a3e635"), ("indigo", "#6366f1"),
    ("violeta claro", "#c084fc"),
]

# ─── Tabla compacta de los 16 temas editoriales (id, bg, accent, isDark, fontTitle)
# Espejo de EDITORIAL_THEME_DEFS en remotion/src/layers/editorial-themes.tsx.
# Se usa SOLO para elegir el tema más cercano a la marca (bg luma + hue del acento).
THEMES = [
    ("prensa", "#e8e1cf", "#8e2a1e", False, "Old Standard TT"),
    ("vogue", "#0c0b0a", "#c9a96a", True, "Bodoni Moda"),
    ("kinfolk", "#f6f3ec", "#b06b4c", False, "Cormorant Garamond"),
    ("riso", "#f1ece0", "#FF48B0", False, "Archivo Black"),
    ("grabado", "#ece3cd", "#8a6d3b", False, "IM Fell English"),
    ("constructivista", "#ece2cf", "#cf2618", False, "Oswald"),
    ("bauhaus", "#f2e9d8", "#be1e2d", False, "Josefin Sans"),
    ("swiss", "#f4f4f1", "#e30613", False, "Inter Tight"),
    ("brutal", "#efefea", "#ff4d00", False, "Space Grotesk"),
    ("mincho", "#f5f3ed", "#b3342c", False, "Shippori Mincho"),
    ("stripe", "#0a2540", "#635bff", True, "Newsreader"),
    ("docu", "#f9f7f1", "#e3120b", False, "Libre Franklin"),
    ("ft", "#fff1e5", "#0d7680", False, "Libre Franklin"),
    ("art_deco", "#f3ead6", "#bd9a4e", False, "Cinzel"),
    ("blueprint", "#0b2138", "#34c6d8", True, "JetBrains Mono"),
    ("noir", "#0a0a0a", "#d8d2c4", True, "Playfair Display"),
]

DEFAULT = {
    "accent": "#fb7185", "themeId": "riso", "themeName": "Zine riso",
    "fontTitle": "Archivo Black", "palette": [], "bgLuma": 0.5,
    "source": "default", "ok": False,
}


# ─── Utilidades de color ──────────────────────────────────────────────────────
def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgb_to_hex(rgb) -> str:
    return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))


def luma(rgb) -> float:
    r, g, b = rgb[0] / 255, rgb[1] / 255, rgb[2] / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def rgb_to_hsv(rgb) -> tuple[float, float, float]:
    r, g, b = rgb[0] / 255, rgb[1] / 255, rgb[2] / 255
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        h = 0.0
    elif mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    h *= 60
    s = 0.0 if mx == 0 else d / mx
    return (h, s, mx)


def hue_dist(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def rgb_dist(a, b) -> float:
    return sum((a[i] - b[i]) ** 2 for i in range(3)) ** 0.5


# ─── Extracción de paleta desde imagen ────────────────────────────────────────
def extract_palette(img, k: int = 6):
    """Devuelve [(hex, weight0..1, rgb)] ordenado por frecuencia. Median-cut PIL."""
    from PIL import Image  # noqa: PLC0415

    im = img.convert("RGBA")
    # Aplanar alfa sobre BLANCO (los logos suelen ser transparentes sobre claro).
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert("RGB")
    im.thumbnail((240, 240))
    q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = q.getcolors() or []  # [(count, index), ...]
    total = sum(c for c, _ in counts) or 1
    out = []
    for count, idx in sorted(counts, reverse=True):
        rgb = (pal[idx * 3], pal[idx * 3 + 1], pal[idx * 3 + 2])
        out.append((rgb_to_hex(rgb), count / total, rgb))
    return out


def is_neutral(rgb) -> bool:
    """Casi blanco/negro/gris → fondo, no acento."""
    _h, s, v = rgb_to_hsv(rgb)
    return s < 0.18 or v < 0.10 or v > 0.96


def pick_accent(palette):
    """El color más VIVO (saturación×peso, luma media) snapeado a la PALETTE."""
    best, best_score = None, -1.0
    for _hex, w, rgb in palette:
        h, s, v = rgb_to_hsv(rgb)
        if v < 0.12 or v > 0.95:
            continue
        # premiar saturación y peso; penalizar extremos de luma (mal contraste).
        score = s * (0.4 + 0.6 * w) * (1.0 - abs(luma(rgb) - 0.5))
        if score > best_score:
            best, best_score = rgb, score
    if best is None:
        return PALETTE[0][1], None  # nada vivo → default
    raw_hex = rgb_to_hex(best)
    # SNAP a la PALETTE canónica (mono-color + contraste garantizado). Distancia
    # ponderada 70% hue / 30% rgb para respetar el "color de marca" percibido.
    bh, _bs, _bv = rgb_to_hsv(best)
    snap, snap_d = PALETTE[0][1], 1e9
    for _name, phex in PALETTE:
        prgb = hex_to_rgb(phex)
        ph, _ps, _pv = rgb_to_hsv(prgb)
        d = 0.7 * (hue_dist(bh, ph) / 180.0) + 0.3 * (rgb_dist(best, prgb) / 441.0)
        if d < snap_d:
            snap, snap_d = phex, d
    return snap, raw_hex


def pick_bg_luma(palette) -> float:
    """Luma del color de fondo (el neutral más frecuente, o el más frecuente)."""
    for _hex, _w, rgb in palette:
        if is_neutral(rgb):
            return luma(rgb)
    return luma(palette[0][2]) if palette else 0.5


def pick_theme(accent_hex: str, bg_luma: float):
    """Tema editorial más cercano: gate claro/oscuro por bg + hue del acento."""
    ah, _as, _av = rgb_to_hsv(hex_to_rgb(accent_hex))
    dark = bg_luma < 0.5
    best, best_d = None, 1e9
    for tid, tbg, taccent, tdark, tfont in THEMES:
        th, _ts, _tv = rgb_to_hsv(hex_to_rgb(taccent))
        # penalización fuerte si el tema no coincide en claro/oscuro con la marca.
        gate = 0.0 if tdark == dark else 0.5
        d = gate + 0.5 * (hue_dist(ah, th) / 180.0) + 0.5 * abs(luma(hex_to_rgb(tbg)) - bg_luma)
        if d < best_d:
            best, best_d = (tid, tbg, taccent, tdark, tfont), d
    return best


# ─── Camino URL: bajar og:image / theme-color (degradable sin red) ────────────
def fetch_from_url(url: str):
    """Devuelve (PIL.Image|None, theme_color_hex|None). Nunca lanza."""
    try:
        import requests  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415

        if not re.match(r"^https?://", url):
            url = "https://" + url
        headers = {"User-Agent": "Mozilla/5.0 (Viralito brand-from-url)"}
        r = requests.get(url, headers=headers, timeout=8)
        html = r.text
        base = re.match(r"^(https?://[^/]+)", url)
        origin = base.group(1) if base else ""
        # theme-color meta (semilla de acento aunque no haya imagen).
        tc = re.search(r'<meta[^>]+name=["\']theme-color["\'][^>]+content=["\']([^"\']+)', html, re.I)
        theme_color = None
        if tc:
            m = re.search(r"#[0-9a-fA-F]{3,6}", tc.group(1))
            if m:
                theme_color = m.group(0)
        # og:image / twitter:image → paleta rica.
        og = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', html, re.I) \
            or re.search(r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)', html, re.I)
        img = None
        if og:
            src = og.group(1)
            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                src = origin + src
            ir = requests.get(src, headers=headers, timeout=8)
            img = Image.open(BytesIO(ir.content))
        return img, theme_color
    except Exception:  # noqa: BLE001 — sin red / web rara → default
        return None, None


def build_from_image(img, source: str) -> dict:
    palette = extract_palette(img, k=6)
    if not palette:
        return {**DEFAULT, "source": source}
    accent, raw = pick_accent(palette)
    bg_luma = pick_bg_luma(palette)
    tid, tbg, taccent, tdark, tfont = pick_theme(accent, bg_luma)
    tname = next((n for i, n in _THEME_NAMES if i == tid), tid)
    return {
        "accent": accent,
        "accentRaw": raw,
        "palette": [h for h, _w, _rgb in palette],
        "themeId": tid,
        "themeName": tname,
        "fontTitle": tfont,
        "bgLuma": round(bg_luma, 3),
        "source": source,
        "ok": True,
    }


# Nombres vendibles (para el wizard) — espejo de EDITORIAL_THEME_DEFS[].name.
_THEME_NAMES = [
    ("prensa", "Prensa 1900"), ("vogue", "Vogue noir"), ("kinfolk", "Kinfolk calma"),
    ("riso", "Zine riso"), ("grabado", "Grabado victoriano"), ("constructivista", "Constructivista"),
    ("bauhaus", "Bauhaus"), ("swiss", "Suizo grid"), ("brutal", "Brutalista"),
    ("mincho", "Japón mincho"), ("stripe", "Stripe press"), ("docu", "Docu rojo"),
    ("ft", "FT salmón"), ("art_deco", "Art Déco"), ("blueprint", "Blueprint"), ("noir", "Noir"),
]


def main() -> None:
    ap = argparse.ArgumentParser(description="Marca → paleta + acento + tema editorial")
    ap.add_argument("--image", help="ruta local a logo/screenshot")
    ap.add_argument("--url", help="URL de la marca (baja og:image/theme-color)")
    ap.add_argument("--out", help="escribir JSON a este archivo (default: stdout)")
    args = ap.parse_args()

    result = {**DEFAULT}
    try:
        if args.image:
            from PIL import Image  # noqa: PLC0415

            img = Image.open(args.image)
            result = build_from_image(img, "logo")
        elif args.url:
            img, theme_color = fetch_from_url(args.url)
            if img is not None:
                result = build_from_image(img, "url")
            elif theme_color:
                # Sin imagen pero con theme-color: acento desde ahí, tema por su luma.
                accent, raw = _snap_hex(theme_color)
                bg = luma(hex_to_rgb(theme_color))
                tid, tbg, taccent, tdark, tfont = pick_theme(accent, bg)
                tname = next((n for i, n in _THEME_NAMES if i == tid), tid)
                result = {"accent": accent, "accentRaw": raw, "palette": [theme_color],
                          "themeId": tid, "themeName": tname, "fontTitle": tfont,
                          "bgLuma": round(bg, 3), "source": "url-theme-color", "ok": True}
            else:
                result = {**DEFAULT, "source": "url-failed"}
        else:
            ap.error("se requiere --image o --url")
    except Exception as e:  # noqa: BLE001 — jamás abortar
        result = {**DEFAULT, "source": "error", "error": str(e)[:200]}

    payload = json.dumps(result, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
    print(payload)


def _snap_hex(hex_in: str):
    """Snap de un hex suelto a la PALETTE (para theme-color sin imagen)."""
    rgb = hex_to_rgb(hex_in)
    h, _s, _v = rgb_to_hsv(rgb)
    snap, snap_d = PALETTE[0][1], 1e9
    for _name, phex in PALETTE:
        prgb = hex_to_rgb(phex)
        ph, _ps, _pv = rgb_to_hsv(prgb)
        d = 0.7 * (hue_dist(h, ph) / 180.0) + 0.3 * (rgb_dist(rgb, prgb) / 441.0)
        if d < snap_d:
            snap, snap_d = phex, d
    return snap, hex_in


if __name__ == "__main__":
    main()
