"""Runner de subprocesos con TIMEOUT OBLIGATORIO.

Por qué existe (auditoría 2026-07-20): 16 de 42 llamadas a `subprocess` del
proyecto corrían SIN timeout, incluidas las del pool de render y las etapas
centrales de `long_form_pipeline.py`. Si un ffmpeg o un Remotion se colgaba —cosa
que pasa: driver que se cae, archivo corrupto, Chromium que no cierra— el pipeline
esperaba PARA SIEMPRE, sin diagnóstico. Ése es el mecanismo exacto del síntoma que
reportó el usuario ("la app dejó de responder").

Un timeout generoso pero FINITO convierte un cuelgue infinito en un job fallido con
mensaje claro, que la cola puede reportar y el usuario puede reintentar.

Los valores son deliberadamente holgados: la meta NO es cortar trabajo legítimo, es
poner un techo. Todos se pueden subir por variable de entorno si alguien procesa
material extremo.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _env_secs(name: str, default: float) -> float:
    """Lee un timeout de entorno; si es basura o <= 0, usa el default."""
    try:
        v = float(os.environ.get(name, ""))
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


# Sondas instantáneas (ffprobe, nvidia-smi, `--version`). Si tardan más que esto,
# algo está muy mal (disco colgado, binario que abre un diálogo).
PROBE_TIMEOUT = _env_secs("VIRAL_PROBE_TIMEOUT", 120.0)

# Transformaciones de video acotadas: cortar silencios, extraer un clip, concat.
# Una hora es muchísimo para estas operaciones incluso en material largo.
FFMPEG_TIMEOUT = _env_secs("VIRAL_FFMPEG_TIMEOUT", 3600.0)

# Etapas pesadas: transcribir un video de horas, analizar con LLM, renderizar con
# Remotion. 6 h es un techo absurdo a propósito — sólo ataja el cuelgue infinito.
STEP_TIMEOUT = _env_secs("VIRAL_STEP_TIMEOUT", 21600.0)


class StepTimeout(RuntimeError):
    """Un subproceso excedió su techo de tiempo. Mensaje pensado para el usuario."""


def _fmt(cmd: list[str]) -> str:
    return " ".join(str(x) for x in cmd)


def _hhmm(secs: float) -> str:
    if secs < 60:
        return f"{secs:g} s"
    m = int(secs // 60)
    return f"{m} min" if m < 60 else f"{m // 60} h {m % 60} min"


def run(
    cmd: list[str],
    *,
    timeout: float = STEP_TIMEOUT,
    cwd: Path | str | None = None,
    check: bool = True,
    **kwargs,
) -> subprocess.CompletedProcess:
    """`subprocess.run` con timeout obligatorio y error legible.

    Traduce `TimeoutExpired` a `StepTimeout` con un mensaje que dice QUÉ se colgó y
    por cuánto esperamos, en vez del traceback críptico de subprocess. Mata el hijo
    antes de propagar (subprocess.run ya lo hace, pero lo dejamos explícito en el
    mensaje para que quede claro en el log).
    """
    try:
        return subprocess.run(cmd, timeout=timeout, cwd=cwd, check=check, **kwargs)
    except subprocess.TimeoutExpired as e:
        raise StepTimeout(
            f"El paso se colgó: no terminó en {_hhmm(timeout)} y se canceló.\n"
            f"Comando: {_fmt(cmd)}\n"
            f"Si tu material es MUY largo y esto fue un corte injusto, subí el techo "
            f"con la variable de entorno correspondiente (VIRAL_STEP_TIMEOUT / "
            f"VIRAL_FFMPEG_TIMEOUT / VIRAL_PROBE_TIMEOUT, en segundos)."
        ) from e


def run_capture(
    cmd: list[str],
    *,
    timeout: float = STEP_TIMEOUT,
    cwd: Path | str | None = None,
    check: bool = True,
    **kwargs,
) -> subprocess.CompletedProcess:
    """Igual que `run` pero capturando stdout/stderr como texto UTF-8.

    `encoding="utf-8"` + `errors="replace"` explícitos: en Windows el default es
    cp1252 y un carácter fuera de esa tabla en el stderr de ffmpeg reventaba con
    UnicodeDecodeError (se ve en los warnings de la suite de tests).
    """
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("text", True)
    kwargs.setdefault("encoding", "utf-8")
    kwargs.setdefault("errors", "replace")
    return run(cmd, timeout=timeout, cwd=cwd, check=check, **kwargs)


def probe(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Sonda corta (ffprobe/nvidia-smi). No lanza por returncode: el caller decide."""
    kwargs.setdefault("check", False)
    return run_capture(cmd, timeout=PROBE_TIMEOUT, **kwargs)


def warn_timeout(e: StepTimeout) -> None:
    """Imprime el timeout a stderr con el prefijo que ya usa el pipeline."""
    print(f"[timeout] {e}", file=sys.stderr)
