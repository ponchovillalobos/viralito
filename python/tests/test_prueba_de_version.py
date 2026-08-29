"""Un PSNR sin control no dice nada.

El proyecto tiene una regla dura: para subir la version de Remotion hay que
cambiar TODOS los paquetes juntos y verificar con render + PSNR contra el
anterior. La regla existia y no habia con que cumplirla.

Lo que estos tests cuidan de `probar_version_de_remotion.py` es lo unico que
puede hacer que la medicion mienta:

EL CONTROL. El render de Remotion NO es determinista: dos corridas de la MISMA
version sobre el mismo clip dan archivos distintos. Asi que un PSNR de 40 dB
entre dos versiones se puede leer como "practicamente identico" o como "cambio
bastante", segun lo que uno quiera creer -- salvo que se sepa cuanto ruido mete
el motor contra si mismo. Por eso se renderiza DOS veces con la version vieja
antes de comparar con la nueva.

Es la misma forma de leerlo que uso `probar_paridad_gl.py` para decidir encender
la aceleracion por placa, donde el peor fotograma con placa (31.86 dB) quedaba
dentro del piso de ruido del control (33.19 dB de minimo).

LAS MISMAS CONDICIONES. Un render de prueba con ajustes distintos a los de
produccion mide otra cosa. Ya paso: con el tope de 30 s por defecto, un estilo
cargado abortaba en el fotograma 115 y la prueba reportaba un fallo que en
produccion no existia.
"""
from __future__ import annotations

from pathlib import Path

import pytest

HERRAMIENTA = Path(__file__).resolve().parent.parent / "probar_version_de_remotion.py"


@pytest.fixture(scope="module")
def fuente() -> str:
    return HERRAMIENTA.read_text(encoding="utf-8")


def test_la_herramienta_existe() -> None:
    assert HERRAMIENTA.exists(), (
        "la regla del proyecto pide verificar un cambio de version con render + "
        "PSNR, y no hay con que hacerlo"
    )


def test_renderiza_dos_veces_con_la_version_vieja(fuente: str) -> None:
    """El control. Sin el, el PSNR entre versiones no se puede interpretar."""
    assert "vieja_1.mp4" in fuente and "vieja_2.mp4" in fuente, (
        "no hay dos renders de control con la version actual: sin saber cuanto "
        "varia el motor contra si mismo, un PSNR entre versiones no se puede leer"
    )
    assert fuente.count("_render(REMOTION_DIR") >= 2, (
        "se renderiza una sola vez con la version actual"
    )


def test_compara_contra_el_control_y_no_contra_un_numero_fijo(fuente: str) -> None:
    """40 dB es 'mucho' o 'poco' segun el clip; el control no."""
    i = fuente.index("apto = (")
    j = fuente.index(")", fuente.index("c_min - 3.0", i))
    criterio = fuente[i:j]
    assert "c_min" in criterio, (
        "el veredicto no mira el control: estaria comparando contra un umbral "
        "fijo, que es justo lo que el ruido del motor vuelve inutil"
    )
    assert "e_min" in criterio, "el veredicto no mira el PSNR entre versiones"


def test_usa_los_ajustes_de_produccion(fuente: str) -> None:
    """Medir con otros ajustes es medir otra cosa."""
    for ajuste in ("--timeout=120000", "--disable-web-security",
                   "--offthreadvideo-cache-size-in-bytes", "--gl=angle"):
        assert ajuste in fuente, (
            f"falta {ajuste}: el pipeline real lo usa, y sin el la prueba no "
            f"reproduce las condiciones de produccion"
        )


def test_la_concurrencia_baja_es_el_default(fuente: str) -> None:
    """La prueba no debe pelear el procesador con lo que este renderizando."""
    i = fuente.index('"--concurrencia"')
    bloque = fuente[i:i + 400]
    assert "default=2" in bloque, (
        "la prueba arrancaria a concurrencia alta y competiria con la tanda que "
        "este corriendo, falseando los tiempos de las dos"
    )


def test_el_veredicto_sale_en_el_codigo_de_salida(fuente: str) -> None:
    """Para poder encadenarla sin leer la salida a ojo."""
    assert "return 0 if apto else 2" in fuente, (
        "no distingue 'apto' de 'no apto' en el codigo de salida"
    )
