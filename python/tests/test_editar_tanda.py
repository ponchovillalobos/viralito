"""La herramienta de tanda tiene que protegerse sola.

Se deja corriendo horas sin nadie mirando, asi que sus tres controles no son
comodidades: cada uno viene de una tanda que salio mal.

  - servidor caido  -> 23 clips fallaron con 404 y el resumen dijo "ok"
  - calidad baja    -> nueve de once videos llegaron en 640x360 sin fallar nada
  - un video falla  -> parar la tanda obliga a repetir lo ya hecho
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

PY = Path(__file__).resolve().parent.parent
HERRAMIENTA = PY / "editar_tanda.py"


def _correr(*args: str, env_extra: dict[str, str] | None = None):
    import os

    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(
        [sys.executable, str(HERRAMIENTA), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(PY), env=env, timeout=180,
    )


def test_sin_servidor_no_arranca_la_tanda() -> None:
    """Preguntar una vez cuesta un segundo; enterarse por N fallos costo 168."""
    r = _correr(
        "--video", "D01_lo_que_sea:vogue:#c9a96a",
        env_extra={"VIRAL_API_HOST": "http://localhost:59999"},
    )
    assert r.returncode != 0, "arranco la tanda con el servidor caido"
    salida = r.stdout + r.stderr
    assert "no responde" in salida
    # Y dice QUE HACER: un error que no lo dice deja igual de parado que uno mudo.
    assert "npm run dev" in salida


def test_un_plan_mal_escrito_dice_donde() -> None:
    r = _correr("--plan", str(PY / "no_existe_este_plan.txt"))
    assert r.returncode != 0


def test_el_plan_ignora_comentarios_y_lineas_vacias(tmp_path: Path) -> None:
    plan = tmp_path / "plan.txt"
    plan.write_text(
        "# esto es un comentario\n\nD01_x:vogue:#c9a96a\n\n# otro\n",
        encoding="utf-8",
    )
    r = _correr("--plan", str(plan),
                env_extra={"VIRAL_API_HOST": "http://localhost:59999"})
    # No llega a editar (no hay servidor), pero tampoco se queja del formato.
    assert "se esperaba" not in (r.stdout + r.stderr)


def test_un_plan_con_formato_malo_nombra_la_linea(tmp_path: Path) -> None:
    plan = tmp_path / "plan.txt"
    plan.write_text("D01_x:vogue\n", encoding="utf-8")
    r = _correr("--plan", str(plan))
    salida = r.stdout + r.stderr
    assert "id:tema:acento" in salida, "no explica el formato esperado"
    assert ":1:" in salida, "no dice en que linea esta el problema"


def test_sin_videos_no_hace_nada_en_silencio() -> None:
    r = _correr()
    assert r.returncode != 0
    assert "no hay videos" in (r.stdout + r.stderr)


@pytest.mark.skipif(not HERRAMIENTA.exists(), reason="falta la herramienta")
def test_el_umbral_de_calidad_esta_declarado() -> None:
    """El numero tiene que ser visible y explicado, no escondido en un if."""
    fuente = HERRAMIENTA.read_text(encoding="utf-8")
    assert "ALTURA_MINIMA = 720" in fuente
    assert "--seguir-si-degradado" in fuente, (
        "tiene que haber forma de forzar: la herramienta aconseja, no manda"
    )
