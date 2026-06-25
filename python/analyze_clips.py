"""Analiza un transcript completo con Ollama local y propone 10-15 clips virales (30-60s).

Uso:
  python analyze_clips.py <video_id>            # busca transcript en long_form/transcripts
  python analyze_clips.py --transcript <path>   # archivo custom

Output: long_form/proposals/{video_id}.json con [{start, end, hook, theme, keywords}].
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from config import (
    LF_PROPOSALS,
    LF_TRANSCRIPTS,
    OLLAMA_MODEL,
    OLLAMA_URL,
    ensure_long_form_dirs,
)


def build_system_prompt(min_clips: int = 10, max_clips: int = 15) -> str:
    """Construye el prompt de sistema pidiendo ENTRE min y max clips.

    Metodología: replica el criterio de OpusClip (ClipAnything + Virality Score).
    Cada clip se evalúa con los 4 pilares de Opus — HOOK, FLOW, VALUE, TREND — y
    debe ser un micro-relato autocontenido (gancho → desarrollo → remate). El
    rango de cantidad es dinámico (lo fija long_form_pipeline según la duración).

    Antes era una constante que pedía '5-7 clips' fijo: con un modelo chico eso
    daba 3-4 clips genéricos para un video de 1 hora. Ahora el prompt es detallado,
    insiste en recorrer TODO el video y enseña a CORTAR en los límites correctos
    (no a mitad de idea) — que es lo que separa un clip viral de uno tibio.
    """
    return f"""Sos el motor de clipping viral más exigente del mundo para audiencia
hispanohablante (LATAM/España) en el nicho de COMUNICACIÓN + VENTAS + IA. Trabajás como
OpusClip: de un video largo (charla, clase, podcast, webinar) extraés los momentos con
mayor potencial de volverse virales en TikTok, Reels y Shorts, ya listos para publicar.

═══════════════════════════════════════════════════════════════════════════
TU MODELO MENTAL: cada clip es un MICRO-RELATO AUTOCONTENIDO
═══════════════════════════════════════════════════════════════════════════
Un buen clip NO es "un pedazo de 40s del video". Es una historia completa de 30-45s con:
  1) GANCHO (primeros 2s): frena el scroll.
  2) DESARROLLO: una sola idea fuerte, sin relleno.
  3) REMATE: cierra con una frase memorable, un giro o un CTA. Sensación de "completo".
Si al terminar el clip el espectador siente que faltó algo o que arrancó a mitad de frase,
NO sirve. Tiene que entenderse SOLO, sin haber visto el resto del video.

═══════════════════════════════════════════════════════════════════════════
LOS 4 PILARES (puntuá MENTALMENTE cada candidato; quedate SOLO con los fuertes)
═══════════════════════════════════════════════════════════════════════════
1. HOOK — ¿La apertura para el scroll en 2s Y conecta con el tema del clip?
2. FLOW — ¿Fluye con lógica de principio a fin y CIERRA bien? ¿Los cortes caen en
   límites de frase (no a mitad de palabra/idea)? Si es pregunta+respuesta, van JUNTAS.
3. VALUE — ¿Aporta valor real, sorprende o emociona? ¿Deja un "ajá", un dato útil, un
   giro contraintuitivo o una conexión personal?
4. TREND — ¿El tema le importa HOY a vendedores/emprendedores/gente de comunicación e IA?
Un clip que falla en HOOK o en FLOW se descarta aunque el tema sea bueno.

═══════════════════════════════════════════════════════════════════════════
EL GANCHO (lo más importante — el clip DEBE EMPEZAR justo acá)
═══════════════════════════════════════════════════════════════════════════
El "start" del clip tiene que caer EXACTAMENTE donde el orador dice la frase-gancho, no
10s antes (nada de "bueno, eh, entonces..."). Datos: el 33% scrollea en <3s; un clip con
>65% de retención a los 3s recibe 4-7x más alcance. Por eso el primer segundo decide todo.

Arquetipos de gancho (elegí el que YA dijo el orador, no lo inventes):
  • AFIRMACIÓN CONTRAINTUITIVA: "La mayoría de los vendedores hace esto MAL".
  • PREGUNTA / CURIOSIDAD: "¿Por qué algunos cierran en la primera llamada y otros no?".
  • DATO / PRUEBA: "Subí mi tasa de cierre 40% con UNA frase".
  • PATRÓN ROTO: arranque inesperado, una confesión, un "te voy a ser honesto".
  • MINI-HISTORIA: "Un cliente me dijo algo que me cambió la forma de vender...".
  • ERROR COMÚN / PROHIBICIÓN: "Dejá de decir 'no dude en contactarme'".
