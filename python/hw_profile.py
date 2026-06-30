"""Perfil de HARDWARE auto-detectado: la app se adapta a cada equipo.

Detector UNIFICADO con probes reales y recomendaciones (TAREA H1 + las partes de
hw_profile.py de H3/H6). detect() devuelve un dict rico, cacheado por FINGERPRINT
de hardware (gpu_name + driver_version + ffmpeg_version + torch_version) en
DATA_ROOT/cache/hw_profile.json — si cualquier componente cambia, re-detecta.

Probes (nivel "usable" = encode/decode REAL de prueba, no solo "está listado"):
  - NVENC: encode de 1s con h264_nvenc; si falla se clasifica el motivo (H6).
  - NVDEC: decode hwaccel cuda de un input sintético.
  - QSV / AMF: encode best-effort de 1s con h264_qsv / h264_amf.

Lo usan (firmas viejas intactas, delegan a recommend internamente):
  - extract_clips / cut_silences / long_form_pipeline (post-fx): ffmpeg_video_args().
  - transcribe.py: whisper_device() → (device, compute_type).
  - long_form_pipeline: render_workers().

CLI:
  python hw_profile.py          → resumen legible (y re-detecta)
  python hw_profile.py --json   → dict completo en JSON
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from config import DATA_ROOT, FFMPEG_PATH

_CACHE = DATA_ROOT / "cache" / "hw_profile.json"
_CACHE_TTL = 7 * 24 * 3600  # tope de frescura aunque el fingerprint no cambie
_profile: dict | None = None  # memo por proceso

# Marca de sesión: si el fallback runtime de H3 fuerza x264, vive aquí (memoria,
# no se persiste al cache) para que ffmpeg_full_args/ffmpeg_video_args caigan a
# libx264 el resto del proceso.
_force_x264_session: str | None = None


# ---------------------------------------------------------------------------
# Probes de bajo nivel
# ---------------------------------------------------------------------------
def _run(cmd: list[str], timeout: int = 15) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception:  # noqa: BLE001
        return None


def _cores() -> tuple[int, int]:
    """(cores_physical, cores_logical). psutil si está; si no os.cpu_count()//2."""
    logical = os.cpu_count() or 4
    physical = 0
    try:
        import psutil  # noqa: PLC0415

        physical = psutil.cpu_count(logical=False) or 0
    except Exception:  # noqa: BLE001
        physical = 0
    if not physical:
        physical = max(1, logical // 2)
    return int(physical), int(logical)


def _ram_gb() -> float:
    try:
        try:
            import psutil  # noqa: PLC0415

            return round(psutil.virtual_memory().total / 1024**3, 1)
        except Exception:  # noqa: BLE001
            pass
        if sys.platform == "win32":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            st = MEMORYSTATUSEX()
            st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
            return round(st.ullTotalPhys / 1024**3, 1)
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3, 1)
    except Exception:  # noqa: BLE001
        return 8.0


def _ffmpeg_version() -> str:
    r = _run([str(FFMPEG_PATH), "-version"], timeout=10)
    if not r or r.returncode != 0 or not r.stdout:
        return ""
    first = r.stdout.splitlines()[0] if r.stdout.splitlines() else ""
    m = re.search(r"ffmpeg version (\S+)", first)
    return m.group(1) if m else first.strip()


def _torch_info() -> tuple[bool, str, str | None]:
    """(torch_cuda, torch_version, torch_cuda_version|None)."""
    try:
        import torch  # noqa: PLC0415

        ver = getattr(torch, "__version__", "")
        cuda = bool(torch.cuda.is_available())
        cuda_ver = getattr(getattr(torch, "version", None), "cuda", None) if cuda else None
        return cuda, ver, cuda_ver
    except Exception:  # noqa: BLE001
        return False, "", None


def _nvidia_query() -> dict:
    """nvidia-smi: name, driver_version, vram total/free, compute_capability.

    Devuelve {} si no hay GPU NVIDIA (nvidia-smi viene con el driver)."""
    r = _run(
        ["nvidia-smi",
         "--query-gpu=name,driver_version,memory.total,memory.free,compute_cap",
         "--format=csv,noheader,nounits"],
        timeout=10,
    )
    if not r or r.returncode != 0 or not (r.stdout or "").strip():
        return {}
    line = r.stdout.strip().splitlines()[0]
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 5:
        return {}
    name, driver, vram_total, vram_free, comp = parts[:5]
    try:
        vram_total_mb = int(float(vram_total))
    except Exception:  # noqa: BLE001
        vram_total_mb = 0
    try:
        vram_free_mb = int(float(vram_free))
    except Exception:  # noqa: BLE001
        vram_free_mb = 0
    try:
        compute_capability = float(comp)
    except Exception:  # noqa: BLE001
        compute_capability = 0.0
    return {
        "name": name,
        "driver_version": driver,
        "vram_total_mb": vram_total_mb,
        "vram_free_mb": vram_free_mb,
        "compute_capability": compute_capability,
    }


