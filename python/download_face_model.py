"""Descarga el modelo BlazeFace short-range (.tflite) para el reframe que sigue la cara.

~225 KB. Lo usa face_tracking.py para detección de rostros (mejor que el fallback
Haar de OpenCV). Si NO se descarga, face_tracking degrada a Haar automáticamente
(incluido en opencv, sin red) → el reframe igual funciona, solo con detección algo
menos fina. Por eso este paso es OPCIONAL en el setup (best-effort, no aborta).

Uso:
  python download_face_model.py            # baja si falta
  python download_face_model.py --force    # re-baja aunque exista
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
MODEL_PATH = Path(__file__).resolve().parent / "models" / "blaze_face_short_range.tflite"
MIN_BYTES = 100_000  # el .tflite real pesa ~225 KB; menos = descarga corrupta


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Re-baja aunque ya exista.")
    args = parser.parse_args()

    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size >= MIN_BYTES and not args.force:
        print(f"[face-model] ya está ({MODEL_PATH.stat().st_size} bytes) — nada que hacer")
        return 0

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MODEL_PATH.with_suffix(".tflite.part")
    try:
        print(f"[face-model] descargando {MODEL_URL} ...", flush=True)
        urllib.request.urlretrieve(MODEL_URL, tmp)
        size = tmp.stat().st_size
        if size < MIN_BYTES:
            tmp.unlink(missing_ok=True)
            print(f"[face-model] descarga incompleta ({size} bytes < {MIN_BYTES})", file=sys.stderr)
            return 1
        tmp.replace(MODEL_PATH)
        print(f"[face-model] OK {MODEL_PATH} ({size} bytes)")
        return 0
    except Exception as exc:  # noqa: BLE001 — red caída, DNS, etc. No es fatal.
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        print(f"[face-model] no se pudo bajar ({exc}). Se usará Haar (OpenCV).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
