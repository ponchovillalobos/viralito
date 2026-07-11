"""highlights.py — modo "MEJORES MOMENTOS" (highlight reel one-shot).

De UN video largo (charla/podcast/webinar de 1-2 h) arma UN SOLO video unificado de
MÁXIMO 3 minutos (ADAPTATIVO: si el material no da para tanto, sale más corto —
nunca se rellena con relleno) con los momentos más increíbles/virales, SECUENCIADOS
POR EMOCIÓN (no cronológico): gancho fuerte al inicio → construcción → cierre memorable.

Cómo elige (fusiona 3 señales que ya existen en el proyecto):
  1. LLM con un PROMPT DEDICADO súper detallado (distinto de analyze_clips: busca
     momentos PUNCHY de 8-30s — remates que hacen reír, giros, quotes, "ajá", picos —
     con un tag de emoción). Reusa el provider offline-aware (claude>codex>ollama).
  2. virality.score_clip (score determinista 0-100: hook/emoción/datos/ritmo/…).
  3. emotion_director (audio, librosa): picos de arousal → alinea con risas/clímax.

Salida:
  - long_form/highlights/{video_id}.json         (curaduría auditable)
  - long_form/proposals/{video_id}_highlights.json   (proposal sintética de 1 clip)
  - long_form/clips/{video_id}_highlights_c01_reel.mp4   (el montage, corte duro)
  - long_form/transcripts/{video_id}_highlights_c01_reel.json  (transcript re-alineado)

Después long_form_pipeline.py renderiza ese "clip sintético" con el pipeline supreme
NORMAL (subtítulos + UNA música + ducking + estilo unificados), sin tocar el render.

Uso:
  python highlights.py <video_id> [--max-seconds 180] [--min-seconds 20]
                       [--quality-floor 52] [--aspect-ratio 9:16]
                       [--face-tracking off] [--provider claude|codex|ollama]
  → última línea JSON: {"ok": true, "clip_id": "...", "moments": 9, "seconds": 142.3}
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from config import (
    FFMPEG_PATH,
    FFPROBE_PATH,
    LF_CLIPS,
    LF_HIGHLIGHTS,
    LF_PROPOSALS,
    LF_RAW,
    LF_TRANSCRIPTS,
    OLLAMA_MODEL,
    ensure_long_form_dirs,
)
# Reuso de la infra de análisis (provider offline-aware + parser tolerante + utilidades).
from analyze_clips import (
    _llm_complete,
    _norm_word,
    _try_parse_clips,
    build_transcript_text,
    chunk_words,
    clip_provider,
    slugify,
)
from virality import score_clip

PYTHON_DIR = Path(__file__).resolve().parent
VENV_PYTHON = Path(sys.executable)

# ── Tunables (constantes al tope para ajustar sin cazar en el código) ─────────
DEFAULT_MAX_SECONDS = 180.0   # tope DURO: 3 minutos
DEFAULT_MIN_SECONDS = 20.0    # abajo de esto se considera "reel pobre"
QUALITY_FLOOR = 52.0          # score fusionado mínimo para entrar (adaptativo)
MOMENT_MIN = 8.0              # duración mínima de un momento
MOMENT_MAX = 30.0            # duración máxima de un momento (punchy, no clip largo)
# Pesos de la fusión (suman 1.0): el LLM manda (entiende el CONTENIDO), la virality
# ancla en señales objetivas, el arousal premia los picos emocionales (risas/gritos).
W_LLM, W_VIRAL, W_AROUSAL = 0.45, 0.30, 0.25

_VALID_EMOTIONS = {"risa", "asombro", "inspiracion", "tension", "insight", "polemica", "hype", "epico", "chill"}
_VALID_PUNCH = {"hook", "risa", "remate", "giro", "quote", "dato", "revelacion"}


# ══════════════════════════════════════════════════════════════════════════════
# 1) EL PROMPT — súper detallado, dedicado a MOMENTOS de montage (no clips)
# ══════════════════════════════════════════════════════════════════════════════
def build_highlights_prompt(want: int) -> str:
    """Prompt de sistema para elegir MOMENTOS punchy (8-30s) de un highlight reel.

    Distinto del de analyze_clips (que busca clips autocontenidos de 30-60s): acá
    queremos los CHISPAZOS — el remate que hace reír, el giro, la frase citable, el
    dato que impacta, el pico emocional — para pegarlos en UN video de lo mejor."""
    return f"""Sos el editor de HIGHLIGHTS más exigente del mundo para audiencia hispanohablante
