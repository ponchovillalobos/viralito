"""Revisa un proyecto ANTES de renderizarlo.

Por qué existe: un render tarda minutos y casi nunca falla con un error. Falla
entregando un video con algo mal — diez segundos de negro al final, un B-roll que
nunca aparece, música que no suena — y eso solo se descubre mirando el resultado.
El caso que motivó esto fue real: los clips declaraban la duración que se había
PEDIDO en vez de la que quedó en el archivo, y con recorte de silencios la
diferencia llegaba a diez segundos. El render armaba la composición con el número
declarado, así que sobraba metraje sin video debajo. Nadie vio un error.

La idea es sencilla: casi todo en un proyecto es un elemento con `start`/`end`
sobre una línea de tiempo, y el video tiene una duración medible. Cruzar las dos
cosas atrapa una familia entera de problemas en menos de un segundo.

Se distingue entre:
  ERROR   — el render va a salir mal. Vale la pena parar.
  AVISO   — probablemente no era la intención, pero el video sale.

Uso:
    python verificar_proyecto.py <proyecto.json> [--video <mp4>] [--json]

Sale con código 1 si hay ERRORES, 0 si sólo hay avisos o nada.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import config

# Listas de elementos con tiempos. El nombre del campo de inicio/fin varía según
# la lista, así que cada entrada declara el suyo. Un elemento sin tiempos (o con
# tiempos nulos) se ignora: hay listas donde son opcionales.
LISTAS_CON_TIEMPO: tuple[tuple[str, str, str], ...] = (
    ("bRoll", "start", "end"),
    ("captions", "start", "end"),
    ("manualSubtitles", "start", "end"),
    ("animations", "start", "end"),
    ("emphasisCards", "start", "end"),
    ("wordStickers", "start", "end"),
    ("floatingEmojis", "start", "end"),
    ("imageOverlays", "start", "end"),
    ("cameraMoves", "start", "end"),
    ("reactionZooms", "start", "end"),
    ("sceneFx", "start", "end"),
    ("proTransitions", "start", "end"),
    ("iconStickers", "start", "end"),
    ("lottieStickers", "start", "end"),
    ("particleBursts", "start", "end"),
)

# Listas de marcas instantáneas: un solo tiempo, sin duración.
LISTAS_CON_MARCA: tuple[tuple[str, str], ...] = (
    ("zoomMarks", "time"),
    ("stutterMarks", "time"),
    ("sfxMarks", "time"),
)

# Tolerancia al final del video. Un elemento que se pasa por menos de esto es
# redondeo de frames, no un error: a 30 fps un frame dura 0.033s.
MARGEN_S = 0.5


class Hallazgo:
    def __init__(self, nivel: str, texto: str) -> None:
        self.nivel = nivel  # "ERROR" | "AVISO"
        self.texto = texto

    def __repr__(self) -> str:  # pragma: no cover - sólo para depurar
        return f"{self.nivel}: {self.texto}"


def duracion_de(video: Path) -> float | None:
    """Duración real del archivo, en segundos. None si no se puede medir."""
    try:
        r = subprocess.run(
            [str(config.FFPROBE_PATH), "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(video)],
            capture_output=True, text=True, check=True, timeout=60,
        )
        return float((r.stdout or "").strip())
    except (subprocess.SubprocessError, ValueError, OSError):
        return None


def _ruta_de_asset_local(url: str) -> Path | None:
    """Traduce una URL del dashboard al archivo que sirve, si es local.

    La música viaja como `/api/music/stream?file=x.mp3` y los SFX parecido. Las
    URLs http externas (Pexels, Giphy) no se revisan acá: comprobarlas exigiría
    red, y una descarga fallida ya tiene su propio manejo en el render.

    OJO con buscar sólo en la carpeta raíz: los assets están repartidos en
    subcarpetas por origen (`music/github/`, `music/pixabay/`, …) y la API los
    encuentra recorriendo recursivamente. La primera versión de esta función
    miraba nada más el nivel de arriba y reportó como "archivo faltante" música
    que estaba perfectamente ahí. Un verificador que da falsas alarmas se vuelve
    ruido y se termina ignorando, que es peor que no tenerlo.
    """
    if not url or url.startswith("http"):
        return None
    try:
        partes = urlparse(url)
    except ValueError:
        return None
    archivo = (parse_qs(partes.query).get("file") or [None])[0]
    if not archivo:
        return None
    if "/music/" in partes.path:
        base = config.ASSETS_MUSIC
    elif "/sfx/" in partes.path:
        base = config.ASSETS_SFX
    else:
        return None

    directo = base / archivo
    if directo.exists():
        return directo
    try:
        return next(base.rglob(archivo), directo)
    except OSError:
        return directo


def _revisar_tiempos(proyecto: dict, duracion: float | None) -> list[Hallazgo]:
    hallazgos: list[Hallazgo] = []

    def numero(valor) -> float | None:
        try:
            return float(valor)
        except (TypeError, ValueError):
            return None

    for lista, campo_ini, campo_fin in LISTAS_CON_TIEMPO:
        for i, elem in enumerate(proyecto.get(lista) or []):
            if not isinstance(elem, dict):
                continue
            ini, fin = numero(elem.get(campo_ini)), numero(elem.get(campo_fin))
            if ini is None or fin is None:
                continue
            if fin <= ini:
                hallazgos.append(Hallazgo(
                    "ERROR", f"{lista}[{i}] termina antes de empezar ({ini}s → {fin}s)"))
                continue
            if ini < 0:
                hallazgos.append(Hallazgo("ERROR", f"{lista}[{i}] empieza en negativo ({ini}s)"))
            if duracion is None:
                continue
            if ini >= duracion:
                hallazgos.append(Hallazgo(
                    "ERROR",
                    f"{lista}[{i}] empieza en {ini}s, después de que el video termina "
                    f"({duracion:.2f}s) — no se va a ver nunca"))
            elif fin > duracion + MARGEN_S:
                hallazgos.append(Hallazgo(
                    "AVISO",
                    f"{lista}[{i}] llega hasta {fin}s pero el video dura {duracion:.2f}s "
                    f"— se corta {fin - duracion:.2f}s antes de tiempo"))

    for lista, campo in LISTAS_CON_MARCA:
        for i, elem in enumerate(proyecto.get(lista) or []):
            if not isinstance(elem, dict):
                continue
            t = numero(elem.get(campo))
            if t is None:
                continue
            if t < 0:
                hallazgos.append(Hallazgo("ERROR", f"{lista}[{i}] en tiempo negativo ({t}s)"))
            elif duracion is not None and t >= duracion:
                hallazgos.append(Hallazgo(
                    "ERROR",
                    f"{lista}[{i}] marcado en {t}s, después del final ({duracion:.2f}s)"))

    # El síntoma que motivó todo esto: NADA ocupa el tramo final. Si el último
    # elemento con tiempos termina mucho antes que el video, lo más probable es
    # que la duración declarada no coincida con el archivo.
    if duracion is not None:
        finales = [
            f for lista, _, campo_fin in LISTAS_CON_TIEMPO
            for elem in (proyecto.get(lista) or [])
            if isinstance(elem, dict) and (f := numero(elem.get(campo_fin))) is not None
        ]
        if finales:
            ultimo = max(finales)
            hueco = duracion - ultimo
            # Un hueco enorme casi nunca es un proyecto mal armado: es que se
            # eligió mal el video de referencia. Los proyectos suelen hacerse
            # sobre un corte y acá se busca por nombre entre varias carpetas, así
            # que es fácil terminar midiendo el original de una hora. Decir "te
            # sobran 568s" en ese caso es una alarma falsa; decir "creo que no es
            # este archivo" es información útil.
            if duracion > 0 and ultimo < duracion * 0.5:
                hallazgos.append(Hallazgo(
                    "AVISO",
                    f"el proyecto cubre hasta {ultimo:.1f}s pero el video medido dura "
                    f"{duracion:.1f}s: probablemente no es el archivo que corresponde. "
                    f"Pasá --video para revisar los tiempos de verdad"))
            elif hueco > 3.0:
                hallazgos.append(Hallazgo(
                    "AVISO",
                    f"los últimos {hueco:.1f}s del video no tienen ningún elemento encima "
                    f"(todo termina en {ultimo:.2f}s y el video dura {duracion:.2f}s)"))
    return hallazgos


def _revisar_assets(proyecto: dict) -> list[Hallazgo]:
    hallazgos: list[Hallazgo] = []
    pistas: list[tuple[str, str]] = []
    if proyecto.get("musicTrack"):
        pistas.append(("musicTrack", str(proyecto["musicTrack"])))
    for i, m in enumerate(proyecto.get("sfxMarks") or []):
        if isinstance(m, dict) and m.get("url"):
            pistas.append((f"sfxMarks[{i}]", str(m["url"])))

    for etiqueta, url in pistas:
        ruta = _ruta_de_asset_local(url)
        if ruta is None:
            continue
        if not ruta.exists():
            hallazgos.append(Hallazgo(
                "ERROR", f"{etiqueta} apunta a un archivo que no está: {ruta}"))
        elif ruta.stat().st_size == 0:
            hallazgos.append(Hallazgo("ERROR", f"{etiqueta} apunta a un archivo vacío: {ruta}"))
    return hallazgos


def _revisar_estructura(proyecto: dict, duracion: float | None) -> list[Hallazgo]:
    hallazgos: list[Hallazgo] = []
    ancho, alto = proyecto.get("width"), proyecto.get("height")
    if not ancho or not alto:
        hallazgos.append(Hallazgo("ERROR", "el proyecto no declara width/height"))
    elif int(ancho) <= 0 or int(alto) <= 0:
        hallazgos.append(Hallazgo("ERROR", f"dimensiones inválidas: {ancho}x{alto}"))

    if not proyecto.get("styleId"):
        hallazgos.append(Hallazgo("ERROR", "el proyecto no declara styleId"))

    hay_subtitulos = bool(proyecto.get("captions") or proyecto.get("manualSubtitles"))
    if not hay_subtitulos:
        hallazgos.append(Hallazgo(
            "AVISO", "el proyecto no trae subtítulos — sale un video mudo de texto"))

    if duracion is None:
        hallazgos.append(Hallazgo(
            "AVISO", "no se pudo medir el video: las revisiones de tiempos quedan sin hacer"))
    elif duracion < 1.0:
        hallazgos.append(Hallazgo("ERROR", f"el video dura {duracion:.2f}s: algo salió mal al cortarlo"))
    return hallazgos


def verificar(proyecto: dict, video: Path | None) -> list[Hallazgo]:
    """Todos los hallazgos del proyecto, con los ERRORES primero."""
    # Sin comprobar `.exists()` antes: `duracion_de` ya devuelve None cuando no
    # puede medir, sea porque el archivo no está o porque ffprobe no lo entiende.
    # Preguntar dos veces lo mismo sólo agrega un camino más por donde el
    # resultado puede diferir.
    duracion = duracion_de(video) if video else None
    hallazgos = (
        _revisar_estructura(proyecto, duracion)
        + _revisar_tiempos(proyecto, duracion)
        + _revisar_assets(proyecto)
    )
    return sorted(hallazgos, key=lambda h: 0 if h.nivel == "ERROR" else 1)


def _buscar_video(proyecto: dict) -> Path | None:
    """El mp4 del que salió el proyecto, buscando en las carpetas conocidas."""
    video_id = proyecto.get("videoId") or proyecto.get("id")
    if not video_id:
        return None
    for carpeta in (config.CUTS_DIR, config.RAW_DIR,
                    config.LONG_FORM_ROOT / "clips", config.LONG_FORM_ROOT / "clean"):
        for nombre in (f"{video_id}.mp4", f"{video_id}_clean.mp4", f"{video_id}_cut.mp4"):
            ruta = carpeta / nombre
            if ruta.exists():
                return ruta
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Revisa un proyecto antes de renderizarlo")
    ap.add_argument("proyecto", help="ruta al JSON del proyecto")
    ap.add_argument("--video", help="mp4 de origen (si no, se busca por videoId)")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    args = ap.parse_args()

    ruta = Path(args.proyecto)
    if not ruta.exists():
        print(f"no existe: {ruta}", file=sys.stderr)
        return 2
    proyecto = json.loads(ruta.read_text(encoding="utf-8"))
    video = Path(args.video) if args.video else _buscar_video(proyecto)

    hallazgos = verificar(proyecto, video)
    errores = [h for h in hallazgos if h.nivel == "ERROR"]

    if args.json:
        print(json.dumps({
            "ok": not errores,
            "video": str(video) if video else None,
            "hallazgos": [{"nivel": h.nivel, "texto": h.texto} for h in hallazgos],
        }, ensure_ascii=False, indent=2))
    else:
        print(f"  proyecto : {ruta.name}")
        print(f"  video    : {video if video else '(no encontrado)'}")
        if not hallazgos:
            print("  todo en orden.")
        for h in hallazgos:
            print(f"  [{h.nivel}] {h.texto}")
        if errores:
            print(f"\n  {len(errores)} error(es): conviene arreglar antes de gastar el render.")
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
