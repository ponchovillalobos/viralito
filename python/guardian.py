"""guardian.py — Encuentra y limpia procesos huérfanos del pipeline.

El problema: un render abortado, una consola cerrada a lo bruto o un pipeline
interrumpido dejan vivos procesos de Chromium, ffmpeg y Node que siguen
ocupando GB de RAM. Nadie los mata porque su padre ya no existe para hacerlo, y
se acumulan hasta que la máquina se arrastra — justo cuando querés renderizar.

LA REGLA QUE GOBIERNA ESTE SCRIPT: no matar nada que esté trabajando.
Un proceso que consume CPU está haciendo algo, aunque su padre haya muerto.
Matar un render en curso por "limpiar" es peor que dejar RAM ocupada. Por eso
cada candidato pasa tres filtros antes de tocarlo:

  1) ¿Es de los nuestros?   — solo Chromium de Remotion, ffmpeg y Node del proyecto
  2) ¿Está huérfano?        — su proceso padre ya no existe
  3) ¿Está ocioso?          — no consume CPU en una ventana de muestreo

Además nunca toca el servidor que sirve el dashboard: se identifica por el
puerto que escucha, no por su nombre.

Uso:
    python guardian.py                 # informa, no toca nada
    python guardian.py --limpiar       # mata solo lo que pasa los tres filtros
    python guardian.py --limpiar --incluir-ocupados   # también los que trabajan
                                       (para cuando SABES que abortaste algo)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
except Exception:
    pass

# Procesos que este proyecto lanza y que pueden quedarse colgados.
NOMBRES = ("remotion.exe", "chrome.exe", "ffmpeg.exe", "ffprobe.exe", "node.exe")

# Firmas que confirman que un proceso es NUESTRO y no del sistema o de otra app.
# Sin esto, "chrome.exe" mataría el navegador del usuario.
FIRMAS = ("viralito", "remotion", "viral-data", "\\python\\", "render-server")

VENTANA_CPU_S = 5.0   # cuánto se observa antes de declarar a un proceso ocioso
UMBRAL_CPU_S = 0.3    # CPU consumida en esa ventana para considerarlo "trabajando"


def _ps(comando: list[str]) -> str:
    """Ejecuta PowerShell y devuelve su stdout."""
    r = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", " ".join(comando)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
    )
    return r.stdout or ""


def puertos_protegidos() -> set[int]:
    """PIDs que sirven el dashboard. Se identifican por PUERTO, no por nombre:
    matar el servidor del usuario mientras trabaja sería el peor daño posible."""
    salida = _ps([
        "$r=@();",
        "foreach($p in 3000,3001,3100){",
        "$c=Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue;",
        "if($c){$r+=$c.OwningProcess}};",
        "$r | ConvertTo-Json -Compress",
    ])
    try:
        d = json.loads(salida.strip() or "[]")
        return {int(x) for x in (d if isinstance(d, list) else [d])}
    except Exception:
        return set()


def inventario() -> list[dict[str, Any]]:
    """Procesos candidatos, con su padre, RAM y CPU acumulada."""
    filtro = " OR ".join(f"Name='{n}'" for n in NOMBRES)
    salida = _ps([
        f"Get-CimInstance Win32_Process -Filter \"{filtro}\" |",
        "Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize |",
        "ConvertTo-Json -Depth 2 -Compress",
    ])
    try:
        d = json.loads(salida.strip() or "[]")
    except Exception:
        return []
    return d if isinstance(d, list) else [d]


def vivos(pids: set[int]) -> set[int]:
    if not pids:
        return set()
    lista = ",".join(str(p) for p in pids)
    salida = _ps([f"Get-Process -Id {lista} -EA SilentlyContinue |",
                  "Select-Object -ExpandProperty Id | ConvertTo-Json -Compress"])
    try:
        d = json.loads(salida.strip() or "[]")
        return {int(x) for x in (d if isinstance(d, list) else [d])}
    except Exception:
        return set()


def cpu_de(pids: list[int]) -> dict[int, float]:
    if not pids:
        return {}
    lista = ",".join(str(p) for p in pids)
    salida = _ps([f"Get-Process -Id {lista} -EA SilentlyContinue |",
                  "Select-Object Id,CPU | ConvertTo-Json -Compress"])
    try:
        d = json.loads(salida.strip() or "[]")
        filas = d if isinstance(d, list) else [d]
        return {int(f["Id"]): float(f.get("CPU") or 0) for f in filas}
    except Exception:
        return {}


def es_nuestro(p: dict[str, Any]) -> bool:
    cmd = (p.get("CommandLine") or "").lower()
    return any(f in cmd for f in FIRMAS)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limpiar", action="store_true", help="mata lo que pasa los filtros")
    ap.add_argument("--incluir-ocupados", action="store_true",
                    help="mata también los que consumen CPU (solo si sabes que abortaste algo)")
    args = ap.parse_args()

    protegidos = puertos_protegidos()
    todos = inventario()
    if protegidos:
        print(f"  protegidos (sirven el dashboard): {sorted(protegidos)}")

    nuestros = [p for p in todos if es_nuestro(p) and int(p["ProcessId"]) not in protegidos]
    if not nuestros:
        print("  No hay procesos del proyecto fuera del dashboard. Todo limpio.")
        return 0

    padres = {int(p["ParentProcessId"]) for p in nuestros}
    padres_vivos = vivos(padres)

    # Los huérfanos son los candidatos; los demás tienen quien los gestione.
    candidatos = [p for p in nuestros if int(p["ParentProcessId"]) not in padres_vivos]
    con_padre = len(nuestros) - len(candidatos)

    print(f"\n  {len(nuestros)} proceso(s) del proyecto · {con_padre} con padre vivo · "
          f"{len(candidatos)} huérfano(s)")

    if not candidatos:
        print("  Ningún huérfano. Nada que limpiar.\n")
        return 0

    # Tercer filtro: ¿trabajan? Se mide, no se supone.
    pids = [int(p["ProcessId"]) for p in candidatos]
    antes = cpu_de(pids)
    print(f"  midiendo actividad durante {VENTANA_CPU_S:.0f}s...")
    time.sleep(VENTANA_CPU_S)
    despues = cpu_de(pids)

    ociosos, ocupados = [], []
    for p in candidatos:
        pid = int(p["ProcessId"])
        delta = despues.get(pid, 0) - antes.get(pid, 0)
        p["_cpu_delta"] = round(delta, 2)
        p["_ram_gb"] = round(int(p.get("WorkingSetSize") or 0) / (1024 ** 3), 2)
        (ocupados if delta > UMBRAL_CPU_S else ociosos).append(p)

    print()
    for p in ociosos:
        print(f"  OCIOSO    {p['Name']:<13} pid {p['ProcessId']:<7} "
              f"{p['_ram_gb']:>5.2f} GB   sin actividad")
    for p in ocupados:
        print(f"  TRABAJA   {p['Name']:<13} pid {p['ProcessId']:<7} "
              f"{p['_ram_gb']:>5.2f} GB   {p['_cpu_delta']}s de CPU  ← NO se toca")

    a_matar = ociosos + (ocupados if args.incluir_ocupados else [])
    liberables = round(sum(p["_ram_gb"] for p in a_matar), 2)

    if not args.limpiar:
        print(f"\n  Se liberarían {liberables} GB matando {len(a_matar)} proceso(s).")
        print("  Esto solo informa. Para hacerlo: python guardian.py --limpiar\n")
        return 0

    matados = 0
    for p in a_matar:
        pid = int(p["ProcessId"])
        # /T mata el árbol: Chromium y ffmpeg cuelgan hijos propios.
        r = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True, text=True)
        if r.returncode == 0:
            matados += 1
            print(f"  matado {p['Name']} pid {pid} ({p['_ram_gb']} GB)")
        else:
            print(f"  no se pudo matar pid {pid}: {(r.stderr or '').strip()[:90]}")

    print(f"\n  {matados} proceso(s) eliminados · ~{liberables} GB liberados\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
