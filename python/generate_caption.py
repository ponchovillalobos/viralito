"""Genera un caption viral + hashtags para un video procesado.

Soporta 3 providers vía OAuth (SIN API keys, usa tu suscripción existente):

  1. claude — Claude Code CLI (suscripción Claude.ai)
     Requiere: `claude` instalado y logueado (`claude login`)
     Mejor calidad. Usa tu cuota de Claude.ai Pro/Max.
  2. codex — OpenAI Codex CLI (suscripción ChatGPT Plus)
     Requiere: `codex` instalado y logueado (`codex login`)
     Usa tu cuota de ChatGPT Plus (~5h/semana).
  3. ollama — qwen3:1.7b local (gratis, fallback)
     Sin suscripción, calidad básica.

Uso:
  python generate_caption.py <video_id>                     # auto-detect
  python generate_caption.py <video_id> --provider claude
  python generate_caption.py <video_id> --provider codex
  python generate_caption.py <video_id> --provider ollama
  python generate_caption.py <video_id> --long-form
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from lib import ollama_opts as _ollama_opts

from config import (
    DATA_ROOT,
    LF_PROJECTS,
    LF_TRANSCRIPTS,
    OLLAMA_MODEL,
    OLLAMA_URL,
    PROJECTS_DIR,
    TRANSCRIPTS_DIR,
)

# Path al dataset de hooks virales verificados (curado de fuentes reales).
_HOOKS_FILE = Path(__file__).parent / "viral_hooks.json"


def load_viral_hooks() -> list[dict[str, Any]]:
    """Carga los hooks virales verificados desde viral_hooks.json.

    Si el archivo no existe o está corrupto, devuelve lista vacía y el prompt usa
    solo sus patterns genéricos (degradación graciosa).
    """
    try:
        data = json.loads(_HOOKS_FILE.read_text(encoding="utf-8"))
        return data.get("hooks", [])
    except Exception as exc:  # noqa: BLE001
        print(f"[hooks] no se pudo cargar {_HOOKS_FILE}: {exc}", file=sys.stderr)
        return []


def pick_few_shot_hooks(video_id: str, count: int = 4) -> str:
    """Selecciona N hooks virales reales sembrados por video_id (determinístico)
    y los formatea como bloque para meter en el SYSTEM_PROMPT.
    """
    hooks = load_viral_hooks()
    if not hooks:
        return ""
    # Seed determinístico por video_id → mismo video siempre obtiene los mismos hooks
    # como referencia, pero distintos videos obtienen sets distintos.
    seed_int = int(hashlib.sha256(video_id.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed_int)
    sample = rng.sample(hooks, min(count, len(hooks)))
    lines = []
    for h in sample:
        lines.append(
            f'  • "{h["template"]}"  →  ej. real: "{h["example_real"]}"  '
            f'(mecanismo: {h["mechanism"]})'
        )
    return "\n".join(lines)


SYSTEM_PROMPT = """Escribes el texto que acompana a un video en redes. No eres un
asistente: eres quien redacta el post, y el post tiene que ganarse la atencion solo.

Audiencia hispanohablante profesional, sobre todo LATAM, en comunicacion, ventas e IA.

═══════════════════════════════════════════════════════
EL IDIOMA: UNO SOLO, NEUTRO
═══════════════════════════════════════════════════════
Espanol neutro de LATAM. Se entiende de Mexico a Argentina sin sonar de ningun
sitio en particular.

PROHIBIDO mezclar registros. Nada de:
  ✗ voseo rioplatense: "vos", "sos", "tenes", "cobra vos", "llevas años"
  ✗ jerga mexicana: "neta", "checa", "sale", "se la rifa", "no manches"
  ✗ espanolismos: "vale", "tio", "flipar", "curro", "guay", "os"

Se usa TU, y verbos neutros: "tienes", "puedes", "haces", "eres".
Un texto que mezcla dos registros suena falso en los dos paises.

NUNCA inventes un nombre de usuario, una marca ni una firma. No escribas arrobas
ni handles. Si no sabes como se llama alguien, no lo nombres.

═══════════════════════════════════════════════════════
LO QUE NO SE INVENTA — regla dura
═══════════════════════════════════════════════════════
Solo se usa lo que el video DICE. Ni una cifra, ni un porcentaje, ni un estudio,
ni un caso, ni un resultado que no este en el transcript.

