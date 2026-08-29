"""Éxito total y éxito parcial no son lo mismo.

`long_form_pipeline` devuelve 0 a propósito cuando al menos un clip salió: que
falte uno no invalida los otros veintidós. Correcto para una corrida que alguien
mira de cerca.

Pero `editar_tanda.py` —que existe justamente para dejar una tanda de horas sin
nadie mirando— sólo miraba ese código de salida. Un video donde fallaron 22 de
23 clips quedaba listado en el resumen final como `OK`, exactamente igual que
uno perfecto. En una tanda de ocho videos, nadie vuelve a mirar.

El dato existía: el pipeline ya escribe `renders_fallidos` en su bitácora. Se lee
de ahí y no capturando la salida del subproceso, porque capturarla haría perder
el progreso en vivo, que es lo único que vuelve mirable una tanda de horas.

Y hay una decisión asimétrica deliberada en el ayudante: si no puede leer la
bitácora devuelve 0, o sea NO degrada el video a PARCIAL sin pruebas. El riesgo
del otro lado —que un parcial pase por OK— ya lo cubre `verificar_tanda.py`, que
abre los archivos en vez de leer un log.
"""
from __future__ import annotations

import json
from pathlib import Path

import editar_tanda as E

FUENTE = Path(E.__file__).read_text(encoding="utf-8")


def _bitacora(tmp_path, vid: str, fallidos: int, sello: str = "20260829_120000"):
    d = tmp_path / "videos" / "logs" / "ejecuciones"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{vid}_{sello}.json").write_text(
        json.dumps({"ok": True, "renders_ok": 1, "renders_fallidos": fallidos}),
        encoding="utf-8",
    )
    return d


def test_lee_los_fallos_de_verdad(tmp_path, monkeypatch) -> None:
    """Que no devuelva 0 siempre, que es lo fácil de escribir sin querer."""
    _bitacora(tmp_path, "DXX_video", fallidos=22)
    monkeypatch.setattr(E, "LF_RAW", str(tmp_path / "videos" / "long_form" / "raw"))
    assert E._renders_fallidos("DXX_video") == 22


def test_cero_fallos_es_cero(tmp_path, monkeypatch) -> None:
    _bitacora(tmp_path, "DYY_video", fallidos=0)
    monkeypatch.setattr(E, "LF_RAW", str(tmp_path / "videos" / "long_form" / "raw"))
    assert E._renders_fallidos("DYY_video") == 0


def test_se_toma_la_corrida_MAS_RECIENTE(tmp_path, monkeypatch) -> None:
    """Un video que falló y se rehizo bien no puede seguir marcado como parcial."""
    _bitacora(tmp_path, "DZZ_video", fallidos=13, sello="20260829_100000")
    _bitacora(tmp_path, "DZZ_video", fallidos=0, sello="20260829_180000")
    monkeypatch.setattr(E, "LF_RAW", str(tmp_path / "videos" / "long_form" / "raw"))
    assert E._renders_fallidos("DZZ_video") == 0, (
        "se está leyendo una corrida vieja: un video ya arreglado seguiría "
        "reportándose como parcial para siempre"
    )


def test_sin_bitacora_no_se_degrada_el_video(tmp_path, monkeypatch) -> None:
    """Ante la duda NO se marca parcial: no hay pruebas, y el verificador cubre."""
    (tmp_path / "videos" / "logs" / "ejecuciones").mkdir(parents=True)
    monkeypatch.setattr(E, "LF_RAW", str(tmp_path / "videos" / "long_form" / "raw"))
    assert E._renders_fallidos("DWW_sin_registro") == 0


def test_una_bitacora_corrupta_no_tumba_la_tanda(tmp_path, monkeypatch) -> None:
    d = tmp_path / "videos" / "logs" / "ejecuciones"
    d.mkdir(parents=True)
    (d / "DVV_video_20260829_120000.json").write_text("{ roto", encoding="utf-8")
    monkeypatch.setattr(E, "LF_RAW", str(tmp_path / "videos" / "long_form" / "raw"))
    assert E._renders_fallidos("DVV_video") == 0


def test_el_resumen_distingue_parcial_de_ok() -> None:
    assert "PARCIAL" in FUENTE, (
        "el resumen no tiene categoría para el éxito parcial: un video con 22 de "
        "23 clips fallidos se lista igual que uno perfecto"
    )
    assert "parciales.append" in FUENTE, "no se acumulan los parciales"
    # Y no puede contarse a la vez como hecho.
    i = FUENTE.index("parciales.append")
    bloque = FUENTE[max(0, i - 400):i]
    assert "hechos.append" not in bloque, (
        "un video parcial se cuenta también como hecho: el resumen diría "
        "'editados: 8 de 8' con uno a medias"
    )


def test_no_se_captura_la_salida_del_pipeline() -> None:
    """El progreso en vivo es lo que vuelve mirable una tanda de horas."""
    i = FUENTE.index("r = subprocess.run(cmd, cwd=str(AQUI))")
    assert "capture_output" not in FUENTE[i:i + 120], (
        "se captura la salida del pipeline: la tanda quedaría muda durante horas"
    )
