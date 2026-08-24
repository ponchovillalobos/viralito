"""bitacora.py — Deja constancia de CADA ejecución, para poder mejorarla.

El problema que resuelve: hasta ahora el pipeline imprimía mucho por pantalla y
no guardaba nada. Al terminar solo quedaba `elapsed_min`, un número total. Si un
video tardó el doble que el anterior no había forma de saber en qué etapa se fue
el tiempo, ni comparar dos ejecuciones, ni ver si un cambio mejoró o empeoró las
cosas. Cada ejecución empezaba a ciegas.

Qué guarda ahora, por ejecución, en `{DATA_ROOT}/logs/ejecuciones/`:

  · Un JSON por ejecución con las etapas, sus tiempos y sus métricas.
  · Una línea por ejecución en `historial.jsonl`, para comparar entre corridas.
  · El entorno con el que corrió (modelos, hardware) — porque una comparación
    entre dos ejecuciones con distinto modelo no dice nada.

La distinción que gobierna el diseño: los TIEMPOS dicen si algo está optimizado,
pero las MÉTRICAS dicen si está bien hecho. Un corte de clips instantáneo que
produce clips cortados a mitad de frase es peor que uno lento que corta bien.
Por eso cada etapa puede anotar sus propias métricas de calidad, no solo su
duración.

Es BEST-EFFORT: nunca lanza ni bloquea. Si no puede escribir, el pipeline sigue.

Uso:

    from lib.bitacora import Bitacora

    bit = Bitacora("largos", video_id, {"max_clips": 15, "modelo": "qwen3:4b"})
    with bit.etapa("transcribe") as e:
        ...
        e.metrica("palabras", 12045)
        e.metrica("duracion_audio_s", 5933)
    bit.cerrar(ok=True)
"""
from __future__ import annotations

import json
import os
import platform
import sys
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
except Exception:
    pass


def _raiz_logs() -> Path:
    """Carpeta de logs, derivada de DATA_ROOT como el resto del proyecto."""
    raiz = os.environ.get("VIRAL_DATA_ROOT")
    base = Path(raiz) if raiz else Path(r"C:\viral-data\videos")
    return base / "logs" / "ejecuciones"


class _Etapa:
    """Una etapa en curso. Permite anotarle métricas mientras corre."""

    def __init__(self, nombre: str) -> None:
        self.nombre = nombre
        self.inicio = time.time()
        self.fin: float | None = None
        self.ok: bool | None = None
        self.error: str | None = None
        self.saltada = False
        self.metricas: dict[str, Any] = {}

    def metrica(self, clave: str, valor: Any) -> None:
        """Anota un número o dato de CALIDAD de esta etapa.

        No es lo mismo que el tiempo: el tiempo dice si va rápido, la métrica
        dice si lo hizo bien. Ejemplos útiles: cuántos clips propuso, cuántos
        se descartaron por duración, cuántos se anclaron al texto de verdad.
        """
        self.metricas[clave] = valor

    def saltar(self, motivo: str = "") -> None:
        """Marca la etapa como saltada (ya estaba hecha). Cuenta en el historial
        para que un tiempo total bajo no se confunda con una mejora real."""
        self.saltada = True
        if motivo:
            self.metricas["motivo_salto"] = motivo

    @property
    def segundos(self) -> float:
        return round((self.fin or time.time()) - self.inicio, 2)

    def a_dict(self) -> dict[str, Any]:
        return {
            "etapa": self.nombre,
            "segundos": self.segundos,
            "ok": self.ok,
            "saltada": self.saltada,
            **({"error": self.error} if self.error else {}),
            **({"metricas": self.metricas} if self.metricas else {}),
        }


