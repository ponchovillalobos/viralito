"""Tests del detector de hardware unificado (hw_profile.py).

Mockean las funciones de probe con monkeypatch para no depender de GPU real:
construimos un dict de perfil "crudo" (lo que devolverían las queries/probes) y
verificamos que _recommend() decide EXACTO lo que pide el spec. Además se ejercita
detect() completo monkeypatcheando cada probe de bajo nivel.
"""
import os
import pathlib
import sys
import tempfile

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import hw_profile  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers: arman un perfil "crudo" y corren detect() con probes mockeados
# ---------------------------------------------------------------------------
def _run_detect(monkeypatch, *, gpu, ram_gb, torch_cuda,
                nvenc_usable=False, nvenc_reason=None, nvdec_usable=False,
                vram_free=0, vram_total=0, compute_cap=0.0, driver="",
                cores_physical=8, cores_logical=16,
                qsv=False, amf=False, nvenc_available=None):
    """gpu=None → CPU-only. gpu="RTX..." → hay GPU NVIDIA."""
    if nvenc_available is None:
        nvenc_available = bool(gpu)

    monkeypatch.setattr(hw_profile, "_cores", lambda: (cores_physical, cores_logical))
    monkeypatch.setattr(hw_profile, "_ram_gb", lambda: ram_gb)
    monkeypatch.setattr(hw_profile, "_ffmpeg_version", lambda: "6.1.1")
    monkeypatch.setattr(hw_profile, "_torch_info",
                        lambda: (torch_cuda, "2.3.0", "12.6" if torch_cuda else None))

    if gpu:
        monkeypatch.setattr(hw_profile, "_nvidia_query", lambda: {
            "name": gpu, "driver_version": driver,
            "vram_total_mb": vram_total, "vram_free_mb": vram_free,
            "compute_capability": compute_cap,
        })
    else:
        monkeypatch.setattr(hw_profile, "_nvidia_query", lambda: {})

    monkeypatch.setattr(hw_profile, "_ffmpeg_lists_encoder",
                        lambda enc: nvenc_available if enc == "h264_nvenc" else False)
    monkeypatch.setattr(hw_profile, "_nvenc_works_with_reason",
                        lambda: (nvenc_usable, nvenc_reason))
    monkeypatch.setattr(hw_profile, "_nvdec_works", lambda: nvdec_usable)
    monkeypatch.setattr(hw_profile, "_qsv_usable", lambda: qsv)
    monkeypatch.setattr(hw_profile, "_amf_usable", lambda: amf)

    # No tocar disco ni memo entre tests. OJO: la versión anterior usaba
    # `pathlib.Path(os.devnull).parent`, que en Windows es "." (os.devnull == "nul",
    # sin carpeta) → el test ESCRIBÍA `no_existe_hw_profile.json` en el cwd desde el
    # que se corriera pytest, ensuciando el repo. Usamos un temporal real del SO.
    monkeypatch.setattr(
        hw_profile, "_CACHE",
        pathlib.Path(tempfile.gettempdir()) / "viralito_test_no_existe_hw_profile.json",
    )
    hw_profile._profile = None
    hw_profile._force_x264_session = None
    return hw_profile.detect(force=True)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in ("VIRAL_FORCE_X264", "VIRAL_WHISPER_DEVICE",
                "LF_RENDER_WORKERS", "VIRAL_WHISPER_COMPUTE_TYPE",
                "VIRAL_WHISPER_MODEL", "VIRAL_REMOTION_GL"):
        monkeypatch.delenv(var, raising=False)
    yield
    hw_profile._profile = None
    hw_profile._force_x264_session = None


# ---------------------------------------------------------------------------
# 1) CPU-only
# ---------------------------------------------------------------------------
def test_cpu_only(monkeypatch):
    prof = _run_detect(monkeypatch, gpu=None, ram_gb=8.0, torch_cuda=False,
                       cores_physical=4, cores_logical=8)
    rec = prof["recommend"]
    assert rec["whisper_model"] == "base"
    assert rec["video_encoder"] == "libx264"
    assert rec["ollama_model"] == "qwen3:1.7b"
    assert rec["whisper_compute_type"] == "int8"
    assert rec["whisper_device"] == "cpu"
    assert rec["video_decoder_hwaccel"] == "none"
    assert prof["gpu_nvidia"] is None
    # VELOCIDAD: sin encoder de hardware, el x264 es el entregable → veryfast
    assert rec["x264_preset"] == "veryfast"
    assert rec["x264_crf"] == 24
    # sin GPU, chromium_gl es None aunque se pida angle (no aplica)
    assert rec["chromium_gl"] is None
    # firmas legacy
    assert hw_profile.whisper_device() == ("cpu", "int8")
    assert hw_profile.ffmpeg_video_args("final")[:2] == ["-c:v", "libx264"]


