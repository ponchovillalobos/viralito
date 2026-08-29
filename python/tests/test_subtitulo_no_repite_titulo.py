"""El subtitulo no puede ser el titular otra vez.

Visto en pantalla, en el primer render de una tanda de once videos:

    "¿Que te sugiere como objetivo SMART?"
    "Sugiere como objetivo SMART."

    "Correo de seguimiento con pendientes"
    "Enviar un correo de seguimiento con los pendientes de caracter."

Dos lineas para decir una cosa, ocupando el espacio donde deberia ir lo que la
frase NO dice. El prompt ya pide dejarlo vacio si no agrega nada ("vacio es
mejor que relleno") y el modelo lo rellena igual: un campo vacio se siente como
trabajo sin hacer.

El chequeo que ya existia comparaba tarjetas ENTRE SI, y por eso el log decia
"SIN texto repetido" mientras esto pasaba: la repeticion estaba DENTRO de una
tarjeta, donde nadie miraba.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from generate_graphics import _repite_el_titulo  # noqa: E402


def test_los_dos_casos_reales_que_se_vieron_en_pantalla() -> None:
    assert _repite_el_titulo(
        "Sugiere como objetivo SMART.",
        "¿Qué te sugiere como objetivo SMART?",
    )
    assert _repite_el_titulo(
        "Enviar un correo de seguimiento con los pendientes de carácter.",
        "Correo de seguimiento con pendientes",
    )


def test_mira_las_dos_direcciones() -> None:
    """El titular contenido en el subtitulo es igual de redundante.

    La primera version miraba solo cuanto del SUBTITULO estaba en el titulo, y
    dejaba pasar el segundo caso real: el subtitulo agrega dos palabras y baja a
    0.6, pero el titular entero esta dentro.
    """
    # Titular corto, subtitulo que lo contiene y lo estira.
    assert _repite_el_titulo(
        "Hay que cuidar mucho la reputacion diaria", "Cuidar la reputacion"
    )

    # Al reves NO aplica cuando el subtitulo es corto, y esta bien que no
    # aplique: la regla de "menos de tres palabras con contenido no se toca"
    # manda sobre esta. Con dos palabras el solape es ruido, y vaciar un
    # subtitulo de dos palabras no gana nada.
    assert not _repite_el_titulo(
        "Cuidar la reputacion", "Hay que cuidar mucho la reputacion diaria"
    )
    # Pero con un subtitulo largo que repite un titular largo, si.
    assert _repite_el_titulo(
        "Cuidar la reputacion diaria del equipo",
        "Hay que cuidar mucho la reputacion diaria del equipo",
    )


def test_un_subtitulo_que_aporta_se_queda() -> None:
    """Lo que agrega informacion NO se toca: el objetivo es quitar relleno."""
    assert not _repite_el_titulo(
        "El equipo perdió tres semanas por eso.", "El espejo equivocado."
    )
    assert not _repite_el_titulo(
        "Practicó cien veces la misma escena.", "Lo que parece talento es horario."
    )


def test_no_toca_subtitulos_cortos_ni_vacios() -> None:
    """Con dos o tres palabras el solape es ruido, no repeticion."""
    assert not _repite_el_titulo("", "Cualquier titular")
    assert not _repite_el_titulo("Corto", "Un titular cualquiera")
    assert not _repite_el_titulo("Muy corto", "Un titular cualquiera")


def test_esta_conectado_al_merge() -> None:
    """Que exista la funcion no alcanza: tiene que aplicarse al armar la tarjeta.

    Es la trampa que este proyecto lleva encontrando toda la sesion — capacidad
    implementada y sin puerta de entrada.
    """
    fuente = (Path(__file__).resolve().parent.parent / "generate_graphics.py").read_text(
        encoding="utf-8"
    )
    i = fuente.index("def _enrich_cards_llm")
    j = fuente.index("\ndef ", i + 10)
    assert "_repite_el_titulo(" in fuente[i:j], (
        "la funcion existe pero no se usa al mezclar la respuesta del LLM"
    )
    assert 'c["subtitle"] = ""' in fuente[i:j], (
        "se detecta la repeticion pero no se vacia el subtitulo"
    )
