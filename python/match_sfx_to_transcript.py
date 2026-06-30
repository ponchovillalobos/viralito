"""SFX matcher determinístico: asigna efectos de sonido a momentos del transcript.

Análogo a `match_overlays_to_transcript.py` pero para SFX. Vocabulario que mapea
palabras del guión hablado a archivos SFX en C:\\hermes-data\\videos\\assets\\sfx\\curated\\.

Algoritmo:
  1. Por cada palabra del transcript, buscar SFX cuyo vocabulario la contenga.
  2. Si match → agregar sfxMark al timestamp (con offset -0.1s para anticipación).
  3. Inyectar SFX estructurales: swoosh-cinematic en seg 0.3 (entrada del video),
     vhs-static-off cerca del final.
  4. Deduplicar SFX dentro de ±0.5s.
  5. Limitar a max_sfx por video.

NO usa LLM — totalmente determinístico, instantáneo.

Uso:
  python match_sfx_to_transcript.py --transcript-file X.json --duration 60
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


# ─── Vocabulario palabra → SFX ────────────────────────────────────────────────
# Cada SFX tiene un set de palabras (en mayúsculas/minúsculas sin acentos) que
# disparan su inyección. Tunear con el tiempo según los videos del creador.

# ─── Vocabulario REAL apuntando a rse/soundfx (CC0/CC-BY) en github/ ──────────
# Los archivos están en C:\hermes-data\videos\assets\sfx\github\
# 67 SFX reales descargados de https://github.com/rse/soundfx
SFX_KEYWORDS: dict[str, dict[str, Any]] = {
    # ─── Impactos / Golpes (sustituyen drum-hit/impact-hit sintéticos)
    "punch1.mp3": {
        "keywords": ["boom", "impacto", "golpe", "shock", "fuerte", "punch"],
        "category": "punch",
        "volume": 0.5,
        "offset": -0.05,
    },
    "punch2.mp3": {
        "keywords": ["choca", "estrella", "golpea", "cae", "crash", "rompio"],
        "category": "punch",
        "volume": 0.5,
        "offset": -0.05,
    },
    "cannon1.mp3": {
        "keywords": ["explosion", "estallido", "enorme", "gigante", "masivo", "millones"],
        "category": "cannon",
        "volume": 0.55,
        "offset": -0.05,
    },
    "splash1.mp3": {
        "keywords": ["splash", "agua", "cae"],
        "category": "splash",
        "volume": 0.4,
        "offset": -0.05,
    },
    # ─── Whooshes / Transiciones ────────────────────────────────────────────
    "whoosh1.mp3": {
        "keywords": ["transicion", "cambio", "whoosh"],
        "category": "whoosh",
        "volume": 0.4,
        "offset": -0.1,
    },
    "whoosh2.mp3": {
        "keywords": ["movimiento", "rapido"],
        "category": "whoosh",
        "volume": 0.4,
        "offset": -0.1,
    },
    "slide1.mp3": {
        "keywords": ["desliza", "transita"],
        "category": "slide",
        "volume": 0.35,
        "offset": -0.05,
    },
    # ─── Revelaciones / Tensión ────────────────────────────────────────────
    "chime1.mp3": {
        "keywords": ["revelacion", "secreto", "verdad", "descubri", "descubrieron"],
        "category": "chime",
        "volume": 0.45,
        "offset": -0.1,
    },
    "chime2.mp3": {
        "keywords": ["respuesta", "solucion", "encontro"],
        "category": "chime",
        "volume": 0.4,
        "offset": -0.1,
    },
    "resonance1.mp3": {
        "keywords": ["tension", "miedo", "nervios", "ansiedad", "dramatico"],
        "category": "resonance",
        "volume": 0.4,
        "offset": 0,
    },
    "fanfare1.mp3": {
        "keywords": ["ganador", "celebracion", "exito", "victoria"],
        "category": "fanfare",
        "volume": 0.45,
        "offset": -0.05,
    },
    # ─── Cifras / Datos ─────────────────────────────────────────────────────
    "bling1.mp3": {
        # Cifras grandes, dinero, premios
        "keywords": ["dinero", "premio", "millones", "millon", "miles", "ganar"],
        "category": "bling",
        "volume": 0.4,
        "offset": 0,
        "match_numbers": True,
    },
    "bling2.mp3": {
        "keywords": ["porcentaje", "porciento", "cifra", "numero"],
        "category": "bling",
        "volume": 0.4,
        "offset": 0,
    },
    # ─── Accents (palabras clave puntuales) ──────────────────────────────────
    "click1.mp3": {
        "keywords": ["elige", "elegir", "selecciona", "decide", "decision"],
        "category": "click",
        "volume": 0.35,
        "offset": 0,
    },
    "click2.mp3": {
        "keywords": ["foto", "fotografia", "retrato"],
        "category": "click",
        "volume": 0.35,
        "offset": 0,
    },
    "beep1.mp3": {
        "keywords": ["aparece", "surge", "pop"],
        "category": "beep",
        "volume": 0.3,
        "offset": 0,
    },
    # ─── Alarmas / Atención ────────────────────────────────────────────────
    "alarm1.mp3": {
        "keywords": ["espera", "atencion", "preparate", "mira", "fijate", "checa"],
        "category": "alarm",
        "volume": 0.35,
        "offset": -1.0,
    },
    # ─── Errors / Glitches ────────────────────────────────────────────────
    "error1.mp3": {
        "keywords": ["error", "falla", "rompe", "glitch"],
        "category": "error",
        "volume": 0.35,
        "offset": 0,
    },
    # ─── Throw / Lanzamiento ──────────────────────────────────────────────
    "throw1.mp3": {
        "keywords": ["lanza", "tira", "arroja"],
        "category": "throw",
        "volume": 0.35,
        "offset": -0.05,
    },
    # ─── Escala (subida/bajada tonal) ─────────────────────────────────────
    "scale1.mp3": {
        "keywords": ["sube", "crecio", "subio", "aumenta", "crece"],
        "category": "scale",
        "volume": 0.35,
        "offset": -0.05,
    },
    # ─── Estructurales (sin palabra) ─────────────────────────────────────
    "whoosh3.mp3": {
        "keywords": [],
        "category": "structural",
        "volume": 0.5,
        "offset": 0,
        "structural": "intro",
    },
    "whoosh4.mp3": {
        "keywords": [],
        "category": "structural",
        "volume": 0.3,
        "offset": 0,
        "structural": "jump_cut",
    },
    "jingle1.mp3": {
        "keywords": [],
        "category": "structural",
        "volume": 0.4,
        "offset": -0.05,
        "structural": "outro",
    },
    # ─── Mantenemos algunos sintéticos legacy como fallback (drum-hit, etc) ──
    "drum-hit.mp3": {
        "keywords": [],  # Solo se usa via density_extra accent
        "category": "drum",
        "volume": 0.4,
        "offset": -0.05,
    },
    "impact-hit.mp3": {
        "keywords": ["choca", "estrella", "golpea", "cae", "crash", "rompio"],
        "category": "impact",
        "volume": 0.5,
        "offset": -0.05,
    },
    # ─── Kenney.nl packs (CC0, descargados por download_sfx_library.py a
    #     assets/sfx/github/ — 345 archivos servidos por /api/sfx/stream).
    #     Keywords NUEVAS (no pisan las de arriba: el match exacto itera en orden).
    "kenney-interface-sounds-confirmation_001.ogg": {
        "keywords": ["confirma", "correcto", "exacto", "listo", "perfecto", "asi es"],
        "category": "confirm",
        "volume": 0.4,
        "offset": 0,
    },
    "kenney-interface-sounds-error_001.ogg": {
        "keywords": ["incorrecto", "equivocado", "mentira", "falso", "jamas"],
        "category": "error",
        "volume": 0.4,
        "offset": 0,
    },
    "kenney-interface-sounds-question_001.ogg": {
        "keywords": ["pregunta", "duda", "sabias", "adivina", "imaginate"],
        "category": "question",
        "volume": 0.4,
        "offset": -0.1,
    },
    "kenney-interface-sounds-glitch_001.ogg": {
        "keywords": ["raro", "extrano", "bizarro", "absurdo"],
        "category": "glitch",
        "volume": 0.35,
        "offset": 0,
    },
    "kenney-interface-sounds-maximize_001.ogg": {
        "keywords": ["gigantesco", "agranda", "expande", "amplia", "duplica"],
        "category": "ui",
        "volume": 0.35,
        "offset": 0,
    },
    "kenney-interface-sounds-minimize_001.ogg": {
        "keywords": ["pequeno", "chico", "reduce", "achica", "minimo"],
        "category": "ui",
        "volume": 0.35,
        "offset": 0,
    },
    "kenney-interface-sounds-select_001.ogg": {
        "keywords": ["importante", "clave", "esencial", "fundamental", "critico"],
        "category": "accent",
        "volume": 0.38,
        "offset": -0.05,
    },
    "kenney-interface-sounds-bong_001.ogg": {
        "keywords": ["increible", "impresionante", "sorprendente", "brutal"],
        "category": "accent",
        "volume": 0.42,
        "offset": -0.05,
    },
    "kenney-interface-sounds-open_001.ogg": {
        "keywords": ["abre", "comienza", "empieza", "inicia", "arranca"],
        "category": "ui",
        "volume": 0.35,
        "offset": 0,
    },
    "kenney-interface-sounds-close_001.ogg": {
        "keywords": ["cierra", "termina", "acaba", "concluye"],
        "category": "ui",
        "volume": 0.35,
        "offset": 0,
    },
    "kenney-interface-sounds-scroll_001.ogg": {
        "keywords": ["lista", "siguiente", "continua", "ademas"],
        "category": "ui",
        "volume": 0.3,
        "offset": 0,
    },
    "kenney-digital-audio-powerup7.ogg": {
        "keywords": ["mejora", "potencia", "nivel", "evoluciona", "gana"],
        "category": "powerup",
        "volume": 0.4,
        "offset": -0.05,
    },
    "kenney-digital-audio-phaserup3.ogg": {
        "keywords": ["despega", "vuela", "cohete", "dispara"],
        "category": "riser",
        "volume": 0.38,
        "offset": -0.05,
    },
    "kenney-digital-audio-zap1.ogg": {
        "keywords": ["energia", "electrico", "poder", "fuerza"],
        "category": "zap",
        "volume": 0.38,
        "offset": 0,
    },
    "kenney-digital-audio-lowdown.ogg": {
        "keywords": ["baja", "cayo", "pierde", "derrota", "fracaso", "peor"],
        "category": "fall",
        "volume": 0.38,
        "offset": -0.05,
    },
    "kenney-impact-sounds-impactpunch_heavy_000.ogg": {
        "keywords": ["tremendo", "duro", "pega", "destroza"],
        "category": "punch",
        "volume": 0.5,
        "offset": -0.05,
    },
    "kenney-impact-sounds-impactmetal_heavy_000.ogg": {
        "keywords": ["metal", "hierro", "acero", "maquina"],
        "category": "impact",
        "volume": 0.45,
        "offset": -0.05,
    },
    "kenney-impact-sounds-impactglass_heavy_000.ogg": {
        "keywords": ["vidrio", "cristal", "quiebra", "estalla"],
        "category": "impact",
        "volume": 0.45,
        "offset": -0.05,
    },
    "kenney-impact-sounds-impactbell_heavy_000.ogg": {
        "keywords": ["campana", "anuncio", "aviso", "alerta"],
        "category": "bell",
        "volume": 0.42,
        "offset": -0.05,
    },
    "kenney-impact-sounds-footstep_wood_000.ogg": {
        "keywords": ["camina", "paso", "pasos", "llega"],
        "category": "foley",
        "volume": 0.35,
        "offset": 0,
    },
}


def normalize(word: str) -> str:
    """Lowercase + sin acentos + sin puntuación."""
    w = word.lower().strip()
    w = re.sub(r"[^\w\sáéíóúñ]", "", w, flags=re.UNICODE)
    repl = str.maketrans("áéíóúñ", "aeioun")
    return w.translate(repl)


def is_number_word(word: str) -> bool:
    """¿La palabra es un número o tiene cifras? '80%', '73', '1936', etc."""
    n = normalize(word)
    return bool(re.search(r"\d", n)) and not re.match(r"^[a-z]+$", n)


def find_sfx_for_word(word: str) -> tuple[str | None, float]:
    """Devuelve el SFX que matchea esta palabra + score."""
    word_n = normalize(word)
    if len(word_n) < 3:
        return None, 0.0

    best_sfx = None
    best_score = 0.0
    for sfx_name, cfg in SFX_KEYWORDS.items():
        if cfg.get("structural"):
            continue  # estructurales no matchean por palabra
        # Match por números
        if cfg.get("match_numbers") and is_number_word(word):
            return sfx_name, 0.9
        # Match exacto + fuzzy
        for kw in cfg.get("keywords", []):
            kw_n = normalize(kw)
            if kw_n == word_n:
                return sfx_name, 1.0
            # Substring
            if len(word_n) >= 5 and (kw_n in word_n or word_n in kw_n):
                if 0.92 > best_score:
                    best_score = 0.92
                    best_sfx = sfx_name
            # Fuzzy
            score = SequenceMatcher(None, kw_n, word_n).ratio()
            if score >= 0.85 and score > best_score:
                best_score = score
                best_sfx = sfx_name
    return best_sfx, best_score


# Categorías de SFX "positivos/celebratorios": NO deben dispararse en contexto NEGATIVO.
# Bug clásico: "perdí dinero" disparaba el *bling* alegre porque el match es por palabra
# aislada, sin sentido. Si hay una cue de negación cerca, se SUPRIME el SFX positivo.
_POSITIVE_CATEGORIES = {"bling", "fanfare", "chime"}
_NEGATION_CUES = {
    "no", "ni", "nunca", "jamas", "sin", "tampoco", "nada", "nadie",
    "perdi", "perdio", "perdimos", "perder", "pierde", "pierden", "perdida", "perdidas",
    "fracaso", "fracaso", "fracasar", "fracasa", "fallo", "falla", "fallar", "fallido",
    "error", "errores", "mal", "peor", "menos", "deuda", "deudas", "quiebra",
    "problema", "problemas", "caro", "costoso", "riesgo", "miedo", "cuesta", "costo",
}


def match_sfx_to_transcript(
    transcript_words: list[dict[str, Any]],
    duration: float,
    target_density: str = "medium",
) -> dict[str, Any]:
    """Genera sfxMarks para el video completo.

    target_density: "low" | "medium" | "high" → controla min/max SFX y dedupe window.
    """
    density_config = {
        "low": {"min": 4, "max": 7, "dedupe_window": 1.5, "extra_accent": 0},
        "medium": {"min": 7, "max": 12, "dedupe_window": 0.9, "extra_accent": 3},
        "high": {"min": 11, "max": 18, "dedupe_window": 0.5, "extra_accent": 8},
    }
    cfg = density_config.get(target_density, density_config["medium"])

    sfx_marks: list[dict[str, Any]] = []

    # ─── 1. SFX matched por palabra ────────────────────────────────────────────
    # Palabras normalizadas (una vez) para chequear contexto/negación por ventana.
    _norm_words = [normalize(w.get("word", "")) for w in transcript_words]
    matched_count = 0
    for i, w in enumerate(transcript_words):
        word_text = w.get("word", "")
        sfx_name, score = find_sfx_for_word(word_text)
        if not sfx_name:
            continue
        sfx_cfg = SFX_KEYWORDS[sfx_name]
        # Guarda de sentido: un SFX positivo (dinero/win/reveal) NO se dispara si hay una
        # negación en la ventana [-4, +2] palabras ("perdí dinero", "no es éxito"…).
        if sfx_cfg.get("category") in _POSITIVE_CATEGORIES:
            window = _norm_words[max(0, i - 4): i + 3]
            if any(t in _NEGATION_CUES for t in window):
                continue
        at = float(w.get("start", 0)) + sfx_cfg.get("offset", 0)
        if at < 0:
            at = 0
        sfx_marks.append({
            "at": round(at, 2),
            "sound": sfx_name,
            "volume": sfx_cfg["volume"],
            "matchedWord": word_text,
            "score": round(score, 2),
            "trigger": "word_match",
        })
        matched_count += 1

    # ─── 2. SFX estructurales (apuntan al pack github real) ───────────────────
    structural_count = 0
    # Intro (seg 0.3) — whoosh real
    sfx_marks.append({
        "at": 0.3,
        "sound": "whoosh3.mp3",
        "volume": 0.5,
        "trigger": "structural_intro",
    })
    structural_count += 1
    # Outro (cerca del final) — jingle de cierre
    sfx_marks.append({
        "at": round(max(0, duration - 1.5), 2),
        "sound": "jingle1.mp3",
        "volume": 0.4,
        "trigger": "structural_outro",
    })
    structural_count += 1

    # ─── 2.5. Extras según densidad: para medium/high agregamos accentos en
    # palabras de alto valor (cifras, palabras >7 letras, primera palabra de
    # frase tras pausa). Sin esto, A/B/C salían iguales porque el vocab
    # principal no cubría muchas palabras.
    extras_added = 0
    extras_target = cfg["extra_accent"]
    if extras_target > 0:
        for w in transcript_words:
            if extras_added >= extras_target:
                break
            word_text = w.get("word", "")
            n = normalize(word_text)
            if len(n) < 7:
                continue
            # Evitar palabras ya cubiertas por SFX matched
            at = float(w.get("start", 0))
            if any(abs(s["at"] - at) < 1.0 for s in sfx_marks):
                continue
            # Acento: alternar entre beep, click, throw (todos del pack github real)
            accent_sfx = ["beep1.mp3", "click1.mp3", "throw1.mp3"][extras_added % 3]
            sfx_marks.append({
                "at": round(at - 0.05, 2),
                "sound": accent_sfx,
                "volume": 0.3,
                "trigger": "density_extra",
                "matchedWord": word_text,
            })
            extras_added += 1

    # ─── 3. Deduplicar dentro de la ventana ────────────────────────────────────
    sfx_marks.sort(key=lambda s: s["at"])
    dedup_window = cfg["dedupe_window"]
    deduped: list[dict[str, Any]] = []
    for s in sfx_marks:
        # Aceptar si NO hay SFX previo dentro de dedup_window segundos
        if deduped and (s["at"] - deduped[-1]["at"]) < dedup_window:
            continue
        deduped.append(s)

    # ─── 4. Aplicar max según densidad ────────────────────────────────────────
    if len(deduped) > cfg["max"]:
        # Priorizar estructurales + matches con score alto
        deduped.sort(key=lambda s: (
            0 if s.get("trigger", "").startswith("structural") else 1,
            -(s.get("score") or 0.5),
        ))
        deduped = deduped[:cfg["max"]]
        deduped.sort(key=lambda s: s["at"])

    # ─── 5. SUPREME — SFX layering para impactos dobles ──────────────────────
    # Cada punch/cannon recibe una capa sub-bass (cannon1) 50ms después → doble impacto
    # cinematográfico. Cada whoosh recibe una capa de slide → swoosh "lleno". Solo para
    # medium/high density (low queda limpio).
    if target_density in ("medium", "high"):
        layers_to_add: list[dict[str, Any]] = []
        for s in deduped:
            sound = s.get("sound", "")
            at = s.get("at", 0)
            # PUNCH layer → cannon1 sub-bass 50ms after
            if sound in ("punch1.mp3", "punch2.mp3"):
                layers_to_add.append({
                    "at": round(at + 0.05, 2),
                    "sound": "cannon1.mp3",
                    "volume": 0.38,
                    "trigger": "layer_sub_bass",
                })
            # WHOOSH layer → slide1 30ms after para "fill" del whoosh
            elif sound in ("whoosh1.mp3", "whoosh2.mp3", "whoosh3.mp3", "whoosh4.mp3"):
                layers_to_add.append({
                    "at": round(at + 0.03, 2),
                    "sound": "slide1.mp3",
                    "volume": 0.28,
                    "trigger": "layer_slide_fill",
                })
            # CANNON ya viene con punch — agregar boom adicional (sub) para HIGH
            elif sound == "cannon1.mp3" and target_density == "high":
                layers_to_add.append({
                    "at": round(at + 0.08, 2),
                    "sound": "punch1.mp3",
                    "volume": 0.32,
                    "trigger": "layer_punch_tail",
                })
        deduped.extend(layers_to_add)
        deduped.sort(key=lambda s: s["at"])

    stats = {
        "matched": matched_count,
        "structural": structural_count,
        "after_dedupe": len(deduped),
        "density": target_density,
        "layered": sum(1 for s in deduped if s.get("trigger", "").startswith("layer_")),
    }
    return {"sfxMarks": deduped, "stats": stats}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript-file", required=True)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--density", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--out")
    args = parser.parse_args()

    raw = Path(args.transcript_file).read_text(encoding="utf-8")
    t_data = json.loads(raw)
    if isinstance(t_data, dict) and "words" in t_data:
        words = t_data["words"]
    else:
        print("[error] transcript sin .words[]", file=sys.stderr)
        return 1

    duration = args.duration
    if not duration and words:
        duration = max(float(w.get("end", 0)) for w in words) + 1
    elif not duration:
        duration = 30.0

    result = match_sfx_to_transcript(words, duration, args.density)

    print(
        f"[sfx-matcher] density={args.density} → {result['stats']['after_dedupe']} SFX "
        f"({result['stats']['matched']} matched + {result['stats']['structural']} structural)",
        file=sys.stderr,
    )

    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
