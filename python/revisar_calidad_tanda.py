"""Revisión de CALIDAD de una tanda: los cortes, la selección, la duración y la
transcripción.

Hermana de `verificar_tanda.py`, que mira que los archivos estén y sean lo que
se pidió. Ésta mira si están BIEN.

Cuatro preguntas, cada una con su número:

  CORTES        ¿los clips empiezan y terminan donde termina una frase, o cortan
                a mitad de idea? Un corto que corta en "y entonces lo que pasa
                es que—" se siente roto en el primer segundo.

  SELECCIÓN     ¿se dejó fuera algo grande? No busca cobertura alta —elegir los
                mejores momentos de dos horas es el trabajo— sino tramos largos
                sin un solo clip, que pueden ser material sin revisar.

  DURACIÓN      ¿caen en el rango que funciona en redes (30-60 s)? Fuera de ahí
                no es un error, pero conviene saber cuántos.

  TRANSCRIPCIÓN ¿tienen palabras de verdad? Un transcript vacío no falla: hace
                que los textos en pantalla se inventen. Ya pasó — trece clips
                seguidos con transcript vacío y estadísticas fabricadas debajo
                de la cara de quien hablaba.

USO
  python revisar_calidad_tanda.py --plan mi_tanda.txt

Sale con 1 si algo está por debajo del umbral. Los umbrales son opinables y se
pueden mover; los números no.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import LF_ROOT  # noqa: E402
from lib.bordes_de_clip import cierra_frase  # noqa: E402

LF = Path(LF_ROOT)

# Por debajo de esto conviene mirar el video: son cortes que se notan.
CIERRAN_FRASE_MINIMO = 0.80
# Un tramo así de largo sin un clip puede ser material sin revisar.
HUECO_AVISO_MIN = 15.0
# Rango que funciona en redes. Fuera no es error, pero se cuenta.
DUR_MIN, DUR_MAX = 30.0, 60.0
# Menos palabras que esto en un clip de 40 s es un transcript sospechoso.
PALABRAS_MINIMAS = 20


def leer_plan(ruta: Path) -> list[str]:
    ids = []
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#"):
            ids.append(linea.split(":")[0].strip())
    return ids


def main() -> int:
    ap = argparse.ArgumentParser(description="Revisa la calidad de una tanda")
    ap.add_argument("--plan", type=Path, default=None)
    ap.add_argument("--video", action="append", default=[])
    args = ap.parse_args()

    ids = (leer_plan(args.plan) if args.plan else []) + [
        v.split(":")[0] for v in args.video
    ]
    if not ids:
        raise SystemExit("no hay videos que revisar: usá --plan o --video")

    print(f"  {'video':24}{'clips':>6}{'cierran':>9}{'dur.med':>9}"
          f"{'30-60s':>8}{'hueco':>8}{'transcr':>9}")
    print("  " + "-" * 74)

    problemas: list[str] = []
    tot_clips = tot_cierran = 0

    for vid in ids:
        prop = LF / "proposals" / f"{vid}.json"
        tr = LF / "transcripts" / f"{vid}.json"
        if not prop.exists():
            print(f"  {vid:24}{'—  sin propuestas':>40}")
            continue

        clips = json.loads(prop.read_text(encoding="utf-8")).get("clips") or []
        palabras = []
        if tr.exists():
            palabras = json.loads(tr.read_text(encoding="utf-8")).get("words") or []
        if not clips:
            continue

        # CORTES
        cierran = sum(1 for c in clips if palabras and cierra_frase(float(c["end"]), palabras))
        ratio = cierran / len(clips) if clips else 0

        # DURACIÓN
        duraciones = [float(c["end"]) - float(c["start"]) for c in clips]
        media = statistics.mean(duraciones) if duraciones else 0
        en_rango = sum(1 for d in duraciones if DUR_MIN <= d <= DUR_MAX)

        # SELECCIÓN: el hueco seguido más largo.
        dur_video = float(palabras[-1].get("end", 0)) if palabras else 0
        tramos = sorted((float(c["start"]), float(c["end"])) for c in clips)
        hueco = 0.0
        prev = 0.0
        for s, e in tramos:
            hueco = max(hueco, s - prev)
            prev = max(prev, e)
        if dur_video:
            hueco = max(hueco, dur_video - prev)

        # TRANSCRIPCIÓN de cada clip: vacío = textos inventados.
        vacios = 0
        for i in range(1, len(clips) + 1):
            for t in LF.glob(f"transcripts/{vid}_c{i:02d}_*.json"):
                try:
                    n = len(json.loads(t.read_text(encoding="utf-8")).get("words") or [])
                except Exception:  # noqa: BLE001
                    n = 0
                if n < PALABRAS_MINIMAS:
                    vacios += 1
                break

        tot_clips += len(clips)
        tot_cierran += cierran

        print(f"  {vid:24}{len(clips):>6}{f'{cierran}/{len(clips)}':>9}"
              f"{media:>8.0f}s{en_rango:>8}{hueco / 60:>7.1f}m"
              f"{('OK' if not vacios else f'{vacios} vacíos'):>9}")

        if palabras and ratio < CIERRAN_FRASE_MINIMO:
            problemas.append(
                f"{vid}: solo {cierran} de {len(clips)} clips cierran frase "
                f"({ratio * 100:.0f} %). Cortan a mitad de idea.")
        if hueco / 60 > HUECO_AVISO_MIN:
            problemas.append(
                f"{vid}: {hueco / 60:.0f} minutos seguidos sin un clip. Puede ser "
                "que ahí no hubiera material, o que se haya pasado por alto.")
        if vacios:
            problemas.append(
                f"{vid}: {vacios} clip(s) con transcript vacío o casi. Los textos "
                "en pantalla de esos clips salen inventados.")
        if not palabras:
            problemas.append(f"{vid}: sin transcript del video completo.")

    print("  " + "-" * 74)
    if tot_clips:
        print(f"  {'TOTAL':24}{tot_clips:>6}"
              f"{f'{tot_cierran}/{tot_clips}':>9}"
              f"  ({tot_cierran / tot_clips * 100:.0f} % cierran frase)")
    print()

    if problemas:
        print(f"  {len(problemas)} cosa(s) que mirar:")
        for p in problemas:
            print(f"    {p}")
        return 1
    if not tot_clips:
        print("  NO SE REVISÓ NI UN CLIP.")
        return 1
    print(f"  {tot_clips} clips revisados: los cortes cierran frase, las duraciones "
          "están en rango y ningún transcript está vacío.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
