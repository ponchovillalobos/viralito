"""El icono de una tarjeta editorial tiene que hablar del texto que la acompaña.

El usuario lo reportó dos veces. La primera: «dice ojo y salen unas tijeras».
La segunda, viendo un render real de su conferencia:

    "La mayoría de las personas no se atreve a dejar de hacer lo que no les
     apasiona."                                    → NOTA MUSICAL
    "El 80% de los fracasos se debe a la falta de constancia"
                                                   → FLOR DE LOTO
    "Compararte con otros te hace perder el rumbo" → OLAS
    "La verdadera libertad nace cuando decides..."  → ALMOHADILLA

Eran DOS causas encadenadas:

1. Cuando `_icon_for_text` no encontraba nada, el respaldo era `_icon_pool()` —
   ~450 iconos CONCRETOS barajados al azar por video. La variedad era el
   objetivo; que el icono dijera algo cierto, no se contempló.

2. El icono se elegía de la frase heurística y el LLM reescribía el subtítulo
   DESPUÉS. El icono quedaba describiendo palabras que ya no están en pantalla.

Un icono concreto y equivocado es PEOR que uno genérico: el ojo lo lee como una
afirmación sobre el texto.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

AQUI = pathlib.Path(__file__).resolve().parent.parent


def _modulo():
    spec = importlib.util.spec_from_file_location("gg", AQUI / "generate_graphics.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_el_respaldo_no_usa_iconos_concretos():
    """Sin coincidencia de palabra, se cae a los abstractos, no al pool grande."""
    m = _modulo()
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")

    assert 'card["icon"] = pool[i % len(pool)]' not in fuente, (
        "volvió el respaldo al pool barajado: pone una flor de loto sobre una "
        "frase de negocios y el ojo lo lee como una afirmación"
    )
    assert 'card["icon"] = _FALLBACK_ICONS[i % len(_FALLBACK_ICONS)]' in fuente

    # Y esos dieciséis tienen que seguir siendo abstractos: nada de packs
    # externos (`ph:` / `tb:`), que es de donde salían la nota y la flor.
    concretos = [x for x in m._FALLBACK_ICONS if x.startswith(("ph:", "tb:"))]
    assert not concretos, f"entraron iconos concretos al respaldo: {concretos}"
    assert len(m._FALLBACK_ICONS) >= 8, "el respaldo se quedó sin variedad"


def test_el_icono_se_recalcula_tras_reescribir_el_texto():
    """Si el LLM reescribe el subtítulo, el icono se vuelve a elegir."""
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    i = fuente.index("def _enrich_cards_llm")
    bloque = fuente[i : i + 4000]
    assert "_icon_for_text(" in bloque, (
        "el enriquecimiento con LLM reescribe el texto y NO recalcula el icono: "
        "queda describiendo palabras que ya no están en pantalla"
    )


@pytest.mark.parametrize(
    "texto,esperado",
    [
        ("La mayoria de las personas no se atreve a dejar lo que no les apasiona", "users"),
        ("Compararte con otros te hace perder el rumbo", "compass"),
        ("La verdadera libertad nace cuando decides vivir tu proposito", "scale"),
    ],
)
def test_frases_reales_del_usuario_eligen_un_icono_con_sentido(texto, esperado):
    """Las frases exactas del render que motivó el arreglo."""
    m = _modulo()
    assert m._icon_for_text(texto) == esperado


def test_ninguna_frase_real_termina_en_nota_musical_ni_flor():
    """Los cuatro casos concretos que se vieron en pantalla."""
    m = _modulo()
    absurdos = {"ph:music-notes", "ph:flower-lotus", "waves", "hash"}
    frases = [
        "Mas del 70% de los emprendedores alcanzan un punto de quiebre",
        "La mayoria de las personas no se atreve a dejar lo que no les apasiona",
        "El 80% de los fracasos se debe a la falta de constancia",
        "Compararte con otros te hace perder el rumbo",
        "La verdadera libertad nace cuando decides vivir tu proposito",
    ]
    for i, t in enumerate(frases):
        icono = m._icon_for_text(t) or m._FALLBACK_ICONS[i % len(m._FALLBACK_ICONS)]
        assert icono not in absurdos, f"{t[:45]!r} sigue eligiendo {icono!r}"
