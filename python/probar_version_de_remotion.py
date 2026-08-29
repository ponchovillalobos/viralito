"""Compara el render de DOS versiones de Remotion sobre el MISMO clip.

POR QUE EXISTE

El proyecto tiene una regla dura: todos los paquetes `remotion`/`@remotion/*`
pineados a la misma version exacta, y para subirla hay que cambiarlas todas
juntas y verificar con render + PSNR. Mezclar versiones ya rompio renders antes.

La regla dice "verificar con render + PSNR" y no habia con que hacerlo. Esto es
eso: renderiza el mismo clip con el arbol de produccion y con un arbol de
prueba que tiene la version nueva, y compara fotograma a fotograma.

COMO SE LEE EL RESULTADO

El render de Remotion NO es determinista: dos corridas de la MISMA version sobre
el mismo clip no dan archivos identicos. Por eso un PSNR alto entre versiones no
significa nada por si solo -- hay que saber cuanto ruido mete el motor contra si
mismo.

Asi que se miden TRES renders:

    A1, A2  con la version vieja      -> el control
    B       con la version nueva

y se comparan `PSNR(A1,B)` contra `PSNR(A1,A2)`. Si la diferencia que introduce
la version nueva es MENOR que la que el motor introduce contra si mismo, la
version nueva no cambia el resultado de forma observable.

Esa es la misma forma de leerlo que uso `probar_paridad_gl.py` para decidir
encender la aceleracion por placa, y es la unica honesta: sin el control, un
PSNR de 40 dB puede leerse como "casi identico" o como "cambio todo", segun lo
que uno quiera creer.

USO

  python probar_version_de_remotion.py --props <props.json> \\
      --arbol-nuevo D:\\viral-data\\_prueba_remotion_518

El props sale de una corrida real: `build-clip-props.mjs` lo deja en la carpeta
de remotion durante el render y lo borra al terminar, asi que conviene copiarlo
antes o generarlo a mano.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent
REMOTION_DIR = PYTHON_DIR.parent / "remotion"


def _render(arbol: Path, props_json: Path, salida: Path, concurrencia: int) -> float:
    """Renderiza en el arbol indicado y devuelve los segundos que tardo."""
    entorno = dict(os.environ)
    cmd = [
        "npx", "remotion", "render", "src/index.ts", "ViralVideo", str(salida),
        f"--props={props_json}", "--log=error",
        # Los MISMOS ajustes del pipeline real: una medicion con otros ajustes
        # mide otra cosa.
        "--timeout=120000",
        "--disable-web-security",
        "--offthreadvideo-cache-size-in-bytes=4294967296",
        "--concurrency", str(concurrencia),
        "--gl=angle",
    ]
    if sys.platform == "win32":
        cmd[0] = "npx.cmd"

    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(arbol), env=entorno, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=7200)
    if r.returncode != 0 or not salida.exists():
        lineas = [l.rstrip() for l in (r.stderr or "").splitlines() if l.strip()]
        motivo = [l for l in lineas if not l.lstrip().startswith("at ")]
        cola = motivo[:8] if motivo else lineas[-10:]
        raise RuntimeError(f"el render en {arbol.name} fallo:\n" + "\n".join(cola))
    return time.time() - t0


def _psnr(a: Path, b: Path) -> dict:
    """PSNR entre dos videos. Mismo filtro de ffmpeg que usa probar_paridad_gl."""
    from config import FFMPEG_PATH

    r = subprocess.run(
        [str(FFMPEG_PATH), "-hide_banner", "-i", str(a), "-i", str(b),
         "-lavfi", "psnr", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=3600,
    )
    texto = (r.stderr or "") + (r.stdout or "")
    medio = re.search(r"average:([0-9.]+|inf)", texto)
    minimo = re.search(r"min:([0-9.]+|inf)", texto)

    def num(m):
        if not m:
            return None
        return float("inf") if m.group(1) == "inf" else float(m.group(1))

    return {"medio": num(medio), "minimo": num(minimo)}


def _tam(p: Path) -> str:
    return f"{p.stat().st_size / 1_048_576:.1f} MB" if p.exists() else "-"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Compara dos versiones de Remotion sobre el mismo clip"
    )
    ap.add_argument("--props", type=Path, required=True,
                    help="props.json de un clip real")
    ap.add_argument("--arbol-nuevo", type=Path, required=True,
                    help="carpeta remotion con la version nueva instalada")
    ap.add_argument("--salida", type=Path, default=None,
                    help="donde dejar los mp4 de la prueba")
    ap.add_argument("--concurrencia", type=int, default=2,
                    help="baja a proposito: la prueba no debe competir con lo "
                         "que este renderizando (default: 2)")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    args = ap.parse_args()

    props = args.props.resolve()
    if not props.exists():
        print(f"no existe el props: {props}", file=sys.stderr)
        return 1
    nuevo = args.arbol_nuevo.resolve()
    if not (nuevo / "node_modules" / "remotion").exists():
        print(f"el arbol nuevo no tiene remotion instalado: {nuevo}", file=sys.stderr)
        return 1

    def version(arbol: Path) -> str:
        try:
            return json.loads(
                (arbol / "node_modules" / "remotion" / "package.json").read_text(
                    encoding="utf-8"
                )
            )["version"]
        except Exception:  # noqa: BLE001
            return "?"

    v_vieja, v_nueva = version(REMOTION_DIR), version(nuevo)

    dest = (args.salida or Path(os.environ.get("TEMP", ".")) / "prueba_version").resolve()
    dest.mkdir(parents=True, exist_ok=True)
    a1, a2, b = dest / "vieja_1.mp4", dest / "vieja_2.mp4", dest / "nueva.mp4"
    for f in (a1, a2, b):
        f.unlink(missing_ok=True)

    if not args.json:
        print(f"  version actual : {v_vieja}")
        print(f"  version nueva  : {v_nueva}")
        print(f"  props          : {props.name}")
        print(f"  concurrencia   : {args.concurrencia}")
        print()

    # DOS con la vieja: el control. Sin el no hay con que comparar el PSNR.
    t_a1 = _render(REMOTION_DIR, props, a1, args.concurrencia)
    if not args.json:
        print(f"  {v_vieja} (1/2)  {t_a1:7.1f} s   {_tam(a1)}")
    t_a2 = _render(REMOTION_DIR, props, a2, args.concurrencia)
    if not args.json:
        print(f"  {v_vieja} (2/2)  {t_a2:7.1f} s   {_tam(a2)}")
    t_b = _render(nuevo, props, b, args.concurrencia)
    if not args.json:
        print(f"  {v_nueva}        {t_b:7.1f} s   {_tam(b)}")

    control = _psnr(a1, a2)
    entre = _psnr(a1, b)

    # El criterio. La version nueva es aceptable si la diferencia que introduce
    # NO se distingue del ruido propio del motor.
    c_min = control["minimo"]
    e_min = entre["minimo"]
    inf = float("inf")
    apto = (
        e_min is not None
        and c_min is not None
        and (e_min == inf or c_min == inf or e_min >= c_min - 3.0)
    )

    resultado = {
        "version_actual": v_vieja,
        "version_nueva": v_nueva,
        "segundos": {"actual_1": round(t_a1, 1), "actual_2": round(t_a2, 1),
                     "nueva": round(t_b, 1)},
        "psnr_control_vieja_vs_vieja": control,
        "psnr_vieja_vs_nueva": entre,
        "apto": bool(apto),
    }

    if args.json:
        print(json.dumps(resultado, indent=2, default=str))
        return 0 if apto else 2

    def d(x):
        return "infinito (identicos)" if x == inf else (f"{x:.2f} dB" if x else "?")

    print()
    print(f"  control  {v_vieja} vs {v_vieja}:  medio {d(control['medio'])}  "
          f"minimo {d(c_min)}")
    print(f"  prueba   {v_vieja} vs {v_nueva}:  medio {d(entre['medio'])}  "
          f"minimo {d(e_min)}")
    print()
    if apto:
        print("  APTO. La diferencia que introduce la version nueva no se")
        print("  distingue del ruido que el motor mete contra si mismo.")
    else:
        print("  NO APTO. La version nueva cambia el resultado MAS de lo que el")
        print("  motor varia contra si mismo: hay una diferencia real que")
        print("  conviene mirar cuadro a cuadro antes de subir.")
    print(f"\n  los mp4 quedaron en {dest}")
    return 0 if apto else 2


if __name__ == "__main__":
    sys.exit(main())
