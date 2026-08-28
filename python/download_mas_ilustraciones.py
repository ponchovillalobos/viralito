"""Amplía la colección de ilustraciones: MÁS del mismo estilo y MÁS estilos.

El desbalance era grande: 22.897 iconos en disco contra 158 ilustraciones. Los
iconos son un símbolo abstracto; las ilustraciones son lo que le da carácter al
video, y eran el recurso escaso.

QUÉ BAJA
Estilos de DiceBear (`api.dicebear.com`, sin clave, sin login). Cada estilo se
genera por SEMILLA, así que la variedad es prácticamente ilimitada: la misma
semilla da siempre la misma figura, distintas semillas dan figuras distintas del
mismo trazo.

Se organizan en FAMILIAS, porque mezclar trazos distintos dentro de un mismo
video es justo lo que rompe un estilo sobrio:

    personas   figuras humanas dibujadas (open-peeps, notionists, lorelei,
               avataaars, y sus variantes neutral)
    plano      formas planas y sólidas (thumbs, shapes, glass, rings)
    pixel      pixel art (pixel-art, pixel-art-neutral)
    bichos     robots (bottts, bottts-neutral)

La familia `trazo` la cubren los sets que ya estaban en disco (open-doodles).

LICENCIAS — VERIFICADAS UNA POR UNA
Sólo entran estilos **CC0** o "free for personal and commercial use" SIN
atribución obligatoria, porque el video se publica sin créditos en pantalla.

Quedaron FUERA a propósito, aunque permiten uso comercial, por exigir atribución
(CC BY 4.0): adventurer, big-ears, big-smile, croodles, dylan, fun-emoji, micah,
miniavs, personas, toon-head, glyphs.

  OJO: `croodles` YA ESTÁ en disco y el comentario de `download_illustrations.py`
  lo declara CC0. Es **CC BY 4.0** (vijay verma). Verificado en
  dicebear.com/styles. Este script no lo baja; qué hacer con las 41 que ya están
  es una decisión aparte.

Uso:
  python download_mas_ilustraciones.py                 # todo, ~40 por estilo
  python download_mas_ilustraciones.py --por-estilo 80
  python download_mas_ilustraciones.py --familia personas
  python download_mas_ilustraciones.py --listar
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from config import DATA_ROOT

ILLUSTRATIONS_DIR = Path(DATA_ROOT) / "assets" / "illustrations"
UA = "viralito-ilustraciones/2.0"
API = "https://api.dicebear.com/9.x/{estilo}/svg?seed={seed}"

CC0 = "CC0-1.0"
LIBRE = "Free for personal and commercial use, no attribution required"

# (estilo, familia, licencia, autor). Sólo sin atribución obligatoria.
ESTILOS: list[tuple[str, str, str, str]] = [
    # personas — figuras humanas
    ("open-peeps",         "personas", CC0,   "Pablo Stanley"),
    ("notionists",         "personas", CC0,   "Zoish"),
    ("notionists-neutral", "personas", CC0,   "Zoish"),
    ("lorelei",            "personas", CC0,   "Lisa Wischofsky"),
    ("lorelei-neutral",    "personas", CC0,   "Lisa Wischofsky"),
    ("avataaars",          "personas", LIBRE, "Pablo Stanley"),
    ("avataaars-neutral",  "personas", LIBRE, "Pablo Stanley"),
    # plano — formas sólidas
    ("thumbs",             "plano",    CC0,   "DiceBear"),
    ("shapes",             "plano",    CC0,   "DiceBear"),
    ("glass",              "plano",    CC0,   "DiceBear"),
    ("rings",              "plano",    CC0,   "DiceBear"),
    # pixel
    ("pixel-art",          "pixel",    CC0,   "DiceBear"),
    ("pixel-art-neutral",  "pixel",    CC0,   "DiceBear"),
    # bichos — robots
    ("bottts",             "bichos",   LIBRE, "Pablo Stanley"),
    ("bottts-neutral",     "bichos",   LIBRE, "Pablo Stanley"),
]

# NOMBRES QUE NO EXISTEN EN LA API 9.x, y de donde salio el error
#
# La primera version de este archivo listaba 23 estilos sacados de la pagina de
# documentacion de DiceBear. DIEZ devolvian 404: line-face, gaze, cameo, clay,
# cutouts, moods, shadows, pixelbot, critters, sprouts.
#
# El script no lo decia: reintentaba tres veces por semilla, con espera
# creciente, para las 80 semillas de cada estilo inexistente. Parecia colgado.
#
# La leccion es la de siempre en este proyecto: la pagina de documentacion NO es
# la fuente de verdad, la API si. Por eso ahora se comprueba antes de bajar.

# FUERA a proposito, aunque la API los sirve: exigen atribucion (CC BY 4.0) y el
# video se publica sin creditos en pantalla.
#   adventurer, adventurer-neutral, big-ears, big-ears-neutral, big-smile,
#   croodles, croodles-neutral, dylan, fun-emoji, micah, miniavs, personas,
#   toon-head, glyphs, icons (MIT, tambien pide atribucion)
MIN_BYTES = 300  # un SVG real pesa >1 KB; menos = respuesta de error


def _semillas(estilo: str, n: int) -> list[str]:
    """Semillas estables por estilo: el mismo estilo baja siempre lo mismo.

    Se derivan del nombre para que dos estilos NO compartan semillas — con
    semillas iguales, `open-peeps` y `notionists` generarían la "misma persona"
    en dos trazos, y al alternarlas se ve repetido.
    """
    return [f"{estilo}-{i:03d}" for i in range(n)]


def _bajar(url: str, reintentos: int = 3, timeout: int = 45) -> bytes | None:
    for intento in range(1, reintentos + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, OSError):
            if intento == reintentos:
                return None
            time.sleep(1.5 * intento)
    return None


def bajar_estilo(estilo: str, familia: str, licencia: str, autor: str,
                 cuantas: int, forzar: bool) -> tuple[int, int]:
    """Devuelve (bajadas, ya_estaban)."""
    dest = ILLUSTRATIONS_DIR / estilo
    dest.mkdir(parents=True, exist_ok=True)

    (dest / "LICENSE.txt").write_text(
        f"{estilo} — DiceBear\n"
        f"Autor del arte: {autor}\n"
        f"Licencia: {licencia}\n"
        f"Fuente: https://www.dicebear.com/styles/{estilo}/\n"
        f"Verificado contra dicebear.com/styles el 2026-08-28.\n"
        f"Permite uso comercial y reempaquetado SIN atribucion obligatoria.\n",
        encoding="utf-8",
    )

    nuevas = ya = 0
    entradas: list[dict] = []
    for seed in _semillas(estilo, cuantas):
        f = dest / f"{seed}.svg"
        entradas.append({"file": f.name, "set": estilo, "familia": familia,
                         "license": licencia, "autor": autor, "multicolor": True})
        if f.exists() and f.stat().st_size >= MIN_BYTES and not forzar:
            ya += 1
            continue
        datos = _bajar(API.format(estilo=estilo, seed=seed))
        if not datos or len(datos) < MIN_BYTES:
            continue
        f.write_bytes(datos)
        nuevas += 1

    (dest / "manifest.json").write_text(
        json.dumps(entradas, ensure_ascii=False, indent=2), encoding="utf-8")
    return nuevas, ya


def main() -> int:
    ap = argparse.ArgumentParser(description="Más ilustraciones, más estilos")
    ap.add_argument("--por-estilo", type=int, default=40,
                    help="Cuántas por estilo (default 40). Son por semilla: subir "
                         "este número da más variedad del MISMO trazo.")
    ap.add_argument("--familia", default=None,
                    help="Sólo una familia: personas, trazo, plano, pixel, bichos")
    ap.add_argument("--forzar", action="store_true", help="Re-baja lo que ya está")
    ap.add_argument("--listar", action="store_true", help="Muestra el catálogo y sale")
    args = ap.parse_args()

    if args.listar:
        print(f"{'estilo':22} {'familia':10} licencia")
        for e, fam, lic, _ in ESTILOS:
            print(f"  {e:20} {fam:10} {lic}")
        print(f"\n  {len(ESTILOS)} estilos · todos permiten uso comercial SIN atribucion")
        return 0

    estilos = [x for x in ESTILOS if not args.familia or x[1] == args.familia]

    # COMPROBAR ANTES DE BAJAR. Un nombre que no existe devuelve 404 en cada
    # semilla, y con reintentos y espera el script parece colgado sin decir por
    # que. Una sola peticion por estilo lo descarta en segundos.
    print("[ilustraciones] comprobando que los estilos existan...", flush=True)
    vivos = []
    for e in estilos:
        if _bajar(API.format(estilo=e[0], seed="_probe"), reintentos=1, timeout=15):
            vivos.append(e)
        else:
            print(f"  ! {e[0]}: la API no lo sirve — se salta", file=sys.stderr)
    if not vivos:
        print("[ilustraciones] ningun estilo respondio", file=sys.stderr)
        return 1
    estilos = vivos
    if not estilos:
        print(f"[ilustraciones] familia desconocida: {args.familia}", file=sys.stderr)
        return 1

    tot_nuevas = tot_ya = 0
    for estilo, familia, licencia, autor in estilos:
        n, y = bajar_estilo(estilo, familia, licencia, autor, args.por_estilo, args.forzar)
        tot_nuevas += n
        tot_ya += y
        print(f"  {estilo:22} {familia:9} +{n:4} nuevas, {y:4} ya estaban", flush=True)

    total = sum(1 for _ in ILLUSTRATIONS_DIR.rglob("*.svg"))
    print(f"\n[ilustraciones] +{tot_nuevas} nuevas · {tot_ya} ya estaban")
    print(f"[ilustraciones] la coleccion tiene ahora {total} ilustraciones")
    return 0


if __name__ == "__main__":
    sys.exit(main())
