"""Que el análisis de trozos paralelice lo que ESPERA y no lo que calcula.

Esta etapa se lleva el 68 % del tiempo del pipeline según la bitácora (media de
531 s, contra 493 s de extraer y 87 s de transcribir). Los trozos se procesaban
en un bucle secuencial: nueve llamadas de aproximadamente un minuto en un video
de hora y media.

La distinción que gobierna el diseño, y que estos tests cuidan:

  - claude / codex son CLIs que hablan por RED. El equipo espera, no trabaja.
    Nueve esperas seguidas cuando se puede esperar una sola vez es tiempo
    regalado, así que se paralelizan.

  - Ollama es un servidor local sobre UNA placa de 6 GB. Lanzar varias llamadas
    a la vez no las hace más rápidas: las encola, y en el peor caso pelea por
    memoria con la etapa siguiente. Se mantiene secuencial a propósito.

Si alguien "optimiza" el caso de Ollama sin medir, el test de abajo falla y
explica por qué no es una mejora.
"""
from __future__ import annotations

import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import analyze_clips  # noqa: E402


def _chunks(n: int) -> list[list[dict]]:
    """n trozos mínimos pero distinguibles entre sí."""
    return [[{"word": f"p{i}", "start": float(i), "end": float(i) + 0.5}] for i in range(n)]


def _espia(monkeypatch, demora: float = 0.0):
    """Reemplaza analyze_chunk y registra cuántas corrían a la vez."""
    estado = {"vivos": 0, "pico": 0}
    candado = threading.Lock()

    def _falso(chunk, model=None, target_clips=0, provider=""):
        with candado:
            estado["vivos"] += 1
            estado["pico"] = max(estado["pico"], estado["vivos"])
        if demora:
            time.sleep(demora)
        with candado:
            estado["vivos"] -= 1
        return [{"hook": chunk[0]["word"], "start": chunk[0]["start"], "end": chunk[0]["start"] + 30}]

    monkeypatch.setattr(analyze_clips, "analyze_chunk", _falso)
    return estado


def test_ollama_no_se_paraleliza(monkeypatch):
    """Una sola GPU: lanzar varias a la vez no acelera, sólo pelea por memoria."""
    estado = _espia(monkeypatch, demora=0.02)
    analyze_clips._analizar_chunks(_chunks(6), "qwen3:8b", 3, "ollama")
    assert estado["pico"] == 1, (
        f"corrieron {estado['pico']} llamadas a Ollama a la vez. Es un servidor "
        "local sobre una placa de 6 GB: paralelizarlo no lo hace mas rapido."
    )


def test_los_proveedores_de_red_si_se_paralelizan(monkeypatch):
    """claude/codex esperan por red: varias esperas a la vez cuestan lo que una."""
    estado = _espia(monkeypatch, demora=0.05)
    analyze_clips._analizar_chunks(_chunks(6), None, 3, "claude")
    assert estado["pico"] > 1, "los trozos se procesaron de a uno pese a ser llamadas de red"
    assert estado["pico"] <= 4, (
        f"{estado['pico']} llamadas en vuelo: son suscripciones personales, no una "
        "API con cuota generosa"
    )


def test_se_conserva_el_orden_temporal(monkeypatch):
    """El anclaje y el dedup posteriores recorren el video en el tiempo."""
    _espia(monkeypatch, demora=0.01)
    salida = analyze_clips._analizar_chunks(_chunks(8), None, 3, "claude")
    inicios = [c["start"] for c in salida]
    assert inicios == sorted(inicios), f"los trozos volvieron desordenados: {inicios}"


def test_un_trozo_que_falla_no_tumba_el_analisis(monkeypatch):
    """Perder un tramo del video es mucho mejor que perder el analisis entero."""
    def _falso(chunk, model=None, target_clips=0, provider=""):
        if chunk[0]["word"] == "p2":
            raise RuntimeError("este trozo exploto")
        return [{"hook": chunk[0]["word"], "start": chunk[0]["start"], "end": chunk[0]["start"] + 30}]

    monkeypatch.setattr(analyze_clips, "analyze_chunk", _falso)
    salida = analyze_clips._analizar_chunks(_chunks(5), None, 3, "claude")
    assert len(salida) == 4, "deberian sobrevivir los otros cuatro trozos"
    assert all(c["hook"] != "p2" for c in salida)


def test_un_solo_trozo_no_arma_hilos(monkeypatch):
    estado = _espia(monkeypatch)
    analyze_clips._analizar_chunks(_chunks(1), None, 3, "claude")
    assert estado["pico"] == 1
