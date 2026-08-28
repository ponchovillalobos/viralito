"""Que la configuración no dependa de CÓMO se arrancó el proceso.

Los dos bugs que motivan este archivo compartían la peor característica posible:
no producían un error. El sistema arrancaba, corría entero y entregaba video.
Simplemente lo hacía con la mitad del modelo, o escribiendo en la carpeta del
otro proyecto. Nada en la salida decía que algo hubiera salido distinto de lo
esperado, así que sólo se descubrían midiendo.

  1. `config` y `hw_profile` se importan mutuamente. config resolvía el ciclo
     importando hw_profile al final de su módulo, y eso alcanzaba MIENTRAS config
     fuera el primero en cargarse. Cuando algo importaba hw_profile antes (le
     pasaba a extract_clips), la autodetección tiraba ImportError, un `except` lo
     convertía en un aviso por stderr y todo seguía con defaults de CPU y
     qwen3:1.7b en lugar del modelo que la máquina aguanta.

  2. Sin la variable `VIRAL_DATA_ROOT`, el default apuntaba a `C:\\viral-data`,
     que es la carpeta del proyecto hermano. La app siempre pasa la variable al
     hacer spawn, así que por la app todo iba bien; un script corrido a mano
     desde una consola común se iba a los datos del otro proyecto — justo los que
     se separaron a propósito para que no se mezclaran.

Ambos se prueban en SUBPROCESOS: el import de un módulo ocurre una sola vez por
proceso, así que el orden —que es exactamente lo que está bajo prueba— no se
puede reproducir dentro de la sesión de pytest.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

PYTHON_DIR = Path(__file__).resolve().parent.parent


def _en_subproceso(codigo: str, env: dict[str, str] | None = None) -> str:
    """Corre `codigo` con un intérprete limpio en python/ y devuelve su stdout."""
    entorno = {**os.environ, **(env or {})}
    r = subprocess.run(
        [sys.executable, "-c", codigo],
        cwd=str(PYTHON_DIR), capture_output=True, text=True,
        encoding="utf-8",
        errors="replace", timeout=300, env=entorno,
    )
    assert r.returncode == 0, f"el subproceso falló:\n{r.stderr}"
    return (r.stdout or "").strip()


ORDENES = [
    pytest.param("import config", id="config-primero"),
    pytest.param("import hw_profile, config", id="hw_profile-primero"),
    pytest.param("import extract_clips, config", id="extract_clips-primero"),
    pytest.param("import analyze_clips, config", id="analyze_clips-primero"),
]


@pytest.mark.parametrize("orden", ORDENES)
def test_autodeteccion_no_depende_del_orden_de_import(orden):
    """Ningún orden de import puede desactivar la detección de hardware.

    Se compara contra lo que hw_profile recomienda por su cuenta, en vez de
    contra un modelo fijo: la respuesta correcta depende del equipo donde corra
    la prueba, y clavar "qwen3:8b" acá haría fallar el test en otra máquina por
    un motivo que no tiene nada que ver con lo que se quiere cuidar.
    """
    esperado = _en_subproceso(
        "import hw_profile; print(hw_profile.detect().get('recommend', {}).get('ollama_model', ''))"
    )
    if not esperado:
        pytest.skip("hw_profile no pudo recomendar un modelo en este equipo")

    obtenido = _en_subproceso(f"{orden}; print(config.OLLAMA_MODEL)")
    assert obtenido == esperado, (
        f"con `{orden}` la config resolvió {obtenido!r} en vez de {esperado!r}. "
        "Es la firma del ciclo config↔hw_profile: la detección falla, el aviso se "
        "pierde en stderr y el sistema sigue con defaults degradados."
    )


@pytest.mark.parametrize("orden", ORDENES)
def test_ningun_orden_de_import_avisa_de_autodeteccion_fallida(orden):
    """El aviso de fallback no debe aparecer nunca en un arranque sano.

    Se mira stderr y no sólo el resultado porque un fallback puede COINCIDIR con
    lo recomendado por casualidad —en un equipo modesto el default de CPU es la
    respuesta correcta— y entonces el test de arriba pasaría con la detección
    igual de rota.
    """
    r = subprocess.run(
        [sys.executable, "-c", orden],
        cwd=str(PYTHON_DIR), capture_output=True, text=True,
        encoding="utf-8",
        errors="replace", timeout=300,
    )
    assert r.returncode == 0, r.stderr
    assert "no se pudo autodetectar" not in (r.stderr or ""), (
        f"`{orden}` degradó la configuración en silencio:\n{r.stderr}"
    )


def test_data_root_no_cae_en_el_proyecto_hermano():
    """Sin VIRAL_DATA_ROOT, la ruta sale de frontend/.env.local, no del default."""
    env_local = PYTHON_DIR.parent / "frontend" / ".env.local"
    if not env_local.exists():
        pytest.skip("no hay frontend/.env.local en esta copia del repo")
    declarado = next(
        (l.partition("=")[2].strip().strip("\"'")
         for l in env_local.read_text(encoding="utf-8").splitlines()
         if l.strip().startswith("VIRAL_DATA_ROOT=")),
        None,
    )
    if not declarado:
        pytest.skip(".env.local no declara VIRAL_DATA_ROOT")

    # Se BORRA la variable para reproducir la consola común, que es donde fallaba.
    obtenido = _en_subproceso(
        "import config; print(config.DATA_ROOT)", env={"VIRAL_DATA_ROOT": ""}
    )
    assert Path(obtenido) == Path(declarado), (
        f"sin la variable de entorno, DATA_ROOT resolvió a {obtenido!r} en vez del "
        f"{declarado!r} declarado en .env.local. Si apunta a C:\\viral-data, los "
        "scripts de consola están escribiendo en los datos del proyecto hermano."
    )


def test_los_hijos_heredan_la_misma_carpeta_de_datos():
    """Python y los scripts de Node que lanza deben ver la MISMA carpeta.

    Python resuelve bien la ruta —por variable de entorno, o leyendo el
    `.env.local` del frontend— pero lanza scripts de Node (build-props,
    build-clip-props, build-clip-supreme y seis más) que traen su PROPIA copia de
    la misma lógica y caen a `C:\viral-data` cuando no ven la variable.

    Reproducido en una consola limpia antes del arreglo: Python resolvía
    `D:\viral-data\videos` y su hijo de Node `C:\viral-data`. La misma corrida
    leyendo de un disco y escribiendo rutas que apuntan al otro — que además es
    la carpeta del proyecto hermano que se separó a propósito.

    No falla ni avisa: produce un proyecto que apunta a archivos que no están
    donde dice, y eso sólo se descubre cuando un render no encuentra su video.
    """
    guion = Path(__file__).resolve().parent / "_comprobar_data_root.py"
    r = subprocess.run(
        [sys.executable, str(guion)], cwd=str(PYTHON_DIR), capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace", timeout=300, env={**os.environ, "VIRAL_DATA_ROOT": ""},
    )
    assert r.returncode == 0, r.stderr
    datos = json.loads((r.stdout or "").strip().splitlines()[-1])
    if not datos["node"]:
        pytest.skip("node no disponible en esta maquina")
    assert datos["node"] == datos["python"], (
        f"Python usa {datos['python']!r} y sus hijos de Node {datos['node']!r}. "
        "La misma corrida leería de un disco y escribiría rutas apuntando al otro."
    )
