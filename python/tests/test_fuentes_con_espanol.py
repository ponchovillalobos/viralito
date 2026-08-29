"""Ninguna fuente del render puede faltarle un caracter del espanol.

Se reporto que en una animacion salia "A?OS" en vez de "AÑOS": la Ñ como un
rombo con interrogacion, que es lo que dibuja el navegador cuando la fuente no
trae el glifo.

QUE SE PUDO COMPROBAR Y QUE NO

Comprobado: las 58 fuentes de `remotion/public/fonts` traen los 16 caracteres
del espanol, Anton incluida (978 glifos, no le falta ninguno). Y el estilo
editorial dibuja "10 años y" perfectamente en un render real.

NO comprobado: el caso exacto de la captura. No existe hoy ninguna tarjeta con
`ñ` en los proyectos verticales, asi que no hay dato con el que reproducirlo.
Puede venir de un render anterior a las correcciones de fuentes.

Asi que este test no arregla aquel caso: impide que la CAUSA vuelva a ser
posible. Si algun dia se agrega una fuente sin Ñ, o alguna se reemplaza por una
version recortada, falla aqui y no en un video ya publicado.

Por que importa tanto: una fuente recortada es de las degradaciones mas
silenciosas que hay. El render no falla, el video sale, y el fallo solo se ve en
las palabras que llevan ese caracter — que en espanol son muchas y muy comunes.
"""
from __future__ import annotations

from pathlib import Path

import pytest

FUENTES = (
    Path(__file__).resolve().parent.parent.parent / "remotion" / "public" / "fonts"
)

# Lo que una fuente necesita para escribir espanol sin agujeros.
ESPANOL = "ÑñÁÉÍÓÚáéíóúÜü¿¡"


def _fuentes() -> list[Path]:
    if not FUENTES.exists():
        return []
    return sorted(
        [*FUENTES.glob("*.ttf"), *FUENTES.glob("*.otf"), *FUENTES.glob("*.woff2")]
    )


@pytest.mark.skipif(not FUENTES.exists(), reason="no hay carpeta de fuentes")
def test_todas_las_fuentes_escriben_espanol() -> None:
    fonttools = pytest.importorskip(
        "fontTools.ttLib", reason="fontTools no esta instalado"
    )

    faltantes: list[str] = []
    ilegibles: list[str] = []
    revisadas = 0

    for f in _fuentes():
        try:
            tf = fonttools.TTFont(str(f), fontNumber=0)
            cmap = tf.getBestCmap()
        except Exception as e:  # noqa: BLE001
            ilegibles.append(f"{f.name}: {str(e)[:60]}")
            continue
        revisadas += 1
        faltan = [c for c in ESPANOL if ord(c) not in cmap]
        if faltan:
            faltantes.append(f"{f.name} no trae: {''.join(faltan)}")

    assert revisadas > 0, "no se pudo leer ni una fuente"
    assert not ilegibles, "fuentes que no se pudieron abrir: " + "; ".join(ilegibles)
    assert not faltantes, (
        "estas fuentes dibujarian un rombo en vez del caracter, y el render NO "
        "fallaria: " + "; ".join(faltantes)
    )


@pytest.mark.skipif(not FUENTES.exists(), reason="no hay carpeta de fuentes")
def test_las_fuentes_de_numeros_grandes_estan() -> None:
    """Anton y Bebas son las de los numeros y titulares en los estilos verticales.

    Si falta el archivo, el navegador cae a una fuente del sistema — y cual sea
    esa depende de la maquina que renderice.
    """
    for nombre in ("Anton-Regular.ttf", "BebasNeue-Regular.ttf"):
        assert (FUENTES / nombre).exists(), f"falta {nombre}"
