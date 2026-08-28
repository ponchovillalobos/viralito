"""Baja un video de YouTube (o de donde yt-dlp sepa) y lo deja listo para editar.

Uso:
  python descargar_de_url.py <url> --flujo corto   # → raw/
  python descargar_de_url.py <url> --flujo largo   # → long_form/raw/
  python descargar_de_url.py <url> --flujo largo --id D21_curso_ventas

Sale un JSON por stdout con el id, la ruta y la duración, para que el endpoint
que lo invoca sepa qué quedó en disco.

POR QUE EXISTE, SI YA HABIA UNO
`research_download.py` ya baja de YouTube con yt-dlp, pero alimenta la sección de
investigación: guarda metadata, comentarios y transcript para estudiar videos
ajenos. Los flujos de edición esperan otra cosa — un archivo en `raw/` o en
`long_form/raw/` con un id que respete la convención `D##_slug` — y no había
puente entre las dos cosas.

(Y `research_download.py` tampoco podía correr: invoca `sys.executable -m
yt_dlp`, y `yt_dlp` no estaba instalado en el venv. Al agregarlo a
`requirements.txt` para este script, aquél volvió a funcionar de paso.)

SOBRE QUE SE DESCARGA
Esto baja lo que le pidas. Pensado para tu propio material —cursos, charlas,
entrevistas que grabaste y subiste— y para contenido sobre el que tengas
derechos. Lo que hagas con material ajeno es tu decisión y tu responsabilidad,
igual que con cualquier archivo que pongas en `raw/` a mano.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

from config import DATA_ROOT, FFMPEG_PATH, LF_RAW, RAW_DIR

# Las cookies viven al lado de los videos, no dentro. Mismo lugar que usa
# `research_download.py`, para no tener dos sitios donde buscarlas.
COOKIES_DIR = DATA_ROOT.parent / "cookies"

# 3 minutos. El flujo de cortos toma UN video y saca UN short recortándole los
# silencios: de un video de 10 minutos saldría un "short" de 9. Todo lo que pase
# de unos pocos minutos quiere el flujo de largos, que elige los momentos y saca
# varios clips. El primer valor acá fueron 12 minutos y sugería "corto" para un
# video de 10.6 — medido con una descarga real, no supuesto.
UMBRAL_LARGO_S = 3 * 60


def slug(texto: str, largo: int = 40) -> str:
    """Convierte un título en un slug que respeta la convención del proyecto.

    Sólo `[a-z0-9_]`: el resto del pipeline usa el id como nombre de archivo y
    como parte de rutas, y un acento o un espacio ahí rompe cosas en Windows
    mucho más adelante, cuando ya no se ve de dónde vino.
    """
    t = unicodedata.normalize("NFKD", texto)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^a-zA-Z0-9]+", "_", t).strip("_").lower()
    return (t[:largo].rstrip("_")) or "video"


def siguiente_numero(carpeta: Path) -> int:
    """El próximo D## libre mirando lo que ya hay en la carpeta."""
    usados = set()
    for f in carpeta.glob("D*"):
        m = re.match(r"D(\d+)_", f.name)
        if m:
            usados.add(int(m.group(1)))
    n = 1
    while n in usados:
        n += 1
    return n


def _cookies_para(url: str) -> list[str]:
    """Archivo de cookies del dominio, si existe. Sin él, igual se intenta."""
    dominio = "youtube" if re.search(r"youtu\.?be", url, re.I) else None
    if not dominio:
        return []
    f = COOKIES_DIR / f"{dominio}.txt"
    return ["--cookies", str(f)] if f.exists() else []


def duracion(mp4: Path) -> float:
    """Duración medida del archivo. No se deduce del título ni de la metadata."""
    ffprobe = str(Path(FFMPEG_PATH).with_name("ffprobe.exe"))
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(mp4)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=60,
        )
        return round(float((r.stdout or "0").strip()), 2)
    except Exception:  # noqa: BLE001
        return 0.0


def titulo_de(url: str, cookies: list[str]) -> str:
    """Título del video, para armar el slug. Si falla, se usa uno genérico."""
    try:
        r = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--no-warnings", "--skip-download",
             "--print", "%(title)s", *cookies, url],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120,
        )
        t = (r.stdout or "").strip().splitlines()
        return t[0] if t else ""
    except Exception:  # noqa: BLE001
        return ""


