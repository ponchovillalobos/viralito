"""El archivo definitivo sólo debe existir cuando está entero.

`step_render_clip` escribía directo en la ruta definitiva, y todo lo que viene
después —LUT, re-encode NVENC, normalización de loudness— seguía escribiendo
ahí. Un proceso que muere en cualquiera de esos pasos deja un MP4 con el nombre
del bueno.

Pasó: 73 MB sin el átomo `moov`, que ffprobe rechaza con "Invalid mvhd time
scale 0". Y como el SKIP miraba sólo el tamaño, lo daba por hecho en cada
corrida siguiente — ver [[el-archivo-esta-no-es-el-archivo-sirve]]. Ese SKIP ya
está arreglado, pero eso DETECTA el archivo roto; esto lo EVITA.

Ahora se renderiza a `{clip}_{estilo}.__rendering.mp4` y sólo al terminar todo
se hace `os.replace` al nombre definitivo. `os.replace` es atómico dentro del
mismo volumen: o está el viejo, o está el nuevo, nunca medio archivo con el
nombre bueno.

POR QUÉ ESE SUFIJO Y NO OTRO: `.__rendering` ya era la convención del proyecto
para un render en curso, y `orphan-sweep.ts` lo excluye del panel de producción
desde antes. Un marcador nuevo habría dejado dos convenciones para lo mismo, y
la nueva sin nadie que la filtrara — el temporal habría aparecido en "Mis
videos" como si fuera un video terminado.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

FUENTE = Path(__file__).resolve().parent.parent / "long_form_pipeline.py"


@pytest.fixture(scope="module")
def cuerpo() -> str:
    s = FUENTE.read_text(encoding="utf-8")
    i = s.index("def step_render_clip(")
    j = s.index("\ndef _run_highlights(", i)
    return s[i:j]


def test_se_renderiza_a_un_nombre_provisional(cuerpo: str) -> None:
    assert '__rendering' in cuerpo, (
        "se renderiza directo sobre la ruta definitiva: un proceso que muera a "
        "mitad deja un MP4 roto con el nombre del bueno"
    )
    assert re.search(r'out\s*=\s*LF_RENDERS\s*/\s*f"[^"]*__rendering', cuerpo), (
        "la ruta de trabajo no lleva el marcador de provisional"
    )


def test_el_nombre_definitivo_se_pone_al_final(cuerpo: str) -> None:
    assert "os.replace(out, final)" in cuerpo, (
        "no hay renombrado atomico: sin el, el provisional se queda con su "
        "nombre raro y el definitivo no aparece nunca"
    )
    # Y tiene que ser DESPUES del post-proceso, no justo tras el render.
    i_replace = cuerpo.index("os.replace(out, final)")
    for paso in ("_apply_post_fx", "post_encode", "normalize_loudness"):
        assert cuerpo.index(paso) < i_replace, (
            f"{paso} corre DESPUES del renombrado: el archivo definitivo "
            f"existiria a medio procesar, que es el mismo problema con otro "
            f"nombre"
        )


def test_se_devuelve_la_ruta_definitiva(cuerpo: str) -> None:
    i = cuerpo.index("os.replace(out, final)")
    assert "return final" in cuerpo[i:], (
        "se devuelve el provisional: aguas abajo se registraria un fichero que "
        "ya no existe con ese nombre"
    )


def test_un_renombrado_fallido_no_es_mudo(cuerpo: str) -> None:
    i = cuerpo.index("os.replace(out, final)")
    bloque = cuerpo[i:i + 500]
    assert "except OSError" in bloque, "un fallo al renombrar tumbaria el clip entero"
    assert "no se pudo renombrar" in bloque, (
        "el fallo al renombrar no se dice: quedaria un provisional invisible y "
        "el clip contaria como no hecho, sin explicacion"
    )


def test_se_limpia_el_provisional_de_una_corrida_muerta(cuerpo: str) -> None:
    # Ancla en la ASIGNACION, no en la primera aparicion de la palabra: esa
    # esta en el comentario de arriba y la ventana se corta antes de llegar.
    i = cuerpo.index('out = LF_RENDERS / f"{clip_id}_{style_id}.__rendering.mp4"')
    bloque = cuerpo[i:i + 400]
    assert "unlink" in bloque, (
        "no se borra el provisional de una corrida anterior: ffmpeg podria "
        "encontrarse un archivo a medias con su mismo nombre"
    )


def test_el_provisional_no_aparece_en_las_listas() -> None:
    """Un temporal que se cuela en 'Mis videos' es el mismo problema con otra cara."""
    frontend = FUENTE.resolve().parent.parent / "frontend" / "src" / "lib" / "orphan-sweep.ts"
    if frontend.exists():
        s = frontend.read_text(encoding="utf-8")
        assert "__rendering" in s, (
            "el barrido del panel de produccion no excluye los renders en curso"
        )

    verificador = FUENTE.parent / "verificar_tanda.py"
    v = verificador.read_text(encoding="utf-8")
    assert "__rendering" in v, (
        "el verificador de tandas cuenta los renders en curso como clips: "
        "inventa clips que no existen y reporta 'resolucion ilegible' cada vez "
        "que corre mientras algo renderiza"
    )
