"""Un video puede bajar con buena metadata y estar podrido por dentro.

EL CASO REAL, que es de donde sale todo esto:

`D05` de una tanda de once bajó con 6711 s de duración y 1920x1080 — las dos
comprobaciones que había, las dos correctas. El archivo abría bien. Y estaba
sano hasta el minuto 40 y corrupto a partir de ahí.

Se descubrió quince clips más adelante, cuando ffmpeg reventó con "Invalid data
found when processing input" al cortarlos. A esas alturas ya nadie lo
relacionaba con la descarga: parecía un problema del extractor.

Sondeando el archivo cada pocos minutos:

    min   5  OK        min  45  CORRUPTO
    min  20  OK        min  60  CORRUPTO
    min  30  OK        min  80  CORRUPTO
    min  40  OK        min 100  CORRUPTO

Por eso ahora se comprueba que DECODIFIQUE, no sólo que tenga los datos de
cabecera bien. Cuesta 1.4 s en un video de dos horas: se decodifican dos
segundos en seis puntos repartidos, no el archivo entero.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import FFMPEG_PATH  # noqa: E402
from descargar_de_url import decodifica_entero  # noqa: E402

FFMPEG = str(Path(FFMPEG_PATH))


def _video_de_prueba(destino: Path, segundos: int = 6) -> bool:
    """Un mp4 valido y chico, generado por ffmpeg."""
    try:
        r = subprocess.run(
            [FFMPEG, "-loglevel", "error", "-y", "-f", "lavfi",
             "-i", f"testsrc=duration={segundos}:size=320x240:rate=10",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", str(destino)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120,
        )
        return r.returncode == 0 and destino.exists()
    except Exception:  # noqa: BLE001
        return False


@pytest.fixture()
def video_sano(tmp_path: Path) -> Path:
    f = tmp_path / "sano.mp4"
    if not _video_de_prueba(f):
        pytest.skip("no se pudo generar el video de prueba con ffmpeg")
    return f


def test_un_video_sano_pasa(video_sano: Path) -> None:
    sano, motivo = decodifica_entero(video_sano, puntos=3)
    assert sano, f"marcó como dañado un archivo bueno: {motivo}"


def test_un_archivo_que_no_es_video_no_pasa(tmp_path: Path) -> None:
    """Y NO revienta: devuelve el motivo."""
    f = tmp_path / "basura.mp4"
    f.write_bytes(b"esto no es un mp4" * 100)
    sano, motivo = decodifica_entero(f, puntos=2)
    assert not sano
    assert motivo, "no dijo por qué"


def test_un_archivo_vacio_no_pasa(tmp_path: Path) -> None:
    f = tmp_path / "vacio.mp4"
    f.write_bytes(b"")
    sano, _ = decodifica_entero(f, puntos=2)
    assert not sano


def test_un_video_truncado_no_pasa(video_sano: Path, tmp_path: Path) -> None:
    """Cortar el archivo por la mitad es lo que hace una descarga interrumpida."""
    truncado = tmp_path / "truncado.mp4"
    datos = video_sano.read_bytes()
    truncado.write_bytes(datos[: len(datos) // 2])
    sano, motivo = decodifica_entero(truncado, puntos=3)
    assert not sano, "dio por bueno un archivo cortado a la mitad"
    assert motivo


def test_esta_conectado_a_la_descarga() -> None:
    """Que exista no alcanza: la trampa recurrente de este repo.

    Y tiene que estar ANTES de declarar la descarga buena, no después.
    """
    fuente = (Path(__file__).resolve().parent.parent / "descargar_de_url.py").read_text(
        encoding="utf-8"
    )
    assert "decodifica_entero(salida)" in fuente, (
        "la comprobación existe pero no se usa al terminar la descarga"
    )
    # Se ancla en el resumen FINAL, no en el primer `"ok": True` del archivo:
    # hay otro antes, en la rama de "el video ya estaba en disco", y comparar
    # con ése hacía fallar el test teniendo el código bien.
    assert fuente.index("decodifica_entero(salida)") < fuente.index(
        '"calidad_degradada"'
    ), "se comprueba DESPUÉS de dar la descarga por buena"
    # Y con --exigir-calidad tiene que borrar el archivo: dejar uno dañado que
    # parece bueno es peor que no dejar nada.
    i = fuente.index("decodifica_entero(salida)")
    assert "unlink" in fuente[i : i + 1200], (
        "detecta el daño pero deja el archivo en disco"
    )
