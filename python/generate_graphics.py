"""Genera specs de Modo Gráficos & Motion (dataViz + kineticHeadlines) desde el
transcript de un CLIP, automáticamente.

Estrategia:
  - CHARTS: heurística determinista sobre los words[] — detecta números/porcentajes
    y comparaciones ("de 23 a 78") y los convierte en contadores/barras en su timestamp.
    Los números son confiables sin LLM, así que esto es el caballo de batalla.
  - HEADLINES: frases potentes. Con Ollama (si está) elige mejores frases; si no,
    heurística (hook de apertura + frase con palabras de énfasis).

Output: long_form/graphics/{clip_id}.json  →  { "dataViz": [...], "kineticHeadlines": [...] }

Uso:
  python generate_graphics.py <clip_id>
  python generate_graphics.py --transcript <path> [--out <path>] [--no-llm]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from config import (
    DATA_ROOT,
    LF_GRAPHICS,
    LF_TRANSCRIPTS,
    OLLAMA_MODEL,
    OLLAMA_URL,
    ensure_long_form_dirs,
)

EFFECTS = ["split_letters", "glitch", "shimmer", "draw_on", "gradient_sweep", "tracking_in"]
ACCENTS = ["#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa", "#fb7185"]

# Palabras vacías para no usarlas como título de un chart.
STOP = {
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "y", "o",
    "que", "en", "a", "es", "son", "con", "por", "para", "se", "su", "al", "lo",
    "me", "te", "le", "nos", "ya", "muy", "más", "mas", "pero", "como", "esto",
    "esta", "este", "eso", "porque", "cuando", "donde", "si", "no", "the",
}

# Palabras de énfasis → buena señal de frase "potente" para titular.
EMPHASIS = {
    "nunca", "siempre", "secreto", "error", "clave", "gratis", "deja", "dejá",
    "stop", "increíble", "increible", "brutal", "verdad", "mentira", "nadie",
    "todos", "millones", "rápido", "rapido", "fácil", "facil", "ahora", "hoy",
    "atención", "atencion", "importante", "jamás", "jamas", "peor", "mejor",
}

# Concepto → ÍCONO (lucide). En vez de repetir el texto del subtítulo, mostramos un
# símbolo VISUAL que representa lo que se dice (esto "explica" sin saturar de texto).
# Keywords en español; matcheo por palabra/prefijo. Los íconos existen en ICON_MAP.
CONCEPT_ICONS = {
    "money": ["dinero", "plata", "peso", "pesos", "dólar", "dolar", "dólares", "dolares",
              "precio", "costo", "gratis", "vender", "vende", "venta", "ventas", "ganar",
              "ingreso", "ingresos", "factura", "pagar", "invertir", "inversión", "inversion",
              "negocio", "rentable", "ganancia", "ganancias", "facturar"],
    "trending": ["crecer", "crece", "crecimiento", "subir", "sube", "aumentar", "aumenta",
                 "escalar", "duplicar", "triplicar", "resultado", "resultados", "éxito",
                 "exito", "despegar", "explotar", "multiplicar"],
    "brain": ["idea", "ideas", "pensar", "mente", "aprender", "aprende", "estrategia",
              "inteligencia", "cerebro", "conocimiento", "entender", "lógica", "logica"],
    "rocket": ["lanzar", "lanzamiento", "despegue", "acelerar", "impulso", "empezar",
               "arrancar", "empieza", "arranca", "rápido", "rapido"],
    "target": ["objetivo", "objetivos", "meta", "metas", "foco", "enfocar", "enfoque",
               "apuntar", "nicho", "público", "publico"],
    "lightbulb": ["tip", "tips", "consejo", "consejos", "truco", "trucos", "secreto",
                  "secretos", "descubrir", "solución", "solucion", "aprendé"],
    "fire": ["increíble", "increible", "brutal", "fuego", "tendencia", "viral", "imperdible"],
    "heart": ["amor", "pasión", "pasion", "comunidad", "fans", "conexión", "conexion",
              "corazón", "corazon"],
    "eye": ["atención", "atencion", "observa", "visión", "vision", "fíjate", "fijate"],
    "warn": ["error", "errores", "cuidado", "peligro", "problema", "problemas", "evitar",
             "evita", "riesgo", "fallo", "trampa"],
    "check": ["listo", "hecho", "correcto", "funciona", "confirmar", "perfecto", "logrado",
              "resuelto"],
    "message": ["comentar", "comenta", "mensaje", "conversación", "conversacion", "pregunta",
                "responder", "comunicación", "comunicacion"],
    "award": ["premio", "ganador", "logro", "campeón", "campeon", "medalla", "trofeo"],
    "music": ["música", "musica", "audio", "sonido", "canción", "cancion", "ritmo"],
    "film": ["video", "videos", "grabar", "cámara", "camara", "contenido", "reel", "reels",
             "tiktok"],
    "gem": ["valor", "valioso", "premium", "calidad", "joya", "tesoro", "exclusivo"],
    "crown": ["rey", "reina", "líder", "lider", "liderar", "dominar", "corona"],
    "zap": ["energía", "energia", "poder", "fuerza", "impacto", "potente"],
    "star": ["estrella", "destacar", "destaca", "famoso", "brillar", "sobresalir"],
    "people": ["gente", "personas", "clientes", "cliente", "usuarios", "audiencia",
               "seguidores", "equipo"],
}
# Lookup invertido: palabra → ícono.
_WORD_TO_ICON: dict[str, str] = {}
for _icon, _kws in CONCEPT_ICONS.items():
    for _kw in _kws:
        _WORD_TO_ICON.setdefault(_kw, _icon)
# "people" no existe en ICON_MAP → cae a un ícono cercano.
_ICON_ALIAS = {"people": "heart"}

# Palabra que acompaña a la TARJETA FULLSCREEN de cada concepto (motion graphic).
ICON_LABELS = {
    "money": "DINERO", "trending": "CRECER", "brain": "IDEA", "rocket": "DESPEGAR",
    "target": "OBJETIVO", "lightbulb": "TIP", "fire": "CLAVE", "heart": "COMUNIDAD",
    "eye": "ATENCIÓN", "warn": "CUIDADO", "check": "LISTO", "message": "COMUNICAR",
    "award": "GANAR", "music": "AUDIO", "film": "CONTENIDO", "gem": "VALOR",
    "crown": "LIDERAR", "zap": "PODER", "star": "DESTACAR",
}


# ILUSTRACIONES ANIMADAS (Lottie de Noto, bajadas por download_animated_icons.py):
# concepto del ICON_MAP → archivo .json en {DATA_ROOT}/assets/lottie/noto. Cuando
# existe, el ícono se renderiza como ANIMACIÓN DE ESCENA (dinero volando, reloj
# sonando, cohete despegando…) en vez del ícono estático.
NOTO_FOR_ICON = {
    "money": "money", "trending": "trending", "brain": "brain", "rocket": "rocket",
    "target": "target", "lightbulb": "lightbulb", "fire": "fire", "heart": "heart",
    "eye": "eyes", "warn": "warning", "check": "check", "message": "speech",
    "award": "trophy", "film": "video", "gem": "gem", "crown": "crown",
    "zap": "zap", "star": "star", "people": "handshake",
}
_API_HOST = os.environ.get("VIRAL_API_HOST", "http://localhost:3000")


def _lottie_src_for(icon: str) -> str:
    """URL de la ilustración animada del concepto, o "" si no está descargada."""
    name = NOTO_FOR_ICON.get(icon)
    if not name:
        return ""
    f = Path(DATA_ROOT) / "assets" / "lottie" / "noto" / f"{name}.json"
    if not f.exists():
        return ""
    return f"{_API_HOST}/api/lottie/stream?file={name}.json"


def concept_icons(words: list[dict], duration: float, target: int) -> list[dict]:
    """Genera íconos VISUALES (no texto) representando los conceptos que se mencionan.
    Uno por tipo de concepto (no repite el mismo ícono), distribuidos en el tiempo."""
    seen: set[str] = set()
    hits: list[tuple[float, str]] = []
    for w in words:
        tok = _clean_word(str(w.get("word", ""))).lower().strip(".,!?¿¡")
        if len(tok) < 3:
            continue
        icon = _WORD_TO_ICON.get(tok)
        if not icon:
            # prefijo (plurales/conjugaciones): "vendés" → "vend…"
            for kw, ic in _WORD_TO_ICON.items():
                if len(kw) >= 5 and tok.startswith(kw[:5]):
                    icon = ic
                    break
        if not icon or icon in seen:
            continue
        seen.add(icon)
        hits.append((float(w.get("start", 0)), _ICON_ALIAS.get(icon, icon)))

    hits.sort(key=lambda h: h[0])

    # FALLBACK AMBIENTAL: si el transcript no menciona casi conceptos (clip pobre
    # en keywords), igual repartimos ilustraciones genéricas a lo largo del clip
    # para que SIEMPRE haya una ilustración animada en pantalla. Rota entre íconos
    # neutros (idea/chispa/foco/cohete…) en intervalos parejos. Aditivo: solo
    # entra cuando los matches reales no alcanzan para cubrir el clip.
    _GENERIC_ROTATION = ["lightbulb", "zap", "star", "target", "rocket", "brain", "trending", "eye"]
    span = max(1.0, (duration / max(1, target)) * 1.0)
    expected = int(duration // span) if duration > 0 else 0
    if len(hits) < expected:
        have_t = sorted(t for t, _ in hits)
        gi = 0
        t = round(span * 0.5, 2)
        while t < max(0.3, duration - 1.0) and (len(hits) + 0) < max(target, expected):
            # ¿ya hay un match real cerca de este instante? entonces no rellenamos.
            if all(abs(t - ht) > span * 0.55 for ht in have_t):
                ic = _GENERIC_ROTATION[gi % len(_GENERIC_ROTATION)]
                hits.append((round(t, 2), _ICON_ALIAS.get(ic, ic)))
                have_t.append(round(t, 2))
                have_t.sort()
                gi += 1
            t += span
        hits.sort(key=lambda h: h[0])

    out: list[dict] = []
    min_gap = max(2.5, (duration / max(1, target)) * 0.6)
    last_t = -99.0
    positions = ["top-right", "top-left", "bottom-right", "top-center"]
    # Cuántas tarjetas FULLSCREEN (pantalla negra + ícono gigante): ~1 cada 30s, tope 3.
    fs_cap = max(1, min(3, round(duration / 30))) if duration > 0 else 1
    fs_step = max(1, (len([h for h in hits]) // fs_cap) or 1)
    for t, icon in hits:
        if len(out) >= target:
            break
        if t - last_t < min_gap:
            continue
        last_t = t
        i = len(out)
        # Marcar como tarjeta fullscreen 1 de cada `fs_step` (hasta fs_cap).
        is_fs = (i % fs_step == 0) and (sum(1 for o in out if o.get("fullscreen")) < fs_cap)
        out.append({
            "at": round(max(0.3, t - 0.1), 2),
            "duration": 2.2 if is_fs else 1.8,
            "icon": icon,
            "position": "center" if is_fs else positions[i % len(positions)],
            "color": "#0a0a0a",
            "bg": ACCENTS[(i * 2) % len(ACCENTS)],
            "size": 120,
            "fullscreen": is_fs,
            "label": ICON_LABELS.get(icon, "") if is_fs else "",
            # ILUSTRACIÓN ANIMADA: si el concepto tiene Lottie de Noto descargado,
            # el render muestra la escena animada en vez del ícono estático.
            "lottieSrc": _lottie_src_for(icon),
        })
    return out


# ─── ILUSTRACIONES CC0 (personas + escenas) por concepto ──────────────────────
# A diferencia de los íconos line-art (currentColor), estas ilustraciones son
# MULTICOLOR y viven en assets/illustrations/<set>/*.svg (open-peeps, croodles,
# notionists = personas; open-doodles = escenas de acción con nombres literales:
# reading.svg, coffee.svg, running.svg…). Las baja download_illustrations.py.

_ILLUSTRATIONS_DIR = Path(DATA_ROOT) / "assets" / "illustrations"
# Sets de PERSONAS (figura humana) → para conceptos de gente/equipo/comunidad.
_PERSON_SETS = ("open-peeps", "croodles", "notionists")
# Set de ESCENAS de acción (open-doodles, filenames literales en inglés).
_SCENE_SET = "open-doodles"

# Concepto del CONCEPT_ICONS → qué clase de ilustración prefiere. "person" busca
# en los sets de personas; "action" busca una escena de open-doodles cuyo nombre
# coincida con el token; lo demás cae a la rotación determinista del pool.
_CONCEPT_KIND = {
    "people": "person", "heart": "person", "crown": "person",
    "message": "person", "award": "person",
    "rocket": "action", "trending": "action", "target": "action",
}
# Token de concepto → nombre de escena open-doodles (filenames literales en disco).
_CONCEPT_TO_DOODLE = {
    "rocket": "levitate", "trending": "jumping", "target": "meditating",
    "money": "unboxing", "brain": "reading", "lightbulb": "reading",
    "fire": "dancing", "music": "moshing", "film": "selfie", "eye": "sitting",
    "star": "groovy", "zap": "sprinting",
}


def _illustration_set_files(set_name: str) -> list[str]:
    """Lista (ordenada) de SVGs en assets/illustrations/<set>. [] si no existe."""
    d = _ILLUSTRATIONS_DIR / set_name
    if not d.exists():
        return []
    return sorted(p.name for p in d.glob("*.svg"))


def _illustration_url(set_name: str, file_name: str) -> str:
    """URL de stream de una ilustración (mismo host que las animaciones Lottie)."""
    return f"{_API_HOST}/api/illustrations/stream?file={set_name}/{file_name}"


def _illustration_for_concept(icon: str, rotation_idx: int) -> tuple[str, str] | None:
    """Resuelve un concepto a (set, file) de una ilustración en disco.

    - conceptos de PERSONA → rota entre los sets de personas (peeps/croodles/notionists);
    - conceptos de ACCIÓN → escena literal de open-doodles (reading.svg, running.svg…);
    - si no hay match temático, fallback determinista por rotation_idx sobre todo
      lo que exista en disco (people sets + scenes). Usa el mismo estilo de chequeo
      de existencia on-disk que _lottie_src_for. None si no hay NADA descargado.
    """
    kind = _CONCEPT_KIND.get(icon)

    # ACCIÓN → escena open-doodles cuyo filename coincide con el concepto.
    if kind == "action":
        doodle = _CONCEPT_TO_DOODLE.get(icon)
        if doodle:
            f = _ILLUSTRATIONS_DIR / _SCENE_SET / f"{doodle}.svg"
            if f.exists():
                return (_SCENE_SET, f.name)

    # PERSONA → rota entre los sets de personas que tengan archivos.
    if kind == "person":
        sets = [s for s in _PERSON_SETS if (_ILLUSTRATIONS_DIR / s).exists()]
        for off in range(len(sets)):
            s = sets[(rotation_idx + off) % len(sets)]
            files = _illustration_set_files(s)
            if files:
                return (s, files[rotation_idx % len(files)])

    # FALLBACK determinista: aplana todo lo descargado (personas + escenas) y
    # elige por rotation_idx. Misma semilla → misma ilustración (reproducible).
    pool: list[tuple[str, str]] = []
    for s in (*_PERSON_SETS, _SCENE_SET):
        for f in _illustration_set_files(s):
            pool.append((s, f))
    if not pool:
        return None
    return pool[rotation_idx % len(pool)]


def concept_illustrations(words: list[dict], duration: float, budget: int) -> list[dict]:
    """Genera ILUSTRACIONES CC0 (personas/escenas, multicolor) representando los
    conceptos mencionados — el primo "ilustración" de concept_icons(). Reusa el
    mismo mapa de keywords (_WORD_TO_ICON) y la misma distribución temporal/min-gap.

    Emite dicts con la forma de illustrationStickerSchema (at/duration/url/position/
    size/rotation/duotone(0)/duotoneShadow/duotoneHighlight/dropShadow). budget =
    cuántas como máximo. [] si no hay ilustraciones descargadas o no hay matches."""
    if budget <= 0 or duration <= 0:
        return []

    # ── matcheo de conceptos (idéntico a concept_icons) ──
    seen: set[str] = set()
    hits: list[tuple[float, str]] = []
    for w in words:
        tok = _clean_word(str(w.get("word", ""))).lower().strip(".,!?¿¡")
        if len(tok) < 3:
            continue
        icon = _WORD_TO_ICON.get(tok)
        if not icon:
            for kw, ic in _WORD_TO_ICON.items():
                if len(kw) >= 5 and tok.startswith(kw[:5]):
                    icon = ic
                    break
        if not icon or icon in seen:
            continue
        seen.add(icon)
        hits.append((float(w.get("start", 0)), icon))
    hits.sort(key=lambda h: h[0])

    # Rotación determinista por video (mismo transcript → mismas ilustraciones).
    rot = 0

    out: list[dict] = []
    min_gap = max(2.5, (duration / max(1, budget)) * 0.6)
    last_t = -99.0
    positions = ["bottom-right", "bottom-left", "right", "left"]
    for t, icon in hits:
        if len(out) >= budget:
            break
        if t - last_t < min_gap:
            continue
        resolved = _illustration_for_concept(icon, rot)
        if not resolved:
            # nada descargado para este concepto: probamos el siguiente hit
            continue
        set_name, file_name = resolved
        last_t = t
        i = len(out)
        out.append({
            "at": round(max(0.3, t - 0.1), 2),
            "duration": 2.6,
            "url": _illustration_url(set_name, file_name),
            "position": positions[i % len(positions)],
            "size": 420,
            "rotation": (-6 if i % 2 == 0 else 6),
            "duotone": 0,
            "duotoneShadow": "#171310",
            "duotoneHighlight": "#f3ede1",
            "dropShadow": False,
        })
        rot += 1
    return out


def _ollama_alive(timeout: float = 2.0) -> bool:
    """Probe RÁPIDO: ¿Ollama está levantado? Evita esperar el timeout largo de
    generación cuando el server ni siquiera responde (fallback silencioso)."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=timeout):
            return True
    except Exception:  # noqa: BLE001
        return False


