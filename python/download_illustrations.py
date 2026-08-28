"""OLA 3 — Ilustraciones de PERSONAS (figuras humanas dibujadas), CC0, sin API key.

Hoy el sistema tiene 0 figuras humanas: este es el recurso #1 que faltaba para
hooks / intros / reacciones. Baja personas MULTICOLOR (no son currentColor como
los iconos) a:

    {DATA_ROOT}/assets/illustrations/<set>/*.svg

…junto con un LICENSE.txt por set y un manifest.json con
    {file, set, license:"CC0", multicolor:true} por archivo.

IMPORTANTE — MULTICOLOR
    A diferencia de los iconos (stroke/fill = currentColor, que el render tiñe
    con el acento del tema), estas ilustraciones traen sus PROPIOS colores
    (piel, ropa, pelo…). El render NO debe teñirlas con el tema; la capa duotono
    (otro agente) las procesa aparte. Por eso cada entrada del manifest lleva
    "multicolor": true.

Sets (todos CC0-1.0, descarga sin login / sin key):

  1. open-doodles — 33 escenas de gente en estilo sketch, de
     github.com/lunahq/react-open-doodles (los SVG viven inline dentro de los
     .tsx; los extraemos vía raw.githubusercontent.com). El WRAPPER react es
     MIT, pero el ARTE es "Open Doodles" de Pablo Stanley, dominio público CC0
     (opendoodles.com/about: "CC0 license … Free for Commercial and Personal
     Use. No need to credit"). Multicolor: tiene un color de tinta (ink) y uno
     de acento (accent); aquí los fijamos a valores literales para que el SVG
     sea autocontenido.

  2. open-peeps — personas componibles medio-cuerpo, sketch, de Pablo Stanley,
     CC0-1.0. Las generamos como SVG completos y deterministas (por semilla)
     vía DiceBear (api.dicebear.com, SIN key, SIN login). El propio SVG embebe
     en sus metadatos: "Remix of 'Open Peeps' by 'Pablo Stanley', licensed
     under CC0 1.0". Multicolor (piel/pelo/ropa). Cada semilla = un personaje
     distinto y reproducible.

Reintentos, idempotente. Si un set ya tiene >= min archivos, se salta.

Uso:
    python download_illustrations.py                 # baja todo
    VIRAL_DATA_ROOT=C:\\ruta python download_illustrations.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from config import DATA_ROOT  # type: ignore

ILLUSTRATIONS_DIR = Path(DATA_ROOT) / "assets" / "illustrations"

UA = "estrategia-viral-illustrations/1.0"

# --- Open Doodles: 33 componentes en lunahq/react-open-doodles -----------------
# Los componentes se llaman "<Name>Doodle.tsx" (p.ej. DancingDoodle.tsx).
OPEN_DOODLES_RAW = (
    "https://raw.githubusercontent.com/lunahq/react-open-doodles/master/src/components/{name}Doodle.tsx"
)
OPEN_DOODLES_NAMES = [
    "Ballet", "Bikini", "Chilling", "Clumsy", "Coffee", "Dancing", "DogJump",
    "Doggie", "Float", "Groovy", "IceCream", "Jumping", "Laying", "Levitate",
    "Loving", "Meditating", "Moshing", "Petting", "Plant", "Reading",
    "ReadingSide", "RollerSkating", "Rolling", "Running", "Selfie", "Sitting",
    "SittingReading", "Sleek", "Sprinting", "Strolling", "Swinging", "Unboxing",
    "Zombieing",
]
# Los componentes usan props {ink}/{accent}; los fijamos a literales para que el
# SVG quede autocontenido y multicolor. (Defaults de la librería: ink negro,
# accent durazno.)
DOODLE_INK = "#322f53"
DOODLE_ACCENT = "#ffc44c"

OPEN_DOODLES_LICENSE = (
    "Open Doodles by Pablo Stanley — CC0 1.0 Universal (Public Domain Dedication).\n"
    "Source art: https://www.opendoodles.com/  (https://www.opendoodles.com/about)\n"
    'opendoodles.com/about: "You can copy, edit, remix, share, or redraw these\n'
    "images for any purpose without restriction under copyright or database law\n"
    "(CC0 license). Free for Commercial and Personal Use. No need to credit.\"\n"
    "SVGs extracted from the GitHub mirror github.com/lunahq/react-open-doodles\n"
    "(the React wrapper code is MIT; the underlying artwork is CC0).\n"
    "License text: https://creativecommons.org/publicdomain/zero/1.0/\n"
)

# --- Open Peeps: personas completas vía DiceBear (sin key, sin login) ----------
OPEN_PEEPS_URL = "https://api.dicebear.com/9.x/open-peeps/svg?seed={seed}"
# Semillas fijas -> personajes reproducibles y variados (expresiones/pelo/ropa).
OPEN_PEEPS_SEEDS = [
    "Felix", "Aneka", "Mateo", "Sofia", "Liam", "Valentina", "Diego", "Camila",
    "Hugo", "Lucia", "Mateo2", "Regina", "Bruno", "Renata", "Emiliano", "Ximena",
    "Santiago", "Paloma", "Andres", "Frida", "Pablo", "Daniela", "Tomas", "Gabriela",
    "Nicolas", "Mariana", "Joaquin", "Antonia", "Sebastian", "Isabella", "Maximo",
    "Catalina", "Ignacio", "Victoria", "Rodrigo", "Julieta", "Benjamin", "Florencia",
    "Alejandro", "Carolina",
]
OPEN_PEEPS_LICENSE = (
    "Open Peeps by Pablo Stanley — CC0 1.0 Universal (Public Domain Dedication).\n"
    "Source: https://www.openpeeps.com/  (CC0 1.0).\n"
    "These SVGs are deterministic remixes generated via DiceBear (keyless, no\n"
    "login): https://www.dicebear.com/styles/open-peeps/ — each file embeds in\n"
    'its <metadata>: "Remix of \'Open Peeps\' by \'Pablo Stanley\', licensed\n'
    'under CC0 1.0". The DiceBear library code is MIT; the artwork remix is CC0.\n'
    "License text: https://creativecommons.org/publicdomain/zero/1.0/\n"
)

# --- Croodles: doodles a mano alzada vía DiceBear (sin key, sin login) ---------
# Estilo "croodles" de DiceBear: caras/personajes dibujados a mano, look sketch.
# OJO: este set NO es CC0. Aca decia "Arte CC0 (vbenjs/croodles)" y era falso por
# partida doble: el autor es vijay verma y la licencia es CC BY 4.0, como dice el
# <metadata> de cada SVG que este mismo script bajo. Pide credito y el video se
# publica sin creditos, asi que ya no se descarga ni se usa en renders.
CROODLES_URL = "https://api.dicebear.com/9.x/croodles/svg?seed={seed}"
CROODLES_SEEDS = [
    "Felix", "Aneka", "Mateo", "Sofia", "Liam", "Valentina", "Diego", "Camila",
    "Hugo", "Lucia", "Mateo2", "Regina", "Bruno", "Renata", "Emiliano", "Ximena",
    "Santiago", "Paloma", "Andres", "Frida", "Pablo", "Daniela", "Tomas", "Gabriela",
    "Nicolas", "Mariana", "Joaquin", "Antonia", "Sebastian", "Isabella", "Maximo",
    "Catalina", "Ignacio", "Victoria", "Rodrigo", "Julieta", "Benjamin", "Florencia",
    "Alejandro", "Carolina",
]
CROODLES_LICENSE = (
    "Croodles - CC BY 4.0 (Attribution 4.0 International). NO es CC0.\n"
    "Autor del arte: vijay verma.\n"
    "Source: https://www.dicebear.com/styles/croodles/\n"
    "Original: https://www.figma.com/community/file/966199982810283152\n"
    "\n"
    "EXIGE credito visible. Lo dice el <metadata> de cada SVG que este mismo\n"
    "script bajo; el texto anterior decia CC0 y era falso por partida doble (el\n"
    "autor no es vbenjs). Viralito publica sin creditos en pantalla, asi que este\n"
    "set NO entra en renders.\n"
    "License text: https://creativecommons.org/licenses/by/4.0/\n"
)

# --- Notionists: personas estilo "Notion" vía DiceBear (sin key, sin login) ----
# Estilo "notionists" de DiceBear: avatares de medio cuerpo, look ilustrado plano.
# Arte CC0 (Notionists de Zoish vía DiceBear), embebido en cada SVG. Multicolor.
NOTIONISTS_URL = "https://api.dicebear.com/9.x/notionists/svg?seed={seed}"
NOTIONISTS_SEEDS = [
    "Felix", "Aneka", "Mateo", "Sofia", "Liam", "Valentina", "Diego", "Camila",
    "Hugo", "Lucia", "Mateo2", "Regina", "Bruno", "Renata", "Emiliano", "Ximena",
    "Santiago", "Paloma", "Andres", "Frida", "Pablo", "Daniela", "Tomas", "Gabriela",
    "Nicolas", "Mariana", "Joaquin", "Antonia", "Sebastian", "Isabella", "Maximo",
    "Catalina", "Ignacio", "Victoria", "Rodrigo", "Julieta", "Benjamin", "Florencia",
    "Alejandro", "Carolina",
]
NOTIONISTS_LICENSE = (
    "Notionists — CC0 1.0 Universal (Public Domain Dedication).\n"
    "Source style: https://www.dicebear.com/styles/notionists/  (Notionists by Zoish).\n"
    "These SVGs are deterministic avatars generated via DiceBear (keyless, no\n"
    "login): https://www.dicebear.com/styles/notionists/ — each file embeds its\n"
    'license in <metadata> (CC0 1.0). The DiceBear library code is MIT; the\n'
    "underlying artwork is CC0. Multicolor (no currentColor).\n"
    "License text: https://creativecommons.org/publicdomain/zero/1.0/\n"
)


def _fetch(url: str, retries: int = 4, timeout: int = 60) -> bytes:
    """GET con reintentos (backoff). Lanza la última excepción si todo falla."""
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:  # noqa: BLE001
            last = e
            wait = min(2 ** attempt, 15)
            print(f"  reintento {attempt}/{retries} ({url.rsplit('/', 1)[-1]}): {e} — espero {wait}s",
                  file=sys.stderr, flush=True)
            time.sleep(wait)
    assert last is not None
    raise last


# viewBox completo: <svg ...viewBox="0 0 1024 768">  …  </svg>
_SVG_RE = re.compile(r"<svg\b.*?</svg>", re.DOTALL)


def _tsx_to_svg(tsx: str) -> str | None:
    """Extrae el bloque <svg>…</svg> de un componente .tsx de react-open-doodles
    y reemplaza las props JSX ({accent}/{ink}, fillRule→fill-rule, etc.) por SVG
    válido y autocontenido."""
    m = _SVG_RE.search(tsx)
    if not m:
        return None
    svg = m.group(0)
    # Sustituir las expresiones de color de JSX ({accent}/{ink}) por literales.
    # En JSX la prop va SIN comillas: fill={accent}. En SVG/XML el valor DEBE ir
    # entre comillas, así que reemplazamos incluyendo las comillas: fill="#…".
    svg = svg.replace("{accent}", f'"{DOODLE_ACCENT}"').replace("{ink}", f'"{DOODLE_INK}"')
    # Por si alguna ocurrencia ya venía citada (="{accent}") -> evita comillas dobles.
    svg = svg.replace('""', '"')
    # Atributos JSX camelCase -> kebab-case del estándar SVG.
    svg = re.sub(r"\bfillRule=", "fill-rule=", svg)
    svg = re.sub(r"\bstrokeWidth=", "stroke-width=", svg)
    svg = re.sub(r"\bstrokeLinecap=", "stroke-linecap=", svg)
    svg = re.sub(r"\bstrokeLinejoin=", "stroke-linejoin=", svg)
    svg = re.sub(r"\bclipRule=", "clip-rule=", svg)
    svg = re.sub(r"\bclipPath=", "clip-path=", svg)
    svg = re.sub(r"\bxmlnsXlink=", "xmlns:xlink=", svg)
    svg = re.sub(r"\bxlinkHref=", "xlink:href=", svg)
    # Si por algún motivo queda una expresión {…} sin resolver, no es SVG válido.
    if "{" in svg and "}" in svg and re.search(r"\{[A-Za-z]", svg):
        return None
    if not svg.lstrip().startswith("<svg"):
        return None
    header = '<?xml version="1.0" encoding="UTF-8"?>\n'
    return header + svg + "\n"


def download_open_doodles(limit: int | None = None) -> int:
    dest = ILLUSTRATIONS_DIR / "open-doodles"
    names = OPEN_DOODLES_NAMES if limit is None else OPEN_DOODLES_NAMES[:limit]
    existing = len(list(dest.glob("*.svg"))) if dest.exists() else 0
    if existing >= len(names):
        print(f"ya existe: open-doodles ({existing} SVG) — salto")
        return existing
    dest.mkdir(parents=True, exist_ok=True)
    print(f"bajando open-doodles ({len(names)} escenas) …", flush=True)
    n = 0
    for name in names:
        out = dest / f"{_snake(name)}.svg"
        if out.exists() and out.stat().st_size > 0:
            n += 1
            continue
        url = OPEN_DOODLES_RAW.format(name=name)
        try:
            tsx = _fetch(url).decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR {name}: {e}", file=sys.stderr)
            continue
        svg = _tsx_to_svg(tsx)
        if not svg:
            print(f"  ADVERTENCIA: no pude extraer SVG de {name}.tsx", file=sys.stderr)
            continue
        out.write_text(svg, encoding="utf-8")
        n += 1
    (dest / "LICENSE.txt").write_text(OPEN_DOODLES_LICENSE, encoding="utf-8")
    print(f"  listos: {n} SVG en {dest}")
    return n


def download_open_peeps(limit: int | None = None) -> int:
    dest = ILLUSTRATIONS_DIR / "open-peeps"
    seeds = OPEN_PEEPS_SEEDS if limit is None else OPEN_PEEPS_SEEDS[:limit]
    existing = len(list(dest.glob("*.svg"))) if dest.exists() else 0
    if existing >= len(seeds):
        print(f"ya existe: open-peeps ({existing} SVG) — salto")
        return existing
    dest.mkdir(parents=True, exist_ok=True)
    print(f"bajando open-peeps ({len(seeds)} personas) …", flush=True)
    n = 0
    for seed in seeds:
        out = dest / f"peep_{_snake(seed)}.svg"
        if out.exists() and out.stat().st_size > 0:
            n += 1
            continue
        url = OPEN_PEEPS_URL.format(seed=urllib.request.quote(seed))
        try:
            data = _fetch(url)
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR {seed}: {e}", file=sys.stderr)
            continue
        text = data.decode("utf-8", errors="replace")
        if "<svg" not in text:
            print(f"  ADVERTENCIA: respuesta no-SVG para {seed}", file=sys.stderr)
            continue
        out.write_bytes(data)
        n += 1
    (dest / "LICENSE.txt").write_text(OPEN_PEEPS_LICENSE, encoding="utf-8")
    print(f"  listos: {n} SVG en {dest}")
    return n


def _download_dicebear_set(
    set_name: str, url_tmpl: str, seeds: list[str], file_prefix: str,
    license_text: str, label: str, limit: int | None = None,
) -> int:
    """Baja un set DiceBear (un SVG por semilla) a assets/illustrations/<set_name>.
    Igual que open-peeps: keyless, idempotente; si ya hay >= esperados, se salta."""
    dest = ILLUSTRATIONS_DIR / set_name
    use_seeds = seeds if limit is None else seeds[:limit]
    existing = len(list(dest.glob("*.svg"))) if dest.exists() else 0
    if existing >= len(use_seeds):
        print(f"ya existe: {set_name} ({existing} SVG) — salto")
        return existing
    dest.mkdir(parents=True, exist_ok=True)
    print(f"bajando {set_name} ({len(use_seeds)} {label}) …", flush=True)
    n = 0
    for seed in use_seeds:
        out = dest / f"{file_prefix}_{_snake(seed)}.svg"
        if out.exists() and out.stat().st_size > 0:
            n += 1
            continue
        url = url_tmpl.format(seed=urllib.request.quote(seed))
        try:
            data = _fetch(url)
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR {seed}: {e}", file=sys.stderr)
            continue
        text = data.decode("utf-8", errors="replace")
        if "<svg" not in text:
            print(f"  ADVERTENCIA: respuesta no-SVG para {seed}", file=sys.stderr)
            continue
        out.write_bytes(data)
        n += 1
    (dest / "LICENSE.txt").write_text(license_text, encoding="utf-8")
    print(f"  listos: {n} SVG en {dest}")
    return n


def download_croodles(limit: int | None = None) -> int:
    """Doodles a mano alzada vía DiceBear (CC0, sin key)."""
    return _download_dicebear_set(
        "croodles", CROODLES_URL, CROODLES_SEEDS, "crood",
        CROODLES_LICENSE, "doodles", limit,
    )


def download_notionists(limit: int | None = None) -> int:
    """Personas estilo Notion vía DiceBear (CC0, sin key)."""
    return _download_dicebear_set(
        "notionists", NOTIONISTS_URL, NOTIONISTS_SEEDS, "notion",
        NOTIONISTS_LICENSE, "personas", limit,
    )


def _snake(name: str) -> str:
    """CamelCase / mixto -> snake_case ascii para nombres de archivo estables."""
    s = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    s = re.sub(r"[^a-z0-9_]+", "_", s).strip("_")
    return s or "x"


def write_manifest() -> int:
    """Manifest global: {file, set, license:"CC0", multicolor:true} por SVG."""
    entries: list[dict] = []
    for set_dir in sorted(p for p in ILLUSTRATIONS_DIR.iterdir() if p.is_dir()):
        for svg in sorted(set_dir.glob("*.svg")):
            entries.append({
                "file": f"{set_dir.name}/{svg.name}",
                "set": set_dir.name,
                "license": "CC0",
                # MULTICOLOR: estas ilustraciones traen sus propios colores;
                # el render NO debe teñirlas con el acento del tema.
                "multicolor": True,
            })
    manifest = {
        "kind": "illustrations",
        "note": (
            "Figuras humanas CC0 (personas). MULTICOLOR: no son currentColor; "
            "el render no las tiñe con el tema, la capa duotono las procesa aparte."
        ),
        "count": len(entries),
        "illustrations": entries,
    }
    ILLUSTRATIONS_DIR.mkdir(parents=True, exist_ok=True)
    (ILLUSTRATIONS_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return len(entries)


def main(argv: list[str]) -> int:
    # --limit N: baja sólo N por set (para verificación rápida de un subset).
    limit: int | None = None
    for i, a in enumerate(argv):
        if a == "--limit" and i + 1 < len(argv):
            try:
                limit = int(argv[i + 1])
            except ValueError:
                pass

    print(f"destino: {ILLUSTRATIONS_DIR}", flush=True)
    total = 0
    ok = True
    for fn, name, expect in (
        (download_open_doodles, "open-doodles", len(OPEN_DOODLES_NAMES)),
        (download_open_peeps, "open-peeps", len(OPEN_PEEPS_SEEDS)),
        # (download_croodles, ...) — retirado: CC BY 4.0, ver arriba.
        (download_notionists, "notionists", len(NOTIONISTS_SEEDS)),
    ):
        try:
            n = fn(limit)
            total += n
            target = expect if limit is None else min(limit, expect)
            if n < target:
                ok = False
                print(f"ADVERTENCIA: {name} trajo {n} (< {target})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"ERROR {name}: {e}", file=sys.stderr)

    m = write_manifest()
    print(f"manifest: {m} entradas en {ILLUSTRATIONS_DIR / 'manifest.json'}")
    print(f"TOTAL: {total} ilustraciones (MULTICOLOR — no teñir con el tema)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
