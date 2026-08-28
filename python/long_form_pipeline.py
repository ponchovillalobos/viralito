"""Pipeline completo: video largo → video clean + N clips virales estilo supreme.

Uso:
  python long_form_pipeline.py <video_id>           # busca raw en long_form/raw/{video_id}.mp4
  python long_form_pipeline.py <video_id> --skip-transcribe   # si ya hay transcript
  python long_form_pipeline.py <video_id> --render             # también renderiza cada clip (largo!)
  python long_form_pipeline.py <video_id> --analyze-only       # SOLO análisis: escribe proposals y termina
  python long_form_pipeline.py <video_id> --from-proposals --clips 0,2,5 --render
      # salta el análisis: lee el proposals existente y SOLO extrae+genera esas posiciones

Pasos:
  1. transcribir (long_form/transcripts/{id}.json)
  2. detect_silences (long_form/cuts/{id}.json)
  3. cut_silences -> long_form/clean/{id}_clean.mp4
  4. analyze_clips (Ollama) -> long_form/proposals/{id}.json
  5. extract_clips -> long_form/clips/{id}_clip_NN.mp4 + transcripts
  6. (opcional) por cada clip: build-clip-supreme.mjs + build-clip-props.mjs + npx remotion render
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from config import (
    FFMPEG_PATH,
    LF_CLEAN,
    LF_CLIPS,
    LF_CUTS,
    LF_PROJECTS,
    LF_PROPOSALS,
    LF_RAW,
    LF_RENDERS,
    LF_TRANSCRIPTS,
    ensure_long_form_dirs,
)
from hw_profile import ffmpeg_full_args
from lib.bitacora import Bitacora
from lib.ffmpeg_safe_run import safe_ffmpeg
from lib import ollama_opts as _ollama_opts
from lib import proc as _proc
from postencode import post_encode
from normalize_audio import normalize as normalize_loudness


PYTHON_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PYTHON_DIR.parent


def seleccion_de_clips(
    proposals_path: Path | str, max_clips: int | None, explicita: str | None
) -> str | None:
    """Qué clips trabajar, en el formato que espera `--clips` de extract_clips.

    `--max-clips` dice «limitar cantidad de clips a renderizar», pero sólo actuaba
    como techo del ANÁLISIS. Si las propuestas ya estaban en disco con más clips,
    el análisis se salteaba y el tope no limitaba nada: se extraían, se les hacían
    gráficos y sólo al final se recortaba la lista para renderizar.

    Medido pidiendo 3 clips de un video de 99 minutos: 20 clips extraídos (8 min)
    y 20 pasadas de gráficos (~33 min) para material que no se iba a usar. No
    fallaba nada; se trabajaba de más, en silencio, durante media hora.

    Quedarse con las primeras N es quedarse con las MEJORES: la etapa de virality
    deja las propuestas ordenadas por puntaje descendente (51, 46, 38, …), no por
    tiempo. Una elección explícita con `--clips` manda siempre.

    Devuelve None cuando no hay nada que acotar — que significa «todas», igual que
    antes.
    """
    if explicita:
        return explicita
    if not max_clips or max_clips <= 0:
        return None
    try:
        todas = json.loads(Path(proposals_path).read_text(encoding="utf-8")).get("clips") or []
    except (OSError, ValueError, TypeError):
        return None
    if len(todas) <= max_clips:
        return None
    print(
        f"[smart] hay {len(todas)} propuestas y se pidieron {max_clips}: "
        f"se trabajan solo las {max_clips} de mejor puntaje",
        file=sys.stderr,
    )
    # 0-BASED: es lo que espera `--clips`. Escrito 1-based se saltearía el clip de
    # mejor puntaje y tomaría uno de más — un error que no falla, sólo entrega
    # algo distinto de lo pedido, que es la clase más difícil de notar.
    return ",".join(str(i) for i in range(max_clips))


def _avisar_de_lo_que_no_cuadra(clip_id: str, style_id: str) -> None:
    """Revisa el proyecto antes de gastar el render, y AVISA. No frena nada.

    Un render tarda minutos y casi nunca falla con un error: falla entregando un
    video con algo mal, que sólo se descubre mirándolo. Esta revisión cuesta menos
    de un segundo y cruza los tiempos del proyecto contra la duración real del
    clip, que es la familia de problemas más cara de detectar a ojo.

    Avisa en vez de abortar a propósito: tumbar un lote de veinte clips porque uno
    tiene una observación sería peor que el problema que se quiere evitar, y en un
    lote largo la salida sirve justamente para saber qué mejorar después. Que sea
    best-effort también es deliberado — si el verificador se rompe, el render
    sigue: nunca puede convertirse en un motivo nuevo de fallo.
    """
    try:
        from verificar_proyecto import verificar  # noqa: PLC0415

        proyecto_json = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        clip_mp4 = LF_CLIPS / f"{clip_id}.mp4"
        if not proyecto_json.exists():
            return
        hallazgos = verificar(
            json.loads(proyecto_json.read_text(encoding="utf-8")),
            clip_mp4 if clip_mp4.exists() else None,
        )
        for h in hallazgos:
            print(f"[revision] {clip_id}/{style_id} [{h.nivel}] {h.texto}",
                  file=sys.stderr, flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[revision] no se pudo revisar {clip_id}/{style_id}: {e}",
              file=sys.stderr, flush=True)
REMOTION_DIR = PROJECT_ROOT / "remotion"
# El MISMO intérprete que está corriendo: venv en dev, Python embeddable en el
# paquete distribuible (la ruta hardcodeada al venv rompía en máquinas de usuarios).
VENV_PYTHON = Path(sys.executable)

# ── Catálogo de estilos: fuente de verdad = frontend/src/lib/style-registry.data.json ──
# VALID_STYLES y GRAPHICS_STYLES vivían HARDCODEADOS acá y se DESINCRONIZARON del
# registro: faltaban editorial_full/editorial_broll/paper_cut/lottie_pop en
# GRAPHICS_STYLES, así que generate_graphics.py NO corría para ellos → esos estilos
# renderizaban SIN tarjetas editoriales/ilustraciones/charts (bug "solo títulos").
# Ahora se DERIVAN del registro (hasGraphics:true = necesita generate_graphics).
# Si el JSON no se puede leer, cae a un fallback correcto (nunca rompe el pipeline).
_STYLE_REGISTRY_PATH = PROJECT_ROOT / "frontend" / "src" / "lib" / "style-registry.data.json"

_FALLBACK_VALID_STYLES = {
    "silent", "punch", "hype", "hype_max", "hype_max_sfx", "supreme",
    "cinematic_pro", "broll_full", "broll_pip", "text_behind", "pop_reels",
    "graphics_pro", "graphics_max", "motion_pro", "motion_beat", "motion_grid",
    "editorial", "editorial_broll", "editorial_full", "kinetic_type",
    "lottie_pop", "paper_cut", "cine_clasico", "vhs", "audiogram",
}
_FALLBACK_GRAPHICS_STYLES = {
    "hype", "hype_max", "hype_max_sfx", "supreme", "graphics_pro", "graphics_max",
    "motion_pro", "motion_beat", "motion_grid",
    "editorial", "editorial_full", "editorial_broll", "lottie_pop", "paper_cut",
}
_FALLBACK_ILLUSTRATION_STYLES = {
    "editorial", "editorial_full", "editorial_broll", "lottie_pop", "paper_cut",
}


def _load_style_catalog() -> tuple[set[str], set[str], set[str]]:
    """(VALID_STYLES, GRAPHICS_STYLES, ILLUSTRATION_STYLES) del registro compartido.

    GRAPHICS_STYLES = hasGraphics:true → necesitan que corra generate_graphics.py
    (editorialCards, dataViz, kineticHeadlines, íconos). ILLUSTRATION_STYLES =
    illustrations:true → además reciben ilustraciones CC0 (concept_illustrations, la
    flag --illustrations de generate_graphics). Derivar del registro evita el drift
    (los editoriales salían "solo con títulos" y sin ilustraciones). Fallback si el
    JSON no se puede leer (paquete sin frontend/, etc.)."""
    try:
        entries = json.loads(_STYLE_REGISTRY_PATH.read_text(encoding="utf-8"))
        valid = {e["id"] for e in entries if e.get("id")}
        graphics = {e["id"] for e in entries if e.get("hasGraphics")}
        illustrations = {e["id"] for e in entries if e.get("illustrations")}
        if valid and graphics:
            return valid, graphics, illustrations
    except Exception as e:  # noqa: BLE001 — registro ausente/ilegible → fallback
        print(f"[styles] no pude leer el registro ({e}); uso el fallback.", file=sys.stderr)
    return (
        set(_FALLBACK_VALID_STYLES),
        set(_FALLBACK_GRAPHICS_STYLES),
        set(_FALLBACK_ILLUSTRATION_STYLES),
    )


VALID_STYLES, GRAPHICS_STYLES, ILLUSTRATION_STYLES = _load_style_catalog()

# ── Render paralelo de clips (F0.2 auditoría) ───────────────────────────────
# Cuántos renders de Remotion corren A LA VEZ — ADAPTATIVO según los cores del
# equipo (4 cores → 1, 8 → 2, 16+ → 3). Override con env LF_RENDER_WORKERS.
def _render_workers() -> int:
    from hw_profile import render_workers

    return render_workers()


# ── SKIP de lo ya renderizado (re-run tras fallo parcial) ───────────────────
# Tamaño mínimo (bytes) para considerar VÁLIDO un .mp4 final ya en disco. Un
# render abortado deja archivos de pocos KB (header sin frames); pedimos >100 KB
# para tratarlo como "ya hecho" y saltarlo.
_RENDER_MIN_VALID_BYTES = 100 * 1024


def _force_render() -> bool:
    """¿Forzar regenerar TODO (ignorar lo ya renderizado)? VIRAL_FORCE_RENDER=1
    desactiva el skip. Default: skip activo (no fuerza)."""
    return os.environ.get("VIRAL_FORCE_RENDER", "0") == "1"


def _render_already_done(out: Path) -> bool:
    """True si el .mp4 final YA existe en disco y es válido (tamaño > umbral).
    Best-effort: cualquier error de stat → False (se renderiza igual)."""
    try:
        return out.is_file() and out.stat().st_size > _RENDER_MIN_VALID_BYTES
    except OSError:
        return False


def _offthread_cache_flag() -> str:
    """Flag de caché de OffthreadVideo para CADA clip de largos. El b-roll/mirror/clone
    se cachea para no dispararse "cache pruned" (re-decode lento). CLAVE en largos: se
    renderizan VARIOS clips EN PARALELO (render_workers); si cada uno tomara 35% de la
    RAM, N clips = N×35% → swap y TODO más lento. Por eso repartimos un presupuesto
    total (~45% de la RAM) ENTRE los clips paralelos. Tope por-clip 4 GB / piso 512 MB.
    OJO: el flag exacto es --offthreadvideo-cache-size-in-bytes (sin guion en
    "offthreadvideo")."""
    try:
        import psutil  # noqa: PLC0415

        total = int(psutil.virtual_memory().total)
    except Exception:  # noqa: BLE001
        # Fallback: hw_profile ya calcula la RAM (psutil o GlobalMemoryStatusEx).
        try:
            from hw_profile import detect  # noqa: PLC0415

            total = int(float(detect().get("ram_gb", 8.0)) * 1024**3)
        except Exception:  # noqa: BLE001
            total = 8 * 1024**3
    workers = max(1, _render_workers())  # clips en paralelo
    per_clip = int(total * 0.45 / workers)
    bytes_ = max(512 * 1024**2, min(per_clip, 4 * 1024**3))
    return f"--offthreadvideo-cache-size-in-bytes={bytes_}"


def _remotion_concurrency(workers: int) -> int:
    """Workers internos de cada `remotion render`. Repartimos cores-1 entre los
    renders paralelos para no sobre-suscribir el CPU."""
    override = os.environ.get("VIRAL_REMOTION_CONCURRENCY")
    if override and override.isdigit():
        return max(1, int(override))
    cores = os.cpu_count() or 4
    return max(1, (cores - 1) // max(1, workers))


def _node_bin() -> str | None:
    """Ejecutable de node para invocar el CLI de Remotion DIRECTO (sin npx).

    Prioridad: env VIRAL_NODE_BIN → node embebido junto al CLI de Remotion
    (paquete distribuible) → `node`/`node.exe` en el PATH. Devuelve None si no
    se encuentra ninguno (el caller cae a `npx`).
    """
    import shutil  # noqa: PLC0415

    override = os.environ.get("VIRAL_NODE_BIN")
    if override and Path(override).exists():
        return override
    # node embebido que algunos paquetes dejan junto a node_modules/.bin
    embedded = REMOTION_DIR / "node_modules" / ".bin" / (
        "node.exe" if sys.platform == "win32" else "node"
    )
    if embedded.exists():
        return str(embedded)
    found = shutil.which("node")
    if found:
        return found
    return None


def _remotion_cli_js() -> Path | None:
    """Ruta REAL al cli.js de @remotion/cli para invocarlo con node directo.

    Es el mismo entrypoint que el shim de node_modules/.bin/remotion ejecuta
    (`node @remotion/cli/remotion-cli.js`), así que los args son idénticos a
    `npx remotion`. Devuelve None si no existe (el caller cae a `npx`).
    """
    candidates = [
        REMOTION_DIR / "node_modules" / "@remotion" / "cli" / "remotion-cli.js",
        REMOTION_DIR / "node_modules" / ".bin" / "remotion",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def _remotion_render_cmd(out: Path, remotion_concurrency: int, props_name: str) -> list[str]:
    """Comando de `remotion render` para un clip.

    #8 VELOCIDAD: invoca el CLI de Remotion DIRECTO con node (node remotion-cli.js
    render …) en vez de `npx remotion render …`. npx re-resuelve el paquete en cada
    spawn (~1.5-2s × hasta 15-45 spawns por lote). Los ARGS son EXACTAMENTE los
    mismos. FALLBACK: si no encontramos node o el cli.js, caemos a `npx` como antes.
    """
    base_args = [
        "render",
        "src/index.ts",
        "ViralVideo",
        str(out),
        "--concurrency",
        str(remotion_concurrency),
        # delayRender amplio: el dev server sirviendo el clip bajo carga puede
        # tardar >28s (default) en responder un seek de OffthreadVideo.
        "--timeout=120000",
        # disableWebSecurity: los estilos audio-reactivos (audiogram + fondos
        # animatedBackground.audioReactive de motion_*/kinetic_type/lottie_pop) hacen
        # fetch CLIENT-SIDE del audio (useWindowedAudioData). El bundle de Remotion vive
        # en su puerto y el API en otro → cross-origin; sin este flag CORS bloquea el
        # fetch y el render FALLA ("Failed to fetch"). El CLI directo (node remotion-cli.js)
        # NO carga remotion.config.ts, así que va explícito acá.
        "--disable-web-security",
        _offthread_cache_flag(),
        f"--props={props_name}",
    ]
    # #4/#5 VELOCIDAD: preset de libx264 según hw_profile (ultrafast con GPU porque
    # el post-fx/post-encode re-encodea por hardware; veryfast en CPU-only). NO se
    # toca el CRF: Remotion mantiene su default (calidad final intacta). Solo el
    # preset, que a igual CRF da la MISMA calidad visual y baja el tiempo de encode.
    preset, _crf = _x264_recommend()
    if preset:
        base_args.append(f"--x264-preset={preset}")

    # Aceleracion por GPU tambien en ESTE camino.
    #
    # `hw_profile` recomienda `chromium_gl` y `render-server.mjs` lo lee — pero el
    # server es el POOL, y el pool no siempre se usa: cuando solo cabe una
    # instancia en RAM (mensaje "[lf-pool] ... sin pool (CLI directo)"), los
    # largos renderizan por aca. En esta maquina de 28 GB eso es lo NORMAL, asi
    # que la aceleracion quedaba encendida en la configuracion y sin aplicarse
    # nunca en el camino real. Es el mismo patron de "implementado pero
    # inalcanzable" que este proyecto ya pago tres veces.
    try:
        from hw_profile import detect  # noqa: PLC0415

        _gl = (detect().get("recommend", {}) or {}).get("chromium_gl")
        if _gl:
            base_args.append(f"--gl={_gl}")
    except Exception:  # noqa: BLE001 — sin recomendacion se renderiza como siempre
        pass
    node = _node_bin()
    cli = _remotion_cli_js()
    if node and cli:
        return [node, str(cli), *base_args]
    # FALLBACK: npx (re-resuelve el paquete cada vez, pero siempre funciona).
    npx = "npx.cmd" if sys.platform == "win32" else "npx"
    return [npx, "remotion", *base_args]


def _x264_recommend() -> tuple[str, int]:
    """(x264_preset, x264_crf) recomendados por hw_profile para el render de cada
    clip (#4/#5).

    - Con GPU usable (nvenc/qsv/amf): el x264 de Remotion es un INTERMEDIO que el
      post-fx/post-encode por hardware re-encodea y tira → preset 'ultrafast'.
    - CPU-only: el x264 ES el entregable → 'veryfast' (misma calidad visual a igual
      CRF, ~1.5-2x más rápido). El CRF NO se cambia (calidad final intacta).

    Best-effort: si no puedo leer el perfil, defaults conservadores (veryfast/24)
    que NO degradan calidad.
    """
    try:
        from hw_profile import detect  # noqa: PLC0415

        rec = detect().get("recommend", {}) or {}
        preset = str(rec.get("x264_preset") or "veryfast")
        crf = int(rec.get("x264_crf") or 24)
        return preset, crf
    except Exception:  # noqa: BLE001
        return "veryfast", 24


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"\n[run] {' '.join(str(x) for x in cmd)}", file=sys.stderr)
    # TIMEOUT (auditoría 2026-07-20): antes esto era `subprocess.run` pelado. Un
    # ffmpeg o un Remotion colgado dejaba el pipeline esperando para SIEMPRE — el
    # mecanismo del "la app dejó de responder". El techo es holgado (6 h por
    # default, VIRAL_STEP_TIMEOUT lo sube): sólo ataja el cuelgue infinito.
    _proc.run(cmd, cwd=cwd, check=True)


def _ffprobe_duration(path: Path) -> float:
    """Duración del video en segundos, sin transcribir nada (instantáneo)."""
    ffprobe = FFMPEG_PATH.parent / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    try:
        out = _proc.probe(
            [str(ffprobe), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        )
        return float(out.stdout.strip())
    except (ValueError, AttributeError, _proc.StepTimeout):
        # Sonda fallida o colgada → duración desconocida. El caller ya trata 0.0
        # como "no sé"; nunca vale la pena tumbar el pipeline por un ffprobe.
        return 0.0


def _write_block_proposals(
    video_id: str, duration: float, max_clips: int = 7, clip_seconds: float = 50.0
) -> Path:
    """Modo CLIPS RÁPIDOS: genera bloques uniformes de ~50s repartidos por el video,
    usando SOLO la duración (ffprobe) — sin transcribir los 80 min. Cada bloque se
    transcribe después por separado, ya cortado, en extract_clips.

    Mismo criterio de espaciado que heuristic_fallback de analyze_clips.
    """
    clips: list[dict] = []
    if duration >= 30:
        spacing = max(clip_seconds + 10, duration / max(1, max_clips))
        n = min(max_clips, max(1, int((duration - clip_seconds) / spacing) + 1))
        for i in range(n):
            start = i * spacing
            end = min(start + clip_seconds, duration)
            if end - start < 25:
                continue
            clips.append({
                "index": i + 1,
                "start": round(start, 2),
                "end": round(end, 2),
                "slug": f"segmento-{i + 1:02d}",
                "hook": f"Segmento {i + 1}",
                "theme": f"Segmento {i + 1} del video",
                "keywords": [],
                "caption": "",
                "hashtags": [],
            })
    proposal = {
        "video_id": video_id,
        "model": "heuristic-blocks",
        "transcript_duration": duration,
        "fallback_heuristic": True,
        "clips": clips,
    }
    out = LF_PROPOSALS / f"{video_id}.json"
    out.write_text(json.dumps(proposal, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def run_capture(cmd: list[str], cwd: Path | None = None) -> str:
    # Mismo motivo que `run`: techo finito en vez de espera infinita.
    proc = _proc.run_capture(cmd, cwd=cwd, check=True)
    return proc.stdout


def _whisper_rank(name: str) -> int:
    """Orden de calidad de modelos Whisper para avisar cuando un transcript cacheado
    es de un modelo PEOR que el actual (small < medium < large)."""
    n = (name or "").lower()
    if "large" in n:
        return 4
    if "medium" in n:
        return 3
    if "small" in n:
        return 2
    return 1  # base/tiny/desconocido


def step_transcribe(video_path: Path, video_id: str, chunked: bool = False) -> Path:
    out = LF_TRANSCRIPTS / f"{video_id}.json"
    if out.exists():
        # Aviso de fidelidad: el pipeline NO re-transcribe si ya existe (re-transcribir
        # desincronizaría clips/proyectos ya derivados). Pero si el transcript cacheado es
        # de un modelo MENOS preciso que el actual (ej. small viejo y ahora large-v3),
        # avisamos cómo forzar el upgrade.
        try:
            cached_model = json.loads(out.read_text(encoding="utf-8")).get("model", "?")
        except Exception:  # noqa: BLE001
            cached_model = "?"
        try:
            from config import WHISPER_MODEL as _cur_model
        except Exception:  # noqa: BLE001
            _cur_model = ""
        if _cur_model and _whisper_rank(cached_model) < _whisper_rank(_cur_model):
            print(
                f"[transcribe] AVISO: reusando transcript de modelo '{cached_model}'; el "
                f"actual '{_cur_model}' es MÁS preciso. Para re-transcribir con el mejor "
                f"modelo, borrá {out} y los derivados ({video_id} en cuts/proposals/clips) "
                f"y re-procesá el video.",
                file=sys.stderr,
            )
        else:
            print(f"[skip] transcribe (existe {out}, modelo {cached_model})", file=sys.stderr)
        return out
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "transcribe.py"),
        str(video_path),
        "--out", str(out),
    ]
    if chunked:
        # Video largo: ventanas a nivel frase (sin align) para no reventar memoria.
        cmd.append("--chunked")
    run(cmd)
    return out


# LAS TRES ETAPAS QUE YA NO ESTAN
#
# Aca vivian `step_detect`, `step_cut` y `step_re_transcribe_clean`: recortaban
# silencios y muletillas del video ENTERO antes de sacar los clips. Nadie las
# llamaba, y una auditoria de 2026-08-24 lo archivo como "falta cablearlas"
# (hallazgo #46). Era la lectura equivocada.
#
# Al quitar trozos del video completo, TODOS los tiempos se desplazan, asi que
# obligaban a transcribir la hora entera por segunda vez. Para una clase de 99
# minutos son ~9.5 min de transcripcion extra mas recodificar 1.6 GB — casi el
# doble de pipeline, para un material del que se publican ~20 minutos.
#
# El recorte se movio a `extract_clips._recortar_silencios_del_clip`, que
# procesa solo los 30-60s que de verdad se publican, y esta ENCENDIDO por
# omision (`--sin-recorte-silencios` lo apaga). Medido hoy sobre 60s de un curso
# real: 4 silencios, 2.7s quitados, 60.1s -> 55.5s.
#
# Se borran porque codigo muerto que ALGUIEN YA CONFUNDIO con una carencia hace
# perder tiempo dos veces: una al creer que falta, otra al comprobar que no.


def step_analyze(
    video_id: str,
    model: str | None = None,
    use_heuristic: bool = False,
    max_clips: int = 15,
) -> Path:
    out = LF_PROPOSALS / f"{video_id}.json"
    if out.exists():
        # No alcanza con que el archivo EXISTA: las propuestas se derivan del
        # transcript, así que si el transcript se rehízo, las de antes hablan de
        # un texto que ya no es el vigente. Pasó de verdad al mover la
        # transcripción a la GPU: el modelo saltó de `small` a `large-v3`, el
        # texto mejoró, y los clips se seguían eligiendo con el análisis viejo —
        # sin ningún aviso, porque un archivo presente parece trabajo hecho.
        #
        # Comparar fechas es suficiente y no cuesta nada. Ante la duda (no se
        # puede leer alguna fecha) se reusa, que es el comportamiento de antes.
        transcript = LF_TRANSCRIPTS / f"{video_id}.json"
        try:
            quedo_viejo = (
                transcript.exists()
                and transcript.stat().st_mtime > out.stat().st_mtime
            )
        except OSError:
            quedo_viejo = False
        if quedo_viejo:
            print(
                f"[analyze] el transcript es más nuevo que las propuestas: se rehacen "
                f"(si no, se elegirían los clips con el texto anterior)",
                file=sys.stderr,
            )
        else:
            print(f"[skip] analyze_clips (existe {out})", file=sys.stderr)
            return out
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "analyze_clips.py"),
        video_id,
        "--max-clips", str(max_clips),
    ]
    if model:
        cmd.extend(["--model", model])
    if use_heuristic:
        cmd.append("--use-heuristic")
    run(cmd)
    return out


def step_score_virality(video_id: str, proposals_path: Path) -> None:
    """Virality Score (0-100) por clip. Lee las propuestas + el transcript y reescribe
    cada clip con viralityScore/reasons/factors, reordenando de más a menos viral.
    Best-effort: si falla, las propuestas quedan sin score (no rompe el job)."""
    try:
        import virality
        tp = LF_TRANSCRIPTS / f"{video_id}.json"
        res = virality.score_proposals_file(proposals_path, tp)
        print(f"[virality] {res}", file=sys.stderr)
    except Exception as e:
        print(f"[virality] no pude scorear (sigo sin score): {e}", file=sys.stderr)


def _ollama_explain(text: str, model: str | None = None, timeout: float = 20.0) -> str | None:
    """UNA llamada corta a Ollama local para explicar por qué un clip puede pegar.

    Devuelve el texto (2 frases) o None si Ollama no responde / tarda más de
    `timeout` segundos — el caller skipea SILENCIOSO, sin error ni campo.
    """
    import urllib.request

    try:
        from config import OLLAMA_MODEL, OLLAMA_URL
    except ImportError:
        return None
    prompt = (
        "En 2 frases: por qué este clip puede pegar en redes y qué título le pondrías. "
        f"Texto del clip: {text}"
    )
    payload = json.dumps({
        "model": model or OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        # #12-largos: paridad con analyze_clips._ollama_request.
        # think:false apaga el razonamiento de qwen3 (~1.5-2x más rápido); aquí no
        # usamos format:"json" porque la respuesta es texto libre (2 frases).
        "think": False,
        # keep_alive mantiene el modelo en RAM entre clips para no pagar la recarga.
        "keep_alive": "10m",
        "options": {"temperature": 0.4, "num_predict": 140},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        out = str(data.get("response", "")).strip()
        return out or None
    except Exception:
        # Ollama apagado, modelo no descargado o timeout: skip silencioso.
        return None


def step_explain_virality(
    video_id: str, proposals_path: Path, model: str | None = None, top_n: int = 15
) -> None:
    """Explicación humana del score: "whyViral" por clip vía Ollama local.

    Solo los primeros `top_n` clips por viralityScore. Best-effort total: si
    Ollama no está o un clip tarda >20s, ese clip queda SIN el campo y seguimos.
    Tras 2 fallos seguidos asumimos que Ollama no está y dejamos de intentar.
    """
    try:
        proposals = json.loads(proposals_path.read_text(encoding="utf-8"))
        clips = proposals.get("clips") if isinstance(proposals, dict) else proposals
        if not isinstance(clips, list) or not clips:
            return
        words: list[dict] = []
        tp = LF_TRANSCRIPTS / f"{video_id}.json"
        if tp.exists():
            words = json.loads(tp.read_text(encoding="utf-8")).get("words", [])
        if not words:
            return  # sin transcript (p.ej. modo clips rápidos) no hay texto que explicar

        ranked = sorted(clips, key=lambda c: -int(c.get("viralityScore", 0) or 0))[:top_n]
        explained = 0
        consecutive_fails = 0
        for c in ranked:
            if c.get("whyViral"):
                continue  # ya explicado (re-corrida)
            try:
                start = float(c.get("start", 0))
                end = float(c.get("end", start + 30))
            except (ValueError, TypeError):
                continue
            seg = [w for w in words if start - 0.2 <= float(w.get("start", 0)) <= end + 0.2]
            text = " ".join(str(w.get("word", "")) for w in seg).strip()
            if len(text) < 40:
                continue  # muy poco texto, no vale la llamada
            why = _ollama_explain(text[:1500], model=model)
            if why:
                c["whyViral"] = why
                explained += 1
                consecutive_fails = 0
            else:
                consecutive_fails += 1
                if consecutive_fails >= 2:
                    break  # Ollama no está respondiendo: no quemamos 20s × clip
        if explained:
            out_obj = proposals if isinstance(proposals, dict) else clips
            proposals_path.write_text(
                json.dumps(out_obj, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"[whyViral] {explained} clips explicados con IA local", file=sys.stderr)
    except Exception:
        # Best-effort: cualquier falla aquí NO rompe el job ni mete ruido.
        pass


def step_graphics(clip_id: str, use_llm: bool = True, illustrations: bool = False,
                  density: float = 1.0) -> None:
    """Modo Gráficos: genera charts + titulares (+ ilustraciones CC0 opt-in) para un
    clip (best-effort, no rompe el job). illustrations=True cuando algún estilo pedido
    tiene illustrations:true (editorial*/lottie_pop) → emite illustrationStickers.
    density >1 = más gráficos/ilustraciones (los reels de Mejores Momentos se ven cargados)."""
    cmd = [str(VENV_PYTHON), str(PYTHON_DIR / "generate_graphics.py"), clip_id]
    if not use_llm:
        cmd.append("--no-llm")
    if illustrations:
        cmd.append("--illustrations")
    if density and density != 1.0:
        cmd += ["--density", str(density)]
    try:
        run(cmd)
    except subprocess.CalledProcessError as e:
        print(f"[graphics] falló para {clip_id} (sigo sin gráficos): {e}", file=sys.stderr)


def step_extract(
    video_id: str,
    aspect_ratio: str = "9:16",
    face_tracking: str = "off",
    clips: str | None = None,
    recortar_silencios: bool = True,
) -> list[dict]:
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "extract_clips.py"),
        video_id,
        "--aspect-ratio",
        aspect_ratio,
        "--face-tracking",
        face_tracking,
    ]
    # Quitar silencios y muletillas DENTRO de cada clip. Va por defecto porque es
    # lo que el proyecto promete y no hacía: las tres etapas que existían para
    # esto (detect/cut/re-transcribe) nunca se llamaban, así que los clips salían
    # del crudo. Se hace por clip y no sobre el video entero — ver la nota en
    # `_recortar_silencios_del_clip`. Medido en material real: entre 4% y 18% de
    # cada clip era silencio.
    if recortar_silencios:
        cmd.append("--recortar-silencios")
    # Subset aprobado (flujo REVISAR): posiciones 0-based separadas por coma.
    if clips:
        cmd.extend(["--clips", clips])
    output = run_capture(cmd)
    # extract_clips imprime al final un JSON con la lista
    last_line = output.strip().split("\n")[-1]
    try:
        data = json.loads(last_line)
        return [c for c in data.get("clips", []) if c.get("ok")]
    except json.JSONDecodeError:
        return []


# Estilos de largos que ILUSTRAN con videos de archivo (b-roll).
# Estilos que TRAEN material de archivo por su cuenta: es su rasgo definitorio.
_BROLL_STYLES = {"editorial_broll", "broll_full", "broll_pip"}

# Estilos que PUEDEN mostrarlo, aunque no lo busquen solos. El composition dibuja
# B-roll para cualquiera con `editorialLayout` —los cuatro editoriales— y esta
# lista era la QUINTA copia de lo mismo en el proyecto:
#
#   1. BROLL_STYLE_IDS          el selector del wizard
#   2. BROLL_CAPABLE_STYLE_IDS  lo que el composition sabe dibujar
#   3. una copia a mano en auto-build/route.ts (el camino de cortos)
#   4. `editorialLayout && bRoll.map()` en el propio composition
#   5. esta, que decide el camino de LARGOS
#
# Arreglar las cuatro primeras no alcanzaba: con esta sin tocar, elegir "Videos"
# en `editorial` desde el wizard de largos habria pasado `--broll-source` para
# que `_apply_broll` lo descartara igual. El selector prometia y no cumplia.
_BROLL_CAPABLES = _BROLL_STYLES | {"editorial", "editorial_full", "paper_cut"}


def _apply_broll(clip_id: str, style_id: str, aspect_ratio: str,
                 fuente: str | None = None) -> None:
    """Para estilos de archivo: pide clips de b-roll al endpoint Next
    (/api/long_form/broll) y parchea project.bRoll. El endpoint busca en Pexels con
    orientación LANDSCAPE para 16:9 (portrait para 9:16); sin PEXELS_API_KEY cae a CC0.

    Antes los largos NUNCA poblaban b-roll (build-clip-supreme no lo hace), así que
    editorial_broll/broll_full/broll_pip renderizaban sin archivo. Esto lo cablea.

    Best-effort: si no hay endpoint/red/clips, deja bRoll vacío y el render sigue
    (idéntico a antes). El video de archivo se baja en build-clip-props (localize)."""
    # Se busca material si el estilo lo trae por naturaleza, O si quien edita
    # eligio una fuente a proposito en un estilo que sabe mostrarlo.
    eligio_fuente = bool(fuente and fuente != "auto")
    if style_id not in _BROLL_STYLES and not (
        eligio_fuente and style_id in _BROLL_CAPABLES
    ):
        return
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        if not project_path.exists():
            return
        api = os.environ.get("VIRAL_API_HOST") or "http://localhost:3000"
        cuerpo = {"clipId": clip_id, "aspectRatio": aspect_ratio}
        # Sin fuente elegida el endpoint decide como siempre. Se omite en vez de
        # mandar "auto" para que el comportamiento por defecto sea identico al
        # de antes, byte por byte.
        # Se acepta una fuente o varias separadas por coma. Se validan aca en vez
        # de con `choices` de argparse porque argparse compara el valor ENTERO
        # contra la lista, y "giphy,pexels_photo" no es ninguno de los cinco:
        # rechazaria una peticion valida con un error confuso.
        VALIDAS = {"auto", "pexels_video", "pexels_photo", "giphy", "cc0"}
        elegidas = [f.strip() for f in str(fuente or "").split(",") if f.strip()]
        desconocidas = [f for f in elegidas if f not in VALIDAS]
        if desconocidas:
            print(f"[broll] fuente(s) desconocida(s), se ignoran: {desconocidas}",
                  file=sys.stderr)
        elegidas = [f for f in elegidas if f in VALIDAS and f != "auto"]
        if elegidas:
            cuerpo["source"] = elegidas if len(elegidas) > 1 else elegidas[0]
        payload = json.dumps(cuerpo).encode("utf-8")
        req = urllib.request.Request(
            f"{api.rstrip('/')}/api/long_form/broll",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        print(f"[broll] buscando archivo ({aspect_ratio}) para {clip_id}…", file=sys.stderr, flush=True)
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        broll = data.get("bRoll") or []
        if not broll:
            print(f"[broll] sin clips para {clip_id} (source={data.get('source')})", file=sys.stderr)
            return
        proj = json.loads(project_path.read_text(encoding="utf-8"))
        proj["bRoll"] = broll
        _barridos_de_broll(proj)
        project_path.write_text(json.dumps(proj, indent=2), encoding="utf-8")
        print(
            f"[broll] {len(broll)} clips ({data.get('source')}/{data.get('orientation')}) "
            f"→ {clip_id}_{style_id}",
            file=sys.stderr,
        )
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[broll] skipped: {e}", file=sys.stderr)


def _posicion_del_broll(clip_id: str, style_id: str, posicion: str) -> None:
    """Guarda DONDE aparece el material de apoyo en el project del clip.

    El render ya decidia solo por la forma del material, y acertaba casi
    siempre. El problema es cuando se equivoca: un clip vertical de archivo SI
    encaja en un 9:16, asi que tapa el cuadro entero — y con el la cara de quien
    habla. No habia forma de decirle que no.

    Best-effort: si falla, el clip renderiza con el comportamiento de siempre.
    """
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        if not project_path.exists():
            return
        proj = json.loads(project_path.read_text(encoding="utf-8"))
        proj["bRollPosition"] = posicion
        project_path.write_text(json.dumps(proj, indent=2), encoding="utf-8")
        print(f"[broll] {clip_id}: material {posicion}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[broll] posicion skipped: {e}", file=sys.stderr)


def _barridos_de_broll(proj: dict) -> None:
    """Barridos de color en la entrada del B-roll a pantalla completa.

    Paridad con `applyBrollWipes` de fx-enrichments.ts — mismas reglas y mismos
    numeros, que es lo que verifica `barridos-de-broll.test.ts`:

      - solo en `fullscreen`: en `pip` el B-roll es una ventanita y el plano no
        corta, asi que no hay nada que barrer.
      - tres como maximo, sobre segmentos de 1.2s o mas. Quince barridos no se
        ven editados, se ven nerviosos.
      - un solo color, el acento del clip.
      - direccion alternada: tres barridos identicos se leen como un tic.
    """
    if proj.get("bRollMode") == "pip":
        return
    broll = proj.get("bRoll") or []
    if not broll:
        return
    CRUCE = 9
    DIRECCIONES = ["from-left", "from-right", "from-top", "from-bottom"]
    cortes = sorted(
        (
            b for b in broll
            if isinstance(b.get("start"), (int, float))
            and isinstance(b.get("end"), (int, float))
            and b["end"] - b["start"] >= 1.2
        ),
        key=lambda b: b["start"],
    )[:3]
    if not cortes:
        return
    acento = proj.get("accentColor") or "#0a0a0a"
    proj["proTransitionSeries"] = (proj.get("proTransitionSeries") or []) + [
        {
            "at": round(float(b["start"]), 2),
            "durationFrames": CRUCE,
            "kind": "wipe",
            "direction": DIRECCIONES[i % len(DIRECCIONES)],
            "color": acento,
            "colorTo": acento,
        }
        for i, b in enumerate(cortes)
    ]


def _blaze_trackpath(clip_video: Path) -> list[dict]:
    """Detección de cara per-frame con BlazeFace (face_tracking.py) → trackPath
    [{t,x,y,w,h}] en coords normalizadas. Más fiable que el Haar de track_subject
    para encuadrar la CABEZA (no confunde manos/torso). Best-effort: [] si falla."""
    out_json = clip_video.with_name(f"{clip_video.stem}_blaze.json")
    try:
        subprocess.run(
            [
                str(VENV_PYTHON), str(PYTHON_DIR / "face_tracking.py"),
                str(clip_video), str(out_json), "--sample-every", "5",
            ],
            check=False, cwd=PYTHON_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
        )
        d = json.loads(out_json.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return []
    return [
        {"t": s["t"], "x": s["cx"], "y": s["cy"], "w": s.get("w", 0.0), "h": s.get("h", 0.0)}
        for s in d.get("samples", [])
        if "cx" in s and "cy" in s
    ]


def _apply_tracking(clip_id: str, style_id: str) -> None:
    """Si el estilo pide motion tracking (ej. `hype` setea tracking=true), corre
    track_subject.py sobre el clip y parchea project.trackPath ANTES de build-props.

    Sin esto, el estilo declara tracking/autoReframe pero el trackPath queda vacío y
    los labels que siguen la cara (y el reframe inteligente) no tienen a qué seguir.
    Paridad con applyTracking() del pipeline de shorts, pero operando sobre el clip ya
    extraído (LF_CLIPS) en vez del raw completo.

    Best-effort: si no hay clip, el estilo no pide tracking, o track_subject falla,
    se deja el project como está (trackPath vacío) y el render sigue.
    """
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        if not project_path.exists():
            return
        data = json.loads(project_path.read_text(encoding="utf-8"))
        # Corre tracking si el estilo lo pide (tracking=true) O si es EDITORIAL: el
        # panel lateral recorta el video y, sin trackPath, pierde al que habla.
        # ViralVideo usa el trackPath para mover objectPosition hacia la cara.
        if not data.get("tracking") and not data.get("editorialLayout"):
            return
        # Resolver el clip extraído (normalmente .mp4)
        clip_video = None
        for ext in (".mp4", ".mov", ".mkv", ".webm"):
            cand = LF_CLIPS / f"{clip_id}{ext}"
            if cand.exists():
                clip_video = cand
                break
        if clip_video is None:
            return
        print(f"[tracking] detectando cara en {clip_id}…", file=sys.stderr, flush=True)
        # EDITORIAL usa BlazeFace (face_tracking.py): mucho más fiable que el Haar de
        # track_subject, que confundía manos/torso con la cara y la ponía muy abajo →
        # el panel encuadraba el cuerpo y CORTABA la cabeza. Los estilos legacy con
        # tracking=true siguen en track_subject (paridad, sin cambios).
        use_blaze = bool(data.get("editorialLayout")) and not data.get("tracking")
        # SALIDA 16:9: el video se muestra en su aspecto original (sin recortar), así
        # que NO hace falta seguir la cara — y el seguimiento movía el panel de forma
        # brusca (mareaba). Solo trackeamos editorial en VERTICAL (9:16), donde el
        # panel sí recorta fuerte. (width >= height → horizontal → estable, sin track.)
        if use_blaze and (data.get("width") or 0) >= (data.get("height") or 0):
            print(f"[tracking] editorial 16:9 → video original, panel estable {clip_id}", file=sys.stderr)
            return
        if use_blaze:
            points = _blaze_trackpath(clip_video)
        else:
            # Los parametros de muestreo salen del hardware, no de un literal.
            #
            # `hw_profile` los calcula escalonados (0.33s en equipos potentes, 0.8s
            # en modestos; ancho de 400 o 480 px) y el flujo de SHORTS ya los lee.
            # Este los tenia clavados en "0.15" — mas fino incluso que el nivel
            # "potente"— sin importar la maquina. El propio docstring de
            # `track_subject.py` afirma que "el caller pasa sample_every/downscale_w
            # segun el hardware": cierto para shorts, falso aca.
            #
            # No rompia nada: 0.15 es mas preciso, solo mas lento. Pero en un equipo
            # modesto —justo el perfil que hw_profile identifica como necesitado de
            # muestreo mas ligero— el tracking de cada clip corria cinco veces mas
            # denso de lo que el propio sistema recomienda, y nadie lo notaba porque
            # no falla: tarda.
            try:
                _rec = __import__("hw_profile").detect().get("recommend", {})
                _muestreo = float(_rec.get("tracking_sample_sec") or 0) or 0.15
            except Exception:  # noqa: BLE001
                _muestreo = 0.15
            proc = subprocess.run(
                [str(VENV_PYTHON), str(PYTHON_DIR / "track_subject.py"),
                 str(clip_video), str(_muestreo)],
                check=False, cwd=PYTHON_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
            )
            line = next(
                (l for l in reversed(proc.stdout.splitlines()) if l.strip().startswith("{")),
                None,
            )
            points = ((json.loads(line) or {}).get("points") or []) if line else []
        if not points:
            return
        data["trackPath"] = points
        # F2 — subtítulos fuera de la cara (paridad con shorts): cara en zona baja
        # del frame → el subtítulo va arriba para no tapar al speaker.
        ys = [p.get("y") for p in points if isinstance(p.get("y"), (int, float))]
        if len(ys) > 3 and sum(ys) / len(ys) > 0.62:
            data["subtitlePosition"] = "top"
            print(f"[tracking] cara abajo → subtítulos ARRIBA ({clip_id})", file=sys.stderr)
        project_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"[tracking] {len(points)} puntos de cara → {clip_id}_{style_id}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[tracking] skipped: {e}", file=sys.stderr)


def _apply_callouts(clip_id: str, style_id: str) -> None:
    """Cifras que el hablante menciona, apareciendo cuando las dice.

    Paridad con `applyCallouts` de fx-enrichments.ts. `word_callouts.py` ya
    hacia esto entero —determinista por regex, sin IA, sin red— y NADIE lo
    ejecutaba: los dos builders de props reenviaban `statPops`/`lowerThirds` y
    el composition sabia dibujarlos, pero el array llegaba siempre vacio.

    Los clips de largos no llevan nombre/cargo (no hay de donde sacarlos en el
    pipeline), asi que aca solo salen las cifras. Sin `--name` el script
    devuelve `lowerThirds: []` y no se dibuja ninguna banda.

    Best-effort: si falla, el clip renderiza igual que antes.
    """
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        transcript_path = LF_TRANSCRIPTS / f"{clip_id}.json"
        if not project_path.exists() or not transcript_path.exists():
            return
        palabras = (json.loads(transcript_path.read_text(encoding="utf-8")).get("words") or [])
        if not palabras:
            return
        # El script lee de un ARCHIVO: un transcript largo no entra en un
        # argumento de linea de comandos en Windows.
        tmp = LF_PROJECTS / f"_{clip_id}.words.json"
        tmp.write_text(json.dumps(palabras, ensure_ascii=False), encoding="utf-8")
        try:
            # `check=False` a proposito: si el script falla, este enriquecedor
            # se salta y el clip renderiza igual. Con el default (`check=True`)
            # levantaria una excepcion y el `if r.returncode` de abajo seria
            # codigo muerto.
            r = _proc.run_capture(
                [sys.executable, str(PYTHON_DIR / "word_callouts.py"), "--words", str(tmp)],
                cwd=str(PYTHON_DIR), timeout=60, check=False,
            )
        finally:
            tmp.unlink(missing_ok=True)
        if r.returncode != 0:
            return
        linea = [l for l in (r.stdout or "").splitlines() if l.strip().startswith("{")]
        if not linea:
            return
        datos = json.loads(linea[-1])
        pops = datos.get("statPops") or []
        if not pops:
            return
        proj = json.loads(project_path.read_text(encoding="utf-8"))
        proj["statPops"] = (proj.get("statPops") or []) + pops
        project_path.write_text(json.dumps(proj, indent=2), encoding="utf-8")
        print(f"[callouts] {clip_id}: {len(pops)} cifras", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[callouts] skipped: {e}", file=sys.stderr)


def _apply_emotion(clip_id: str, style_id: str) -> None:
    """F1 — Director emocional sobre el clip (paridad con applyEmotionDirector de
    shorts): corre emotion_director.py y parchea el project JSON con:
      - musicVolumeCurve (auto-ducking de la música cuando hay voz)
      - reactionZooms extra en los picos emocionales (solo estilos dinámicos)
      - volumen de cada SFX modulado por el arousal local
      - mood global (para selección de música futura)
    Best-effort: si falla, el clip renderiza igual que antes.
    """
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        if not project_path.exists():
            return
        clip_video = None
        for ext in (".mp4", ".mov", ".mkv", ".webm"):
            cand = LF_CLIPS / f"{clip_id}{ext}"
            if cand.exists():
                clip_video = cand
                break
        if clip_video is None:
            return
        transcript = LF_TRANSCRIPTS / f"{clip_id}.json"
        proc = subprocess.run(
            [
                str(VENV_PYTHON), str(PYTHON_DIR / "emotion_director.py"),
                str(clip_video), "--transcript", str(transcript),
            ],
            check=False, cwd=PYTHON_DIR, capture_output=True, text=True,
            timeout=120, encoding="utf-8", errors="replace",
        )
        line = next(
            (l for l in reversed(proc.stdout.splitlines()) if l.strip().startswith("{")),
            None,
        )
        if not line:
            return
        e = json.loads(line)
        if not e.get("ok"):
            return
        data = json.loads(project_path.read_text(encoding="utf-8"))
        data["mood"] = e.get("mood")
        if data.get("musicTrack") and len(e.get("ducking") or []) > 1:
            data["musicVolumeCurve"] = e["ducking"]
        existing_rz = data.get("reactionZooms") or []
        existing_zm = data.get("zoomMarks") or []
        is_dynamic = bool(existing_zm) or bool(existing_rz)
        if is_dynamic:
            peaks = e.get("peaks") or []
            added = [
                {"at": p["t"], "intensity": 1.35, "duration": 0.25}
                for p in peaks
                if p.get("score", 0) >= 0.55
                and not any(abs(z.get("at", -99) - p["t"]) < 2.5 for z in existing_rz)
            ][:3]
            if added:
                data["reactionZooms"] = existing_rz + added
            # Micro punch-ins (paridad con shorts): zoom sutil 8% en picos moderados.
            micro = [
                {"at": p["t"], "duration": 0.5, "scale": 1.08}
                for p in peaks
                if 0.35 <= p.get("score", 0) < 0.55
                and not any(abs(z.get("at", -99) - p["t"]) < 2.0 for z in existing_zm)
            ]
            if micro:
                data["zoomMarks"] = existing_zm + micro
            # F3 — partículas en el pico emocional máximo (paridad con shorts).
            #
            # La partícula depende del TONO: "tension" es alto arousal con
            # valencia negativa, y tirarle confeti a un remate sobre algo que
            # sale mal lee como burla. Brasas, no fiesta.
            top = max(peaks, key=lambda p: p.get("score", 0), default=None)
            if top and top.get("score", 0) >= 0.6:
                mood = e.get("mood")
                particula = "confetti" if mood == "hype" else "embers" if mood == "tension" else "sparks"
                # UN SOLO COLOR. Sin `colors` la capa cae a su paleta por
                # omisión, que son CINCO colores distintos y cada partícula toma
                # uno: el "chile mole y pozole" que la regla mono-color prohíbe.
                # Pasaba en todo clip con un pico >= 0.6. `embers` lo ignora a
                # propósito (usa naranjas de brasa fijos).
                acento = data.get("accentColor") or data.get("accent")
                burst = {"at": top["t"], "duration": 1.6, "kind": particula, "count": 60}
                if acento:
                    burst["colors"] = [acento]
                data["particleBursts"] = (data.get("particleBursts") or []) + [burst]
        project_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(
            f"[emotion] {clip_id}: mood={e.get('mood')} · {len(e.get('peaks') or [])} picos",
            file=sys.stderr,
        )
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[emotion] skipped: {e}", file=sys.stderr)


# Mastering de audio — MISMOS filtros que el SUPREME de shorts (no cambian).
_AUDIO_MASTER_FILTER = (
    "acompressor=threshold=-18dB:ratio=3:attack=20:release=200,"
    "alimiter=level_in=1:level_out=0.95:limit=0.95,"
    "highpass=f=80,"
    "equalizer=f=3000:t=q:w=1:g=2"
)


def _post_fx_lut_step(rendered: Path, lut_name: str) -> bool:
    """PASO LUT original (re-encode de video con lut3d). Devuelve True si re-encodeó.

    Se conserva INTACTO como fallback del camino fusionado (#9).
    """
    graded = rendered.with_name(rendered.stem + "_graded.mp4")
    # Log ANTES de arrancar: el lut3d re-encodea todo el clip y tarda 1-2 min
    # en silencio. Sin este aviso el panel de progreso parece congelado.
    print(
        f"[post-fx] aplicando color grade ({lut_name})… re-encode del clip, ~1-2 min",
        file=sys.stderr, flush=True,
    )
    # Ruta relativa con forward-slashes (cwd=REMOTION_DIR) para evitar el
    # escaping del ":" de la unidad de Windows dentro del filtergraph.
    # Encoder adaptativo: NVENC en GPU NVIDIA (3-8x), libx264 si no.
    # CONSERVADOR: lleva -vf lut3d (filtro CPU) → NO inyectamos decode
    # hwaccel (input_path=None); solo adaptamos el ENCODER. safe_ffmpeg
    # cae a libx264 si el NVENC falla en runtime.
    ff = ffmpeg_full_args(input_path=None, quality="final")
    _res = safe_ffmpeg(
        [
            str(FFMPEG_PATH), "-y",
            "-i", str(rendered),
            "-vf", f"lut3d=public/luts/{lut_name}",
            "-c:a", "copy",
            *ff["video_args"],
            "-pix_fmt", "yuv420p",
            str(graded),
        ],
        input_path=str(rendered),
        cwd=REMOTION_DIR, timeout=240,
    )
    if _res.returncode != 0:
        raise subprocess.CalledProcessError(
            _res.returncode, "ffmpeg lut3d", _res.stdout, _res.stderr
        )
    graded.replace(rendered)
    print(f"[post-fx] LUT aplicado ({lut_name}): {rendered.name}", file=sys.stderr)
    return True


def _post_fx_audio_step(rendered: Path) -> None:
    """PASO de mastering de audio original (copia video, re-encodea solo audio).

    Se conserva INTACTO como fallback del camino fusionado (#9).
    """
    mastered = rendered.with_name(rendered.stem + "_mastered.mp4")
    print("[post-fx] masterizando audio…", file=sys.stderr, flush=True)
    subprocess.run(
        [
            str(FFMPEG_PATH), "-y",
            "-i", str(rendered),
            "-af", _AUDIO_MASTER_FILTER,
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            str(mastered),
        ],
        check=True, cwd=REMOTION_DIR, timeout=120,
    )
    mastered.replace(rendered)
    print(f"[post-fx] audio mastered: {rendered.name}", file=sys.stderr)


def _post_fx_two_pass(rendered: Path, lut_name: str | None) -> bool:
    """Camino ORIGINAL en 2 pasadas (fallback de la fusión #9). Cada paso es
    independiente y opcional; best-effort por paso (no rompe el clip)."""
    video_reencoded = False
    if lut_name:
        try:
            video_reencoded = _post_fx_lut_step(rendered, lut_name)
        except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
            print(f"[post-fx] LUT skipped: {e}", file=sys.stderr)
    try:
        _post_fx_audio_step(rendered)
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[post-fx] audio mastering skipped: {e}", file=sys.stderr)
    return video_reencoded


def _apply_post_fx(rendered: Path, clip_id: str, style_id: str) -> bool:
    """Post-procesa el render con ffmpeg, en paridad con el pipeline de shorts:

      1. LUT 3D color grade — lee `lut` del project JSON (todos los estilos setean uno:
         kodak_warm / teal_orange / vintage_film / cyberpunk) y aplica lut3d. Sin esto,
         los clips largos salían SIN el grade que el mismo estilo tiene en shorts.
      2. Audio mastering — compresor + limiter + highpass + EQ de voz. Los largos son
         contenido hablado (cursos/charlas), así que el master mejora la claridad en
         todos los estilos (en shorts solo corría para cinematic_pro).

    #9 VELOCIDAD: cuando hay LUT, se intenta FUSIONAR el grade de video + el master
    de audio en UNA sola pasada de ffmpeg (-vf lut3d + -af <master> + re-encode de
    ambos), evitando una segunda pasada que re-leía/re-escribía el archivo entero.
    FALLBACK obligatorio: si el comando fusionado falla, se cae a las 2 pasadas
    originales (intactas), que se conservan como _post_fx_two_pass. Cada filtro
    sigue siendo opcional: sin LUT no se mete lut3d (y sin LUT no hay nada que
    fusionar → va directo al paso de audio en una pasada como siempre).

    Best-effort: si todo falla, se conserva el render tal cual y el clip NO se da
    por fallido.

    Devuelve True si el video fue re-encodeado (con el encoder adaptativo de
    hw_profile, NVENC cuando hay GPU). El caller usa esto para NO volver a
    re-encodear el video en el post-encode NVENC (sería redundante): si hubo LUT,
    el video salió del encoder por hardware; si no, sigue siendo el x264 de Remotion
    y el post-encode aporta la aceleración.
    """
    # Leer el nombre del .cube del project JSON que escribió build-clip-supreme.
    lut_name: str | None = None
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        if project_path.exists():
            data = json.loads(project_path.read_text(encoding="utf-8"))
            lut_name = data.get("lut")
    except Exception as e:  # noqa: BLE001
        print(f"[post-fx] no pude leer el project ({e}); sigo sin LUT", file=sys.stderr)
        lut_name = None

    # LUT declarado pero el .cube no existe → no fusionamos el video, solo audio.
    if lut_name:
        lut_file = REMOTION_DIR / "public" / "luts" / lut_name
        if not lut_file.exists():
            print(f"[post-fx] LUT no encontrado, se salta: {lut_name}", file=sys.stderr)
            lut_name = None

    # ── Sin LUT: nada que fusionar, una sola pasada de audio (igual que antes). ──
    if not lut_name:
        try:
            _post_fx_audio_step(rendered)
        except Exception as e:  # noqa: BLE001
            print(f"[post-fx] audio mastering skipped: {e}", file=sys.stderr)
        return False

    # ── Con LUT: intentar la pasada FUSIONADA (video lut3d + audio master). ──
    try:
        fused = rendered.with_name(rendered.stem + "_fxfused.mp4")
        print(
            f"[post-fx] grade ({lut_name}) + master de audio en UNA pasada… ~1-2 min",
            file=sys.stderr, flush=True,
        )
        # Mismo encoder adaptativo + pix_fmt que el paso LUT original; el audio se
        # re-encodea a AAC con EXACTAMENTE los mismos filtros de mastering. No se
        # toca el timing (sin -ss/-itsoffset/-shortest): el sync de A/V queda igual.
        ff = ffmpeg_full_args(input_path=None, quality="final")
        _res = safe_ffmpeg(
            [
                str(FFMPEG_PATH), "-y",
                "-i", str(rendered),
                "-vf", f"lut3d=public/luts/{lut_name}",
                "-af", _AUDIO_MASTER_FILTER,
                *ff["video_args"],
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                str(fused),
            ],
            input_path=str(rendered),
            cwd=REMOTION_DIR, timeout=300,
        )
        if _res.returncode != 0:
            raise subprocess.CalledProcessError(
                _res.returncode, "ffmpeg lut3d+master", _res.stdout, _res.stderr
            )
        fused.replace(rendered)
        print(
            f"[post-fx] grade + audio master fusionados: {rendered.name}",
            file=sys.stderr,
        )
        return True
    except Exception as e:  # noqa: BLE001 — fusión falló: caer a las 2 pasadas.
        print(
            f"[post-fx] pasada fusionada falló ({e}); fallback a 2 pasadas",
            file=sys.stderr,
        )
        # Limpiar el parcial si quedó a medias.
        try:
            rendered.with_name(rendered.stem + "_fxfused.mp4").unlink(missing_ok=True)
        except OSError:
            pass
        return _post_fx_two_pass(rendered, lut_name)


def step_render_clip(
    video_id: str,
    clip_index: int,
    slug: str,
    style_id: str = "supreme",
    accent_color: str | None = None,
    aspect_ratio: str = "9:16",
    remotion_concurrency: int = 0,
    subtitle_font: str | None = None,
    subtitle_color: str | None = None,
    editorial_theme: str | None = None,
    music_volume: float | None = None,
    render_pool=None,
    reframe: bool = True,
    broll_source: str | None = None,
    broll_position: str | None = None,
) -> Path:
    """Genera proyecto + props + render con Remotion para un (clip, style) específico.

    Output: long_form/renders/{clip_id}_{style_id}.mp4
    aspect_ratio: "9:16" vertical (default) o "16:9" horizontal.
    remotion_concurrency: workers internos de Remotion (0 = auto según workers del pool).
    render_pool: RenderPool de render-servers (OLA 3) — si se pasa y la instancia
        responde ok, el render NO re-bundlea webpack. None o cualquier fallo →
        FALLBACK por-clip al CLI directo (`_remotion_render_cmd`), idéntico a antes.
    """
    if remotion_concurrency <= 0:
        remotion_concurrency = _remotion_concurrency(_render_workers())
    clip_id = f"{video_id}_c{clip_index:02d}_{slug}"
    # 1) build project JSON con el estilo elegido + aspect ratio
    #    Si pasamos aspect pero no accent, le metemos accent vacío para preservar el orden de args
    build_args = [
        "node",
        str(REMOTION_DIR / "build-clip-supreme.mjs"),
        video_id,
        str(clip_index),
        style_id,
        accent_color or "",
        aspect_ratio,
        # Fuente + color de subtítulos elegidos en el wizard de largos ("" = del estilo).
        subtitle_font or "",
        subtitle_color or "",
        # Tema editorial "font:background" (solo lo usa el estilo editorial).
        editorial_theme or "",
        # Factor de volumen de música del wizard (0..1; "" = sin override → el del estilo).
        ("" if music_volume is None else str(music_volume)),
    ]
    run(build_args, cwd=REMOTION_DIR)
    # 1.5) motion tracking opt-in (estilos que lo declaran, ej. hype): parchea trackPath
    #      sobre el clip antes de armar los props. Best-effort.
    #      reframe=False (Mejores Momentos): el montage YA está ensamblado del source;
    #      correr track_subject sobre un video multi-panel/multi-segmento produce un
    #      trackPath erráticio que activa autoReframe y PANEA el video fuera del frame
    #      (barras negras). Sin tracking → trackPath vacío → objectFit:cover centrado.
    if reframe:
        _apply_tracking(clip_id, style_id)
    # 1.55) B-ROLL de archivo (editorial_broll/broll_full/broll_pip): busca clips en
    #       Pexels (landscape para 16:9) y parchea project.bRoll. Best-effort.
    _apply_broll(clip_id, style_id, aspect_ratio, fuente=broll_source)
    # Donde aparece ese material. Va DESPUES de _apply_broll porque escribe en
    # el mismo project.json: al reves, _apply_broll lo pisaria al releerlo.
    if broll_position and broll_position != "auto":
        _posicion_del_broll(clip_id, style_id, broll_position)
    # 1.6) F1 — director emocional: ducking de música + zooms en picos. Best-effort.
    _apply_emotion(clip_id, style_id)
    _apply_callouts(clip_id, style_id)
    # 2) build props — archivo ÚNICO por clip+estilo: con render paralelo, dos workers
    #    escribiendo "props.json" se pisarían (un clip renderizaría los props del otro).
    props_name = f"props_{clip_id}_{style_id}.json"
    run(
        ["node", str(REMOTION_DIR / "build-clip-props.mjs"), clip_id, style_id, props_name],
        cwd=REMOTION_DIR,
    )
    # 3) render — nombre incluye styleId para no pisar otros estilos del mismo clip
    out = LF_RENDERS / f"{clip_id}_{style_id}.mp4"
    props_path = REMOTION_DIR / props_name
    rendered_via_pool = False
    # 3a) OLA 3 — POOL de render-servers: bundle UNA vez por proceso, reusado para
    #     todos los clips. Si el pool atiende el render con ok, NOS SALTAMOS el CLI
    #     (que re-bundlea webpack). El .mp4 es idéntico: mismos props, codec h264,
    #     offthread cache, timeout y preset x264/crf del hw_profile. CUALQUIER fallo
    #     (instancia muerta, error de render) → FALLBACK por-clip al CLI directo.
    if render_pool is not None:
        try:
            timeout_ms = 120000
            rendered_via_pool = render_pool.render_clip(
                props_path, out, remotion_concurrency, timeout_ms
            )
            if rendered_via_pool:
                print(f"[render] {clip_id}: vía pool (sin re-bundle)", file=sys.stderr, flush=True)
            else:
                print(
                    f"[render] {clip_id}: pool no atendió → fallback CLI directo",
                    file=sys.stderr, flush=True,
                )
        except Exception as e:  # noqa: BLE001 — nunca rompe: cae al CLI directo
            print(f"[render] {clip_id}: pool error ({e}) → fallback CLI directo", file=sys.stderr)
            rendered_via_pool = False
    # #8: CLI de Remotion DIRECTO con node (sin npx) + #4/#5 preset x264. Si el CLI
    # directo no se resuelve, _remotion_render_cmd devuelve el comando con `npx`
    # (mismo comportamiento de antes). Si el render directo FALLA en runtime, caemos
    # a npx explícitamente como segunda red de seguridad.
    cmd = _remotion_render_cmd(out, remotion_concurrency, props_name)
    try:
        if not rendered_via_pool:
            used_direct = cmd[0] not in ("npx", "npx.cmd")
            try:
                run(cmd, cwd=REMOTION_DIR)
            except (subprocess.CalledProcessError, OSError) as e:
                if not used_direct:
                    raise  # ya era npx: no hay fallback adicional
                print(
                    f"[render] CLI directo falló ({e}); reintento con npx (fallback)",
                    file=sys.stderr, flush=True,
                )
                preset, _crf = _x264_recommend()
                npx = "npx.cmd" if sys.platform == "win32" else "npx"
                npx_cmd = [
                    npx, "remotion", "render", "src/index.ts", "ViralVideo", str(out),
                    "--concurrency", str(remotion_concurrency),
                    "--timeout=120000", _offthread_cache_flag(), f"--props={props_name}",
                ]
                if preset:
                    npx_cmd.append(f"--x264-preset={preset}")
                run(npx_cmd, cwd=REMOTION_DIR)
    finally:
        # limpiar el props temporal (best-effort)
        try:
            (REMOTION_DIR / props_name).unlink(missing_ok=True)
        except OSError:
            pass
    # 4) post-fx: LUT color grade + audio mastering (paridad con shorts). Best-effort.
    #    Devuelve si el paso de LUT ya re-encodeó el video con el encoder por hardware.
    video_reencoded = _apply_post_fx(out, clip_id, style_id)
    # 5) POST-ENCODE NVENC (OLA 1): Remotion encodea el MP4 en CPU x264 aunque haya
    #    GPU ociosa. Si el estilo NO traía LUT, el video sigue siendo ese x264 → lo
    #    re-encodeamos con NVENC (3-8× y calidad equivalente). Si SÍ hubo LUT, el
    #    video ya salió del encoder por hardware: no re-encodear de nuevo.
    #    post_encode es no-op (deja el archivo intacto) en máquinas sin GPU usable
    #    (encoder recomendado == libx264), así que esto NUNCA degrada un equipo CPU-only.
    if not video_reencoded:
        try:
            res = post_encode(out, quality="final")
            if res.get("reencoded"):
                print(f"[post-encode] {res.get('encoder')}: {out.name}", file=sys.stderr)
            elif not res.get("ok"):
                print(f"[post-encode] skipped: {res.get('error')}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
            print(f"[post-encode] skipped: {e}", file=sys.stderr)
    # 6) LOUDNESS -14 LUFS (estándar de todas las redes): el master de arriba comprime
    #    pero no fija loudness — los mixes salían a ~-21 LUFS y la red los subía
    #    amplificando ruido. 2-pass loudnorm SOLO del audio (-c:v copy, segundos).
    #    Best-effort: nunca rompe el clip.
    try:
        ln = normalize_loudness(out)
        if ln.get("normalized"):
            print(f"[loudnorm] {out.name}: {ln.get('measured_i')} → -14 LUFS", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[loudnorm] skipped: {e}", file=sys.stderr)
    return out


def _run_highlights(args, raw_path: Path, t_total: float) -> int:
    """MODO MEJORES MOMENTOS: transcribe → highlights.py (elige+ordena+arma el montage
    como clip sintético) → render supreme del montage → resumen. One-shot, UN render."""
    video_id = args.video_id
    # STEP 1 — transcribe (highlights.py necesita el transcript del raw). Header real
    # para la barra de progreso; los pasos 2-4 no aplican (no se recortan silencios).
    print("\n========== STEP 1: transcribe ==========", file=sys.stderr)
    if not args.skip_transcribe:
        step_transcribe(raw_path, video_id, chunked=True)
    for _skip in ("detect_silences", "cut_silences", "re-transcribe"):
        print(f"[skip] {_skip} (mejores momentos: se arma un montage del raw)", file=sys.stderr)

    # STEP 5 — selección + ensamblado del reel (highlights.py deja proposal sintética,
    # el montage en clips/ y su transcript). Reusa el header "analyze" del store.
    print("\n========== STEP 5: analyze (elegir los mejores momentos) ==========", file=sys.stderr)
    hl_cmd = [
        str(VENV_PYTHON), str(PYTHON_DIR / "highlights.py"), video_id,
        "--max-seconds", str(args.highlights_max_seconds),
        "--aspect-ratio", args.aspect_ratio,
        "--face-tracking", args.face_tracking,
    ]
    try:
        # check=False: el manejo de returncode ya está más abajo (lee r.stdout/stderr);
        # lo único que agregamos acá es el techo de tiempo.
        r = _proc.run_capture(hl_cmd, cwd=str(PYTHON_DIR), check=False)
    except Exception as e:  # noqa: BLE001
        print(f"[highlights] fallo al ejecutar highlights.py: {e}", file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e), "video_id": video_id}))
        return 1
    if r.stderr:
        print(r.stderr, file=sys.stderr)
    hl = None
    for line in reversed((r.stdout or "").splitlines()):
        if line.strip().startswith("{"):
            try:
                hl = json.loads(line)
                break
            except Exception:  # noqa: BLE001
                continue
    if not hl or not hl.get("ok"):
        err = (hl or {}).get("error", "no se pudo armar el reel de mejores momentos")
        print(json.dumps({"ok": False, "error": err, "video_id": video_id}))
        return 1
    synth_video = hl["synth_video"]  # {video_id}_highlights
    print(f"[highlights] {hl['moments']} momentos · {hl['seconds']}s · mood {hl.get('mood')}", file=sys.stderr)

    # STEP 7 — render supreme del clip sintético (subs+música+estilo+ducking unificados).
    print("\n========== STEP 7: render con Remotion ==========", file=sys.stderr)
    styles = [s.strip() for s in (args.styles or "supreme").split(",") if s.strip()] or ["supreme"]
    styles = [s for s in styles if s in VALID_STYLES] or ["supreme"]
    # Si algún estilo pedido necesita gráficos (editorial/graphics/motion/lottie…), generar
    # las TARJETAS editoriales/charts sobre el transcript del MONTAGE — si no, el reel
    # editorial sale con el panel de texto VACÍO (sin tarjetas ni ilustraciones).
    # build-clip-props las mergea desde graphics/{clip_id}.json. Best-effort (no rompe).
    highlights_clip_id = f"{synth_video}_c01_reel"
    if set(styles) & GRAPHICS_STYLES:
        step_graphics(
            highlights_clip_id,
            use_llm=not args.use_heuristic,
            illustrations=bool(set(styles) & ILLUSTRATION_STYLES),
            # Reel de Mejores Momentos: densidad ALTA de gráficos/ilustraciones para que
            # se vea cargado (más tarjetas + más ilustraciones + charts).
            density=1.8,
        )
    rc = _remotion_concurrency(_render_workers())
    rendered: list[str] = []
    for style_id in styles:
        try:
            out = step_render_clip(
                synth_video, 1, "reel",
                style_id=style_id,
                accent_color=args.accent_color,
                aspect_ratio=args.aspect_ratio,
                remotion_concurrency=rc,
                subtitle_font=args.subtitle_font,
                subtitle_color=args.subtitle_color,
                editorial_theme=args.editorial_theme,
                music_volume=args.music_volume,
                render_pool=None,
                # El montage ya está ensamblado: NO reencuadrar por cara (rompe el
                # framing de un video multi-panel → barras negras). cover centrado.
                reframe=False,
            )
            if out and Path(out).exists():
                rendered.append(str(out))
        except Exception as e:  # noqa: BLE001
            print(f"[highlights] render {style_id} falló: {e}", file=sys.stderr)

    ok = len(rendered) > 0
    print(f"\n[ok] mejores momentos en {time.time() - t_total:.1f}s", file=sys.stderr)
    print(json.dumps({
        "ok": ok,
        "video_id": video_id,
        "kind": "highlights",
        "clips": 1,
        "rendered": len(rendered),
        "render_tasks": len(styles),
        "seconds": hl.get("seconds"),
        "moments": hl.get("moments"),
        "renders": rendered,
    }, ensure_ascii=False))
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_id", help="ID del video largo (sin extensión, en long_form/raw/)")
    parser.add_argument("--model", help="Modelo Ollama (override)")
    parser.add_argument("--render", action="store_true", help="También renderizar cada clip con Remotion")
    parser.add_argument("--max-clips", type=int, default=None, help="Limitar cantidad de clips a renderizar")
    parser.add_argument("--skip-transcribe", action="store_true")
    parser.add_argument(
        "--broll-source",
        default=None,
        help=(
            "De donde salen las imagenes de apoyo en los estilos de archivo "
            "(editorial_broll / broll_full / broll_pip). Una fuente, o VARIAS "
            "separadas por coma: 'giphy,pexels_photo'. Con varias se alternan "
            "momento a momento — agrupadas se verian como dos videos pegados. "
            "Validas: auto, pexels_video, pexels_photo, giphy, cc0. Sin esto se "
            "decide como siempre, que es lo mismo que 'auto'."
        ),
    )
    parser.add_argument(
        "--broll-position",
        default=None,
        choices=["auto", "arriba", "abajo", "completa"],
        help=(
            "DONDE aparece ese material. 'auto' (default) lo decide la forma: "
            "si encaja en el lienzo lo tapa, si no se va a la banda de abajo. "
            "'abajo' NUNCA tapa la cara de quien habla, pase lo que pase. "
            "'arriba' para cuando la persona esta en la parte baja del cuadro. "
            "'completa' tapa siempre, aunque recorte."
        ),
    )
    parser.add_argument(
        "--use-heuristic",
        action="store_true",
        help="Skipear Ollama y usar clips uniformes (modo rápido, sin curaduría de IA)",
    )
    parser.add_argument(
        "--analyze-only",
        action="store_true",
        help=(
            "Flujo REVISAR (acto 1): corre solo hasta escribir el proposals JSON "
            "(transcripción + análisis + score + whyViral) y termina SIN extraer ni "
            "generar clips. Después el usuario aprueba/ajusta y se corre --from-proposals."
        ),
    )
    parser.add_argument(
        "--from-proposals",
        action="store_true",
        help=(
            "Flujo REVISAR (acto 2): salta el análisis, lee el proposals existente "
            "(con los ajustes del usuario) y SOLO extrae+genera. Combinar con --clips "
            "para limitar a los aprobados."
        ),
    )
    parser.add_argument(
        "--clips",
        default=None,
        help=(
            "Posiciones 0-based en el proposals JSON, separadas por coma (ej. '0,2,5'). "
            "Solo tiene sentido con --from-proposals. Sin flag = todos."
        ),
    )
    parser.add_argument(
        "--graphics",
        action="store_true",
        help="Modo Gráficos & Motion: genera charts + titulares poderosos por clip (auto desde el transcript)",
    )
    parser.add_argument(
        "--styles",
        default="supreme",
        help="Estilos de render separados por coma (silent,punch,hype,hype_max,hype_max_sfx,supreme,graphics_pro,graphics_max). Default: supreme",
    )
    parser.add_argument(
        "--accent-color",
        default=None,
        help="Color accent en hex (#fb7185). Si se omite, paleta rotativa por clipIndex",
    )
    parser.add_argument(
        "--subtitle-font",
        default=None,
        help="Fuente de subtítulos (bebas/anton/montserrat/…). 'auto' o vacío = la del estilo",
    )
    parser.add_argument(
        "--subtitle-color",
        default=None,
        help="Color del TEXTO de subtítulos en hex (#fde047). 'auto' o vacío = el del estilo",
    )
    parser.add_argument(
        "--editorial-theme",
        default=None,
        help="Tema del estilo editorial como 'font:background' (ej. playfair:dark). Solo aplica al estilo editorial",
    )
    parser.add_argument(
        "--music-volume",
        type=float,
        default=None,
        help="Factor 0..1 de volumen de música (multiplica el del estilo). Del slider del wizard; None = sin override.",
    )
    parser.add_argument(
        "--platforms",
        default=None,
        help="Plataformas destino separadas por coma (tiktok,instagram,linkedin). Solo informativo",
    )
    parser.add_argument(
        "--sin-recorte-silencios",
        action="store_true",
        help=(
            "No quitar silencios ni muletillas dentro de cada clip. El recorte va "
            "ACTIVADO por defecto: es lo que el proyecto prometía y no hacía. "
            "Usa esta bandera si querés el material tal cual se grabó."
        ),
    )
    parser.add_argument(
        "--aspect-ratio",
        choices=["9:16", "16:9"],
        default="9:16",
        help="Aspecto del output. 9:16 vertical (default) o 16:9 horizontal.",
    )
    parser.add_argument(
        "--face-tracking",
        choices=["off", "single", "per-frame"],
        default="off",
        help=(
            "Reframe siguiendo el rostro detectado al cambiar aspect ratio. "
            "off=center crop ciego (default). single=detección 1-frame. per-frame=preciso."
        ),
    )
    parser.add_argument(
        "--highlights",
        action="store_true",
        help=(
            "MODO MEJORES MOMENTOS: de UN video largo genera UN solo video de ≤3 min con "
            "los mejores momentos secuenciados por emoción (one-shot). Excluyente con "
            "--analyze-only / --from-proposals."
        ),
    )
    parser.add_argument(
        "--highlights-max-seconds",
        type=float,
        default=180.0,
        help="Tope de duración del reel de mejores momentos (default 180 = 3 min).",
    )
    args = parser.parse_args()

    if args.analyze_only and args.from_proposals:
        print("[error] --analyze-only y --from-proposals son excluyentes", file=sys.stderr)
        return 1
    if args.highlights and (args.analyze_only or args.from_proposals):
        print("[error] --highlights es excluyente con --analyze-only / --from-proposals", file=sys.stderr)
        return 1

    ensure_long_form_dirs()

    raw_path = LF_RAW / f"{args.video_id}.mp4"
    if not raw_path.exists():
        # Probar otras extensiones
        for ext in (".mov", ".mkv", ".webm"):
            alt = LF_RAW / f"{args.video_id}{ext}"
            if alt.exists():
                raw_path = alt
                break
    if not raw_path.exists():
        print(f"[error] no encontré {raw_path}", file=sys.stderr)
        return 1

    t_total = time.time()
    clean_path = None  # se setea solo en el modo completo (no en clips rápidos)

    # BITÁCORA: deja constancia de esta ejecución (tiempos por etapa, métricas de
    # calidad, entorno) en {DATA_ROOT}/logs/ejecuciones/. Antes solo quedaba el
    # `elapsed_min` total, así que era imposible saber dónde se fue el tiempo,
    # comparar dos corridas, o ver si un cambio mejoró algo. Se lee con
    # `python ver_bitacora.py`. Es best-effort: nunca rompe el pipeline.
    modo = ("highlights" if args.highlights else
            "from_proposals" if args.from_proposals else
            "heuristico" if args.use_heuristic else
            "analyze_only" if args.analyze_only else "completo")
    bit = Bitacora("largos", args.video_id, {
        "modo": modo,
        "max_clips": args.max_clips,
        "estilos": args.styles,
        "aspecto": args.aspect_ratio,
        "render": bool(args.render),
        "face_tracking": args.face_tracking,
        **({"modelo": args.model} if args.model else {}),
    })

    # ── MODO MEJORES MOMENTOS (highlights) — UN video ≤3 min de lo mejor, one-shot ──
    if args.highlights:
        return _run_highlights(args, raw_path, t_total)

    if args.from_proposals:
        # ── MODO GENERAR APROBADOS (flujo REVISAR, acto 2) ────────────────────
        # El análisis ya corrió antes (--analyze-only) y el usuario revisó/ajustó
        # los momentos en el wizard. NO se transcribe, NO se analiza, NO se re-scorea
        # (re-scorear reordenaría los clips y rompería las posiciones aprobadas):
        # se lee el proposals tal cual quedó y se va directo a extraer + generar.
        print("\n========== MODO GENERAR APROBADOS: usando los momentos ya revisados ==========", file=sys.stderr)
        proposals_path = LF_PROPOSALS / f"{args.video_id}.json"
        if not proposals_path.exists():
            print(
                f"[error] no hay momentos analizados para {args.video_id} — "
                "corre primero el análisis (--analyze-only)",
                file=sys.stderr,
            )
            return 1
        if args.clips:
            print(f"[approved] solo posiciones: {args.clips}", file=sys.stderr)
    elif args.use_heuristic:
        # ── MODO CLIPS RÁPIDOS ────────────────────────────────────────────────
        # No transcribimos NI recortamos silencios del video entero (en un video de
        # 80 min, transcribir+alinear de una sola vez revienta la memoria). En cambio:
        # duración por ffprobe → bloques uniformes de ~50s → se cortan del raw y se
        # transcribe CADA clip por separado (30-60s = liviano y seguro) en extract_clips.
        # Marcamos los pasos 1-5 como saltados para que la UI no quede en "pending".
        print("\n========== STEP 1-5 (modo clips rápidos): bloques por duración ==========", file=sys.stderr)
        skip_steps = ["transcribe", "detect_silences", "cut_silences", "re-transcribe"]
        if not args.analyze_only:
            skip_steps.append("analyze_clips")
        for _skip in skip_steps:
            print(f"[skip] {_skip} (modo clips rápidos)", file=sys.stderr)
        if args.analyze_only:
            # En análisis-solo el corte en bloques ES el análisis: header real para
            # que la barra de progreso muestre el paso "analyze" corriendo (no skipped).
            print("\n========== STEP 5: analyze (bloques por duración) ==========", file=sys.stderr)
        duration = _ffprobe_duration(raw_path)
        if duration <= 0:
            print("[error] no pude leer la duración del video (¿corrupto?)", file=sys.stderr)
            return 1
        max_clips = args.max_clips if args.max_clips else 12
        proposals_path = _write_block_proposals(args.video_id, duration, max_clips=max_clips)
        print(f"[fast] {duration / 60:.1f} min → bloques de ~50s", file=sys.stderr)
    else:
        # ── MODO INTELIGENTE (encuentra lo más viral) ─────────────────────────
        # Transcribimos el raw EN VENTANAS a nivel frase (sin la alineación que
        # reventaba la memoria en videos de 80-90 min). Con ese transcript completo,
        # Ollama LEE TODO y elige los momentos más virales (mínimo 15, más si hay).
        # NO recortamos silencios ni re-transcribimos el clean: los clips se cortan
        # directo del raw y cada uno se alinea por separado en extract_clips (karaoke).
        #
        # Step 1: transcribe del raw (en chunks)
        print("\n========== STEP 1: transcribe ==========", file=sys.stderr)
        with bit.etapa("transcribe") as _e:
            if args.skip_transcribe:
                _e.saltar("--skip-transcribe")
            else:
                _t = step_transcribe(raw_path, args.video_id, chunked=True)
                # Métricas de CALIDAD, no solo de tiempo: si las palabras por
                # minuto salen muy bajas, Whisper se saltó tramos en silencio.
                try:
                    _tj = json.loads(Path(_t).read_text(encoding="utf-8"))
                    _pal = len(_tj.get("words") or [])
                    _dur = float(_tj.get("duration") or 0)
                    _e.metrica("palabras", _pal)
                    _e.metrica("duracion_audio_min", round(_dur / 60, 1))
                    if _dur > 0:
                        _e.metrica("palabras_por_min", round(_pal / (_dur / 60), 1))
                    # Se mira el DATO, no la etiqueta. El campo `alignment` lo
                    # escribe quien genero el archivo y sobrevive a los cambios de
                    # criterio: un transcript con tiempos reales del modelo podia
                    # quedar marcado "segment" para siempre, y la bitacora repetia
                    # esa mentira. Es la misma comprobacion que usa extract_clips
                    # para decidir si re-transcribe.
                    try:
                        from extract_clips import transcript_es_por_palabra  # noqa: PLC0415

                        _alin = "word" if transcript_es_por_palabra(_tj) else "segment"
                        if _alin != _tj.get("alignment"):
                            _alin += f" (el archivo dice {_tj.get('alignment')!r})"
                    except Exception:  # noqa: BLE001
                        _alin = _tj.get("alignment")
                    _e.metrica("alineacion", _alin)
                    _e.metrica("modelo", _tj.get("model"))
                except Exception:
                    pass

        # Pasos 2-4 no aplican en modo inteligente: los marcamos saltados para que
        # la UI no quede en "pending" esperándolos.
        #
        # Estas tres etapas limpiaban el video ENTERO antes de cortar clips, y en
        # este modo no se usan: los clips salen del raw. La limpieza no se perdió,
        # se movió — ahora cada clip se recorta por su cuenta dentro de
        # extract_clips, que evita transcribir la hora completa dos veces.
        #
        # Este bloque decía "no implementado en el flujo", y era cierto cuando se
        # escribió: el recorte no existía en ninguna parte. Al implementarlo por
        # clip nadie volvió a tocar el mensaje, así que la bitácora siguió
        # informando una carencia ya resuelta. Un log que miente es peor que no
        # tenerlo, porque se usa para decidir qué arreglar: alguien podría
        # "arreglar" dos veces algo que ya funciona, o dar por rota una etapa sana.
        for _skip in ("detect_silences", "cut_silences", "re-transcribe"):
            print(f"[skip] {_skip} (modo inteligente: clips se cortan del raw)", file=sys.stderr)
        with bit.etapa("recorte_de_silencios") as _e:
            _e.saltar("se hace por clip dentro de extraer_clips, no sobre el video entero")

        # max_clips: mínimo 15, y más si el video es largo (~1 cada 5 min), tope 30.
        # Es un TECHO — Ollama propone solo los que realmente valen; si hay menos
        # momentos virales, saca menos.
        if args.max_clips:
            smart_max = args.max_clips
        else:
            dur_min = _ffprobe_duration(raw_path) / 60.0
            smart_max = max(15, min(30, int(dur_min / 5) + 1))
        print(f"[smart] objetivo: hasta {smart_max} clips virales", file=sys.stderr)

        # Step 5: analyze con Ollama
        print("\n========== STEP 5: analyze (Ollama) ==========", file=sys.stderr)
        with bit.etapa("analizar_clips") as _e:
            _e.metrica("techo_clips", smart_max)
            proposals_path = step_analyze(
                args.video_id, model=args.model,
                use_heuristic=args.use_heuristic, max_clips=smart_max,
            )
            # Las métricas que dicen si CORTÓ BIEN, no solo si fue rápido.
            try:
                _pj = json.loads(Path(proposals_path).read_text(encoding="utf-8"))
                _cl = _pj.get("clips") or []
                _e.metrica("clips", len(_cl))
                _e.metrica("proveedor", _pj.get("provider"))
                # Si el proveedor es heuristico, el modelo falló del todo y son
                # bloques uniformes: calidad muy inferior aunque no de error.
                _e.metrica("fallback_heuristico", bool(_pj.get("fallback_heuristic")))
                if _cl:
                    _durs = [round(float(c["end"]) - float(c["start"]), 1) for c in _cl
                             if c.get("end") is not None and c.get("start") is not None]
                    if _durs:
                        _e.metrica("duracion_min_s", min(_durs))
                        _e.metrica("duracion_max_s", max(_durs))
                        _e.metrica("duracion_media_s", round(sum(_durs) / len(_durs), 1))
                        # El prompt dice "jamás <30 ni >60"; el código tolera
                        # [25,60]. Contar los que se salen mide esa brecha.
                        _e.metrica("fuera_de_30_60", sum(1 for d in _durs if d < 30 or d > 60))
                    # Cuántos clips se anclaron de verdad al texto: si son pocos,
                    # el modelo no está citando el gancho literal y sube el riesgo
                    # de cortar a mitad de frase.
                    _anc = sum(1 for c in _cl if c.get("anchorScore"))
                    _e.metrica("anclados_al_texto", f"{_anc}/{len(_cl)}")

                    # ¿CIERRAN LA FRASE? Es la pregunta de calidad que más
                    # importa y hasta ahora nadie comprobaba: el anclaje intenta
                    # ajustar el final a un límite de frase, pero si no encuentra
                    # candidato usa el tiempo del modelo SIN AVISAR. Aquí se mide
                    # el resultado en vez de confiar: se mira la última palabra
                    # de cada clip y se acepta si termina en puntuación fuerte o
                    # si hay una pausa clara después. Un número bajo significa
                    # clips que se cortan a media idea.
                    try:
                        _tw = json.loads(
                            Path(LF_TRANSCRIPTS / f"{args.video_id}.json").read_text(encoding="utf-8")
                        ).get("words") or []
                        _cierran = 0
                        for c in _cl:
                            _fin = float(c["end"])
                            _dentro = [w for w in _tw if float(w.get("start", 0)) <= _fin]
                            if not _dentro:
                                continue
                            _ult = _dentro[-1]
                            _txt = str(_ult.get("word", "")).strip()
                            _sig = next((w for w in _tw
                                         if float(w.get("start", 0)) > float(_ult.get("end", 0))), None)
                            _pausa = (float(_sig["start"]) - float(_ult.get("end", 0))) if _sig else 99
                            if _txt.endswith((".", "!", "?", "…", ":", ";")) or _pausa >= 0.45:
                                _cierran += 1
                        _e.metrica("cierran_frase", f"{_cierran}/{len(_cl)}")
                    except Exception:
                        pass
                    # Cobertura: si todos los clips salen del primer tramo, el
                    # recorte cronológico se comió el final del video.
                    _st = sorted(float(c["start"]) for c in _cl if c.get("start") is not None)
                    if _st:
                        _dv = _ffprobe_duration(raw_path) or 0
                        if _dv > 0:
                            _e.metrica("primer_clip_min", round(_st[0] / 60, 1))
                            _e.metrica("ultimo_clip_min", round(_st[-1] / 60, 1))
                            _e.metrica("cobertura_pct", round(_st[-1] / _dv * 100))
            except Exception:
                pass

    # Validación: si el LLM no propuso ningún clip, fallar AHORA con mensaje claro
    # en vez de seguir a extract_clips que va a fallar con un error genérico.
    try:
        proposals_data = json.loads(proposals_path.read_text(encoding="utf-8"))
        clip_count = len(proposals_data.get("clips", []))
        if clip_count == 0:
            # Se nombra el PROVEEDOR, que es lo que explica el resultado. `model`
            # ahora viene en null cuando analizó la CLI de claude/codex, y
            # `.get("model", default)` devolvería None igual —la clave existe—,
            # así que el mensaje habría dicho "El modelo 'None'".
            _prov = proposals_data.get("provider") or "el analizador"
            _modelo = proposals_data.get("model")
            model_used = f"{_prov} ({_modelo})" if _modelo else _prov
            print(
                f"\n[ERROR ANALYZE] {model_used} no propuso ningún clip.\n"
                f"  Causa típica: el modelo es demasiado chico para razonar sobre transcripts largos.\n"
                f"  Solución: re-ejecutar con un modelo más grande, p.ej.:\n"
                f"    python long_form_pipeline.py \"{args.video_id}\" --model qwen3:8b --skip-transcribe\n"
                f"  (qwen3:8b es el mejor balance en CPU; gemma4:26b da más calidad pero es\n"
                f"   bastante más lento sin GPU. Borrá antes long_form/proposals/{args.video_id}.json\n"
                f"   para forzar regenerar.)",
                file=sys.stderr,
            )
            return 1
        print(f"[ok] {clip_count} clips propuestos por el modelo", file=sys.stderr)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        print(f"[ERROR ANALYZE] no pude leer {proposals_path}: {e}", file=sys.stderr)
        return 1

    # El hilo de whyViral solo nace en una de las ramas de abajo (y no nace si el
    # proposals venia cacheado). Mas adelante hace falta saber si sigue vivo para
    # no pelearle la VRAM a Whisper, asi que la referencia se declara aca.
    hilo_explicacion = None

    # Virality Score + whyViral SOLO si el proposals es nuevo. En --from-proposals
    # NO se re-scorea: el score reordena los clips y eso rompería las posiciones
    # que el usuario ya aprobó/ajustó en el paso de revisión.
    #
    # #15 VELOCIDAD: step_explain_virality llama a Ollama ~20s × N clips SOLO para
    # poblar el campo `whyViral` (el "porqué" del clip que muestra el wizard). NO
    # afecta el render del video. Por eso lo DIFERIMOS para que no bloquee extract +
    # render:
    #   - En --analyze-only el explain ES parte del entregable (el wizard lee el
    #     proposals enriquecido), así que ahí se corre síncrono antes de devolver.
    #   - En el flujo de render arranca en un thread daemon en PARALELO mientras
    #     extract/render corren; escribe whyViral en el proposals cuando termina.
    #     Si Ollama no está, hace skip silencioso (ya era best-effort).
    explain_thread = None
    if not args.from_proposals:
        # Virality Score (0-100) por clip — reordena de más a menos viral.
        # IMPORTANTE: el score corre ANTES (síncrono) porque reordena los clips y el
        # explain lee ese orden; además el extract consume este proposals.
        print("\n========== Virality Score ==========", file=sys.stderr)
        step_score_virality(args.video_id, proposals_path)

        # "¿Por qué este clip?" — explicación corta con IA local (solo modo inteligente,
        # top 15 por score; si Ollama no está, sigue sin el campo y sin error).
        if not args.use_heuristic:
            if args.analyze_only:
                # Entregable del wizard: debe estar listo antes de devolver.
                step_explain_virality(args.video_id, proposals_path, model=args.model)
            else:
                # NO bloquear el render: corre en paralelo. El score ya reordenó y
                # extract NO usa whyViral, así que parchear el JSON después es seguro.
                import threading  # noqa: PLC0415

                explain_thread = threading.Thread(
                    target=step_explain_virality,
                    args=(args.video_id, proposals_path),
                    kwargs={"model": args.model},
                    daemon=True,
                    name="explain-virality",
                )
                explain_thread.start()
                hilo_explicacion = explain_thread
                print(
                    "[whyViral] explicación con IA local corriendo en paralelo",
                    file=sys.stderr,
                )

    # ── ANÁLISIS-SOLO (flujo REVISAR, acto 1): aquí termina. El proposals quedó
    # escrito con score + whyViral; el wizard lo muestra para aprobar/ajustar y
    # después dispara --from-proposals con los índices aprobados.
    if args.analyze_only:
        elapsed = time.time() - t_total
        print(f"\n========== ANÁLISIS LISTO en {elapsed/60:.1f} min ==========", file=sys.stderr)
        bit.cerrar(ok=True, extra={"clips_propuestos": clip_count})
        print(json.dumps({
            "ok": True,
            "video_id": args.video_id,
            "mode": "analyze",
            "clean": None,
            # "clips" = momentos PROPUESTOS (la ruta lo surfacea como contador).
            "clips": clip_count,
            "elapsed_min": round(elapsed / 60, 2),
        }))
        return 0

    # Step 6: extract clips (con aspect ratio + face tracking opcional;
    # --clips limita al subset aprobado en el flujo REVISAR)
    # Antes de extraer, dejarle la GPU a Whisper.
    #
    # `extract_clips` re-transcribe cada clip, o sea que necesita ~2.4 GB de VRAM
    # para large-v3. Y llega justo despues del analisis, que deja a Ollama con el
    # modelo cargado: medido, 4718 MB de 6144. Son 7.1 GB pedidos sobre una placa
    # de 6, y encima whyViral puede seguir usando Ollama en su hilo.
    #
    # No habia estallado por casualidad: en las corridas donde el analisis estaba
    # cacheado, Ollama nunca se cargaba antes de extraer. Una corrida limpia si lo
    # toca.
    #
    # El hilo de whyViral se penso para no bloquear el render, y esa idea es buena
    # en TIEMPO pero ignora la MEMORIA. Se le da un plazo para terminar solo; si no
    # llega, se le suelta el modelo igual. Perder el campo whyViral es aceptable
    # (el codigo ya contempla que Ollama no este y sigue sin el); quedarse sin VRAM
    # para transcribir no lo es.
    if hilo_explicacion is not None and hilo_explicacion.is_alive():
        print("[vram] esperando a whyViral antes de extraer (hasta 120s)...", file=sys.stderr)
        hilo_explicacion.join(timeout=120)
        if hilo_explicacion.is_alive():
            print("[vram] whyViral sigue: se le suelta el modelo igual", file=sys.stderr)
    if _ollama_opts.liberar():
        print("[vram] Ollama solto el modelo antes de extraer", file=sys.stderr)

    print("\n========== STEP 6: extract clips ==========", file=sys.stderr)
    seleccion = seleccion_de_clips(proposals_path, args.max_clips, args.clips)

    with bit.etapa("extraer_clips") as _e:
        clips_info = step_extract(
            args.video_id,
            aspect_ratio=args.aspect_ratio,
            face_tracking=args.face_tracking,
            clips=seleccion,
            recortar_silencios=not args.sin_recorte_silencios,
        )
        _e.metrica("clips_extraidos", len(clips_info))
        _e.metrica("recorte_silencios", not args.sin_recorte_silencios)
        # Cuánto se recortó de verdad, no sólo si estaba activado. Sin esto la
        # bitácora no permitía contestar la única pregunta que importa de esta
        # opción: ¿vale la pena el tiempo que cuesta?
        recortes = [c.get("recorte") for c in clips_info if c.get("recorte")]
        quitado = round(sum(float(r.get("quitado_s") or 0) for r in recortes), 2)
        total = round(sum(float(c.get("duration") or 0) for c in clips_info), 2)
        _e.metrica("silencio_quitado_s", quitado)
        _e.metrica("clips_recortados", sum(1 for r in recortes if (r.get("quitado_s") or 0) > 0))
        if total > 0:
            _e.metrica("silencio_quitado_pct", round(quitado * 100 / (total + quitado), 1))
    print(f"\n[ok] {len(clips_info)} clips extraídos", file=sys.stderr)
    for c in clips_info:
        print(f"  - {c['clip_id']} ({c.get('duration', '?')}s)", file=sys.stderr)

    # Modo Gráficos & Motion: charts + íconos visuales + TARJETAS EDITORIALES por clip,
    # auto desde el transcript de cada clip (que extract_clips ya dejó alineado
    # palabra-por-palabra). Se activa con --graphics O si algún estilo pedido tiene
    # hasGraphics:true en el registro. GRAPHICS_STYLES se DERIVA del registro (arriba)
    # → ya no se desincroniza (los editoriales editorial_full/editorial_broll/paper_cut
    # y lottie_pop quedaban fuera y salían sin tarjetas).
    requested_styles = {s.strip() for s in args.styles.split(",") if s.strip()}
    wants_graphics = args.graphics or bool(requested_styles & GRAPHICS_STYLES)
    # Ilustraciones CC0 (personas/escenas multicolor): solo si algún estilo pedido
    # tiene illustrations:true (editorial*/lottie_pop). El merge en build-clip-props
    # las aplica SOLO al estilo que las declara (gate por styleHasIllustrations).
    wants_illustrations = bool(requested_styles & ILLUSTRATION_STYLES)
    if wants_graphics and clips_info:
        print("\n========== Modo Gráficos: charts + íconos por clip ==========", file=sys.stderr)
        # Etapa medida: son ~35-60s POR CLIP contra Ollama, secuenciales, y hasta
        # ahora no aparecian en la bitacora — que es justo la herramienta que se
        # usa para decidir donde optimizar.
        with bit.etapa("graficos") as _e:
            for c in clips_info:
                step_graphics(
                    c["clip_id"],
                    use_llm=not args.use_heuristic,
                    illustrations=wants_illustrations,
                )
            _e.metrica("clips_con_graficos", len(clips_info))

    # Contadores de render para el resumen final (existen aunque no se renderice).
    # Distinguen clips EXTRAÍDOS de clips realmente RENDERIZADOS: antes el JSON solo
    # reportaba `clips` = extraídos, así que un render fallido per-clip se reportaba
    # como éxito ("listo pero faltan videos"). Ahora la ruta puede avisar el parcial.
    render_done = 0
    render_total = 0

    # Step 7: render (opcional) — N estilos × M clips
    if args.render and clips_info:
        # Antes de renderizar, que Ollama suelte la VRAM.
        #
        # `KEEP_ALIVE` deja el modelo cargado diez minutos tras la ultima llamada,
        # y eso es lo correcto MIENTRAS se analiza: entre clip y clip la recarga
        # cuesta segundos. Pero al terminar esa etapa nadie le decia que lo
        # soltara, asi que el render arrancaba con la memoria tomada por un modelo
        # que ya no se va a usar. Medido al final de un lote de largos: Ollama
        # retenia 4718 MB de 6144 y dejaba 1279 MB libres, menos de lo que
        # necesita large-v3 para transcribir (~2.4 GB).
        #
        # Esta maquina esta dedicada a Viralito, asi que no hay nadie mas
        # compitiendo por la placa: la memoria que se libera aca la aprovecha el
        # propio render. Es best-effort: si falla se pierde memoria libre, no
        # trabajo, y Ollama la recupera sola a los diez minutos.
        if _ollama_opts.liberar():
            print("[vram] Ollama solto el modelo antes de renderizar", file=sys.stderr)

        print("\n========== STEP 7: render con Remotion ==========", file=sys.stderr)
        styles = [s.strip() for s in args.styles.split(",") if s.strip()]
        # VALID_STYLES se DERIVA del registro (módulo, _load_style_catalog): antes vivía
        # hardcodeado acá y se desincronizaba (le faltaban vhs/audiogram → los rechazaba
        # como inválidos). El registro es la única fuente de verdad del catálogo.
        invalid = [s for s in styles if s not in VALID_STYLES]
        if invalid:
            print(f"[error] estilos inválidos: {invalid}. Válidos: {sorted(VALID_STYLES)}", file=sys.stderr)
            return 1
        print(f"[render] {len(styles)} estilo(s) × {min(args.max_clips or len(clips_info), len(clips_info))} clip(s)", file=sys.stderr)
        limit = args.max_clips if args.max_clips else len(clips_info)
        clips_to_render = clips_info[:limit]
        n_clips = len(clips_to_render)
        # ── Render PARALELO (F0.2): pool de N workers (default 2, env LF_RENDER_WORKERS).
        # Cada (clip, estilo) es independiente: project/props/output únicos por par.
        # Con 2 workers el lote baja de ~80 min a ~35-40 min (15 clips supreme).
        tasks = [
            (ci, c, si, style_id)
            for ci, c in enumerate(clips_to_render, start=1)
            for si, style_id in enumerate(styles, start=1)
        ]
        render_total = len(tasks)
        workers = min(_render_workers(), max(1, len(tasks)))
        # ── OLA 3 — POOL de render-servers (bundle UNA vez, reusado) ──────────
        # Arrancamos un pool de N=workers instancias del render-server.mjs ANTES del
        # ThreadPoolExecutor. Cada instancia bundlea una sola vez; los workers-thread
        # toman una instancia libre por render → N renders concurrentes SIN re-bundle.
        # GUARD DE RAM + fallback están en lf_render_pool.start_pool: si la RAM no
        # alcanza, el pool no arranca o quedan <2 instancias listas, devuelve None y
        # TODO cae al CLI directo de siempre (que sí re-bundlea, pero funciona).
        render_pool = None
        try:
            import lf_render_pool  # noqa: PLC0415

            render_pool = lf_render_pool.start_pool(workers)
        except Exception as e:  # noqa: BLE001 — cualquier falla → CLI directo
            print(f"[render] no pude armar el pool ({e}); uso CLI directo", file=sys.stderr)
            render_pool = None
        # Si hay pool, el paralelismo lo marca el TAMAÑO del pool (instancias listas);
        # si no, los workers del ThreadPoolExecutor con CLI directo, como antes.
        if render_pool is not None:
            workers = render_pool.size
        rc = _remotion_concurrency(workers)
        print(
            f"[render] {workers} render(s) en paralelo · --concurrency {rc} c/u"
            f"{' · pool de render-servers' if render_pool is not None else ' · CLI directo'}",
            file=sys.stderr, flush=True,
        )
        done_count = 0
        skipped_count = 0
        # SKIP de lo ya renderizado: si NO se fuerza (VIRAL_FORCE_RENDER=1), los
        # clips cuyo .mp4 final ya existe y es válido se saltan (no se regeneran).
        force_render = _force_render()
        if force_render:
            print("[render] VIRAL_FORCE_RENDER=1 → regenero TODO (sin skip)", file=sys.stderr, flush=True)

        def _render_one(task: tuple) -> tuple:
            ci, c, si, style_id = task
            # Ruta FINAL esperada — mismo naming que step_render_clip (clip_id+style).
            clip_id = f"{args.video_id}_c{c['index']:02d}_{c['slug']}"
            out = LF_RENDERS / f"{clip_id}_{style_id}.mp4"
            # SKIP: el render final ya está en disco y es válido → contarlo como hecho.
            if not force_render and _render_already_done(out):
                print(
                    f"[skip] clip {ci}/{n_clips} · estilo {style_id}: ya renderizado ({out.name})",
                    file=sys.stderr, flush=True,
                )
                return (c["index"], style_id, out, True)
            # Marcador que la ruta surfacea en el panel: "clip 2/7 · estilo supreme (1/3)".
            print(
                f"[render] clip {ci}/{n_clips} · estilo {style_id} ({si}/{len(styles)})",
                file=sys.stderr, flush=True,
            )
            _avisar_de_lo_que_no_cuadra(clip_id, style_id)
            out = step_render_clip(
                args.video_id,
                c["index"],
                c["slug"],
                style_id=style_id,
                accent_color=args.accent_color,
                aspect_ratio=args.aspect_ratio,
                remotion_concurrency=rc,
                subtitle_font=args.subtitle_font,
                subtitle_color=args.subtitle_color,
                editorial_theme=args.editorial_theme,
                music_volume=args.music_volume,
                render_pool=render_pool,
                broll_source=args.broll_source,
                broll_position=args.broll_position,
            )
            return (c["index"], style_id, out, False)

        # Etapa medida: el render y todo lo que viene pegado (LUT, mastering de
        # audio, re-encode NVENC, normalizacion de volumen) no aparecian en la
        # bitacora. En la unica corrida historica con render eso fue el 69.8% del
        # tiempo total — 1744 de 2499 segundos invisibles para la herramienta que
        # existe justamente para decidir donde optimizar. Se median cuatro etapas
        # y se leia el resultado como si fuera el 100% del pipeline.
        with bit.etapa("render") as _er:
            _er.metrica("tareas", len(tasks))
            _er.metrica("estilos", len(styles))
            _er.metrica("trabajadores", workers)
            _er.metrica("concurrencia_por_render", rc)
            try:
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    futures = {pool.submit(_render_one, t): t for t in tasks}
                    for fut in as_completed(futures):
                        ci, c, si, style_id = futures[fut]
                        try:
                            _, _, out, was_skipped = fut.result()
                            done_count += 1
                            if was_skipped:
                                skipped_count += 1
                            else:
                                print(
                                    f"[ok] render -> {out} ({done_count}/{len(tasks)} listos)",
                                    file=sys.stderr, flush=True,
                                )
                        except subprocess.CalledProcessError as e:
                            print(f"[fail] render clip {c['index']} style {style_id}: {e}", file=sys.stderr)
                        except Exception as e:  # noqa: BLE001 — un clip fallido no tumba el lote
                            print(f"[fail] render clip {c['index']} style {style_id}: {e}", file=sys.stderr)
            finally:
                if skipped_count:
                    print(
                        f"[render] {skipped_count}/{len(tasks)} clip(s) saltado(s) (ya en disco); "
                        f"{done_count - skipped_count} renderizado(s) en esta corrida",
                        file=sys.stderr, flush=True,
                    )
                # Apagar el pool SIEMPRE: libera los N procesos Node + browser (RAM).
                if render_pool is not None:
                    try:
                        render_pool.shutdown()
                    except Exception:  # noqa: BLE001
                        pass

            _er.metrica("renderizados", done_count - skipped_count)
            _er.metrica("saltados", skipped_count)
        # Cuántos clips se renderizaron REALMENTE (vs solo extraídos) → resumen final.
        render_done = done_count

    # #15: el explain corrió en paralelo al render. Para entonces casi siempre ya
    # terminó (el render tarda mucho más); le damos una espera acotada para que
    # alcance a escribir whyViral en el proposals. Es daemon: si no termina, no
    # bloquea la salida del proceso.
    if explain_thread is not None:
        explain_thread.join(timeout=30)
        if explain_thread.is_alive():
            print(
                "[whyViral] sigue corriendo en background; no bloqueo el cierre",
                file=sys.stderr,
            )

    elapsed = time.time() - t_total
    print(f"\n========== DONE en {elapsed/60:.1f} min ==========", file=sys.stderr)
    bit.cerrar(ok=(render_total == 0 or render_done > 0), extra={
        "clips": len(clips_info),
        "renders_ok": render_done,
        "renders_pedidos": render_total,
        "renders_fallidos": max(0, render_total - render_done),
    })
    print(json.dumps({
        "ok": True,
        "video_id": args.video_id,
        # En modo clips rápidos no se genera clean (se corta del raw).
        "clean": str(clean_path) if clean_path else None,
        "clips": len(clips_info),
        # Render REAL (no solo extraídos): la ruta avisa si "terminó pero faltan".
        "rendered": render_done,
        "render_tasks": render_total,
        "render_failed": max(0, render_total - render_done),
        "elapsed_min": round(elapsed / 60, 2),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