def _ollama(prompt: str, temperature: float = 0.3, timeout: float = 120) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        # Los otros tres llamadores de Ollama lo agregaron despues de pisar el bug:
        # sin esto el modelo manda su razonamiento a `thinking` y `response` llega
        # VACIO -> "Expecting value" al parsear. Este quedo afuera. No se reprodujo
        # el fallo con Ollama 0.32.15, pero la inconsistencia es real y el fallback
        # de _enrich_cards_llm es SILENCIOSO (devuelve las tarjetas sin reescribir,
        # sin aviso), asi que un fallo aca no se notaria.
        "think": False,
        "options": {"temperature": temperature, "num_ctx": 8192},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate", data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body.get("response", "").strip()


def _clean_word(w: str) -> str:
    return re.sub(r"[^\wáéíóúñü%¿?¡!.,]", "", w, flags=re.UNICODE)


def _number_in(token: str) -> float | None:
    """Parsea un número de un token, manejando separadores es/en.

    Casos: 80 · 80% · 3,5 (decimal es) · 12.5 (decimal en) · 1.000 / 1,000 (miles) ·
    1.000.000 (millón) · 1.000,50 / 1,000.50 (miles+decimal). Devuelve None si no es
    claramente un número (evita inventar datos a partir de basura)."""
    t = token.strip().replace("%", "")
    if not re.fullmatch(r"[\d.,]+", t) or not any(c.isdigit() for c in t):
        return None
    has_comma, has_dot = "," in t, "." in t
    if has_comma and has_dot:
        # El separador que aparece más a la derecha es el decimal.
        if t.rfind(",") > t.rfind("."):
            t = t.replace(".", "").replace(",", ".")  # 1.000,50 -> 1000.50
        else:
            t = t.replace(",", "")  # 1,000.50 -> 1000.50
    elif has_comma:
        parts = t.split(",")
        # coma con 1 grupo y NO de 3 dígitos = decimal (3,5); si no, miles (1,000)
        t = t.replace(",", ".") if (len(parts) == 2 and len(parts[1]) != 3) else t.replace(",", "")
    elif has_dot:
        parts = t.split(".")
        # punto con 1 grupo y NO de 3 dígitos = decimal (12.5); si no, miles (1.000)
        if not (len(parts) == 2 and len(parts[1]) != 3):
            t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return None


# Unidades que confirman que un número es un DATO (no un año/edad casual).
DATA_UNITS = {
    "veces", "vez", "millones", "millón", "millon", "mil", "miles", "dólares",
    "dolares", "pesos", "euros", "clientes", "ventas", "personas", "usuarios",
    "seguidores", "horas", "días", "dias", "minutos", "segundos", "kilos",
    "puntos", "x", "%",
}
# Conectores válidos para una comparación "de X a Y" (crecimiento). "o"/"y" NO.
COMPARE_CONNECTORS = {"a", "hasta"}
# Conectores de RATIO "X de Y" / "X de cada Y" (proporción → pictografía/rating).
RATIO_CONNECTORS = {"de", "cada"}


def _is_year_or_age(token_clean: str, val: float, next_word: str) -> bool:
    """Filtra años (1900-2099) y edades ('40 años') que no son datos virales."""
    if 1900 <= val <= 2099 and val == int(val) and "." not in token_clean:
        return True
    nxt = _clean_word(next_word).lower()
    if nxt in ("años", "año", "anos", "ano"):
        return True
    return False


def heuristic_charts(words: list[dict], duration: float, max_charts: int = 4) -> list[dict]:
    """Detecta SOLO números que son datos reales (porcentajes, 'X veces/millones',
    comparaciones 'de X a Y') → charts en su timestamp. Evita años/edades y pares
    casuales para no inventar gráficas falsas."""
    charts: list[dict] = []
    used_times: list[float] = []
    n = len(words)

    def far_enough(t: float) -> bool:
        return all(abs(t - u) > 3.5 for u in used_times)

    def word_at(idx: int) -> str:
        return words[idx].get("word", "") if 0 <= idx < n else ""

    for i, w in enumerate(words):
        if len(charts) >= max_charts:
            break
        raw = w.get("word", "")
        tok = _clean_word(raw)
        val = _number_in(tok)
        if val is None or val == 0:
            continue
        at = float(w.get("start", 0))
        if not far_enough(at):
            continue
        is_pct = "%" in raw or _clean_word(word_at(i + 1)).lower() in ("%", "porciento")
        next1 = _clean_word(word_at(i + 1)).lower()
        next2 = _clean_word(word_at(i + 2)).lower()
        has_unit = is_pct or next1 in DATA_UNITS or next2 in DATA_UNITS
        if _is_year_or_age(tok, val, word_at(i + 1)):
            continue
        # ¿par "de X [conector] Y"? conector a/hasta = crecimiento; de/cada = ratio.
        partner = None
        rel = None  # "growth" | "ratio"
        for j in range(i + 1, min(i + 6, n)):
            v2 = _number_in(_clean_word(words[j].get("word", "")))
            if v2 is not None and v2 != val and v2 != 0:
                between = [_clean_word(word_at(k)).lower() for k in range(i + 1, j)]
                if any(b in COMPARE_CONNECTORS for b in between):
                    partner, rel = v2, "growth"
                elif any(b in RATIO_CONNECTORS for b in between):
                    partner, rel = v2, "ratio"
                break
        # ¿menciona "estrellas" cerca? → rating.
        near_star = "estrella" in next1 or "estrella" in next2
        # Sin unidad de dato Y sin par válido Y sin estrellas → no es dato, saltar.
        if not has_unit and partner is None and not near_star:
            continue
        # Título: 2-3 palabras previas no-vacías.
        ctx = []
        for k in range(i - 1, max(-1, i - 5), -1):
            cw = _clean_word(words[k].get("word", "")).lower()
            if cw and cw not in STOP and not _number_in(cw):
                ctx.insert(0, words[k].get("word", "").strip(".,"))
            if len(ctx) >= 3:
                break
        title = " ".join(ctx).strip().capitalize()[:34]
        accent = ACCENTS[len(charts) % len(ACCENTS)]
        base = {"at": round(max(0.2, at - 0.3), 2), "accent": accent, "fullscreen": True}
        k = len(charts)  # para rotar tipos y dar variedad visual

        if near_star or (rel == "ratio" and partner == 5 and val <= 5):
            # Rating de estrellas (X de 5).
            charts.append({**base, "duration": 2.8, "type": "rating",
                           "title": title, "data": [{"label": "", "value": val}], "max": 5})
        elif rel == "ratio" and partner is not None and 2 <= partner <= 20 and val <= partner:
            # Proporción "X de Y" → pictografía visual.
            charts.append({**base, "duration": 3.0, "type": "pictograph",
                           "title": title, "data": [{"label": "", "value": val}], "total": int(partner)})
        elif rel == "growth" and partner is not None:
            # Crecimiento "de X a Y" → alterna comparación VS / barras.
            ctype = "comparison" if k % 2 == 0 else "bar"
            charts.append({**base, "duration": 3.0, "type": ctype,
                           "title": title or ("VS" if ctype == "comparison" else "Comparación"),
                           "data": [{"label": "Antes", "value": val}, {"label": "Después", "value": partner}],
                           "suffix": "%" if is_pct else ""})
        elif is_pct:
            # Un porcentaje suelto → rota entre gauge / dona / contador (variedad visual).
            ctype = ["progress", "donut", "counter"][k % 3]
            charts.append({**base, "duration": 2.8, "type": ctype, "title": title,
                           "data": [{"label": title or "", "value": val}], "suffix": "%"})
        else:
            # Número con unidad de dato → contador (o gauge si parece proporción ≤100).
            charts.append({**base, "duration": 2.6, "type": "counter", "title": title,
                           "data": [{"value": val}], "suffix": ""})
        used_times.append(at)
    return charts


