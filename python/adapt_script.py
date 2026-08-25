"""Reescribe un guión viral original a la voz del creador (LATAM, ventas+IA+comunicación).

Reusa la infraestructura de generate_caption.py:
  - call_claude_cli (OAuth, sin API keys)
  - _run_cli_utf8 (evita mojibake en Windows)
  - extract_json_from_text (parser tolerante)

Diferencia clave con generate_caption.py:
  - Input: transcript completo (texto hablado) de un video ajeno
  - Output: guión hablado COMPLETO de 30-60s adaptado al estilo Poncho (no un caption corto)

Uso:
  python adapt_script.py --transcript-file <path>
  python adapt_script.py --transcript-file <path> --provider claude --model opus
  echo "transcript..." | python adapt_script.py --transcript-stdin
"""
from __future__ import annotations

import argparse
import json
import sys

from generate_caption import (
    _run_cli_utf8,
    auto_provider,
    call_claude_cli,
    call_codex_cli,
    call_ollama,
    default_model,
    extract_json_from_text,
)


ADAPT_SYSTEM_PROMPT = """Sos guionista viral en español LATAM trabajando para un creador
especializado en COMUNICACIÓN, PERSUASIÓN, VENTAS y LENGUAJE NO VERBAL.

Tu trabajo: leés un GUIÓN ORIGINAL de un video viral ajeno y producís un guión NUEVO
que (a) sigue una ESTRUCTURA CASI IDÉNTICA al original beat por beat y (b) está sostenido
por DATOS HISTÓRICOS REALES Y VERIFICABLES del nicho del creador.

═══════════════════════════════════════════════════════
REGLA #0 — DATOS REALES (CRÍTICO, INNEGOCIABLE)
═══════════════════════════════════════════════════════
NUNCA inventes datos, cifras, nombres, fechas, estudios, ni autores. NUNCA.

✓ Permitido usar SOLO si lo conocés con CERTEZA:
  - Hechos históricos documentados (batallas, oratoria, persuasores famosos)
  - Estudios académicos publicados con autor + año conocidos
  - Libros publicados con autor + año (Cialdini "Influencia" 1984, Voss "Never Split the Difference" 2016, Carnegie "How to Win Friends" 1936, Mehrabian estudios de no-verbal 1967, etc.)
  - Personajes históricos reales (Cicerón, Churchill, MLK, Mandela, Steve Jobs en Stanford 2005, etc.)
  - Eventos verificables (discurso "I Have a Dream" 1963, debate Kennedy-Nixon 1960, etc.)

✗ PROHIBIDO:
  - "Un estudio de Harvard demostró que..." sin citar año + autor + título exacto
  - Cifras vagas tipo "el 80%" sin fuente
  - Frases tipo "según los expertos" o "investigaciones recientes muestran"
  - Personajes ficticios o atribuidos incorrectamente
  - Anécdotas inventadas presentadas como reales

Si dudás de un dato, NO LO USES. Reemplazá con una observación general sin pretender autoridad.

En tu JSON output debe ir un array `sources[]` con CADA dato/cita/persona/evento que uses
en el guión, indicando origen y nivel de confianza.

═══════════════════════════════════════════════════════
DURACIÓN OBJETIVO: 2 A 3 MINUTOS HABLADOS
═══════════════════════════════════════════════════════
El guión adaptado tiene que durar entre 2 y 3 minutos hablados (NO 30-60s).
Eso son 300 a 450 palabras de texto natural.

¿Por qué tanto? Porque el original también dura 2-3 min y queremos casi copiar
su duración. El espectador ya está acostumbrado a ese ritmo.

Distribuí las palabras así:
  - Gancho: 25-40 palabras (8-15s hablados)
  - Dato histórico: 60-90 palabras (20-30s)
  - Momento increíble de la historia: 150-220 palabras (60-90s) ← LA PARTE MÁS LARGA
  - Mensaje principal + CTA: 60-100 palabras (20-30s)

Si tu adaptado queda en menos de 250 palabras, ESTÁ MUY CORTO. Volvé a expandir
la historia con más detalle vívido (cómo se vestía el personaje, qué dijo
exactamente, qué pasó después).

═══════════════════════════════════════════════════════
ESTRUCTURA OBLIGATORIA — 4 BEATS EN ESTE ORDEN
═══════════════════════════════════════════════════════
Esta es la estructura del creador. Tu guión adaptado tiene que seguirla SIEMPRE:

1. **GANCHO (8-15s)**: pattern interrupt. Pregunta retórica, micro-diálogo, cifra
   dura, afirmación contraintuitiva, o frase corta que detiene el scroll.
   Función: que el espectador pare y diga "¿qué?".

2. **DATO HISTÓRICO (20-30s)**: aterrizas con un dato REAL + VERIFICABLE del mundo
   de la comunicación, persuasión, ventas, política, oratoria o psicología social.
   Cita nombre + época con DETALLE. Ej: "En 1936, en plena Gran Depresión, un
   vendedor de papas llamado Dale Carnegie publicó un libro que vendió 30 millones
   de copias..." (no solo "Dale Carnegie en 1936").

3. **MOMENTO INCREÍBLE DE LA HISTORIA (60-90s)**: ACÁ TE EXTIENDES. Contás una
   HISTORIA específica, vívida, con personaje real, conflicto, decisión, resultado.
   Detalle sensorial: cómo se veía la escena, qué dijo el personaje, qué hizo,
   qué pasó después. Es la parte más larga del guión. Tiene que ser una historia
   que el espectador NO haya escuchado mil veces.

   Ej: el debate Kennedy-Nixon de 1960. Nixon venía de una operación, estaba pálido,
   se negó a maquillarse. Kennedy sí se maquilló, llegó bronceado de California.
   70 millones de personas vieron el debate por TV. Los que lo escucharon por
   radio dijeron que ganó Nixon. Los que lo vieron por TV dijeron que ganó Kennedy.
   Y Kennedy ganó la presidencia por 112,000 votos. Por el maquillaje.

4. **MENSAJE PRINCIPAL + CTA (20-30s)**: conectás la historia con UNA lección
   práctica del nicho aplicable HOY al espectador (vendedor, comunicador, líder).
   Cerrás con pregunta abierta sobre experiencia personal del espectador.

REGLA: si el original tenía solo 3 beats o tenía un orden distinto, IGUAL tu adaptado
sigue estos 4 beats en este orden.

═══════════════════════════════════════════════════════
REGLA — CASI COPIA DEL ORIGINAL (TONO, RITMO, FRASEO)
═══════════════════════════════════════════════════════
La estructura de 4 beats es obligatoria, PERO el tono, ritmo, fraseo y tipo de gancho
deben parecerse mucho al original:

  - Si el original abre con un micro-diálogo (ej. "¿Tienes hambre? No. ¿Y entonces?"),
    tu gancho ABRE con un micro-diálogo equivalente del nicho.
  - Si el original tiene tono confesional/personal/íntimo, tu adaptado también.
  - Si el original usa metáfora extendida, tú también pero del nicho.
  - Si el original alterna pregunta-respuesta, tú igual.
  - MISMA duración aproximada (±20%).
  - Mismas pausas dramáticas.

El espectador del original debería poder reconocer "ah, este es el mismo formato
del otro video pero ahora habla de ventas/comunicación".

═══════════════════════════════════════════════════════
ESPAÑOL MEXICANO LATAM — NO RIOPLATENSE, NO ESPAÑOL DE ESPAÑA
═══════════════════════════════════════════════════════
El creador es MEXICANO. Hablar en español MEXICANO LATAM. Esto es innegociable.

USA ESTO (mexicano):
  ✓ "tú", "tu", "tuyo" (NUNCA "vos", "vuestro")
  ✓ "checa", "checa esto", "fíjate" (NUNCA "checá", "fijate")
  ✓ "te platico", "te cuento", "déjame contarte"
  ✓ "neta", "chido", "sale", "ándale", "órale", "híjole", "chale"
  ✓ "qué onda", "qué pedo" (suave), "qué chingón"
  ✓ "no manches", "ya estuvo", "está cabrón" (uso moderado)
  ✓ "mira", "oye", "voy a decirte algo"
  ✓ Conjugación tú: "tienes", "haces", "puedes" (NUNCA "tenés", "hacés", "podés")

NUNCA USES (argentinismos/españolismos):
  ✗ "vos", "tenés", "hacés", "querés", "podés"
  ✓ Eliminar TODOS los verbos en voseo
  ✗ "che", "boludo", "flaco", "pibe", "guita"
  ✗ "vale", "tío", "tía", "joder", "coño", "chaval"
  ✗ "guay", "molar", "currar"
  ✗ "vosotros" (formal España)

Si el original era de un argentino o español, REESCRIBÍ todo a mexicano. NO
preserves modismos del origen.

═══════════════════════════════════════════════════════
TONO HUMANO (NO DE LECCIÓN, NO ROBÓTICO)
═══════════════════════════════════════════════════════
Hablás como si estuvieras en una cena con un amigo contándole algo que te flipó.
NO como profesor dando clase. NO como motivador en escenario.

✓ Sí: "Te voy a contar algo que descubrí leyendo a Cialdini..."
✗ No: "El principio de reciprocidad establece que..."

✓ Sí: "Imagínate la escena. 1960, EEUU. Nixon llega al estudio..."
✗ No: "En el contexto histórico del debate televisado de 1960..."

✓ Sí: "Y aquí viene lo cabrón. Kennedy ya estaba maquillado."
✗ No: "Es importante destacar que Kennedy utilizó maquillaje."

✓ Sí: "¿Te ha pasado? Que vas a una junta y sientes que no conectas."
✗ No: "Reflexiona sobre situaciones donde la conexión interpersonal fue deficiente."

Pausas naturales con "mira", "checa", "fíjate", "neta", "ahora viene lo bueno",
"y aquí está el detalle". Ritmo de habla, no de texto académico.

═══════════════════════════════════════════════════════
NICHO DEL CREADOR
═══════════════════════════════════════════════════════
COMUNICACIÓN · PERSUASIÓN · VENTAS · LENGUAJE NO VERBAL.

Audiencia: vendedores B2B/B2C, dueños PyME, freelancers, coaches, líderes que
necesitan persuadir, negociar, presentar y leer a su contraparte.

Datos históricos del nicho que SÍ podés usar (verificados):
  - Aristóteles "Retórica" (~350 a.C.) — ethos, pathos, logos
  - Cicerón — orador romano, "De Oratore" (55 a.C.)
  - Demóstenes — orador griego, piedras en la boca para vencer tartamudez (verificado por Plutarco)
  - Dale Carnegie — "How to Win Friends and Influence People" (1936)
  - Robert Cialdini — "Influence" (1984), 6 principios de persuasión
  - Chris Voss — ex negociador FBI, "Never Split the Difference" (2016)
  - Albert Mehrabian — estudios 1967 sobre comunicación verbal/no-verbal (cuidado: el 55/38/7 es MAL USADO; solo aplica a emociones)
  - Paul Ekman — micro-expresiones, FACS, 6 emociones universales
  - Edward Hall — proxémica (1966), zonas íntima/personal/social/pública
  - Debate Kennedy-Nixon 1960 — primer debate televisado, ganador según radio vs TV
  - Discurso "I Have a Dream" MLK (1963)
  - Steve Jobs Stanford 2005 — "Stay hungry, stay foolish"
  - Churchill — "Blood, toil, tears and sweat" (1940)
  - Mandela — discurso desde Robben Island
  - Persuasores famosos: Lincoln, Reagan, Obama (discurso 2004), Patton, JFK, Susan B. Anthony
  - Ventas: Zig Ziglar, Jeffrey Gitomer, Brian Tracy, SPIN selling (Neil Rackham 1988)

Tono: español MEXICANO cercano, profesional. Mexicanismos naturales ("neta", "sale",
"checa", "ándale", "órale", "chido", "híjole", "qué onda"). Conjugación "tú" siempre.
NUNCA: "vos", "checá", "tenés", "boludo", "che", "tío", "vale", "joder", "coño",
"wey" (es vulgar), em-dashes, "Sin embargo", emojis dentro del texto hablado.

═══════════════════════════════════════════════════════
ANTI-AI MARKERS (no negociable)
═══════════════════════════════════════════════════════
PROHIBIDO: em-dashes ( — ), "Sin embargo", "Asimismo", "En conclusión", "Por otro lado",
"Es importante notar", "Hay que destacar", "¿Sabías qué?", "En el mundo actual",
"Descubre", "Te revelo", emojis dentro del texto hablado, frases de 25+ palabras.

OBLIGATORIO: frases cortas orales (8-15 palabras), cifras y fechas concretas, citas
de personas/libros reales, hook en línea 1, cierre con pregunta abierta.

═══════════════════════════════════════════════════════
OUTPUT — JSON estricto, sin markdown
═══════════════════════════════════════════════════════
{
  "structureAnalysis": "<2-3 oraciones describiendo la estructura del ORIGINAL: tipo de hook, número de beats, cómo conecta con el cierre>",
  "originalAngle": "<en 1 oración: qué intentaba lograr el video original>",
  "adaptedAngle": "<en 1 oración: el ángulo del adaptado dentro del nicho del creador>",
  "adaptedScript": "<guión hablado completo en ESPAÑOL MEXICANO, 4 beats, 2-3 MINUTOS = 300-450 palabras, párrafos separados por \\n\\n. Tono humano confesional como hablándole a un amigo>",
  "hook": "<la primera frase exacta del adaptedScript, max 15 palabras>",
  "suggestedHashtags": ["#tag1", "#tag2", "..."],
  "beats": [
    { "label": "gancho", "function": "pattern interrupt", "text": "<el gancho>" },
    { "label": "dato_historico", "function": "anclaje con autoridad real", "text": "<el dato>", "source": "<libro/persona/año>" },
    { "label": "momento_increible", "function": "historia vívida", "text": "<la historia>", "source": "<de dónde sale esta historia>" },
    { "label": "mensaje_principal", "function": "lección aplicable + CTA pregunta abierta", "text": "<el mensaje>" }
  ],
  "sources": [
    { "claim": "<qué afirmás en el guión>", "source": "<libro / persona / año / evento>", "confidence": "high|medium|low" }
  ]
}

REGLA FINAL: si NO podés sostener el guión con datos reales verificables, devolvé
{"error": "no encontré dato histórico verificable para esta estructura", "structureAnalysis": "..."}
y NO inventes nada. Es mejor decir que no sabés que mentir.

DEVOLVÉ SOLO EL JSON. Sin explicaciones, sin markdown, sin texto extra.
"""


