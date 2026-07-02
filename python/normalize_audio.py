"""Normalización de LOUDNESS a -14 LUFS (estándar de TikTok/Reels/Shorts/LinkedIn).

Todas las redes normalizan el audio a ~-14 LUFS integrado. Si el mix sale más bajo,
la red lo sube (amplificando ruido); si sale más alto, lo aplasta (bombea). Publicar
YA a -14 LUFS = el audio suena igual de fuerte y limpio que el de los creadores top.

2-pass loudnorm (la forma correcta, modo linear):
  pass 1: mide I/TP/LRA/thresh del archivo (rápido, -f null).
  pass 2: aplica loudnorm con los valores medidos + linear=true → ganancia lineal
          (sin el "bombeo" del modo dinámico de una sola pasada).
Solo re-encodea el AUDIO (-c:v copy) → segundos por clip, sin tocar el video.

Best-effort SIEMPRE: cualquier fallo (sin audio, ffmpeg raro) = no-op con ok=true
para que el caller nunca trate esto como error de render. 100% offline.

Uso:
    python normalize_audio.py <archivo.mp4>
    → última línea JSON: {"ok": true, "normalized": true, "measured_i": -19.2, ...}
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from config import FFMPEG_PATH

TARGET_I = -14.0
TARGET_TP = -1.5
TARGET_LRA = 11.0
# Si el archivo ya está a ±1 LU del target, no vale la pena re-encodear el audio.
SKIP_TOLERANCE_LU = 1.0


def _run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout
    )


def measure(path: Path) -> dict | None:
    """Pass 1: mide loudness. Devuelve el JSON de loudnorm o None si no se pudo."""
    res = _run([
        str(FFMPEG_PATH), "-hide_banner", "-nostats", "-i", str(path),
        "-af", f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
        "-vn", "-f", "null", os.devnull,
    ])
    # loudnorm imprime su JSON al FINAL de stderr.
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", res.stderr or "", re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def normalize(path: Path) -> dict:
    if not path.exists():
        return {"ok": False, "normalized": False, "error": f"no existe: {path}"}
    stats = measure(path)
    if not stats:
        # Sin stream de audio o ffmpeg no midió → no-op (nunca romper el render).
        return {"ok": True, "normalized": False, "reason": "sin medición de audio (no-op)"}

    try:
        measured_i = float(stats["input_i"])
    except (KeyError, ValueError):
        return {"ok": True, "normalized": False, "reason": "medición inválida (no-op)"}

    if abs(measured_i - TARGET_I) <= SKIP_TOLERANCE_LU:
        return {"ok": True, "normalized": False, "reason": f"ya está a {measured_i} LUFS (±1 del target)", "measured_i": measured_i}

    af = (
        f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}"
        f":measured_I={stats['input_i']}:measured_TP={stats['input_tp']}"
        f":measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}"
        f":offset={stats.get('target_offset', 0)}:linear=true"
    )
    tmp = path.with_name(path.stem + ".__loudnorm.mp4")
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
    res = _run([
        str(FFMPEG_PATH), "-y", "-hide_banner", "-nostats", "-i", str(path),
        "-map", "0",
        "-c:v", "copy",            # el video NO se toca (cero pérdida, segundos)
        "-af", af,
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        str(tmp),
    ])
    if res.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        last = ((res.stderr or "").strip().splitlines() or ["ffmpeg falló"])[-1]
        return {"ok": True, "normalized": False, "reason": f"loudnorm falló (no-op): {last[:150]}"}
    try:
        os.replace(tmp, path)
    except OSError as e:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return {"ok": True, "normalized": False, "reason": f"replace falló (no-op): {e}"}
    return {"ok": True, "normalized": True, "measured_i": measured_i, "target_i": TARGET_I, "path": str(path)}


def main() -> int:
    ap = argparse.ArgumentParser(description="Normaliza el loudness del MP4 a -14 LUFS (2-pass, solo audio)")
    ap.add_argument("path", help="MP4 a normalizar (in-place)")
    args = ap.parse_args()
    result = normalize(Path(args.path))
    if result.get("normalized"):
        print(f"[loudnorm] {Path(args.path).name}: {result.get('measured_i')} → -14 LUFS", file=sys.stderr)
    else:
        print(f"[loudnorm] skip: {result.get('reason', result.get('error', ''))}", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
