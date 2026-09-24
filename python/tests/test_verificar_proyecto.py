"""Que el verificador previo al render encuentre lo que dice encontrar.

Un chequeo que nunca falla no prueba nada: pasar limpio sobre los proyectos que
hay en disco es consistente tanto con "está todo bien" como con "no revisa nada".
Estos tests le ponen delante proyectos rotos a propósito.

También cuidan el lado opuesto, que en un verificador importa igual: las falsas
alarmas. La primera versión buscaba la música sólo en la carpeta raíz de assets,
pero los archivos viven en subcarpetas por origen (`music/github/`, …) y la API
los encuentra recorriendo recursivamente — así que reportó como faltantes dos
pistas que estaban perfectamente ahí. Un verificador ruidoso se termina
ignorando, y entonces no sirve para nada.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import verificar_proyecto as vp  # noqa: E402


def _proyecto(**extra) -> dict:
    """Un proyecto mínimo y sano, al que cada test le rompe una cosa."""
    base = {
        "id": "prueba", "videoId": "prueba", "styleId": "hype",
        "width": 1080, "height": 1920,
        "captions": [{"start": 0.0, "end": 9.5, "text": "hola"}],
    }
    base.update(extra)
    return base


def _textos(hallazgos, nivel=None) -> str:
    return " | ".join(h.texto for h in hallazgos if nivel is None or h.nivel == nivel)


def _niveles(hallazgos) -> list[str]:
    return [h.nivel for h in hallazgos]


# ---------------------------------------------------------------------------
# Lo que motivó todo: elementos fuera de la duración real del video
# ---------------------------------------------------------------------------
def test_elemento_que_arranca_despues_del_final_es_error(monkeypatch):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(bRoll=[{"start": 12.0, "end": 14.0, "url": "http://x/y.mp4"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "ERROR" in _niveles(h)
    assert "no se va a ver nunca" in _textos(h, "ERROR")


def test_elemento_que_se_pasa_del_final_es_aviso(monkeypatch):
    """Se corta, pero el video sale: no justifica frenar el render."""
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(bRoll=[{"start": 8.0, "end": 13.0, "url": "http://x/y.mp4"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "ERROR" not in _niveles(h)
    assert "se corta" in _textos(h, "AVISO")


def test_pasarse_por_menos_de_un_frame_no_se_reporta(monkeypatch):
    """A 30 fps un frame dura 0.033s; quejarse de eso sería puro ruido."""
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(bRoll=[{"start": 8.0, "end": 10.2, "url": "http://x/y.mp4"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "se corta" not in _textos(h)


def test_marca_instantanea_despues_del_final_es_error(monkeypatch):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(zoomMarks=[{"at": 11.0}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "ERROR" in _niveles(h)


def test_elemento_invertido_es_error(monkeypatch):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(bRoll=[{"start": 5.0, "end": 2.0, "url": "http://x/y.mp4"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "termina antes de empezar" in _textos(h, "ERROR")


def test_tramo_final_vacio_es_aviso(monkeypatch):
    """El síntoma exacto del bug de duración: nada cubre el final del video."""
    monkeypatch.setattr(vp, "duracion_de", lambda _: 20.0)
    p = _proyecto(captions=[{"start": 0.0, "end": 14.0, "text": "hola"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "no tienen ningún elemento encima" in _textos(h, "AVISO")


def test_hueco_gigante_se_reporta_como_video_equivocado(monkeypatch):
    """Si el proyecto cubre el 18% del video, lo probable es que sea otro archivo.

    Decir "te sobran 568 segundos" en ese caso es una alarma falsa; decir "creo
    que no es este archivo" apunta al problema de verdad.
    """
    monkeypatch.setattr(vp, "duracion_de", lambda _: 690.0)
    p = _proyecto(captions=[{"start": 0.0, "end": 121.6, "text": "hola"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "no es el archivo que corresponde" in _textos(h, "AVISO")
    assert "no tienen ningún elemento encima" not in _textos(h)


# ---------------------------------------------------------------------------
# Estructura
# ---------------------------------------------------------------------------
def test_proyecto_sano_no_reporta_errores(monkeypatch):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    h = vp.verificar(_proyecto(), pathlib.Path("video.mp4"))
    assert "ERROR" not in _niveles(h)


@pytest.mark.parametrize("falta", ["width", "height", "styleId"])
def test_falta_un_campo_obligatorio(monkeypatch, falta):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto()
    del p[falta]
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "ERROR" in _niveles(h)


def test_sin_video_las_revisiones_de_tiempo_no_se_inventan(monkeypatch):
    """Sin poder medir, se dice que no se revisó — no se asume que está bien."""
    monkeypatch.setattr(vp, "duracion_de", lambda _: None)
    p = _proyecto(bRoll=[{"start": 999.0, "end": 1000.0, "url": "http://x/y.mp4"}])
    h = vp.verificar(p, None)
    assert "quedan sin hacer" in _textos(h, "AVISO")
    assert "no se va a ver nunca" not in _textos(h)


# ---------------------------------------------------------------------------
# Assets: encontrar los que faltan SIN inventar faltantes
# ---------------------------------------------------------------------------
def test_musica_en_subcarpeta_no_se_reporta_como_faltante(monkeypatch, tmp_path):
    """El falso positivo real: la pista existe, pero un nivel más abajo."""
    musica = tmp_path / "music"
    (musica / "github").mkdir(parents=True)
    (musica / "github" / "pista.mp3").write_bytes(b"x" * 1024)
    monkeypatch.setattr(vp.config, "ASSETS_MUSIC", musica)
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)

    p = _proyecto(musicTrack="/api/music/stream?file=pista.mp3")
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "ERROR" not in _niveles(h), _textos(h)


def test_musica_que_de_verdad_falta_si_es_error(monkeypatch, tmp_path):
    musica = tmp_path / "music"
    musica.mkdir(parents=True)
    monkeypatch.setattr(vp.config, "ASSETS_MUSIC", musica)
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)

    p = _proyecto(musicTrack="/api/music/stream?file=no-existe.mp3")
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "apunta a un archivo que no está" in _textos(h, "ERROR")


def test_archivo_vacio_cuenta_como_faltante(monkeypatch, tmp_path):
    """Una descarga cortada deja un archivo de 0 bytes: existe pero no sirve."""
    musica = tmp_path / "music"
    musica.mkdir(parents=True)
    (musica / "vacia.mp3").write_bytes(b"")
    monkeypatch.setattr(vp.config, "ASSETS_MUSIC", musica)
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)

    p = _proyecto(musicTrack="/api/music/stream?file=vacia.mp3")
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "archivo vacío" in _textos(h, "ERROR")


def test_urls_externas_no_se_revisan(monkeypatch):
    """Pexels/Giphy exigirían red, y el render ya maneja una descarga fallida."""
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(bRoll=[{"start": 1.0, "end": 3.0, "url": "https://videos.pexels.com/x.mp4"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "ERROR" not in _niveles(h)


# ---------------------------------------------------------------------------
# Subtítulos: el falso positivo que costó más caro
# ---------------------------------------------------------------------------
def _sin_transcripts(monkeypatch, tmp_path):
    """Apunta las dos carpetas de transcripts a un temporal vacío."""
    vacio = tmp_path / "sin_transcripts"
    (vacio / "transcripts").mkdir(parents=True)
    monkeypatch.setattr(vp.config, "LONG_FORM_ROOT", vacio)
    monkeypatch.setattr(vp.config, "TRANSCRIPTS_DIR", vacio / "transcripts")
    return vacio


def test_sin_subtitulos_pero_con_transcript_del_clip_no_avisa(monkeypatch, tmp_path):
    """En largos el proyecto es un paso intermedio: los subtítulos llegan después.

    La primera versión avisaba «no trae subtítulos» sobre proyectos que
    terminaban con 116, porque `build-clip-props` los agrega leyendo el
    transcript del clip. Es la peor clase de aviso: correcto sobre el archivo que
    mira, y falso sobre lo que al final pasa.
    """
    raiz = _sin_transcripts(monkeypatch, tmp_path)
    (raiz / "transcripts" / "D20_c01_algo.json").write_text(
        json.dumps({"words": [{"word": "hola", "start": 0.0, "end": 0.4}]}), encoding="utf-8"
    )
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)

    p = _proyecto(id="D20_c01_algo_supreme", videoId="D20_c01_algo")
    del p["captions"]
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "subtítulos" not in _textos(h), _textos(h)


def test_sin_subtitulos_y_sin_transcript_si_avisa(monkeypatch, tmp_path):
    """Y el aviso tiene que seguir saliendo cuando de verdad no hay texto."""
    _sin_transcripts(monkeypatch, tmp_path)
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)

    p = _proyecto(id="D20_c01_algo_supreme", videoId="D20_c01_algo")
    del p["captions"]
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "el video saldría sin texto" in _textos(h, "AVISO")


def test_un_transcript_vacio_no_cuenta_como_subtitulos(monkeypatch, tmp_path):
    """El archivo existe pero no tiene palabras: no salva al video."""
    raiz = _sin_transcripts(monkeypatch, tmp_path)
    (raiz / "transcripts" / "D20_c01_algo.json").write_text(
        json.dumps({"words": []}), encoding="utf-8"
    )
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)

    p = _proyecto(id="D20_c01_algo_supreme", videoId="D20_c01_algo")
    del p["captions"]
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "el video saldría sin texto" in _textos(h, "AVISO")


# ---------------------------------------------------------------------------
# Los nombres de campo REALES del composition. Antes el verificador buscaba
# start/end en las quince listas y se saltaba en silencio doce de ellas.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("lista", [
    "wordStickers", "emphasisCards", "floatingEmojis", "reactionZooms", "sceneFx",
    "iconStickers", "lottieStickers", "particleBursts", "cameraMoves",
])
def test_elementos_con_at_y_duration_se_revisan(monkeypatch, lista):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(**{lista: [{"at": 12.0, "duration": 1.0}]})
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert f"{lista}[0]" in _textos(h, "ERROR")


def test_sin_duration_usa_la_del_schema(monkeypatch):
    # wordSticker dura 1.1 s por omisión: en 9.5 s se pasa del final de 10 s.
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(wordStickers=[{"at": 9.5, "word": "hola", "emoji": "x"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "wordStickers[0]" in _textos(h, "AVISO")


def test_transicion_en_frames_se_convierte_a_segundos(monkeypatch):
    # 60 frames = 2 s: arranca en 9 y termina en 11, se pasa del final.
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(proTransitions=[{"at": 9.0, "durationFrames": 60, "kind": "fade"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "proTransitions[0]" in _textos(h, "AVISO")


def test_image_overlay_usa_starttime_y_endtime(monkeypatch):
    monkeypatch.setattr(vp, "duracion_de", lambda _: 10.0)
    p = _proyecto(imageOverlays=[{"startTime": 11.0, "endTime": 12.0, "src": "x"}])
    h = vp.verificar(p, pathlib.Path("video.mp4"))
    assert "imageOverlays[0]" in _textos(h, "ERROR")


def test_un_proyecto_real_de_disco_se_revisa_entero():
    """El proyecto real que destapó el bug: sus wordStickers tienen `at`/`duration`."""
    real = pathlib.Path(r"D:/viral-data/videos/projects/Poquito Siento PopReels.json")
    if not real.exists():
        pytest.skip("proyecto de referencia no disponible en esta máquina")
    p = json.loads(real.read_text(encoding="utf-8"))
    revisados = [
        lista for lista, *campos in vp.LISTAS_CON_TIEMPO
        for elem in (p.get(lista) or [])
        if isinstance(elem, dict) and vp._inicio_y_fin(elem, *campos)[1] is not None
    ]
    assert "wordStickers" in revisados
