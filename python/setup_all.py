# T2: silenciar el warning de torchcodec ANTES de cualquier import/subprocess que
# cargue whisperx (debe ir al TOPE, antes de importar config/torch).
import warnings

warnings.filterwarnings(
    "ignore",
    message=r".*torchcodec is not installed correctly.*",
    category=UserWarning,
)

"""Configura TODO lo que Viralito necesita en una PC nueva, de una sola pasada.

Orden: primero lo CRÍTICO (modelos de voz para transcribir, con reintentos), luego
las MEJORAS (música, iconos, fuentes, efectos). Si una mejora falla NO aborta el
resto — la app igual funciona, solo con menos assets. Imprime progreso línea por
línea para que el endpoint /api/setup/full lo muestre en vivo.

RESILIENCIA (T4): cada paso es reanudable (lee/escribe un estado en disco), tiene
timeout propio, reintenta con backoff, emite progreso en JSON (una línea por evento)
y valida el resultado contando archivos en disco. Un paso que falla NO aborta el
resto; el único "crítico" es el modelo de voz, que define el exit code.

Uso:  python setup_all.py
"""
# NOTA: no usamos `from __future__ import annotations` porque debe ser la PRIMERA
# sentencia del archivo y el filtro de warnings de torchcodec (T2) tiene que ir antes
# que cualquier import. En Python 3.11 las anotaciones `X | Y` / `tuple[...]` ya
# funcionan nativamente sin el future-import.

import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from config import (
    ASSETS_ICONS,
    ASSETS_ILLUSTRATIONS,
    ASSETS_LOTTIE,
    ASSETS_MUSIC,
    ASSETS_OVERLAYS,
    ASSETS_SFX,
    DATA_ROOT,
    ensure_dirs,
)

HERE = Path(__file__).resolve().parent
PY = sys.executable

# Fuentes: el script las baja a <repo>/remotion/public/fonts (NO a DATA_ROOT).
FONTS_DIR = HERE.parent / "remotion" / "public" / "fonts"

# Estado persistido para reanudar entre corridas.
STATE_PATH = DATA_ROOT / "cache" / "setup_state.json"
# Un stage "ok" más viejo que esto se vuelve a ejecutar.
CACHE_TTL_SECONDS = 7 * 24 * 3600

# Versión de la app (para el estado). Se intenta leer de tauri.conf.json; si no,
# cae al default acordado.
APP_VERSION_FALLBACK = "0.3.4"

# Timeout por paso (segundos).
TIMEOUTS = {
    "torch_install_cuda": 1800,
    "whisper_voice": 1200,
    "ollama_model": 1800,
    "fonts": 300,
    "iconos_editoriales": 300,
    "lottie": 300,
    "musica": 900,
    "sfx": 600,
    # MEJORAS extra (packs nuevos de assets). lofi grande (~554MB) → timeout amplio.
    "iconos_extra": 600,
    "musica_lofi": 1800,
    "ilustraciones": 300,
    "overlays": 120,
    "sfx_extra": 900,
    # SFX sintéticos curados (typewriter.wav / film_reel.wav). Síntesis local, rápida.
    "sfx_synth_curated": 120,
}
DEFAULT_TIMEOUT = 300

# Backoff entre reintentos (esperas tras los intentos 1 y 2 fallidos).
BACKOFF = [5, 15, 45]


def _emit(stage: str, status: str, **extra: object) -> None:
    """Una línea JSON por evento de progreso, para que /api/setup/full la parsee.

    NO reemplaza los print() humanos: la UI muestra ambos (las líneas humanas como
    texto y estas como datos estructurados).
    """
    payload = {"stage": stage, "status": status}
    payload.update(extra)
    print(json.dumps(payload), flush=True)


