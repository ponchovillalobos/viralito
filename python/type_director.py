"""Director tipográfico: elige las palabras protagonistas de un clip y cómo entran.

POR QUÉ EXISTE

La capa de titulares cinéticos (`kinetic-headline-layer.tsx`, seis efectos) estaba
escrita y nunca se usaba: `generate_graphics.py` devolvía `kineticHeadlines: []`
a propósito para no repetir en pantalla lo que ya dicen los subtítulos. Los videos
de referencia que se midieron (memoria/mediciones/como-editan-los-videos-de-
referencia-2026-09.md) hacen justamente eso bien: una palabra héroe, grande,
anclada a cuando se dice, cada tanto — no un titular encima del subtítulo.

Se resuelve con dosis, no ocultando nada: los subtítulos siguen SIEMPRE visibles
(regla dura del proyecto) y el héroe aparece al centro poco más de lo que tarda en
decirse la palabra — alrededor de un segundo, uno cada siete. Es un énfasis, no
una segunda pista de texto.

CÓMO DECIDE

El LLM elige, no inventa. Recibe las palabras numeradas y devuelve ÍNDICES de un
esquema JSON cerrado (Ollama acepta `format` con esquema desde 2024-12), así que el
texto y el tiempo salen del transcript real, nunca del modelo. Después, reglas fijas
recortan lo que el modelo propuso:

  - como máximo un héroe cada 7 s, y ninguno en el primer segundo
  - de 1 a 3 palabras seguidas, dichas en menos de 1.6 s
  - como máximo 2 efectos distintos por video (coherencia)
  - las cifras van con su propio efecto

Sin Ollama (o si devuelve basura) cae a una heurística: cifras, negaciones
fuertes y palabras largas con carga — el mismo criterio que usan los prompts.

Uso:
    python type_director.py <transcript.json> [--accent #fb7185] [--no-llm]
Salida: una línea JSON {"kineticHeadlines": [...]} en stdout.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

try:
    from config import OLLAMA_MODEL, OLLAMA_URL
except Exception:  # noqa: BLE001
    OLLAMA_MODEL, OLLAMA_URL = "qwen3:8b", "http://localhost:11434"

try:
    from lib import ollama_opts as _ollama_opts
except Exception:  # noqa: BLE001
    _ollama_opts = None

GAP_MIN_S = 7.0
MAX_PALABRAS = 3
MAX_SPAN_S = 1.6
MOVES_TEXTO = ("split_letters", "tracking_in", "draw_on")
MOVE_CIFRA = "gradient_sweep"

NEGACIONES = {"nunca", "jamás", "jamas", "nadie", "nada", "imposible", "prohibido", "error", "mentira"}
FUERTES = {
    "secreto", "clave", "gratis", "increíble", "increible", "brutal", "peligro", "verdad",
    "dinero", "millones", "éxito", "exito", "fracaso", "miedo", "cambio", "todo", "ahora",
}
VACIAS = {
    "pues", "entonces", "digamos", "bueno", "osea", "este", "esta", "para", "como", "pero",
    "porque", "cuando", "donde", "tambien", "también", "estaba", "estoy", "tengo", "tiene",
}


BORDE = {
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "a", "al",
    "y", "o", "que", "con", "por", "para", "se", "lo", "le", "mi", "tu", "su", "es", "me",
}


def _recorta_bordes(idx: list[int], words: list[dict]) -> list[int]:
    """Quita artículos/preposiciones de los extremos: 'UN POQUITO EN' -> 'POQUITO'."""
    limpio = lambda i: _limpia(words[i]["word"]).lower()  # noqa: E731
    while idx and limpio(idx[0]) in BORDE:
        idx = idx[1:]
    while idx and limpio(idx[-1]) in BORDE:
        idx = idx[:-1]
    return idx


def _limpia(w: str) -> str:
    return re.sub(r"[^\wáéíóúñü%$]", "", str(w), flags=re.UNICODE)


def _es_cifra(w: str) -> bool:
    return bool(re.search(r"\d", w))


def _puntaje(w: str) -> float:
    c = _limpia(w).lower()
    if not c or c in VACIAS:
        return 0.0
    if _es_cifra(c):
        return 3.0
    if c in NEGACIONES:
        return 2.5
    if c in FUERTES:
        return 2.2
    return 1.0 + min(len(c), 12) / 12 if len(c) >= 7 else 0.0


def _heuristica(words: list[dict]) -> list[list[int]]:
    """Candidatos por puntaje, cada uno como lista de índices (1 palabra)."""
    orden = sorted(range(len(words)), key=lambda i: -_puntaje(words[i]["word"]))
    return [[i] for i in orden if _puntaje(words[i]["word"]) > 0]


ESQUEMA = {
    "type": "object",
    "properties": {
        "heroes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "desde": {"type": "integer"},
                    "hasta": {"type": "integer"},
                },
                "required": ["desde", "hasta"],
            },
        }
    },
    "required": ["heroes"],
}


def _llm(words: list[dict], cuantos: int) -> list[list[int]] | None:
    numeradas = " ".join(f"[{i}]{w['word']}" for i, w in enumerate(words))
    prompt = (
        "Eres director de tipografía para videos cortos virales en español. "
        f"Del siguiente texto numerado, elige hasta {cuantos} momentos PROTAGONISTAS: "
        "la palabra o frase de 1 a 3 palabras que concentra la idea (una cifra, una "
        "negación fuerte, el giro, la promesa). Nunca muletillas ni artículos. "
        "Devuelve SOLO índices: 'desde' y 'hasta' inclusive, con hasta-desde <= 2.\n\n"
        f"{numeradas}"
    )
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": ESQUEMA,
        "think": False,
        "options": {"temperature": 0, "num_ctx": 8192},
    }
    if _ollama_opts:
        payload["keep_alive"] = _ollama_opts.KEEP_ALIVE
        payload["num_thread"] = _ollama_opts.num_thread()
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate", data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            body = json.loads(r.read().decode("utf-8"))
        datos = json.loads(body.get("response") or "{}")
        salida = []
        for h in datos.get("heroes") or []:
            a, b = int(h["desde"]), int(h["hasta"])
            if 0 <= a <= b < len(words) and b - a < MAX_PALABRAS:
                salida.append(list(range(a, b + 1)))
        return salida or None
    except Exception as e:  # noqa: BLE001
        print(f"[type_director] Ollama no disponible, heurística: {e}", file=sys.stderr)
        return None


def dirigir(words: list[dict], duracion: float, accent: str = "#fb7185",
            usar_llm: bool = True) -> list[dict]:
    words = [w for w in words if "start" in w and "end" in w and str(w.get("word", "")).strip()]
    if len(words) < 6:
        return []
    cuantos = max(1, int(duracion // GAP_MIN_S))
    propuestos = (_llm(words, cuantos + 2) if usar_llm else None) or []
    # Heurística siempre como reserva: si el LLM propone pocos, completa.
    candidatos = propuestos + [c for c in _heuristica(words) if c not in propuestos]

    elegidos: list[dict] = []
    moves_usados: list[str] = []
    for idx in candidatos:
        idx = _recorta_bordes(list(idx), words)
        if not idx:
            continue
        grupo = [words[i] for i in idx]
        t0, t1 = float(grupo[0]["start"]), float(grupo[-1]["end"])
        if t0 < 1.0 or t1 - t0 > MAX_SPAN_S or t1 > duracion - 0.3:
            continue
        if any(abs(t0 - e["at"]) < GAP_MIN_S for e in elegidos):
            continue
        texto = " ".join(_limpia(w["word"]) for w in grupo).strip()
        if not texto or all(_puntaje(w["word"]) == 0 for w in grupo):
            continue
        if any(e["text"] == texto.upper() for e in elegidos):
            continue  # la misma palabra dos veces se lee como un tic
        if _es_cifra(texto):
            move = MOVE_CIFRA
        else:
            # Coherencia: rota sólo entre los 2 primeros efectos de texto.
            move = MOVES_TEXTO[len([m for m in moves_usados if m != MOVE_CIFRA]) % 2]
        moves_usados.append(move)
        elegidos.append({
            "at": round(t0 - 0.05, 3),
            "duration": round(max(0.7, t1 - t0 + 0.45), 3),
            "text": texto.upper(),
            "effect": move,
            "color": "#ffffff",
            "accent": accent,
            "position": "center",
            # Tamaño que cabe en el 86 % del ancho (1080) con Anton/Bebas en
            # mayúsculas (~0.62 em por letra), con tope para que una palabra corta
            # no ocupe media pantalla. Se manda explícito: los props no pasan por el
            # schema de Zod, así que su default nunca se aplica.
            "size": int(min(190, max(80, 0.86 * 1080 / (0.62 * max(1, len(texto)))))),
        })
        if len(elegidos) >= cuantos:
            break
    return sorted(elegidos, key=lambda e: e["at"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript")
    ap.add_argument("--accent", default="#fb7185")
    ap.add_argument("--no-llm", action="store_true")
    a = ap.parse_args()
    try:
        tr = json.loads(Path(a.transcript).read_text(encoding="utf-8"))
        words = tr.get("words") or []
        dur = float(tr.get("duration") or (words[-1]["end"] if words else 0))
        print(json.dumps({"kineticHeadlines": dirigir(words, dur, a.accent, not a.no_llm)}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"kineticHeadlines": [], "error": str(e)}))


if __name__ == "__main__":
    main()