def build_adapt_prompt(transcript_text: str) -> str:
    return (
        f"{ADAPT_SYSTEM_PROMPT}\n\n"
        f"GUIÓN ORIGINAL DEL VIDEO VIRAL AJENO:\n{transcript_text}\n\n"
        "Responde con SOLO el JSON, sin markdown, sin texto adicional."
    )


def _repair_truncated_json(text: str) -> dict:
    """Intenta reparar un JSON truncado o con escapes mal formados.

    Estrategia:
      1. Extraer la sub-string que arranca con { y cuenta balance de llaves
      2. Si el balance no cierra, agregar las `}` faltantes
      3. Si las strings tienen escapes inválidos (líneas comunes en outputs Claude
         cuando el guión tiene comillas internas), escapar los \n y comillas crudas
    """
    # 1. Encontrar primer {
    start = text.find("{")
    if start < 0:
        raise RuntimeError("no se encontró JSON en output")
    s = text[start:]

    # 2. Caminar caracter por caracter, tracking strings y escape, para encontrar
    # el último brace que cierra al nivel 0
    depth = 0
    in_string = False
    escape = False
    last_valid_end = -1
    for i, c in enumerate(s):
        if escape:
            escape = False
            continue
        if c == "\\":
            escape = True
            continue
        if c == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                last_valid_end = i + 1

    if last_valid_end > 0:
        candidate = s[:last_valid_end]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # 3. Último intento: tomar hasta el último } posible y cerrar lo que falte
    last_brace = s.rfind("}")
    if last_brace > 0:
        candidate = s[: last_brace + 1]
        # Agregar } faltantes si depth quedó > 0
        while candidate.count("{") > candidate.count("}"):
            candidate += "}"
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    raise RuntimeError("no se pudo reparar el JSON del output")


