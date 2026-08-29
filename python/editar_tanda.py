"""Edita VARIOS videos largos seguidos, cada uno con su propia variación.

Pensado para dejarlo corriendo horas sin nadie mirando. Existe porque hacerlo a
mano son once comandos largos, y porque los tres controles que lleva se
aprendieron cada uno de una tanda que salió mal.

USO

  # con un archivo de plan (ver formato abajo)
  python editar_tanda.py --plan mi_tanda.txt

  # o directo, repitiendo --video
  python editar_tanda.py \\
      --video D01_curso_ventas:vogue:#c9a96a \\
      --video D02_charla_ia:ft:#0d7680 \\
      --estilo editorial_full --aspecto 16:9

El plan es un texto, una línea por video, `id:tema:acento`. Las líneas vacías y
las que empiezan con `#` se ignoran:

    # tanda de agosto
    D01_curso_ventas:vogue:#c9a96a
    D02_charla_ia:ft:#0d7680

LOS TRES CONTROLES, Y POR QUÉ

1. **El servidor de Next tiene que responder ANTES de empezar.** El render
   descarga cada clip por HTTP; sin servidor, cada clip muere con 404. Pasó: 23
   clips, 168 segundos, 23 fallos idénticos, y el resumen decía "ok".

2. **No se edita un video en calidad degradada.** Editar 360p en horizontal se
   ve mal y no hay cómo arreglarlo aguas abajo. Pasó: nueve de once videos
   llegaron en 640×360 sin que nada fallara.

3. **Un fallo no detiene la tanda.** Se anota y se sigue con el siguiente; al
   final se dice qué salió y qué no. Un lote que se para en el primer tropiezo
   obliga a repetir todo lo que ya había hecho.

Es SECUENCIAL a propósito: el pipeline ya paraleliza por dentro (8 trabajadores
de render, medido), y dos videos a la vez se pelean por el mismo procesador.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from config import FFMPEG_PATH, LF_RAW

AQUI = Path(__file__).resolve().parent

# Por debajo de esto no se edita: se nota en pantalla completa y ya no hay
# arreglo posible más adelante.
ALTURA_MINIMA = 720

# QUE SE PONE ENCIMA DEL VIDEO. Se escribe en castellano en el plan porque el
# plan lo lee una persona, no un programa.
#
# NINGUNO incluye ilustraciones: los monitos quedaron fuera del editorial por
# pedido explicito — se veian mal sobre una tipografia cuidada.
MATERIAL = {
    "gifs": ("editorial_broll", "giphy"),
    "video": ("editorial_broll", "pexels_video"),
    "fotos": ("editorial_broll", "pexels_photo"),
    "mixto": ("editorial_broll", "giphy,pexels_photo"),
    # Sin material de apoyo: solo el video, el texto y el tema.
    "limpio": ("editorial_full", None),
}


def altura(mp4: Path) -> int:
    """Alto MEDIDO del archivo. 0 si no se pudo leer."""
    ffprobe = str(Path(FFMPEG_PATH).with_name("ffprobe.exe"))
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=height", "-of", "csv=p=0", str(mp4)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=60,
        )
        return int((r.stdout or "0").strip() or 0)
    except Exception:  # noqa: BLE001
        return 0


def servidor_vivo(api: str) -> bool:
    try:
        urllib.request.urlopen(f"{api}/api/projects", timeout=10).read(1)
        return True
    except Exception:  # noqa: BLE001
        return False


def leer_plan(ruta: Path) -> list[tuple[str, str, str]]:
    salida: list[tuple[str, str, str]] = []
    for n, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        partes = linea.split(":")
        if len(partes) not in (3, 4):
            raise SystemExit(
                f"{ruta}:{n}: se esperaba `id:tema:acento` o "
                f"`id:tema:acento:material` y vino {linea!r}"
            )
        # El cuarto campo es el MATERIAL DE APOYO: gifs, video, fotos.
        # Sin el, el estilo decide como siempre.
        material = partes[3].strip() if len(partes) == 4 else ""
        salida.append((partes[0].strip(), partes[1].strip(),
                       partes[2].strip(), material))
    return salida


def main() -> int:
    ap = argparse.ArgumentParser(description="Edita varios videos largos seguidos")
    ap.add_argument("--plan", type=Path, default=None,
                    help="archivo con una línea `id:tema:acento` por video")
    ap.add_argument("--video", action="append", default=[],
                    metavar="ID:TEMA:ACENTO",
                    help="un video de la tanda; se puede repetir")
    ap.add_argument("--estilo", default="editorial_full",
                    help="estilo visual para toda la tanda (default: editorial_full)")
    ap.add_argument("--aspecto", default="16:9", choices=["9:16", "16:9"])
    ap.add_argument("--seguir-si-degradado", action="store_true",
                    help="edita igual los videos por debajo de "
                         f"{ALTURA_MINIMA}p, en vez de saltarlos")
    args = ap.parse_args()

    tanda: list[tuple[str, str, str]] = []
    if args.plan:
        tanda += leer_plan(args.plan)
    for v in args.video:
        partes = v.split(":")
        if len(partes) not in (3, 4):
            raise SystemExit(
                f"--video espera `id:tema:acento[:material]`, vino {v!r}")
        if len(partes) == 3:
            partes.append("")
        tanda.append(tuple(p.strip() for p in partes))  # type: ignore[arg-type]

    if not tanda:
        raise SystemExit("no hay videos en la tanda: usá --plan o --video")

    api = os.environ.get("VIRAL_API_HOST") or "http://localhost:3000"
    if not servidor_vivo(api):
        print(f"[tanda] El servidor de Next no responde en {api}.", file=sys.stderr)
        print("[tanda] El render descarga cada clip por HTTP: sin servidor, TODOS "
              "los clips fallarían con 404. Arrancalo con `npm run dev` en "
              "frontend/ y volvé a lanzar esto.", file=sys.stderr)
        return 1
    print(f"[tanda] servidor OK en {api}")

    hechos: list[str] = []
    saltados: list[str] = []
    fallados: list[str] = []

    for i, (vid, tema, acento, material) in enumerate(tanda, 1):
        crudo = Path(LF_RAW) / f"{vid}.mp4"
        cabecera = f"[{i}/{len(tanda)}] {vid}"

        if not crudo.exists():
            print(f"\n=== {cabecera} — no está en disco, se salta ===", flush=True)
            saltados.append(f"{vid} (no está)")
            continue

        h = altura(crudo)
        if h < ALTURA_MINIMA and not args.seguir_si_degradado:
            print(f"\n=== {cabecera} — {h}p, calidad degradada, se salta ===",
                  flush=True)
            print("    Volvé a bajarlo con --exigir-calidad, o forzá con "
                  "--seguir-si-degradado.", flush=True)
            saltados.append(f"{vid} ({h}p)")
            continue

        print(f"\n=== {cabecera} · {h}p · tema {tema} · acento {acento} ===",
              flush=True)
        t0 = time.time()
        estilo, fuente = MATERIAL.get(material, (args.estilo, None))
        cmd = [sys.executable, str(AQUI / "long_form_pipeline.py"), vid,
               "--render", "--graphics",
               "--styles", estilo,
               "--aspect-ratio", args.aspecto,
               "--editorial-theme", tema,
               "--accent-color", acento]
        if fuente:
            cmd += ["--broll-source", fuente]
        r = subprocess.run(cmd, cwd=str(AQUI))
        minutos = round((time.time() - t0) / 60, 1)

        if r.returncode == 0:
            print(f"    OK {vid} ({tema}) · {minutos} min", flush=True)
            hechos.append(f"{vid}/{tema}")
        else:
            print(f"    FALLO {vid} ({tema}) · {minutos} min", flush=True)
            fallados.append(f"{vid}/{tema}")

    print("\n======== RESUMEN ========")
    print(f"editados: {len(hechos)} de {len(tanda)}")
    for x in hechos:
        print(f"   OK      {x}")
    for x in saltados:
        print(f"   SALTADO {x}")
    for x in fallados:
        print(f"   FALLO   {x}")
    print("=========================")

    # Que la tanda ENTERA falle es distinto de que falle una: lo primero suele
    # ser algo del entorno y conviene que el código de salida lo diga.
    return 1 if fallados and not hechos else 0


if __name__ == "__main__":
    sys.exit(main())
