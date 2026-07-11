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
from lib.ffmpeg_safe_run import safe_ffmpeg
from postencode import post_encode
from normalize_audio import normalize as normalize_loudness


PYTHON_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PYTHON_DIR.parent
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
    subprocess.run(cmd, check=True, cwd=cwd)


def _ffprobe_duration(path: Path) -> float:
    """Duración del video en segundos, sin transcribir nada (instantáneo)."""
    ffprobe = FFMPEG_PATH.parent / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    out = subprocess.run(
        [str(ffprobe), "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(out.stdout.strip())
    except (ValueError, AttributeError):
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
    proc = subprocess.run(cmd, check=True, cwd=cwd, capture_output=True, text=True)
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


def step_detect(video_path: Path, video_id: str) -> Path:
    out = LF_CUTS / f"{video_id}.json"
    if out.exists():
        print(f"[skip] detect_silences (existe {out})", file=sys.stderr)
        return out
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "detect_silences.py"),
        str(video_path),
        "--out", str(out),
    ]
    run(cmd)
    # Muletillas ("eh", "este…", "o sea" con firma de duda): se RESTAN de los
    # keep_segments igual que en shorts, así el _clean.mp4 sale sin silencios NI
    # muletillas y los clips ganan densidad. Best-effort: si falla, seguimos solo
    # con los silencios (nunca aborta el pipeline).
    try:
        run([
            str(VENV_PYTHON),
            str(PYTHON_DIR / "detect_fillers.py"),
            video_id,
            "--transcripts-dir", str(LF_TRANSCRIPTS),
            "--cuts-dir", str(LF_CUTS),
        ])
    except Exception as e:  # noqa: BLE001
        print(f"[fillers] no se pudieron restar muletillas (sigo sin ellas): {e}", file=sys.stderr)
    return out


def step_cut(video_path: Path, cuts_path: Path, video_id: str) -> Path:
    out = LF_CLEAN / f"{video_id}_clean.mp4"
    if out.exists():
        print(f"[skip] cut_silences (existe {out})", file=sys.stderr)
        return out
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "cut_silences.py"),
        str(video_path),
        "--cuts", str(cuts_path),
        "--out", str(out),
    ]
    run(cmd)
    return out


def step_re_transcribe_clean(clean_path: Path, video_id: str, force: bool = False) -> Path:
    """Re-transcribir el video CLEAN para tener timestamps alineados con los clips extraídos.

    El primer transcript es del raw (con silencios). Cuando recortamos silencios, los timestamps
    cambian. Re-transcribimos el clean para que analyze_clips/extract_clips trabajen con
    timestamps consistentes.

    Si ya existe un marker `.from_clean`, asumimos que el transcript ya es del clean y skipeamos.
    """
    out = LF_TRANSCRIPTS / f"{video_id}.json"
    marker = LF_TRANSCRIPTS / f"{video_id}.from_clean"
    if marker.exists() and out.exists() and not force:
        print(f"[skip] re-transcribe (marker existe)", file=sys.stderr)
        return out
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "transcribe.py"),
        str(clean_path),
        "--out", str(out),
    ]
    run(cmd)
    marker.write_text("ok", encoding="utf-8")
    return out


def step_analyze(
    video_id: str,
    model: str | None = None,
    use_heuristic: bool = False,
    max_clips: int = 15,
) -> Path:
    out = LF_PROPOSALS / f"{video_id}.json"
    if out.exists():
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


def step_graphics(clip_id: str, use_llm: bool = True, illustrations: bool = False) -> None:
    """Modo Gráficos: genera charts + titulares (+ ilustraciones CC0 opt-in) para un
    clip (best-effort, no rompe el job). illustrations=True cuando algún estilo pedido
    tiene illustrations:true (editorial*/lottie_pop) → emite illustrationStickers."""
    cmd = [str(VENV_PYTHON), str(PYTHON_DIR / "generate_graphics.py"), clip_id]
    if not use_llm:
        cmd.append("--no-llm")
    if illustrations:
        cmd.append("--illustrations")
    try:
        run(cmd)
    except subprocess.CalledProcessError as e:
        print(f"[graphics] falló para {clip_id} (sigo sin gráficos): {e}", file=sys.stderr)


