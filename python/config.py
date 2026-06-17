"""Configuración compartida de paths para los scripts Python.

Variables de entorno opcionales:
    VIRAL_DATA_ROOT       — datos del usuario (default: C:\\viral-data\\videos)
    VIRAL_FFMPEG_PATH     — path explícito a ffmpeg.exe
    VIRAL_FFPROBE_PATH    — path explícito a ffprobe.exe
    VIRAL_OLLAMA_URL      — host de Ollama (default: http://localhost:11434)
    VIRAL_OLLAMA_MODEL    — modelo (default: qwen3:1.7b)
    VIRAL_WHISPER_MODEL   — modelo Whisper (default: small)
    VIRAL_WHISPER_LANGUAGE — idioma (default: es)
"""
import os
import sys
from pathlib import Path

# Forzar stdout/stderr a UTF-8. Cuando Node.js (Next.js) spawnea Python con stdio=pipe,
# Python usa locale.getpreferredencoding() que en Windows es cp1252. Caracteres como
# í/á/é/¿/¡ pasan al encoder y salen como '?' o U+FFFD. Esto rompe el JSON con captions
# en español. reconfigure() requiere Python 3.7+.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
except Exception:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _pick_data_root() -> Path:
    override = os.environ.get("VIRAL_DATA_ROOT")
    if override:
        return Path(override)
    # Defaults: viral-data primero, hermes-data como fallback para compat con setup viejo
    candidates = [Path(r"C:\viral-data\videos"), Path(r"C:\hermes-data\videos")]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]


DATA_ROOT = _pick_data_root()

RAW_DIR = DATA_ROOT / "raw"
TRANSCRIPTS_DIR = DATA_ROOT / "transcripts"
CUTS_DIR = DATA_ROOT / "cuts"
RENDERS_DIR = DATA_ROOT / "renders"
PROJECTS_DIR = DATA_ROOT / "projects"
ASSETS_BROLL = DATA_ROOT / "assets" / "broll"
ASSETS_MUSIC = DATA_ROOT / "assets" / "music"
# Carpetas de assets que las APIs/scripts esperan pero ensure_dirs() no creaba →
# paneles vacíos o error al primer uso si la descarga nunca corrió (audit B2).
ASSETS_SFX = DATA_ROOT / "assets" / "sfx"
ASSETS_LOTTIE = DATA_ROOT / "assets" / "lottie" / "noto"
ASSETS_ICONS = DATA_ROOT / "assets" / "icons"
ASSETS_OVERLAYS = DATA_ROOT / "assets" / "overlays"
ASSETS_ILLUSTRATIONS = DATA_ROOT / "assets" / "illustrations"

LONG_FORM_ROOT = DATA_ROOT / "long_form"
LF_ROOT = LONG_FORM_ROOT  # alias: varios scripts importan LF_ROOT
LF_RAW = LONG_FORM_ROOT / "raw"
LF_TRANSCRIPTS = LONG_FORM_ROOT / "transcripts"
LF_CUTS = LONG_FORM_ROOT / "cuts"
LF_CLEAN = LONG_FORM_ROOT / "clean"
LF_PROPOSALS = LONG_FORM_ROOT / "proposals"
LF_CLIPS = LONG_FORM_ROOT / "clips"
LF_PROJECTS = LONG_FORM_ROOT / "projects"
LF_RENDERS = LONG_FORM_ROOT / "renders"
LF_GRAPHICS = LONG_FORM_ROOT / "graphics"  # Modo Gráficos: specs dataViz/kineticHeadlines por clip

OLLAMA_URL = os.environ.get("VIRAL_OLLAMA_URL", "http://localhost:11434")
# OLLAMA_MODEL se define cerca del FINAL de este módulo (_ollama_model()), DESPUÉS de
# que DATA_ROOT/FFMPEG_PATH existan, porque ahora se autodetecta según la VRAM vía
# hw_profile.detect() (import LAZY para evitar el ciclo). Override: VIRAL_OLLAMA_MODEL.


def _detect_ffmpeg(binary: str) -> Path:
    # 1) Override por env. ACEPTA ambos nombres: el NUEVO _EXE (el que exporta el
    #    launcher desktop.exe → lib.rs) y el LEGACY _PATH. ESTE mismatch (launcher
    #    seteaba VIRAL_FFMPEG_EXE pero config leía VIRAL_FFMPEG_PATH) hacía que
    #    Python NO encontrara ffmpeg → FileNotFoundError [WinError 2] al extraer el
    #    audio → "no transcribe". Era el bug bloqueante real.
    for env_var in (f"VIRAL_{binary.upper()}_EXE", f"VIRAL_{binary.upper()}_PATH"):
        override = os.environ.get(env_var)
        if override and Path(override).exists():
            return Path(override)

    # 2) Layout BUNDLEADO del paquete: <payload>/tools/ffmpeg/bin/<binary>.exe
    #    (sin sufijo de versión). config.py vive en <payload>/python/, así que el
    #    ffmpeg está al lado. Cubre los entry points que corren SIN el env del launcher.
    bundled = Path(__file__).resolve().parent.parent / "tools" / "ffmpeg" / "bin" / f"{binary}.exe"
    if bundled.exists():
        return bundled

    # 3) Layout viejo de dev: C:\...\tools\ffmpeg-<ver>\bin\<binary>.exe
    tools_dir = DATA_ROOT.parent / "tools"
    if tools_dir.exists():
        for entry in tools_dir.iterdir():
            if entry.is_dir() and entry.name.startswith("ffmpeg-"):
                candidate = entry / "bin" / f"{binary}.exe"
                if candidate.exists():
                    return candidate

    return Path(f"{binary}.exe")