def main() -> int:
    ap = argparse.ArgumentParser(description="Baja un video de YouTube listo para editar")
    ap.add_argument("url")
    ap.add_argument("--flujo", choices=["corto", "largo"], required=True,
                    help="corto → raw/ (un video, un short) · largo → long_form/raw/ (sale en clips)")
    ap.add_argument("--id", default=None,
                    help="id explícito (D##_slug). Sin esto se arma del título.")
    args = ap.parse_args()

    destino = RAW_DIR if args.flujo == "corto" else LF_RAW
    destino.mkdir(parents=True, exist_ok=True)
    cookies = _cookies_para(args.url)

    if args.id:
        video_id = args.id
    else:
        t = titulo_de(args.url, cookies)
        video_id = f"D{siguiente_numero(destino):02d}_{slug(t)}"

    salida = destino / f"{video_id}.mp4"
    if salida.exists():
        print(json.dumps({
            "ok": True, "ya_estaba": True, "id": video_id,
            "ruta": str(salida), "duracion_s": duracion(salida),
        }, ensure_ascii=False))
        return 0

    # PREFIERE H.264 (avc1), aunque YouTube ofrezca AV1 con mejor compresión.
    #
    # Medido en esta máquina, decodificando 30 s del mismo material con
    # `-hwaccel cuda`:
    #
    #     AV1    4436 ms
    #     H.264  1975 ms      2.2x más rápido
    #
    # La RTX 3060 SÍ decodifica AV1 por hardware (Ampere lo trae; lo que no
    # tiene es codificarlo), así que no es que AV1 no funcione — es que el
    # pipeline decodifica el mismo video muchas veces (transcribir, detectar
    # silencios, extraer clips, renderizar, re-encodear) y ahí un 2.2x se
    # multiplica. Además todo el resto está afinado para H.264: `h264_cuvid`
    # para decodificar, `h264_nvenc` para encodear.
    #
    # Tope de 1080: más resolución no mejora un vertical de 1080x1920 y
    # multiplica descarga y render. Si no hay H.264, cae a lo que haya.
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", (
            # Video H.264 + audio AAC (m4a), que es lo que graban las camaras y
            # lo que trae todo lo demas que entra al pipeline. YouTube sirve el
            # audio en Opus por omision, y aunque Opus dentro de un MP4 se lee
            # bien —comprobado extrayendo audio y cortando el video—, dejaria
            # dos formatos distintos entrando al mismo sitio segun de donde
            # vino el archivo. Esa clase de diferencia no rompe nada hoy y
            # aparece semanas despues en el unico paso que asumia AAC.
            "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/"
            "bv*[vcodec^=avc1][height<=1080]+ba/"
            "b[vcodec^=avc1][height<=1080]/"
            "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b"
        ),
        "--merge-output-format", "mp4",
        # Fragmentos en paralelo. YouTube limita la velocidad POR CONEXION, no
        # por descarga: pidiendo varios trozos a la vez se esquiva ese tope sin
        # pedirle mas al servidor de lo que ya da.
        #
        # Medido bajando el mismo video dos veces, 45 s cada una:
        #   sin -N   arranca fuerte y cae a 6-7 MiB/s
        #   con -N 8 se sostiene en 15-16 MiB/s
        #
        # Se noto bajando once videos seguidos: el tercero se arrastraba a
        # 104 KiB/s, con tres horas y media de espera calculada. No fallaba —
        # simplemente no iba a terminar nunca, que es la version lenta de
        # fallar en silencio.
        "-N", "8",
        # Y de que CLIENTE se pide. YouTube estrangula al cliente `web` cuando
        # ve varias descargas seguidas desde el mismo sitio, y ahi `-N` ya no
        # alcanza: el tope no es por conexion sino por cliente.
        #
        # Medido sobre el mismo video, 30 s por cliente, con el `web` ya
        # estrangulado:
        #   web       nada (no llega a arrancar)
        #   android   4.58 MiB/s
        #   tv, ios   nada
        #
        # Se piden los dos: `android` primero, y `web` detras por si algun dia
        # android deja de servir formatos. Con esto la tanda de once videos paso
        # de tres horas y media POR VIDEO a un par de minutos.
        "--extractor-args", "youtube:player_client=android,web",
        # yt-dlp necesita ffmpeg para UNIR el video y el audio, que YouTube
        # sirve por separado. Desde una consola con ffmpeg en el PATH funciona;
        # lanzado por el servidor de Next, no — y fallaba con "no pudo bajar el
        # video" sin decir que lo que faltaba era ffmpeg. Se le pasa la ruta que
        # el proyecto ya resolvio, asi que no depende del PATH de quien lo llame.
        "--ffmpeg-location", str(Path(FFMPEG_PATH).parent),
        "--no-playlist",
        "--newline",
        "-o", str(salida),
        *cookies,
        args.url,
    ]
    print(f"[descarga] {args.url} → {salida.name}", file=sys.stderr, flush=True)
    r = subprocess.run(cmd, text=True, encoding="utf-8", errors="replace")

    if r.returncode != 0 or not salida.exists():
        print(json.dumps({
            "ok": False,
            "error": "yt-dlp no pudo bajar el video",
            "pista": (
                "Si es privado o pide inicio de sesión, guardá las cookies del "
                f"navegador en {COOKIES_DIR / 'youtube.txt'} y volvé a intentar."
            ),
        }, ensure_ascii=False))
        return 1

    d = duracion(salida)
    print(json.dumps({
        "ok": True,
        "id": video_id,
        "ruta": str(salida),
        "duracion_s": d,
        "flujo": args.flujo,
        # Se dice si el flujo elegido encaja con lo que de verdad se bajó, pero
        # no se cambia solo: quien pidió corto puede querer un corto igual.
        "sugerencia": (
            "largo" if d > UMBRAL_LARGO_S else "corto"
        ),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
