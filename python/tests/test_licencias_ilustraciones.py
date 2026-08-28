"""Ninguna ilustracion que entre a un render puede exigir credito.

Viralito publica los videos SIN creditos en pantalla. Una ilustracion CC BY
obliga a acreditar al autor; usarla sin credito incumple su licencia.

Este test NO se fia de lo que dice nuestro LICENSE.txt. Se fia del bloque
<metadata> que cada SVG lleva dentro, que lo pone quien genera el dibujo — la
fuente primaria. Justamente porque la etiqueta nuestra ya mintio: `croodles`
estuvo declarado CC0 durante meses, con 40 archivos en el arbol activo y en uso
como uno de cada tres retratos, mientras su propio metadata decia
creativecommons.org/licenses/by/4.0/ con autor "vijay verma".
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import DATA_ROOT  # noqa: E402

ILUSTRACIONES = Path(DATA_ROOT) / "assets" / "illustrations"

# creativecommons.org/licenses/by/... y sus variantes (by-sa, by-nc...) exigen
# credito. publicdomain/zero/ (CC0) no.
_CON_ATRIBUCION = re.compile(r"creativecommons\.org/licenses/(by[a-z-]*)/", re.I)


def _sets() -> list[Path]:
    if not ILUSTRACIONES.exists():
        return []
    return sorted(
        d for d in ILUSTRACIONES.iterdir() if d.is_dir() and any(d.glob("*.svg"))
    )


def _licencia_embebida(svg: Path) -> str | None:
    m = _CON_ATRIBUCION.search(svg.read_text(encoding="utf-8", errors="replace"))
    return m.group(1).lower() if m else None


@pytest.mark.skipif(
    not ILUSTRACIONES.exists(),
    reason="no hay ilustraciones descargadas en esta maquina",
)
def test_ningun_set_activo_exige_credito() -> None:
    culpables: list[str] = []
    for d in _sets():
        # Los sets son homogeneos: salen todos de una misma fuente. Una muestra
        # de 10 alcanza y deja el test en menos de un segundo.
        for svg in sorted(d.glob("*.svg"))[:10]:
            lic = _licencia_embebida(svg)
            if lic:
                culpables.append(f"{d.name} -> CC {lic.upper()} ({svg.name})")
                break

    assert not culpables, (
        "Estos sets exigen credito y estan en el arbol que leen los renders. "
        "Sacalos a assets/illustrations_con_atribucion/: " + "; ".join(culpables)
    )


@pytest.mark.skipif(
    not ILUSTRACIONES.exists(),
    reason="no hay ilustraciones descargadas en esta maquina",
)
def test_los_sets_de_personas_existen_en_disco() -> None:
    """Sacar un set de la lista no debe dejarla apuntando al vacio.

    Al retirar `croodles` quedaban dos sets; se repuso con `lorelei` y
    `notionists-neutral`, los dos CC0. Si un nombre estuviera mal escrito, el
    render caeria al fallback sin decir nada — otra falla que no da error.
    """
    from generate_graphics import _PERSON_SETS

    faltan = [s for s in _PERSON_SETS if not (ILUSTRACIONES / s).is_dir()]
    assert not faltan, f"sets de personas que no estan en disco: {faltan}"
    assert "croodles" not in _PERSON_SETS, "croodles es CC BY 4.0, no puede volver"
