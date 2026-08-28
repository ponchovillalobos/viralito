"""Los gráficos usan EL acento del video, no su propia paleta.

Reportado mirando clips editoriales: «si el texto y las ilustraciones animadas
ya tienen un estilo y color particular, meter más elementos puede dañar el
estilo».

Tenía razón, y se pudo medir. Con acento lima `#a3e635` elegido en el wizard,
los gráficos de una conferencia metieron SEIS colores distintos:

    iconStickers.bg   #34d399 x16   #60a5fa x15   #a78bfa x9
    dataViz.accent    #fbbf24 x3    #f472b6 x1    #fb7185 x1

`generate_graphics.py` nunca recibía el acento del proyecto: tenía su propia
lista de seis y la iba rotando "para dar variedad visual". En un estilo que vive
de ser sobrio, eso no da variedad: rompe el estilo.
"""
from __future__ import annotations

import pathlib

AQUI = pathlib.Path(__file__).resolve().parent.parent


def test_los_graficos_aceptan_el_acento_del_proyecto():
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    assert '"--accent"' in fuente, "generate_graphics ya no acepta --accent"
    assert "_ACENTO_PROYECTO" in fuente
    assert "def _acento(" in fuente


def test_ningun_color_se_elige_de_la_paleta_rotatoria():
    """Todo uso de ACCENTS pasa por `_acento()`, que respeta el del video."""
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    directos = [
        l.strip() for l in fuente.splitlines()
        if "ACCENTS[" in l and "def _acento" not in l and not l.strip().startswith("#")
        and "_ACENTO_PROYECTO or ACCENTS[" not in l
    ]
    assert not directos, (
        "estos sitios eligen color de la paleta rotatoria en vez del acento del "
        f"video, y meten colores que no eligió nadie:\n  " + "\n  ".join(directos)
    )


def test_el_pipeline_de_largos_pasa_el_acento():
    """Que `generate_graphics` lo acepte no sirve si nadie se lo manda."""
    fuente = (AQUI / "long_form_pipeline.py").read_text(encoding="utf-8")
    assert 'cmd += ["--accent", accent]' in fuente, (
        "el pipeline no le pasa el acento a generate_graphics: sería otra "
        "capacidad implementada y sin puerta de entrada"
    )
    assert fuente.count("accent=args.accent_color") >= 2, (
        "algún llamador de step_graphics no pasa el acento — ese clip saldría "
        "con la paleta rotatoria mientras el resto respeta el color elegido"
    )
