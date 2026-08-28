"""ver_bitacora.py — Lee el historial de ejecuciones y dice QUÉ MEJORAR.

Un registro que nadie lee no sirve de nada. Esto lo convierte en respuestas:

  · ¿En qué etapa se va el tiempo?         → dónde optimizar
  · ¿Esta ejecución fue mejor o peor que la anterior?  → si un cambio sirvió
  · ¿Qué falla más seguido?                → qué arreglar primero

Uso:
    python ver_bitacora.py                  # resumen de las últimas ejecuciones
    python ver_bitacora.py --detalle <id>   # una ejecución completa
    python ver_bitacora.py --comparar       # las dos últimas del mismo pipeline
    python ver_bitacora.py --limite 20
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
except Exception:
    pass


def carpeta_logs() -> Path:
    # Importar `config` es lo que RESUELVE la carpeta de datos: lee
    # `frontend/.env.local` y exporta `VIRAL_DATA_ROOT`. Sin esto, esta función
    # caía a `C:\viral-data\videos` —la carpeta compartida con el proyecto
    # hermano— y decía "Todavía no hay ejecuciones registradas" con el historial
    # entero sano en `D:\viral-data`.
    #
    # Es la trampa documentada del workspace: un script lanzado a mano desde la
    # consola no pasa por `.env.local`. El pipeline nunca la sufrió porque
    # importa `config` por otros motivos; este lector, que no lo hacía, parecía
    # roto mientras escribía bien.
    #
    # Import perezoso a propósito: `config` toca disco al arrancar, y este
    # módulo también se importa desde tests que no quieren ese coste.
    try:
        import config  # noqa: F401,PLC0415  (el efecto es exportar la variable)
    except Exception:  # noqa: BLE001 — sin config igual se intenta con el entorno
        pass

    raiz = os.environ.get("VIRAL_DATA_ROOT")
    base = Path(raiz) if raiz else Path(r"C:\viral-data\videos")
    return base / "logs" / "ejecuciones"


def leer_historial(limite: int) -> list[dict[str, Any]]:
    f = carpeta_logs() / "historial.jsonl"
    if not f.exists():
        return []
    filas: list[dict[str, Any]] = []
    for linea in f.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            filas.append(json.loads(linea))
        except json.JSONDecodeError:
            continue
    return filas[-limite:]


def barra(seg: float, maximo: float, ancho: int = 22) -> str:
    if maximo <= 0:
        return ""
    n = max(1, int(round(seg / maximo * ancho))) if seg > 0 else 0
    return "█" * n


def resumen(limite: int) -> int:
    filas = leer_historial(limite)
    if not filas:
        print("  Todavía no hay ejecuciones registradas.")
        print("  Se escriben solas cada vez que corre un pipeline.")
        return 0

    print(f"\n  ÚLTIMAS {len(filas)} EJECUCIONES\n")
    print(f"  {'fecha':<17} {'pipeline':<10} {'sujeto':<26} {'min':>7}  {'':<3} cuello de botella")
    print("  " + "─" * 92)
    for f in filas:
        marca = "ok " if f.get("ok") else "!! "
        fecha = str(f.get("fecha", ""))[:16].replace("T", " ")
        print(f"  {fecha:<17} {f.get('pipeline',''):<10} {str(f.get('sujeto',''))[:26]:<26} "
              f"{f.get('minutos',0):>7.1f}  {marca} {f.get('cuello') or '-'}")

    # ── Dónde se va el tiempo, sumando todas las ejecuciones ────────────────
    acum: dict[str, float] = {}
    veces: dict[str, int] = {}
    for f in filas:
        for etapa, seg in (f.get("etapas") or {}).items():
            acum[etapa] = acum.get(etapa, 0.0) + float(seg or 0)
            veces[etapa] = veces.get(etapa, 0) + 1
    if acum:
        total = sum(acum.values()) or 1.0
        top = max(acum.values())
        print(f"\n  DÓNDE SE VA EL TIEMPO (suma de {len(filas)} ejecuciones)\n")
        for etapa, seg in sorted(acum.items(), key=lambda kv: kv[1], reverse=True):
            media = seg / max(1, veces[etapa])
            print(f"  {etapa:<24} {seg/60:>7.1f} min  {seg/total*100:>5.1f}%  "
                  f"media {media:>7.1f}s  {barra(seg, top)}")

    # ── Fallos ───────────────────────────────────────────────────────────────
    fallos = [f for f in filas if not f.get("ok")]
    if fallos:
        print(f"\n  EJECUCIONES CON FALLO: {len(fallos)} de {len(filas)}")
        for f in fallos:
            print(f"    {str(f.get('fecha',''))[:16]}  {f.get('sujeto')}  (id {f.get('id')})")
        print("\n  Para ver el detalle:  python ver_bitacora.py --detalle <id>")
    else:
        print(f"\n  Sin fallos en las últimas {len(filas)} ejecuciones.")
    print()
    return 0


def detalle(run_id: str) -> int:
    f = carpeta_logs() / f"{run_id}.json"
    if not f.exists():
        print(f"  No existe el registro {run_id}")
        return 1
    d = json.loads(f.read_text(encoding="utf-8"))
    print(f"\n  {d['pipeline'].upper()} · {d['sujeto']}")
    print(f"  {d['fecha']}  ·  {d['minutos_total']} min  ·  {'ok' if d['ok'] else 'FALLÓ'}")
    if d.get("parametros"):
        print(f"  parámetros: {json.dumps(d['parametros'], ensure_ascii=False)}")
    hw = (d.get("entorno") or {}).get("hw") or {}
    if hw:
        print(f"  entorno: whisper={hw.get('whisper')} ollama={hw.get('ollama')} "
              f"encoder={hw.get('encoder')} workers={hw.get('render_workers')}")

    etapas = d.get("etapas", [])
    if etapas:
        top = max((e["segundos"] for e in etapas), default=1)
        print("\n  ETAPAS\n")
        for e in etapas:
            estado = "saltada" if e.get("saltada") else ("ok" if e.get("ok") else "FALLO")
            print(f"  {e['etapa']:<24} {e['segundos']:>8.1f}s  {estado:<8} {barra(e['segundos'], top)}")
            if e.get("error"):
                print(f"      error: {e['error']}")
            for k, v in (e.get("metricas") or {}).items():
                if isinstance(v, (dict, list)):
                    v = json.dumps(v, ensure_ascii=False)[:120]
                print(f"      {k}: {v}")
    for n in d.get("notas", []):
        print(f"\n  nota: {n}")
    print()
    return 0


def comparar() -> int:
    filas = leer_historial(50)
    if len(filas) < 2:
        print("  Hacen falta al menos dos ejecuciones para comparar.")
        return 0
    ultima = filas[-1]
    previa = next((f for f in reversed(filas[:-1])
                   if f.get("pipeline") == ultima.get("pipeline")), None)
    if not previa:
        print("  No hay una ejecución previa del mismo pipeline con la que comparar.")
        return 0

    print(f"\n  COMPARANDO  {previa['fecha'][:16]}  →  {ultima['fecha'][:16]}")
    print(f"  pipeline: {ultima['pipeline']}\n")
    dif = ultima.get("minutos", 0) - previa.get("minutos", 0)
    signo = "+" if dif >= 0 else ""
    print(f"  total: {previa.get('minutos',0):.1f} min → {ultima.get('minutos',0):.1f} min "
          f"({signo}{dif:.1f} min)\n")

    etapas = sorted(set(list((previa.get('etapas') or {}).keys()) +
                        list((ultima.get('etapas') or {}).keys())))
    print(f"  {'etapa':<24} {'antes':>9} {'ahora':>9} {'cambio':>10}")
    print("  " + "─" * 56)
    for e in etapas:
        a = float((previa.get("etapas") or {}).get(e, 0) or 0)
        b = float((ultima.get("etapas") or {}).get(e, 0) or 0)
        d = b - a
        marca = "  " if abs(d) < 1 else ("↑↑" if d > 0 else "↓↓")
        print(f"  {e:<24} {a:>8.1f}s {b:>8.1f}s {d:>+9.1f}s {marca}")

    # Comparar dos ejecuciones con distinto entorno lleva a conclusiones falsas.
    pa, pb = previa.get("parametros") or {}, ultima.get("parametros") or {}
    if pa != pb:
        print("\n  ATENCIÓN: los parámetros cambiaron entre las dos ejecuciones,")
        print("  así que la diferencia de tiempos no es atribuible solo al código.")
        print(f"    antes: {json.dumps(pa, ensure_ascii=False)}")
        print(f"    ahora: {json.dumps(pb, ensure_ascii=False)}")
    print()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--detalle", help="id de la ejecución a mostrar entera")
    ap.add_argument("--comparar", action="store_true", help="las dos últimas del mismo pipeline")
    ap.add_argument("--limite", type=int, default=12)
    a = ap.parse_args()
    if a.detalle:
        return detalle(a.detalle)
    if a.comparar:
        return comparar()
    return resumen(a.limite)


if __name__ == "__main__":
    raise SystemExit(main())