def step_extract(
    video_id: str,
    aspect_ratio: str = "9:16",
    face_tracking: str = "off",
    clips: str | None = None,
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
_BROLL_STYLES = {"editorial_broll", "broll_full", "broll_pip"}


def _apply_broll(clip_id: str, style_id: str, aspect_ratio: str) -> None:
    """Para estilos de archivo: pide clips de b-roll al endpoint Next
    (/api/long_form/broll) y parchea project.bRoll. El endpoint busca en Pexels con
    orientación LANDSCAPE para 16:9 (portrait para 9:16); sin PEXELS_API_KEY cae a CC0.

    Antes los largos NUNCA poblaban b-roll (build-clip-supreme no lo hace), así que
    editorial_broll/broll_full/broll_pip renderizaban sin archivo. Esto lo cablea.

    Best-effort: si no hay endpoint/red/clips, deja bRoll vacío y el render sigue
    (idéntico a antes). El video de archivo se baja en build-clip-props (localize)."""
    if style_id not in _BROLL_STYLES:
        return
    try:
        project_path = LF_PROJECTS / f"{clip_id}_{style_id}.json"
        if not project_path.exists():
            return
        api = os.environ.get("VIRAL_API_HOST") or "http://localhost:3000"
        payload = json.dumps({"clipId": clip_id, "aspectRatio": aspect_ratio}).encode("utf-8")
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
        project_path.write_text(json.dumps(proj, indent=2), encoding="utf-8")
        print(
            f"[broll] {len(broll)} clips ({data.get('source')}/{data.get('orientation')}) "
            f"→ {clip_id}_{style_id}",
            file=sys.stderr,
        )
    except Exception as e:  # noqa: BLE001 — best-effort, nunca rompe el clip
        print(f"[broll] skipped: {e}", file=sys.stderr)


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
            check=False, cwd=PYTHON_DIR, capture_output=True, text=True, timeout=180,
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
            proc = subprocess.run(
                [str(VENV_PYTHON), str(PYTHON_DIR / "track_subject.py"), str(clip_video), "0.15"],
                check=False, cwd=PYTHON_DIR, capture_output=True, text=True, timeout=180,
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
            # F3 — chispas en el pico emocional máximo (paridad con shorts).
            top = max(peaks, key=lambda p: p.get("score", 0), default=None)
            if top and top.get("score", 0) >= 0.6:
                data["particleBursts"] = (data.get("particleBursts") or []) + [
                    {"at": top["t"], "duration": 1.6, "kind": "sparks", "count": 60}
                ]
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
    _apply_broll(clip_id, style_id, aspect_ratio)
    # 1.6) F1 — director emocional: ducking de música + zooms en picos. Best-effort.
    _apply_emotion(clip_id, style_id)
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
        r = subprocess.run(hl_cmd, capture_output=True, text=True, cwd=str(PYTHON_DIR))
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
        if not args.skip_transcribe:
            step_transcribe(raw_path, args.video_id, chunked=True)

        # Pasos 2-4 no aplican en modo inteligente: los marcamos saltados para que
        # la UI no quede en "pending" esperándolos.
        for _skip in ("detect_silences", "cut_silences", "re-transcribe"):
            print(f"[skip] {_skip} (modo inteligente: clips se cortan del raw)", file=sys.stderr)

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
        proposals_path = step_analyze(
            args.video_id, model=args.model,
            use_heuristic=args.use_heuristic, max_clips=smart_max,
        )

    # Validación: si el LLM no propuso ningún clip, fallar AHORA con mensaje claro
    # en vez de seguir a extract_clips que va a fallar con un error genérico.
    try:
        proposals_data = json.loads(proposals_path.read_text(encoding="utf-8"))
        clip_count = len(proposals_data.get("clips", []))
        if clip_count == 0:
            model_used = proposals_data.get("model", args.model or "default")
            print(
                f"\n[ERROR ANALYZE] El modelo '{model_used}' no propuso ningún clip.\n"
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
                print(
                    "[whyViral] explicación con IA local corriendo en paralelo "
                    "(no bloquea el render)",
                    file=sys.stderr,
                )

    # ── ANÁLISIS-SOLO (flujo REVISAR, acto 1): aquí termina. El proposals quedó
    # escrito con score + whyViral; el wizard lo muestra para aprobar/ajustar y
    # después dispara --from-proposals con los índices aprobados.
    if args.analyze_only:
        elapsed = time.time() - t_total
        print(f"\n========== ANÁLISIS LISTO en {elapsed/60:.1f} min ==========", file=sys.stderr)
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
    print("\n========== STEP 6: extract clips ==========", file=sys.stderr)
    clips_info = step_extract(
        args.video_id,
        aspect_ratio=args.aspect_ratio,
        face_tracking=args.face_tracking,
        clips=args.clips,
    )
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
        for c in clips_info:
            step_graphics(
                c["clip_id"],
                use_llm=not args.use_heuristic,
                illustrations=wants_illustrations,
            )

    # Contadores de render para el resumen final (existen aunque no se renderice).
    # Distinguen clips EXTRAÍDOS de clips realmente RENDERIZADOS: antes el JSON solo
    # reportaba `clips` = extraídos, así que un render fallido per-clip se reportaba
    # como éxito ("listo pero faltan videos"). Ahora la ruta puede avisar el parcial.
    render_done = 0
    render_total = 0

    # Step 7: render (opcional) — N estilos × M clips
    if args.render and clips_info:
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
            )
            return (c["index"], style_id, out, False)

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