_encoders_text_memo: str | None = None


def _ffmpeg_encoders_text() -> str:
    """stdout de `ffmpeg -encoders`, memoizado por proceso: se invoca ffmpeg UNA
    sola vez aunque _ffmpeg_lists_encoder se llame para nvenc/qsv/amf. '' si falla
    (no se memoiza el fallo, para reintentar). Mantiene QUÉ se detecta; cambia solo
    CÓMO (1 subprocess en vez de 3)."""
    global _encoders_text_memo
    if _encoders_text_memo is not None:
        return _encoders_text_memo
    r = _run([str(FFMPEG_PATH), "-hide_banner", "-encoders"], timeout=15)
    if not r or r.returncode != 0 or not r.stdout:
        return ""
    _encoders_text_memo = r.stdout
    return r.stdout


def _ffmpeg_lists_encoder(encoder: str) -> bool:
    return encoder in _ffmpeg_encoders_text()


def _encode_probe(encoder: str, timeout: int = 30) -> subprocess.CompletedProcess | None:
    """Encode REAL de prueba de ~1s con `encoder` (8 frames sintéticos)."""
    try:
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "probe.mp4"
            r = subprocess.run(
                [str(FFMPEG_PATH), "-y", "-v", "error",
                 "-f", "lavfi", "-i", "color=c=black:s=320x240:r=8:d=1",
                 "-c:v", encoder, "-frames:v", "8", str(out)],
                capture_output=True, text=True, timeout=timeout,
            )
            ok = r.returncode == 0 and out.exists() and out.stat().st_size > 0
            # Adjuntar si el archivo existía (para la clasificación de motivo).
            r._probe_file_ok = ok  # type: ignore[attr-defined]
            return r
    except Exception:  # noqa: BLE001
        return None


def _nvenc_works_with_reason() -> tuple[bool, str | None]:
    """Encode real con h264_nvenc → (True, None). Si falla, clasifica el motivo (H6)."""
    r = _encode_probe("h264_nvenc")
    if r is not None and getattr(r, "_probe_file_ok", False):
        return True, None
    stderr = ((r.stderr if r is not None else "") or "").strip()
    low = stderr.lower()
    if "minimum required nvidia driver" in low:
        m = re.search(r"(\d+(?:\.\d+)?)", stderr.split("minimum required nvidia driver", 1)[-1]) \
            if "minimum required nvidia driver" in low else None
        # Buscar la versión requerida en toda la línea relevante.
        if not m:
            m = re.search(r"minimum required nvidia driver[^0-9]*(\d+(?:\.\d+)?)", low)
        req = m.group(1) if m else "más reciente"
        return False, (f"Driver NVIDIA muy viejo. Necesitás {req}+. "
                       "Actualizá desde nvidia.com/Download")
    if "out of memory" in low:
        return False, "GPU sin VRAM libre para NVENC. Cerrá apps que usen GPU."
    if "no nvenc capable devices" in low:
        return False, "Esta GPU no tiene chip NVENC. Render en CPU."
    last = stderr.splitlines()[-1].strip() if stderr.splitlines() else ""
    return False, f"NVENC no disponible: {last[:120]}"


def _nvdec_works() -> bool:
    """Probe de decode hwaccel cuda de un input sintético (lavfi)."""
    try:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "src.mp4"
            # Generar un mp4 chiquito (libx264 / mpeg, sin GPU) para decodearlo con cuda.
            mk = subprocess.run(
                [str(FFMPEG_PATH), "-y", "-v", "error",
                 "-f", "lavfi", "-i", "testsrc=s=320x240:r=8:d=1",
                 "-c:v", "libx264", "-frames:v", "8", str(src)],
                capture_output=True, text=True, timeout=30,
            )
            if mk.returncode != 0 or not src.exists():
                return False
            r = subprocess.run(
                [str(FFMPEG_PATH), "-y", "-v", "error",
                 "-hwaccel", "cuda", "-i", str(src),
                 "-f", "null", "-"],
                capture_output=True, text=True, timeout=30,
            )
            return r.returncode == 0
    except Exception:  # noqa: BLE001
        return False


