"""Un modelo caído no rompe nada: hace videos peores y dice que todo bien.

Sin Ollama, `generate_graphics` NO falla. Sigue en modo heurístico, avisa por
stderr, y devuelve tarjetas sin reescribir. El pipeline termina, el resumen dice
OK, y los videos salen. Peores, pero salen.

MEDIDO sobre una tanda real. Ollama se cayó a mitad de la noche y los cinco
videos siguientes se hicieron sin él:

    D13  14:02   72 % de tarjetas con subtítulo   (Ollama arriba)
    D17  15:47   34 %                             (se cayó acá)
    D18  16:05   41 %
    D19  16:20   29 %
    D21  16:53   28 %
    D16  17:11   32 %

Contra 60-80 % en los diez videos hechos con el modelo arriba. **La mitad del
texto de apoyo**, sin un solo fallo que lo delatara: el aviso existía y moría en
un log que nadie lee mientras el resumen final decía OK cinco veces seguidas.

Es la misma familia que [[fallas-que-no-dan-error]] y el mismo remedio que ya
tenía el servidor de Next: preguntar UNA vez antes de empezar. Preguntar cuesta
un segundo; enterarse después costó cinco videos y las horas de rehacerlos.
"""
from __future__ import annotations

import urllib.request
from pathlib import Path

import editar_tanda as E

FUENTE = Path(E.__file__).read_text(encoding="utf-8")


def test_hay_una_comprobacion_del_modelo_local() -> None:
    assert hasattr(E, "ollama_vivo"), (
        "no se comprueba que el modelo local responda antes de empezar una "
        "tanda de horas"
    )


def test_dice_false_cuando_no_responde(monkeypatch) -> None:
    def rechaza(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(urllib.request, "urlopen", rechaza)
    assert E.ollama_vivo() is False


def test_dice_true_cuando_responde(monkeypatch) -> None:
    class Resp:
        def read(self, _n=None):
            return b"{"

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: Resp())
    assert E.ollama_vivo() is True


def test_la_tanda_se_para_si_el_modelo_no_esta() -> None:
    """Y se para ANTES, no después de dejar cinco videos a medio hacer."""
    i = FUENTE.index("if not args.sin_ollama and not ollama_vivo():")
    bloque = FUENTE[i:i + 1200]
    assert "return 1" in bloque, (
        "avisa y sigue: los videos saldrian degradados igual, que es lo que ya "
        "paso"
    )
    # Y el aviso tiene que decir QUE se pierde, con el numero medido.
    assert "%" in bloque and "60-80" in bloque, (
        "el aviso no dice cuanto se degrada: sin el numero se lee como un "
        "detalle y se fuerza con la bandera sin pensarlo"
    )
    assert "ollama serve" in bloque, (
        "no dice como arreglarlo; un error que no dice que hacer deja igual de "
        "parado que uno mudo"
    )


def test_se_puede_forzar_a_proposito() -> None:
    """Bloquear sin salida convierte un control en un obstáculo."""
    assert "--sin-ollama" in FUENTE, (
        "no hay forma de editar a proposito sin el modelo; alguien sin Ollama "
        "instalado no podria usar la herramienta"
    )
    i = FUENTE.index('"--sin-ollama"')
    assert "mitad de subtitulos" in FUENTE[i:i + 400], (
        "la bandera no dice lo que cuesta usarla"
    )


def test_el_control_va_junto_al_del_servidor() -> None:
    """Los dos son lo mismo: preguntar una vez antes de perder horas."""
    i_srv = FUENTE.index("servidor OK en")
    i_oll = FUENTE.index("if not args.sin_ollama and not ollama_vivo():")
    assert i_oll > i_srv, "el control de Ollama esta antes que el del servidor"
    # Y los dos antes del bucle que edita.
    i_bucle = FUENTE.index("for i, (vid, tema, acento, material) in enumerate(")
    assert i_oll < i_bucle, (
        "el control corre DENTRO del bucle: preguntaria una vez por video en "
        "vez de una vez por tanda, o directamente tarde"
    )
