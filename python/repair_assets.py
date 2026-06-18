"""Self-heal de UNA librería de assets: la re-descarga en background si falta o
quedó corta en runtime.

Lo invocan las rutas de stream (music/sfx/lottie) cuando detectan que una
carpeta tiene menos archivos que el mínimo esperado: disparan
`python repair_assets.py <lib>` SIN bloquear, y este script re-baja SÓLO esa
librería llamando internamente al download_*_library.py correspondiente con los
MISMOS args que usa setup_all.py (idempotente: los downloaders saltan lo que ya
existe).

Uso:  python repair_assets.py music|sfx|lottie|icons|illustrations

Idempotencia: antes de empezar crea un lockfile en
{DATA_ROOT}/cache/repair-<lib>.lock. Si ya hay uno reciente (<15 min) asume que
otra corrida está en curso, no hace nada y sale con 0. El lock se borra siempre
al terminar (finally).
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

from config import ASSETS_MUSIC, DATA_ROOT, ensure_dirs

HERE = Path(__file__).resolve().parent
PY = sys.executable
ASSETS_SFX = DATA_ROOT / "assets" / "sfx"

LIBS = ("music", "sfx", "lottie", "icons", "illustrations")

# Cuánto vale un lock antes de considerarlo "viejo" (corrida abandonada/colgada).
LOCK_TTL_SECONDS = 15 * 60


def _commands(lib: str) -> list[list[str]]:
    """Devuelve la lista de comandos (cada uno = lista de args para PY) a correr
    para reparar `lib`. Copiados EXACTAMENTE de setup_all.py para mantener sync."""
    if lib == "music":
        return [
            ["download_music_library.py", "download", "--out-dir", str(ASSETS_MUSIC / "github"), "--chosic", "30"],
        ]
    if lib == "sfx":
        return [
            ["download_sfx_library.py", "download", "--out-dir", str(ASSETS_SFX / "github")],
            # SFX sintéticos curados (typewriter.wav / film_reel.wav): síntesis local,
            # van a curated/. Idempotente: synth_sfx salta los que ya existen. Sin esto
            # el repair de sfx nunca repondría estos .wav (ningún downloader los baja).
            ["synth_sfx.py", "curated-wav", "--out-dir", str(ASSETS_SFX / "curated")],
        ]
    if lib == "lottie":
        # Dos modos NO acumulativos: sin --all = set curado por concepto; con --all
        # = catálogo completo. setup_all corre ambos, así que acá igual.
        return [
            ["download_animated_icons.py"],
            ["download_animated_icons.py", "--all"],
        ]
    if lib == "icons":
        # IMPORTANTE: hay DOS descargadores de iconos y setup_all corre ambos.
        # download_editorial_icons.py = Phosphor + Tabler (~6.000 svg).
        # download_more_icons.py      = Material Symbols + Lucide (~5.300 svg).
        # Antes el repair solo corría el primero → Material/Lucide nunca se
        # re-descargaban y el set quedaba a medias. Ahora corre los dos (idempotentes).
        return [
            ["download_editorial_icons.py"],
            ["download_more_icons.py"],
        ]
    if lib == "illustrations":
        # Ilustraciones de personas CC0 (Open Doodles + Open Peeps). Idempotente:
        # el downloader salta los sets que ya están completos.
        return [
            ["download_illustrations.py"],
        ]
    raise ValueError(f"librería desconocida: {lib!r} (válidas: {', '.join(LIBS)})")


def _lock_path(lib: str) -> Path:
    return DATA_ROOT / "cache" / f"repair-{lib}.lock"


def _lock_fresco(lock: Path) -> bool:
    """¿El lock existe y es reciente (< TTL)?"""
    try:
        edad = time.time() - lock.stat().st_mtime
        return edad < LOCK_TTL_SECONDS
    except OSError:
        return False


def _run_download(args: list[str]) -> bool:
    """Corre un download_*.py. Devuelve True si rc==0."""
    print(f"[repair] corriendo: {' '.join(args)}", flush=True)
    try:
        r = subprocess.run(
            [PY, *args], cwd=str(HERE), capture_output=True, text=True, timeout=3600
        )
        if r.returncode == 0:
            print(f"[repair] OK: {args[0]}", flush=True)
            return True
        tail = (r.stderr or "").strip()[-300:]
        print(f"[repair] {args[0]} no terminó (rc={r.returncode}): {tail}", flush=True)
    except Exception as e:
        print(f"[repair] {args[0]} error: {e}", flush=True)
    return False


def reparar(lib: str) -> int:
    if lib not in LIBS:
        print(f"[repair] librería inválida: {lib!r}. Válidas: {', '.join(LIBS)}", flush=True)
        return 2

    ensure_dirs()
    cache_dir = DATA_ROOT / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    lock = _lock_path(lib)

    if _lock_fresco(lock):
        print(f"[repair] ya hay una reparación de '{lib}' en curso (lock reciente) — no hago nada.", flush=True)
        return 0

    # Crea/refresca el lock.
    try:
        lock.write_text(str(time.time()), encoding="utf-8")
    except OSError as e:
        print(f"[repair] no pude crear el lock {lock}: {e}", flush=True)
        # Sin lock igual intentamos reparar (mejor reparar que no).

    try:
        print(f"[repair] re-descargando librería '{lib}'...", flush=True)
        todo_ok = True
        for cmd in _commands(lib):
            if not _run_download(cmd):
                todo_ok = False
        if todo_ok:
            print(f"[repair] librería '{lib}' reparada.", flush=True)
            return 0
        print(f"[repair] librería '{lib}' reparada parcialmente (alguna descarga falló).", flush=True)
        return 1
    finally:
        try:
            lock.unlink()
        except OSError:
            pass


def main() -> int:
    if len(sys.argv) < 2:
        print(f"[repair] falta el nombre de la librería. Uso: python repair_assets.py {'|'.join(LIBS)}", flush=True)
        return 2
    return reparar(sys.argv[1].strip().lower())


if __name__ == "__main__":
    sys.exit(main())
