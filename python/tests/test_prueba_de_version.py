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
    i = fuente.index("if e_min is None")
    j = fuente.index("apto = veredicto", i)
    criterio = fuente[i:j]
    assert "c_min" in criterio, (
        "el veredicto no mira el control: estaria comparando contra un umbral "
        "fijo, que es justo lo que el ruido del motor vuelve inutil"
    )
    assert "e_min" in criterio, "el veredicto no mira el PSNR entre versiones"


def test_un_control_perfecto_no_absuelve_a_la_version_nueva(fuente: str) -> None:
    """El error que tuvo este criterio, y que es facil de volver a cometer.

    Decia: apto si `e_min == inf or c_min == inf or e_min >= c_min - 3.0`.

    Ese `c_min == inf` esta al reves. Un control infinito significa que las DOS
    corridas de la MISMA version salieron identicas: el motor no mete ruido
    ninguno. Si no hay ruido, cualquier diferencia entre versiones es REAL, no
    menos real. La condicion daba por bueno justo el caso que hay que mirar con
    mas cuidado.

    Y lo hizo: sobre un clip sin B-roll el control dio infinito, la version
    nueva difirio en cinco fotogramas, y el veredicto fue "no se distingue del
    ruido" -- habiendo cero ruido del que no distinguirse.
    """
    i = fuente.index("if e_min is None")
    j = fuente.index("apto = veredicto", i)
    criterio = fuente[i:j]

    # La rama del control perfecto existe y NO concluye que sea apto.
    assert "hay_diferencia_real" in criterio, (
        "no hay rama para 'el control salio identico': ese caso volveria a "
        "caer en la absolucion automatica"
    )
    linea_apto = fuente[fuente.index("apto = veredicto"):][:200]
    assert "hay_diferencia_real" not in linea_apto, (
        "un control perfecto sigue absolviendo a la version nueva: es el error "
        "exacto que este test existe para impedir"
    )
    assert "identico" in linea_apto and "dentro_del_ruido" in linea_apto, (
        "los unicos dos casos aptos son 'identicos' y 'dentro del ruido'"
    )


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


# ---------------------------------------------------------------------------
# El reparto por fotograma.
#
# El promedio y el minimo no distinguen dos situaciones muy distintas: que el
# DISENO haya cambiado (difieren casi todos los fotogramas) o que el video de
# archivo haya caido en otro cuadro (la mayoria identicos, unos pocos muy
# distintos, los de movimiento rapido).
#
# La segunda paso de verdad al probar 4.0.518 contra 4.0.462: el minimo dio
# 18.73 dB, que se lee como un render roto, y al extraer el peor fotograma de
# los dos videos el diseno estaba pixel a pixel igual -- misma tipografia, mismo
# color, misma caja, misma vineta. Lo unico distinto era el cuadro del B-roll,
# en rafagas de 3 de cada 5: remuestreo de fps.
#
# Sin este reparto hay que ir a extraer fotogramas a mano para saber cual de las
# dos es, que es lo que hubo que hacer aquella vez.
# ---------------------------------------------------------------------------

REGISTRO_EJEMPLO = "\n".join(
    [
        "n:1 mse_avg:0.00 psnr_avg:inf",
        "n:2 mse_avg:0.00 psnr_avg:inf",
        "n:3 mse_avg:1.00 psnr_avg:48.13",
        "n:4 mse_avg:1.00 psnr_avg:41.02",
        "n:5 mse_avg:871.81 psnr_avg:18.73",
        "n:6 mse_avg:688.90 psnr_avg:19.75",
        "linea que no es de psnr y hay que ignorar",
    ]
)


def test_el_reparto_cuenta_las_tres_clases(tmp_path) -> None:
    import probar_version_de_remotion as P

    reg = tmp_path / "psnr.log"
    reg.write_text(REGISTRO_EJEMPLO, encoding="utf-8")
    r = P._reparto(reg)

    assert r["fotogramas"] == 6, "conto la linea que no es de psnr"
    assert r["identicos"] == 2
    assert r["casi_iguales"] == 2
    assert r["distintos"] == 2
    assert r["primeros_distintos"] == [5, 6], (
        "no dice QUE fotogramas mirar, que es lo unico que evita extraerlos a mano"
    )


def test_el_reparto_se_reporta(fuente: str) -> None:
    assert "_reparto(" in fuente, "no se calcula el reparto por fotograma"
    # El JSON sale de `resultado`, que se arma antes del `if args.json`.
    i = fuente.index("resultado = {")
    j = fuente.index("}", fuente.index('"apto"', i))
    assert '"reparto"' in fuente[i:j], (
        "el reparto no entra en el resultado, asi que no sale en el JSON y no "
        "se puede encadenar"
    )
    assert "pct_distintos" in fuente, "no se reporta la proporcion que difiere"


def test_el_veredicto_negativo_manda_a_mirar_y_no_a_concluir(fuente: str) -> None:
    """Un 'NO APTO' seco haria descartar una version que estaba bien."""
    i = fuente.index("NO APTO")
    cola = fuente[i:i + 1600]
    assert "MIRAR" in cola or "mirar" in cola, (
        "el veredicto negativo no manda a mirar los fotogramas: se leeria como "
        "'la version nueva rompe el render', que es justo lo que la primera "
        "medicion real parecia decir y no era"
    )
    assert "pct_distintos" in cola, (
        "el veredicto negativo no usa el reparto, que es lo que distingue un "
        "diseno cambiado de un cuadro de video corrido"
    )