FFMPEG_PATH = _detect_ffmpeg("ffmpeg")
FFPROBE_PATH = _detect_ffmpeg("ffprobe")

# WhisperX (y otras libs) llaman a "ffmpeg" como subprocess esperando que esté en PATH.
# Como nuestro ffmpeg vive en C:\hermes-data\tools\ffmpeg-*\bin\ y no está en el PATH del
# sistema, lo inyectamos acá para que cualquier import de config.py lo arregle.
_ffmpeg_dir = str(FFMPEG_PATH.parent)
if _ffmpeg_dir and _ffmpeg_dir not in os.environ.get("PATH", "").split(os.pathsep):
    os.environ["PATH"] = _ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

WHISPER_LANGUAGE = os.environ.get("VIRAL_WHISPER_LANGUAGE", "es")
# WHISPER_MODEL / WHISPER_DEVICE / WHISPER_COMPUTE_TYPE se autodetectan según el
# hardware (_whisper_defaults(), cerca del final del módulo).

SILENCE_MIN_MS = int(os.environ.get("VIRAL_SILENCE_MIN_MS", "500"))
SILENCE_PAD_MS = int(os.environ.get("VIRAL_SILENCE_PAD_MS", "100"))


def ensure_dirs() -> None:
    for d in [
        RAW_DIR, TRANSCRIPTS_DIR, CUTS_DIR, RENDERS_DIR, PROJECTS_DIR,
        ASSETS_BROLL, ASSETS_MUSIC, ASSETS_SFX, ASSETS_LOTTIE, ASSETS_ICONS, ASSETS_OVERLAYS,
        ASSETS_ILLUSTRATIONS,
    ]:
        d.mkdir(parents=True, exist_ok=True)


def ensure_long_form_dirs() -> None:
    for d in [LF_RAW, LF_TRANSCRIPTS, LF_CUTS, LF_CLEAN, LF_PROPOSALS, LF_CLIPS, LF_PROJECTS, LF_RENDERS, LF_GRAPHICS]:
        d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Auto-config según HARDWARE (Whisper + Ollama)
# ---------------------------------------------------------------------------
# IMPORTANTE: estas funciones importan hw_profile de forma LAZY (dentro del cuerpo,
# no al tope del módulo). hw_profile hace `from config import DATA_ROOT, FFMPEG_PATH`;
# como las llamamos DESPUÉS de definir DATA_ROOT/FFMPEG_PATH (final del módulo),
# esos nombres ya están enlazados cuando hw_profile se importa → no hay ciclo.
def _whisper_defaults() -> tuple[str, str, str]:
    """(model, device, compute_type) según el hardware, con override por env.

    Lee hw_profile.detect()["recommend"]; el env VIRAL_WHISPER_MODEL/_DEVICE/
    _COMPUTE_TYPE SIEMPRE gana sobre lo recomendado. Si detect() falla por lo que
    sea, cae a defaults seguros y universales ("small"/"cpu"/"int8").

    detect() corre probes reales la 1ª vez (luego cachea por fingerprint): correr
    esto una vez al importar config está bien.
    """
    model = device = compute_type = None
    try:
        from hw_profile import detect  # LAZY: evita el ciclo (ver nota arriba)

        rec = detect().get("recommend", {})
        model = rec.get("whisper_model")
        device = rec.get("whisper_device")
        compute_type = rec.get("whisper_compute_type")
    except Exception as e:  # noqa: BLE001 — sin hw_profile/torch/etc → defaults
        print(f"[config] no se pudo autodetectar Whisper ({e}); uso defaults CPU.",
              file=sys.stderr)

    # Defaults seguros si detect() no dio nada.
    model = model or "small"
    device = device or "cpu"
    compute_type = compute_type or "int8"

    # Override por env (gana sobre la recomendación).
    model = os.environ.get("VIRAL_WHISPER_MODEL", model)
    device = os.environ.get("VIRAL_WHISPER_DEVICE", device)
    compute_type = os.environ.get("VIRAL_WHISPER_COMPUTE_TYPE", compute_type)
    return model, device, compute_type


def _ollama_model() -> str:
    """Modelo de Ollama autodetectado por hardware (hw_profile), override VIRAL_OLLAMA_MODEL.

    hw_profile.recommend escala el modelo: qwen3:1.7b (RAM baja) → qwen3:4b (≥16 GB) →
    qwen3:8b (CPU fuerte con ≥24 GB, o GPU con ≥5 GB VRAM) → qwen3:14b (≥16 GB VRAM).
    Default seguro qwen3:1.7b (corre en CPU pura) si detect() falla."""
    override = os.environ.get("VIRAL_OLLAMA_MODEL")
    if override:
        return override
    try:
        from hw_profile import detect  # LAZY: evita el ciclo

        model = detect().get("recommend", {}).get("ollama_model")
        if model:
            return model
    except Exception as e:  # noqa: BLE001
        print(f"[config] no se pudo autodetectar Ollama ({e}); uso qwen3:1.7b.",
              file=sys.stderr)
    return "qwen3:1.7b"


WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE = _whisper_defaults()
OLLAMA_MODEL = _ollama_model()
