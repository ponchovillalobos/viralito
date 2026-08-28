"""El texto en pantalla dice lo mismo que la voz. Sin cifras inventadas.

Reportado por el usuario mirando sus propios clips:

    «los textos no tienen nada que ver con lo que se dice en el video, no se usa
     ni una palabra de la transcripción, parece que veo dos videos»

Y tenía razón. Lo que salió en pantalla sobre una conferencia de emprendimiento:

    "Más del 70% de los emprendedores alcanzan un nivel de vida superior..."
    "El 80% de los fracasos se debe a la falta de disciplina y planificación."

Esas cifras **no existen**. El orador nunca las dijo. Estaban debajo de su cara,
con su nombre encima.

Dos causas, y las dos hacían falta para producir el desastre:

1. Los 13 clips tenían el transcript VACÍO (Smart App Control bloqueó un DLL de
   pandas y la transcripción por clip falló sin que nada se detuviera — ver
   `test_pandas_importa.py`). El modelo escribía sobre un video del que no sabía
   nada.

2. El prompt le PEDÍA inventar. Decía, cinco veces, "no repitas literal lo que
   se dice en el video", "sumá ángulo o dato", y para el subtítulo: "máx 12
   palabras que AGREGAN VALOR: un dato interesante". Un modelo local sin
   contexto, obligado a aportar un dato, lo fabrica.

Un texto sin datos es flojo. Un dato falso es otra cosa.
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


FUENTE = "Dale un mexa a un mexicano. Yo tenia 15 anos cuando empece con esto."


@pytest.mark.parametrize(
    "texto",
    [
        "El 80% de los fracasos se debe a la falta de disciplina.",
        "Mas del 70% de los emprendedores alcanzan otro nivel.",
        "Un estudio de 2019 lo confirma.",
        "3 de cada 4 personas fallan por esto.",
    ],
)
def test_rechaza_cifras_que_el_orador_no_dijo(texto):
    """Los textos exactos que salieron en pantalla, y sus parientes."""
    assert _modulo()._inventa_numeros(texto, FUENTE) is True


@pytest.mark.parametrize(
    "texto",
    [
        "Yo tenia 15 anos cuando empece con esto.",   # la cifra SÍ está en la fuente
        "Dale un mexa a un mexicano y va a resolver.",  # sin cifras
        "",
    ],
)
def test_acepta_lo_que_sale_del_audio(texto):
    assert _modulo()._inventa_numeros(texto, FUENTE) is False


def test_sin_transcript_no_pasa_ninguna_cifra():
    """El caso real: 13 clips con transcript vacío.

    Sin fuente no hay con qué respaldar un número, así que no pasa ninguno. Es
    exactamente la situación en la que se fabricaron las estadísticas.
    """
    m = _modulo()
    assert m._inventa_numeros("El 80% de los fracasos se debe a...", "") is True
    assert m._inventa_numeros("Una idea sin numeros", "") is False


def test_el_prompt_ya_no_pide_inventar():
    """El prompt es lo que causó el problema; el filtro es la red debajo."""
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    i = fuente.index("_EDITORIAL_LLM_PROMPT")
    prompt = fuente[i : fuente.index('"""', fuente.index("TARJETAS:", i))]

    for frase in ("no repitas literal", "sumá ángulo o dato", "AGREGAN VALOR"):
        assert frase not in prompt, (
            f"el prompt volvió a pedir que se invente: {frase!r}. Un modelo local "
            "sin contexto, obligado a aportar un dato, lo fabrica."
        )
    # Y tiene que decir explícitamente que no invente cifras.
    assert "PROHIBIDO" in prompt
    assert "NO PUEDE APARECER UN NÚMERO" in prompt


def test_el_filtro_esta_conectado_al_merge():
    """Que exista la función no alcanza: tiene que usarse al aplicar la respuesta."""
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    i = fuente.index("def _enrich_cards_llm")
    bloque = fuente[i : i + 6000]
    assert "_inventa_numeros(" in bloque, (
        "el filtro existe pero no se aplica al mezclar la respuesta del LLM: "
        "sería otra capacidad implementada y sin puerta de entrada"
    )


def test_el_prompt_define_los_tres_registros():
    """Ni todo literal ni inventado: tres registros que se alternan.

    El pedido, textual: «no es repetir literalmente pero tampoco es inventar
    cosas — en algunas oraciones podemos poner la misma frase que se dice en el
    video, en otras frases directamente relacionadas, en otras sí podría ser lo
    mismo; eso le da dinamismo».

    La primera corrección se fue al otro extremo: pedía fidelidad y nada más, y
    eso da textos correctos y planos. La variedad ES el requisito, siempre que
    los tres registros salgan de lo que él dijo.
    """
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    i = fuente.index("_EDITORIAL_LLM_PROMPT")
    prompt = fuente[i : fuente.index('"""', fuente.index("TARJETAS:", i))]

    for registro in ("TAL CUAL", "MÁS APRETADO", "LA VUELTA DE TUERCA"):
        assert registro in prompt, f"el prompt ya no ofrece el registro {registro!r}"

    # Y tiene que explicar dónde está el límite con el EJEMPLO concreto, que es
    # lo único difícil de acertar. Se comprueba el ejemplo y no la frase que lo
    # introduce: la redacción se puede afinar, la explicación no puede faltar.
    assert "espejo equivocado" in prompt, (
        "el prompt ya no explica dónde termina la vuelta de tuerca y empieza el "
        "invento — es la única distinción que el modelo no puede deducir solo"
    )

    # La proporción explícita: sin un objetivo numérico el modelo juega a lo
    # seguro y devuelve casi todo literal. Medido: 78% "tal cual" de 72 tarjetas.
    assert "2 del tipo 1, 2 del tipo 2, 1 del tipo 3" in prompt

    # Y la limpieza es obligatoria, no un extra. Sobrevivían frases rotas como
    # "Sea, nos hemos entrenado" (era "O sea") y dos ideas pegadas sin relación.
    assert "LIMPIAR" in prompt
    assert "Si devolvés una tarjeta con una frase rota, fallaste." in prompt


def test_las_citas_textuales_escalan_con_la_cantidad_de_tarjetas():
    """Una cada cuatro, no una por video.

    El tope era 1 fijo: con seis u ocho tarjetas por clip, TODO lo demás caía en
    la reescritura y el registro "tal cual" casi no aparecía.
    """
    fuente = (AQUI / "generate_graphics.py").read_text(encoding="utf-8")
    assert "max_quotes = max(1, len(picked) // 4)" in fuente, (
        "el tope de citas textuales volvió a ser fijo: con muchas tarjetas, "
        "la frase del orador tal cual casi nunca aparece"
    )
    assert "quotes_usadas < max_quotes" in fuente
