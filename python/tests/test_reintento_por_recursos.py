"""Tres redes de seguridad que no esperan son una sola red.

QUE PASO

`step_render_clip` tiene tres caminos: el pool de render-servers, el CLI de
Remotion directo, y npx. Se leen como tres oportunidades. No lo son: se agotan
en segundos, uno tras otro, sin pausa entre medio.

Cuando Windows no pudo arrancar mas procesos, los trece clips de un video
murieron con `FFmpeg quit with code 3221225794` -- 0xC0000142,
STATUS_DLL_INIT_FAILED. Los tres caminos fallaron por la MISMA causa y a la
misma velocidad. El mismo video, relanzado sin tocar una linea, rindio entero.

Tener caminos distintos no ayuda si ninguno espera. La causa era la maquina, y
el unico remedio para esa causa es tiempo.

QUE SE EXIGE ACA

1. Que se distinga un fallo de RECURSOS de un fallo de CONTENIDO. Reintentar un
   props invalido tres veces no lo arregla: alarga la corrida y esconde el
   error de verdad detras de tres repeticiones.

2. Que ante uno de recursos se ESPERE, y que la espera sea larga. Si en treinta
   segundos la maquina no se descongestiono, treinta mas no cambian nada.

3. Que el ultimo intento relance el error en vez de tragarselo. Un video que
   falla tiene que decirlo.
"""
from __future__ import annotations

import re
from pathlib import Path

import long_form_pipeline as L

FUENTE = Path(L.__file__).read_text(encoding="utf-8")


def test_reconoce_el_fallo_que_costo_trece_clips() -> None:
    """0xC0000142 en sus dos escrituras: decimal, que es como lo imprime ffmpeg."""
    assert L._parece_transitorio(
        RuntimeError("Error: FFmpeg quit with code 3221225794  The FFmpeg output was")
    ), "no reconoce el error exacto que dejo un video entero sin renderizar"


def test_reconoce_las_otras_faltas_de_recursos() -> None:
    for texto in (
        "Cannot allocate memory",
        "Error: The paging file is too small for this operation to complete",
        "Insufficient system resources exist to complete the requested service",
        "fork: Resource temporarily unavailable",
        "quit with code 0xC0000142",
    ):
        assert L._parece_transitorio(RuntimeError(texto)), f"no reconoce: {texto}"


def test_un_error_de_contenido_no_se_reintenta() -> None:
    """Esperar no arregla un props mal armado, y repetirlo esconde la causa."""
    for texto in (
        "delayRender() timed out after 58000ms",
        "Property clips is required",
        "404 Not Found",
        "SyntaxError: Unexpected token",
        "ENOENT: no such file or directory",
    ):
        assert not L._parece_transitorio(RuntimeError(texto)), (
            f"trataria como pasajero un fallo que no lo es: {texto}"
        )


def _bloque_del_reintento() -> str:
    """El lazo ENTERO, `except` incluido.

    Cortar en el primer `return` deja fuera justo la mitad que decide si se
    reintenta o no -- que es la que estos tests miran.
    """
    i = FUENTE.index("ultimo: BaseException | None = None")
    j = FUENTE.index("raise ultimo", i)
    return FUENTE[i:j + len("raise ultimo")]


def test_el_render_reintenta_y_espera() -> None:
    bloque = _bloque_del_reintento()
    assert "time.sleep" in bloque, (
        "no hay espera: sin ella, el reintento choca contra la misma maquina "
        "saturada y falla igual de rapido que los otros tres caminos"
    )
    # Los segundos que declara el `enumerate((...))` del lazo.
    linea = bloque.split("for intento")[1].splitlines()[0]
    dentro = linea[linea.index("(", linea.index("enumerate")) + 1 : linea.rindex(")")]
    esperas = [int(x) for x in re.findall("[0-9]+", dentro)]
    assert esperas, f"no se encontraron las esperas en: {linea.strip()}"
    assert max(esperas) >= 300, (
        f"la espera mas larga es de {max(esperas)}s. Si en treinta segundos la "
        f"maquina no se descongestiono, treinta mas no cambian nada: la causa "
        f"suele ser otro render largo terminando"
    )
    assert len([e for e in esperas if e > 0]) >= 3, (
        "menos de tres esperas: un solo reintento es poco margen para una "
        "maquina que puede estar ocupada varios minutos"
    )


def test_el_ultimo_intento_relanza_el_error() -> None:
    """Un video que no salio tiene que decirlo, no devolver algo vacio."""
    bloque = _bloque_del_reintento()
    assert "raise" in bloque, "el fallo final se traga y el video se reporta como hecho"
    assert "espera == 0" in bloque, (
        "no hay condicion de corte: o reintenta para siempre, o el ultimo "
        "intento no relanza"
    )


def test_no_se_reintenta_lo_que_no_es_de_recursos() -> None:
    bloque = _bloque_del_reintento()
    assert "_parece_transitorio" in bloque, (
        "reintenta cualquier fallo, incluidos los de contenido: eso triplica el "
        "tiempo de una corrida rota y esconde el error real"
    )