# ---------------------------------------------------------------------------
# 2) GTX 1080, driver viejo (NVENC no usable), Pascal cap 6.1
# ---------------------------------------------------------------------------
def test_gtx1080_driver_viejo(monkeypatch):
    prof = _run_detect(
        monkeypatch, gpu="NVIDIA GeForce GTX 1080", ram_gb=16.0, torch_cuda=True,
        nvenc_usable=False, nvenc_reason="Driver < 570",
        nvdec_usable=False, vram_free=6700, vram_total=8192,
        compute_cap=6.1, driver="452.06",
        cores_physical=8, cores_logical=16,
    )
    rec = prof["recommend"]
    # PRECISIÓN sobre velocidad (commit c475af7, pedido explícito del usuario "la
    # transcripción más precisa"): con VRAM TOTAL >= 5 GB se usa large-v3 COMPLETO,
    # no el turbo ni medium. La 1080 tiene 8 GB → large-v3. Decidir por VRAM TOTAL y
    # no por la LIBRE fue el fix del bug que cacheaba "small" con la GPU ocupada.
    # Ver python/hw_profile.py:303-306. NO revertir el código para que pase el test.
    assert rec["whisper_model"] == "large-v3"
    assert rec["video_encoder"] == "libx264"
    assert rec["whisper_device"] == "cuda"
    assert rec["whisper_compute_type"] == "float32"  # CRÍTICO en Pascal
    assert prof["gpu_nvidia"]["nvenc_usable"] is False
    assert prof["gpu_nvidia"]["nvenc_unusable_reason"] == "Driver < 570"
    # legacy: device cuda pero compute_type float32 (no float16) en Pascal
    assert hw_profile.whisper_device() == ("cuda", "float32")


# ---------------------------------------------------------------------------
# 3) RTX 4090, todo usable, Ada cap 8.9
# ---------------------------------------------------------------------------
def test_rtx4090(monkeypatch):
    prof = _run_detect(
        monkeypatch, gpu="NVIDIA GeForce RTX 4090", ram_gb=64.0, torch_cuda=True,
        nvenc_usable=True, nvenc_reason=None, nvdec_usable=True,
        vram_free=22000, vram_total=24564, compute_cap=8.9, driver="555.99",
        cores_physical=16, cores_logical=32,
    )
    rec = prof["recommend"]
    # PRECISIÓN sobre velocidad (commit c475af7): con VRAM TOTAL >= 5 GB va large-v3
    # COMPLETO. El turbo era más rápido pero el usuario priorizó fidelidad en español;
    # el costo se paga 1 vez por video. Override por VIRAL_WHISPER_MODEL.
    # Ver python/hw_profile.py:303-306. NO revertir el código para que pase el test.
    assert rec["whisper_model"] == "large-v3"
    assert rec["video_encoder"] == "h264_nvenc"
    assert rec["ollama_model"] == "qwen3:14b"
    assert rec["whisper_compute_type"] == "float16"
    assert rec["video_decoder_hwaccel"] == "cuda"
    assert rec["remotion_workers"] == min(4, 16 // 2)
    # con GPU el x264 (intermedio que se re-encodea) es ultrafast; crf fijo 24
    assert rec["x264_preset"] == "ultrafast"
    assert rec["x264_crf"] == 24
    # chromium_gl None por default (sin el env de opt-in), aunque haya GPU usable
    assert rec["chromium_gl"] is None
    # legacy
    assert hw_profile.whisper_device() == ("cuda", "float16")
    assert hw_profile.ffmpeg_video_args("final")[:2] == ["-c:v", "h264_nvenc"]
    full = hw_profile.ffmpeg_full_args(input_path="in.mp4", quality="final")
    assert full["input_args"] == ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]
    assert full["container_args"] == ["-movflags", "+faststart"]
    assert full["video_args"][:2] == ["-c:v", "h264_nvenc"]