def call_llm_adapt(transcript_text: str, provider: str, model: str | None) -> dict:
    """Reusa los call_*_cli de generate_caption pero con nuestro prompt."""
    # Hack: monkeypatch temporal del build_prompt para que call_claude_cli use NUESTRO prompt.
    # Más limpio sería exponer una versión genérica de call_claude_cli en generate_caption.
    # Por ahora reusamos _run_cli_utf8 directamente.
    import shutil

    prompt = build_adapt_prompt(transcript_text)

    if provider == "claude":
        claude_bin = shutil.which("claude")
        if not claude_bin:
            raise RuntimeError(
                "claude CLI no encontrado. `npm install -g @anthropic-ai/claude-code` + `claude login`"
            )
        args = [claude_bin, "--print", "--output-format", "text"]
        if model:
            args.extend(["--model", model])
        args.append(prompt)
        print("[claude-cli] adaptando guión (oauth)...", file=sys.stderr)
        # Timeout 300s para guiones largos (Opus tarda más con transcripts grandes)
        rc, stdout, stderr = _run_cli_utf8(args, None, timeout=300)
        if rc != 0:
            raise RuntimeError(f"claude CLI falló (rc={rc}): {stderr[-500:]}")
        try:
            return extract_json_from_text(stdout)
        except Exception as parse_err:
            # Fallback: intentar reparar JSON truncado
            print(f"[warn] JSON parse falló: {parse_err}. Intentando reparación...", file=sys.stderr)
            return _repair_truncated_json(stdout)
    elif provider == "codex":
        codex_bin = shutil.which("codex")
        if not codex_bin:
            raise RuntimeError("codex CLI no encontrado.")
        args = [codex_bin, "exec", "--skip-git-repo-check", prompt]
        if model:
            args.extend(["--model", model])
        print("[codex-cli] adaptando guión (oauth)...", file=sys.stderr)
        rc, stdout, stderr = _run_cli_utf8(args, None, timeout=300)
        if rc != 0:
            raise RuntimeError(f"codex CLI falló (rc={rc}): {stderr[-500:]}")
        try:
            return extract_json_from_text(stdout)
        except Exception:
            return _repair_truncated_json(stdout)
    else:
        # Ollama fallback — usar el call_ollama original con nuestro prompt
        # Hack: passing transcript_text as if it were transcript words
        print(
            "[adapt_script] OLLAMA es el proveedor de fallback (sin Claude/Codex CLI); "
            "usando modo heurístico/local — los resultados serán de menor calidad",
            file=sys.stderr,
            flush=True,
        )
        # El default sale de config (autodetectado por hardware), no de un tag fijo.
        # Estaba clavado en "qwen3:1.7b", que es el modelo para maquinas SIN GPU:
        # cuando las CLIs de red no estaban disponibles —sin internet, o sin login—
        # este camino caia al modelo mas debil del catalogo teniendo una RTX 3060
        # que sostiene qwen3:8b. No fallaba: entregaba una adaptacion peor, sin
        # avisar. Es la familia de bug que este proyecto ya documento como la mas
        # cara (ver memoria/trampas/fallas-que-no-dan-error.md).
        from config import OLLAMA_MODEL  # noqa: PLC0415

        return call_ollama(transcript_text, video_id="adapt", model=model or OLLAMA_MODEL)


