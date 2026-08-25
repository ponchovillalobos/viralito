"""Que soltar la VRAM de Ollama sea seguro y no invente su propia forma de fallar.

Por qué importa: `KEEP_ALIVE` deja el modelo cargado diez minutos tras la última
llamada. Eso es correcto MIENTRAS se analiza —entre clip y clip la recarga cuesta
segundos— pero nadie le decía que lo soltara al terminar esa etapa. Medido al
final de un lote de largos en una placa de 6 GB: Ollama retenía 4718 MB y dejaba
1279 libres, menos de los ~2.4 GB que necesita large-v3 para transcribir.

El pipeline extrae clips (que re-transcribe) JUSTO después de analizar, así que
son 7.1 GB pedidos sobre 6. No había estallado por casualidad: en las corridas
con el análisis cacheado, Ollama nunca llegaba a cargarse antes de extraer.

Esta función corre en el camino crítico, así que lo que NO puede hacer es tumbar
un lote de video porque Ollama no contestó. Eso es lo que se prueba acá.
"""
from __future__ import annotations

import json
import pathlib
import sys
import urllib.error

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from lib import ollama_opts  # noqa: E402


class _RespuestaFalsa:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def test_pide_keep_alive_cero_al_modelo_configurado(monkeypatch):
    """El pedido tiene que ser exactamente el que descarga: keep_alive 0."""
    capturado = {}

    def _falso_urlopen(peticion, timeout=None):
        capturado["url"] = peticion.full_url
        capturado["cuerpo"] = json.loads(peticion.data.decode("utf-8"))
        return _RespuestaFalsa()

    # `liberar()` importa urllib dentro del cuerpo, asi que parchear el modulo
    # real alcanza y no hace falta tocar el espacio de nombres de ollama_opts.
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", _falso_urlopen)

    assert ollama_opts.liberar(modelo="qwen3:8b", url="http://localhost:11434") is True
    assert capturado["cuerpo"]["keep_alive"] == 0
    assert capturado["cuerpo"]["model"] == "qwen3:8b"
    assert capturado["url"].endswith("/api/generate")


def test_url_con_barra_final_no_produce_doble_barra(monkeypatch):
    capturado = {}

    def _falso_urlopen(peticion, timeout=None):
        capturado["url"] = peticion.full_url
        return _RespuestaFalsa()

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", _falso_urlopen)

    ollama_opts.liberar(modelo="m", url="http://localhost:11434/")
    assert "//api/generate" not in capturado["url"]


@pytest.mark.parametrize("fallo", [
    urllib.error.URLError("sin conexión"),
    OSError("puerto cerrado"),
    TimeoutError("no contestó"),
])
def test_si_ollama_no_esta_no_rompe_nada(monkeypatch, fallo):
    """Perder memoria libre es aceptable; tumbar un lote de video no."""
    def _falso_urlopen(peticion, timeout=None):
        raise fallo

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", _falso_urlopen)

    assert ollama_opts.liberar(modelo="m", url="http://localhost:1") is False
