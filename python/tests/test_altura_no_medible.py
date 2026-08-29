"""No poder medir un video no puede significar que el video sea malo.

QUE PASO

`editar_tanda.altura()` devolvia 0 en dos situaciones que no se parecen en
nada: el archivo es ilegible, y ffprobe no llego a contestar. Quien llamaba
comparaba `h < ALTURA_MINIMA` y saltaba el video por "calidad degradada".

Con la maquina cargada por ocho trabajadores de render, ffprobe se paso del
plazo de 60 s en cinco videos seguidos. Los cinco tenian 720p -- se comprobo
despues, con la maquina descargada, y midieron 720 sin esfuerzo. Los cinco
quedaron fuera de la tanda. Ningun proceso fallo, ningun mensaje dijo "no pude
medir": el resumen dijo `SALTADO (0p)`, que se lee como un hecho sobre el
archivo cuando era un hecho sobre la maquina.

POR QUE ESTE TEST

El valor centinela que se confunde con un dato valido es el molde del fallo.
0 es una altura posible; None no lo es. Estos tests fijan las tres respuestas
distintas que la funcion tiene que saber dar:

  - se midio y es buena      -> el numero
  - se midio y es ilegible   -> None
  - no se pudo medir         -> None

y, sobre todo, que quien llama NO salte el video cuando no se pudo medir. Un
video sano perdido en silencio es peor que uno feo editado: el feo se ve.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

import editar_tanda


def test_archivo_ausente_no_se_confunde_con_altura_cero() -> None:
    """Lo que no se puede medir devuelve None, nunca 0."""
    r = editar_tanda.altura(Path("no_existe_este_archivo_12345.mp4"))
    assert r is None, f"deberia ser None y devolvio {r!r}"


def test_un_plazo_agotado_no_se_reporta_como_video_malo(monkeypatch) -> None:
    """El caso exacto que perdio cinco videos: ffprobe que no contesta."""
    llamadas = {"n": 0}

    def siempre_tarde(*a, **k):
        llamadas["n"] += 1
        raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=k.get("timeout", 60))

    monkeypatch.setattr(subprocess, "run", siempre_tarde)
    assert editar_tanda.altura(Path("cualquiera.mp4")) is None
    assert llamadas["n"] >= 2, (
        "un solo intento no alcanza: el primer plazo se agota justo por la carga "
        "que el propio programa genero, asi que hay que reintentar"
    )


def test_si_contesta_tarde_pero_contesta_se_toma_el_numero(monkeypatch) -> None:
    """Reintentar sirve de algo: el segundo intento vale."""
    estado = {"n": 0}

    class Salida:
        def __init__(self, out: str, code: int = 0) -> None:
            self.stdout = out
            self.returncode = code

    def tarde_y_luego_bien(*a, **k):
        estado["n"] += 1
        if estado["n"] == 1:
            raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=60)
        return Salida("1080\n")

    monkeypatch.setattr(subprocess, "run", tarde_y_luego_bien)
    assert editar_tanda.altura(Path("cualquiera.mp4")) == 1080


def test_no_medible_no_se_salta() -> None:
    """La decision, no solo la medicion.

    Se lee el fuente porque la rama vive dentro de `main()`, que arranca una
    tanda entera. Lo que se exige es concreto: que `h is None` tenga su propia
    rama y que esa rama NO termine en `continue`.
    """
    fuente = Path(editar_tanda.__file__).read_text(encoding="utf-8")
    lineas = fuente.splitlines()

    i = next(
        (i for i, l in enumerate(lineas) if l.strip() == "if h is None:"),
        None,
    )
    assert i is not None, (
        "no hay una rama para `h is None`: sin ella, no poder medir vuelve a "
        "significar 'video degradado' y se pierden videos sanos"
    )

    # Hasta donde llega la rama: la siguiente linea con igual o menor sangria.
    sangria = len(lineas[i]) - len(lineas[i].lstrip())
    cuerpo = []
    for l in lineas[i + 1:]:
        if l.strip() and (len(l) - len(l.lstrip())) <= sangria:
            break
        cuerpo.append(l.strip())

    assert "continue" not in cuerpo, (
        "la rama de 'no se pudo medir' salta el video. Ese es exactamente el "
        "fallo: cinco videos de 720p quedaron sin editar porque ffprobe se "
        "paso del plazo con la maquina cargada"
    )
    assert any("sin_medir" in l for l in cuerpo), (
        "si se edita sin saber la calidad, tiene que quedar anotado en el "
        "resumen; si no, nadie se entera"
    )


def test_el_resumen_muestra_los_no_medidos() -> None:
    fuente = Path(editar_tanda.__file__).read_text(encoding="utf-8")
    assert "SIN MEDIR" in fuente, (
        "el resumen final no distingue los editados sin comprobar calidad"
    )


@pytest.mark.skipif(
    not Path(editar_tanda.FFMPEG_PATH).with_name("ffprobe.exe").exists(),
    reason="no hay ffprobe en esta maquina",
)
def test_sobre_un_archivo_de_verdad_devuelve_un_entero() -> None:
    """Que la funcion siga midiendo de verdad, no solo devolviendo None."""
    crudos = sorted(Path(editar_tanda.LF_RAW).glob("*.mp4")) if Path(
        editar_tanda.LF_RAW
    ).exists() else []
    if not crudos:
        pytest.skip("no hay videos crudos en esta maquina")
    h = editar_tanda.altura(crudos[0])
    assert isinstance(h, int) and h > 0, f"midio {h!r} sobre {crudos[0].name}"