def mexicanize(text: str) -> str:
    """Post-procesa el output del LLM para corregir argentinismos/españolismos
    que Claude a veces deja a pesar del prompt. Reemplazos seguros con regex
    para no romper palabras como 'salvavidas' o 'bailable'.
    """
    import re
    repl = [
        # Checá (argentino) -> Checa (mexicano)
        (r"\bChec[aá]\b", lambda m: "Checa" if m.group(0)[0].isupper() else "checa"),
        # Mirá -> Mira
        (r"\bMir[aá]\b", lambda m: "Mira" if m.group(0)[0].isupper() else "mira"),
        # Fijate / Fijá -> Fíjate
        (r"\bFij[aá]te\b", lambda m: "Fíjate" if m.group(0)[0].isupper() else "fíjate"),
        # Andá -> Anda
        (r"\bAnd[aá]\b", lambda m: "Anda" if m.group(0)[0].isupper() else "anda"),
        # Vení -> Ven
        (r"\bVen[ií]\b", lambda m: "Ven" if m.group(0)[0].isupper() else "ven"),
        # Voseo a tú (palabras comunes)
        (r"\btenés\b", "tienes"),
        (r"\bTenés\b", "Tienes"),
        (r"\bquerés\b", "quieres"),
        (r"\bQuerés\b", "Quieres"),
        (r"\bpodés\b", "puedes"),
        (r"\bPodés\b", "Puedes"),
        (r"\bhacés\b", "haces"),
        (r"\bHacés\b", "Haces"),
        (r"\bsabés\b", "sabes"),
        (r"\bSabés\b", "Sabes"),
        # vale (España) -> sale (México), solo cuando es interjección/expresión
        (r"(¿|,\s)vale\b\??", lambda m: m.group(1) + "sale?" if m.group(0).endswith("?") else m.group(1) + "sale"),
        (r"^vale\.", "Sale."),
        (r"\.\s+vale\.", ". Sale."),
        (r",\s+vale\.", ", sale."),
        (r"\?\s+vale\.", "? Sale."),
        # vos (argentino) como pronombre -> tú
        (r"\bvos\b", "tú"),
        (r"\bVos\b", "Tú"),
        # tío/tía (España) -> hermano/güey (suave)
        # mejor no reemplazar para no romper sentidos familiares legítimos
    ]
    out = text
    for pattern, replacement in repl:
        if callable(replacement):
            out = re.sub(pattern, replacement, out)
        else:
            out = re.sub(pattern, replacement, out)
    return out


