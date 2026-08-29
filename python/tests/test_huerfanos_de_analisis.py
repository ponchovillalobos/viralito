"""Lo que sobra de un analisis anterior no es un video roto.

QUE PASA EN DISCO

Si un video se vuelve a analizar, la seleccion de clips cambia. Los MP4 y los
JSON de graficos de la seleccion VIEJA siguen ahi. No estan rotos ni
desactualizados: no corresponden a nada. Son los "videos dobles" que se ven en
la interfaz -- el mismo material dos o tres veces.

Importa separarlos porque contaminaban todo lo demas. Sobre los 239 renders en
disco, el verificador reportaba trece problemas. Dos eran reales. De los otros
once, tres eran renders huerfanos senalados como "anteriores a su grafico"
—mandando a re-renderizar clips que ya no existen en las propuestas—, cuatro
eran tarjetas de graficos huerfanos con subtitulos repetidos que no aparecen en
ningun video publicado, y seis eran clips verticales a proposito medidos contra
una resolucion horizontal.

EL BUG QUE ESTE TEST EXISTE PARA IMPEDIR

Los clips de `proposals/*.json` NO traen campo `index`. El numero sale de su
POSICION en la lista, 1-based. Leerlo con `c.get("index", 0)` devuelve 0 para
todos, construye claves `c00_<slug>` que no coinciden con ningun render, y
entonces LOS 239 CLIPS DEL DISCO se reportan como huerfanos y ninguno como
bueno.

Eso paso, y el resultado ("0 vivos, 239 huerfanos") era tan absurdo que se noto.
Con una diferencia mas chica -- un video con dos analisis, digamos -- habria
pasado por bueno y habria mandado a borrar material valido.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import verificar_tanda as V


@pytest.fixture()
def propuestas(tmp_path, monkeypatch) -> Path:
    """Un proposals/ de mentira, con tres clips SIN campo index."""
    lf = tmp_path
    (lf / "proposals").mkdir()
    (lf / "proposals" / "DXX_video.json").write_text(
        json.dumps(
            {
                "clips": [
                    {"slug": "primero-que-eligio", "start": 0, "end": 30},
                    {"slug": "segundo-que-eligio", "start": 60, "end": 95},
                    {"slug": "tercero-que-eligio", "start": 120, "end": 150},
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(V, "LF", lf)
    return lf


def test_el_indice_sale_de_la_posicion_no_de_un_campo(propuestas) -> None:
    """El bug exacto: sin campo `index`, todo se numeraria c00 y nada casaria."""
    vivos = V._clips_de_las_propuestas("DXX_video")

    assert vivos == {
        "c01_primero-que-eligio",
        "c02_segundo-que-eligio",
        "c03_tercero-que-eligio",
    }, (
        "los clips de proposals no traen campo `index`: el numero es su posicion "
        "en la lista, 1-based. Leerlo con .get('index', 0) numera todo c00 y "
        "hace que NINGUN render coincida — el disco entero pasa por huerfano"
    )
    assert not any(v.startswith("c00_") for v in vivos), (
        "hay claves c00_: se leyo un campo `index` inexistente"
    )


def test_un_video_sin_propuestas_no_declara_huerfano_a_nadie(propuestas) -> None:
    """Sin con que comparar, no se afirma nada. Callar es mejor que borrar."""
    assert V._clips_de_las_propuestas("DZZ_no_existe") == set()


def test_propuestas_ilegibles_tampoco(propuestas) -> None:
    (propuestas / "proposals" / "DYY_roto.json").write_text(
        "{ esto no es json", encoding="utf-8"
    )
    assert V._clips_de_las_propuestas("DYY_roto") == set(), (
        "un JSON corrupto haria pasar por huerfano a todo el video"
    )


def test_los_clips_sin_slug_no_generan_clave(propuestas) -> None:
    (propuestas / "proposals" / "DWW_parcial.json").write_text(
        json.dumps({"clips": [{"slug": "bueno"}, {"start": 1}, {"slug": ""}]}),
        encoding="utf-8",
    )
    assert V._clips_de_las_propuestas("DWW_parcial") == {"c01_bueno"}


def test_el_verificador_separa_huerfanos_de_problemas() -> None:
    """Un huerfano no se re-renderiza: se aparta. El aviso tiene que decirlo."""
    fuente = Path(V.__file__).read_text(encoding="utf-8")

    assert "_clips_de_las_propuestas" in fuente
    i = fuente.index("huerfanos: list[str] = []")
    assert i > 0, "no hay lista de huerfanos"

    # Se excluyen de los renders revisados, no se suman a los problemas.
    assert "renders = [f for f in renders if f not in huerfanos_aqui]" in fuente, (
        "los huerfanos siguen contando como renders del video: uno de ellos "
        "aparecia como 'anterior a su grafico' y mandaba a re-renderizar un "
        "clip que ya no existe"
    )
    assert "No hace falta re-renderizarlos" in fuente, (
        "el aviso no dice que hacer con ellos, y lo que corresponde (apartarlos) "
        "es distinto de lo que corresponde a un render desactualizado"
    )


def test_los_graficos_huerfanos_tampoco_se_revisan() -> None:
    """Cuatro problemas de contenido venian de tarjetas que nadie publico."""
    fuente = Path(V.__file__).read_text(encoding="utf-8")
    i = fuente.index('for g in sorted(LF.glob(f"graphics/{vid}_c*.json")):')
    siguiente = fuente[i:i + 400]
    assert "continue" in siguiente and "vivos" in siguiente, (
        "se revisan los graficos de clips que ya no estan en las propuestas: "
        "reportan subtitulos repetidos y cifras sin respaldo de tarjetas que no "
        "aparecen en ningun video"
    )