(LATAM/España) en el nicho de COMUNICACIÓN + VENTAS + IA. De una charla/podcast/clase larga
armás el "LO MEJOR EN UN SOLO VIDEO": una colección de los MOMENTOS más increíbles, pegados
en secuencia, que engancha de principio a fin.

═══════════════════════════════════════════════════════════════════════════
QUÉ ES UN "MOMENTO" (≠ un clip)
═══════════════════════════════════════════════════════════════════════════
NO busques clips autocontenidos de 40s. Buscá CHISPAZOS de 8-30s (ideal 10-20s): el
instante EXACTO que provoca una reacción. Un highlight reel se hace de PICOS, no de ideas
completas. Cada momento tiene que pegar SOLO, sin contexto previo.

Tipos de momento que SÍ sirven (elegí, no inventes — tiene que estar dicho en el video):
  • RISA / GRACIA: un remate que hace reír, una ocurrencia, una exageración cómica.
  • REMATE: la frase que cierra una idea con fuerza ("...y por eso nadie te compra").
  • GIRO / CONTRAINTUITIVO: algo que rompe lo esperado ("todo lo que te enseñaron está mal").
  • QUOTE CITABLE: una frase memorable, redonda, de las que se guardan y se comparten.
  • DATO / CIFRA que impacta ("pasé de 3 a 40 clientes en un mes").
  • REVELACIÓN / CONFESIÓN: "te voy a ser honesto...", un secreto, algo vulnerable.
  • PICO EMOCIONAL: cuando el orador se ENCIENDE (sube la voz, se emociona, se indigna).

Descartá SIEMPRE: saludos, intros, logística, "¿se escucha?", agradecimientos, muletillas,
divagues, setups sin payoff, y todo lo genérico/obvio que cualquiera ya sabe.

═══════════════════════════════════════════════════════════════════════════
DÓNDE EMPIEZA Y TERMINA (precisión quirúrgica — define la calidad)
═══════════════════════════════════════════════════════════════════════════
  • "start": la PRIMERA palabra del momento potente. CERO preámbulo ("bueno, eh, entonces...").
  • "end": justo al terminar el remate/la frase. Ni un segundo de más. Denso, sin aire muerto.
  • Duración 8-30s. Si el chispazo dura 9s, son 9s — no lo estires. Densidad > duración.
  • "hook": copiá PALABRA POR PALABRA del transcript la frase con la que ARRANCA el momento
    (se usa para anclar el timestamp exacto — si no es textual, el corte sale mal).

═══════════════════════════════════════════════════════════════════════════
CLASIFICÁ CADA MOMENTO (para secuenciar por emoción después)
═══════════════════════════════════════════════════════════════════════════
  • "punchType": uno de [hook, risa, remate, giro, quote, dato, revelacion].
  • "emotion": la emoción que dispara, uno de [risa, asombro, inspiracion, tension, insight, polemica, hype, epico, chill].
  • "intensity": 0.0 a 1.0 — qué tan FUERTE pega el momento (1.0 = imperdible, viral seguro).

═══════════════════════════════════════════════════════════════════════════
CANTIDAD Y COBERTURA
═══════════════════════════════════════════════════════════════════════════
  • Devolvé hasta {want} momentos, ordenados de MÁS a MENOS potente (mayor intensity primero).
  • Recorré TODO el transcript: hay oro en el medio y en el cierre, no solo al arranque.
  • VARIEDAD: mezclá risa + insight + dato + giro. Un reel monótono aburre.
  • NO solapados (no repitas el mismo tramo de tiempo).
  • Preferí CALIDAD sobre cantidad: 6 momentos brutales > 15 tibios. Si el video es flojo,
    devolvé pocos — es MEJOR un reel corto de solo oro que uno largo con relleno.