def _app_version() -> str:
    try:
        conf = HERE.parent.parent / "desktop" / "src-tauri" / "tauri.conf.json"
        data = json.loads(conf.read_text(encoding="utf-8"))
        v = data.get("version")
        if isinstance(v, str) and v.strip():
            return v.strip()
    except Exception:
        pass
    return APP_VERSION_FALLBACK


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _age_seconds(iso_ts: str | None) -> float | None:
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(iso_ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return None


def _load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_state(stages: dict, last_run_at: str) -> None:
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(
            json.dumps(
                {
                    "lastRunAt": last_run_at,
                    "version": _app_version(),
                    "stages": stages,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except Exception as e:  # no romper el setup por no poder escribir el estado
        print(f"[setup] no se pudo guardar el estado ({e}); continúo igual.", flush=True)


def _count_files(root: Path, suffixes: tuple[str, ...]) -> int:
    """Cuenta archivos con cualquiera de las extensiones, recursivo. 0 si no existe."""
    if not root.exists():
        return 0
    n = 0
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in suffixes:
            n += 1
    return n


# (root, extensiones, mínimo esperado) por stage que valida archivos en disco.
_VALIDATIONS: dict[str, tuple[Path, tuple[str, ...], int]] = {
    "musica": (ASSETS_MUSIC / "github", (".mp3",), 50),
    "sfx": (ASSETS_SFX / "github", (".ogg", ".mp3", ".wav"), 200),
    "lottie": (ASSETS_LOTTIE, (".json",), 30),
    "iconos_editoriales": (ASSETS_ICONS, (".svg",), 5000),
    "fonts": (FONTS_DIR, (".ttf", ".otf"), 6),
    # MEJORAS extra. Validan la subcarpeta PROPIA del pack (no la compartida) para
    # detectar de verdad si bajó el set nuevo.
    # Material Symbols (~4,100) + Lucide (~1,700) → mín conservador por si una mitad
    # quedó incompleta. material/ es el grueso (~3,800).
    "iconos_extra": (ASSETS_ICONS / "material", (".svg",), 3000),
    # open-lofi baja 166 mp3 FLAT en github/ (junto a los del paso 'musica'); un
    # umbral alto detecta que el pack lofi cayó (base son ~30-50).
    "musica_lofi": (ASSETS_MUSIC / "github", (".mp3",), 150),
    # open-doodles (~33) + open-peeps (~40) = ~73 SVG repartidos en subcarpetas.
    "ilustraciones": (ASSETS_ILLUSTRATIONS, (".svg",), 30),
    # 7 overlays procedurales (PNG) + manifest.
    "overlays": (ASSETS_OVERLAYS, (".png",), 5),
    # 4 packs Kenney nuevos (flat en github/) + curated-viral/. github ya trae 200+
    # del paso 'sfx'; con los packs extra sube bastante.
    "sfx_extra": (ASSETS_SFX / "github", (".ogg", ".mp3", ".wav"), 250),
    # SFX sintéticos en curated/ (typewriter.wav + film_reel.wav). Mín 2: los .wav
    # que el estilo cine_clasico referencia y que NO baja ningún downloader.
    "sfx_synth_curated": (ASSETS_SFX / "curated", (".wav",), 2),
}


def _validate(stage: str) -> tuple[bool, str]:
    """Cuenta archivos en disco contra el mínimo esperado. (ok, detalle)."""
    if stage not in _VALIDATIONS:
        return True, ""  # pasos sin validación de archivos (torch, voz)
    root, suffixes, minimo = _VALIDATIONS[stage]
    n = _count_files(root, suffixes)
    if n >= minimo:
        return True, f"{n} archivos (>= {minimo})"
    return False, f"solo {n} archivos en {root} (esperaba >= {minimo})"


def _run(stage: str, nombre: str, args: list[str]) -> tuple[bool, str]:
    """Corre UN paso de descarga con timeout propio + 3 reintentos (backoff 5/15/45s)
    + validación post-paso (cuenta archivos en disco). Devuelve (ok, ultimo_error).

    Emite _emit(stage,"fail",attempt=i,...) tras cada intento fallido. NO emite
    start/ok/fail_final — de eso se encarga _step (para que el caller pueda saltear
    por caché sin pasar por acá).
    """
    timeout = TIMEOUTS.get(stage, DEFAULT_TIMEOUT)
    ultimo_error = ""
    for i in range(1, 4):
        print(f"[setup] {nombre}: descargando (intento {i}/3)...", flush=True)
        try:
            r = subprocess.run(
                [PY, *args], cwd=str(HERE), capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout
            )
            if r.returncode == 0:
                valido, detalle = _validate(stage)
                if valido:
                    print(f"[setup] OK: {nombre}", flush=True)
                    return True, ""
                # exit==0 pero faltan archivos → lo tratamos como fallo del intento.
                ultimo_error = f"validación falló: {detalle}"
                print(f"[setup] {nombre}: terminó pero {detalle}", flush=True)
            else:
                ultimo_error = (r.stderr or "").strip()[-200:]
                print(f"[setup] {nombre} no terminó (rc={r.returncode}): {ultimo_error}", flush=True)
        except subprocess.TimeoutExpired:
            ultimo_error = f"timeout tras {timeout}s"
            print(f"[setup] {nombre} se pasó del tiempo ({timeout}s).", flush=True)
        except Exception as e:  # red caída, etc.
            ultimo_error = str(e)
            print(f"[setup] {nombre} error: {e}", flush=True)

        if i < 3:
            espera = BACKOFF[i - 1]
            _emit(stage, "fail", attempt=i, error=ultimo_error[-200:])
            print(f"[setup] reintento en {espera}s...", flush=True)
            time.sleep(espera)
    return False, ultimo_error[-200:]


def _step(
    stage: str,
    nombre: str,
    args: list[str],
    state: dict,
    *,
    critico: bool = False,
    skippable: bool = True,
) -> bool:
    """Orquesta un paso reanudable: skip por caché → _run → estado + _emit.

    - skippable: si ya está "ok", fresco (< 7 días) y los archivos siguen en disco,
      lo saltea (emite skip) y NO corre _run.
    - critico: define el exit code; NUNCA se saltea por caché (re-valida siempre).
    Devuelve True si el paso quedó OK.
    """
    prev = state.get(stage)
    if skippable and isinstance(prev, dict) and prev.get("status") == "ok":
        last = state.get("lastRunAt") or prev.get("at")
        edad = _age_seconds(last)
        valido, _ = _validate(stage)
        if edad is not None and edad < CACHE_TTL_SECONDS and valido:
            print(f"[setup] {nombre}: ya estaba listo (cacheado), lo salto.", flush=True)
            _emit(stage, "skip", reason="cacheado")
            return True

    _emit(stage, "start")
    t0 = time.time()
    ok, error = _run(stage, nombre, args)
    ms = int((time.time() - t0) * 1000)

    if ok:
        _emit(stage, "ok", ms=ms)
        state[stage] = {"status": "ok", "ms": ms, "at": _now_iso()}
        return True

    _emit(stage, "fail_final", ms=ms, error=error)
    state[stage] = {"status": "fail", "ms": ms, "error": error, "at": _now_iso()}
    if critico:
        print(f"[setup] CRÍTICO no se pudo: {nombre}", flush=True)
    else:
        print(f"[setup] mejora opcional omitida (no es grave): {nombre}", flush=True)
    return False


def _hay_gpu_nvidia() -> bool:
    """¿Hay GPU NVIDIA? (nvidia-smi responde)."""
    try:
        r = subprocess.run(["nvidia-smi"], capture_output=True, timeout=10)
        return r.returncode == 0
    except Exception:
        return False


def _torch_ya_es_cuda() -> bool:
    try:
        r = subprocess.run(
            [PY, "-c", "import torch; print(torch.cuda.is_available())"],
            capture_output=True, text=True, timeout=120,
        )
        return "True" in (r.stdout or "")
    except Exception:
        return False


def _parse_driver_major(driver_version: str | None) -> int | None:
    """Major del driver NVIDIA ('572.55' → 572). None si no se puede parsear."""
    if not driver_version:
        return None
    try:
        return int(str(driver_version).strip().split(".", 1)[0])
    except (ValueError, AttributeError):
        return None


def _torch_cuda_index_tag(driver_version: str | None) -> str | None:
    """Elige el tag del índice de wheels de PyTorch según el DRIVER NVIDIA.

    cu121 (lo que usábamos fijo) YA NO tiene wheels para torch 2.8 — por eso ahora
    elegimos el wheel según el driver instalado:

      major >= 570 → cu128
      major >= 560 → cu126
      major >= 550 → cu124
      major >= 525 → cu123
      < 525 o None  → None (skip: la GPU/driver es muy viejo, se queda en CPU)
    """
    major = _parse_driver_major(driver_version)
    if major is None:
        return None
    if major >= 570:
        return "cu128"
    if major >= 560:
        return "cu126"
    if major >= 550:
        return "cu124"
    if major >= 525:
        return "cu123"
    return None


def _nvidia_driver_version() -> str | None:
    """Driver version vía hw_profile.detect() (cacheado). None si no hay GPU."""
    try:
        from hw_profile import detect

        nv = detect().get("gpu_nvidia") or {}
        return nv.get("driver_version") or None
    except Exception:
        return None


def _configurar_segun_equipo(state: dict) -> None:
    """Adapta la app al HARDWARE: si hay GPU NVIDIA, instala torch CUDA para que
    la transcripción corra en GPU (5-10x más rápido) en vez de CPU. El bundle trae
    torch CPU-only (chico y universal); esto lo actualiza SOLO en máquinas con GPU.
    El wheel se elige según el DRIVER (cu128/cu126/cu124/cu123); pip instala de forma
    atómica: si falla, el torch CPU sigue funcionando.
    """
    stage = "torch_install_cuda"
    if not _hay_gpu_nvidia():
        print("[setup] Sin GPU NVIDIA: la app usa CPU (correcto para este equipo).", flush=True)
        _emit(stage, "skip", reason="sin_gpu")
        state[stage] = {"status": "skip", "ms": 0, "at": _now_iso()}
        return
    if _torch_ya_es_cuda():
        print("[setup] GPU NVIDIA con torch CUDA ya configurado.", flush=True)
        _emit(stage, "skip", reason="ya_configurado")
        state[stage] = {"status": "skip", "ms": 0, "at": _now_iso()}
        return

    driver = _nvidia_driver_version()
    tag = _torch_cuda_index_tag(driver)
    if tag is None:
        # Driver demasiado viejo (o ilegible): no hay wheel CUDA compatible → CPU.
        print(
            f"[setup] Driver NVIDIA muy viejo (driver={driver or 'desconocido'}); "
            "no hay wheel CUDA compatible. La app sigue en CPU (funciona, más lento).",
            flush=True,
        )
        _emit(stage, "skip", reason="driver_viejo", driver=driver)
        state[stage] = {"status": "skip", "ms": 0, "at": _now_iso()}
        return

    print(
        f"[setup] GPU NVIDIA detectada (driver {driver} → {tag}) — instalando aceleración "
        "(torch CUDA, ~2.5 GB, una sola vez)...",
        flush=True,
    )
    _emit(stage, "torch_cuda", tag=tag, driver=driver)
    index_url = f"https://download.pytorch.org/whl/{tag}"
    # No skippable por caché: si llegamos acá es porque torch CUDA NO está activo.
    _step(
        stage,
        f"aceleración GPU (torch CUDA {tag})",
        ["-m", "pip", "install", "--force-reinstall", "--no-deps", "--no-cache-dir",
         "torch", "torchaudio", "--index-url", index_url],
        state,
        skippable=False,
    )
    if _torch_ya_es_cuda():
        print("[setup] Aceleración GPU lista: la transcripción ahora usa tu tarjeta.", flush=True)
        # Tras activar la GPU, baja el modelo de Whisper recomendado para ESTA tarjeta
        # (large-v3 / medium / small según VRAM) — el "small" inicial puede quedarse corto.
        _download_recommended_whisper(state)
    else:
        print("[setup] No se pudo activar la GPU; la app sigue en CPU (funciona igual, más lento).", flush=True)


def _recommended_whisper_model() -> str:
    """Modelo de Whisper recomendado por hw_profile. 'small' si detect() falla."""
    try:
        from hw_profile import detect

        return detect().get("recommend", {}).get("whisper_model") or "small"
    except Exception:
        return "small"


def _download_recommended_whisper(state: dict) -> None:
    """Descarga el modelo de Whisper RECOMENDADO para el hardware (no el fijo 'small').

    Solo corre tras activar la GPU: en CPU el 'small' del paso crítico ya alcanza.
    Reusa toda la resiliencia de _step (timeout/reintentos/estado/emit)."""
    model = _recommended_whisper_model()
    if model == "small":
        # El paso crítico whisper_voice ya bajó 'small'; no repetir.
        print("[setup] Modelo de voz recomendado es 'small' (ya descargado).", flush=True)
        return
    print(f"[setup] Descargando modelo de voz recomendado para tu GPU: '{model}'...", flush=True)
    _step(
        "whisper_voice",  # mismo stage: el validador no chequea archivos para voz
        f"modelo de voz recomendado ({model})",
        ["transcribe.py", "--download-model", model],
        state,
        critico=True,
        skippable=False,
    )


def _ollama_disponible() -> bool:
    """¿El binario `ollama` responde? (sin él no se puede hacer pull)."""
    try:
        r = subprocess.run(["ollama", "--version"], capture_output=True, timeout=15)
        return r.returncode == 0
    except Exception:
        return False


def _ollama_pull(model: str, timeout: int) -> tuple[bool, str]:
    """`ollama pull <model>` con un solo intento (timeout largo). (ok, error)."""
    try:
        r = subprocess.run(
            ["ollama", "pull", model], capture_output=True, text=True, timeout=timeout
        )
        if r.returncode == 0:
            return True, ""
        return False, (r.stderr or r.stdout or "").strip()[-200:]
    except subprocess.TimeoutExpired:
        return False, f"timeout tras {timeout}s"
    except Exception as e:  # noqa: BLE001
        return False, str(e)[-200:]


def _install_ollama_model(state: dict) -> None:
    """Baja el modelo de Ollama RECOMENDADO según la VRAM (qwen3:14b/8b/4b/1.7b).

    Fallback: si el grande falla, asegura que al menos qwen3:1.7b quede presente
    (corre en CPU pura). Si Ollama no está instalado, se saltea sin abortar — el
    pipeline tiene fallback heurístico si Ollama no está."""
    stage = "ollama_model"
    if not _ollama_disponible():
        print("[setup] Ollama no está instalado; salto la descarga del modelo "
              "(el análisis de clips usará fallback heurístico).", flush=True)
        _emit(stage, "skip", reason="sin_ollama")
        state[stage] = {"status": "skip", "ms": 0, "at": _now_iso()}
        return

    try:
        from hw_profile import detect

        model = detect().get("recommend", {}).get("ollama_model") or "qwen3:1.7b"
    except Exception:
        model = "qwen3:1.7b"

    timeout = TIMEOUTS.get(stage, DEFAULT_TIMEOUT)
    _emit(stage, "start", model=model)
    t0 = time.time()
    print(f"[setup] Descargando modelo de análisis recomendado: {model}...", flush=True)
    ok, error = _ollama_pull(model, timeout)

    if not ok and model != "qwen3:1.7b":
        # Fallback: asegurar al menos el chico para que el análisis funcione.
        print(f"[setup] No se pudo bajar {model} ({error}); aseguro qwen3:1.7b...", flush=True)
        _emit(stage, "fail", attempt=1, error=error, model=model)
        ok_fb, error_fb = _ollama_pull("qwen3:1.7b", timeout)
        if ok_fb:
            model, ok, error = "qwen3:1.7b", True, ""
        else:
            error = error_fb

    ms = int((time.time() - t0) * 1000)
    if ok:
        print(f"[setup] OK: modelo de análisis {model}", flush=True)
        _emit(stage, "ok", ms=ms, model=model)
        state[stage] = {"status": "ok", "ms": ms, "model": model, "at": _now_iso()}
    else:
        print(f"[setup] mejora opcional omitida (no es grave): modelo de análisis ({error})", flush=True)
        _emit(stage, "fail_final", ms=ms, error=error)
        state[stage] = {"status": "fail", "ms": ms, "error": error, "at": _now_iso()}


def main() -> int:
    ensure_dirs()
    print("[setup] Configurando Viralito: modelos de IA + librerías de assets...", flush=True)

    prev = _load_state()
    state = prev.get("stages", {}) if isinstance(prev, dict) else {}
    # lastRunAt del estado previo, para evaluar la frescura de los "ok" cacheados.
    if isinstance(prev, dict) and "lastRunAt" in prev:
        state["lastRunAt"] = prev["lastRunAt"]

    # 1) CRÍTICO — modelos de voz (transcripción). Sin esto la app no transcribe.
    #    NO se saltea por caché: re-valida siempre (whisperx usa el caché si está,
    #    así que es barato si ya estaba descargado).
    voz_ok = _step(
        "whisper_voice",
        "modelos de voz (transcripción)",
        ["transcribe.py", "--download-model", "small"],
        state,
        critico=True,
        skippable=False,
    )

    # 2) MEJORAS — no abortan el setup si fallan (la app funciona sin ellas).
    _step("fonts", "fuentes tipográficas", ["download_fonts.py"], state)
    _step("iconos_editoriales", "iconos editoriales", ["download_editorial_icons.py"], state)
    # Ilustraciones animadas: hay DOS sets y NO son acumulativos. Sin --all baja el
    # set CURADO por concepto (noto/*.json: money, rocket, fire…) que es lo que el
    # render busca en ASSETS_LOTTIE; con --all baja el CATÁLOGO completo (noto/catalog).
    # Corremos ambos para tener los curados Y el catálogo (audit I1 / hallazgo E).
    # Forman UN solo stage "lottie": basta que la validación (>=30 json) pase.
    _step_lottie(state)
    # Música: el out-dir DEBE terminar en \github — así los mp3 caen donde los
    # scanners de runtime (pickRandomMusicTrack, /api/music/stream) los buscan, y el
    # manifest queda en assets/music/manifest_music_library.json (hallazgo E).
    _step(
        "musica",
        "biblioteca de música",
        ["download_music_library.py", "download", "--out-dir", str(ASSETS_MUSIC / "github"), "--chosic", "30"],
        state,
    )
    _step(
        "sfx",
        "efectos de sonido",
        ["download_sfx_library.py", "download", "--out-dir", str(ASSETS_SFX / "github")],
        state,
    )

    # 2b) MEJORAS EXTRA — packs nuevos de assets (iconos, lofi, ilustraciones,
    #     overlays, sfx curado). Cada uno es opcional: si falla NO aborta el setup.
    #     Van DESPUÉS de los críticos/base para que la app ya sea usable mientras
    #     estos bajan. La música lofi pesa ~554 MB → tiene el timeout más largo.
    _step(
        "iconos_extra",
        "iconos extra (Material Symbols + Lucide)",
        ["download_more_icons.py"],
        state,
    )
    _step(
        "musica_lofi",
        "música lo-fi (open-lofi CC0, ~554 MB)",
        ["download_lofi_music.py", "download", "--out-dir", str(ASSETS_MUSIC / "github")],
        state,
    )
    _step(
        "ilustraciones",
        "ilustraciones de personas (open-doodles + open-peeps)",
        ["download_illustrations.py"],
        state,
    )
    _step(
        "overlays",
        "overlays de textura (grano, light-leak, scanlines)",
        ["download_overlays.py"],
        state,
    )
    _step(
        "sfx_extra",
        "SFX extra + set viral curado",
        ["download_more_sfx.py", "all", "--out-dir", str(ASSETS_SFX / "github")],
        state,
    )
    # SFX sintéticos curados: typewriter.wav + film_reel.wav (síntesis local, sin red).
    # Los referencia el estilo cine_clasico; ningún downloader los provisiona. Van a
    # curated/ como .wav (lo que /api/sfx/stream resuelve por basename).
    _step(
        "sfx_synth_curated",
        "SFX sintéticos curados (typewriter + film_reel)",
        ["synth_sfx.py", "curated-wav", "--out-dir", str(ASSETS_SFX / "curated")],
        state,
    )

    # 3) SEGÚN EL EQUIPO — si hay GPU NVIDIA, baja la aceleración (torch CUDA) y,
    #    una vez activa, el modelo de Whisper recomendado para esa tarjeta.
    _configurar_segun_equipo(state)

    # 4) Modelo de Ollama recomendado por VRAM (qwen3:14b/8b/4b/1.7b). Al final de
    #    la cadena: el análisis de clips lo usa; con fallback a qwen3:1.7b.
    _install_ollama_model(state)

    # Persistir el estado final.
    state.pop("lastRunAt", None)  # se guarda como campo top-level, no como stage
    _write_state(state, _now_iso())

    if voz_ok:
        print("[setup] ¡Listo! La app puede transcribir y tiene las librerías de assets.", flush=True)
        print("OK", flush=True)
        return 0
    print(
        "[setup] La transcripción NO quedó lista: faltan los modelos de voz. "
        "Revisa tu internet y vuelve a tocar «Configurar todo».",
        flush=True,
    )
    return 1


def _step_lottie(state: dict) -> None:
    """Stage 'lottie': dos sub-descargas (curadas + catálogo) que componen un solo
    stage. Respeta skip por caché y valida el TOTAL recursivo de json en disco.
    """
    stage = "lottie"
    nombre = "ilustraciones animadas"
    prev = state.get(stage)
    if isinstance(prev, dict) and prev.get("status") == "ok":
        last = state.get("lastRunAt") or prev.get("at")
        edad = _age_seconds(last)
        valido, _ = _validate(stage)
        if edad is not None and edad < CACHE_TTL_SECONDS and valido:
            print(f"[setup] {nombre}: ya estaba listo (cacheado), lo salto.", flush=True)
            _emit(stage, "skip", reason="cacheado")
            return

    _emit(stage, "start")
    t0 = time.time()
    # Las dos sub-descargas comparten el stage; cada una reintenta vía _run pero el
    # resultado se decide por la validación final (>=30 json en ASSETS_LOTTIE).
    cur_ok, err_cur = _run(stage, "ilustraciones animadas (curadas)", ["download_animated_icons.py"])
    cat_ok, err_cat = _run(stage, "ilustraciones animadas (catálogo)", ["download_animated_icons.py", "--all"])
    ms = int((time.time() - t0) * 1000)
    valido, detalle = _validate(stage)
    if valido:
        print(f"[setup] OK: {nombre}", flush=True)
        _emit(stage, "ok", ms=ms)
        state[stage] = {"status": "ok", "ms": ms, "at": _now_iso()}
    else:
        error = (err_cat or err_cur or detalle)[-200:]
        _emit(stage, "fail_final", ms=ms, error=error)
        state[stage] = {"status": "fail", "ms": ms, "error": error, "at": _now_iso()}
        print(f"[setup] mejora opcional omitida (no es grave): {nombre} ({detalle})", flush=True)


if __name__ == "__main__":
    sys.exit(main())