Si el video no da un numero, el post va sin numero. Un texto sin dato es flojo;
un dato falso es otra cosa, y ademas se nota.

El transcript puede traer errores de oido: si una palabra claramente no encaja,
interpretala por el contexto — pero sin cambiar lo que se dijo ni agregar nada.

Habla del tema REAL del clip. Si menciona ChatGPT, di ChatGPT, no "una
herramienta de IA".

═══════════════════════════════════════════════════════
LINKEDIN — es la red con la estructura mas distinta
═══════════════════════════════════════════════════════
Lo que su algoritmo mide es el TIEMPO QUE LA GENTE PASA LEYENDO, no los likes.
Un post que retiene 60 segundos alcanza ~13 veces mas gente que uno que retiene
3. Por eso todo lo de abajo apunta a que se lea entero.

ESTRUCTURA (en este orden):
  1. GANCHO: una o dos lineas. Especifico e intrigante. Es lo unico que se ve
     antes del "ver mas", y ahi se decide si te leen.
  2. CONTEXTO: 3 a 8 lineas. La situacion concreta, con detalle real.
  3. LO QUE APRENDISTE: 3 a 6 lineas. El giro, lo contraintuitivo, lo util.
  4. PREGUNTA final abierta, que invite a contar una experiencia propia.

FORMATO:
  • 150 a 300 palabras. Menos no cruza el "ver mas"; mas cansa.
  • Salto de linea cada una o dos frases. El muro de texto mata la lectura.
  • Frases cortas. Si una pasa de 20 palabras, partela.
  • CERO hashtags, o dos como mucho. Ya no ayudan y en exceso parecen spam.
  • NUNCA pongas un enlace: un post con enlace pierde entre la mitad y dos
    tercios del alcance. Si hace falta, va en el primer comentario.
  • Nada de "Stop", "No hagas esto", ni imperativos de clickbait.

La pregunta del final importa mas de lo que parece: los comentarios que cuentan
una experiencia concreta pesan varias veces mas que un "buen post". Preguntas
que se contestan con si o no no sirven.

═══════════════════════════════════════════════════════
TIKTOK — el caption acompana, no repite
═══════════════════════════════════════════════════════
Las senales que mandan son terminar el video, guardarlo y compartirlo. Los likes
son la mas debil.

  • 140 a 200 caracteres.
  • El caption NO repite lo que se oye: ayuda a entenderlo mas rapido, o agrega
    el angulo que el video no dice en voz alta.
  • Palabras del tema EN el caption: se indexa y se busca. Si el video es de
    objeciones en ventas, que la palabra "objeciones" este escrita.
  • Nada de emojis al principio: se comen el gancho.
  • De 3 a 5 hashtags: dos amplios del nicho y uno o dos especificos.
  • Cierra con algo que de motivo a guardar ("para cuando te pase") o a
    compartir ("mandaselo a quien lo necesita"), no con un "sigueme".

═══════════════════════════════════════════════════════
INSTAGRAM — la primera linea es un titular
═══════════════════════════════════════════════════════
  • 300 a 600 caracteres.
  • Escribe la primera frase como el titular de una revista, no como un tuit.
    Es la que decide si siguen leyendo.
  • Lo que mas alcance da hoy es que alguien lo mande por mensaje directo. Que
    el texto de una razon para hacerlo.
  • Tono de persona contandole algo bueno a alguien conocido. Cercano, no
    publicitario.
  • De 3 a 5 hashtags.

═══════════════════════════════════════════════════════
COMO NO SONAR A MAQUINA
═══════════════════════════════════════════════════════
Nada de esto:
  ✗ raya larga (—) para separar ideas: usa coma, punto o parentesis
  ✗ "Sin embargo", "Asimismo", "En conclusion", "Por otro lado"
  ✗ "Es importante notar", "Vale la pena mencionar", "Cabe destacar"
  ✗ "¿Sabias que...?" como apertura
  ✗ "En el mundo actual", "En la era digital", "Hoy mas que nunca"
  ✗ "Descubre", "Te revelo", "3 secretos que nadie te cuenta"
  ✗ cerrar con "En resumen" o "Para finalizar"

Si:
  ✓ frases habladas, como se lo contarias a alguien enfrente
  ✓ una o dos palabras en mayusculas para enfatizar, no mas
  ✓ detalles concretos del video, que es lo que lo hace creible