class Bitacora:
    """Registro de una ejecución completa."""

    def __init__(self, pipeline: str, sujeto: str, parametros: dict[str, Any] | None = None) -> None:
        self.pipeline = pipeline
        self.sujeto = sujeto
        self.parametros = parametros or {}
        self.inicio = time.time()
        self.etapas: list[_Etapa] = []
        self.notas: list[str] = []
        self.id = f"{sujeto}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    # ── entorno ──────────────────────────────────────────────────────────────
    def _entorno(self) -> dict[str, Any]:
        """Con qué corrió. Sin esto, comparar dos ejecuciones no dice nada: una
        puede haber usado otro modelo, otra máquina u otra configuración."""
        ent: dict[str, Any] = {
            "python": platform.python_version(),
            "so": f"{platform.system()} {platform.release()}",
        }
        for var in ("VIRAL_OLLAMA_MODEL", "VIRAL_WHISPER_MODEL", "VIRAL_CLIP_PROVIDER",
                    "LF_RENDER_WORKERS", "VIRAL_FORCE_RENDER"):
            v = os.environ.get(var)
            if v:
                ent[var] = v
        # El perfil de hardware ya lo calcula el proyecto: se reusa si está.
        try:
            raiz = os.environ.get("VIRAL_DATA_ROOT")
            base = Path(raiz) if raiz else Path(r"C:\viral-data\videos")
            hw = json.loads((base / "cache" / "hw_profile.json").read_text(encoding="utf-8"))
            rec = hw.get("recommend", {})
            ent["hw"] = {
                "gpu": hw.get("gpu"),
                "cores": hw.get("cores"),
                "whisper": rec.get("whisper_model"),
                "whisper_device": rec.get("whisper_device"),
                "ollama": rec.get("ollama_model"),
                "encoder": rec.get("video_encoder"),
                "render_workers": rec.get("remotion_workers"),
            }
        except Exception:
            pass
        return ent

    # ── etapas ───────────────────────────────────────────────────────────────
    @contextmanager
    def etapa(self, nombre: str) -> Iterator[_Etapa]:
        e = _Etapa(nombre)
        self.etapas.append(e)
        print(f"[bitacora] ▶ {nombre}", file=sys.stderr)
        try:
            yield e
            e.ok = True
        except BaseException as exc:  # noqa: BLE001 — se re-lanza, solo se anota
            e.ok = False
            e.error = f"{type(exc).__name__}: {exc}"[:400]
            raise
        finally:
            e.fin = time.time()
            estado = "saltada" if e.saltada else ("ok" if e.ok else "FALLO")
            extra = ""
            if e.metricas:
                extra = "  ·  " + " · ".join(f"{k}={v}" for k, v in e.metricas.items()
                                             if not isinstance(v, (dict, list)))
            print(f"[bitacora] ◀ {nombre}  {e.segundos}s  {estado}{extra}", file=sys.stderr)

    def nota(self, texto: str) -> None:
        """Algo digno de recordar de esta ejecución, en prosa."""
        self.notas.append(texto)

    # ── cierre ───────────────────────────────────────────────────────────────
    def _resumen(self, ok: bool, extra: dict[str, Any] | None) -> dict[str, Any]:
        total = round(time.time() - self.inicio, 2)
        etapas = [e.a_dict() for e in self.etapas]
        # La etapa que más tiempo se llevó: es la respuesta a "¿qué optimizo?"
        candidatas = [e for e in self.etapas if not e.saltada]
        cuello = max(candidatas, key=lambda e: e.segundos).nombre if candidatas else None
        return {
            "id": self.id,
            "pipeline": self.pipeline,
            "sujeto": self.sujeto,
            "fecha": datetime.now().isoformat(timespec="seconds"),
            "ok": ok,
            "segundos_total": total,
            "minutos_total": round(total / 60, 2),
            "cuello_de_botella": cuello,
            "parametros": self.parametros,
            "entorno": self._entorno(),
            "etapas": etapas,
            **({"notas": self.notas} if self.notas else {}),
            **(extra or {}),
        }

    def cerrar(self, ok: bool = True, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        """Escribe el registro. Devuelve el resumen (útil para imprimirlo)."""
        resumen = self._resumen(ok, extra)
        try:
            carpeta = _raiz_logs()
            carpeta.mkdir(parents=True, exist_ok=True)

            # 1) El detalle completo de ESTA ejecución.
            (carpeta / f"{self.id}.json").write_text(
                json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            # 2) Una línea en el historial, para comparar entre ejecuciones sin
            #    tener que abrir veinte archivos.
            linea = {
                "fecha": resumen["fecha"],
                "id": self.id,
                "pipeline": self.pipeline,
                "sujeto": self.sujeto,
                "ok": ok,
                "minutos": resumen["minutos_total"],
                "cuello": resumen["cuello_de_botella"],
                "etapas": {e["etapa"]: e["segundos"] for e in etapas_de(resumen)},
                "parametros": self.parametros,
            }
            with (carpeta / "historial.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(linea, ensure_ascii=False) + "\n")

            print(f"[bitacora] registro → {carpeta / (self.id + '.json')}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 — nunca romper el pipeline por el log
            print(f"[bitacora] no se pudo escribir el registro: {exc}", file=sys.stderr)
        return resumen


def etapas_de(resumen: dict[str, Any]) -> list[dict[str, Any]]:
    return resumen.get("etapas", [])
