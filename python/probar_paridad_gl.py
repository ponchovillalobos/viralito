#!/usr/bin/env python
"""Prueba de paridad para la aceleración por GPU del render (gl=angle).

`hw_profile` puede recomendar `chromium_gl="angle"`, que le dice al Chromium de
Remotion que dibuje con la placa en vez de por software. Está apagado por
omisión, y el motivo está escrito en el código: «tiene un memory-leak conocido +
posible diferencia sutil de pixel → debe validarse con un test de paridad antes
de prenderlo en producción».

Esa prueba no existía. Sin ella la aceleración no se podía encender de forma
responsable: nadie sabía si el video sale IGUAL, que es la única pregunta que
importa. Un render más rápido que cambia los colores no es una optimización, es
una regresión disfrazada.

Qué hace: renderiza el MISMO proyecto dos veces —una por software, otra con la
placa— y compara los dos archivos fotograma a fotograma con el filtro `psnr` de
ffmpeg. Reporta el tiempo de cada uno y la diferencia real de píxel.

Cómo leer el PSNR (relación señal/ruido; más alto = más parecido):
    infinito   idénticos bit a bit
    > 50 dB    diferencia invisible; ruido de codificación
    40-50 dB   diferencia mínima, no perceptible en video
    < 40 dB    hay algo distinto de verdad: NO encender sin mirarlo

Uso:
    python probar_paridad_gl.py <proyecto.json> [--clip <mp4>]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import config

PYTHON_DIR = Path(__file__).resolve().parent
REMOTION_DIR = PYTHON_DIR.parent / "remotion"


def _render(props_json: Path, salida: Path, con_gpu: bool) -> float:
    """Renderiza y devuelve los segundos que tardó. Lanza si falla."""
    entorno = dict(os.environ)
    # El mismo interruptor que lee hw_profile. Se fuerza el valor en el entorno
    # del hijo para no depender de lo que haya en la consola.
    if con_gpu:
        entorno["VIRAL_REMOTION_GL"] = "angle"
    else:
        entorno.pop("VIRAL_REMOTION_GL", None)
    # El caché del perfil de hardware se invalida por fingerprint, y el env no
    # forma parte de él: si no se fuerza la re-detección, la segunda corrida
    # reusaría la recomendación de la primera y las dos serían iguales.
    entorno["VIRAL_HW_FORCE"] = "1"

    cmd = [
        "npx", "remotion", "render", "src/index.ts", "ViralVideo", str(salida),
        f"--props={props_json}", "--log=error",
    ]
    if con_gpu:
        cmd.append("--gl=angle")
    if sys.platform == "win32":
        cmd[0] = "npx.cmd"

    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(REMOTION_DIR), env=entorno,
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3600)
    if r.returncode != 0 or not salida.exists():
        cola = (r.stderr or "").strip().splitlines()[-8:]
        raise RuntimeError(f"el render {'con GPU' if con_gpu else 'por software'} falló:\n"
                           + "\n".join(cola))
    return time.time() - t0


def _psnr(a: Path, b: Path) -> dict:
    """PSNR entre dos videos, con ffmpeg. Devuelve las métricas que reporta."""
    r = subprocess.run(
        [str(config.FFMPEG_PATH), "-hide_banner", "-i", str(a), "-i", str(b),
         "-lavfi", "psnr", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800,
    )
    salida = (r.stderr or "")
    m = re.search(r"PSNR.*?average:([\d.]+|inf)", salida)
    if not m:
        raise RuntimeError("ffmpeg no reportó PSNR:\n" + salida.strip()[-600:])
    crudo = m.group(1)
    valor = float("inf") if crudo == "inf" else float(crudo)
    minimo = re.search(r"min:([\d.]+|inf)", salida)
    return {
        "psnr_medio_db": valor,
        "psnr_minimo_db": (float("inf") if minimo and minimo.group(1) == "inf"
                           else float(minimo.group(1)) if minimo else None),
    }


def _duracion(v: Path) -> float:
    r = subprocess.run(
        [str(config.FFPROBE_PATH), "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(v)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        return float((r.stdout or "0").strip())
    except ValueError:
        return 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description="Paridad del render con y sin GPU")
    ap.add_argument("props", help="props.json ya construido (build-props / build-clip-props)")
    ap.add_argument("--salida", default=None, help="carpeta donde dejar los dos MP4")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    props = Path(args.props).resolve()
    if not props.exists():
        print(f"no existe: {props}", file=sys.stderr)
        return 2
    destino = Path(args.salida) if args.salida else config.DATA_ROOT / "cache" / "paridad_gl"
    destino.mkdir(parents=True, exist_ok=True)
    sw, gpu = destino / "software.mp4", destino / "gpu.mp4"

    print(f"  proyecto : {props.name}", file=sys.stderr)
    print("  render por software (como está hoy)...", file=sys.stderr)
    t_sw = _render(props, sw, con_gpu=False)
    print(f"    {t_sw:.1f}s · {sw.stat().st_size/1024/1024:.1f} MB", file=sys.stderr)

    print("  render con la placa (gl=angle)...", file=sys.stderr)
    t_gpu = _render(props, gpu, con_gpu=True)
    print(f"    {t_gpu:.1f}s · {gpu.stat().st_size/1024/1024:.1f} MB", file=sys.stderr)

    d_sw, d_gpu = _duracion(sw), _duracion(gpu)
    if abs(d_sw - d_gpu) > 0.1:
        print(f"  AVISO: duran distinto ({d_sw:.2f}s vs {d_gpu:.2f}s); el PSNR no es comparable",
              file=sys.stderr)

    print("  comparando fotograma a fotograma...", file=sys.stderr)
    met = _psnr(sw, gpu)

    mejora = (t_sw - t_gpu) / t_sw * 100 if t_sw else 0.0
    psnr = met["psnr_medio_db"]
    # El umbral no es una opinión: por debajo de 40 dB la diferencia deja de ser
    # ruido de codificación y pasa a ser contenido distinto.
    apto = psnr >= 40.0 and t_gpu < t_sw

    resultado = {
        "segundos_software": round(t_sw, 1),
        "segundos_gpu": round(t_gpu, 1),
        "mejora_pct": round(mejora, 1),
        "psnr_medio_db": psnr if psnr != float("inf") else "infinito",
        "psnr_minimo_db": met["psnr_minimo_db"],
        "apto_para_produccion": apto,
    }
    if args.json:
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
    else:
        print(f"\n  por software : {t_sw:7.1f}s")
        print(f"  con la placa : {t_gpu:7.1f}s   ({mejora:+.1f}%)")
        print(f"  PSNR medio   : {psnr if psnr != float('inf') else 'infinito (idénticos)'} dB")
        if met["psnr_minimo_db"] is not None:
            print(f"  PSNR mínimo  : {met['psnr_minimo_db']} dB")
        print()
        if apto:
            print("  APTO: más rápido y sin diferencia visible.")
        elif psnr < 40.0:
            print("  NO APTO: la imagen cambia de verdad. Mirar los dos archivos antes de decidir.")
        else:
            print("  NO APTO: no es más rápido, así que no compensa el memory-leak.")
    return 0 if apto else 1


if __name__ == "__main__":
    sys.exit(main())
