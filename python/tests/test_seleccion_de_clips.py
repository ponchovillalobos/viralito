"""Que `--max-clips` acote el trabajo, y que acote el correcto.

La lógica es de cuatro líneas y aun así tuvo un error de índice: se escribió
1-based cuando `--clips` de extract_clips.py es 0-based. Ese error no habría
fallado — habría salteado el clip de MEJOR puntaje y tomado uno de más, o sea
entregado tres clips distintos de los tres pedidos. Nadie lo nota mirando el
resultado, porque el resultado existe y son tres clips.

Se probó leyendo y por eso se corrigió antes de llegar a un video. Estos tests
están para que la próxima vez no dependa de que alguien lea con atención.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from long_form_pipeline import seleccion_de_clips  # noqa: E402


@pytest.fixture
def propuestas(tmp_path):
    """Escribe un archivo de propuestas con n clips y devuelve su ruta."""
    def _hacer(n: int) -> pathlib.Path:
        ruta = tmp_path / "props.json"
        ruta.write_text(json.dumps({
            "video_id": "prueba",
            # Puntaje descendente, como los deja la etapa de virality.
            "clips": [{"start": i * 60.0, "end": i * 60.0 + 45.0,
                       "slug": f"c{i}", "viralityScore": 100 - i} for i in range(n)],
        }), encoding="utf-8")
        return ruta
    return _hacer


def test_toma_los_primeros_empezando_en_cero(propuestas):
    """El detalle que casi se va: `--clips` es 0-based."""
    assert seleccion_de_clips(propuestas(20), 3, None) == "0,1,2"


def test_los_primeros_son_los_de_mejor_puntaje(propuestas):
    """Truncar sólo sirve si la lista viene ordenada por puntaje."""
    ruta = propuestas(20)
    clips = json.loads(ruta.read_text(encoding="utf-8"))["clips"]
    puntajes = [c["viralityScore"] for c in clips]
    assert puntajes == sorted(puntajes, reverse=True), (
        "si las propuestas dejaran de venir ordenadas por puntaje, quedarse con "
        "las primeras N pasaría a ser quedarse con las primeras EN EL TIEMPO"
    )
    elegidos = [int(i) for i in (seleccion_de_clips(ruta, 3, None) or "").split(",")]
    assert [clips[i]["viralityScore"] for i in elegidos] == puntajes[:3]


def test_una_eleccion_explicita_manda(propuestas):
    """`--clips` es del usuario: el tope no puede pisarlo."""
    assert seleccion_de_clips(propuestas(20), 3, "5,9,11") == "5,9,11"


def test_sin_tope_no_acota_nada(propuestas):
    assert seleccion_de_clips(propuestas(20), None, None) is None
    assert seleccion_de_clips(propuestas(20), 0, None) is None


def test_si_hay_menos_propuestas_que_el_tope_no_acota(propuestas):
    """Pedir 10 de 5 no es pedir 10: es pedir todas."""
    assert seleccion_de_clips(propuestas(5), 10, None) is None


def test_pedir_exactamente_las_que_hay_no_acota(propuestas):
    assert seleccion_de_clips(propuestas(5), 5, None) is None


def test_un_archivo_ilegible_no_tumba_el_pipeline(tmp_path):
    """Ante la duda se trabajan todas, que es el comportamiento de siempre."""
    roto = tmp_path / "roto.json"
    roto.write_text("{esto no es json", encoding="utf-8")
    assert seleccion_de_clips(roto, 3, None) is None
    assert seleccion_de_clips(tmp_path / "no-existe.json", 3, None) is None
