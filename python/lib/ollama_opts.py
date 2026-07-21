"""Opciones compartidas para las llamadas a Ollama.

Por qué existe (auditoría 2026-07-20): el tuning de Ollama estaba INCONSISTENTE entre
callers. Sólo `analyze_clips.py` pasaba `keep_alive` + `num_thread`;
`generate_caption.py` tenía `think:False` pero ninguno de los dos, y `adapt_script.py`
/ `highlights.py` no tenían nada. Sin `keep_alive`, el modelo se descarga y recarga
entre llamadas (segundos cada vez, y en una GPU de 6 GB la carga duele).

Este módulo NO cambia prompts ni schemas: sólo centraliza los parámetros de runtime.
"""
from __future__ import annotations

# Cuánto mantener el modelo cargado entre llamadas. El default de Ollama son 5 min;
# en un lote de largos las llamadas se separan más que eso y se pagaba la recarga.
KEEP_ALIVE = "10m"


def num_thread() -> int:
    """Núcleos FÍSICOS para Ollama (`num_thread`), con piso de 4.

    Import lazy de `hw_profile` para no pagar la detección de hardware si nunca se
    llama a Ollama. Si la detección falla por lo que sea, caemos a 4 en vez de
    romper la generación.
    """
    try:
        import hw_profile  # noqa: PLC0415

        cores = int(hw_profile.detect().get("cores_physical") or 0)
    except Exception:  # noqa: BLE001 - la detección nunca debe tumbar una generación
        cores = 0
    return max(4, cores)
