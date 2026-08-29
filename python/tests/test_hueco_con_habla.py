"""Un hueco largo sin nadie hablando no es material perdido.

El aviso de "hay N minutos seguidos sin ningun clip" miraba solo el reloj, y por
eso gritaba en los cuatro huecos grandes que habia en disco. Tres estaban bien:

  - Chile: 36.6 minutos al final de la conferencia. Lo que se oye es "Gracias.
    Gracias." con la sala vaciandose. 699 palabras en 36 minutos: 19 por minuto.
  - Otro: 19.3 minutos de logistica de un ejercicio -- "hagan espacio, en
    equipos de dos".
  - Un tercero, mixto: recorrido de producto.

Y uno no: 28.4 minutos con 3.613 palabras, 127 por minuto -- el mismo ritmo que
el resto del video -- sobre lenguaje corporal en una junta. Material publicable
que se perdio.

Desde el reloj los cuatro se ven identicos. Lo que los separa es CUANTO SE
HABLABA, y ese dato no se estaba mirando.

Una alarma que suena igual para los cuatro casos se termina ignorando, y ese es
el modo en que este proyecto pierde cosas: no por falta de avisos, sino por
avisos que no discriminan.

LO QUE ESTE UMBRAL NO RESUELVE, y conviene que quede dicho: la logistica se
habla a ritmo normal (103 palabras por minuto) y sigue avisando. Ese caso cuesta
una mirada. Separarlo pediria leer el contenido, que es justo lo que el modelo
ya hace cuando descarta logistica -- un hueco ahi es el sistema funcionando. Se
prefiere avisar de mas en la duda que callar sobre 28 minutos publicables.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

FUENTE = Path(__file__).resolve().parent.parent / "long_form_pipeline.py"


@pytest.fixture(scope="module")
def bloque() -> str:
    s = FUENTE.read_text(encoding="utf-8")
    i = s.index('_e.metrica("hueco_max_min"')
    # Hasta la validacion siguiente. Cortar en el primer `except` dejaba fuera
    # medio bloque: el propio conteo de palabras tiene uno adentro.
    j = s.index("# Validación: si el LLM no propuso", i)
    return s[i:j]


def test_se_cuentan_las_palabras_del_hueco(bloque: str) -> None:
    assert "hueco_max_palabras" in bloque, (
        "no se mide cuanto se hablaba en el hueco: sin ese dato, 36 minutos de "
        "sala vacia y 28 de contenido perdido se ven exactamente igual"
    )
    assert "LF_TRANSCRIPTS" in bloque, "no se lee el transcript para contarlas"


def test_se_guarda_donde_esta_el_hueco(bloque: str) -> None:
    """Sin el tramo, el aviso no se puede accionar."""
    assert "_hueco_ini" in bloque and "_hueco_fin" in bloque, (
        "solo se guarda cuanto dura el hueco, no donde esta: no hay como ir a "
        "mirarlo ni como contar las palabras que caen dentro"
    )


def test_hay_un_umbral_de_ritmo(bloque: str) -> None:
    assert "_ritmo" in bloque, "no se calcula palabras por minuto"
    m = re.search(r"_ritmo\s*>=\s*(\d+)", bloque)
    assert m, "no hay umbral de ritmo: el aviso volveria a sonar para todos"
    umbral = int(m.group(1))
    assert 10 <= umbral <= 80, (
        f"umbral de {umbral} p/min: fuera de rango razonable. Medido, la sala "
        f"vacia daba 19 y el contenido real 127"
    )


def test_los_dos_avisos_dicen_cosas_distintas(bloque: str) -> None:
    """Callar no alcanza: si el hueco es real hay que decir que no lo es."""
    assert "NO era" in bloque or "no era" in bloque, (
        "el aviso fuerte no afirma que ahi SI habia material"
    )
    assert "sala vacia" in bloque or "logistica" in bloque, (
        "el aviso suave no explica por que ese hueco no importa; sin eso se lee "
        "como el otro y se ignoran los dos"
    )
    assert "volver a analizar" in bloque, (
        "el aviso fuerte no dice que hacer, y uno que no se puede accionar se "
        "termina ignorando"
    )


def test_si_no_se_puede_contar_se_avisa_igual(bloque: str) -> None:
    """Ante la duda, avisar. Callar por no poder medir ya costo cinco videos."""
    assert "_pal = -1" in bloque, (
        "si el transcript no se puede leer, no se distingue de 'no se hablaba'"
    )
    assert "_pal < 0" in bloque, (
        "no poder contar las palabras silencia el aviso. Es el mismo error que "
        "hizo saltar cinco videos sanos por no poder medir su altura: 'no pude "
        "comprobar' no es 'esta bien'"
    )
