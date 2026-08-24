"""pick_keywords.py — Elige QUÉ palabras merecen un sticker en pantalla.

Por qué existe: hasta ahora esta decisión era `pickTopKeywords` en
`frontend/src/lib/content-title.ts`, que filtra muletillas y luego toma una
palabra cada N **por su posición en la lista**:

    const slice = filtered.length / count;
    for (let i = 0; i < count; i++) picks.push(filtered[Math.floor(i * slice)]);

O sea: la palabra que aparece gigante en pantalla estaba elegida por el lugar
que le tocó en el array, no por lo que significa ni por si el hablante la
recalcó. Reparte bien en el tiempo, pero no distingue "INVENTARIO" de
"PROBLEMA". Es justo el tipo de juicio donde un LLM aporta de verdad.

Este script reusa la MISMA cadena de proveedores que ya elige los clips
(claude > codex > ollama, ver `analyze_clips.clip_provider`), así que con el
CLI logueado decide un modelo frontier, y sin internet cae al modelo local.

Degrada siempre limpio: si algo falla devuelve `ok: false` y quien llama se
queda con la heurística de siempre. Nunca deja el video sin stickers.

Uso:
    python pick_keywords.py <transcript.json> [--count 7] [--provider claude|codex|ollama]

Salida (última línea del stdout, JSON):
    {"ok": true, "keywords": ["INVENTARIO", "MARGEN", ...], "provider": "claude"}
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from analyze_clips import (  # noqa: E402
    OLLAMA_MODEL,
    _llm_complete,
    clip_provider,
)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
except Exception:
    pass


PROMPT = """Eres editor de video viral vertical para audiencia hispanohablante.

Abajo va la transcripción de un video corto. Tenés que elegir EXACTAMENTE {count}
palabras que aparecerán GIGANTES en pantalla, una a la vez, como stickers sobre
el video mientras el hablante las dice.

Criterio — elegí la palabra que el espectador debería RECORDAR:
  · Sustantivos y conceptos con peso: el tema, la cifra, el nombre propio, el
    dato que sorprende. "MARGEN", "INVENTARIO", "40%", "AMAZON".
  · Palabras donde el hablante pone énfasis o que cargan la idea de esa frase.
  · Que funcionen SOLAS: quien lea únicamente esas {count} palabras debería
    intuir de qué va el video.

Descartá:
  · Verbos genéricos y conectores: TENEMOS, ENTONCES, PODEMOS, CUALQUIER.
  · Muletillas y relleno.
  · Palabras que se repiten (elegí una sola vez cada concepto).

Repartilas a lo largo del video, no todas del mismo tramo.

Para cada palabra, elegí también UN emoji que tenga que ver con ella. El emoji
se dibuja al lado de la palabra en pantalla, así que tiene que reforzar el
concepto, no distraer. Si ninguno encaja bien, usá "" (vacío): mejor sin emoji
que con uno que no pinta nada.

Devolvé SOLO este JSON, sin explicación ni texto alrededor:
{{"keywords": [{{"palabra": "PALABRA1", "emoji": "💰"}}, ...]}}

Cada palabra debe aparecer TAL CUAL en la transcripción (misma palabra, podés
escribirla en mayúsculas). No inventes palabras que no estén.

TRANSCRIPCIÓN:
{texto}
"""


def _extraer_json(crudo: str) -> dict | None:
    """Saca el objeto JSON del texto del modelo, tolerando cercos y prosa."""
    if not crudo:
        return None
    cercado = re.search(r"```(?:json)?\s*(.+?)```", crudo, re.S)
    if cercado:
        crudo = cercado.group(1)
    inicio = crudo.find("{")
    fin = crudo.rfind("}")
    if inicio == -1 or fin <= inicio:
        return None
    try:
        return json.loads(crudo[inicio : fin + 1])
    except json.JSONDecodeError:
        return None


def _normaliza(p: str) -> str:
    return re.sub(r"[^\wáéíóúñü]", "", p.lower())


def elegir(palabras: list[dict], count: int, provider: str) -> dict:
    texto = " ".join(str(w.get("word", "")) for w in palabras).strip()
    if not texto:
        return {"ok": False, "error": "transcripción vacía"}

    # Un video corto entero cabe de sobra; se recorta por seguridad para no
    # mandar una charla de una hora a un prompt pensado para shorts.
    if len(texto) > 12000:
        texto = texto[:12000]

    prompt = PROMPT.format(count=count, texto=texto)
    crudo = _llm_complete(prompt, provider, OLLAMA_MODEL, temperature=0.3)
    datos = _extraer_json(crudo)
    if not datos or not isinstance(datos.get("keywords"), list):
        return {"ok": False, "error": "el modelo no devolvió JSON usable",
                "crudo": (crudo or "")[:200]}

    # VALIDACIÓN: solo se aceptan palabras que existen DE VERDAD en la
    # transcripción. Un modelo puede inventar o parafrasear, y un sticker con
    # una palabra que nadie dijo se ve como un error de la herramienta.
    presentes = {_normaliza(str(w.get("word", ""))) for w in palabras}
    limpias: list[dict] = []
    vistas: set[str] = set()
    descartadas: list[str] = []
    for k in datos["keywords"]:
        # Se acepta tanto el formato nuevo {palabra, emoji} como una cadena
        # suelta, por si el modelo simplifica la respuesta.
        if isinstance(k, dict):
            palabra = str(k.get("palabra") or k.get("word") or "")
            emoji = str(k.get("emoji") or "").strip()
        else:
            palabra, emoji = str(k), ""

        n = _normaliza(palabra)
        if not n or n in vistas:
            continue
        if n not in presentes:
            descartadas.append(palabra)
            continue
        vistas.add(n)
        # Un emoji, no una ristra: si mandó varios se queda el primero.
        if len(emoji) > 4:
            emoji = ""
        limpias.append({"palabra": palabra.strip(), "emoji": emoji})

    if len(limpias) < 2:
        return {"ok": False, "error": "quedaron menos de 2 palabras válidas",
                "descartadas": descartadas}

    return {
        "ok": True,
        "keywords": limpias[:count],
        "provider": provider,
        "descartadas": descartadas,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("transcript", type=Path, help="ruta al JSON de transcripción")
    ap.add_argument("--count", type=int, default=7)
    ap.add_argument("--provider", default=None,
                    choices=["claude", "codex", "ollama"],
                    help="fuerza el proveedor; por defecto claude > codex > ollama")
    args = ap.parse_args()

    try:
        datos = json.loads(args.transcript.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "error": f"no se pudo leer la transcripción: {e}"}))
        return 0  # 0 a propósito: quien llama debe usar su heurística, no fallar

    palabras = datos.get("words") or []
    if not isinstance(palabras, list) or not palabras:
        print(json.dumps({"ok": False, "error": "la transcripción no tiene palabras"}))
        return 0

    provider = args.provider or clip_provider()
    try:
        res = elegir(palabras, max(2, args.count), provider)
    except Exception as e:  # noqa: BLE001 — cualquier fallo debe degradar, no romper
        res = {"ok": False, "error": f"{type(e).__name__}: {e}"[:300], "provider": provider}

    print(json.dumps(res, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
