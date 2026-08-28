"""La version de la app de escritorio se declara en cuatro archivos.

`Cargo.toml`, `tauri.conf.json`, `package.json` y `Cargo.lock`. Ninguno lee al
otro, asi que se separan sin que nada falle: el instalador sale con un numero, la
ventana muestra otro y el paquete dice un tercero.

Ya habia pasado. `package.json` se quedo en 0.1.0 mientras los otros iban en
0.5.0, y el `Cargo.lock` tambien — lo corrigio el propio compilador cuando se
intento un build, no una revision.

Es la misma familia de las listas duplicadas que este proyecto lleva encontrando
(estilos escritos dos veces, temas editoriales, miniaturas): un dato en varios
sitios sin nadie que los compare.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
ESCRITORIO = REPO / "desktop"


def _de_cargo_toml() -> str | None:
    p = ESCRITORIO / "src-tauri" / "Cargo.toml"
    if not p.exists():
        return None
    # Solo la version del PAQUETE, la primera bajo [package]; las de las
    # dependencias mas abajo no son esta.
    m = re.search(r"^version\s*=\s*\"([^\"]+)\"", p.read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else None


def _de_tauri_conf() -> str | None:
    p = ESCRITORIO / "src-tauri" / "tauri.conf.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8")).get("version")


def _de_package_json() -> str | None:
    p = ESCRITORIO / "package.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8")).get("version")


def _de_cargo_lock() -> str | None:
    p = ESCRITORIO / "src-tauri" / "Cargo.lock"
    if not p.exists():
        return None
    nombre = None
    toml = ESCRITORIO / "src-tauri" / "Cargo.toml"
    if toml.exists():
        m = re.search(r"^name\s*=\s*\"([^\"]+)\"", toml.read_text(encoding="utf-8"), re.M)
        nombre = m.group(1) if m else None
    if not nombre:
        return None
    m = re.search(
        r'name = "' + re.escape(nombre) + r'"\s*\nversion = "([^"]+)"',
        p.read_text(encoding="utf-8"),
    )
    return m.group(1) if m else None


@pytest.mark.skipif(not ESCRITORIO.exists(), reason="no hay carpeta desktop/")
def test_las_cuatro_versiones_coinciden() -> None:
    declaradas = {
        "Cargo.toml": _de_cargo_toml(),
        "tauri.conf.json": _de_tauri_conf(),
        "package.json": _de_package_json(),
        "Cargo.lock": _de_cargo_lock(),
    }
    presentes = {k: v for k, v in declaradas.items() if v is not None}
    assert presentes, "no se pudo leer ninguna version de desktop/"

    distintas = set(presentes.values())
    assert len(distintas) == 1, (
        "la version de la app de escritorio no coincide entre archivos: "
        + ", ".join(f"{k}={v}" for k, v in presentes.items())
    )