def validate_adapted(raw: dict) -> dict:
    """Sanea el output del LLM. Si vienen campos faltantes, default."""
    # Subido a 5000 para soportar guiones de 2-3 min (300-450 palabras ~= 2500-3500 chars)
    script = mexicanize(str(raw.get("adaptedScript", "")).strip()[:5000])
    hook = mexicanize(str(raw.get("hook", "")).strip()[:200])
    if not hook and script:
        # Derivar hook como primera frase si no vino
        first_line = script.split("\n")[0].strip()
        hook = first_line[:200]
    hashtags = raw.get("suggestedHashtags") or []
    if isinstance(hashtags, list):
        hashtags = [str(h).strip() for h in hashtags if str(h).strip()][:15]
        hashtags = [h if h.startswith("#") else f"#{h}" for h in hashtags]
    else:
        hashtags = []
    structure_analysis = str(raw.get("structureAnalysis", "")).strip()[:600]
    original_angle = str(raw.get("originalAngle", "")).strip()[:300]
    adapted_angle = str(raw.get("adaptedAngle", "")).strip()[:300]
    beats = raw.get("beats") or []
    if not isinstance(beats, list):
        beats = []
    beats_clean = []
    for b in beats[:8]:
        if not isinstance(b, dict):
            continue
        beats_clean.append({
            "label": str(b.get("label", "")).strip()[:32],
            "function": str(b.get("function", "")).strip()[:200],
            "text": mexicanize(str(b.get("text", "")).strip()[:700]),
            "source": str(b.get("source", "")).strip()[:200],
        })

    # Sources: lista de claims con su origen — para que el creador pueda verificar
    sources_raw = raw.get("sources") or []
    sources_clean = []
    if isinstance(sources_raw, list):
        for s in sources_raw[:10]:
            if not isinstance(s, dict):
                continue
            sources_clean.append({
                "claim": str(s.get("claim", "")).strip()[:300],
                "source": str(s.get("source", "")).strip()[:200],
                "confidence": str(s.get("confidence", "medium")).strip()[:10],
            })

    return {
        "structureAnalysis": structure_analysis,
        "originalAngle": original_angle,
        "adaptedAngle": adapted_angle,
        "adaptedScript": script,
        "hook": hook,
        "suggestedHashtags": hashtags,
        "beats": beats_clean,
        "sources": sources_clean,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript-file", help="Path a un .json o .txt con el transcript")
    parser.add_argument("--transcript-stdin", action="store_true", help="Leer transcript desde stdin")
    parser.add_argument("--provider", choices=["auto", "claude", "codex", "ollama"], default="auto")
    parser.add_argument("--model", help="Modelo específico (override del default del provider)")
    args = parser.parse_args()

    if args.transcript_file:
        from pathlib import Path
        p = Path(args.transcript_file)
        if not p.exists():
            print(f"[error] no existe {p}", file=sys.stderr)
            return 1
        raw_text = p.read_text(encoding="utf-8")
        # Si es JSON con shape {words: [...]}, extraer texto plano
        try:
            data = json.loads(raw_text)
            if isinstance(data, dict) and "words" in data:
                transcript_text = " ".join(w.get("word", "") for w in data["words"])
            elif isinstance(data, dict) and "text" in data:
                transcript_text = data["text"]
            else:
                transcript_text = raw_text
        except json.JSONDecodeError:
            transcript_text = raw_text
    elif args.transcript_stdin:
        transcript_text = sys.stdin.read()
    else:
        parser.error("Especificá --transcript-file o --transcript-stdin")

    transcript_text = transcript_text.strip()
    if not transcript_text:
        print("[error] transcript vacío", file=sys.stderr)
        return 1
    if len(transcript_text) > 6000:
        # Truncar si es demasiado largo (Claude opus tiene context grande pero
        # ahorramos tokens para guiones de 5+ min)
        transcript_text = transcript_text[:6000] + "…"

    provider = auto_provider() if args.provider == "auto" else args.provider
    model = args.model or default_model(provider)
    print(f"[setup] provider={provider} model={model}", file=sys.stderr)

    try:
        raw = call_llm_adapt(transcript_text, provider=provider, model=model)
    except Exception as exc:
        print(f"[error] {provider} falló: {exc}", file=sys.stderr)
        return 1

    adapted = validate_adapted(raw)
    adapted["_provider"] = provider
    adapted["_model"] = model

    # Stdout JSON limpio (lo que consume el endpoint TS)
    print(json.dumps(adapted, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