ORDINALS = {
    "primero": 1, "primera": 1, "segundo": 2, "segunda": 2, "tercero": 3, "tercera": 3,
    "cuarto": 4, "cuarta": 4, "quinto": 5, "quinta": 5,
}


def detect_steps(words: list[dict], duration: float) -> list[dict]:
    """Si el orador enumera ('primero… segundo… tercero…'), arma UN diagrama de pasos
    numerado con la frase corta que sigue a cada ordinal. Devuelve [] si no hay ≥2."""
    n = len(words)
    found: list[tuple[float, str]] = []
    for i, w in enumerate(words):
        tok = _clean_word(str(w.get("word", ""))).lower()
        if tok not in ORDINALS:
            continue
        label_words: list[str] = []
        for j in range(i + 1, min(i + 7, n)):
            nxt = _clean_word(str(words[j].get("word", ""))).lower()
            if nxt in ORDINALS:
                break
            raw = str(words[j].get("word", "")).strip()
            label_words.append(raw)
            if raw.endswith((".", "!", "?")):
                break
        label = " ".join(label_words).strip(" .,").capitalize()[:30]
        if label:
            found.append((float(w.get("start", 0)), label))
    if len(found) < 2:
        return []
    found.sort(key=lambda x: x[0])
    return [{
        "at": round(max(0.2, found[0][0] - 0.3), 2),
        "duration": 4.5,
        "type": "steps",
        "title": "",
        "data": [{"label": lbl, "value": idx + 1} for idx, (_, lbl) in enumerate(found[:5])],
        "accent": ACCENTS[2],
        "fullscreen": True,
    }]


def _sentences(words: list[dict]) -> list[dict]:
    """Agrupa words en frases (corte por puntuación fuerte o pausa > 0.6s)."""
    out: list[dict] = []
    cur: list[dict] = []
    for idx, w in enumerate(words):
        cur.append(w)
        txt = w.get("word", "")
        gap = (
            words[idx + 1].get("start", 0) - w.get("end", 0)
            if idx + 1 < len(words) else 99
        )
        if re.search(r"[.!?]$", txt.strip()) or gap > 0.6:
            if cur:
                out.append({
                    "text": " ".join(c.get("word", "") for c in cur).strip(),
                    "start": float(cur[0].get("start", 0)),
                    # words con timestamps (para pull-quotes palabra-por-palabra)
                    "words": list(cur),
                })
                cur = []
    if cur:
        out.append({
            "text": " ".join(c.get("word", "") for c in cur).strip(),
            "start": float(cur[0].get("start", 0)),
            "words": list(cur),
        })
    return out


# ─── LIMPIEZA DE TEXTO EN PANTALLA ───────────────────────────────────────────
# El transcript viene del HABLA: trae muletillas, conectores colgando y
# duplicados de dictado. Los SUBTÍTULOS deben ser fieles a lo dicho, pero los
# TITULARES/TARJETAS son texto de diseño: tienen que salir limpios y bien
# redactados. Este limpiador se aplica a TODO texto del transcript que se
# muestra como gráfica (editorial, headlines kinéticos, stats) en TODAS las
# modalidades (shorts y largos comparten este generador).

# Muletillas/conectores que NUNCA deben ABRIR un titular (se recortan).
_LEAD_FILLERS = {
    "eh", "em", "ehh", "mmm", "ajá", "aja", "ok", "okey", "vale",
    "pues", "bueno", "entonces", "osea", "digamos", "este,", "esto,",
    "y", "e", "o", "pero", "que", "porque", "como", "así", "asi",
    "verdad", "no?", "¿no?", "miren", "mira", "mirá", "oye", "fíjate", "fijate",
}
# Palabras que NUNCA deben CERRAR un titular (quedan colgando: "...de la").
_TRAIL_DANGLERS = {
    "que", "de", "del", "y", "e", "o", "u", "con", "para", "por", "en", "a", "al",
    "la", "el", "los", "las", "un", "una", "unos", "unas", "lo", "le", "les",
    "mi", "tu", "su", "sus", "mis", "tus", "se", "me", "te", "nos", "es", "son",
    "está", "esta", "están", "estan", "muy", "más", "mas", "pero", "porque",
    "como", "cuando", "donde", "si", "ya", "tan", "cada", "este", "esa", "ese",
    "hacia", "entre", "sobre", "sin", "ni", "qué", "cual", "cuál",
    # adverbios de relleno que quedan colgando tras un corte ("…que es prácticamente")
    "prácticamente", "practicamente", "básicamente", "basicamente", "literalmente",
    "realmente", "simplemente", "solamente", "obviamente", "justamente", "aproximadamente",
}

# Palabras genéricas que no sirven como PALABRA ACENTO (la resaltada en color).
_GENERIC_ACCENT = {
    "tenemos", "estamos", "podemos", "tiene", "tienen", "puede", "pueden",
    "hacer", "tener", "decir", "cosas", "cosa", "manera", "forma", "parte",
}
# Muletillas en CUALQUIER posición (se eliminan donde aparezcan).
_INLINE_FILLERS = {"eh", "em", "ehh", "mmm", "ehm", "ajá,", "osea,"}


# ─── CORRECTOR ORTOGRÁFICO/GRAMATICAL ES (confusiones típicas de Whisper) ─────
# Whisper translitera el HABLA y a veces confunde homófonos ("a ser"/"a hacer",
# "haber"/"a ver") o escribe números en letra. Estas reglas son DETERMINISTAS y
# CONSERVADORAS: solo corrigen patrones de ALTA confianza con contexto explícito;
# ante la duda, no tocan nada. Mismo input → mismo output, sin LLM.

# Números en letra → cifra (para "veinte por ciento" → "20%").
_NUM_WORDS = {
    "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
    "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "dieciséis": 16, "dieciseis": 16, "diecisiete": 17, "dieciocho": 18,
    "diecinueve": 19, "veinte": 20, "veintiuno": 21, "veintidós": 22,
    "veintidos": 22, "veintitrés": 23, "veintitres": 23, "veinticuatro": 24,
    "veinticinco": 25, "veintiséis": 26, "veintiseis": 26, "veintisiete": 27,
    "veintiocho": 28, "veintinueve": 29, "treinta": 30, "cuarenta": 40,
    "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80,
    "noventa": 90, "cien": 100,
}

# Interrogativas SIN tilde justo después de "¿" → con tilde (alta confianza:
# el signo de apertura confirma que es pregunta directa).
_INTERROG_ACCENTS = {
    "como": "cómo", "cuando": "cuándo", "donde": "dónde", "adonde": "adónde",
    "quien": "quién", "quienes": "quiénes", "cual": "cuál", "cuales": "cuáles",
    "cuanto": "cuánto", "cuanta": "cuánta", "cuantos": "cuántos",
    "cuantas": "cuántas", "que": "qué", "porque": "por qué",
}

# Sustantivos de ACCIÓN (cosas que se HACEN, no que se ES): solo con estos la
# regla "a ser"→"a hacer" es inequívoca. "Vamos a ser un equipo" / "va a ser un
# éxito" son copulativos VÁLIDOS y NO deben tocarse.
_HACER_NOUNS = (
    r"(?:experimentos?|pruebas?|tests?|ejercicios?|an[áa]lisis|resumen|"
    r"res[úu]menes|repasos?|videos?|sorteos?|retos?|tutorial(?:es)?|demos?|"
    r"demostraci[óo]n(?:es)?|comparaci[óo]n(?:es)?|simulaci[óo]n(?:es)?|"
    r"encuestas?|pausas?|viajes?|fiestas?|llamadas?|preguntas?|recorridos?)"
)

# (regex, reemplazo) — solo patrones con contexto que los hace inequívocos.
_CONFUSION_RULES: list[tuple[re.Pattern, str]] = [
    # "vamos a ser un experimento": 1ª/2ª persona + determinante + sustantivo de
    # ACCIÓN = casi seguro "hacer". Excluye va/van (3ª persona: "va a ser un
    # experimento brutal" puede ser copulativo válido) y cualquier sustantivo
    # fuera de la whitelist ("vamos a ser un equipo" se respeta).
    (re.compile(
        r"\b(voy|vas|vamos)\s+a\s+ser\s+"
        r"(un|una|unos|unas|el|la|los|las|este|esta|estos|estas|otro|otra)\s+"
        rf"({_HACER_NOUNS})\b",
        re.IGNORECASE), r"\1 a hacer \2 \3"),
    # "haber si funciona" → "a ver si" (el clásico de Whisper).
    (re.compile(r"\b(?:haber|aber|aver)\s+si\b", re.IGNORECASE), "a ver si"),
    # "aber"/"aver" no existen en español → siempre "a ver".
    (re.compile(r"\b(?:aber|aver)\b", re.IGNORECASE), "a ver"),
    # "vamos haber qué pasa" → "vamos a ver".
    (re.compile(r"\b(voy|vas|va|vamos|van)\s+haber\b", re.IGNORECASE), r"\1 a ver"),
    # "que si" como afirmación final ("claro que si.") → "que sí".
    (re.compile(r"\bque si\b(?=\s*[.,;:!?…]|\s*$)", re.IGNORECASE), "que sí"),
]

_PCT_RE = re.compile(r"\b([a-záéíóúñü]+|\d+)\s+por\s?ciento\b", re.IGNORECASE)
_X_NUM_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*[xX]\s*(?=\d)")
_MAS_RE = re.compile(r"(?<![,;])(\s)mas\b", re.IGNORECASE)
_INTERROG_RE = re.compile(r"¿\s*([A-Za-zÁÉÍÓÚÑÜáéíóúñü]+)")


def _fix_es_confusions(text: str) -> str:
    """Corrige confusiones de transcripción de ALTA confianza (determinista).

    Solo reglas con contexto inequívoco; ante la duda no toca. Idempotente:
    aplicarla dos veces da lo mismo que una.
    """
    t = str(text or "")
    if not t.strip():
        return t
    for pat, repl in _CONFUSION_RULES:
        t = pat.sub(repl, t)

    # "veinte por ciento" / "50 por ciento" → "20%" / "50%"
    def _pct(m: re.Match) -> str:
        w = m.group(1)
        if w.isdigit():
            return f"{w}%"
        n = _NUM_WORDS.get(w.lower())
        return f"{n}%" if n is not None else m.group(0)
    t = _PCT_RE.sub(_pct, t)

    # "2 x 3" / "2x1" → "2 por 3" (solo "x" entre cifras).
    t = _X_NUM_RE.sub(r"\1 por ", t)

    # "mas" → "más" salvo tras coma/; (el "mas" adversativo viene tras pausa).
    t = _MAS_RE.sub(r"\1más", t)

    # Interrogativa sin tilde justo tras "¿" → con tilde ("¿como…" → "¿cómo…").
    def _interrog(m: re.Match) -> str:
        w = m.group(1)
        rep = _INTERROG_ACCENTS.get(w.lower())
        if not rep:
            return m.group(0)
        if w[0].isupper():
            rep = rep[0].upper() + rep[1:]
        return "¿" + rep
    t = _INTERROG_RE.sub(_interrog, t)
    # "porque" abriendo una pregunta con "?" → "por qué".
    if "?" in t:
        t = re.sub(r"^(\s*)porque\b", r"\1por qué", t, flags=re.IGNORECASE)
    # "¿cómo estas?" → "¿cómo estás?" (solo con cierre/coma: contexto de saludo).
    t = re.sub(r"\b([Cc]ómo)\s+estas(?=\s*[?,!]|\s*$)", r"\1 estás", t)
    return t


