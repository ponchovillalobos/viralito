"""Que la decisión de re-transcribir mire los DATOS, no una etiqueta vieja.

`extract_clips` decide entre cortar el transcript (barato) o re-transcribir cada
clip (caro) según si los tiempos son por palabra. Antes leía el campo
`alignment` del archivo y le creía.

Un archivo en disco sobrevive a los cambios de código. El transcript de
producción de un video de 99 minutos decía `"alignment": "segment"` teniendo 2364
huecos reales de 10844 (21.8 %) y CERO palabras interpoladas: se escribió cuando
el umbral de clasificación era 25 %, y quedó así cuando bajó a 10 %.

El costo, medido sobre ese mismo video con 20 clips y las banderas por defecto:
**365 s re-transcribiendo contra ~9.7 s por clip cortando**. Sin aviso — sólo un
print a stderr que se pierde entre el resto de la salida. Otra de la familia
`fallas-que-no-dan-error`: el video sale igual, tardando seis veces más.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from extract_clips import transcript_es_por_palabra  # noqa: E402


def _interpolado(n: int = 40) -> dict:
    """Como los deja `_segments_to_words`: pegadas, sin puntaje."""
    paso = 0.5
    return {
        "alignment": "segment",
        "words": [
            {"word": f"p{i}", "start": round(i * paso, 3),
             "end": round((i + 1) * paso, 3), "score": 0.0}
            for i in range(n)
        ],
    }


def _por_palabra(n: int = 40, etiqueta: str = "word") -> dict:
    """Como los da el modelo: con huecos reales y probabilidad."""
    salida, t = [], 0.0
    for i in range(n):
        dur = 0.30
        salida.append({"word": f"p{i}", "start": round(t, 3),
                       "end": round(t + dur, 3), "score": 0.87})
        t += dur + (0.06 if i % 3 == 0 else 0.0)  # pausas de verdad, no en todas
    return {"alignment": etiqueta, "words": salida}


def test_un_transcript_interpolado_se_reconoce():
    assert transcript_es_por_palabra(_interpolado()) is False


def test_un_transcript_por_palabra_se_reconoce():
    assert transcript_es_por_palabra(_por_palabra()) is True


def test_la_etiqueta_vieja_no_gana_sobre_los_datos():
    """El caso exacto que se encontró en producción y costó 6x en tiempo."""
    t = _por_palabra(etiqueta="segment")  # datos buenos, etiqueta vieja
    assert transcript_es_por_palabra(t) is True, (
        "un archivo escrito con un umbral anterior no puede condenar al pipeline "
        "a re-transcribir para siempre"
    )


def test_la_etiqueta_optimista_tampoco_gana():
    """Y al revés: decir 'word' no vuelve reales unos tiempos interpolados."""
    t = _interpolado()
    t["alignment"] = "word"
    assert transcript_es_por_palabra(t) is False


def test_el_puntaje_alcanza_aunque_no_haya_huecos():
    """Un hablante sin pausas tiene tiempos reales igual: el score lo delata."""
    t = _interpolado()
    for w in t["words"]:
        w["score"] = 0.9
    assert transcript_es_por_palabra(t) is True


def test_sin_datos_se_respeta_la_etiqueta():
    """Nada que mirar: no se inventa una conclusión."""
    assert transcript_es_por_palabra({"alignment": "word", "words": []}) is True
    assert transcript_es_por_palabra({"alignment": "segment", "words": []}) is False
