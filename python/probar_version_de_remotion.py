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


def _psnr(a: Path, b: Path, registro: Path | None = None) -> dict:
    """PSNR entre dos videos. Mismo filtro de ffmpeg que usa probar_paridad_gl.

    Con `registro` guarda el detalle POR FOTOGRAMA, que es lo unico que permite
    saber que clase de diferencia es. Ver `_reparto`.
    """
    from config import FFMPEG_PATH

    filtro = "psnr" if registro is None else f"psnr=stats_file={registro.name}"
    r = subprocess.run(
        [str(FFMPEG_PATH), "-hide_banner", "-i", str(a), "-i", str(b),
         "-lavfi", filtro, "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=3600,
        cwd=str(registro.parent) if registro is not None else None,
    )
    texto = (r.stderr or "") + (r.stdout or "")
    medio = re.search(r"average:([0-9.]+|inf)", texto)
    minimo = re.search(r"min:([0-9.]+|inf)", texto)

    def num(m):
        if not m:
            return None
        return float("inf") if m.group(1) == "inf" else float(m.group(1))

    return {"medio": num(medio), "minimo": num(minimo)}


def _reparto(registro: Path) -> dict:
    """Como se REPARTE la diferencia entre los fotogramas.

    El promedio y el minimo no distinguen dos situaciones muy distintas:

      - El diseno cambio. Casi todos los fotogramas difieren un poco.
      - El video de archivo cayo en otro cuadro. La mayoria son identicos o
        casi, y un punado difiere mucho -- los de movimiento rapido.

    La segunda paso de verdad al probar 4.0.518: el diseno salio pixel a pixel
    igual (tipografia, colores, panel, vineta) y lo unico que cambio fue en que
    fotograma del B-roll caia cada instante, en rafagas de 3 de cada 5. Eso es
    remuestreo de fps, no una regresion visual -- pero el minimo de 18.73 dB,
    solo, se lee como si el render se hubiera roto.

    Sin este reparto hay que ir a extraer fotogramas a mano para saber cual de
    las dos es. Que es lo que hubo que hacer la primera vez.
    """
    identicos = casi = distintos = 0
    tramos: list[int] = []
    for linea in registro.read_text(encoding="utf-8", errors="replace").splitlines():
        n = re.search(r"^n:(\d+)", linea)
        p = re.search(r"psnr_avg:(inf|[0-9.]+)", linea)
        if not (n and p):
            continue
        if p.group(1) == "inf":
            identicos += 1
        elif float(p.group(1)) < 30.0:
            distintos += 1
            tramos.append(int(n.group(1)))
        else:
            casi += 1
    total = identicos + casi + distintos
    return {
        "fotogramas": total,
        "identicos": identicos,
        "casi_iguales": casi,
        "distintos": distintos,
        "pct_distintos": round(distintos * 100 / total, 1) if total else 0.0,
        "primeros_distintos": tramos[:12],
    }


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

    control = _psnr(a1, a2, dest / "psnr_control.log")
    entre = _psnr(a1, b, dest / "psnr_versiones.log")
    reparto = _reparto(dest / "psnr_versiones.log")

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
        "reparto": reparto,
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
    print(f"  reparto de los {reparto['fotogramas']} fotogramas:")
    print(f"    identicos            {reparto['identicos']:5}")
    print(f"    casi iguales (>=30)  {reparto['casi_iguales']:5}")
    print(f"    distintos    (< 30)  {reparto['distintos']:5}   "
          f"{reparto['pct_distintos']}%")
    if reparto["primeros_distintos"]:
        print(f"    primeros distintos: "
              f"{reparto['primeros_distintos']}")

    print()
    if apto:
        print("  APTO. La diferencia que introduce la version nueva no se")
        print("  distingue del ruido que el motor mete contra si mismo.")
    else:
        print("  NO APTO POR EL NUMERO. Hay que MIRAR antes de decidir: el PSNR")
        print("  solo no distingue un diseno que cambio de un video de archivo")
        print("  que cayo en otro cuadro.")
        print()
        if reparto["pct_distintos"] <= 15:
            print(f"  Y el reparto sugiere lo segundo: solo "
                  f"{reparto['pct_distintos']}% de los fotogramas difieren de")
            print("  verdad. Cuando cambia el DISENO difieren casi todos. Extrae")
            print("  uno de los fotogramas de arriba de los dos mp4 y comparalos:")
            print("  si el texto, los colores y las cajas estan en el mismo sitio")
            print("  y solo cambio el video de adentro, es remuestreo de fps.")
        else:
            print(f"  Y el reparto lo confirma: {reparto['pct_distintos']}% de los")
            print("  fotogramas difieren. Eso ya no es un cuadro corrido, es el")
            print("  render dibujando distinto.")
    print(f"\n  los mp4 quedaron en {dest}")
    return 0 if apto else 2


if __name__ == "__main__":
    sys.exit(main())
