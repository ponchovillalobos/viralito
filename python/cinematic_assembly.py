"""Asamblea de agentes cinematográficos.

Un sistema multi-agente donde cada agente es un Claude separado con un rol
específico. Trabajan en paralelo viendo el mismo input (transcript + overlays
del usuario + estilo) y proponen su capa de decisiones. Un agente "Closer"
final consolida todas las decisiones en un timeline coherente.

Agentes:
  1. Director         → visión general, actos, momentos clave, tono
  2. PacingEditor     → cortes, jump cuts, pausas, stutters
  3. Cinematographer  → camera moves (zoom_in/out, pan, push, pull)
  4. MotionDesigner   → animaciones de stickers, words, emphasis cards
  5. ColorGrader      → vignette, film grain, color palette
  6. SoundDesigner    → SFX timestamps, música, drops/builds
  7. VFXArtist        → effect por imageOverlay (tv_static/memory_flash/...)
  8. SubtitleEditor   → qué palabras destacar, timing, color highlights
  9. Closer           → consolida en JSON final compatible con Remotion

Uso:
  python cinematic_assembly.py --transcript-file X.json --overlays-file Y.json
    --duration 60 --style cinematic --out result.json

Las llamadas a Claude son SECUENCIALES por dos razones:
  1. El Director debe correr primero — su output (vision) alimenta a los demás
  2. Claude CLI no tiene rate limit pero llamarlo en paralelo desde Python
     no acelera mucho (cada llamada toma 20-40s independiente)
  Si en el futuro queremos paralelizar, usar concurrent.futures.ThreadPoolExecutor.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

from generate_caption import _run_cli_utf8, extract_json_from_text


# ─── Prompts especialistas ────────────────────────────────────────────────────

DIRECTOR_PROMPT = """Sos director de cine que crea reels virales en español MEXICANO LATAM
para un creador especializado en COMUNICACIÓN, PERSUASIÓN, VENTAS y LENGUAJE NO VERBAL.

Tu trabajo: ANALIZAR el guión y producir una VISIÓN cinematográfica del video.

Recibís: transcript completo del video (con timestamps palabra-por-palabra).

Devolvé JSON estricto:
{
  "visionStatement": "<1-2 oraciones describiendo el feeling/atmósfera del video — ej. 'documental nostálgico con tensión creciente'>",
  "totalDurationSec": <número>,
  "acts": [
    {
      "name": "<ej. setup/tension/revelation/cta>",
      "startSec": <num>,
      "endSec": <num>,
      "emotionalTone": "<ej. íntimo, dramático, energético, reflexivo>",
      "keyMessage": "<la idea principal de este acto en 1 frase>"
    }
  ],
  "keyMoments": [
    { "at": <sec>, "type": "<hook|punchline|revelation|cta|emotion_peak>", "reason": "<por qué este momento es importante>" }
  ],
  "overallPacing": "<slow|medium|fast|variable>"
}

REGLA: 3-5 acts max, 4-8 keyMoments max. Sin markdown, solo JSON.
"""

PACING_PROMPT = """Sos editor de pacing/cortes para reels virales en TikTok/Reels.

Recibís:
  - Transcript con timestamps palabra-por-palabra
  - Visión del director (acts + key moments)

Tu trabajo: decidir DÓNDE poner cortes, jump cuts, pausas, stutters para mantener
el watch time alto. Los reels que retienen >70% tienen cortes cada 2-4 segundos.

Devolvé JSON:
{
  "pacingDecisions": [
    { "at": <sec>, "type": "<jump_cut|micro_pause|stutter|cut_to_broll>", "duration": <sec opcional>, "reason": "<por qué acá>" }
  ],
  "averageCutEverySec": <num>,
  "recommendedTotalCuts": <num>
}

REGLA: máximo 1 jump_cut cada 1.5 segundos. Más de eso satura. Sin markdown.
"""

CINEMATOGRAPHER_PROMPT = """Sos director de fotografía. Decidís CAMERA MOVES sobre el video base.

