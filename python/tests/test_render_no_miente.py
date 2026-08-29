"""El pipeline no puede decir "ok" habiendo renderizado cero clips.

Paso en vivo: el servidor de Next estaba caido, los 23 clips fallaron con 404 al
primer fotograma, y el resumen final dijo

    {"ok": true, "rendered": 0, "render_tasks": 23}

con codigo de salida 0. El lote que lo llamaba lo dio por bueno y siguio al
video siguiente. Con once por delante habria recorrido los once produciendo nada
y terminado diciendo que todo bien.

El `"ok": True` estaba escrito a mano, sin mirar ningun contador. Esa es la
sena de la familia: el exito no lo decide una medicion.

Este test mira el CODIGO, no una corrida: correr el pipeline entero aqui son
horas. Comprueba que el resumen dependa de los contadores y que exista la
comprobacion previa del servidor.
"""
from __future__ import annotations

import re
from pathlib import Path

PY = Path(__file__).resolve().parent.parent
PIPELINE = PY / "long_form_pipeline.py"


def _fuente() -> str:
    return PIPELINE.read_text(encoding="utf-8")


def test_el_resumen_no_lleva_ok_escrito_a_mano() -> None:
    fuente = _fuente()
    # El resumen final del pipeline: `"ok": ...` en el json.dumps de salida.
    assert '"ok": True,\n        "video_id"' not in fuente, (
        "el resumen vuelve a llevar `\"ok\": True` literal: eso informa exito "
        "sin mirar cuantos clips se renderizaron de verdad"
    )
    assert '"ok": not todo_fallo' in fuente, (
        "el `ok` del resumen tiene que salir de los contadores de render"
    )


def test_cero_renders_es_fracaso_y_algunos_no() -> None:
    """Cero es un fracaso; que falten algunos, no.

    Un clip que falla no invalida los otros veintidos — marcar el video entero
    como fallido por uno solo obligaria a rehacer todo.
    """
    fuente = _fuente()
    assert "todo_fallo = render_total > 0 and render_done == 0" in fuente, (
        "falta (o cambio) la condicion de fracaso total"
    )
    assert "return 1 if todo_fallo else 0" in fuente, (
        "el codigo de salida tiene que reflejarlo: el lote que llama al "
        "pipeline decide por ahi si el video salio o no"
    )


def test_se_comprueba_el_servidor_antes_de_renderizar() -> None:
    """Preguntar una vez cuesta un segundo; enterarse por 23 fallos costo 168.

    El render descarga cada clip por HTTP desde el servidor de Next. Sin el, cada
    tarea muere con 404 en el primer fotograma.
    """
    fuente = _fuente()
    i = fuente.index("render_total = len(tasks)")
    j = fuente.index("workers = min(", i)
    previo = fuente[i:j]

    assert "urllib.request.urlopen" in previo, (
        "no se comprueba que el servidor responda ANTES de lanzar las tareas"
    )
    assert "VIRAL_API_HOST" in previo, (
        "la comprobacion tiene que usar el mismo host que usara el render"
    )
    # Y tiene que DECIR que hacer, no solo fallar.
    assert "npm run dev" in previo, (
        "el aviso tiene que decir como arreglarlo; un error que no dice que "
        "hacer deja igual de parado que uno mudo"
    )


def test_el_aviso_de_cero_renders_explica_la_causa_probable() -> None:
    fuente = _fuente()
    assert "NINGUNO de los" in fuente
    assert re.search(r"servidor de Next.*no est|no est.*servidor de Next", fuente), (
        "el aviso de cero renders tiene que nombrar la causa mas comun"
    )