def review_screen_texts(texts: list[str]) -> list[str]:
    """Aplica el corrector determinista a CUALQUIER lista de textos en pantalla
    (titulares kinéticos, títulos/labels de dataViz y steps, kickers…).
    Conserva MAYÚSCULAS si el texto venía todo en mayúsculas. Misma longitud,
    mismo orden; textos vacíos pasan intactos."""
    out: list[str] = []
    for t in texts:
        s = str(t or "")
        fixed = _fix_es_confusions(re.sub(r"\s+", " ", s).strip()) if s.strip() else s
        if s.isupper():
            fixed = fixed.upper()
        out.append(fixed)
    return out


def clean_screen_text(text: str, max_chars: int | None = None, min_words: int = 2) -> str:
    """Limpia un fragmento del transcript para mostrarlo COMO TITULAR.

    - recorta muletillas/conectores al inicio y palabras colgantes al final,
    - colapsa duplicados de dictado ("que que" → "que") y espacios,
    - arregla espacios antes de puntuación y signos ¿¡ sin pareja,
    - capitaliza la primera letra.
    Devuelve "" si después de limpiar no queda una frase digna (el caller
    salta el candidato y usa el siguiente — nunca muestra basura).
    """
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t:
        return ""
    # Corrector de confusiones de Whisper ANTES de tokenizar (determinista,
    # conservador: "a ser"→"a hacer" con determinante, "haber si"→"a ver si",
    # "veinte por ciento"→"20%", tildes de pregunta…).
    t = _fix_es_confusions(t)
    toks = t.split()
    # duplicados de dictado consecutivos (case-insensitive)
    dedup: list[str] = []
    for tok in toks:
        if dedup and _clean_word(tok).lower() == _clean_word(dedup[-1]).lower() and len(_clean_word(tok)) > 0:
            continue
        dedup.append(tok)
    toks = [tok for tok in dedup if _clean_word(tok).lower() not in _INLINE_FILLERS]
    # recortar muletillas al inicio (repetidamente: "bueno pues entonces…")
    while toks and _clean_word(toks[0]).lower().strip(",") in _LEAD_FILLERS:
        toks = toks[1:]
    # recortar colgantes al final (repetidamente: "…que es de la")
    while toks and _clean_word(toks[-1]).lower() in _TRAIL_DANGLERS:
        toks = toks[:-1]
    if len(toks) < min_words:
        return ""
    out = " ".join(toks).strip(" ,.;:")
    # puntuación: sin espacio antes de .,!?; signos de apertura sin pareja fuera
    out = re.sub(r"\s+([.,;:!?])", r"\1", out)
    if "¿" in out and "?" not in out:
        out = out.replace("¿", "")
    if "¡" in out and "!" not in out:
        out = out.replace("¡", "")
    out = out.strip()
    if max_chars and len(out) > max_chars:
        # cortar en límite de PALABRA (nunca a mitad de palabra)
        cut = out[:max_chars]
        cut = cut[: cut.rfind(" ")] if " " in cut else cut
        out = cut.strip(" ,.;:")
        # re-chequear colgantes tras el corte
        toks2 = out.split()
        while toks2 and _clean_word(toks2[-1]).lower() in _TRAIL_DANGLERS:
            toks2 = toks2[:-1]
        out = " ".join(toks2)
    if len(out.split()) < min_words:
        return ""
    return out[:1].upper() + out[1:]


def _disfluency_penalty(text: str) -> float:
    """Cuántas muletillas trae la frase (para que el scoring prefiera frases limpias)."""
    toks = [_clean_word(t).lower() for t in str(text).split()]
    fillers = sum(1 for t in toks if t in {"eh", "em", "mmm", "osea", "este", "pues", "bueno", "verdad"})
    dups = sum(1 for a, b in zip(toks, toks[1:]) if a and a == b)
    return fillers * 0.6 + dups * 0.8


# ─── EDITORIAL: escenas tipográficas estilo documental (split-screen) ─────────
# Ícono line-art por concepto (los 6 dibujados en line-art-icons.tsx).
_EDITORIAL_ICON_WORDS = {
    "clock": {"hora", "horas", "minuto", "minutos", "tiempo", "rapido", "rápido", "tarde"},
    "hourglass": {"esperar", "paciencia", "lento", "proceso", "mientras"},
    "calendar": {"semana", "semanas", "dia", "días", "dias", "mes", "meses", "calendario", "agenda"},
    "funnel": {"cliente", "clientes", "venta", "ventas", "convertir", "conversion", "conversión", "leads", "prospecto", "prospectos"},
    "faucet": {"dinero", "gasto", "gaste", "gasté", "presupuesto", "invertir", "inversion", "inversión", "pesos", "dolares", "dólares", "pague", "pagué"},
    "radar": {"anuncio", "anuncios", "campaña", "campañas", "alcance", "publicidad", "audiencia", "plataforma"},
    "chart": {"crecer", "crecimiento", "resultado", "resultados", "subir", "aumentar", "duplicar", "metrica", "métricas", "numeros", "números"},
    "lightbulb": {"idea", "ideas", "solucion", "solución", "descubri", "descubrí", "truco", "tip", "consejo"},
    "target": {"objetivo", "objetivos", "meta", "metas", "enfocar", "enfoque", "preciso", "exacto"},
    "rocket": {"lanzar", "lanzamiento", "despegar", "empezar", "arrancar", "comenzar", "iniciar"},
    "brain": {"mente", "cerebro", "pensar", "piensa", "aprender", "aprendi", "aprendí", "psicologia", "psicología", "mentalidad"},
    "lock": {"secreto", "secretos", "privado", "exclusivo", "oculto", "clave"},
    "megaphone": {"anunciar", "comunicar", "mensaje", "decir", "hablar", "grita", "promocionar"},
    "scale": {"comparar", "comparacion", "comparación", "balance", "decidir", "decision", "decisión", "versus", "elegir"},
    "gears": {"sistema", "sistemas", "proceso", "automatizar", "automatico", "automático", "herramienta", "herramientas", "funciona"},
    "trophy": {"ganar", "gane", "gané", "exito", "éxito", "logro", "lograr", "premio", "mejor", "campeon", "campeón"},
    "route": {"camino", "ruta", "paso", "pasos", "estrategia", "plan", "mapa", "guia", "guía"},
    "fire": {"viral", "tendencia", "explotar", "exploto", "explotó", "boom", "caliente", "urgente"},
    # ── 10 ilustraciones a mano NUEVAS (money, diamond, eye, mountain, magnet,
    #    compass, network, shield, coin, heart). ──
    "money": {"plata", "billete", "billetes", "ganancia", "ganancias", "ingreso", "ingresos", "facturacion", "facturación", "millones", "rico"},
    "diamond": {"valor", "valioso", "premium", "calidad", "joya", "lujo", "unico", "único"},
    "eye": {"ver", "mira", "mirá", "atencion", "atención", "observa", "fijate", "fíjate", "ojo", "detalle"},
    "mountain": {"reto", "desafio", "desafío", "dificil", "difícil", "cima", "esfuerzo", "superar"},
    "magnet": {"atraer", "atrae", "atraen", "captar", "enganchar", "irresistible", "magnetico", "magnético"},
    "compass": {"direccion", "dirección", "rumbo", "norte", "orientar", "perdido", "claridad"},
    "network": {"red", "redes", "conectar", "conexion", "conexión", "contactos", "viralizar", "compartir"},
    "shield": {"proteger", "proteccion", "protección", "riesgo", "riesgos", "defensa", "blindar"},
    "coin": {"moneda", "centavo", "precio", "precios", "cuesta", "costo", "barato", "caro"},
    "heart": {"amor", "pasion", "pasión", "emocion", "emoción", "corazon", "corazón", "sentir", "conectan"},
    # ── Conceptos extra → íconos LUCIDE (animación genérica; 1,500+ disponibles,
    #    cualquier nombre kebab-case de lucide.dev sirve como valor). ──
    "users": {"equipo", "equipos", "gente", "personas", "comunidad", "grupo", "socios"},
    "shield-check": {"seguro", "seguridad", "confianza", "garantia", "garantía", "proteger"},
    "graduation-cap": {"curso", "cursos", "capacitacion", "capacitación", "clase", "taller", "certificacion", "certificación"},
    "store": {"negocio", "negocios", "tienda", "empresa", "empresas", "local", "emprendimiento"},
    "smartphone": {"celular", "telefono", "teléfono", "whatsapp", "llamada", "mensaje"},
    "mail": {"correo", "email", "newsletter", "inbox"},
    "search": {"buscar", "busca", "investigar", "analizar", "estudiar", "encontrar"},
    "handshake": {"acuerdo", "alianza", "cerrar", "trato", "negociar"},
    "wallet": {"cartera", "ahorro", "ahorrar", "cobrar", "cobro", "facturar"},
    "presentation": {"presentacion", "presentación", "reunion", "reunión", "junta", "pitch"},
    "mic": {"hablar", "voz", "podcast", "entrevista", "audio"},
    "video": {"video", "videos", "grabar", "camara", "cámara", "contenido"},
    "globe": {"mundo", "global", "internacional", "internet", "online"},
    "key": {"acceso", "desbloquear", "contraseña", "password"},
    "alarm-clock": {"deadline", "plazo", "urgencia", "ya"},
    "book-open": {"libro", "libros", "leer", "lectura", "manual", "historia"},
    "puzzle": {"problema", "problemas", "resolver", "pieza", "encajar"},
    "sprout": {"empezar", "inicio", "semilla", "sembrar", "pequeño"},
    "crown": {"lider", "líder", "liderazgo", "rey", "experto", "autoridad"},
    "ban": {"error", "errores", "evitar", "nunca", "prohibido", "dejar"},
}
_KICKERS = ["LA VERDAD", "EL DATO", "CÓMO LE HAGO", "EL CONTEXTO", "LO QUE APRENDÍ", "EL RESULTADO"]

# Marcadores de primera persona → la frase es candidata a PULL-QUOTE (cita).
_QUOTE_MARKERS = {
    "yo", "mi", "mis", "me", "mí", "creo", "siento", "pienso",
    "aprendí", "aprendi", "descubrí", "descubri", "entendí", "entendi",
}
_NUM_UNIT_RE = re.compile(r"^\$?\d[\d.,]*$")



# ─── Ampliación del vocabulario (25 ago 2026) ────────────────────────────────
#
# El emparejamiento semántico existía pero fallaba por FLEXIONES. Probado con una
# frase real del material del usuario —«cuidado con la mirada porque si bajas los
# ojos transmitís otra cosa»— no encontraba nada: el diccionario tenía "mira" y
# "ojo", pero no "mirada" ni "ojos". Cuando no hay coincidencia la tarjeta cae a
# la rotación al azar, que es de donde salían los emparejamientos absurdos.
#
# Se agregan las formas que la gente usa AL HABLAR (plurales, sustantivos
# derivados, conjugaciones frecuentes) y familias nuevas del nicho del proyecto:
# comunicación, lenguaje corporal, confianza, error y decisión.
_AMPLIACION_ICON_WORDS: dict[str, set[str]] = {
    "eye": {"mirada", "miradas", "ojos", "mirar", "mirando", "viendo", "ves", "vean",
            "observar", "observando", "notar", "notas", "percibe", "percibir",
            "visual", "vista", "cuidado"},
    "users": {"cliente", "clientes", "audiencia", "publico", "público", "seguidores",
              "usuario", "usuarios", "companero", "compañero", "companeros",
              "compañeros", "todos", "nadie", "alguien", "demas", "demás"},
    "megaphone": {"decir", "dice", "dices", "decis", "decís", "hablar", "hablas",
                  "hablando", "contar", "contas", "contás", "mensaje", "mensajes",
                  "comunicar", "comunicacion", "comunicación", "voz", "tono",
                  "palabra", "palabras", "explicar", "explicas"},
    "handshake": {"confianza", "confiar", "confia", "confía", "credibilidad",
                  "honesto", "honestidad", "acuerdo", "relacion", "relación",
                  "vinculo", "vínculo", "conectar", "conexion", "conexión"},
    "heart": {"emocion", "emoción", "emociones", "sentir", "siente", "sientes",
              "sentimiento", "querer", "quiere", "amor", "pasion", "pasión",
              "carino", "cariño", "empatia", "empatía"},
    "brain": {"pensar", "piensa", "piensas", "pensamiento", "mente", "cabeza",
              "idea", "ideas", "entender", "entiende", "aprender", "aprendes",
              "recordar", "memoria", "cerebro", "imaginar", "imagina"},
    "shield": {"error", "errores", "equivocar", "equivoca", "fallar", "falla",
               "fallas", "riesgo", "riesgos", "peligro", "proteger", "evitar",
               "problema", "problemas", "miedo"},
    "route": {"paso", "pasos", "camino", "empezar", "empieza", "empiezas",
              "seguir", "sigue", "continuar", "siguiente", "despues", "después",
              "primero", "luego", "entonces"},
    "scale": {"decidir", "decide", "decides", "decision", "decisión", "elegir",
              "elige", "eliges", "opcion", "opciones", "comparar", "versus",
              "mejor", "peor", "conviene"},
    "target": {"objetivo", "objetivos", "meta", "metas", "lograr", "logras",
               "conseguir", "consigues", "resultado", "resultados", "exito",
               "éxito", "funciona", "sirve"},
    "clock": {"momento", "momentos", "segundo", "segundos", "ahora", "antes",
              "ya", "pronto", "espera", "esperas", "dura", "duracion", "duración"},
    "money": {"precio", "precios", "cobrar", "cobras", "vender", "vendes",
              "venta", "ventas", "comprar", "compra", "caro", "barato",
              "vale", "valor", "cuesta"},
    "lightbulb": {"secreto", "secretos", "truco", "trucos", "clave", "claves",
                  "descubrir", "descubre", "aprende", "leccion", "lección",
                  "insight", "revelar", "revela"},
}

