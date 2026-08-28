"""Ningún subproceso que capture TEXTO puede depender de la codificación local.

El bug, reproducido en esta máquina y no hipotético:

    locale.getpreferredencoding() → cp1252

`config.py` fuerza UTF-8 en stdout/stderr de todo script que lo importa, con un
comentario que explica exactamente por qué: cuando Node lanza Python, la salida
en cp1252 rompe el JSON con acentos. Ese razonamiento resuelve Node→Python. Nadie
lo aplicó a Python→Python.

Cuando un script de este proyecto captura la salida de OTRO con
`subprocess.run(capture_output=True, text=True)` sin `encoding=`, el PADRE
decodifica en cp1252 mientras el HIJO escribió UTF-8. El hilo lector muere con
`UnicodeDecodeError: byte 0x81` y `stdout` queda en **None** — con returncode 0.

Medido antes del arreglo, 5 de 5 corridas:

    r = subprocess.run([py, "transcribe.py", "--help"], capture_output=True, text=True)
    r.returncode  → 0
    r.stdout      → None

Y no se queda en perder el diagnóstico. Cuatro sitios hacían `.stderr[-400:]`
sobre ese None: `TypeError: 'NoneType' object is not subscriptable`, sin `except`
alrededor. Uno de ellos, en `extract_clips.py`, tumbaba el script entero — y
justo en el camino que existe para REPORTAR un fallo de transcripción. La línea
siguiente afirmaba «el pipeline NUNCA se rompe por esto». Se rompía.

Una llamada sin `text=True` devuelve bytes y no decodifica nada: ésas no corren
riesgo y el test las deja pasar.
"""
from __future__ import annotations

import io
import pathlib
import re
import tokenize

PYTHON_DIR = pathlib.Path(__file__).resolve().parent.parent
# `lib/proc.py` es el envoltorio seguro: fija la codificación él mismo.
EXENTOS = {"proc.py"}


def _sin_texto_literal(codigo: str) -> str:
    """El mismo código con cadenas y comentarios en blanco, conservando líneas.

    Hace falta porque este archivo documenta el bug CITANDO la llamada rota en
    su propio docstring, y el barrido se acusaba a sí mismo (líneas 13 y 19).
    Un guardián que reporta su propia documentación como defecto entrena a
    quien lo lea a ignorarlo.

    Neutralizar los literales es seguro: `capture_output=True`, `text=True` y
    `encoding=` son sintaxis, nunca contenido de una cadena.
    """
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(codigo).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return codigo  # que lo revise el humano antes que perder el barrido
    lineas = codigo.splitlines(keepends=True)
    for tok in tokens:
        if tok.type not in (tokenize.STRING, tokenize.COMMENT):
            continue
        (fi, ci), (ff, cf) = tok.start, tok.end
        for n in range(fi, ff + 1):
            linea = lineas[n - 1]
            desde = ci if n == fi else 0
            corte = chr(13) + chr(10)
            hasta = cf if n == ff else len(linea.rstrip(corte))
            cuerpo = linea.rstrip(corte)
            fin = linea[len(cuerpo) :]
            lineas[n - 1] = cuerpo[:desde] + " " * (hasta - desde) + cuerpo[hasta:] + fin
    return "".join(lineas)


def _llamadas_run(texto: str):
    """(línea, cuerpo) de cada `.run(...)` con paréntesis balanceados."""
    for m in re.finditer(r"(?:subprocess|_proc|proc)\.run\(", texto):
        profundidad, j = 0, m.end() - 1
        while j < len(texto):
            if texto[j] == "(":
                profundidad += 1
            elif texto[j] == ")":
                profundidad -= 1
                if profundidad == 0:
                    yield texto[: m.start()].count("\n") + 1, texto[m.start() : j + 1]
                    break
            j += 1


def test_ninguna_captura_de_texto_depende_del_locale():
    culpables: list[str] = []
    # Los TESTS entran al barrido igual que producción. No es celo: un test que
    # lanza un subproceso y pierde su stdout por cp1252 no falla — pasa, con la
    # aserción corriendo contra una cadena vacía. `test_warnings_suprimidos.py`
    # estaba exactamente así: verde, y sin comprobar nada. Un guardián que se
    # excluye a sí mismo del barrido deja de ser un guardián.
    for ruta in [
        *sorted(PYTHON_DIR.glob("*.py")),
        *sorted((PYTHON_DIR / "lib").glob("*.py")),
        *sorted((PYTHON_DIR / "tests").glob("*.py")),
    ]:
        if ruta.name in EXENTOS:
            continue
        try:
            texto = ruta.read_text(encoding="utf-8")
        except OSError:
            continue
        for linea, cuerpo in _llamadas_run(_sin_texto_literal(texto)):
            if "capture_output=True" not in cuerpo:
                continue
            if "text=True" not in cuerpo:
                continue  # devuelve bytes: no hay decodificación que romper
            if "encoding=" in cuerpo:
                continue
            culpables.append(f"{ruta.name}:{linea}")

    assert not culpables, (
        "Estas llamadas capturan TEXTO sin fijar la codificación, así que la "
        "decodifican con la del sistema (cp1252 en Windows) mientras el hijo "
        "escribe UTF-8. El hilo lector muere y stdout queda en None CON "
        "returncode 0 — y quien después haga stderr[-400:] recibe un TypeError.\n"
        "Usá `lib.proc.run_capture(...)` o agregá "
        '`encoding=\"utf-8\", errors=\"replace\"`:\n  ' + "\n  ".join(culpables)
    )
