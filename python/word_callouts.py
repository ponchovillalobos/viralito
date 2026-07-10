"""CALLOUTS word-synced (F2.c) — de una transcripción word-level saca:
  - statPops: cifras que el hablante MENCIONA ("8 segundos", "50%", "3x", "$1.2M"),
    cronometradas a la palabra exacta (word.start). Cap para no saturar.
  - lowerThirds: banda nombre/cargo del hablante (desde --name/--role del wizard).

Determinista (regex), 100% offline, sin IA. Salida JSON: {"statPops":[...],"lowerThirds":[...]}.
Todo es OPT-IN: si no se llama, el render queda idéntico (arrays vacíos por defecto en
el schema de Remotion). Uso:

  python word_callouts.py --words words.json [--name "Poncho Robles"] [--role "Estratega"] [--max 5]

`words.json` = lista de {word, start, end} (el formato word-level de WhisperX que el
proyecto ya produce).
"""
from __future__ import annotations

import argparse
import json
import re
import sys

# Token que ACARREA una cifra: dígitos con % $ x k m opcionales, o porcentajes escritos.
# Ejemplos que matchea: "8", "50%", "3x", "$1.2M", "10k", "2,000", "100%".
NUM_RE = re.compile(r"^[\$]?\d[\d.,]*\s*(?:%|x|k|m|mil|millones|mm|bn)?$", re.IGNORECASE)
# Unidad que suele seguir a la cifra y sirve de etiqueta ("segundos", "veces", "años"…).
UNIT_WORDS = {
    "segundos", "segundo", "minutos", "minuto", "horas", "hora", "días", "dias", "día", "dia",
    "años", "anos", "año", "ano", "veces", "vez", "por ciento", "porciento", "millones",
    "mil", "dólares", "dolares", "pesos", "clientes", "personas", "ventas", "seguidores",
}


def normalize_value(tok: str) -> str:
    """Limpia el token de la cifra para mostrarlo ('$1.2M', '50%', '3x')."""
    return tok.strip().strip(".,;:").replace(" ", "")


def build_stat_pops(words: list[dict], max_pops: int) -> list[dict]:
    pops: list[dict] = []
    used_starts: set[float] = set()
    for i, w in enumerate(words):
        raw = str(w.get("word", "")).strip()
        clean = raw.strip(".,;:¿?¡!()").strip()
        if not clean or not NUM_RE.match(clean):
            continue
        # Descartar años sueltos tipo "2024" sin unidad (ruido) salvo que traigan % $ x.
        if re.fullmatch(r"\d{4}", clean) and not re.search(r"[%$x]", clean):
            continue
        start = float(w.get("start", 0))
        if start in used_starts:
            continue
        # Etiqueta = la palabra siguiente si es una unidad conocida.
        label = ""
        if i + 1 < len(words):
            nxt = str(words[i + 1].get("word", "")).strip().strip(".,;:").lower()
            if nxt in UNIT_WORDS:
                label = nxt
        pops.append({
            "at": round(start, 2),
            "duration": 2.2,
            "value": normalize_value(clean),
            "label": label,
        })
        used_starts.add(start)
        if len(pops) >= max_pops:
            break
    return pops


def build_lower_thirds(name: str, role: str, words: list[dict]) -> list[dict]:
    if not name:
        return []
    # Aparece tras el gancho (~1.4s) o al arrancar el primer discurso si es más tarde.
    at = 1.4
    if words:
        first = float(words[0].get("start", 0))
        at = max(1.0, min(first + 0.4, 2.5))
    return [{"at": round(at, 2), "duration": 3.4, "name": name, "role": role or ""}]


def main() -> None:
    ap = argparse.ArgumentParser(description="Callouts word-synced (statPops + lower-thirds)")
    ap.add_argument("--words", required=True, help="JSON word-level [{word,start,end}]")
    ap.add_argument("--name", default="", help="nombre del hablante (lower-third)")
    ap.add_argument("--role", default="", help="cargo del hablante (lower-third)")
    ap.add_argument("--max", type=int, default=5, help="máx statPops (anti-saturación)")
    args = ap.parse_args()

    try:
        with open(args.words, encoding="utf-8") as f:
            data = json.load(f)
        # Aceptar tanto [ {word,start,end} ] como {words:[...]} o {segments:[{words:[...]}]}.
        if isinstance(data, dict):
            words = data.get("words")
            if words is None and isinstance(data.get("segments"), list):
                words = [w for seg in data["segments"] for w in seg.get("words", [])]
            words = words or []
        else:
            words = data
    except Exception as e:  # noqa: BLE001 — nunca abortar el render por esto
        print(json.dumps({"statPops": [], "lowerThirds": [], "error": str(e)[:150]}))
        return

    out = {
        "statPops": build_stat_pops(words, max(0, args.max)),
        "lowerThirds": build_lower_thirds(args.name, args.role, words),
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