for _icono, _palabras in _AMPLIACION_ICON_WORDS.items():
    _EDITORIAL_ICON_WORDS.setdefault(_icono, set()).update(_palabras)


def _icon_for_text(text: str) -> str:
    toks = {_clean_word(t).lower().strip(".,!?¿¡") for t in text.split()}
    for icon, vocab in _EDITORIAL_ICON_WORDS.items():
        if toks & vocab:
            return icon
    return ""


# Fallback rotativo: NINGUNA tarjeta queda sin ilustración (la pantalla nunca se
# ve vacía). Rota entre las dibujadas a mano que funcionan como "genéricas".
_FALLBACK_ICONS = [
    "lightbulb", "chart", "target", "route", "megaphone", "brain", "gears", "trophy",
    "eye", "compass", "network", "diamond", "rocket", "magnet", "shield", "coin",
]

# ─── POOL GRANDE de ilustraciones (28 a mano + ~230 Lucide curados) ───────────
# Cada nombre Lucide se anima genéricamente (draw-on + flotación + nodo dorado)
# por LineArtLucide, y los 4 tratamientos FX (anillo/ráfaga/marco/limpio) los
# multiplican visualmente. VALIDADO contra lucide-react real con
# `node remotion/check-lucide-names.mjs` (un typo = tarjeta sin ilustración).
_LUCIDE_POOL = [
    # dinero / negocio
    "badge-dollar-sign", "banknote", "piggy-bank", "credit-card", "coins",
    "hand-coins", "receipt", "shopping-cart", "shopping-bag", "store",
    "briefcase", "building", "building-2", "landmark", "wallet", "gem",
    "percent", "calculator", "badge-percent", "circle-dollar-sign",
    # crecimiento / métricas / logro
    "trending-up", "trending-down", "bar-chart-3", "line-chart", "pie-chart",
    "activity", "gauge", "goal", "crosshair", "milestone", "flag", "award",
    "medal", "crown", "gift", "sparkles", "star", "zap", "flame",
    # personas / comunicación
    "users", "user-plus", "user-check", "contact", "handshake",
    "heart-handshake", "smile", "laugh", "speech", "message-circle",
    "messages-square", "mail", "send", "phone", "phone-call", "mic",
    "podcast", "radio", "rss", "thumbs-up", "hand-heart",
    # tiempo
    "timer", "alarm-clock", "calendar-days", "calendar-check", "history",
    "watch", "sunrise", "sunset", "sun", "moon",
    # tecnología
    "smartphone", "laptop", "monitor", "tv", "camera", "video", "clapperboard",
    "film", "image", "images", "music", "headphones", "speaker", "volume-2",
    "wifi", "signal", "bluetooth", "battery-charging", "plug", "cpu",
    "hard-drive", "server", "database", "cloud", "cloud-download",
    "cloud-upload", "code", "terminal", "bug", "bot", "brain-circuit",
    "qr-code", "scan", "fingerprint", "key-round", "shield-check",
    # mapa / viaje / aventura
    "map", "map-pin", "navigation", "globe", "plane", "car", "bus",
    "train-front", "ship", "bike", "footprints", "mountain-snow", "tent",
    "trees", "anchor", "sailboat", "satellite", "satellite-dish", "orbit",
    # educación / ciencia
    "graduation-cap", "book-open", "book", "library", "notebook-pen", "pencil",
    "pen-tool", "ruler", "school", "backpack", "microscope", "flask-conical",
    "atom", "dna", "telescope", "binoculars",
    # vida / objetos
    "coffee", "pizza", "utensils", "apple", "carrot", "cake", "wine", "salad",
    "soup", "dumbbell", "bed", "home", "bath", "shirt", "scissors", "wand-2",
    "paintbrush", "palette", "drama", "party-popper", "ticket", "umbrella",
    # trabajo / herramientas / logística
    "hammer", "wrench", "paperclip", "pin", "bookmark", "folder",
    "folder-open", "file-text", "files", "clipboard-list", "clipboard-check",
    "archive", "package", "package-open", "box", "boxes", "truck", "factory",
    "warehouse", "recycle", "leaf", "sprout", "flower-2",
    # naturaleza / animales
    "bird", "cat", "dog", "fish", "rabbit", "squirrel", "turtle",
    "cloud-lightning", "cloud-rain", "snowflake", "droplets", "waves", "wind",
    "rainbow", "thermometer",
    # conceptos / símbolos
    "puzzle", "blocks", "layers", "layout-grid", "component", "shapes",
    "infinity", "hash", "at-sign", "link", "bell", "bell-ring", "search",
    "search-check", "filter", "list-checks", "badge-check", "alert-triangle",
    "ban", "ghost", "lock-open", "unlock", "key", "door-open", "door-closed",
    "lightbulb-off", "eye-off", "swords", "presentation", "projector",
    "newspaper", "quote", "type", "languages", "earth", "hourglass",
]


# ─── Iconos EXTERNOS (Ola 4): Phosphor duotone ("ph:") y Tabler ("tb:") ───────
# Descargados por download_editorial_icons.py a {DATA_ROOT}/assets/icons/.
# Solo entran al pool los que EXISTEN en disco (sin pack descargado → pool
# clásico, cero regresión). El render los pinta con el acento (currentColor).

_EXT_ICONS_DIR = Path(DATA_ROOT) / "assets" / "icons"

# Curaduría de conceptos fuertes (los nombres inexistentes se filtran solos).
_PHOSPHOR_POOL = [
    "ph:rocket-launch", "ph:brain", "ph:lightbulb", "ph:trophy", "ph:target",
    "ph:chart-line-up", "ph:chart-bar", "ph:chart-pie-slice", "ph:coins",
    "ph:piggy-bank", "ph:wallet", "ph:bank", "ph:credit-card", "ph:gift",
    "ph:crown", "ph:diamond", "ph:fire", "ph:lightning", "ph:sun", "ph:globe",
    "ph:map-pin", "ph:compass", "ph:airplane-takeoff", "ph:users-three",
    "ph:handshake", "ph:chat-circle-dots", "ph:megaphone", "ph:microphone",
    "ph:camera", "ph:video-camera", "ph:music-notes", "ph:headphones",
    "ph:book-open", "ph:graduation-cap", "ph:magnifying-glass", "ph:lock-key",
    "ph:key", "ph:shield-check", "ph:gear", "ph:wrench", "ph:paint-brush",
    "ph:scissors", "ph:pencil-line", "ph:eye", "ph:smiley", "ph:thumbs-up",
    "ph:clock", "ph:hourglass-high", "ph:infinity", "ph:puzzle-piece",
    "ph:flag-banner", "ph:bell-ringing", "ph:envelope-open", "ph:device-mobile",
    "ph:laptop", "ph:code", "ph:database", "ph:cpu", "ph:wifi-high",
    "ph:plant", "ph:tree", "ph:flower-lotus", "ph:leaf", "ph:mountains",
    "ph:waves", "ph:anchor", "ph:atom", "ph:flask", "ph:dna", "ph:barbell",
    "ph:medal", "ph:strategy", "ph:steps", "ph:path", "ph:signpost",
    "ph:binoculars", "ph:butterfly", "ph:campfire", "ph:shooting-star",
    "ph:sparkle", "ph:magic-wand", "ph:alarm", "ph:calendar-check",
    "ph:timer", "ph:gauge", "ph:scales", "ph:storefront", "ph:shopping-cart",
    "ph:package", "ph:truck", "ph:armchair", "ph:coffee", "ph:fork-knife",
]
_TABLER_POOL = [
    "tb:rocket", "tb:brain", "tb:bulb", "tb:trophy", "tb:target-arrow",
    "tb:chart-line", "tb:chart-bar", "tb:chart-pie", "tb:coin", "tb:cash",
    "tb:pig-money", "tb:wallet", "tb:building-bank", "tb:credit-card",
    "tb:gift", "tb:crown", "tb:diamond", "tb:flame", "tb:bolt", "tb:sun",
    "tb:world", "tb:map-pin", "tb:compass", "tb:plane-departure", "tb:users",
    "tb:heart-handshake", "tb:message-circle", "tb:speakerphone",
    "tb:microphone", "tb:camera", "tb:video", "tb:music", "tb:headphones",
    "tb:book", "tb:school", "tb:zoom-check", "tb:lock", "tb:key",
    "tb:shield-check", "tb:settings", "tb:tool", "tb:brush", "tb:scissors",
    "tb:pencil", "tb:eye", "tb:mood-smile", "tb:thumb-up", "tb:clock",
    "tb:hourglass", "tb:infinity", "tb:puzzle", "tb:flag", "tb:bell",
    "tb:mail-opened", "tb:device-mobile", "tb:device-laptop", "tb:code",
    "tb:database", "tb:cpu", "tb:wifi", "tb:plant", "tb:trees", "tb:flower",
    "tb:leaf", "tb:mountain", "tb:ripple", "tb:anchor", "tb:atom", "tb:flask",
    "tb:dna", "tb:barbell", "tb:medal", "tb:chess-knight", "tb:stairs",
    "tb:route", "tb:binoculars", "tb:campfire", "tb:stars",
    "tb:sparkles", "tb:wand", "tb:alarm", "tb:calendar-check", "tb:gauge",
    "tb:scale", "tb:building-store", "tb:shopping-cart", "tb:package",
    "tb:truck-delivery", "tb:armchair", "tb:coffee", "tb:run", "tb:swimming",
    "tb:bike", "tb:car", "tb:train", "tb:sailboat", "tb:telescope",
    "tb:microscope", "tb:sunrise", "tb:moon-stars",
]


def _ext_icon_exists(name: str) -> bool:
    """¿El SVG del icono externo está descargado? (ph:/tb: → archivo en disco)."""
    if name.startswith("ph:"):
        return (_EXT_ICONS_DIR / "phosphor-duotone" / f"{name[3:]}-duotone.svg").exists()
    if name.startswith("tb:"):
        return (_EXT_ICONS_DIR / "tabler" / f"{name[3:]}.svg").exists()
    return True


def _icon_pool(seed: int) -> list[str]:
    """Pool de ilustraciones BARAJADO determinísticamente POR VIDEO:
    dos videos distintos usan ilustraciones DISTINTAS (el mismo video re-rendea
    igual). Ola 4: se suman Phosphor duotone y Tabler (solo los descargados),
    ~450 ilustraciones distintas en rotación."""
    ext = [n for n in [*_PHOSPHOR_POOL, *_TABLER_POOL] if _ext_icon_exists(n)]
    pool = list(dict.fromkeys([*_FALLBACK_ICONS, *_LUCIDE_POOL, *ext]))
    rnd = random.Random(seed)
    rnd.shuffle(pool)
    return pool

