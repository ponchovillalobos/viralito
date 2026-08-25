"""Imprime la carpeta de datos que ve Python y la que ve un hijo de Node.

Vive como archivo suelto, y no embebido en el test, a proposito: meter una
expresion de Node dentro de una cadena de Python dentro de un argumento de
consola son tres niveles de comillas, y al romperse el test se saltaba solo, que
es la unica forma de fallar peor que fallar.

No es un test: es el sujeto del test. pytest lo ignora porque empieza con "_".
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402

r = subprocess.run(
    ["node", "-e", "console.log(process.env.VIRAL_DATA_ROOT || '')"],
    capture_output=True, text=True,
)
print(json.dumps({"python": str(config.DATA_ROOT), "node": (r.stdout or "").strip()}))
