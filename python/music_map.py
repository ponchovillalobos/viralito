"""Mapa rítmico de una pista de música: beats, downbeats, energía, secciones y drops.

POR QUÉ EXISTE

`detect_beats.py` usaba sólo `librosa.beat.beat_track`, que asume un tempo único
y se equivoca de grilla: medido 2026-09-23 contra el BPM publicado de 53 pistas
de la biblioteca, librosa acierta 68 % y beat_this 77 %, y los errores de librosa
no son de tempo sino de fase (beats que caen entre medio de la grilla real).
Ver memoria/mediciones/deteccion-de-beats-librosa-contra-beat-this.md.

El montaje necesita más que beats sueltos: el downbeat (primer tiempo del
compás) es donde se corta, y el drop es donde va el golpe grande. Eso es lo que
hacen los editores — y lo que mide `analyze-beatgrid.py` de HyperFrames, que el
video de referencia usó con 78 % de eventos en el beat.

MOTOR

  1. beat_this (CPJKU, MIT código y pesos) en GPU si hay CUDA — ~1 s y ~250 MB
     de VRAM por pista de 3.5 min. Da beats y downbeats.
  2. Si beat_this no carga o falla: librosa, como antes (sin downbeats reales:
     se asume 4/4 desde el primer beat).

La energía, las secciones y los drops salen de librosa (RMS por compás), porque
beat_this no los da. Son heurísticas: el drop es el compás con mayor salto de
energía después de al menos dos compases más tranquilos.

CACHE

Por pista, en `<MUSIC_DIR>/.maps/<nombre>.<tamaño>.<mtime>.json`: la biblioteca
son ~240 pistas fijas y el mapa no cambia. `--no-cache` lo fuerza.

Uso:
    python music_map.py <ruta_audio> [--no-cache] [--engine librosa]
Salida: una línea JSON en stdout.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import config  # noqa: F401  (inyecta el ffmpeg portable en PATH para librosa)
except Exception:  # noqa: BLE001
    pass

VERSION = 1
SR = 22050


def _cache_path(audio: Path) -> Path:
    st = audio.stat()
    return audio.parent / ".maps" / f"{audio.name}.{st.st_size}.{int(st.st_mtime)}.v{VERSION}.json"


def _beats_beat_this(y, sr):
    import torch
    from beat_this.inference import Audio2Beats

    device = "cuda" if torch.cuda.is_available() else "cpu"
    modelo = Audio2Beats(checkpoint_path="final0", device=device, float16=False, dbn=False)
    beats, downbeats = modelo(y, sr)
    motor = f"beat_this-final0-{device}"
    del modelo
    if device == "cuda":
        torch.cuda.empty_cache()
    return [float(b) for b in beats], [float(d) for d in downbeats], motor


def _beats_librosa(y, sr):
    import librosa

    _, frames = librosa.beat.beat_track(y=y, sr=sr)
    beats = [float(t) for t in librosa.frames_to_time(frames, sr=sr)]
    return beats, beats[::4], "librosa"


def analizar(audio: Path, engine: str = "auto") -> dict:
    import numpy as np
    import librosa

    y, sr = librosa.load(str(audio), sr=SR, mono=True)
    dur = float(len(y) / sr)

    beats, downbeats, motor = [], [], ""
    if engine in ("auto", "beat_this"):
        try:
            beats, downbeats, motor = _beats_beat_this(y, sr)
        except Exception as e:  # noqa: BLE001
            print(f"[music_map] beat_this falló, uso librosa: {e}", file=sys.stderr)
    if not beats:
        beats, downbeats, motor = _beats_librosa(y, sr)

    # Intensidad de cada beat (onset strength), para rankear golpes como antes.
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    def fuerza(t: float) -> float:
        fr = int(librosa.time_to_frames(t, sr=sr))
        return float(onset[max(0, min(fr, len(onset) - 1))])

    # Energía por compás (RMS entre downbeats consecutivos), normalizada 0-1.
    rms = librosa.feature.rms(y=y)[0]
    rms_t = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
    limites = list(downbeats) + [dur]
    compases = []
    for a, b in zip(limites[:-1], limites[1:]):
        m = (rms_t >= a) & (rms_t < b)
        compases.append({"t": round(a, 3), "e": float(rms[m].mean()) if m.any() else 0.0})
    if compases:
        emax = max(c["e"] for c in compases) or 1.0
        for c in compases:
            c["e"] = round(c["e"] / emax, 3)

    # Secciones: compases agrupados de a 4, clasificados por tercios de energía.
    secciones = []
    for i in range(0, len(compases), 4):
        grupo = compases[i:i + 4]
        e = sum(c["e"] for c in grupo) / len(grupo)
        t1 = compases[i + 4]["t"] if i + 4 < len(compases) else dur
        secciones.append({"t0": grupo[0]["t"], "t1": round(t1, 3), "energy": round(e, 3)})
    if secciones:
        es = sorted(s["energy"] for s in secciones)
        bajo, alto = es[len(es) // 3], es[(2 * len(es)) // 3]
        for s in secciones:
            s["kind"] = "high" if s["energy"] >= alto else ("low" if s["energy"] <= bajo else "mid")

    # Drops: compás con salto de energía >= 0.25 sobre la media de los 2 anteriores,
    # y que quede en la mitad alta. Separados al menos 8 compases.
    drops = []
    for i in range(2, len(compases)):
        previo = (compases[i - 1]["e"] + compases[i - 2]["e"]) / 2
        if compases[i]["e"] - previo >= 0.25 and compases[i]["e"] >= 0.6:
            if not drops or compases[i]["t"] - drops[-1] > 8 * (dur / max(1, len(compases))):
                drops.append(compases[i]["t"])

    bpm = 0.0
    if len(beats) > 2:
        bpm = float(60.0 / np.median(np.diff(beats)))

    return {
        "v": VERSION,
        "file": audio.name,
        "dur": round(dur, 3),
        "bpm": round(bpm, 2),
        "engine": motor,
        "beats": [{"t": round(t, 3), "strength": round(fuerza(t), 4)} for t in beats],
        "downbeats": [round(t, 3) for t in downbeats],
        "bars": compases,
        "sections": secciones,
        "drops": [round(t, 3) for t in drops],
    }


def mapa(audio_path: str, usar_cache: bool = True, engine: str = "auto") -> dict:
    audio = Path(audio_path)
    cache = _cache_path(audio)
    if usar_cache and engine == "auto" and cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    datos = analizar(audio, engine)
    if engine == "auto":
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(datos), encoding="utf-8")
        except OSError:
            pass
    return datos


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--engine", choices=["auto", "beat_this", "librosa"], default="auto")
    a = ap.parse_args()
    try:
        print(json.dumps(mapa(a.audio, not a.no_cache, a.engine)))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"beats": [], "downbeats": [], "drops": [], "tempo": 0, "error": str(e)}))


if __name__ == "__main__":
    main()