# ─── Mapa editorial (Ola 7): gazetteer local ES → lat/lon (sin APIs) ──────────
# Si el transcript menciona un lugar, el render muestra un GLOBO que gira y
# hace zoom hasta ese punto (GlobeZoom con d3-geo, offline).
_GAZETTEER: dict[str, tuple[float, float]] = {
    # países
    "méxico": (23.6, -102.5), "mexico": (23.6, -102.5),
    "estados unidos": (39.8, -98.5), "gringos": (39.8, -98.5),
    "españa": (40.4, -3.7), "argentina": (-34.6, -64.0),
    "colombia": (4.6, -74.0), "chile": (-33.4, -70.6),
    "perú": (-9.2, -75.0), "peru": (-9.2, -75.0),
    "brasil": (-14.2, -51.9), "ecuador": (-1.8, -78.2),
    "venezuela": (6.4, -66.6), "guatemala": (15.8, -90.2),
    "costa rica": (9.7, -83.8), "panamá": (8.5, -80.8), "panama": (8.5, -80.8),
    "uruguay": (-32.5, -55.8), "bolivia": (-16.3, -63.6),
    "cuba": (21.5, -77.8), "república dominicana": (18.7, -70.2),
    "japón": (36.2, 138.2), "japon": (36.2, 138.2),
    "china": (35.8, 104.1), "india": (20.6, 78.9),
    "alemania": (51.1, 10.4), "francia": (46.2, 2.2),
    "italia": (41.9, 12.5), "portugal": (39.4, -8.2),
    "inglaterra": (52.3, -1.2), "reino unido": (54.0, -2.0),
    "canadá": (56.1, -106.3), "canada": (56.1, -106.3),
    "australia": (-25.2, 133.7), "rusia": (61.5, 105.3),
    "corea": (35.9, 127.7), "suiza": (46.8, 8.2),
    # ciudades
    "cdmx": (19.43, -99.13), "ciudad de méxico": (19.43, -99.13),
    "guadalajara": (20.67, -103.35), "monterrey": (25.67, -100.31),
    "cancún": (21.16, -86.85), "cancun": (21.16, -86.85),
    "tijuana": (32.51, -117.04), "puebla": (19.04, -98.2),
    "mérida": (20.97, -89.62), "querétaro": (20.59, -100.39),
    "nueva york": (40.7, -74.0), "miami": (25.76, -80.19),
    "los ángeles": (34.05, -118.24), "los angeles": (34.05, -118.24),
    "houston": (29.76, -95.37), "chicago": (41.88, -87.63),
    "madrid": (40.42, -3.7), "barcelona": (41.39, 2.17),
    "bogotá": (4.71, -74.07), "bogota": (4.71, -74.07),
    "buenos aires": (-34.6, -58.38), "lima": (-12.05, -77.04),
    "santiago": (-33.45, -70.67), "tokio": (35.68, 139.69),
    "parís": (48.86, 2.35), "paris": (48.86, 2.35),
    "londres": (51.51, -0.13), "dubai": (25.2, 55.3),
    "berlín": (52.52, 13.4), "roma": (41.9, 12.5),
}


def editorial_map(words: list[dict], duration: float) -> dict | None:
    """Primera mención de un lugar del gazetteer → escena de globo (máx 1 por
    video). Devuelve {at, duration, lat, lon, label} o None. Lugares de 2
    palabras se buscan primero (\"nueva york\" antes que nada que matchee \"york\")."""
    if duration < 12 or not words:
        return None
    toks = [(_clean_word(w.get("word", "")).lower(), float(w.get("start", 0))) for w in words]
    names = sorted(_GAZETTEER, key=lambda n: -len(n.split()))
    for name in names:
        parts = name.split()
        for i in range(len(toks) - len(parts) + 1):
            if all(toks[i + j][0] == parts[j] for j in range(len(parts))):
                at = round(max(0.3, toks[i][1] - 0.2), 2)
                if at > duration - 4:
                    continue  # mención al final: no hay tiempo para el zoom
                lat, lon = _GAZETTEER[name]
                return {
                    "at": at,
                    "duration": round(min(5.0, duration - at - 0.5), 2),
                    "lat": lat,
                    "lon": lon,
                    "label": name.upper(),
                }
    return None


# Tarjetas VISUALES de relleno: ilustración protagonista + kicker (sin titular).
# Se usan para que el lienzo NUNCA quede vacío más de ~1s entre frases fuertes.
# Frases de apoyo para las tarjetas visuales, agrupadas por FAMILIA de ilustración.
#
# Antes era una lista plana de seis frases que rotaba por su cuenta, mientras la
# ilustración rotaba por la suya entre ~450 opciones. Dos ruedas de distinto
# tamaño girando en paralelo emparejan cualquier cosa con cualquier cosa: se
# reportó "OJO ACÁ" ilustrado con unas tijeras. Ahora la frase se elige DENTRO de
# la familia del ícono, así que aunque el texto siga rotando para dar variedad,
# nunca contradice lo que se ve.
_KICKERS_POR_FAMILIA: dict[str, list[str]] = {
    "mirar": ["MIRÁ ESTO", "OJO ACÁ", "FIJATE"],
    "tiempo": ["MIENTRAS TANTO", "CON EL TIEMPO", "JUSTO ACÁ"],
    "dinero": ["LA CUENTA", "EL NÚMERO", "LO QUE CUESTA"],
    "gente": ["LA GENTE", "DEL OTRO LADO", "ENTRE NOSOTROS"],
    "idea": ["EL PUNTO CLAVE", "ACÁ ESTÁ", "NO ES CASUALIDAD"],
    "camino": ["EL CAMINO", "HACIA DÓNDE", "EL SIGUIENTE PASO"],
    "generico": ["EL DETALLE", "EL PUNTO CLAVE", "MIRÁ ESTO"],
}

# A qué familia pertenece cada ilustración. Sólo hace falta clasificar las que se
# usan seguido: lo que no esté acá cae en "generico", que es neutro y no puede
# contradecir a ninguna imagen.
_FAMILIA_DE_ICONO: dict[str, str] = {
    **{k: "mirar" for k in ("eye", "radar", "crosshair", "search", "scan-eye", "camera",
                            "binoculars", "target", "focus", "zoom-in", "telescope")},
    **{k: "tiempo" for k in ("clock", "hourglass", "timer", "alarm-clock", "history",
                             "calendar", "calendar-days", "calendar-check", "watch")},
    **{k: "dinero" for k in ("money", "coin", "coins", "banknote", "piggy-bank", "wallet",
                             "credit-card", "receipt", "calculator", "percent", "diamond",
                             "gem", "badge-dollar-sign", "circle-dollar-sign", "faucet")},
    **{k: "gente" for k in ("users", "user-plus", "user-check", "handshake", "heart",
                            "heart-handshake", "smile", "message-circle", "speech",
                            "megaphone", "mic", "contact", "hand-heart")},
    **{k: "idea" for k in ("lightbulb", "brain", "sparkles", "star", "zap", "flame",
                           "fire", "gears", "puzzle", "key")},
    **{k: "camino" for k in ("route", "compass", "map", "milestone", "flag", "mountain",
                             "trending-up", "goal", "rocket", "arrow-right", "network")},
}


def _kicker_para(icono: str, i: int) -> str:
    """Frase que acompaña a una ilustración, sin contradecirla.

    Rota dentro de la familia para que dos tarjetas seguidas del mismo tipo no
    digan lo mismo, pero nunca cruza de familia — que era el bug reportado.
    """
    familia = _FAMILIA_DE_ICONO.get((icono or "").lower(), "generico")
    opciones = _KICKERS_POR_FAMILIA[familia]
    return opciones[i % len(opciones)]


_VISUAL_KICKERS = ["MIRÁ ESTO", "EL DETALLE", "MIENTRAS TANTO", "OJO ACÁ", "EL PUNTO CLAVE", "NO ES CASUALIDAD"]
_VISUAL_ICONS = ["eye", "compass", "network", "diamond", "money", "mountain", "magnet", "coin", "heart", "radar", "hourglass", "fire"]


def _fill_card_gaps(cards: list[dict], duration: float, seed: int = 0,
                    palabras: list[dict] | None = None) -> list[dict]:
    palabras = palabras or []
    """Rellena cualquier hueco >1s (antes de la primera tarjeta o entre tarjetas)
    con tarjetas VISUALES. Huecos largos se parten en bloques de ~7s para que la
    ilustración y el kicker vayan rotando (variedad constante en pantalla)."""
    vi = 0
    # Pool de visuales barajado POR VIDEO, con arranque rotado por la semilla:
    # dos videos no repiten ni la secuencia ni la PRIMERA ilustración.
    vis_pool = list(dict.fromkeys([*_VISUAL_ICONS, *_icon_pool(seed + 7)]))
    _off = seed % max(1, len(vis_pool))
    vis_pool = vis_pool[_off:] + vis_pool[:_off]

    def _visual(at: float, dur: float) -> dict:
        nonlocal vi
        # El ícono sale de LO QUE SE DICE en este tramo, no de una rotación.
        #
        # Antes el texto y la ilustración venían de dos listas independientes
        # indexadas por el mismo contador, con largos distintos (6 frases contra
        # ~450 íconos). Se desfasaban y emparejaban cualquier cosa con cualquier
        # cosa: reportado con captura, "OJO ACÁ" salía con unas tijeras. No era un
        # emparejamiento fallido — nunca hubo emparejamiento.
        #
        # El vocabulario semántico (`_icon_for_text`) ya existía y lo usaban las
        # tarjetas con título; las de relleno no lo tocaban porque su título va
        # vacío. Acá se les da el texto hablado de su propia ventana, que es
        # justamente lo que el espectador está escuchando cuando la ve.
        fin = at + max(2.0, dur)
        dicho = " ".join(
            str(w.get("word", ""))
            for w in palabras
            if at - 0.4 <= float(w.get("start", 0)) <= fin
        )
        icono = _icon_for_text(dicho) if dicho.strip() else ""
        if not icono:
            # Sin coincidencia, la rotación de siempre: la pantalla nunca queda
            # vacía, que era el propósito original de estas tarjetas.
            icono = vis_pool[vi % len(vis_pool)]
        c = {
            "at": round(at, 2), "duration": round(max(2.0, dur), 2),
            "kicker": _kicker_para(icono, vi),
            "title": "", "accent": "", "subtitle": "",
            "number": "", "statValue": "", "statUnit": "",
            "icon": icono,
        }
        vi += 1
        return c

    out: list[dict] = []
    cursor = 0.3
    for c in sorted(cards, key=lambda x: x["at"]):
        gap = c["at"] - cursor
        # ARRANQUE: si la PRIMERA tarjeta no entra hasta pasado >1.2s, el lienzo
        # quedaría sin nada al abrir → metemos una visual de apertura (cubre el
        # hueco inicial entero, sin esperar al umbral grande de 2.6s).
        if not out and gap > 1.2:
            out.append(_visual(cursor + 0.1, c["at"] - cursor - 0.3))
            cursor = c["at"]
            gap = 0.0
        # Huecos GRANDES (>2.6s): entran visuales de ~5.5s (ritmo). Con menos de
        # 2.6s una visual no llega a su mínimo de 2s y PISABA la siguiente
        # tarjeta (encime visto en prod).
        while gap > 2.6:
            chunk = gap if gap <= 7.0 else min(5.5, gap - 1.0)
            out.append(_visual(cursor + 0.15, chunk - 0.5))
            cursor += chunk
            gap = c["at"] - cursor
        if gap > 0.6 and out:
            # hueco chico: se estira lo anterior hasta la próxima (sin encime)
            prev = out[-1]
            prev["duration"] = round(c["at"] - prev["at"] - 0.25, 2)
        out.append(c)
        cursor = max(cursor, c["at"] + float(c.get("duration", 5)))
    gap = duration - cursor
    while gap > 2.6:
        chunk = gap if gap <= 7.0 else min(5.5, gap - 1.0)
        out.append(_visual(cursor + 0.15, chunk - 0.6))
        cursor += chunk
        gap = duration - cursor
    if gap > 0.6 and out:
        prev = out[-1]
        prev["duration"] = round(duration - prev["at"] - 0.2, 2)
    return out


def editorial_panel_scenes(duration: float) -> list[dict]:
    """Coreografía del PANEL de video: cambia de tamaño/lugar 4-5 veces a lo largo
    del video (derecha → izquierda → cuadrado → grande → FULLSCREEN al final).
    Le da vida al formato — el video nunca se queda clavado en un lugar."""
    if duration < 20:
        # corto: derecha → cuadrado → full al final
        return [
            {"at": 0.0, "mode": "right"},
            {"at": round(duration * 0.45, 2), "mode": "square_left"},
            {"at": round(duration * 0.8, 2), "mode": "full"},
        ]
    return [
        {"at": 0.0, "mode": "right"},
        {"at": round(duration * 0.2, 2), "mode": "left"},
        {"at": round(duration * 0.4, 2), "mode": "square_right"},
        {"at": round(duration * 0.55, 2), "mode": "big"},
        {"at": round(duration * 0.65, 2), "mode": "left"},
        {"at": round(duration * 0.88, 2), "mode": "full"},
    ]


