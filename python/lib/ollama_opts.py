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


def liberar(modelo: str | None = None, url: str | None = None) -> bool:
    """Le pide a Ollama que suelte el modelo de la VRAM. Devuelve si lo logró.

    `KEEP_ALIVE` deja el modelo cargado diez minutos después de la última llamada,
    y eso es lo correcto MIENTRAS se analiza: entre clip y clip la recarga cuesta
    segundos y en una GPU de 6 GB duele. El problema es el después. Nadie le decía
    que lo soltara al terminar esa etapa, así que el render arrancaba con la
    memoria todavía tomada por un modelo que ya no se iba a usar.

    Medido en esta máquina al terminar un lote de largos: Ollama retenía 4718 MB
    de 6144 y dejaba 1279 MB libres — menos de lo que necesita `large-v3` para
    transcribir (~2.4 GB). El pipeline no se rompía porque transcribe ANTES de
    analizar, pero cualquier cosa que quisiera GPU después chocaba contra un
    modelo dormido.

    Pedir `keep_alive: 0` con un prompt vacío es la forma documentada de
    descargarlo. Es best-effort: si Ollama no está, ya se descargó, o responde
    cualquier otra cosa, no pasa nada — se pierde memoria libre, no trabajo.
    """
    import json  # noqa: PLC0415
    import urllib.error  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415

    try:
        from config import OLLAMA_MODEL, OLLAMA_URL  # noqa: PLC0415
    except ImportError:
        return False

    cuerpo = json.dumps({
        "model": modelo or OLLAMA_MODEL,
        "keep_alive": 0,
    }).encode("utf-8")
    peticion = urllib.request.Request(
        f"{(url or OLLAMA_URL).rstrip('/')}/api/generate",
        data=cuerpo,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(peticion, timeout=30):
            return True
    except (urllib.error.URLError, OSError, TimeoutError):
        return False
