""""El archivo está" no es "el archivo sirve".

`_render_already_done` decide si un clip ya renderizado se puede saltar. Miraba
UNA cosa: que el MP4 pesara más de 100 KB. Con eso dio por buenos dos archivos
que no lo eran, los dos en la misma tanda:

1. UNO ESCRITO A MEDIAS. Un render que muere mientras escribe deja un MP4 grande
   y roto: 73 MB sin el átomo `moov`, que ffprobe rechaza con "Invalid mvhd time
   scale 0" y duración N/A. Pesaba de sobra, así que al re-correr el pipeline lo
   saltó y el video quedó roto para siempre — justo el caso que el SKIP existe
   para no romper.

2. UNO VIEJO. Si los gráficos se regeneran después, el MP4 sigue mostrando el
   texto anterior. Pasó con siete clips de un video: el pipeline regeneró los
   gráficos de los quince y saltó el render de los siete que ya estaban en
   disco. Ninguno falló; siete videos quedaron diciendo otra cosa que su JSON.

Y hay un tercer detalle que casi deja pasar el primero: ffprobe responde `N/A`,
con código de salida 0, para un contenedor que no puede leer. Eso es una
RESPUESTA — dice que el archivo está roto — no un fallo de la medición.
Envolver el `float()` en un `except` genérico la convertía en "no se pudo
comprobar" y dejaba pasar el archivo truncado.

La asimetría es deliberada: equivocarse hacia renderizar de más cuesta minutos;
hacia saltar de más cuesta un video roto que nadie mira hasta después de
publicarlo.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import long_form_pipeline as L

FUENTE = Path(L.__file__).read_text(encoding="utf-8")


def _bloque() -> str:
    i = FUENTE.index("def _render_already_done(")
    j = FUENTE.index("\ndef ", i + 10)
    return FUENTE[i:j]


def test_un_archivo_chico_no_cuenta(tmp_path) -> None:
    f = tmp_path / "x.mp4"
    f.write_bytes(b"0" * 10)
    assert L._render_already_done(f) is False


def test_un_archivo_que_no_existe_no_cuenta(tmp_path) -> None:
    assert L._render_already_done(tmp_path / "no_existe.mp4") is False


def test_se_comprueba_que_se_pueda_reproducir(tmp_path, monkeypatch) -> None:
    """73 MB de basura pesan más que el umbral y no son un video."""
    f = tmp_path / "roto.mp4"
    f.write_bytes(b"0" * (200 * 1024))

    class Salida:
        stdout = "N/A"       # lo que devuelve ffprobe sin el atomo moov
        returncode = 0        # y con exito, que es lo que engañaba

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Salida())
    assert L._render_already_done(f) is False, (
        "un MP4 grande pero ilegible se da por bueno y no se rehace nunca"
    )


def test_una_duracion_valida_si_cuenta(tmp_path, monkeypatch) -> None:
    f = tmp_path / "bueno.mp4"
    f.write_bytes(b"0" * (200 * 1024))

    class Salida:
        stdout = "41.75"
        returncode = 0

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Salida())
    assert L._render_already_done(f) is True


def test_na_es_una_respuesta_no_un_fallo() -> None:
    """El detalle que casi deja pasar el archivo truncado."""
    b = _bloque()
    assert "except ValueError:" in b, (
        "el float() de la duracion esta envuelto en un except generico: un "
        "'N/A' se leeria como 'no se pudo comprobar' en vez de como 'el archivo "
        "esta roto', que es lo que significa"
    )
    assert "duracion = 0.0" in b, (
        "una respuesta ilegible no se traduce a 'invalido'"
    )


def test_se_compara_contra_los_graficos() -> None:
    """Lo que evita los siete videos mostrando texto viejo."""
    b = _bloque()
    assert "LF_GRAPHICS" in b, (
        "no se compara el render con su grafico: regenerar los graficos y "
        "saltar el render deja el video diciendo lo anterior"
    )
    assert "LF_PROJECTS" in b, (
        "tampoco con el proyecto, que es la otra entrada que cambia el resultado"
    )
    assert "st_mtime" in b, "no se comparan fechas"


def test_ante_la_duda_se_renderiza() -> None:
    """La asimetria: de mas cuesta minutos, de menos cuesta un video roto."""
    b = _bloque()
    i = b.index("except OSError:")
    assert "return False" in b[i:i + 120] or "pass" in b[i:i + 120], (
        "un error de stat tiene que llevar a renderizar, no a saltar"
    )
    # El primer control sigue siendo el barato.
    assert "_RENDER_MIN_VALID_BYTES" in b, "se perdio el control de tamaño"


def test_la_llamada_pasa_el_clip_id() -> None:
    """Sin el clip_id no se puede buscar el grafico, y el control no hace nada."""
    assert "_render_already_done(out, clip_id)" in FUENTE, (
        "se llama sin clip_id: la comparacion con los graficos queda muerta"
    )
