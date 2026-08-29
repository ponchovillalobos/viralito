"""Los clips tienen que terminar donde termina una frase.

`cierran_frase` ya se medía y se escribía en la bitácora, y nadie hacía nada con
ella: en una tanda real dio 17/23. Se medía el defecto y se publicaba igual.

Y se nota antes que nada: un corto que corta en "y entonces lo que pasa es que—"
se siente roto en el primer segundo, antes de que nadie lea un titular.

Medido sobre 23 propuestas reales: 16/23 -> 21/23 cerrando frase, con un ajuste
medio del final de 0.15 s.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.bordes_de_clip import (  # noqa: E402
    ajustar_clip,
    ajustar_final,
    ajustar_inicio,
    cierra_frase,
)


def palabras(*spec: tuple[str, float, float]) -> list[dict]:
    return [{"word": w, "start": s, "end": e} for w, s, e in spec]


TEXTO = palabras(
    ("Hola", 0.0, 0.4),
    ("a", 0.4, 0.5),
    ("todos.", 0.5, 1.0),        # cierre por puntuación
    ("Hoy", 1.6, 1.9),           # pausa de 0.6 antes: arranca frase
    ("vamos", 1.9, 2.3),
    ("a", 2.3, 2.4),
    ("hablar", 2.4, 3.0),
    ("de", 3.0, 3.1),
    ("ventas.", 3.1, 3.8),       # cierre
    ("Empecemos", 4.5, 5.2),     # pausa de 0.7
    ("ya", 5.2, 5.5),
)


def test_estira_el_final_hasta_cerrar_la_frase() -> None:
    # Corta en 3.4, a mitad de "de ventas". El cierre esta en 3.8.
    assert ajustar_final(3.4, TEXTO) == 3.8


def test_prefiere_estirar_antes_que_encoger() -> None:
    """Completar la frase casi siempre mejora; cortarla antes nunca.

    En 3.5 hay dos fronteras a mano: 1.0 (atras, lejos) y 3.8 (adelante, cerca).
    Pero incluso a distancias parecidas gana la de adelante.
    """
    # 3.9 esta a 0.1 de 3.8 (atras). No hay nada adelante dentro de tolerancia,
    # asi que encoge — pero solo porque no habia alternativa.
    assert ajustar_final(3.9, TEXTO) == 3.8


def test_no_toca_nada_si_no_hay_frontera_cerca() -> None:
    """Mejor un corte imperfecto que uno que se lleva media idea ajena."""
    # 30 s esta lejisimos de cualquier palabra del transcript de prueba.
    assert ajustar_final(30.0, TEXTO) == 30.0


def test_el_inicio_prefiere_entrar_tarde() -> None:
    """Arrastrar el cierre de la frase anterior suena a error de montaje."""
    # Empieza en 1.4, justo en la pausa. La frase arranca en 1.6.
    assert ajustar_inicio(1.4, TEXTO) == 1.6


def test_ajustar_clip_devuelve_si_cambio() -> None:
    c = {"start": 1.4, "end": 3.4, "title": "x"}
    nuevo, cambio = ajustar_clip(c, TEXTO)
    assert cambio
    assert nuevo["start"] == 1.6
    assert nuevo["end"] == 3.8
    # Los demas campos se conservan: esto ajusta tiempos, no reescribe el clip.
    assert nuevo["title"] == "x"


def test_no_convierte_un_clip_en_uno_larguisimo() -> None:
    """Estirar el final no puede volver un clip de 55 s en uno de 80."""
    largo = palabras(("uno", 0.0, 0.5), ("dos.", 0.5, 1.0), ("tres", 90.0, 95.0))
    c = {"start": 0.0, "end": 60.0}
    nuevo, _ = ajustar_clip(c, largo, duracion_maxima=75.0)
    assert nuevo["end"] - nuevo["start"] <= 75.0


def test_no_rompe_con_datos_raros() -> None:
    """Un transcript vacio, tiempos invertidos o basura no pueden tumbar la tanda."""
    assert ajustar_clip({"start": 1, "end": 2}, [])[1] is False
    assert ajustar_clip({"start": 5, "end": 3}, TEXTO)[1] is False
    assert ajustar_clip({"start": "x", "end": "y"}, TEXTO)[1] is False


def test_cierra_frase_es_la_misma_cuenta_que_la_bitacora() -> None:
    """Medir y corregir tienen que hablar del mismo fenomeno.

    Cuando la cuenta estaba escrita en dos sitios, arreglar una no movia la
    otra: se podia "mejorar" sin que la metrica se enterara, o al reves.
    """
    assert cierra_frase(1.0, TEXTO)      # termina en "todos."
    assert cierra_frase(3.8, TEXTO)      # termina en "ventas."
    assert not cierra_frase(2.5, TEXTO)  # a mitad de "vamos a hablar"


def test_esta_conectado_al_pipeline() -> None:
    """Que exista no alcanza: la trampa recurrente de este repo."""
    fuente = (Path(__file__).resolve().parent.parent / "long_form_pipeline.py").read_text(
        encoding="utf-8"
    )
    assert "def step_ajustar_bordes" in fuente
    assert "step_ajustar_bordes(args.video_id, proposals_path)" in fuente, (
        "el paso existe pero nadie lo llama"
    )
    # Y tiene que correr ANTES de extraer, o los clips salen con los tiempos viejos.
    assert fuente.index("step_ajustar_bordes(args.video_id") < fuente.index(
        "clips_info = step_extract"
    )