Recibís: visión + key moments.

Cámaras disponibles:
  - zoom_in: enfocar lo dicho, transmite intimidad/intensidad. Bueno para confesiones.
  - zoom_out: revelar contexto, aliviar tensión, abrir.
  - push_in: zoom rápido + acercamiento, energético, marca clímax.
  - pull_out: zoom rápido hacia afuera, sorpresa, revelación.
  - pan_left / pan_right: movimiento lateral, transición o búsqueda.
  - shake: vibración corta, para énfasis en palabras potentes.

Devolvé JSON:
{
  "cameraMoves": [
    { "at": <sec>, "duration": <sec, 0.3-2.0>, "type": "<ver lista>", "intensity": <0.05-0.25>, "reason": "..." }
  ]
}

REGLA: 3-8 camera moves para un video de 60s. Demasiados marean. Sin markdown.
"""

MOTION_PROMPT = """Sos motion designer. Decidís animaciones de elementos (stickers, palabras, emphasis cards).

Recibís: transcript + visión + acts.

Tipos disponibles:
  - sticker animation: bounce_in, spin_in, slide_in (palabra+emoji aparece animada)
  - emphasis_card: card grande con palabra+emoji que toma toda la pantalla 1-2s
  - floating_emoji: emoji grande flotando lateralmente

Devolvé JSON:
{
  "motionDecisions": [
    { "at": <sec>, "element": "<sticker|emphasis_card|floating_emoji>", "word": "<la palabra del transcript>", "animation": "<bounce|spin|slide>", "duration": <sec>, "reason": "..." }
  ]
}

REGLA: 4-10 elementos por video de 60s. Sin markdown.
"""

COLOR_PROMPT = """Sos colorista cinematográfico.

Recibís: visión + acts (con emotional tone de cada acto).

Decisiones a tomar:
  - vignette: bordes oscuros (0 = nada, 1 = fuerte)
  - filmGrain: textura de grano (true/false)
  - contrastBoost: 0-0.2
  - saturationOffset: -0.2 a +0.2 (negativo = más mate/cine)
  - paletteIntent: warm | cold | neutral | desaturated | high_contrast

Devolvé JSON:
{
  "colorGrading": {
    "vignette": <0-1>,
    "filmGrain": <bool>,
    "contrastBoost": <num>,
    "saturationOffset": <num>,
    "paletteIntent": "<string>",
    "reason": "<por qué este look para este video>"
  }
}

Sin markdown.
"""

SOUND_PROMPT = """Sos sound designer cinematográfico. Decidís CADA SFX del video.

Recibís: visión del director + acts + pacing decisions + transcript con palabras y timestamps.

SFX disponibles en la biblioteca local (usar SOLO estos nombres EXACTOS — YA existen en
disco; cualquier otro nombre se DESCARTA, no inventes archivos):

  ── Whooshes / transiciones / movimientos:
     whoosh.ogg, swoosh.wav, swoosh_quick.wav, swoosh_soft.wav

  ── Acentos / palabras clave / UI:
     pop.ogg, pop_short.ogg, click.ogg, ding.ogg, ding_bell.ogg,
     notification.ogg, typewriter.wav

  ── Dramáticos / impacto / revelación / tensión:
     thud.wav (golpe/impacto/boom), ding_bell.ogg (revelación/cierre),
     splash.ogg, water_drop.ogg (gota de tensión), bloop.ogg (glitch/error)

  ── Retro / textura:
     film_reel.wav, typewriter.wav