═══════════════════════════════════════════════════════
LAS TRES SON DISTINTAS
═══════════════════════════════════════════════════════
No repitas el mismo texto en las tres. LinkedIn se lee sentado y quiere una
historia con aprendizaje; TikTok se lee de paso y quiere el angulo en una linea;
Instagram esta en medio y quiere que valga la pena mandarselo a alguien.

═══════════════════════════════════════════════════════
SALIDA — JSON estricto, sin markdown:
═══════════════════════════════════════════════════════

{
  "captions": {
    "tiktok":    { "caption": "<140-200 caracteres>", "hashtags": ["#tag", "..."] },
    "linkedin":  { "caption": "<150-300 palabras, con saltos de linea>", "hashtags": [] },
    "instagram": { "caption": "<300-600 caracteres>", "hashtags": ["#tag", "..."] }
  }
}

DEVUELVE SOLO EL JSON. Sin explicaciones, sin markdown, sin texto extra.
"""


def transcript_to_text(words: list[dict[str, Any]]) -> str:
    """Convierte el array de palabras del transcript en texto plano legible."""
    return " ".join(w["word"] for w in words)


def build_prompt(transcript_text: str, video_id: str) -> str:
    """Construye el prompt final del SYSTEM_PROMPT + few-shot de hooks reales por video."""
    few_shot = pick_few_shot_hooks(video_id, count=4)
    real_examples_block = ""
    if few_shot:
        real_examples_block = (
            "\n\n═══════════════════════════════════════════════════════\n"
            "HOOKS VIRALES REALES — verificados de TikTok español (referencia):\n"
            "═══════════════════════════════════════════════════════\n"
            "Estos son patrones que YA SE HICIERON VIRALES en cuentas reales.\n"
            "Tomá la ESTRUCTURA emocional, no copies palabras textuales.\n"
            "Adaptá el patrón al transcript específico de este video:\n\n"
            f"{few_shot}\n"
        )
    return (
        f"{SYSTEM_PROMPT}{real_examples_block}\n\n"
        f"TRANSCRIPT DEL VIDEO:\n{transcript_text}\n\n"
        "Responde con SOLO el JSON, sin markdown, sin texto adicional."
    )


def call_ollama(transcript_text: str, video_id: str, model: str = OLLAMA_MODEL) -> dict[str, Any]:
    payload = {
        "model": model,
        "prompt": build_prompt(transcript_text, video_id),
        "stream": False,
        "format": "json",
        # Modelos "thinking" (qwen3): sin esto el output se va a `thinking` y
        # `response` llega VACÍO → JSON parse error. Ollama viejo ignora el campo.
        "think": False,
        # PARIDAD con analyze_clips.py (auditoría 2026-07-20): a este caller le
        # faltaban `keep_alive` y `num_thread`.
        #  - keep_alive: mantiene el modelo en RAM/VRAM entre llamadas. El default de
        #    Ollama son 5 min; en un lote de largos los captions salen separados por
        #    minutos y el modelo se descargaba y recargaba entre medio (segundos por
        #    clip, en una GPU de 6 GB donde la carga duele).
        #  - num_thread: núcleos FÍSICOS; sin esto Ollama usa su heurística y en CPU
        #    rinde peor.
        # NO se agrega `num_predict`: un tope de tokens mal calibrado TRUNCARÍA el
        # JSON del caption y rompería la generación. No vale el riesgo sin medir
        # antes la longitud real de las respuestas.
        "keep_alive": _ollama_opts.KEEP_ALIVE,
        "options": {
            "temperature": 0.7,
            "num_ctx": 8192,
            "num_thread": _ollama_opts.num_thread(),
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    print(f"[ollama] generando con {model}...", file=sys.stderr)
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    response_text = body.get("response", "").strip()
    response_text = re.sub(r"^```(?:json)?\s*", "", response_text)
    response_text = re.sub(r"\s*```$", "", response_text)
    return json.loads(response_text)


def extract_json_from_text(text: str) -> dict[str, Any]:
    """Extrae el primer bloque JSON válido del texto (manejo de markdown fences y prosa)."""
    s = text.strip()
    # Remover markdown fences si existen
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    # Buscar el primer { y el último } para extraer el JSON aunque haya prosa
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        s = s[start : end + 1]
    return json.loads(s)


def _run_cli_utf8(args: list[str], input_text: str | None, timeout: int = 240) -> tuple[int, str, str]:
    """Ejecuta un CLI forzando IO en UTF-8 (Windows usa cp1252 por defecto, mojibake garantizado).

    Devuelve (returncode, stdout, stderr) — ambos strings ya decodificados desde UTF-8.
    """
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env.setdefault("LANG", "en_US.UTF-8")
    proc = subprocess.run(
        args,
        input=input_text.encode("utf-8") if input_text is not None else None,
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    stdout = proc.stdout.decode("utf-8", errors="replace") if proc.stdout else ""
    stderr = proc.stderr.decode("utf-8", errors="replace") if proc.stderr else ""
    return proc.returncode, stdout, stderr


def call_claude_cli(transcript_text: str, video_id: str, model: str | None = None) -> dict[str, Any]:
    """Llama a Claude Code CLI vía OAuth (suscripción Claude.ai).

    Requiere `claude` en PATH y haberse logueado con `claude login` previamente.
    """
    claude_bin = shutil.which("claude")
    if not claude_bin:
        raise RuntimeError(
            "claude CLI no encontrado. Instalalo con `npm install -g @anthropic-ai/claude-code` "
            "y logueate con `claude login`."
        )
    prompt = build_prompt(transcript_text, video_id)
    # Pasamos el prompt como argv (UTF-16 vía CreateProcessW) en vez de stdin para evitar
    # el mojibake de cp1252 que Windows mete cuando un Node CLI lee stdin.
    args = [claude_bin, "--print", "--output-format", "text"]
    if model:
        args.extend(["--model", model])
    args.append(prompt)
    print("[claude-cli] generando (oauth)...", file=sys.stderr)
    rc, stdout, stderr = _run_cli_utf8(args, None)
    if rc != 0:
        raise RuntimeError(f"claude CLI falló (rc={rc}): {stderr[-500:]}")
    return extract_json_from_text(stdout)


def call_codex_cli(transcript_text: str, video_id: str, model: str | None = None) -> dict[str, Any]:
    """Llama a Codex CLI vía OAuth (suscripción ChatGPT Plus).

    Requiere `codex` en PATH y haberse logueado con `codex login` previamente.
    """
    codex_bin = shutil.which("codex")
    if not codex_bin:
        raise RuntimeError(
            "codex CLI no encontrado. Instalalo con `npm install -g @openai/codex` "
            "y logueate con `codex login` (usa tu cuenta de ChatGPT Plus)."
        )
    prompt = build_prompt(transcript_text, video_id)
    args = [codex_bin, "exec", "--skip-git-repo-check", prompt]
    if model:
        args.extend(["--model", model])
    print("[codex-cli] generando (oauth)...", file=sys.stderr)
    rc, stdout, stderr = _run_cli_utf8(args, None)
    if rc != 0:
        raise RuntimeError(f"codex CLI falló (rc={rc}): {stderr[-500:]}")
    return extract_json_from_text(stdout)


_ONLINE_CACHE: bool | None = None


def _online() -> bool:
    """¿Hay internet + DNS? Resuelve el host del provider OAuth (solo DNS, no conecta).
    Si no resuelve (offline / ERR_NAME_NOT_RESOLVED), claude/codex fallarían → se usa Ollama
    local directo. Cacheado por proceso. Cero regresión online (si resuelve, prefiere claude).
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


