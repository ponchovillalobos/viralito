"""Un medidor que no midio nada no puede devolver la nota maxima.

`check_text_overlap.py` calcula el objetivo (r) — textos repetidos en pantalla —
y su resumen termina en "0 repeticiones = Perfecto". Con la carpeta vacia o un
`--video` mal escrito imprimia exactamente eso y salia con exito: aprobaba por
no haber mirado un solo clip.

Es la version silenciosa de la misma clase de defecto que ya costo un pipeline
entero en este proyecto: el resultado existe, luego parece que todo esta bien.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PY = Path(__file__).resolve().parent.parent
GUION = PY / "check_text_overlap.py"


def _correr(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GUION), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(PY),
        timeout=180,
    )


def test_sin_clips_que_medir_falla_en_vez_de_aprobar() -> None:
    r = _correr("--video", "este_video_no_existe_en_ninguna_maquina")

    assert r.returncode != 0, (
        "salio con exito sin haber examinado un solo clip; "
        f"stdout={r.stdout[-300:]!r}"
    )
    assert "Perfecto" not in r.stdout, (
        "reporto 'Perfecto' sin medir nada: " + r.stdout[-300:]
    )
    assert "no se examino un solo clip" in r.stderr.lower() or \
           "no se examino" in r.stderr.lower(), r.stderr[-300:]


def test_dice_en_que_carpeta_esta_mirando() -> None:
    """Sin esto, medir en la raiz equivocada es indistinguible de medir bien.

    El script caia en silencio a `C:/viral-data/...` — la raiz del proyecto
    hermano — cuando `import config` fallaba.
    """
    r = _correr("--limit", "1")
    assert "leyendo clips de" in r.stdout, r.stdout[:300]
