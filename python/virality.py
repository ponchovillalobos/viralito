"""Virality Score (0-100) por clip — local, sin API ni LLM.

Inspirado en el "Virality Score" de Opus Clip pero 100% determinista y offline.
Puntúa cada propuesta de clip a partir de su transcripción con 6 factores:

  - hook (0-30)      : la apertura detiene el scroll (pregunta / número / palabra gancho)
  - emoción (0-20)   : densidad de palabras de énfasis / carga emocional
  - datos (0-15)     : menciona cifras concretas (lo específico convierte)
  - ritmo (0-15)     : palabras por segundo en el rango "energético" (~2.3-3.6 wps)
  - duración (0-10)  : cae en el sweet spot de short (pico ~30-45s)
  - cierre/CTA (0-10): termina con llamado a la acción / remate

Uso:
  python virality.py --proposals <proposals.json> --transcript <transcript.json>
    → reescribe el proposals.json agregando "viralityScore" y "viralityReasons" a cada clip.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Palabras gancho de apertura (curiosidad / autoridad / urgencia), audiencia LATAM.
HOOK_WORDS = {
    "cómo", "como", "por qué", "porque", "qué", "que", "cuál", "cual", "secreto",
    "error", "nunca", "jamás", "jamas", "nadie", "gratis", "deja", "dejá", "basta",
    "mira", "mirá", "escucha", "escuchá", "atención", "atencion", "increíble",
    "increible", "verdad", "mentira", "peor", "mejor", "truco", "hack", "clave",
    "paso", "esto", "así", "asi", "te juro", "la razón", "razon", "nunca más",
}

# Palabras de énfasis / carga emocional.
EMPHASIS = {
    "nunca", "siempre", "secreto", "error", "clave", "gratis", "increíble", "increible",
    "brutal", "verdad", "mentira", "nadie", "todos", "millones", "rápido", "rapido",
    "fácil", "facil", "ahora", "hoy", "atención", "atencion", "importante", "jamás",
    "jamas", "peor", "mejor", "wow", "loco", "locura", "impresionante", "obvio",
    "grave", "urgente", "cuidado", "ojo", "boom", "explotó", "exploto",
}

# Palabras de CTA / cierre.
CTA_WORDS = {
    "seguime", "sígueme", "sigueme", "seguí", "segui", "comenta", "comentá", "comparte",
    "compartí", "comparti", "guarda", "guardá", "suscrib", "suscríb", "like", "link",
    "perfil", "dm", "mensaje", "no te pierdas", "dale", "activá", "activa", "mira hasta",
    "parte 2", "parte dos", "siguiente video",
}

# Puntos máximos de cada factor (para normalizar el desglose a 0-100 en la UI).
FACTOR_MAX = {
    "hook": 30.0,
    "emotion": 20.0,
    "data": 15.0,
    "pace": 15.0,
    "length": 10.0,
    "cta": 10.0,
}


# Regexes y vocabularios pre-compilados una sola vez (se llaman cientos de veces por lote).
_RE_DIGIT = re.compile(r"\d")
_RE_NUMBER = re.compile(r"\d[\d.,]*\s?%?")


def _pad_vocab(vocab: set[str]) -> tuple[tuple[str, str], ...]:
    return tuple((" " + w + " ", " " + w) for w in vocab)


_HOOK_PADDED = _pad_vocab(HOOK_WORDS)
_EMPHASIS_PADDED = _pad_vocab(EMPHASIS)
_CTA_PADDED = _pad_vocab(CTA_WORDS)
_PADDED = {id(HOOK_WORDS): _HOOK_PADDED, id(EMPHASIS): _EMPHASIS_PADDED, id(CTA_WORDS): _CTA_PADDED}


def _norm(s: str) -> str:
    return s.lower().strip()


def _has_number(text: str) -> bool:
    # cifra real (no parte de palabra rara); incluye %, "3 veces", "$10", "10k"
    return bool(_RE_DIGIT.search(text))


def _count_hits(text: str, vocab: set[str]) -> int:
    low = " " + _norm(text) + " "
    padded = _PADDED.get(id(vocab)) or _pad_vocab(vocab)
    return sum(1 for mid, pre in padded if mid in low or pre in low)


def score_clip(words: list[dict], start: float, end: float, hook: str = "") -> dict[str, Any]:
    """Puntúa un clip (ventana [start,end] del transcript). Devuelve score 0-100 + factores."""
    seg = [w for w in words if start - 0.2 <= float(w.get("start", 0)) <= end + 0.2]
    text = " ".join(str(w.get("word", "")) for w in seg).strip()
    dur = max(0.1, end - start)
    n_words = len(seg) if seg else len(text.split())

    # Apertura: el hook explícito si vino, si no las primeras ~10 palabras del segmento.
    opening = hook.strip() if hook else " ".join(text.split()[:10])

    reasons: list[str] = []

    # 1) HOOK (0-30)
    hook_score = 0.0
    if "?" in opening or "¿" in opening:
        hook_score += 14; reasons.append("Abre con una pregunta")
    if _has_number(opening):
        hook_score += 8; reasons.append("Cifra en el hook")
    hh = _count_hits(opening, HOOK_WORDS)
    if hh:
        hook_score += min(12, hh * 6); reasons.append("Palabras gancho en la apertura")
    hook_score = min(30.0, hook_score)

    # 2) EMOCIÓN (0-20) — densidad de énfasis cada ~100 palabras
    emph = _count_hits(text, EMPHASIS)
    per100 = emph / max(1, n_words) * 100
    emo_score = min(20.0, per100 * 4)
    if emph >= 3:
        reasons.append("Lenguaje con carga emocional")

    # 3) DATOS (0-15)
    data_score = 0.0
    nums = len(_RE_NUMBER.findall(text))
    if nums >= 1:
        data_score = min(15.0, 6 + nums * 2)
        reasons.append("Menciona datos concretos")

    # 4) RITMO (0-15) — wps óptimo 2.3-3.6
    wps = n_words / dur
    if 2.3 <= wps <= 3.6:
        pace_score = 15.0
    elif wps < 2.3:
        pace_score = max(0.0, 15.0 - (2.3 - wps) * 10)
    else:
        pace_score = max(0.0, 15.0 - (wps - 3.6) * 8)
    if pace_score >= 12:
        reasons.append("Ritmo de habla dinámico")

    # 5) DURACIÓN (0-10) — pico 30-45s, cae fuera de 15-60
    if 28 <= dur <= 46:
        len_score = 10.0
    elif dur < 28:
        len_score = max(0.0, 10.0 - (28 - dur) * 0.4)
    else:
        len_score = max(0.0, 10.0 - (dur - 46) * 0.5)

    # 6) CIERRE / CTA (0-10) — en el último tercio del texto
    tail = " ".join(text.split()[-max(6, n_words // 3):])
    cta_hits = _count_hits(tail, CTA_WORDS)
    cta_score = min(10.0, cta_hits * 6.0)
    if cta_hits:
        reasons.append("Cierra con llamado a la acción")

    total = hook_score + emo_score + data_score + pace_score + len_score + cta_score
    score = int(round(max(1, min(100, total))))

    factors = {
        "hook": round(hook_score, 1),
        "emotion": round(emo_score, 1),
        "data": round(data_score, 1),
        "pace": round(pace_score, 1),
        "length": round(len_score, 1),
        "cta": round(cta_score, 1),
    }
    return {
        "score": score,
        "factors": factors,
        # Desglose normalizado 0-100 por factor (para barras en la UI).
        "factors100": {
            k: int(round(min(100.0, v / FACTOR_MAX[k] * 100))) for k, v in factors.items()
        },
        "reasons": reasons[:3],
    }


def score_proposals_file(proposals_path: Path, transcript_path: Path) -> dict[str, Any]:
    try:
        proposals = json.loads(proposals_path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[virality] proposals corrupto ({proposals_path}): {e}", file=sys.stderr)
        return []
    clips = proposals.get("clips") if isinstance(proposals, dict) else proposals
    if not isinstance(clips, list):
        return {"ok": False, "error": "proposals sin lista de clips"}
    words: list[dict] = []
    try:
        words = json.loads(transcript_path.read_text(encoding="utf-8")).get("words", [])
    except Exception:
        words = []

    scored = 0
    for c in clips:
        try:
            start = float(c.get("start", 0))
            end = float(c.get("end", start + 30))
        except (ValueError, TypeError):
            continue
        res = score_clip(words, start, end, str(c.get("hook", "")))
        c["viralityScore"] = res["score"]
        c["viralityReasons"] = res["reasons"]
        c["viralityFactors"] = res["factors"]
        # Desglose 0-100 por factor — lo que lee la UI para las barras de
        # "¿Por qué este clip?". Proposals viejos sin este campo siguen funcionando.
        c["factors"] = res["factors100"]
        scored += 1

    # Reordenar de más viral a menos viral (mantiene mejores arriba en la UI).
    if isinstance(proposals, dict):
        clips.sort(key=lambda c: -int(c.get("viralityScore", 0) or 0))
        proposals["clips"] = clips
        out_obj: Any = proposals
    else:
        clips.sort(key=lambda c: -int(c.get("viralityScore", 0) or 0))
        out_obj = clips
    proposals_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2), encoding="utf-8")
    avg = round(sum(int(c.get("viralityScore", 0) or 0) for c in clips) / max(1, len(clips)))
    return {"ok": True, "scored": scored, "avg": avg}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proposals", required=True)
    ap.add_argument("--transcript", required=True)
    args = ap.parse_args()
    pp, tp = Path(args.proposals), Path(args.transcript)
    if not pp.exists():
        print(json.dumps({"ok": False, "error": f"no existe {pp}"})); return 1
    try:
        print(json.dumps(score_proposals_file(pp, tp), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)})); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
