"""Descarga el modelo de segmentación de persona (selfie_segmenter.tflite).

~250 KB. Lo usan `remove_background.py` (quitar/reemplazar el fondo) y
`text_behind_subject.py` (el texto que pasa POR DETRÁS de quien habla).

Por qué existe este archivo: los dos scripts apuntaban a
`python/models/selfie_segmenter.tflite` y **ningún paso del setup lo bajaba**.
No es que estuviera roto — es que nunca hubo forma de tenerlo. Quien intentara
quitar el fondo se topaba con un modelo ausente, en un proyecto que presume de
funcionar entero sin red.

A diferencia de BlazeFace, que degrada solo a Haar de OpenCV, aquí no hay
alternativa: sin el modelo, esas dos funciones no pueden hacer nada. Aun así el
paso es best-effort en el setup (no aborta la instalación); lo que cambia es que
ahora se puede tener.

Uso:
  python download_selfie_model.py            # baja si falta
  python download_selfie_model.py --force    # re-baja aunque exista
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

# MediaPipe lo publica bajo Apache-2.0, igual que BlazeFace: uso comercial y
# redistribución permitidos, que es lo que este proyecto exige de todo lo que
# empaqueta.
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
    "selfie_segmenter/float16/1/selfie_segmenter.tflite"
)
MODEL_PATH = Path(__file__).resolve().parent / "models" / "selfie_segmenter.tflite"
MIN_BYTES = 100_000  # el .tflite real pesa ~250 KB; menos = descarga corrupta


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-baja aunque ya exista.")
    args = parser.parse_args()

    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size >= MIN_BYTES and not args.force:
        print(f"[selfie-model] ya está ({MODEL_PATH.stat().st_size} bytes) — nada que hacer")
        return 0

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MODEL_PATH.with_suffix(".tflite.part")
    try:
        print(f"[selfie-model] descargando {MODEL_URL} ...", flush=True)
        urllib.request.urlretrieve(MODEL_URL, tmp)
        size = tmp.stat().st_size
        if size < MIN_BYTES:
            tmp.unlink(missing_ok=True)
            print(
                f"[selfie-model] descarga incompleta ({size} bytes < {MIN_BYTES})",
                file=sys.stderr,
            )
            return 1
        # `.replace` al final: el archivo definitivo aparece completo o no
        # aparece. Un .tflite a medias haría fallar a mediapipe con un error que
        # no se parece en nada a "la descarga se cortó".
        tmp.replace(MODEL_PATH)
        print(f"[selfie-model] OK {MODEL_PATH} ({size} bytes)")
        return 0
    except Exception as exc:  # noqa: BLE001 — red caída, DNS, etc. No es fatal.
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        print(
            f"[selfie-model] no se pudo bajar ({exc}). Quitar fondo y "
            "texto-detrás-del-sujeto no van a estar disponibles.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