REGLAS DE USO:
  1. CADA imageOverlay → un sfx al inicio (click.ogg para fotos, film_reel.wav para
     recuerdos/retro, typewriter.wav para documentos, thud.wav para impacto).
  2. CADA jump_cut del pacing → whoosh.ogg / swoosh_quick.wav / pop.ogg.
  3. Momentos clave del transcript ("¿sabías que…?", cifras dramáticas, pausa antes de
     revelación) → thud.wav, ding_bell.ogg, splash.ogg, water_drop.ogg (1-2s ANTES).
  4. Inicio del video (primeros 3s) → whoosh.ogg o swoosh.wav.
  5. Cierre/CTA → ding.ogg o ding_bell.ogg.

Devolvé JSON:
{
  "audioDecisions": [
    {
      "at": <sec exacto del transcript>,
      "sfx": "<nombre EXACTO de la lista de arriba (.ogg o .wav)>",
      "volume": <0.15-0.55>,
      "trigger": "<word|overlay|cut|act_start|climax>",
      "reason": "<por qué ESTE SFX en ESTE momento>"
    }
  ],
  "musicSuggestion": "<descripción del mood musical que el creador puede elegir aparte>"
}

REGLAS DURAS:
  - 8-18 SFX para un video de 60s (era 5-12, ahora más rico).
  - NUNCA dos SFX dentro de 0.4 segundos.
  - Volumen total balanceado (no todos al 0.5 — variar).
  - Sin markdown, solo JSON.
"""

VFX_PROMPT = """Sos VFX artist cinematográfico. Decidís effect/motion/transitions por
cada IMAGE OVERLAY que el usuario subió.

Recibís:
  - Transcript COMPLETO con timestamps palabra-por-palabra (cada palabra con su `start`)
  - Visión del director
  - Lista de overlays con id + filename + descripción del usuario + userOrder

═══════════════════════════════════════════════════════
REGLA #0 — RESPETAR ORDEN MANUAL (PRIORIDAD ABSOLUTA)
═══════════════════════════════════════════════════════
Si un overlay tiene `userOrder` (1, 2, 3…) ESE ES EL ORDEN OBLIGATORIO de aparición.
El overlay con userOrder=1 va PRIMERO en el timeline (startTime menor),
el de userOrder=2 va segundo, etc.

Si dentro de ese orden manual hay matching semántico con el transcript, usalo para
afinar el timestamp. Si no hay match, distribuir uniformemente RESPETANDO el orden.

Ejemplo concreto:
  - Overlay A: userOrder=1, description="presentación inicial"
  - Overlay B: userOrder=2, description="momento Carnegie 1936"
  - Overlay C: userOrder=3, description="cierre del video"
  - Transcript dice "Carnegie" en seg 28
  → A en seg 5-9, B en seg 27-32 (matchea Carnegie), C en seg 50-55 (cierre)