def editorial_cards(words: list[dict], duration: float, seed: int = 0, density: float = 1.0) -> list[dict]:
    """Escenas editoriales (~1 cada 11-15s): la frase más fuerte de cada ventana se
    vuelve tarjeta. Si tiene número → STAT ($300 / al día); si abre con ordinal →
    CAPÍTULO numerado; si no → TITULAR serif con la última palabra como acento.
    El ícono line-art sale del vocabulario de la frase. Cada tarjeta dura hasta
    poco antes de la siguiente (el lado oscuro nunca queda vacío mucho tiempo)."""
    sents = [s for s in _sentences(words) if len(s["text"].split()) >= 3]
    if duration < 8:
        return []
    if not sents:
        # Sin frases utilizables: el lienzo igual se llena con tarjetas visuales.
        return _fill_card_gaps([], duration, seed, palabras=words)
    # Ventanas CORTAS (~1 tarjeta cada 6-8s): el texto cambia al ritmo de la voz,
    # nunca se queda la misma tarjeta clavada en pantalla. `density` >1 acorta la
    # ventana (más tarjetas, ritmo más viral), con piso 3.5s para que se lean.
    window = max(5.5, min(8.0, duration / max(3, round(duration / 6.5))))
    window = max(3.5, window / max(0.5, density))
    picked: list[dict] = []
    t0 = 0.0
    while t0 < duration - 4:
        cands = [s for s in sents if t0 <= s["start"] < t0 + window]
        if cands:
            # la más "fuerte": prioriza números y frases COMPLETAS (no fragmentos
            # que arrancan con conector tipo "que estamos…").
            _CONNECT = {"que", "de", "y", "pero", "o", "en", "a", "se", "lo", "porque", "como", "para"}
            def score(s: dict) -> float:
                toks = s["text"].split()
                has_num = any(_NUM_UNIT_RE.match(_clean_word(t)) for t in toks)
                starts_connector = _clean_word(toks[0]).lower() in _CONNECT
                has_concept = 1.0 if _icon_for_text(s["text"]) else 0.0
                # primera persona = candidata a pull-quote (el momento humano)
                is_personal = bool({_clean_word(t).lower() for t in toks} & _QUOTE_MARKERS)
                return (
                    (2.0 if has_num else 0.0)
                    + (1.0 if 5 <= len(toks) <= 14 else 0.0)
                    + has_concept
                    + (0.6 if is_personal else 0.0)
                    - (1.5 if starts_connector else 0.0)
                    # las frases con muletillas/duplicados pierden contra las limpias
                    - _disfluency_penalty(s["text"])
                )
            # solo frases que SOBREVIVEN la limpieza (nunca mostrar basura)
            cands = [s for s in cands if clean_screen_text(s["text"], min_words=3)]
            # separación mínima con la anterior: dos frases fuertes pegadas
            # producían tarjetas ENCIMADAS (la duración mínima pisaba a la próxima)
            if picked:
                cands = [s for s in cands if s["start"] >= picked[-1]["start"] + 4.5]
            if cands:
                picked.append(max(cands, key=score))
        t0 += window
    cards: list[dict] = []
    pool = _icon_pool(seed)
    chapter = 0
    used_quote = False  # máx 1 pull-quote por video (el momento "en sus palabras")
    total_chapters = sum(
        1 for s in picked
        if _clean_word(s["text"].split()[0]).lower() in {"primero", "segundo", "tercero", "cuarto", "primera", "segunda", "tercera"}
    )
    for i, s in enumerate(picked):
        # Limpieza ANTES de armar la tarjeta: sin muletillas, sin conectores
        # colgando, sin duplicados de dictado. Si la frase no sobrevive, se
        # salta (el hueco lo cubre una tarjeta visual).
        text = clean_screen_text(s["text"], min_words=3)
        if not text:
            continue
        toks = text.split()
        at = round(max(0.2, s["start"] - 0.2), 2)
        # duración: hasta la próxima tarjeta PERO máx ~7.5s — si la siguiente frase
        # fuerte tarda más, _fill_card_gaps mete una tarjeta visual en el medio
        # (la pantalla siempre está CAMBIANDO, al ritmo del video).
        next_at = picked[i + 1]["start"] - 0.4 if i + 1 < len(picked) else min(duration, s["start"] + 8)
        dur = round(max(3.5, min(7.5, next_at - at)), 2)
        icon = _icon_for_text(text)
        card: dict = {"at": at, "duration": dur, "kicker": _KICKERS[i % len(_KICKERS)],
                      "title": "", "accent": "", "subtitle": "", "number": "",
                      "statValue": "", "statUnit": "", "icon": icon}
        # ¿STAT? primer token numérico de la frase
        num_idx = next((j for j, t in enumerate(toks) if _NUM_UNIT_RE.match(_clean_word(t))), None)
        first = _clean_word(toks[0]).lower()
        if first in {"primero", "segundo", "tercero", "cuarto", "primera", "segunda", "tercera"}:
            chapter += 1
            card["number"] = f"{chapter:02d}"
            card["kicker"] = f"HOY TE ENSEÑO · {chapter:02d} / {max(total_chapters, chapter):02d}"
            # re-limpiar el fragmento: cortar en 8 palabras puede dejar colgantes
            rest = clean_screen_text(" ".join(toks[1:9]), max_chars=48) or " ".join(toks[1:6]).strip(" ,.")
            card["title"] = rest + ("." if rest and rest[-1] not in ".?!…" else "")
            sig = [
                t for t in rest.split()
                if len(_clean_word(t)) >= 4 and _clean_word(t).lower() not in _GENERIC_ACCENT
            ]
            card["accent"] = _clean_word(sig[-1] if sig else rest.split()[-1]).strip(".,!?¿¡")
        elif num_idx is not None:
            card["statValue"] = toks[num_idx].strip(".,")
            card["statUnit"] = " ".join(toks[num_idx + 1 : num_idx + 3]).strip(" ,.")[:18]
            card["subtitle"] = clean_screen_text(" ".join(toks[:num_idx]), max_chars=60)
        elif (
            not used_quote
            and s.get("words")
            and 6 <= len(toks) <= 16
            and {_clean_word(t).lower() for t in toks} & _QUOTE_MARKERS
        ):
            # PULL-QUOTE: frase en primera persona → cita serif que aparece
            # palabra por palabra EXACTAMENTE al ritmo de la voz (timestamps).
            used_quote = True
            card["kicker"] = "EN SUS PALABRAS"
            qw = [
                {"w": (w.get("word") or "").strip(), "at": round(float(w.get("start", s["start"])), 2)}
                for w in s["words"][:16]
                if (w.get("word") or "").strip()
            ]
            while qw and _clean_word(qw[0]["w"]).lower() in _LEAD_FILLERS:
                qw.pop(0)
            if len(qw) >= 5:
                card["quote"] = True
                card["quoteWords"] = qw
            else:
                used_quote = False  # quedó muy corta tras limpiar → titular normal
            if not card.get("quote"):
                title_txt = clean_screen_text(" ".join(toks[:7]), max_chars=52) or " ".join(toks[:5]).strip(" ,.")
                card["title"] = title_txt + ("." if title_txt and title_txt[-1] not in ".?!…" else "")
        else:
            # TITULAR: máx 7 palabras, re-limpiado tras el corte (el corte en N
            # palabras puede dejar un conector colgando: "…vale más que tu").
            title_txt = (
                clean_screen_text(" ".join(toks[:7]), max_chars=52)
                or clean_screen_text(" ".join(toks[:9]), max_chars=52)
                or " ".join(toks[:5]).strip(" ,.")
            )
            card["title"] = title_txt + ("." if title_txt and title_txt[-1] not in ".?!…" else "")
            sig = [
                t for t in title_txt.split()
                if len(_clean_word(t)) >= 4
                and _clean_word(t).lower() not in _TRAIL_DANGLERS
                and _clean_word(t).lower() not in _GENERIC_ACCENT
            ]
            card["accent"] = _clean_word(sig[-1] if sig else title_txt.split()[-1]).strip(".,!?¿¡")
            if len(toks) > 7:
                sub = clean_screen_text(" ".join(toks[7:16]), max_chars=70)
                card["subtitle"] = (sub + ".") if sub else ""
        # NUNCA sin ilustración: fallback del pool grande barajado por video.
        if not card["icon"]:
            card["icon"] = pool[i % len(pool)]
        # Nunca la MISMA ilustración en dos tarjetas seguidas (el vocabulario
        # puede matchear "users" dos veces al hilo y se veía repetido).
        if cards and card["icon"] == cards[-1]["icon"]:
            card["icon"] = pool[(i * 13 + 5) % len(pool)]
        cards.append(card)
    # ── ANTI-ENCIME: ninguna tarjeta puede pisar a la siguiente. Dos tarjetas a
    # la vez se renderizan SUPERPUESTAS en la misma zona (bug visto en prod).
    cards.sort(key=lambda c: c["at"])
    sin_encime: list[dict] = []
    for c in cards:
        if sin_encime:
            prev = sin_encime[-1]
            max_dur = round(c["at"] - prev["at"] - 0.25, 2)
            if max_dur < 2.0:
                continue  # demasiado pegada a la anterior: se descarta esta
            if prev["at"] + prev["duration"] > c["at"] - 0.25:
                prev["duration"] = max_dur
        sin_encime.append(c)
    cards = sin_encime
    # La ÚLTIMA tarjeta se extiende hacia el cierre (máx 9s — si falta más, los
    # bloques visuales rellenan y el cierre queda con frase o animación igual).
    if cards:
        last = cards[-1]
        last["duration"] = round(min(9.0, max(last["duration"], duration - last["at"] - 0.2)), 2)
    # Y cualquier hueco restante (>1s) se rellena con tarjetas VISUALES:
    # la pantalla NUNCA se queda con el video solo y el lienzo desnudo.
    return _fill_card_gaps(cards, duration, seed, palabras=words)


_EDITORIAL_LLM_PROMPT = """Sos el director de arte de un documental viral en español.
Te paso las TARJETAS de texto que acompañan a un video hablado (generadas por
heurística desde el transcript). Tu trabajo: REESCRIBIRLAS para que sean claras,
impactantes y APORTEN — no repitas literal lo que se dice en el video.
Las tarjetas van EN VIVO con la voz: cada una refuerza lo que se está diciendo
EN ESE MOMENTO (su "at" en segundos) o suma un dato que capte la atención justo
ahí. No hagas resúmenes globales — acompañá el momento.
OJO: el texto viene de una TRANSCRIPCIÓN AUTOMÁTICA del habla. Puede traer
palabras mal reconocidas, muletillas (este, eh, o sea, bueno) y frases cortadas.
Corregí los errores evidentes según el contexto, eliminá toda muletilla y
entregá frases COMPLETAS y bien redactadas en español neutro — nunca copies
un fragmento roto tal cual.
Si una frase NO tiene sentido (transcripción rota o palabras mal reconocidas),
REESCRIBILA con sentido manteniendo la intención de lo que el orador quiso decir.
VARIÁ el fraseo: no repitas literal lo que se dice en el video — parafraseá con
punch, sumá ángulo o dato. Dos tarjetas nunca deben sonar iguales entre sí.

Reglas por tarjeta:
- "title": máx 7 palabras, potente, estilo titular de revista. Termina en punto.
- "accent": UNA palabra del título (la más fuerte) — va resaltada en color.
- "subtitle": máx 12 palabras que AGREGAN VALOR: un dato interesante, contexto o
  consecuencia relacionada al tema (no parafrasees el título).
- "kicker": 2-4 palabras en mayúsculas tipo sección de revista (EL DATO, LA TRAMPA,
  LO QUE NADIE DICE...). Variá entre tarjetas.
- Tarjetas con "title" VACÍO son visuales (solo ilustración): dejá "title" vacío y
  poné en "subtitle" un dato corto e interesante del tema (máx 8 palabras).
- NO toques: at, duration, icon, number, statValue, statUnit (devolvelos igual).
- Mantené el MISMO orden y la MISMA cantidad de tarjetas.

Responde SOLO el JSON: {"cards": [ ... ]}

TARJETAS:
"""