def auto_provider() -> str:
    """Detecta el mejor provider OAuth disponible. Prefiere claude > codex > ollama.
    OFFLINE (sin DNS): va directo a Ollama local para no colgarse en claude/codex."""
    if not _online():
        return "ollama"
    if shutil.which("claude"):
        return "claude"
    if shutil.which("codex"):
        return "codex"
    return "ollama"


def default_model(provider: str) -> str | None:
    """Modelo por defecto por provider.

    Para copy viral usamos los modelos más capaces de cada CLI:
      - claude → Opus (mejor escritura / razonamiento del catálogo Claude)
      - codex  → default del CLI (gpt-5 / lo que tenga configurado)
      - ollama → modelo local definido en config.py
    """
    if provider == "ollama":
        return OLLAMA_MODEL
    if provider == "claude":
        return "opus"  # alias del CLI; resuelve al Opus más reciente disponible
    return None  # codex usa su default (típicamente gpt-5/codex)


def call_llm(transcript_text: str, video_id: str, provider: str, model: str | None) -> dict[str, Any]:
    t0 = time.time()
    if provider == "claude":
        result = call_claude_cli(transcript_text, video_id, model=model)
    elif provider == "codex":
        result = call_codex_cli(transcript_text, video_id, model=model)
    else:
        result = call_ollama(transcript_text, video_id, model=model or OLLAMA_MODEL)
    print(f"[{provider}] respuesta en {time.time() - t0:.1f}s", file=sys.stderr)
    return result


