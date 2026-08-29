"""Un pedazo del video que nadie analizo tiene que decirlo.

QUE PASO

`_analizar_chunks` recorre los trozos del transcript. Si uno agota sus dos
intentos, `analyze_chunk` devuelve [], el bucle sigue, y el resultado final se
ve perfectamente normal: una lista de clips razonable, repartida, con buena
pinta. Nada dice que el trozo que cubria los minutos 194 a 222 no devolvio nada.

Medido sobre un video de 4 horas: 28 minutos seguidos sin un solo clip, con
alguien hablando a 1.200 palabras cada 10 minutos -- exactamente el mismo ritmo
que en el resto del video -- sobre el tema del canal (lenguaje corporal en una
junta, ceder el microfono al interlocutor). El pipeline reporto exito.

Es la enfermedad mas cara de este proyecto: informar que se hizo algo que no se
hizo. Ya aparecio en el render (23 clips fallidos con `"ok": true`), en el
medidor de textos repetidos ("Perfecto" sin abrir un clip) y en el verificador
de tandas (limpio mirando los JSON con los MP4 viejos).

LA DISTINCION QUE HACE UTIL EL AVISO

Un trozo mudo NO es necesariamente un fallo. El final de una conferencia con la
sala vaciandose no tiene clips porque no hay nada -- medido: los ultimos 36
minutos de una charla eran "Gracias. Gracias." Un ejercicio en equipos tampoco
-- "hagan espacio, en equipos de dos".

Desde afuera esos huecos se ven igual que el de 28 minutos con contenido bueno.
Lo que los separa es CUANTAS PALABRAS tenia el trozo. Por eso el aviso las
lleva: sin ellas seria una alarma que grita en los dos casos y se termina
ignorando, como ya paso con otras de este mismo proyecto.
"""
from __future__ import annotations

from pathlib import Path

import analyze_clips as A

FUENTE = Path(A.__file__).read_text(encoding="utf-8")


def _palabras(n: int, ini: float, fin: float) -> list[dict]:
    return [{"start": ini, "end": fin, "word": "x"} for _ in range(n)]


def test_el_tramo_sale_de_las_palabras_del_trozo() -> None:
    chunk = [
        {"start": 100.0, "end": 101.0, "word": "hola"},
        {"start": 160.0, "end": 161.5, "word": "chau"},
    ]
    assert A._tramo(chunk) == (100.0, 161.5)


def test_un_trozo_vacio_no_revienta() -> None:
    assert A._tramo([]) == (0.0, 0.0)


def test_se_anota_el_tramo_y_las_palabras() -> None:
    """Sin el tramo no se sabe QUE parte del video quedo sin mirar."""
    mudos: list[dict] = []
    A._anotar_mudo(mudos, 13, 20, _palabras(1300, 11640, 13320))

    assert len(mudos) == 1
    m = mudos[0]
    assert m["trozo"] == 14 and m["de"] == 20, "el numero de trozo es 1-based"
    assert m["inicio_seg"] == 11640.0 and m["fin_seg"] == 13320.0, (
        "sin el tramo, el aviso no dice que parte del video quedo sin analizar"
    )
    assert m["palabras"] == 1300, (
        "sin la cantidad de palabras no se distingue un fallo de una sala vacia"
    )


def test_sin_lista_no_falla() -> None:
    """Se puede llamar sin acumulador y no debe romper el analisis."""
    A._anotar_mudo(None, 0, 1, _palabras(10, 0, 30))


def test_las_dos_ramas_de_analisis_anotan() -> None:
    """La secuencial (Ollama) y la paralela (CLI de red).

    Cubrir una sola dejaria el agujero abierto justo en el proveedor que se use
    ese dia, que es la clase de arreglo a medias que no arregla nada.
    """
    i = FUENTE.index("def _analizar_chunks(")
    j = FUENTE.index("def main(", i)
    cuerpo = FUENTE[i:j]

    assert cuerpo.count("_anotar_mudo(") >= 2, (
        "solo una de las dos ramas anota los trozos mudos: con el otro proveedor "
        "el tramo perdido volveria a pasar en silencio"
    )
    # La secuencial: no basta con extender, hay que mirar si vino vacio.
    assert "if not obtenidos:" in cuerpo, (
        "la rama secuencial no comprueba si el trozo devolvio algo"
    )
    # La paralela: recorre los resultados buscando los vacios.
    assert "for i, grupo in enumerate(resultados):" in cuerpo, (
        "la rama paralela no revisa cuales trozos quedaron vacios"
    )


def test_viaja_en_el_proposals() -> None:
    """Para poder revisarlo despues, no solo en el momento."""
    assert '"trozos_mudos": trozos_mudos,' in FUENTE, (
        "los trozos mudos no se guardan: el aviso se pierde apenas se cierra la "
        "consola, y despues no hay forma de saber que tramo quedo sin mirar"
    )


def test_el_aviso_separa_los_que_tenian_material() -> None:
    """Un umbral de palabras es lo que evita que el aviso sea ruido."""
    i = FUENTE.index("if trozos_mudos:")
    bloque = FUENTE[i:i + 1400]
    assert "palabras" in bloque, "el aviso no mira cuanto se hablaba en el trozo"
    assert "300" in bloque, (
        "no hay umbral: el aviso gritaria igual por el final de una conferencia "
        "vacia que por 28 minutos de contenido perdido, y entonces se ignora"
    )
    assert "volver a analizar" in bloque, (
        "el aviso no dice que hacer; uno que no se puede accionar se ignora"
    )
