"""Revisión de aceptación de una tanda: se comprueba el RESULTADO, no el log.

Un log que dice "ok" ya mintió varias veces en este proyecto — el pipeline
informó `{"ok": true, "rendered": 0, "render_tasks": 23}` con el servidor caído,
y el medidor de textos repetidos daba "Perfecto" sin haber examinado un clip.
Esto abre los archivos.

Por cada video de la tanda:
  - cuántos clips se renderizaron
  - que sean de la resolución esperada (se MIDE, no se supone)
  - que las tarjetas no repitan el titular en el subtítulo
  - que ninguna traiga una cifra que no esté en el audio

USO

  python verificar_tanda.py --plan mi_tanda.txt
  python verificar_tanda.py --video D01_curso:vogue:#c9a96a

Mismo formato de plan que `editar_tanda.py`, para no tener dos.

Sale con 1 si encuentra algo. Pensado para correrlo al terminar una tanda larga,
antes de dar nada por bueno.

TRES COSAS QUE ESTA MISMA HERRAMIENTA HIZO MAL, y por las que ahora dice lo que
dice — valen como aviso para quien la toque:

  1. `ffprobe -of csv=p=0:s=x` devuelve "1920x1080x", con un separador colgando.
     Comparar con "1920x1080" marcaba TODOS los archivos como malos estando
     bien.
  2. Contaba los subtítulos repetidos en la tabla y NO los sumaba al veredicto:
     el resumen decía "sin subtítulos repetidos" con seis en la columna de al
     lado.
  3. Contaba como render los `_fxfused.mp4`, que son intermedios que el pipeline
     crea y borra solo, e inventaba una "resolución ilegible" cada vez que
     corría durante un render.

Las tres son la misma enfermedad: una comprobación que grita por su propio
formato, o que aprueba lo que su tabla desmiente, enseña a no leerla — y
entonces es peor que no tenerla.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import FFMPEG_PATH, LF_ROOT  # noqa: E402

LF = Path(LF_ROOT)
FFPROBE = str(Path(FFMPEG_PATH).with_name("ffprobe.exe"))


def sonda_resolucion(mp4: Path) -> str:
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x",
             str(mp4)],
            capture_output=True, text=True, timeout=60,
        )
        return (r.stdout or "").strip().strip("x")
    except Exception:  # noqa: BLE001
        return ""


def numeros(t: str) -> set[str]:
    return {m.group(0).replace(".", "").replace(",", "")
            for m in re.finditer(r"\d[\d.,]*", t or "")}


def leer_plan(ruta: Path) -> list[tuple[str, str, str]]:
    salida = []
    for n, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        partes = linea.split(":")
        if len(partes) != 3:
            raise SystemExit(f"{ruta}:{n}: se esperaba `id:tema:acento`, vino {linea!r}")
        salida.append(tuple(p.strip() for p in partes))
    return salida  # type: ignore[return-value]


def main() -> int:
    ap = argparse.ArgumentParser(description="Revisa el resultado de una tanda")
    ap.add_argument("--plan", type=Path, default=None)
    ap.add_argument("--video", action="append", default=[], metavar="ID:TEMA:ACENTO")
    ap.add_argument("--resolucion", default="1920x1080",
                    help="la que se espera (default 1920x1080)")
    args = ap.parse_args()

    tanda: list[tuple[str, str, str]] = []
    if args.plan:
        tanda += leer_plan(args.plan)
    for v in args.video:
        partes = v.split(":")
        if len(partes) != 3:
            raise SystemExit(f"--video espera `id:tema:acento`, vino {v!r}")
        tanda.append(tuple(p.strip() for p in partes))  # type: ignore[arg-type]
    if not tanda:
        raise SystemExit("no hay videos que revisar: usá --plan o --video")

    try:
        from generate_graphics import _repite_el_titulo
    except Exception:  # noqa: BLE001
        _repite_el_titulo = None  # type: ignore[assignment]

    print(f"  {'video':24}{'clips':>7}{'resol':>8}{'repes':>7}{'cifras':>8}  tema")
    print("  " + "-" * 70)

    tot_clips = tot_repes = tot_cifras = 0
    problemas: list[str] = []

    for vid, tema, _acento in tanda:
        # Los `_fxfused.mp4` son intermedios que el pipeline crea y borra solo.
        renders = sorted(
            f for f in LF.glob(f"renders/{vid}_c*.mp4") if "_fxfused" not in f.name
        )
        tot_clips += len(renders)

        malos = 0
        for f in renders:
            r = sonda_resolucion(f)
            if r != args.resolucion:
                malos += 1
                problemas.append(
                    f"{f.name}: {r or 'ilegible'}, se esperaba {args.resolucion}")

        repes = cifras = 0
        for g in sorted(LF.glob(f"graphics/{vid}_c*.json")):
            t = LF / "transcripts" / g.name
            dicho = ""
            if t.exists():
                try:
                    d = json.loads(t.read_text(encoding="utf-8"))
                    dicho = " ".join(str(w.get("word", "")) for w in (d.get("words") or []))
                except Exception:  # noqa: BLE001
                    pass
            try:
                cards = json.loads(g.read_text(encoding="utf-8")).get("editorialCards") or []
            except Exception:  # noqa: BLE001
                continue
            num_audio = numeros(dicho)
            for c in cards:
                tit, sub = c.get("title", ""), c.get("subtitle", "")
                if tit and sub and _repite_el_titulo and _repite_el_titulo(sub, tit):
                    repes += 1
                    problemas.append(
                        f"{g.stem}: el subtítulo repite el titular — "
                        f"{tit[:36]!r} / {sub[:36]!r}")
                # Sin transcript no se puede afirmar que una cifra sea inventada.
                fuera = numeros(f"{tit} {sub}") - num_audio
                if fuera and dicho:
                    cifras += 1
                    problemas.append(
                        f"{g.stem}: cifra sin respaldo {sorted(fuera)} en {tit[:38]!r}")

        tot_repes += repes
        tot_cifras += cifras
        estado = "todos" if renders and not malos else (
            f"{len(renders) - malos}/{len(renders)}" if renders else "-")
        print(f"  {vid:24}{len(renders):>7}{estado:>8}{repes:>7}{cifras:>8}  {tema}")

    print("  " + "-" * 70)
    print(f"  {'TOTAL':24}{tot_clips:>7}{'':>8}{tot_repes:>7}{tot_cifras:>8}")
    print()

    if problemas:
        print(f"  {len(problemas)} problema(s):")
        for p in problemas[:20]:
            print(f"    {p}")
        if len(problemas) > 20:
            print(f"    ... y {len(problemas) - 20} más")
        return 1

    if tot_clips == 0:
        # Cero clips NO es "sin problemas". Ya nos paso con otro medidor.
        print("  NO SE REVISÓ NI UN CLIP: no hay renders de esta tanda.")
        return 1

    print(f"  {tot_clips} clips revisados: resolución correcta, sin subtítulos "
          "repetidos y sin cifras inventadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
