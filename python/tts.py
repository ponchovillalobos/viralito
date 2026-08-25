#!/usr/bin/env python
"""tts.py — Voz IA local con Piper (gratis, MIT, corre en CPU).

Toma un texto + un archivo de salida WAV y genera la locución usando el modelo de
voz español por default (es_ES-davefx-medium). El modelo se descarga una sola vez
a `python/models/piper/` (gitignored).

Uso:
    python tts.py "<texto>" <output.wav> [--voice <modelo.onnx>]

Salida (stdout): JSON {ok, path, durationSec} o {ok:false, error}. Si Piper no
está instalado o el modelo no existe, devuelve error sin levantar excepción.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import wave
from pathlib import Path


DEFAULT_MODEL = (
    Path(__file__).parent / "models" / "piper" / "es_ES-davefx-medium.onnx"
)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("text", help="texto a sintetizar")
    p.add_argument("out_wav", help="ruta del WAV de salida")
    p.add_argument(
        "--voice",
        default=str(DEFAULT_MODEL),
        help="ruta al modelo .onnx de Piper",
    )
    args = p.parse_args()

    model = Path(args.voice)
    config = Path(str(model) + ".json")
    if not model.exists() or not config.exists():
        print(json.dumps({
            "ok": False,
            "error": f"falta modelo Piper: {model.name} (esperado en {model.parent})",
        }))
        return 1

    out_path = Path(args.out_wav)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Piper acepta el texto vía stdin. --output_file escribe el WAV final.
        proc = subprocess.run(
            [
                sys.executable, "-m", "piper",
                "--model", str(model),
                "--config", str(config),
                "--output_file", str(out_path),
            ],
            input=args.text,
            text=True, encoding="utf-8", errors="replace",
            capture_output=True,
            timeout=180,
        )
        if proc.returncode != 0:
            print(json.dumps({
                "ok": False,
                "error": f"piper exit {proc.returncode}: {(proc.stderr or '').strip()[-300:]}",
            }))
            return 1
        if not out_path.exists() or out_path.stat().st_size < 1000:
            print(json.dumps({"ok": False, "error": "no se generó el WAV"}))
            return 1
        # Duración exacta del WAV resultante.
        try:
            with wave.open(str(out_path), "rb") as w:
                duration = w.getnframes() / float(w.getframerate())
        except Exception:
            duration = None
        print(json.dumps({"ok": True, "path": str(out_path), "durationSec": duration}))
        return 0
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": "piper timeout (180s)"}))
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