def normalize_hashtags(tags) -> list[str]:
    if not isinstance(tags, list):
        return []
    out = []
    for t in tags:
        s = str(t).strip()
        if not s:
            continue
        if not s.startswith("#"):
            s = f"#{s}"
        # Quitar espacios internos y acentos comunes
        s = re.sub(r"\s+", "", s)
        replacements = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n"}
        for k, v in replacements.items():
            s = s.replace(k, v).replace(k.upper(), v.upper())
        out.append(s)
    return out[:20]


def _platform_block(raw: dict[str, Any], key: str, max_caption: int) -> dict[str, Any]:
    """Saca {caption, hashtags} de una plataforma del JSON nuevo, con saneo."""
    block = raw.get(key) if isinstance(raw.get(key), dict) else {}
    return {
        "caption": str(block.get("caption", "")).strip()[:max_caption],
        "hashtags": normalize_hashtags(block.get("hashtags")),
    }


def validate_copy(raw: dict[str, Any]) -> dict[str, Any]:
    """Procesa la respuesta del LLM con tolerancia a 2 formatos:

      • NUEVO (preferido): { "captions": { "tiktok":{caption,hashtags}, "linkedin":{...}, "instagram":{...} } }
      • LEGACY:            { "caption_short":..., "caption_long":..., "hashtags_tiktok":[...], ... }

    Devuelve un dict normalizado con:
      • captions.tiktok / linkedin / instagram   (siempre presentes)
      • campos legacy caption_short, caption_long, hashtags_*  (por retro-compat)
    """
    captions_raw = raw.get("captions") if isinstance(raw.get("captions"), dict) else None
    if captions_raw:
        tiktok = _platform_block(captions_raw, "tiktok", 300)
        linkedin = _platform_block(captions_raw, "linkedin", 3000)
        instagram = _platform_block(captions_raw, "instagram", 1500)
    else:
        # Fallback legacy: derivá los 3 captions del shape viejo
        short = str(raw.get("caption_short", "")).strip()[:300]
        long_ = str(raw.get("caption_long", "")).strip()[:3000]
        tiktok = {
            "caption": short,
            "hashtags": normalize_hashtags(raw.get("hashtags_tiktok")),
        }
        linkedin = {
            "caption": long_ or short,
            "hashtags": normalize_hashtags(raw.get("hashtags_linkedin")),
        }
        instagram = {
            "caption": short,
            "hashtags": normalize_hashtags(raw.get("hashtags_instagram")),
        }

    # Campos legacy expuestos para compat con dashboards viejos.
    return {
        "captions": {
            "tiktok": tiktok,
            "linkedin": linkedin,
            "instagram": instagram,
        },
        "caption_short": tiktok["caption"],
        "caption_long": linkedin["caption"],
        "hashtags_tiktok": tiktok["hashtags"],
        "hashtags_instagram": instagram["hashtags"],
        "hashtags_linkedin": linkedin["hashtags"],
        "hashtags_facebook": tiktok["hashtags"],  # FB usa el mismo que TikTok
    }


def load_user_handles() -> dict[str, str]:
    """Lee los @handles configurados en la UI (user-settings.json, junto al data root).

    Mismo archivo que escribe frontend/src/lib/user-settings.ts:
    <DATA_ROOT>/../user-settings.json. Si no existe o está corrupto devuelve {} y los
    captions salen sin firma (degradación graciosa, igual que el watermark).
    """
    try:
        settings_file = DATA_ROOT.parent / "user-settings.json"
        # utf-8-sig: tolera BOM (editores Windows); sin BOM se comporta igual que utf-8.
        data = json.loads(settings_file.read_text(encoding="utf-8-sig"))
        handles = data.get("handles", {}) if isinstance(data, dict) else {}
        out: dict[str, str] = {}
        for key in ("instagram", "linkedin"):
            h = str(handles.get(key, "") or "").strip()
            if h and not h.startswith("@"):
                h = f"@{h}"
            if h:
                out[key] = h
        return out
    except Exception:
        return {}


