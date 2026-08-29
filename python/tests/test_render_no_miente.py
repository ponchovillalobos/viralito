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


def test_el_aviso_de_cero_renders_dice_lo_que_paso_no_lo_que_suele_pasar() -> None:
    """Un diagnostico fijo manda a revisar el lugar equivocado.

    Este test pedia antes que el aviso nombrara "el servidor de Next no esta
    arriba", que es la causa mas frecuente. Y una corrida la desmintio: los 13
    clips de un video murieron con `FFmpeg quit with code 3221225794`
    --0xC0000142, Windows no pudo arrancar el proceso-- con el servidor
    perfectamente arriba. El aviso mando a arrancar algo que ya estaba
    corriendo.

    Afirmar siempre la misma causa es peor que no decir ninguna: la primera
    hace perder el tiempo con confianza. Lo que se exige ahora es que el aviso
    muestre EL ERROR QUE VOLVIO del render, y que la hipotesis del servidor
    quede condicionada a que los errores se le parezcan.
    """
    fuente = _fuente()
    assert "NINGUNO de los" in fuente

    # 1. Las causas reales se juntan y se imprimen.
    assert "causas_de_fallo" in fuente, (
        "no se guarda la causa de cada clip fallido, asi que el aviso no puede "
        "decir que fue lo que paso"
    )
    assert re.search(r"devolvi\w* el render|Lo que devolvi", fuente), (
        "las causas se guardan pero no se muestran"
    )

    # 2. La hipotesis del servidor sigue estando, pero condicionada.
    i = fuente.index("NINGUNO de los")
    cola = fuente[i:]
    assert "servidor de Next" in cola, (
        "la causa mas frecuente sigue mereciendo mencionarse cuando encaja"
    )
    assert '"404" in' in cola or "'404' in" in cola, (
        "la hipotesis del servidor tiene que depender de que los errores se le "
        "parezcan (404 / conexion rechazada), no afirmarse siempre"
    )

    # 3. Y el caso que la desmintio quedo cubierto por su nombre.
    assert "3221225794" in cola, (
        "el fallo que probo que el diagnostico fijo era falso no esta "
        "reconocido: volveria a mandar a revisar el servidor"
    )
