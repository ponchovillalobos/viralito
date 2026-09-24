"""Detecta beats de un track de música para "cortar al ritmo".

Uso:
    python detect_beats.py <ruta_audio>

Salida (stdout, una línea JSON):
    {"tempo": 120.0, "beats": [{"t": 0.51, "strength": 1.83}, ...],
     "downbeats": [...], "drops": [...], "sections": [...], "engine": "..."}

Es un envoltorio de music_map.py (beat_this + energía por compás), que mantiene
el formato de siempre (`tempo`, `beats`) y agrega downbeats, drops y secciones.
Si todo falla devuelve {"beats": []} → el caller sigue sin beat-sync.
"""
import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"beats": [], "tempo": 0, "error": "no input"}))
        return
    try:
        from music_map import mapa

        m = mapa(sys.argv[1])
        m["tempo"] = m.get("bpm", 0)
        print(json.dumps(m))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"beats": [], "tempo": 0, "error": str(e)}))


if __name__ == "__main__":
    main()