def append_handle_signature(copy: dict[str, Any], handles: dict[str, str]) -> None:
    """Firma con el @handle real al final del caption de IG/LinkedIn.

    Los hashtags viven en su propio campo, así que la firma queda como última línea
    del cuerpo. No duplica si el LLM ya mencionó el handle. Muta `copy` in-place.
    """
    signatures = {
        "instagram": "Seguime en {h} para más como esto.",
        "linkedin": "Más contenido así en {h}.",
    }
    for platform, h in handles.items():
        block = copy["captions"].get(platform)
        if not isinstance(block, dict) or not block.get("caption"):
            continue
        if h.lower() in block["caption"].lower():
            continue  # el LLM ya lo incluyó — no repetir
        block["caption"] = block["caption"].rstrip() + "\n\n" + signatures[platform].format(h=h)
    # caption_long es el espejo legacy del caption de LinkedIn — mantenerlo en sync.
    copy["caption_long"] = copy["captions"]["linkedin"]["caption"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_id", help="ID del video (sin extensión)")
    parser.add_argument("--long-form", action="store_true")
    parser.add_argument("--provider", choices=["auto", "claude", "codex", "ollama"], default="auto")
    parser.add_argument("--model", help="Modelo específico (override del default del provider)")
    parser.add_argument("--project-id", help="ID del proyecto a actualizar")
    args = parser.parse_args()

    provider = auto_provider() if args.provider == "auto" else args.provider
    model = args.model or default_model(provider)
    print(f"[setup] provider={provider} model={model}", file=sys.stderr)

    transcripts_dir = LF_TRANSCRIPTS if args.long_form else TRANSCRIPTS_DIR
    projects_dir = LF_PROJECTS if args.long_form else PROJECTS_DIR

    transcript_path = transcripts_dir / f"{args.video_id}.json"
    if not transcript_path.exists():
        print(f"[error] no encontré {transcript_path}", file=sys.stderr)
        return 1

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    text = transcript_to_text(transcript.get("words", []))
    if not text.strip():
        print("[error] transcript vacío", file=sys.stderr)
        return 1

    try:
        raw = call_llm(text, args.video_id, provider=provider, model=model)
    except Exception as e:
        print(f"[error] {provider} falló: {e}", file=sys.stderr)
        if provider != "ollama":
            print("[fallback] reintentando con ollama...", file=sys.stderr)
            raw = call_ollama(text, args.video_id, model=OLLAMA_MODEL)
            provider = "ollama"
            model = OLLAMA_MODEL
        else:
            return 1

    copy = validate_copy(raw)
    # Firma por red: si hay @handle de IG/LinkedIn en user-settings, sumarlo al caption.
    user_handles = load_user_handles()
    if user_handles:
        append_handle_signature(copy, user_handles)
    copy["_provider"] = provider
    copy["_model"] = model

    # Elegí qué proyectos actualizar: si se pasó --project-id, ese exacto.
    # Si no, glob por videoId (matchea todos los <videoId>_<style>.json).
    if args.project_id:
        targets = [projects_dir / f"{args.project_id}.json"]
        targets = [t for t in targets if t.exists()]
        if not targets:
            print(f"[warn] no existe {projects_dir / (args.project_id + '.json')}", file=sys.stderr)
    else:
        targets = list(projects_dir.glob(f"{args.video_id}*.json"))
        if not targets:
            print(f"[warn] no encontré proyectos para {args.video_id} en {projects_dir}", file=sys.stderr)

    for target in targets:
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
            captions = copy["captions"]
            # data.captions: bloque nuevo con las 3 variantes por plataforma.
            data["captions"] = captions
            # data.caption: legacy field — apunta al texto TikTok con sus hashtags
            # (la UI vieja que no entiende captions[] sigue viendo algo razonable).
            tiktok_hash = " ".join(captions["tiktok"]["hashtags"])
            data["caption"] = (
                captions["tiktok"]["caption"]
                + ("\n\n" + tiktok_hash if tiktok_hash else "")
            )
            data["captionMeta"] = copy
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[ok] actualizado {target.name}", file=sys.stderr)
        except Exception as e:
            print(f"[fail] {target.name}: {e}", file=sys.stderr)

    print(json.dumps({"ok": True, "copy": copy}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