# ---------------------------------------------------------------------------
# Extras: fallback de sesión y override de env
# ---------------------------------------------------------------------------
def test_force_x264_for_session(monkeypatch):
    prof = _run_detect(
        monkeypatch, gpu="NVIDIA GeForce RTX 4090", ram_gb=64.0, torch_cuda=True,
        nvenc_usable=True, nvdec_usable=True, vram_free=22000, vram_total=24564,
        compute_cap=8.9, cores_physical=16, cores_logical=32,
    )
    assert prof["recommend"]["video_encoder"] == "h264_nvenc"
    hw_profile.force_x264_for_session("test")
    assert hw_profile.ffmpeg_video_args("final")[:2] == ["-c:v", "libx264"]
    full = hw_profile.ffmpeg_full_args(input_path="in.mp4")
    assert full["input_args"] == []  # decoder cae a none
    assert full["video_args"][:2] == ["-c:v", "libx264"]


def test_env_force_x264(monkeypatch):
    _run_detect(
        monkeypatch, gpu="NVIDIA GeForce RTX 4090", ram_gb=64.0, torch_cuda=True,
        nvenc_usable=True, nvdec_usable=True, vram_free=22000, vram_total=24564,
        compute_cap=8.9, cores_physical=16, cores_logical=32,
    )
    monkeypatch.setenv("VIRAL_FORCE_X264", "1")
    assert hw_profile.ffmpeg_video_args("fast")[:2] == ["-c:v", "libx264"]


def test_render_workers_override(monkeypatch):
    _run_detect(monkeypatch, gpu=None, ram_gb=8.0, torch_cuda=False,
                cores_physical=4, cores_logical=8)
    monkeypatch.setenv("LF_RENDER_WORKERS", "3")
    assert hw_profile.render_workers() == 3


# ---------------------------------------------------------------------------
# chromium_gl: opt-in explícito (env) + GPU usable → "angle"; si no, None
# ---------------------------------------------------------------------------
def test_chromium_gl_angle_optin_con_gpu(monkeypatch):
    # El env se lee dentro de _recommend en tiempo de detect(): setear ANTES.
    monkeypatch.setenv("VIRAL_REMOTION_GL", "angle")
    prof = _run_detect(
        monkeypatch, gpu="NVIDIA GeForce RTX 4090", ram_gb=64.0, torch_cuda=True,
        nvenc_usable=True, nvdec_usable=True, vram_free=22000, vram_total=24564,
        compute_cap=8.9, cores_physical=16, cores_logical=32,
    )
    assert prof["recommend"]["chromium_gl"] == "angle"


def test_chromium_gl_angle_sin_gpu_es_none(monkeypatch):
    # opt-in pedido pero sin GPU usable → NO se prende angle.
    monkeypatch.setenv("VIRAL_REMOTION_GL", "angle")
    prof = _run_detect(monkeypatch, gpu=None, ram_gb=16.0, torch_cuda=False,
                       cores_physical=8, cores_logical=16)
    assert prof["recommend"]["chromium_gl"] is None


def test_chromium_gl_sin_optin_es_none(monkeypatch):
    # GPU usable pero sin el env de opt-in → None (conservador por default).
    prof = _run_detect(
        monkeypatch, gpu="NVIDIA GeForce RTX 4090", ram_gb=64.0, torch_cuda=True,
        nvenc_usable=True, nvdec_usable=True, vram_free=22000, vram_total=24564,
        compute_cap=8.9, cores_physical=16, cores_logical=32,
    )
    assert prof["recommend"]["chromium_gl"] is None


def test_whisper_model_env_override(monkeypatch):
    monkeypatch.setenv("VIRAL_WHISPER_MODEL", "tiny")
    prof = _run_detect(
        monkeypatch, gpu="NVIDIA GeForce RTX 4090", ram_gb=64.0, torch_cuda=True,
        nvenc_usable=True, nvdec_usable=True, vram_free=22000, vram_total=24564,
        compute_cap=8.9, cores_physical=16, cores_logical=32,
    )
    assert prof["recommend"]["whisper_model"] == "tiny"