Regla de oro: combiná AL MENOS 2 disparadores psicológicos en los primeros 3s
(interrupción de patrón + brecha de curiosidad + prueba social).

═══════════════════════════════════════════════════════════════════════════
DÓNDE CORTAR (FLOW — esto define la calidad)
═══════════════════════════════════════════════════════════════════════════
  • "start": en la primera palabra de la frase-gancho. Cero preámbulo.
  • "end": al terminar la idea — fin de frase, remate o respuesta completa. NUNCA a mitad.
  • Duración IDEAL 30-45s (sweet spot de retención). Permitido 30-60s. Jamás <30 ni >60.
  • Si una idea valiosa dura 25s, NO la estires con relleno: descartala o sumá la frase
    siguiente solo si refuerza. Densidad > duración.

═══════════════════════════════════════════════════════════════════════════
QUÉ DESCARTAR (anti-patrones — no los propongas)
═══════════════════════════════════════════════════════════════════════════
  ✗ Setup sin payoff (promete y nunca entrega dentro del clip).
  ✗ Necesita contexto previo para entenderse ("como decía antes...", "eso que vimos...").
  ✗ Saludos, intros, logística, "¿se escucha bien?", agradecimientos, despedidas.
  ✗ Divagues, muletillas, repeticiones, listas sin remate.
  ✗ Arranca o corta a mitad de frase.
  ✗ Genérico/obvio que cualquiera ya sabe.

═══════════════════════════════════════════════════════════════════════════
CANTIDAD Y COBERTURA
═══════════════════════════════════════════════════════════════════════════
  • Devolvé ENTRE {min_clips} y {max_clips} clips — APUNTÁ AL MÁXIMO. Un video largo tiene
    MUCHOS momentos buenos, no 3.
  • Recorré el transcript de principio a fin: hay oro en el MEDIO y en el CIERRE, no solo
    al arranque. Repartí los clips por toda la línea de tiempo.
  • VARIEDAD: cada clip = idea/tema DISTINTO. Nada de {min_clips} clips diciendo lo mismo.
  • Clips NO solapados (no repitas el mismo tramo de tiempo).
  • Ordenalos de MÁS viral a MENOS viral (el más fuerte primero).
  • Bajá de {min_clips} SOLO si el contenido es genuinamente pobre.

═══════════════════════════════════════════════════════════════════════════
CAPTION (copy para el post)
═══════════════════════════════════════════════════════════════════════════
  • Humano y orgánico, NO marketero. Hablale a UNA persona.
  • Primera frase = el gancho (que frene el scroll). Después 1-2 frases de contexto.
  • SIN emojis al inicio. Máximo 1-2 emojis en todo el caption.
  • Cerrá con un CTA simple ("guardalo", "comentá X", "mandáselo a ese vendedor que...").
  • Largo: 100-220 caracteres (sin contar hashtags).