def _qsv_usable() -> bool:
    r = _encode_probe("h264_qsv")
    return bool(r is not None and getattr(r, "_probe_file_ok", False))


def _amf_usable() -> bool:
    r = _encode_probe("h264_amf")
    return bool(r is not None and getattr(r, "_probe_file_ok", False))


# ---------------------------------------------------------------------------
# Recomendaciones (lógica EXACTA del spec)
# ---------------------------------------------------------------------------
def _recommend(prof: dict) -> dict:
    torch_cuda = bool(prof.get("torch_cuda"))
    nv = prof.get("gpu_nvidia") or {}
    cap = float(nv.get("compute_capability") or 0.0)
    vram_free = int(nv.get("vram_free_mb") or 0)
    vram_total = int(nv.get("vram_total_mb") or 0)
    nvenc_usable = bool(nv.get("nvenc_usable"))
    nvdec_usable = bool(nv.get("nvdec_usable"))
    qsv = bool(prof.get("gpu_intel_qsv_usable"))
    amf = bool(prof.get("gpu_amd_amf_usable"))
    cores_physical = int(prof.get("cores_physical") or 1)
    ram_gb = float(prof.get("ram_gb") or 0.0)

    # whisper_device
    whisper_device = "cuda" if torch_cuda else "cpu"

    # whisper_compute_type
    if torch_cuda and cap >= 7.0:
        whisper_compute_type = "float16"
    elif torch_cuda:
        # Pascal (cap>=6.0, ej GTX 10x0) y cualquier cap más viejo → float32.
        # CRÍTICO: ctranslate2 tira ValueError con float16/int8_float16 en Pascal.
        whisper_compute_type = "float32"
    else:
        whisper_compute_type = "int8"

    # whisper_model
    # NOTA: el spec lista >=5000 → large, pero su propio test #2 (GTX 1080,
    # 6700 MB libres) espera "medium" y el #3 (RTX 4090, 22000) espera el modelo
    # grande. El umbral real vive entre esos dos valores; usamos 8000 MB
    # (el grande necesita ~10 GB de headroom de todos modos) para satisfacer ambos.
    #
    # VELOCIDAD: en lugar de "large-v3" usamos "large-v3-turbo" (decoder podado de
    # 32→4 capas, ~2-3x más rápido en transcripción, +1-2% WER en español =
    # aceptable). Damos el id explícito ct2 para que faster-whisper/whisperx lo
    # resuelvan sin ambigüedad a un modelo CTranslate2 descargable.
    #
    # PRECISIÓN: decidimos por VRAM **TOTAL**, no por la libre. La libre baja cuando hay
    # un render o el desktop usando la GPU, y antes hacía caer la detección (cacheada) a
    # "small" → transcripción imprecisa. El turbo-ct2 pesa ~1.6 GB en fp16, así que entra
    # cómodo en cualquier GPU ≥5 GB; la transcripción normalmente corre ANTES del render.
    # "la más precisa" (pedido del usuario): large-v3 COMPLETO (Systran/faster-whisper-
    # large-v3, ya descargado → offline-safe, máxima fidelidad ES) en GPUs ≥5 GB. Es más
    # lento que el turbo pero el usuario priorizó precisión sobre velocidad. ~3 GB en fp16,
    # entra en 6 GB. GPUs medianas → medium; chicas → small.
    if torch_cuda and vram_total >= 5000:
        whisper_model = "large-v3"
    elif torch_cuda and vram_total >= 3500:
        whisper_model = "medium"
    elif torch_cuda:
        whisper_model = "small"
    elif ram_gb >= 16:
        whisper_model = "small"
    else:
        whisper_model = "base"
    # Override explícito por env (lo respeta transcribe.py).
    env_wm = os.environ.get("VIRAL_WHISPER_MODEL")
    if env_wm:
        whisper_model = env_wm

    # video_encoder
    if nvenc_usable:
        video_encoder = "h264_nvenc"
    elif qsv:
        video_encoder = "h264_qsv"
    elif amf:
        video_encoder = "h264_amf"
    else:
        video_encoder = "libx264"

    # video_decoder_hwaccel
    if nvdec_usable:
        video_decoder_hwaccel = "cuda"
    elif qsv:
        video_decoder_hwaccel = "qsv"
    else:
        video_decoder_hwaccel = "none"

    # ollama_model
    # Con GPU (VRAM) usamos el modelo más grande que entre en la VRAM.
    # SIN GPU (Ollama corre en CPU) el límite no es la RAM sino la VELOCIDAD: un
    # modelo grande igual carga, pero genera lento. Aun así, en un CPU fuerte
    # (muchos núcleos) con RAM holgada, qwen3:8b vale la pena para tareas de
    # razonamiento como el análisis de clips largos (mejor selección + JSON más
    # confiable que 4b). Para CPUs chicas seguimos en 4b/1.7b por velocidad.
    if vram_free >= 16000:
        ollama_model = "qwen3:14b"
    elif vram_free >= 5000:
        ollama_model = "qwen3:8b"
    elif ram_gb >= 24 and cores_physical >= 8:
        # CPU-only fuerte (p.ej. i9/Ryzen 9 con 32 GB): 8b es el sweet spot.
        ollama_model = "qwen3:8b"
    elif ram_gb >= 16:
        ollama_model = "qwen3:4b"
    else:
        ollama_model = "qwen3:1.7b"

    # remotion_workers
    if nvenc_usable:
        remotion_workers = max(1, min(4, cores_physical // 2))
    else:
        remotion_workers = max(1, min(2, cores_physical // 3))

    # ------------------------------------------------------------------
    # VELOCIDAD del render (libx264 de Remotion / post-encode). Exponemos
    # estos valores en recommend para que el render-server (Node) los lea del
    # JSON y los pase EXPLÍCITOS a Remotion, sin cambiar la lógica existente.
    # ------------------------------------------------------------------
    # GPU "usable" para angle: hay GPU NVIDIA (name no vacío) o QSV usable.
    nv_name = str(nv.get("name") or "").strip()
    gpu_usable_for_gl = bool(nv_name or qsv)

    # x264_preset: preset de libx264.
    #  - Sin encoder de hardware usable (video_encoder == "libx264") → el x264 es
    #    el ENTREGABLE final: "veryfast" encodea ~1.5-2.3x más rápido con la MISMA
    #    calidad visual a igual CRF (solo ~10-17% más de tamaño, aceptable).
    #  - Con GPU (nvenc/qsv/amf) → el x264 de Remotion es un intermedio que el
    #    post-encode por hardware re-encodea y se TIRA, así que conviene que sea
    #    lo más rápido posible: "ultrafast".
    # "ultrafast" SOLO con NVENC real (ahí el x264 es un intermedio que el post-encode
    # NVENC re-encodea y se tira). Con QSV/AMF/CPU el post-encode ahora se SALTA (era un
    # doble-encode más lento en iGPU), así que el x264 es el ENTREGABLE final → "veryfast"
    # (rápido y con buena calidad). Antes ponía ultrafast en QSV y dejaba el archivo feo.
    x264_preset = "ultrafast" if nvenc_usable else "veryfast"

    # x264_crf: 24. NO se sube (mantener calidad). Solo se expone el valor que ya
    # se usa para que el render-server lo pase explícito.
    x264_crf = 24

    # chromium_gl: backend OpenGL del Chromium headless de Remotion.
    # CONSERVADOR por default: None = no forzar nada (comportamiento actual de
    # Remotion, swiftshader/swangle). SOLO "angle" (raster por GPU real, más
    # rápido en escenas con blur/sombras) si hay GPU usable Y el usuario hace
    # opt-in explícito con VIRAL_REMOTION_GL=="angle".
    # NUNCA "angle" por default: tiene un memory-leak conocido + posible
    # diferencia sutil de pixel → debe validarse con un test de paridad antes de
    # prenderlo en producción.
    if os.environ.get("VIRAL_REMOTION_GL") == "angle" and gpu_usable_for_gl:
        chromium_gl = "angle"
    else:
        chromium_gl = None

    # ------------------------------------------------------------------
    # MOTION TRACKING (track_subject.py): cada cuánto muestrear la cara y a qué
    # ancho reducir el frame ANTES de detectar. La cara se mueve lento, así que
    # muestrear espaciado + interpolar da una trayectoria igual de fluida con
    # MENOS trabajo. El video final NO se toca; esto solo acelera el cálculo de
    # la trayectoria. SOLO corre para estilos con tracking:true.
    #   - tracking_sample_sec: equipos potentes muestrean más fino (más preciso,
    #     pueden pagarlo); modestos más espaciado; muy modestos aún más.
    #   - tracking_downscale_w: detectMultiScale sobre 480px de ancho es varias
    #     veces más rápido que sobre 1080p, sin diferencia visible al seguir.
    cores_logical = int(prof.get("cores_logical") or cores_physical or 1)
    if ram_gb < 8 or cores_physical < 4:
        # Muy modesto: muestreo bien espaciado (la interpolación lo suaviza).
        tracking_sample_sec = 0.8
        tracking_downscale_w = 400
    elif cores_logical >= 12 and ram_gb >= 16:
        tracking_sample_sec = 0.33
        tracking_downscale_w = 480
    else:
        # Modesto / medio.
        tracking_sample_sec = 0.6
        tracking_downscale_w = 480
    # Overrides explícitos por env (debug / tuning).
    try:
        env_ts = os.environ.get("VIRAL_TRACK_SAMPLE_SEC")
        if env_ts:
            tracking_sample_sec = max(0.05, float(env_ts))
    except Exception:  # noqa: BLE001
        pass
    try:
        env_dw = os.environ.get("VIRAL_TRACK_DOWNSCALE_W")
        if env_dw:
            tracking_downscale_w = max(0, int(env_dw))
    except Exception:  # noqa: BLE001
        pass

    return {
        "whisper_device": whisper_device,
        "whisper_compute_type": whisper_compute_type,
        "whisper_model": whisper_model,
        "video_encoder": video_encoder,
        "video_decoder_hwaccel": video_decoder_hwaccel,
        "ollama_model": ollama_model,
        "remotion_workers": remotion_workers,
        "x264_preset": x264_preset,
        "x264_crf": x264_crf,
        "chromium_gl": chromium_gl,
        "tracking_sample_sec": tracking_sample_sec,
        "tracking_downscale_w": tracking_downscale_w,
    }


# ---------------------------------------------------------------------------
# detect() — dict rico cacheado por fingerprint
# ---------------------------------------------------------------------------
def _fingerprint(prof: dict) -> str:
    nv = prof.get("gpu_nvidia") or {}
    return "|".join([
        str(nv.get("name") or ""),
        str(nv.get("driver_version") or ""),
        str(prof.get("ffmpeg_version") or ""),
        str(prof.get("torch_version") or ""),
    ])


def _detect_full() -> dict:
    cores_physical, cores_logical = _cores()
    ram_gb = _ram_gb()
    ffmpeg_version = _ffmpeg_version()
    torch_cuda, torch_version, torch_cuda_version = _torch_info()

    nvq = _nvidia_query()
    gpu_nvidia: dict | None = None
    if nvq:
        nvenc_available = _ffmpeg_lists_encoder("h264_nvenc")
        if nvenc_available:
            nvenc_usable, nvenc_reason = _nvenc_works_with_reason()
        else:
            nvenc_usable, nvenc_reason = False, "Esta GPU no tiene chip NVENC. Render en CPU."
        nvdec_usable = _nvdec_works() if nvenc_available else False
        gpu_nvidia = {
            "name": nvq.get("name", ""),
            "driver_version": nvq.get("driver_version", ""),
            "vram_total_mb": nvq.get("vram_total_mb", 0),
            "vram_free_mb": nvq.get("vram_free_mb", 0),
            "compute_capability": nvq.get("compute_capability", 0.0),
            "nvenc_available": nvenc_available,
            "nvenc_usable": nvenc_usable,
            "nvenc_unusable_reason": nvenc_reason,
            "nvdec_usable": nvdec_usable,
        }

    # QSV / AMF best-effort: solo si el ffmpeg los lista (evita probes que tardan).
    # Los 3 checks comparten el stdout memoizado de `ffmpeg -encoders` (1 invocación).
    qsv_usable = _qsv_usable() if _ffmpeg_lists_encoder("h264_qsv") else False
    amf_usable = _amf_usable() if _ffmpeg_lists_encoder("h264_amf") else False

    prof = {
        # --- campos nuevos (ricos) ---
        "cores_physical": cores_physical,
        "cores_logical": cores_logical,
        "ram_gb": ram_gb,
        "gpu_nvidia": gpu_nvidia,
        "gpu_intel_qsv_usable": qsv_usable,
        "gpu_amd_amf_usable": amf_usable,
        "ffmpeg_version": ffmpeg_version,
        "torch_version": torch_version,
        "torch_cuda": torch_cuda,
        "torch_cuda_version": torch_cuda_version,
        # --- campos legacy (compat con código viejo / cache previa) ---
        "cores": cores_logical,
        "gpu": (gpu_nvidia or {}).get("name", "") if gpu_nvidia else "",
        "nvenc": bool(gpu_nvidia and gpu_nvidia.get("nvenc_usable")),
        "detected_at": time.time(),
    }
    prof["fingerprint"] = _fingerprint(prof)
    prof["recommend"] = _recommend(prof)
    return prof


def detect(force: bool = False) -> dict:
    """Perfil RICO del equipo (cacheado por fingerprint + memo por proceso).

    El cache se invalida si cambia el fingerprint (gpu_name + driver_version +
    ffmpeg_version + torch_version) o si pasaron más de 7 días."""
    global _profile
    if _profile is not None and not force:
        return _profile
    if not force:
        try:
            cached = json.loads(_CACHE.read_text(encoding="utf-8"))
            fresh = time.time() - float(cached.get("detected_at", 0)) < _CACHE_TTL
            has_new_schema = "recommend" in cached and "fingerprint" in cached
            if fresh and has_new_schema:
                # Validar fingerprint barato (gpu name/driver + ffmpeg + torch).
                cheap_nv = _nvidia_query()
                cheap = {
                    "gpu_nvidia": {"name": cheap_nv.get("name", ""),
                                   "driver_version": cheap_nv.get("driver_version", "")} if cheap_nv else None,
                    "ffmpeg_version": _ffmpeg_version(),
                    "torch_version": _torch_info()[1],
                }
                if _fingerprint(cheap) == cached.get("fingerprint"):
                    _profile = cached
                    return cached
        except Exception:  # noqa: BLE001
            pass
    prof = _detect_full()
    try:
        _CACHE.parent.mkdir(parents=True, exist_ok=True)
        # Escritura ATÓMICA: tmp por-PID + os.replace, para que N subprocesos
        # paralelos no corrompan el JSON al escribir el cache simultáneamente
        # (mismo patrón que postencode.py).
        tmp = _CACHE.with_name(f"{_CACHE.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(prof, indent=2), encoding="utf-8")
        os.replace(tmp, _CACHE)
    except Exception as e:  # noqa: BLE001
        # Visible en stderr: si no cachea, cada proceso re-detecta (~1-2s extra) y
        # conviene saber por qué (audit B3).
        print(f"[hw_profile] no se pudo cachear el perfil: {e}", file=sys.stderr)
    _profile = prof
    return prof


# ---------------------------------------------------------------------------
# Fallback de sesión (H3 runtime)
# ---------------------------------------------------------------------------
def force_x264_for_session(reason: str) -> None:
    """Marca el profile en memoria para que ffmpeg_full_args/ffmpeg_video_args
    caigan a libx264 el resto de la sesión (fallback runtime de H3)."""
    global _force_x264_session
    _force_x264_session = reason or "forzado en runtime"
    print(f"[hw_profile] forzando libx264 esta sesión: {_force_x264_session}", file=sys.stderr)


def _session_forces_x264() -> bool:
    return _force_x264_session is not None or os.environ.get("VIRAL_FORCE_X264") == "1"


# ---------------------------------------------------------------------------
# Args de ffmpeg (delegan a recommend)
# ---------------------------------------------------------------------------
def _video_encoder() -> str:
    if _session_forces_x264():
        return "libx264"
    return detect().get("recommend", {}).get("video_encoder", "libx264")


def ffmpeg_video_args(quality: str = "final") -> list[str]:
    """Args de video adaptativos para ffmpeg (FIRMA LEGACY, intacta).

    quality:
      - "final": calidad extrema (lo que ve el usuario). NVENC p5/cq19 ≈ x264 crf18.
      - "fast":  intermedios que se re-encodean después (velocidad sobre tamaño).
    """
    encoder = _video_encoder()
    if encoder == "h264_nvenc":
        if quality == "fast":
            return ["-c:v", "h264_nvenc", "-preset", "p1", "-rc", "vbr", "-cq", "28", "-b:v", "0"]
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0",
                "-spatial-aq", "1", "-temporal-aq", "1"]
    if encoder == "h264_qsv":
        if quality == "fast":
            return ["-c:v", "h264_qsv", "-global_quality", "28", "-preset", "veryfast"]
        return ["-c:v", "h264_qsv", "-global_quality", "19", "-preset", "slow"]
    if encoder == "h264_amf":
        if quality == "fast":
            return ["-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "28", "-qp_p", "28"]
        return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "19", "-qp_p", "19"]
    if quality == "fast":
        return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23"]
    return ["-c:v", "libx264", "-preset", "fast", "-crf", "18"]


def ffmpeg_full_args(input_path: str | None = None, quality: str = "final") -> dict:
    """Args completos de ffmpeg según recommend (H3).

    Retorna {input_args, video_args, container_args}:
      - input_args:   -hwaccel cuda/-hwaccel_output_format cuda si decoder=cuda y
                      hay input_path; (qsv análogo). Van ANTES del -i.
      - video_args:   encoder nvenc/qsv/amf/libx264 con los presets del spec.
      - container_args: -movflags +faststart.
    """
    rec = detect().get("recommend", {})
    decoder = "none" if _session_forces_x264() else rec.get("video_decoder_hwaccel", "none")
    input_args: list[str] = []
    if input_path:
        if decoder == "cuda":
            input_args = ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]
        elif decoder == "qsv":
            input_args = ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"]
    return {
        "input_args": input_args,
        "video_args": ffmpeg_video_args(quality),
        "container_args": ["-movflags", "+faststart"],
    }


# ---------------------------------------------------------------------------
# Whisper / workers (firmas legacy, delegan a recommend)
# ---------------------------------------------------------------------------
def whisper_device() -> tuple[str, str]:
    """(device, compute_type) para WhisperX (FIRMA LEGACY, intacta)."""
    override = os.environ.get("VIRAL_WHISPER_DEVICE")
    if override in ("cpu", "cuda"):
        if override == "cuda":
            # Respetar el compute_type recomendado (float16 en Turing+, float32 en Pascal).
            rec = detect().get("recommend", {})
            ct = rec.get("whisper_compute_type")
            return "cuda", (ct if ct in ("float16", "float32") else "float16")
        return "cpu", "int8"
    rec = detect().get("recommend", {})
    return rec.get("whisper_device", "cpu"), rec.get("whisper_compute_type", "int8")


def render_workers() -> int:
    """Renders de Remotion en paralelo (largos). Override LF_RENDER_WORKERS."""
    override = os.environ.get("LF_RENDER_WORKERS")
    if override and override.isdigit():
        return max(1, min(4, int(override)))
    return max(1, int(detect().get("recommend", {}).get("remotion_workers", 1)))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _print_summary(p: dict) -> None:
    nv = p.get("gpu_nvidia") or {}
    rec = p.get("recommend", {})
    print(f"cores         : {p.get('cores_physical')} físicos / {p.get('cores_logical')} lógicos")
    print(f"ram_gb        : {p.get('ram_gb')}")
    if nv:
        print(f"gpu nvidia    : {nv.get('name')} (driver {nv.get('driver_version')}, "
              f"cap {nv.get('compute_capability')})")
        print(f"  vram        : {nv.get('vram_free_mb')} libre / {nv.get('vram_total_mb')} MB")
        print(f"  nvenc       : usable={nv.get('nvenc_usable')} "
              f"({nv.get('nvenc_unusable_reason') or 'ok'})")
        print(f"  nvdec       : usable={nv.get('nvdec_usable')}")
    else:
        print("gpu nvidia    : (ninguna)")
    print(f"qsv / amf     : {p.get('gpu_intel_qsv_usable')} / {p.get('gpu_amd_amf_usable')}")
    print(f"ffmpeg        : {p.get('ffmpeg_version')}")
    print(f"torch         : {p.get('torch_version')} cuda={p.get('torch_cuda')} "
          f"({p.get('torch_cuda_version')})")
    print("--- recommend ---")
    for k, v in rec.items():
        print(f"  {k:22s}: {v}")
    print("--- ffmpeg args ---")
    print("encoder final :", " ".join(ffmpeg_video_args("final")))
    print("encoder fast  :", " ".join(ffmpeg_video_args("fast")))
    print("whisper       :", whisper_device())
    print("render workers:", render_workers())


if __name__ == "__main__":
    p = detect(force=True)
    if "--json" in sys.argv[1:]:
        print(json.dumps(p, indent=2))
    else:
        _print_summary(p)