Si NINGÚN overlay tiene userOrder → usar matching semántico libre (regla #1).

═══════════════════════════════════════════════════════
REGLA #1 — MATCHING CONTENIDO / TRANSCRIPT (cuando no hay orden manual)
═══════════════════════════════════════════════════════
Para CADA overlay SIN userOrder analizá:
  1. La descripción que el usuario escribió (ej: "logo HubSpot", "captura cliente")
  2. El filename (a veces ya da pistas: "cliente_firma.jpg")
  3. Buscá palabras CLAVE / RELACIONADAS en el transcript con su timestamp exacto.

Ejemplos:
  - description="logo HubSpot" + transcript dice "HubSpot" en seg 23.4
    → startTime ≈ 23.4, endTime ≈ 27.0 (durante 3.5s mostramos el logo)
  - description="captura WhatsApp del cliente molesto" + transcript dice "cliente"
    en seg 18 + "molesto" en seg 19 → startTime ≈ 18.5, endTime ≈ 22
  - description="grafico de ventas creciendo" + transcript dice "creció 200%" en seg 35
    → startTime ≈ 35, endTime ≈ 39
  - description="foto de Nixon maquillándose" + transcript dice "Nixon" en seg 42
    → startTime ≈ 42, endTime ≈ 46

IMPORTANTE: Si la descripción dice "primera"/"segunda"/"final" PERO no tiene userOrder,
INTERPRETÁ esas palabras como orden implícito (primera = aparece primero, final = al final).

Si NO hay match obvio del transcript NI palabras ordinales en la descripción:
  - Distribuir uniformemente respetando la VISIÓN del director (acts).
  - Preferir momentos de tensión/insight (act emocional) sobre setup/cta.

═══════════════════════════════════════════════════════
EFFECTS / MOTIONS / TRANSITIONS DISPONIBLES
═══════════════════════════════════════════════════════
Effects (filtro visual sobre la imagen):
  - tv_static    : RGB shift + chroma como TV vieja. Para CONTRAINTUITIVO/SHOCK.
  - memory_flash : sepia suave + blur. Para RECUERDO/EVOCACIÓN.
  - polaroid     : borde blanco + sombra + rotación. Para FOTOS DE GENTE.
  - vhs          : scanlines + saturación. Para FLASHBACK/AÑOS 80-90.
  - newspaper    : sepia alta + vignette. Para DATOS/HISTORIA.

Motions (movimiento durante la imagen):
  - ken_burns_in   : scale 1.0 → 1.4 (default cinematic). Profundidad.
  - ken_burns_out  : scale 1.4 → 1.0. Revelación.
  - pan_left/right : barrido lateral. Tour visual.
  - zoom_bump      : pulso al inicio y al final. Acento.
  - static         : sin movimiento. RARO, casi nunca usar.

Transitions (entrada/salida):
  - fade       : opacity gradual. Default suave.
  - slide_up   : entra desde abajo. Subraya.
  - slide_down : entra desde arriba. Aplasta.
  - zoom_out   : entra grande → tamaño normal. Energético.
  - tv_off     : CRT collapse. Cierre dramático con tape-stop.mp3.

═══════════════════════════════════════════════════════
OUTPUT — JSON estricto
═══════════════════════════════════════════════════════
{
  "vfxDecisions": [
    {
      "overlayId": "<id exacto>",
      "startTime": <sec>,
      "endTime": <sec — duración entre 2.5 y 5s>,
      "effect": "<de la lista>",
      "motion": "<de la lista — default ken_burns_in>",
      "transitionIn": "<de la lista>",
      "transitionOut": "<de la lista>",
      "position": "center",
      "sizeRatio": 1.0,
      "matchedWord": "<la palabra del transcript que motivó este timestamp, si aplica>",
      "reason": "<por qué ESTE timing y combo en 1 oración>"
    }
  ]
}

REGLAS DURAS:
  - NO solaparse: cada overlay debe terminar antes que arranque el siguiente.
  - position SIEMPRE "center" y sizeRatio SIEMPRE 1.0 (en modo cinematic son fullscreen).
  - Duración entre 2.5 y 5 segundos.
  - Si dos overlays compiten por la misma palabra, ponerlos consecutivos (uno detrás del otro con 0.5s de gap).
  - Sin markdown.
"""

SUBTITLE_PROMPT = """Sos editor de subtítulos para reels virales.

Recibís: transcript con timestamps palabra-por-palabra + visión + acts.

Decidís qué palabras destacar (color highlight, sticker, o emphasis_card).

Devolvé JSON:
{
  "subtitleDecisions": [
    {
      "word": "<exact palabra del transcript>",
      "at": <sec exacto>,
      "treatment": "<highlight|sticker|emphasis_card>",
      "reason": "<por qué esta palabra>"
    }
  ],
  "globalStyle": "<bebas|anton|cinematic>",
  "colorRotation": ["#hex1", "#hex2", ...]
}

REGLA: 8-20 palabras destacadas en un video de 60s. Sin markdown.
"""

CLOSER_PROMPT = """Sos director ejecutivo. Consolidás las decisiones de 7 agentes en un timeline
final coherente listo para renderizar en Remotion.

Recibís un JSON con:
  - vision (del director)
  - pacingDecisions
  - cameraMoves
  - motionDecisions
  - colorGrading
  - audioDecisions
  - vfxDecisions
  - subtitleDecisions

Tu trabajo:
  1. Detectar conflictos temporales (dos agentes proponen acción en mismo seg).
  2. Resolver priorizando el más importante para retención (camera moves > VFX > SFX).
  3. Ajustar tiempos para que nada se pise (mover ±0.3s si hace falta).
  4. Output un timeline JSON FINAL con TODO consolidado.

Devolvé JSON con esta forma:
{
  "timeline": {
    "zoomMarks": [{"at": <sec>, "duration": <sec>, "scale": <num>}, ...],
    "reactionZooms": [{"at": <sec>, "duration": <sec>, "intensity": <num>}, ...],
    "stutterMarks": [{"at": <sec>, "duration": <sec>}, ...],
    "sfxMarks": [{"at": <sec>, "sound": "<archivo.mp3>", "url": "/api/sfx/stream?file=...", "volume": <num>}, ...],
    "emphasisCards": [...],
    "wordStickers": [...],
    "floatingEmojis": [...],
    "imageOverlays": [...],
    "filmGrain": <bool>,
    "vignette": <bool>,
    "subtitleStyle": "<bebas|anton|cinematic>",
    "colorRotation": [...]
  },
  "conflicts_resolved": [{"at": <sec>, "what": "...", "kept": "...", "moved": "..."}]
}

REGLA: SOLO JSON, sin markdown.
"""


# ─── Llamadas a Claude CLI ────────────────────────────────────────────────────

def _call_claude(prompt: str, model: str = "opus", timeout: int = 240) -> dict:
    """Reusable: arma args, llama Claude CLI, parsea JSON output."""
    claude_bin = shutil.which("claude")
    if not claude_bin:
        raise RuntimeError("claude CLI no encontrado")
    args = [claude_bin, "--print", "--output-format", "text", "--model", model, prompt]
    rc, stdout, stderr = _run_cli_utf8(args, None, timeout=timeout)
    if rc != 0:
        raise RuntimeError(f"claude rc={rc}: {stderr[-300:]}")
    try:
        return extract_json_from_text(stdout)
    except Exception as exc:
        raise RuntimeError(f"parse json: {exc}; first 300 chars: {stdout[:300]}")


def call_director(transcript_text: str) -> dict:
    print("[director] analizando guión...", file=sys.stderr)
    prompt = (
        f"{DIRECTOR_PROMPT}\n\n"
        f"TRANSCRIPT:\n{transcript_text}\n\n"
        "Responde SOLO con el JSON."
    )
    return _call_claude(prompt)


def call_specialist(role: str, prompt: str, context: dict, transcript_full: str | None = None) -> dict:
    """Llamada a un agente especialista.

    `context` incluye vision + acts + overlays. `transcript_full` (opcional) se
    pasa SEPARADO y NO se trunca — clave para que el agente VFX/Sound/Subtitles
    pueda buscar matches en palabras lejanas del transcript.
    """
    print(f"[{role}] decidiendo...", file=sys.stderr)
    parts = [prompt, ""]
    if transcript_full:
        # Transcript completo, sin truncar — para que el agente vea TODAS las palabras
        # con sus timestamps. El context principal va aparte.
        parts.append("TRANSCRIPT COMPLETO (palabra por palabra con sus segundos):")
        parts.append(transcript_full)
        parts.append("")
    parts.append("CONTEXTO ADICIONAL:")
    # Solo truncamos el context (vision/acts/overlays) — no el transcript
    parts.append(json.dumps(context, ensure_ascii=False, indent=2)[:5000])
    parts.append("")
    parts.append("Responde SOLO con el JSON.")
    full = "\n".join(parts)
    return _call_claude(full)


def call_closer(all_decisions: dict) -> dict:
    print("[closer] consolidando timeline...", file=sys.stderr)
    prompt = (
        f"{CLOSER_PROMPT}\n\n"
        f"DECISIONES DE LOS AGENTES:\n{json.dumps(all_decisions, ensure_ascii=False, indent=2)[:8000]}\n\n"
        "Responde SOLO con el JSON. Output el `timeline` consolidado."
    )
    return _call_claude(prompt, timeout=300)


# ─── Orquestador ──────────────────────────────────────────────────────────────

def assemble(
    transcript_text: str,
    overlays_data: list[dict] | None,
    duration: float,
) -> dict:
    """Corre todos los agentes en secuencia y devuelve el timeline final."""
    t0 = time.time()
    results: dict[str, Any] = {"transcript_words": len(transcript_text.split())}

    # 1. Director propone la visión
    try:
        vision = call_director(transcript_text)
        results["vision"] = vision
    except Exception as exc:
        print(f"[director] fail: {exc}, usando fallback", file=sys.stderr)
        results["vision"] = {
            "visionStatement": "estilo cinematográfico estándar",
            "totalDurationSec": duration,
            "acts": [],
            "keyMoments": [],
            "overallPacing": "medium",
        }

    base_ctx = {
        "transcript_preview": transcript_text[:1500],
        "vision": results["vision"],
        "duration": duration,
        "overlays": overlays_data or [],
    }

    # Algunos agentes necesitan ver el transcript COMPLETO (no solo preview)
    # para hacer matching exacto contra palabras lejanas. Para esos pasamos
    # `transcript_full` aparte, sin truncar.
    AGENTS_THAT_NEED_FULL_TRANSCRIPT = {"vfx", "sound", "subtitles", "pacing"}

    specialists = [
        ("pacing", PACING_PROMPT),
        ("cinematographer", CINEMATOGRAPHER_PROMPT),
        ("motion", MOTION_PROMPT),
        ("color", COLOR_PROMPT),
        ("sound", SOUND_PROMPT),
        ("vfx", VFX_PROMPT),
        ("subtitles", SUBTITLE_PROMPT),
    ]
    for role, prompt in specialists:
        try:
            results[role] = call_specialist(
                role,
                prompt,
                base_ctx,
                transcript_full=transcript_text if role in AGENTS_THAT_NEED_FULL_TRANSCRIPT else None,
            )
        except Exception as exc:
            print(f"[{role}] fail: {exc}, omitiendo", file=sys.stderr)
            results[role] = {}

    # 9. Closer consolida
    try:
        closer = call_closer(results)
        timeline = closer.get("timeline", {})
        results["timeline"] = timeline
        results["conflicts_resolved"] = closer.get("conflicts_resolved", [])
    except Exception as exc:
        print(f"[closer] fail: {exc}, devolviendo todo crudo", file=sys.stderr)
        results["timeline"] = {}

    results["_elapsed_sec"] = round(time.time() - t0, 1)
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transcript-file", required=True)
    parser.add_argument("--overlays-file", help="JSON con [{id, description}, ...]")
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--out", help="Path donde guardar el JSON final")
    args = parser.parse_args()

    # Cargar transcript
    raw = Path(args.transcript_file).read_text(encoding="utf-8")
    try:
        t_data = json.loads(raw)
        if isinstance(t_data, dict) and "words" in t_data:
            transcript_text = " ".join(w.get("word", "") for w in t_data["words"])
        elif isinstance(t_data, dict) and "text" in t_data:
            transcript_text = t_data["text"]
        else:
            transcript_text = raw
    except json.JSONDecodeError:
        transcript_text = raw

    # Cargar overlays opcional
    overlays_data = None
    if args.overlays_file:
        overlays_data = json.loads(Path(args.overlays_file).read_text(encoding="utf-8"))

    result = assemble(transcript_text, overlays_data, args.duration)

    if args.out:
        Path(args.out).write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
