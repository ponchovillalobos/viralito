"""`import pandas` tiene que funcionar, o la transcripción se cae en silencio.

Nadie en este proyecto importa pandas directamente. Entra como dependencia de
`pyannote-audio`, que entra por `whisperx`, que es quien alinea las palabras.

El 28 ago 2026, a mitad de una corrida real, dejó de importar:

    ImportError: DLL load failed while importing testing:
    Una directiva de Control de aplicaciones bloqueó este archivo.

Smart App Control bloqueó `pandas/_libs/testing.*.pyd` de pandas 3.0.5. Es UN
solo DLL —una utilidad de PRUEBAS que el pipeline no usa nunca— y los otros ocho
cargaban bien; pero el `__init__` de pandas lo importa al arrancar, así que se
llevó puesto todo `import pandas`, y con él `whisperx`.

**Lo que se vio desde afuera:** los 13 clips de una conferencia salieron con
transcript vacío, y las tarjetas de texto —que se construyen sobre esas
palabras— inventaron el contenido, estadísticas falsas incluidas. El render se
veía perfecto. Ningún paso reportó un error.

Por eso este test existe y por eso pandas está fijado en 2.2.x: no es una
preferencia de versión, es que ese DLL sí está permitido.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent


def _importa(modulo: str) -> tuple[bool, str]:
    r = subprocess.run(
        [sys.executable, "-c", f"import {modulo}"],
        cwd=str(PYTHON_DIR), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=300,
    )
    return r.returncode == 0, (r.stderr or "")[-400:]


def test_pandas_importa():
    ok, err = _importa("pandas")
    assert ok, (
        "`import pandas` falla, así que whisperx no puede alinear y los clips "
        "salen SIN palabras — con las tarjetas de texto inventándose el "
        f"contenido y el render viéndose perfecto.\n{err}"
    )


def test_whisperx_importa():
    """Es el que alinea las palabras: sin él no hay subtítulos karaoke."""
    ok, err = _importa("whisperx")
    assert ok, f"`import whisperx` falla; la alineación por palabra no corre.\n{err}"


def test_pandas_no_salta_a_la_3():
    """La 3.x trae el DLL que Smart App Control bloquea en esta máquina."""
    r = subprocess.run(
        [sys.executable, "-c", "import pandas; print(pandas.__version__)"],
        cwd=str(PYTHON_DIR), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=300,
    )
    assert r.returncode == 0, r.stderr
    version = (r.stdout or "").strip().splitlines()[-1]
    mayor = int(version.split(".")[0])
    assert mayor == 2, (
        f"pandas {version}: la 3.x trae un `_libs/testing` que Smart App Control "
        "bloquea en esta máquina, y al bloquearlo se cae `import pandas` entero. "
        "Ver el comentario de requirements.txt."
    )
