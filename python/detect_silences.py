"""Detecta silencios > N ms para sugerir jump cuts.

Uso:
  python detect_silences.py <video.mp4> [--min-ms 500]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from lib import proc as _proc
from config import (
    CUTS_DIR,
    FFMPEG_PATH,
    RAW_DIR,
    SILENCE_MIN_MS,
    SILENCE_PAD_MS,
    ensure_dirs,
)


def extract_audio(video_path: Path, out_wav: Path) -> None:
    cmd = [
        str(FFMPEG_PATH),
        "-y",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(out_wav),
    ]
    # Con timeout: sin el, un ffmpeg colgado (archivo corrupto, disco que no
    # responde) deja este paso esperando para siempre. Es el mecanismo exacto que
    # documenta lib/proc.py y que ya provoco un "la app dejo de responder".
    _proc.run(cmd, timeout=_proc.FFMPEG_TIMEOUT, check=True, capture_output=True)


def detect(video_path: Path, min_silence_ms: int = SILENCE_MIN_MS) -> dict[str, Any]:
    """Devuelve dict con segments de voz y silencios detectados."""
    import wave
    import numpy as np
    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "audio.wav"
        extract_audio(video_path, wav_path)

        print("[silences] cargando modelo silero-vad...", file=sys.stderr)
        model = load_silero_vad()

        print("[silences] leyendo audio (wave + numpy)...", file=sys.stderr)
        with wave.open(str(wav_path), "rb") as wf:
            sample_rate = wf.getframerate()
            n_frames = wf.getnframes()
            raw = wf.readframes(n_frames)
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        audio = torch.from_numpy(samples)

        print("[silences] detectando voz...", file=sys.stderr)
        speech_timestamps = get_speech_timestamps(
            audio,
            model,
            sampling_rate=16000,
            return_seconds=True,
            min_silence_duration_ms=min_silence_ms,
            min_speech_duration_ms=200,
        )

        duration = len(audio) / 16000.0
        pad = SILENCE_PAD_MS / 1000.0

        speech_segments = [
            {
                "start": round(max(0.0, float(s["start"]) - pad), 3),
                "end": round(min(duration, float(s["end"]) + pad), 3),
            }
            for s in speech_timestamps
        ]

        silences: list[dict[str, Any]] = []
        prev_end = 0.0
        for seg in speech_segments:
            if seg["start"] - prev_end >= min_silence_ms / 1000.0:
                silences.append(
                    {
                        "start": round(prev_end, 3),
                        "end": round(seg["start"], 3),
                        "reason": "silence",
                    }
                )
            prev_end = seg["end"]
        if duration - prev_end >= min_silence_ms / 1000.0:
            silences.append(
                {"start": round(prev_end, 3), "end": round(duration, 3), "reason": "silence_trailing"}
            )

        return {
            "video": video_path.name,
            "duration": round(duration, 3),
            "min_silence_ms": min_silence_ms,
            "keep_segments": speech_segments,
            "silences": silences,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", help="Path al video (absoluto o nombre en raw/)")
    parser.add_argument("--min-ms", type=int, default=SILENCE_MIN_MS, help="Silencio mínimo a detectar")
    parser.add_argument("--out", help="Path JSON salida (default: cuts/<video>.json)")
    args = parser.parse_args()

    ensure_dirs()

    video_path = Path(args.video)
    if not video_path.is_absolute() and not video_path.exists():
        video_path = RAW_DIR / video_path

    if not video_path.exists():
        print(f"[error] video no encontrado: {video_path}", file=sys.stderr)
        return 1

    out_path = Path(args.out) if args.out else CUTS_DIR / f"{video_path.stem}.json"

    t0 = time.time()
    result = detect(video_path, args.min_ms)
    elapsed = time.time() - t0
    result["meta"] = {"elapsed_sec": round(elapsed, 1)}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "out": str(out_path),
        "keep_segments": len(result["keep_segments"]),
        "silences": len(result["silences"]),
        "elapsed_sec": round(elapsed, 1),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