def _enrich_cards_llm(cards: list[dict], words: list[dict]) -> list[dict]:
    """Reescritura con Ollama (si está): títulos impactantes + subtítulos que
    aportan datos/insights en vez de repetir, corrigiendo de paso frases rotas
    de la transcripción y VARIANDO el fraseo (no copia literal del video).
    Las PULL-QUOTES quedan FUERA: son citas textuales del orador y jamás se
    reescriben. Best-effort: probe corto primero; ante cualquier fallo se quedan
    las tarjetas heurísticas (el pipeline jamás se rompe)."""
    if not cards:
        return cards
    try:
        # Probe corto: si Ollama no está levantado, fallback inmediato (no
        # esperamos el timeout largo de generación).
        if not _ollama_alive():
            print(
                "[generate_graphics] OLLAMA NO DISPONIBLE; usando modo heurístico "
                "(tarjetas sin reescritura) — los resultados serán de menor calidad",
                file=sys.stderr,
                flush=True,
            )
            return cards
        # Pull-quotes EXCLUIDAS: la cita es textual (palabra por palabra con
        # timestamps), reescribirla rompería el sync y la honestidad de la cita.
        idx_send = [i for i, c in enumerate(cards) if not c.get("quote")]
        if not idx_send:
            return cards
        # Contexto corto del video para que el modelo entienda el tema.
        full_text = " ".join(str(w.get("word", "")) for w in words)[:1500]
        payload = [
            {k: cards[i][k] for k in ("at", "duration", "kicker", "title", "accent",
                                      "subtitle", "number", "statValue", "statUnit", "icon")}
            for i in idx_send
        ]
        prompt = (
            _EDITORIAL_LLM_PROMPT
            + json.dumps(payload, ensure_ascii=False)
            + f"\n\nTEMA DEL VIDEO (contexto): {full_text[:600]}\n\nJSON:"
        )
        raw = _ollama(prompt, temperature=0.4)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return cards
        out = json.loads(m.group(0)).get("cards", [])
        if not isinstance(out, list) or len(out) != len(idx_send):
            return cards
        enriched: list[dict] = list(cards)  # las quotes quedan intactas en su lugar
        for i, new in zip(idx_send, out):
            orig = cards[i]
            c = dict(orig)  # at/duration/icon/number/stat* SIEMPRE de la heurística
            is_visual = not orig.get("title") and not orig.get("statValue") and not orig.get("number")
            for k in ("kicker", "title", "accent", "subtitle"):
                v = str(new.get(k, "") or "").strip()
                if v:
                    c[k] = v[:80] if k != "title" else v[:60]
            if is_visual:
                # Las tarjetas VISUALES siguen siendo visuales: ilustración protagonista
                # (el LLM solo puede aportarles kicker + subtítulo con dato).
                c["title"] = ""
                c["accent"] = ""
            # Corrector determinista también sobre lo que devuelve el LLM
            # (a veces copia confusiones del transcript tal cual).
            c["title"], c["subtitle"], c["kicker"] = review_screen_texts(
                [c.get("title", ""), c.get("subtitle", ""), c.get("kicker", "")]
            )
            enriched[i] = c
        print(f"[editorial] {len(idx_send)} tarjetas enriquecidas con LLM "
              f"({len(cards) - len(idx_send)} pull-quotes textuales intactas)", file=sys.stderr)
        return enriched
    except Exception as e:  # noqa: BLE001
        print(f"[editorial] LLM skip ({e}) — tarjetas heurísticas", file=sys.stderr)
        return cards


def generate(transcript_path: Path, use_llm: bool = True, illustrations: bool = False,
             density: float = 1.0) -> dict:
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    words = transcript.get("words", [])
    duration = float(transcript.get("duration", 0) or 0)
    if duration <= 0 and words:
        duration = float(words[-1].get("end", 0))

    # DENSIDAD: base ~1 elemento visual cada ~10s (mín 3, máx 14). `density` >1 lo sube
    # (los reels de Mejores Momentos piden MÁS ilustraciones/gráficos para verse cargados).
    density = max(0.5, min(3.0, density))
    target = max(3, min(int(14 * density), round(duration / (10 / density)))) if duration > 0 else 3

    # GRÁFICOS VISUALES (lo que el usuario pidió):
    #   - charts: contador/barras/línea/dona desde NÚMEROS reales (no inventa datos).
    #   - íconos de concepto: un símbolo que representa lo que se dice (dinero, idea,
    #     crecimiento…). VISUAL, no texto.
    # NO generamos titulares de texto automáticos: repetían el subtítulo (texto duplicado).
    charts = heuristic_charts(words, duration, max_charts=max(4, target))
    # Diagrama de pasos si el orador enumera (primero/segundo/tercero…).
    steps = detect_steps(words, duration)
    for s in steps:
        if all(abs(s["at"] - c["at"]) > 3.5 for c in charts):
            charts.append(s)
    charts.sort(key=lambda c: c["at"])
    icon_budget = max(3, target - len(charts))  # los charts ya aportan; el resto, íconos
    icons = concept_icons(words, duration, icon_budget)

    # Variedad de charts: rota color y posición.
    for i, c in enumerate(charts):
        c["accent"] = ACCENTS[(i * 2 + 1) % len(ACCENTS)]
        c["position"] = ["top", "bottom", "center"][i % 3]

    # Corrector ortográfico determinista sobre TODO texto visible de dataViz y
    # steps (títulos + labels): nada con confusiones de Whisper llega a pantalla.
    for c in charts:
        if c.get("title"):
            c["title"] = review_screen_texts([c["title"]])[0]
        for d in c.get("data", []):
            if isinstance(d, dict) and d.get("label"):
                d["label"] = review_screen_texts([d["label"]])[0]

    # Anti-solape: si un ícono cae sobre un chart fullscreen, lo corremos de esquina.
    chart_windows = [(c["at"], c["at"] + c["duration"]) for c in charts if c.get("fullscreen")]
    for ic in icons:
        for s, e in chart_windows:
            if s - 0.5 < ic["at"] < e:
                ic["position"] = "bottom-right" if ic["position"] != "bottom-right" else "top-left"
                break

    print(
        f"[graphics] {len(charts)} charts · {len(icons)} íconos visuales · target {target} (dur {duration:.0f}s) · SIN texto repetido",
        file=sys.stderr,
    )
    # kineticHeadlines vacío a propósito: las animaciones ahora son VISUALES (charts +
    # íconos), no copias del texto. La capa de titulares sigue disponible para uso manual.
    # editorialCards: SIEMPRE se calculan (heurística barata); con Ollama vivo se
    # REESCRIBEN para ser impactantes y aportar datos (no repetir el video).
    # editorialScenes: coreografía del panel (derecha→izquierda→cuadrado→full).
    # seed POR VIDEO: cada video usa un orden distinto del pool de ilustraciones.
    seed = int(hashlib.md5(transcript_path.stem.encode("utf-8")).hexdigest()[:8], 16)
    ed_cards = editorial_cards(words, duration, seed=seed, density=density)
    if use_llm and ed_cards:
        ed_cards = _enrich_cards_llm(ed_cards, words)
    result: dict = {
        "dataViz": charts,
        "kineticHeadlines": [],
        "iconStickers": icons,
        "editorialCards": ed_cards,
        "editorialScenes": editorial_panel_scenes(duration),
        # Ola 7 — si el transcript menciona un lugar, escena de GLOBO con zoom.
        "editorialMap": editorial_map(words, duration),
    }
    # ILUSTRACIONES CC0 (opt-in, default OFF). Solo cuando --illustrations: agrega
    # "illustrationStickers" con personas/escenas multicolor para los conceptos
    # mencionados. Budget chico (~1/3 del target). Sin la flag → no aparece la
    # clave y el comportamiento es idéntico al histórico.
    if illustrations:
        illu_budget = max(2, int(target * density / 2))
        result["illustrationStickers"] = concept_illustrations(words, duration, illu_budget)
        print(
            f"[graphics] {len(result['illustrationStickers'])} ilustraciones CC0 "
            f"(budget {illu_budget})",
            file=sys.stderr,
        )
    return result


def _selftest() -> int:
    """Tests del corrector ES (determinista). Corre con: --selftest."""
    cases_fix = [
        # (entrada, salida esperada de _fix_es_confusions)
        ("hoy vamos a ser un experimento", "hoy vamos a hacer un experimento"),
        ("voy a ser una prueba rápida", "voy a hacer una prueba rápida"),
        ("vamos a ser felices", "vamos a ser felices"),            # adjetivo: NO tocar
        ("vamos a ser un equipo increíble", "vamos a ser un equipo increíble"),  # copulativo: NO tocar
        ("esto va a ser un experimento brutal", "esto va a ser un experimento brutal"),  # 3ª persona: NO tocar
        ("aber si funciona", "a ver si funciona"),
        ("haber si llega el cliente", "a ver si llega el cliente"),
        ("vamos haber qué pasa", "vamos a ver qué pasa"),
        ("el veinte por ciento de las personas", "el 20% de las personas"),
        ("creció 50 por ciento este año", "creció 50% este año"),
        ("una promo de 2 x 1", "una promo de 2 por 1"),
        ("quiero mas dinero", "quiero más dinero"),
        ("lo intenté, mas no pude", "lo intenté, mas no pude"),    # adversativo: NO tocar
        ("claro que si.", "claro que sí."),
        ("no sé que si vienes mañana", "no sé que si vienes mañana"),  # condicional: NO tocar
        ("¿como estas?", "¿cómo estás?"),
        ("¿cuanto cuesta?", "¿cuánto cuesta?"),
        ("porque no funciona?", "por qué no funciona?"),
    ]
    cases_clean = [
        # (entrada, salida esperada de clean_screen_text)
        ("hoy vamos a ser un experimento", "Hoy vamos a hacer un experimento"),
        ("aber si funciona esto", "A ver si funciona esto"),
        ("el veinte por ciento de las personas compran", "El 20% de las personas compran"),
        ("bueno pues eh vamos a ser un experimento en vivo", "Vamos a hacer un experimento en vivo"),
    ]
    failed = 0
    for inp, want in cases_fix:
        got = _fix_es_confusions(inp)
        ok = got == want
        idem = _fix_es_confusions(got) == got  # idempotencia = determinismo seguro
        failed += (not ok) + (not idem)
        print(f"  {'OK ' if ok and idem else 'FAIL'} fix   {inp!r} → {got!r}"
              + ("" if ok else f"  (esperaba {want!r})")
              + ("" if idem else "  (NO idempotente)"))
    for inp, want in cases_clean:
        got = clean_screen_text(inp)
        ok = got == want
        failed += not ok
        print(f"  {'OK ' if ok else 'FAIL'} clean {inp!r} → {got!r}"
              + ("" if ok else f"  (esperaba {want!r})"))
    # review_screen_texts: conserva mayúsculas y longitud/orden
    got = review_screen_texts(["VEINTE POR CIENTO MAS", "", "aber si funciona"])
    want = ["20% MÁS", "", "a ver si funciona"]
    ok = got == want
    failed += not ok
    print(f"  {'OK ' if ok else 'FAIL'} review {got!r}" + ("" if ok else f" (esperaba {want!r})"))
    print(f"[selftest] {'TODO OK' if not failed else f'{failed} FALLOS'}")
    return 0 if not failed else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("clip_id", nargs="?", help="ID del clip (transcript en long_form/transcripts)")
    parser.add_argument("--transcript", help="Path al transcript JSON")
    parser.add_argument("--out", help="Path de salida (default: long_form/graphics/{clip_id}.json)")
    parser.add_argument("--no-llm", action="store_true", help="Solo heurística (sin Ollama)")
    parser.add_argument("--illustrations", action="store_true",
                        help="Agrega illustrationStickers (personas/escenas CC0) — opt-in, default off")
    parser.add_argument("--density", type=float, default=1.0,
                        help="Multiplicador de densidad de gráficos/ilustraciones (1.0 base; >1 = más cargado, para reels)")
    parser.add_argument("--selftest", action="store_true", help="Corre los tests del corrector ES y sale")
    args = parser.parse_args()

    if args.selftest:
        return _selftest()

    ensure_long_form_dirs()

    if args.transcript:
        tp = Path(args.transcript)
        clip_id = tp.stem
    elif args.clip_id:
        clip_id = args.clip_id
        tp = LF_TRANSCRIPTS / f"{clip_id}.json"
    else:
        parser.error("Especificá clip_id o --transcript")

    if not tp.exists():
        print(f"[error] no encontré {tp}", file=sys.stderr)
        return 1

    t0 = time.time()
    result = generate(tp, use_llm=not args.no_llm, illustrations=args.illustrations, density=args.density)
    out = Path(args.out) if args.out else LF_GRAPHICS / f"{clip_id}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "ok": True, "out": str(out),
        "dataViz": len(result["dataViz"]),
        "iconStickers": len(result.get("iconStickers", [])),
        "kineticHeadlines": len(result["kineticHeadlines"]),
        "illustrationStickers": len(result.get("illustrationStickers", [])),
        "elapsed_sec": round(time.time() - t0, 1),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