═══════════════════════════════════════════════════════════════════════════
OUTPUT — SOLO JSON, sin markdown ni explicaciones
═══════════════════════════════════════════════════════════════════════════
{{
  "moments": [
    {{
      "start": <segundos donde EMPIEZA el momento>,
      "end": <segundos donde TERMINA>,
      "hook": "<la frase EXACTA con la que arranca, copiada del transcript>",
      "punchType": "<hook|risa|remate|giro|quote|dato|revelacion>",
      "emotion": "<risa|asombro|inspiracion|tension|insight|polemica|hype|epico|chill>",
      "intensity": <0.0-1.0>,
      "quote": "<la frase memorable del momento, limpia (para el caption)>",
      "keywords": ["<3-5 palabras clave en MAYUSCULAS>"]
    }}
  ]
}}

REGLA CRÍTICA: NUNCA uses comillas dobles dentro de los valores — usá comillas simples.
JSON ROTO = NO SIRVE. Validá que sea parseable antes de responder."""


# ══════════════════════════════════════════════════════════════════════════════
# 2) LLM: pedir momentos (con chunking para videos largos) + parser tolerante
# ══════════════════════════════════════════════════════════════════════════════
def _request_moments(transcript_text: str, provider: str, model: str, want: int) -> list[dict]:
    """Una tanda al LLM pidiendo momentos. Reintenta con temp baja si el JSON viene roto."""
    system = build_highlights_prompt(want)
    prompt = f"{system}\n\nTRANSCRIPT:\n{transcript_text}\n\nResponde con el JSON ahora:"
    for label, temp in (("temp=0.3", 0.3), ("temp=0.1 retry", 0.1)):
        who = provider if provider in ("claude", "codex") else model
        print(f"[highlights:{provider}] pidiendo momentos a {who} ({label})...", file=sys.stderr, flush=True)
        t0 = time.time()
        try:
            raw = _llm_complete(prompt, provider, model, temperature=temp)
        except Exception as exc:  # noqa: BLE001
            print(f"[highlights:{provider}] error ({label}): {exc}", file=sys.stderr)
            continue
        print(f"[highlights:{provider}] respuesta en {time.time()-t0:.1f}s ({len(raw)} chars)", file=sys.stderr)
        # _try_parse_clips busca {"clips":[...]} o lista suelta; normalizamos a "moments".
        parsed = _try_parse_moments(raw)
        if parsed:
            print(f"[highlights:{provider}] {len(parsed)} momentos parseados ({label})", file=sys.stderr)
            return parsed
    return []


def _try_parse_moments(raw: str) -> list[dict]:
    """Como _try_parse_clips pero aceptando la clave 'moments' (o 'clips', o lista suelta)."""
    import json as _json
    import re as _re
    for cand in (raw, _re.sub(r"^```[a-z]*|```$", "", raw.strip(), flags=_re.MULTILINE)):
        try:
            obj = _json.loads(cand)
        except Exception:  # noqa: BLE001
            continue
        if isinstance(obj, dict):
            for key in ("moments", "clips", "highlights"):
                if isinstance(obj.get(key), list):
                    return obj[key]
        if isinstance(obj, list):
            return obj
    # Rescate: reusar el parser clip-by-clip de analyze_clips (extrae cada objeto {...}).
    salvaged = _try_parse_clips(raw)
    return salvaged or []


def collect_candidates(words: list[dict], duration: float, provider: str, model: str, want_total: int) -> list[dict]:
    """Recolecta momentos crudos del LLM. Chunking si el video es largo (>15 min)."""
    if duration <= 900:
        text = build_transcript_text(words, window_sec=15)
        return _request_moments(text, provider, model, want_total)
    # Video largo: un pase por chunk de ~12 min, sobre-pidiendo (tras filtro cae parte).
    chunks = chunk_words(words, chunk_sec=720)
    per_chunk = max(4, (want_total + len(chunks) - 1) // len(chunks) + 2)
    out: list[dict] = []
    for i, ch in enumerate(chunks):
        print(f"[highlights] chunk {i+1}/{len(chunks)} ({len(ch)} palabras)...", file=sys.stderr, flush=True)
        text = build_transcript_text(ch, window_sec=15)
        out.extend(_request_moments(text, provider, model, per_chunk))
    return out


# ══════════════════════════════════════════════════════════════════════════════
# 3) Anclaje + validación (momentos finos 8-30s — propio, el de analyze asume ≥25s)
# ══════════════════════════════════════════════════════════════════════════════
def anchor_moment(m: dict, words: list[dict], duration: float) -> dict | None:
    """Ancla el 'start' a donde REALMENTE se dice el hook (los LLM inventan timestamps
    pero citan bien el texto — patrón FunClip). Devuelve None si no valida 8-30s."""
    import difflib

    try:
        start = float(m["start"])
        end = float(m["end"])
    except (KeyError, ValueError, TypeError):
        return None

    hook = str(m.get("hook") or "")
    hook_tokens = [_norm_word(t) for t in hook.split() if _norm_word(t)][:6]
    if len(hook_tokens) >= 3 and words:
        target = " ".join(hook_tokens)
        norm = [_norm_word(str(w.get("word", ""))) for w in words]
        n = len(hook_tokens)
        best_i, best_score = -1, 0.0
        for i in range(0, max(0, len(words) - n)):
            ws = float(words[i].get("start", 0))
            if abs(ws - start) > 45:  # buscar cerca de donde el LLM cree
                continue
            score = difflib.SequenceMatcher(None, " ".join(norm[i:i + n]), target).ratio()
            if score > best_score:
                best_score, best_i = score, i
        if best_i >= 0 and best_score >= 0.7:
            real_start = max(0.0, float(words[best_i].get("start", 0)) - 0.05)
            delta = real_start - start
            start = real_start
            end = end + delta  # mover el final igual para conservar la duración
            m["anchorScore"] = round(best_score, 2)

    # Snap del final al fin de frase más cercano (±5s): puntuación o pausa ≥0.4s.
    best_end = None
    for j, w in enumerate(words):
        we = float(w.get("end", 0))
        if we > end + 3:
            break
        if we < end - 5:
            continue
        raw = str(w.get("word", "")).strip()
        gap = (float(words[j + 1].get("start", we)) - we) if j + 1 < len(words) else 9.0
        if raw.endswith((".", "!", "?", "…")) or gap >= 0.4:
            best_end = we
    if best_end is not None and MOMENT_MIN <= (best_end - start) <= MOMENT_MAX:
        end = best_end + 0.1

    # Recorte a la ventana válida.
    dur = end - start
    if dur < MOMENT_MIN:
        end = min(duration, start + MOMENT_MIN)
    elif dur > MOMENT_MAX:
        end = start + MOMENT_MAX
    start = max(0.0, round(start, 2))
    end = round(min(duration, end), 2)
    if end - start < MOMENT_MIN or start >= duration:
        return None

    emotion = str(m.get("emotion", "")).strip().lower()
    punch = str(m.get("punchType", "")).strip().lower()
    try:
        intensity = max(0.0, min(1.0, float(m.get("intensity", 0.5))))
    except (ValueError, TypeError):
        intensity = 0.5
    kw = [str(k).strip()[:30] for k in (m.get("keywords") or []) if str(k).strip()][:5]
    return {
        "start": start,
        "end": end,
        "hook": hook[:200],
        "quote": str(m.get("quote", "") or hook)[:200],
        "punchType": punch if punch in _VALID_PUNCH else "quote",
        "emotion": emotion if emotion in _VALID_EMOTIONS else "hype",
        "intensity": round(intensity, 3),
        "keywords": kw,
        "anchorScore": m.get("anchorScore"),
    }


# ══════════════════════════════════════════════════════════════════════════════
# 4) emotion_director → picos de arousal (risas/gritos/clímax)
# ══════════════════════════════════════════════════════════════════════════════
def run_emotion_director(raw_path: Path, transcript_path: Path, video_id: str) -> dict:
    """Corre emotion_director.py sobre el raw. Devuelve su JSON (peaks/arousal/mood) o
    {} si falla — el modo NUNCA se rompe por esto (el arousal solo pondera)."""
    out_path = LF_HIGHLIGHTS / f"{video_id}_emotion.json"
    try:
        r = subprocess.run(
            [str(VENV_PYTHON), str(PYTHON_DIR / "emotion_director.py"),
             str(raw_path), "--transcript", str(transcript_path), "--out", str(out_path)],
            capture_output=True, text=True, timeout=900,
        )
        if out_path.exists():
            data = json.loads(out_path.read_text(encoding="utf-8"))
            if data.get("ok"):
                return data
        # el script imprime JSON por stdout también
        line = next((l for l in reversed((r.stdout or "").splitlines()) if l.strip().startswith("{")), "")
        if line:
            data = json.loads(line)
            if data.get("ok"):
                return data
    except Exception as e:  # noqa: BLE001
        print(f"[highlights] emotion_director skip: {e}", file=sys.stderr)
    return {}


def arousal_align(m: dict, emotion: dict) -> float:
    """0-1: qué tan alineado está el momento con la intensidad emocional del audio.
    Promedio de la curva de arousal dentro de la ventana + bonus si cae sobre un PICO."""
    arousal = emotion.get("arousal") or []
    peaks = emotion.get("peaks") or []
    if not arousal:
        return 0.0
    s, e = m["start"], m["end"]
    vals = [float(p.get("a", 0)) for p in arousal if s <= float(p.get("t", -1)) <= e]
    base = sum(vals) / len(vals) if vals else 0.0
    peak_bonus = 0.25 if any(s <= float(p.get("t", -1)) <= e for p in peaks) else 0.0
    return max(0.0, min(1.0, base + peak_bonus))


# ══════════════════════════════════════════════════════════════════════════════
# 5) Fusión + selección adaptativa + orden por arco emocional
# ══════════════════════════════════════════════════════════════════════════════
def fuse_score(m: dict, words: list[dict], emotion: dict) -> dict:
    """Score fusionado 0-100 = LLM(intensity) + virality determinista + alineación arousal."""
    llm = m["intensity"] * 100.0
    v = score_clip(words, m["start"], m["end"], m.get("hook", ""))
    viral = float(v["score"])
    ar = arousal_align(m, emotion)
    fused = W_LLM * llm + W_VIRAL * viral + W_AROUSAL * (ar * 100.0)
    m = dict(m)
    m["llm"] = round(llm, 1)
    m["viral"] = round(viral, 1)
    m["arousalAlign"] = round(ar, 3)
    m["fused"] = round(fused, 1)
    return m


def _overlaps(a: dict, b: dict) -> bool:
    """>40% de solape temporal entre dos momentos."""
    lo, hi = max(a["start"], b["start"]), min(a["end"], b["end"])
    inter = max(0.0, hi - lo)
    return inter > 0.4 * min(a["end"] - a["start"], b["end"] - b["start"])


def select_adaptive(cands: list[dict], max_seconds: float, min_seconds: float, floor: float) -> list[dict]:
    """Greedy por score fusionado: suma momentos hasta llenar ≤max_seconds SIN bajar del
    umbral de calidad. ADAPTATIVO: si el material es flojo, corta antes → reel más corto.
    Nunca rellena con relleno. Degrada el umbral solo si no llega al mínimo."""
    cands = sorted(cands, key=lambda m: -m["fused"])

    def greedy(threshold: float) -> tuple[list[dict], float]:
        picked: list[dict] = []
        total = 0.0
        for m in cands:
            if m["fused"] < threshold:
                break  # ordenado desc → de acá para abajo todo cae bajo el umbral
            dur = m["end"] - m["start"]
            if total + dur > max_seconds:
                continue  # no entra en el presupuesto; probar el siguiente (más corto)
            if any(_overlaps(m, p) for p in picked):
                continue
            picked.append(m)
            total += dur
            if total >= max_seconds - MOMENT_MIN:
                break
        return picked, total

    picked, total = greedy(floor)
    # Adaptativo a la baja: si no junta ni el mínimo, aflojar el umbral por pasos.
    step = floor
    while total < min_seconds and step > 30:
        step -= 8
        picked, total = greedy(step)
    return picked


def order_by_arc(picked: list[dict]) -> list[dict]:
    """Reordena por ARCO EMOCIONAL (no cronológico, no por score):
    gancho más fuerte al inicio → construcción (arousal creciente, emociones alternadas)
    → cierre memorable (remate/quote/giro potente)."""
    if len(picked) <= 2:
        return sorted(picked, key=lambda m: -m["fused"])
    pool = list(picked)

    def hook_strength(m: dict) -> float:
        bonus = 15 if m["punchType"] == "hook" else 0
        return m["fused"] + bonus + m["viral"] * 0.3  # el hook frena el scroll en 2s

    def close_strength(m: dict) -> float:
        bonus = 15 if m["punchType"] in ("remate", "quote", "giro", "revelacion") else 0
        return m["fused"] + bonus + m["intensity"] * 20

    opener = max(pool, key=hook_strength)
    pool.remove(opener)
    closer = max(pool, key=close_strength)
    pool.remove(closer)
    # Medio: arousal creciente hacia el final, alternando emoción para no aburrir.
    middle = sorted(pool, key=lambda m: m["arousalAlign"])
    arc: list[dict] = [opener]
    last_emotion = opener["emotion"]
    remaining = middle[:]
    while remaining:
        # preferir una emoción distinta a la anterior (variedad), si hay
        pick = next((m for m in remaining if m["emotion"] != last_emotion), remaining[0])
        arc.append(pick)
        remaining.remove(pick)
        last_emotion = pick["emotion"]
    arc.append(closer)
    return arc


# ══════════════════════════════════════════════════════════════════════════════
# 6) Ensamblado: extraer segmentos → concatenar (corte duro) → re-transcribir
# ══════════════════════════════════════════════════════════════════════════════
def _probe_duration(path: Path) -> float:
    try:
        r = subprocess.run(
            [str(FFPROBE_PATH), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float((r.stdout or "0").strip() or 0)
    except Exception:  # noqa: BLE001
        return 0.0


def assemble_montage(raw_path: Path, segments: list[dict], clip_id: str,
                     aspect_ratio: str, face_tracking: str) -> Path | None:
    """Extrae cada momento (uniforme, con reframe/aspect) y los concatena con CORTE DURO.
    Devuelve el path del montage en clips/{clip_id}.mp4, o None si falla."""
    from extract_clips import extract_clip  # import lazy (arrastra config/ffmpeg)
    from hw_profile import ffmpeg_full_args

    out = LF_CLIPS / f"{clip_id}.mp4"
    with tempfile.TemporaryDirectory(prefix="highlights_", dir=str(LF_CLIPS)) as tmpd:
        tmp = Path(tmpd)
        seg_paths: list[Path] = []
        for i, m in enumerate(segments):
            seg = tmp / f"seg_{i:02d}.mp4"
            try:
                # NO recortar a 9:16 acá: se deja el aspecto del SOURCE (igual que los
                # clips normales de largos, que quedan 16:9). ViralVideo cubre (objectFit
                # cover) el montage al aspecto de salida y LLENA el frame. Recortar acá a
                # 608x1080 daba un video de baja resolución que cover NO reescalaba →
                # barras negras. El reframe/encuadre lo maneja el render (como siempre).
                extract_clip(raw_path, m["start"], m["end"], seg,
                             target_aspect=None, face_tracking="off",
                             clip_id=f"{clip_id}_seg{i:02d}")
            except Exception as e:  # noqa: BLE001
                print(f"[highlights] segmento {i} falló, se salta: {e}", file=sys.stderr)
                continue
            if seg.exists() and seg.stat().st_size > 10_000:
                seg_paths.append(seg)
        if len(seg_paths) < 2:
            print("[highlights] menos de 2 segmentos válidos — no hay reel", file=sys.stderr)
            return None
        # Concat demuxer + re-encode adaptativo (mismo criterio que supercut.py: los
        # segmentos ya son uniformes, pero re-encodear evita cualquier corrupción de
        # stream-copy entre encoders/params). Corte duro = estilo viral 2026.
        list_file = tmp / "concat.txt"
        list_file.write_text("".join(f"file '{p.as_posix()}'\n" for p in seg_paths), encoding="utf-8")
        ff = ffmpeg_full_args(input_path=None, quality="final")
        tmp_out = out.with_name(out.stem + ".__building.mp4")
        r = subprocess.run(
            [str(FFMPEG_PATH), "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
             *ff["video_args"], "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             *ff["container_args"], str(tmp_out)],
            capture_output=True, text=True, timeout=1800,
        )
        if r.returncode != 0 or not tmp_out.exists() or tmp_out.stat().st_size < 100_000:
            last = ((r.stderr or "").strip().splitlines() or ["ffmpeg falló"])[-1]
            tmp_out.unlink(missing_ok=True)
            print(f"[highlights] concat falló: {last[:200]}", file=sys.stderr)
            return None
        tmp_out.replace(out)
    return out


def _has_words(tpath: Path) -> bool:
    try:
        return len(json.loads(tpath.read_text(encoding="utf-8")).get("words", [])) > 0
    except Exception:  # noqa: BLE001
        return False


def build_unified_transcript(source_transcript: Path, segments: list[dict], clip_id: str) -> Path:
    """FALLBACK sin Whisper: fusiona los words[] de cada segmento (en orden de arco) con
    OFFSET ACUMULADO (la duración del montage hasta ese segmento). Reusa slice_transcript
    (re-ancla a 0) y desplaza. Timestamps del source (si es segment-level, interpolados;
    igual cubren el montage → subtítulos legibles). Garantiza captions aunque Whisper no esté."""
    from extract_clips import slice_transcript

    tpath = LF_TRANSCRIPTS / f"{clip_id}.json"
    merged: list[dict] = []
    offset = 0.0
    for m in segments:
        try:
            sub = slice_transcript(source_transcript, m["start"], m["end"])
        except Exception:  # noqa: BLE001
            sub = {"words": []}
        for w in sub.get("words", []):
            merged.append({
                "word": w.get("word", ""),
                "start": round(float(w.get("start", 0)) + offset, 3),
                "end": round(float(w.get("end", 0)) + offset, 3),
                "score": w.get("score", 0.0),
            })
        offset += (m["end"] - m["start"])
    tpath.write_text(json.dumps({"duration": round(offset, 2), "words": merged, "alignment": "segment"},
                                ensure_ascii=False), encoding="utf-8")
    return tpath


def retranscribe(montage: Path, clip_id: str, source_transcript: Path, segments: list[dict]) -> Path:
    """Transcript del montage para subtítulos. PREFERIDO: re-transcribir el montage con
    Whisper (karaoke EXACTO sobre el video ya concatenado). Si Whisper no está / falla /
    devuelve vacío → FALLBACK offset-merge del source (siempre da captions, nunca rompe)."""
    tpath = LF_TRANSCRIPTS / f"{clip_id}.json"
    try:
        subprocess.run(
            [str(VENV_PYTHON), str(PYTHON_DIR / "transcribe.py"), str(montage), "--out", str(tpath)],
            capture_output=True, text=True, timeout=900,
        )
    except Exception as e:  # noqa: BLE001
        print(f"[highlights] re-transcripción falló: {e}", file=sys.stderr)
    if _has_words(tpath):
        return tpath
    print("[highlights] Whisper no dio words → fallback offset-merge del source", file=sys.stderr)
    return build_unified_transcript(source_transcript, segments, clip_id)


# ══════════════════════════════════════════════════════════════════════════════
# 7) Proposal sintética (1 clip) → el pipeline de render la consume sin cambios
# ══════════════════════════════════════════════════════════════════════════════
def write_synthetic_proposal(video_id: str, total: float, ordered: list[dict]) -> str:
    """Escribe proposals/{video_id}_highlights.json con UN clip (el reel entero).
    build-clip-supreme.mjs lee clips[0] (hook/theme/keywords/caption/hashtags)."""
    opener = ordered[0] if ordered else {}
    hook = str(opener.get("hook") or "Los mejores momentos")
    quotes = [m.get("quote") or m.get("hook") for m in ordered if (m.get("quote") or m.get("hook"))]
    caption = "Lo mejor en un solo video:\n" + "\n".join(f"• {q}" for q in quotes[:4])
    keywords: list[str] = []
    for m in ordered:
        for k in m.get("keywords", []):
            if k and k not in keywords:
                keywords.append(k)
    hashtags = ["#mejoresmomentos", "#viral", "#charla", "#podcast", "#aprende", "#tips"]
    synth_video = f"{video_id}_highlights"
    proposal = {
        "video_id": synth_video,
        "kind": "highlights",
        "clips": [{
            "index": 1,
            "start": 0,
            "end": round(total, 2),
            "slug": "reel",
            "hook": hook[:240],
            "theme": "Mejores momentos",
            "keywords": keywords[:7] or ["MEJORES", "MOMENTOS"],
            "caption": caption[:280],
            "hashtags": hashtags,
        }],
    }
    (LF_PROPOSALS / f"{synth_video}.json").write_text(
        json.dumps(proposal, ensure_ascii=False, indent=2), encoding="utf-8")
    return synth_video


# ══════════════════════════════════════════════════════════════════════════════
# 8) Orquestación
# ══════════════════════════════════════════════════════════════════════════════
def _find_raw(video_id: str) -> Path | None:
    for ext in (".mp4", ".mov", ".mkv", ".webm", ".m4v"):
        p = LF_RAW / f"{video_id}{ext}"
        if p.exists():
            return p
    return None


def build_highlights(video_id: str, max_seconds: float, min_seconds: float, floor: float,
                     aspect_ratio: str, face_tracking: str, provider_override: str | None) -> dict:
    ensure_long_form_dirs()
    raw = _find_raw(video_id)
    if not raw:
        return {"ok": False, "error": f"no encuentro el video raw de {video_id}"}
    tpath = LF_TRANSCRIPTS / f"{video_id}.json"
    if not tpath.exists():
        return {"ok": False, "error": f"falta el transcript de {video_id} (transcribí primero)"}
    transcript = json.loads(tpath.read_text(encoding="utf-8"))
    words = transcript.get("words", [])
    duration = float(transcript.get("duration") or (words[-1]["end"] if words else 0))
    if not words or duration < 60:
        return {"ok": False, "error": "transcript vacío o video muy corto para un reel"}

    provider = provider_override or clip_provider()
    model = OLLAMA_MODEL
    # cuántos momentos pedir: ~1 cada 12s de presupuesto, con colchón para el filtro.
    want = max(8, int(max_seconds / 12) + 4)

    # 1) candidatos del LLM
    raw_moments = collect_candidates(words, duration, provider, model, want)
    if not raw_moments:
        return {"ok": False, "error": "el LLM no devolvió momentos (¿Ollama apagado?)"}

    # 2) anclar + validar (8-30s)
    anchored = [a for a in (anchor_moment(m, words, duration) for m in raw_moments) if a]
    # dedup temporal grueso (mismo hook citado dos veces)
    uniq: list[dict] = []
    for a in anchored:
        if not any(_overlaps(a, u) for u in uniq):
            uniq.append(a)
    if not uniq:
        return {"ok": False, "error": "ningún momento sobrevivió el anclaje/validación"}

    # 3) emoción del audio (best-effort) + fusión
    emotion = run_emotion_director(raw, tpath, video_id)
    scored = [fuse_score(m, words, emotion) for m in uniq]

    # 4) selección adaptativa ≤max sobre umbral
    picked = select_adaptive(scored, max_seconds, min_seconds, floor)
    total = sum(m["end"] - m["start"] for m in picked)
    if not picked or total < 12:
        return {"ok": False, "error": "pocos momentos buenos para armar un reel (video flojo)"}

    # 5) orden por arco emocional
    ordered = order_by_arc(picked)

    # curaduría auditable
    (LF_HIGHLIGHTS / f"{video_id}.json").write_text(json.dumps({
        "video_id": video_id, "max_seconds": max_seconds, "quality_floor": floor,
        "total_seconds": round(total, 2), "mood": emotion.get("mood"),
        "provider": provider, "count": len(ordered),
        "segments": ordered,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # 6) proposal sintética + clip_id
    synth_video = write_synthetic_proposal(video_id, total, ordered)
    clip_id = f"{synth_video}_c01_reel"

    # 7) ensamblado (extract → concat corte duro) + re-transcripción
    montage = assemble_montage(raw, ordered, clip_id, aspect_ratio, face_tracking)
    if not montage:
        return {"ok": False, "error": "no se pudo armar el montage"}
    retranscribe(montage, clip_id, tpath, ordered)

    return {
        "ok": True,
        "video_id": video_id,
        "synth_video": synth_video,
        "clip_id": clip_id,
        "montage": str(montage),
        "moments": len(ordered),
        "seconds": round(total, 1),
        "mood": emotion.get("mood"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Mejores Momentos: 1 video ≤3 min de lo mejor de un largo")
    ap.add_argument("video_id")
    ap.add_argument("--max-seconds", type=float, default=DEFAULT_MAX_SECONDS)
    ap.add_argument("--min-seconds", type=float, default=DEFAULT_MIN_SECONDS)
    ap.add_argument("--quality-floor", type=float, default=QUALITY_FLOOR)
    ap.add_argument("--aspect-ratio", default="9:16")
    ap.add_argument("--face-tracking", default="off", choices=["off", "single", "per-frame"])
    ap.add_argument("--provider", default=None, choices=["claude", "codex", "ollama"])
    args = ap.parse_args()
    try:
        result = build_highlights(
            args.video_id, max(30.0, min(180.0, args.max_seconds)),
            args.min_seconds, args.quality_floor, args.aspect_ratio,
            args.face_tracking, args.provider,
        )
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