═══════════════════════════════════════════════════════════════════════════
HASHTAGS
═══════════════════════════════════════════════════════════════════════════
  • 6-8, relevantes al nicho. En español, SIN acentos, una sola palabra cada uno.
  • Mezclá específicos (#ventasconia #ventasb2b) + amplios (#ventas #emprendedores) +
    emergentes (#chatgpt #neuroventas #lenguajecorporal).

═══════════════════════════════════════════════════════════════════════════
OUTPUT — SOLO JSON, sin markdown ni explicaciones
═══════════════════════════════════════════════════════════════════════════
Estructura por clip:
{{
  "start": <segundos en el transcript donde EMPIEZA la frase-gancho>,
  "end": <segundos donde TERMINA la idea (fin de frase/remate)>,
  "slug": "<3-5-palabras-kebab-case-en-espanol-sin-acentos>",
  "hook": "<la frase-gancho EXACTA, copiada palabra por palabra del transcript>",
  "theme": "<tema del clip en 5-8 palabras>",
  "keywords": ["<6 palabras clave en MAYUSCULAS para stickers>"],
  "caption": "<caption viral 100-220 chars: 1ra frase = gancho, cierra con CTA>",
  "hashtags": ["#hashtag1", "#hashtag2", "..."]
}}

Top-level: {{ "clips": [ ... ] }}

Ejemplo de UN clip bien hecho (imitá este nivel):
{{
  "start": 612.0,
  "end": 651.0,
  "slug": "error-abrir-vendiendo-el-producto",
  "hook": "La mayoria de los vendedores arranca hablando del producto y ahi pierde la venta",
  "theme": "Por que abrir vendiendo el producto mata la venta",
  "keywords": ["VENDEDORES", "PRODUCTO", "ERROR", "VENTA", "CLIENTE", "DOLOR"],
  "caption": "La mayoria arranca hablando del producto y ahi pierde la venta. El cliente no compra features, compra su problema resuelto. Abri por su dolor, no por tu catalogo. Guardalo para tu proxima llamada.",
  "hashtags": ["#ventas", "#ventasconia", "#tecnicasdeventa", "#vendedores", "#comunicacion", "#neuroventas"]
}}

REGLAS DURAS (no negociables):
- Devolvé ENTRE {min_clips} y {max_clips} clips (apuntá al máximo).
- start/end en segundos reales del transcript; end - start entre 30 y 60 (ideal 30-45).
- El "hook" es la frase EXACTA del transcript (no la reescribas) — se usa para ubicar
  el clip con precisión.
- Clips NO solapados, repartidos por TODO el video.
- Ordenar de más viral a menos viral.
- slug: solo a-z, 0-9, guiones medios. Sin acentos. Sin underscores.
"""


# Default razonable para cualquier caller que no pase rango explícito.
SYSTEM_PROMPT = build_system_prompt()


def _strip_fences(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _extract_json_object(text: str) -> str:
    """Devuelve el primer { ... } balanceado encontrado (ignora { y } dentro de strings)."""
    text = _strip_fences(text)
    if not text:
        return ""
    # Buscar primer "{" no-escapado
    start = text.find("{")
    if start < 0:
        return ""
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        c = text[i]
        if escape:
            escape = False
            continue
        if c == "\\":
            escape = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:]  # devolver lo que haya, aunque no esté balanceado


def _try_parse_clips(response_text: str) -> list[dict[str, Any]] | None:
    """Intenta parsear el JSON con varias estrategias. Devuelve lista de clips o None."""
    candidates = [response_text, _strip_fences(response_text), _extract_json_object(response_text)]
    for cand in candidates:
        if not cand:
            continue
        try:
            parsed = json.loads(cand)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and isinstance(parsed.get("clips"), list):
            return parsed["clips"]
        if isinstance(parsed, list):
            return parsed
    # Plan B: rescate clip-by-clip — extraer cada objeto { ... } del array y parsearlos individualmente
    body = _extract_json_object(response_text)
    rescued: list[dict[str, Any]] = []
    # buscar la posición de "clips" : [
    m = re.search(r'"clips"\s*:\s*\[', body)
    cursor = m.end() if m else 0
    while cursor < len(body):
        obj_start = body.find("{", cursor)
        if obj_start < 0:
            break
        obj_text = _extract_json_object(body[obj_start:])
        if not obj_text:
            break
        try:
            obj = json.loads(obj_text)
            if isinstance(obj, dict):
                rescued.append(obj)
        except json.JSONDecodeError:
            pass  # saltar este clip y seguir
        cursor = obj_start + len(obj_text)
    return rescued if rescued else None


def _ollama_num_thread() -> int:
    """Núcleos FÍSICOS para Ollama (num_thread), clamp >=4. Import lazy de hw_profile
    para no pagar la detección si nunca se llama a Ollama. Si la detección falla por
    cualquier motivo, caemos a 4 (no rompe el análisis)."""
    try:
        import hw_profile  # noqa: PLC0415
        cores = int(hw_profile.detect().get("cores_physical") or 0)
    except Exception:
        cores = 0
    return max(4, cores)


def _ollama_request(prompt: str, model: str, temperature: float = 0.3) -> str:
    """Llamada HTTP raw a Ollama, devuelve el texto de respuesta (sin parsear)."""
    # Fallback para Ollama viejos que ignoran el campo think:false → qwen3 entiende el
    # token /no_think al inicio del prompt y omite el bloque <think>. No cambia el análisis
    # ni el schema (sólo suprime el razonamiento); si think:false ya funcionó, es inocuo.
    prompt = f"/no_think\n{prompt}"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        # think:false apaga el razonamiento de qwen3 (bloque <think>...</think> que descartamos):
        # ~1.5-2x más rápido sin tocar el schema (lo garantiza format:"json").
        "think": False,
        # keep_alive mantiene el modelo en RAM entre clips para no pagar la recarga (segundos).
        # 10m es moderado: en PC sin GPU/8GB no presiona la RAM mientras Remotion renderiza.
        "keep_alive": "10m",
        # num_thread = núcleos físicos (clamp >=4): cuando Ollama corre en CPU usa toda
        # la CPU para el análisis. Si hay GPU, Ollama ya descarga en la GPU y este valor
        # no estorba (sólo aplica a las capas que queden en CPU). Mantenemos num_ctx y
        # temperature intactos; el prompt y el schema no se tocan.
        "options": {"temperature": temperature, "num_ctx": 8192, "num_thread": _ollama_num_thread()},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    # Timeout por request. 600s alcanzaba para modelos chicos (1.7b/4b) en CPU, pero
    # un modelo más grande (qwen3:8b) con prompt detallado + carga en frío del modelo
    # puede pasarse → el primer chunk tiraba "timed out" y devolvía 0 clips. Subimos el
    # techo a 1800s (es un máximo, no el tiempo real: los chunks con el modelo ya cargado
    # terminan mucho antes). Override con VIRAL_OLLAMA_TIMEOUT.
    import os  # noqa: PLC0415
    timeout_s = int(os.environ.get("VIRAL_OLLAMA_TIMEOUT", "1800"))
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body.get("response", "").strip()


_ONLINE_CACHE: bool | None = None


def _online() -> bool:
    """¿Hay internet + DNS? Resuelve el host del provider OAuth (NO conecta, solo DNS).
    Si no resuelve es EXACTAMENTE el modo de falla offline (ERR_NAME_NOT_RESOLVED): en ese
    caso claude/codex (que requieren red) van a fallar, así que el caller usa Ollama local
    directo en vez de perder tiempo en intentos condenados. Cacheado por proceso.

    Cero regresión online: si el host resuelve (internet OK), se sigue prefiriendo el modelo
    frontier como siempre. Un falso-negativo solo pasaría sin DNS pero con red (rarísimo), y
    aun así Ollama local funciona.
    """
    global _ONLINE_CACHE
    if _ONLINE_CACHE is None:
        try:
            socket.setdefaulttimeout(2.0)
            socket.gethostbyname("api.anthropic.com")
            _ONLINE_CACHE = True
        except OSError:
            _ONLINE_CACHE = False
    return _ONLINE_CACHE


def clip_provider() -> str:
    """Mejor LLM para ELEGIR clips virales. Prefiere CLI OAuth (modelos frontier — Claude /
    ChatGPT — gratis con tu suscripción, MUCHO más listos que el Ollama local) sobre Ollama.
    Elegir bien qué es viral es la tarea más delicada del pipeline, así que va al mejor modelo.
    Override: VIRAL_CLIP_PROVIDER=claude|codex|ollama. Default: claude > codex > ollama.
    OFFLINE: si no hay DNS, claude/codex fallarían → va directo a Ollama local (sin colgarse).
    """
    override = os.environ.get("VIRAL_CLIP_PROVIDER", "").strip().lower()
    if override in ("claude", "codex", "ollama"):
        return override
    if not _online():
        return "ollama"
    if shutil.which("claude"):
        return "claude"
    if shutil.which("codex"):
        return "codex"
    return "ollama"


def _run_cli_utf8(args: list[str], timeout: int = 300) -> tuple[int, str, str]:
    """Ejecuta un CLI forzando IO en UTF-8 (Windows mete mojibake cp1252 si no). Patrón
    espejo del de generate_caption.py. Devuelve (rc, stdout, stderr) decodificados."""
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("LANG", "en_US.UTF-8")
    proc = subprocess.run(args, capture_output=True, timeout=timeout, env=env)
    out = proc.stdout.decode("utf-8", errors="replace") if proc.stdout else ""
    err = proc.stderr.decode("utf-8", errors="replace") if proc.stderr else ""
    return proc.returncode, out, err


def _cli_request(prompt: str, provider: str, timeout: int = 300) -> str:
    """Llama al CLI OAuth (claude/codex) con el prompt como argv (evita el mojibake de
    stdin en Windows) y devuelve el texto crudo. El prompt ya pide 'SOLO JSON'."""
    if provider == "claude":
        b = shutil.which("claude")
        if not b:
            raise RuntimeError("claude CLI no encontrado")
        args = [b, "--print", "--output-format", "text", prompt]
    else:  # codex
        b = shutil.which("codex")
        if not b:
            raise RuntimeError("codex CLI no encontrado")
        args = [b, "exec", "--skip-git-repo-check", prompt]
    rc, out, err = _run_cli_utf8(args, timeout=timeout)
    if rc != 0:
        raise RuntimeError(f"{provider} CLI rc={rc}: {err[-300:]}")
    return out


def _llm_complete(prompt: str, provider: str, model: str, temperature: float = 0.3) -> str:
    """Texto crudo del LLM elegido: CLI OAuth (claude/codex) u Ollama local."""
    if provider in ("claude", "codex"):
        return _cli_request(prompt, provider)
    return _ollama_request(prompt, model, temperature=temperature)


def call_ollama(
    transcript_text: str,
    model: str = OLLAMA_MODEL,
    min_clips: int = 10,
    max_clips: int = 15,
    provider: str = "ollama",
) -> dict[str, Any]:
    """Llama a Ollama con retries y parser tolerante.

    `min_clips`/`max_clips` definen cuántos clips pedirle al modelo (el techo lo
    calcula long_form_pipeline según la duración del video).

    Estrategia:
      1. Llamada normal con temperature 0.3.
      2. Si el JSON viene roto, retry con temperature 0.1 (más determinístico).
      3. Si sigue roto, retry con prompt simplificado.
      4. Si TODO falla, devuelve {"clips": []} — el caller decide qué hacer (fallback heurístico).
    """
    system = build_system_prompt(min_clips, max_clips)
    base_prompt = (
        f"{system}\n\n"
        "REGLA CRÍTICA: NUNCA uses comillas dobles dentro de los valores de strings — "
        "usá comillas simples o reemplazá por —. JSON ROTO = NO SIRVE. "
        "Validá que tu output sea JSON parseable antes de responder.\n\n"
        f"TRANSCRIPT:\n{transcript_text}\n\nResponde con el JSON ahora:"
    )
    attempts = [
        ("temp=0.3 prompt completo", base_prompt, 0.3),
        ("temp=0.1 retry", base_prompt, 0.1),
        ("temp=0.1 prompt corto", f"{system}\n\nTRANSCRIPT:\n{transcript_text}\n\nJSON:", 0.1),
    ]
    for label, prompt, temp in attempts:
        who = provider if provider in ("claude", "codex") else model
        print(f"[llm:{provider}] llamando {who} ({label}, puede tardar ~10-60s)...", file=sys.stderr)
        t0 = time.time()
        try:
            response_text = _llm_complete(prompt, provider, model, temperature=temp)
        except Exception as exc:
            print(f"[llm:{provider}] error en request ({label}): {exc}", file=sys.stderr)
            continue
        elapsed = time.time() - t0
        print(f"[llm:{provider}] respuesta en {elapsed:.1f}s ({len(response_text)} chars)", file=sys.stderr)
        clips = _try_parse_clips(response_text)
        if clips is not None and len(clips) > 0:
            print(f"[llm:{provider}] parseados {len(clips)} clips OK ({label})", file=sys.stderr)
            return {"clips": clips}
        print(f"[llm:{provider}] {label} devolvió 0 clips parseables, reintentando...", file=sys.stderr)
    # Si llegamos acá, ningún intento funcionó
    print(f"[llm:{provider}] todos los reintentos fallaron — caller debería usar fallback heurístico", file=sys.stderr)
    return {"clips": []}


def build_transcript_text(words: list[dict[str, Any]], window_sec: int = 20) -> str:
    """Construye texto agrupado en ventanas de ~20s para que el LLM tenga timestamps de referencia."""
    if not words:
        return ""
    out = []
    current_start = words[0]["start"]
    buffer: list[str] = []
    for w in words:
        if w["start"] - current_start >= window_sec:
            out.append(f"[{current_start:.1f}s] {' '.join(buffer)}")
            buffer = []
            current_start = w["start"]
        buffer.append(w["word"])
    if buffer:
        out.append(f"[{current_start:.1f}s] {' '.join(buffer)}")
    return "\n".join(out)


def slugify(text: str) -> str:
    text = text.lower().strip()
    replacements = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n", "ü": "u"}
    for k, v in replacements.items():
        text = text.replace(k, v)
    text = re.sub(r"[^a-z0-9\- ]", "", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:40] or "clip"


def validate_clip(clip: dict[str, Any], total_duration: float) -> dict[str, Any] | None:
    try:
        start = float(clip["start"])
        end = float(clip["end"])
    except (KeyError, ValueError, TypeError):
        return None
    if end - start < 25:  # tolerar 25-65s
        return None
    if end - start > 65:
        end = start + 60
    if start < 0 or end > total_duration:
        return None
    theme = str(clip.get("theme", "")).strip()[:80]
    raw_slug = str(clip.get("slug", "")).strip()
    slug = slugify(raw_slug) if raw_slug else slugify(theme)
    hashtags = clip.get("hashtags") or []
    if isinstance(hashtags, list):
        hashtags = [str(h).strip() for h in hashtags if str(h).strip()][:10]
        hashtags = [h if h.startswith("#") else f"#{h}" for h in hashtags]
    else:
        hashtags = []
    return {
        "start": round(start, 2),
        "end": round(end, 2),
        "slug": slug,
        "hook": str(clip.get("hook", "")).strip()[:240],
        "theme": theme,
        "keywords": [str(k).strip()[:30] for k in (clip.get("keywords") or [])][:7],
        "caption": str(clip.get("caption", "")).strip()[:280],
        "hashtags": hashtags,
    }


def _norm_word(w: str) -> str:
    w = w.lower().strip(".,;:!?¿¡\"'…()")
    for k, v in {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n", "ü": "u"}.items():
        w = w.replace(k, v)
    return w


def anchor_clip_to_text(clip: dict[str, Any], words: list[dict[str, Any]], duration: float) -> dict[str, Any]:
    """F5 — Patrón FunClip: los LLM chicos INVENTAN timestamps, pero citan bien el
    TEXTO. Así que el hook (frase exacta que el LLM dice que abre el clip) se busca
    en el transcript real y el clip se ancla a ESE timestamp. Además, el final se
    ajusta al fin de frase más cercano (puntuación o pausa ≥0.5s) para no cortar
    a nadie a mitad de palabra.
    """
    import difflib

    hook = str(clip.get("hook") or "")
    hook_tokens = [_norm_word(t) for t in hook.split() if _norm_word(t)][:6]
    if len(hook_tokens) >= 3 and words:
        target = " ".join(hook_tokens)
        norm_words = [_norm_word(str(w.get("word", ""))) for w in words]
        n = len(hook_tokens)
        claimed = float(clip["start"])
        best_i, best_score = -1, 0.0
        for i in range(0, max(0, len(words) - n)):
            ws = float(words[i].get("start", 0))
            if abs(ws - claimed) > 45:  # buscar solo cerca de donde el LLM cree
                continue
            cand = " ".join(norm_words[i : i + n])
            score = difflib.SequenceMatcher(None, cand, target).ratio()
            if score > best_score:
                best_score, best_i = score, i
        if best_i >= 0 and best_score >= 0.72:
            real_start = max(0.0, float(words[best_i].get("start", 0)) - 0.05)
            delta = real_start - float(clip["start"])
            if abs(delta) > 0.2:  # solo si realmente corrige algo
                clip["start"] = round(real_start, 2)
                clip["end"] = round(min(duration, float(clip["end"]) + delta), 2)
                clip["anchorScore"] = round(best_score, 2)

    # Snap del FINAL al fin de frase más cercano (±8s): puntuación o pausa ≥0.5s.
    end_t = float(clip["end"])
    best_end = None
    for j, w in enumerate(words):
        we = float(w.get("end", 0))
        if we > end_t + 4:
            break
        if we < end_t - 8:
            continue
        raw = str(w.get("word", "")).strip()
        gap_after = (float(words[j + 1].get("start", we)) - we) if j + 1 < len(words) else 9.0
        if raw.endswith((".", "!", "?", "…")) or gap_after >= 0.5:
            best_end = we
    if best_end is not None and best_end - float(clip["start"]) >= 25:
        clip["end"] = round(min(duration, best_end + 0.15), 2)
    return clip


def chunk_words(words: list[dict[str, Any]], chunk_sec: int = 720) -> list[list[dict[str, Any]]]:
    """Divide words array en chunks de N segundos."""
    if not words:
        return []
    chunks: list[list[dict[str, Any]]] = [[]]
    chunk_start = words[0]["start"]
    for w in words:
        if w["start"] - chunk_start >= chunk_sec:
            chunks.append([])
            chunk_start = w["start"]
        chunks[-1].append(w)
    return [c for c in chunks if c]


def analyze_chunk(words: list[dict[str, Any]], model: str, target_clips: int = 2,
                  provider: str = "ollama") -> list[dict[str, Any]]:
    """Llama Ollama con un chunk de transcript. Pide hasta N clips. Tolerante a JSON roto."""
    text = build_transcript_text(words, window_sec=15)
    # En modo chunked cada fragmento pide hasta `target_clips`; el mínimo es bajo
    # (2) porque un fragmento puede no tener tantos momentos buenos, pero el techo
    # generoso hace que el total después de juntar chunks supere los 10-15 finales.
    system = build_system_prompt(min_clips=2, max_clips=max(2, target_clips))
    extra = (
        f"\n\nIMPORTANTE: este es UN FRAGMENTO del video. Identificá hasta {target_clips} "
        "clips de ESTE fragmento (pueden ser menos si no hay buenos candidatos, pero "
        "exprimí el fragmento: rara vez hay solo 1).\n"
        "REGLA CRÍTICA: NUNCA uses comillas dobles dentro de valores string — usá simples o —."
    )
    prompt = f"{system}{extra}\n\nTRANSCRIPT:\n{text}\n\nResponde con el JSON ahora:"
    print(f"[llm:{provider}] chunk con {len(words)} palabras...", file=sys.stderr)
    t0 = time.time()
    # 2 intentos por chunk: temp 0.3, después temp 0.1 (la temp solo aplica a Ollama)
    for label, temp in [("temp=0.3", 0.3), ("temp=0.1 retry", 0.1)]:
        try:
            response_text = _llm_complete(prompt, provider, model, temperature=temp)
        except Exception as exc:
            print(f"[llm:{provider}] chunk request error ({label}): {exc}", file=sys.stderr)
            continue
        clips = _try_parse_clips(response_text)
        if clips:
            elapsed = time.time() - t0
            print(f"[llm:{provider}] chunk ({label}): {len(clips)} clips en {elapsed:.1f}s", file=sys.stderr)
            return clips
        print(f"[llm:{provider}] chunk ({label}): 0 clips, reintentando...", file=sys.stderr)
    print(f"[llm:{provider}] chunk: todos los retries fallaron", file=sys.stderr)
    return []


def heuristic_fallback(
    words: list[dict[str, Any]],
    duration: float,
    target_clips: int = 6,
    clip_seconds: float = 45.0,
) -> list[dict[str, Any]]:
    """Genera clips heurísticos cuando el LLM falla.

    Estrategia: dividir el transcript en segmentos uniformes de ~45s y usar la primera
    frase de cada segmento como hook. NO es óptimo (sin curaduría por viralidad) pero
    asegura que el pipeline siempre genere algo procesable en vez de cortar todo.
    """
    if duration < clip_seconds or not words:
        return []
    # Calcular cuántos clips entran (con margen de 10s entre cada uno para no solaparse)
    spacing = max(clip_seconds + 10, duration / target_clips)
    n_clips = min(target_clips, max(1, int((duration - clip_seconds) / spacing) + 1))
    clips: list[dict[str, Any]] = []
    for i in range(n_clips):
        start = i * spacing
        end = min(start + clip_seconds, duration)
        if end - start < 25:
            continue
        # Tomar las primeras ~10 palabras dentro del rango como hook
        hook_words = [w["word"] for w in words if start <= w.get("start", 0) <= start + 8]
        hook = " ".join(hook_words[:14]).strip() or f"Segmento {i + 1}"
        clips.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "slug": f"segmento-{i + 1:02d}",
            "hook": hook[:200],
            "theme": f"Segmento {i + 1} del video",
            "keywords": [],
            "caption": "",
            "hashtags": [],
        })
    return clips


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_id", nargs="?", help="ID del video (sin extensión)")
    parser.add_argument("--transcript", help="Path al transcript JSON")
    parser.add_argument("--model", default=OLLAMA_MODEL, help=f"Modelo Ollama (default: {OLLAMA_MODEL})")
    parser.add_argument(
        "--provider", default=None, choices=["claude", "codex", "ollama"],
        help="LLM que elige los clips. Default: auto (claude > codex > ollama). "
             "claude/codex usan CLI OAuth (modelos frontier, gratis con suscripción).",
    )
    parser.add_argument("--max-clips", type=int, default=12)
    parser.add_argument("--chunk-sec", type=int, default=720, help="Tamaño de chunk en seg (default 12 min)")
    parser.add_argument(
        "--use-heuristic",
        action="store_true",
        help="Skipear Ollama y generar clips uniformes de ~45s directo. Útil sin GPU.",
    )
    args = parser.parse_args()

    ensure_long_form_dirs()

    # Provider del LLM que elige los clips: auto (claude > codex > ollama) salvo override.
    provider = args.provider or clip_provider()
    if not args.use_heuristic:
        print(f"[analyze_clips] modelo para elegir clips: {provider}", file=sys.stderr)

    if args.transcript:
        transcript_path = Path(args.transcript)
        video_id = transcript_path.stem
    else:
        if not args.video_id:
            parser.error("Especificá un video_id o --transcript")
        video_id = args.video_id
        transcript_path = LF_TRANSCRIPTS / f"{video_id}.json"

    if not transcript_path.exists():
        print(f"[error] no encontré {transcript_path}", file=sys.stderr)
        return 1

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    words = transcript.get("words", [])
    duration = float(transcript.get("duration", 0.0))
    if not words:
        print("[error] transcript vacío", file=sys.stderr)
        return 1

    raw_clips: list[dict[str, Any]] = []
    if args.use_heuristic:
        print(
            "[heuristic-mode] skipeando Ollama por --use-heuristic; "
            "generando clips uniformes de ~45s",
            file=sys.stderr,
        )
        # Salimos directo al fallback más abajo
    elif duration <= 900:
        # min_clips = la mitad del techo (mínimo 4) para que un video corto igual
        # devuelva varios candidatos, no 3.
        target_min = max(4, min(10, args.max_clips - 2))
        text = build_transcript_text(words, window_sec=15)
        result = call_ollama(text, model=args.model, min_clips=target_min, max_clips=args.max_clips, provider=provider)
        raw_clips = result.get("clips", []) if isinstance(result, dict) else []
    else:
        chunks = chunk_words(words, chunk_sec=args.chunk_sec)
        print(f"[chunking] {len(chunks)} chunks de ~{args.chunk_sec}s", file=sys.stderr)
        # Sobre-generamos a propósito (+2 por chunk): después del anclaje + dedup de
        # solapados se cae una parte, así que pedir de más asegura llegar al techo.
        per_chunk = max(3, (args.max_clips + len(chunks) - 1) // len(chunks) + 2)
        for i, chunk in enumerate(chunks):
            print(f"\n[chunk {i + 1}/{len(chunks)}]", file=sys.stderr)
            try:
                raw_clips.extend(analyze_chunk(chunk, model=args.model, target_clips=per_chunk, provider=provider))
            except Exception as e:
                print(f"[chunk {i + 1}] error: {e}", file=sys.stderr)

    valid_clips: list[dict[str, Any]] = []
    seen_ranges: list[tuple[float, float]] = []
    for c in raw_clips:
        v = validate_clip(c, duration)
        if not v:
            continue
        # F5 — anclar el clip al TEXTO real del transcript (los LLM inventan números)
        # y ajustar el final al fin de frase. Solo para clips del LLM.
        if not args.use_heuristic:
            v = anchor_clip_to_text(v, words, duration)
            if v["end"] - v["start"] < 25:
                continue
        overlap = False
        for s, e in seen_ranges:
            inter = max(0, min(v["end"], e) - max(v["start"], s))
            shorter = min(v["end"] - v["start"], e - s)
            if shorter > 0 and inter / shorter > 0.5:
                overlap = True
                break
        if overlap:
            continue
        valid_clips.append(v)
        seen_ranges.append((v["start"], v["end"]))

    valid_clips.sort(key=lambda c: c["start"])
    valid_clips = valid_clips[: args.max_clips]

    # Fallback heurístico: si después de todos los intentos no hay clips válidos,
    # generar clips uniformes de ~45s para que el pipeline igual produzca algo.
    used_fallback = False
    if not valid_clips:
        print(
            "[analyze_clips] OLLAMA NO DISPONIBLE o sin clips válidos; usando modo "
            "heurístico — los resultados serán de menor calidad",
            file=sys.stderr,
            flush=True,
        )
        print(
            "[fallback] LLM no produjo clips válidos — generando "
            "clips heurísticos (~45s uniformes) para que el pipeline continúe",
            file=sys.stderr,
        )
        heuristic = heuristic_fallback(words, duration, target_clips=args.max_clips)
        valid_clips = [validate_clip(c, duration) for c in heuristic]
        valid_clips = [c for c in valid_clips if c]
        used_fallback = True

    proposal = {
        "video_id": video_id,
        "provider": "heuristic" if used_fallback else provider,
        "model": args.model,
        "transcript_duration": duration,
        "fallback_heuristic": used_fallback,
        "clips": valid_clips,
    }

    out_path = LF_PROPOSALS / f"{video_id}.json"
    out_path.write_text(json.dumps(proposal, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "out": str(out_path), "clips": len(valid_clips), "fallback": used_fallback}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
