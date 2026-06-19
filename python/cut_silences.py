"""Recorta los silencios de un video usando keep_segments del cuts JSON.

Uso:
  python cut_silences.py <video_path> [--cuts <path>] [--out <path>]

Genera <video_path_sin_ext>_cut.mp4 en RAW_DIR (o donde se le indique).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from config import CUTS_DIR, FFMPEG_PATH, RAW_DIR
from hw_profile import ffmpeg_full_args
from extract_clips import source_is_rotated
from lib.ffmpeg_safe_run import safe_ffmpeg


def build_filter(segments: list[dict]) -> str:
    parts = []
    for i, seg in enumerate(segments):
        s, e = seg["start"], seg["end"]
        parts.append(
            f"[0:v]trim=start={s}:end={e},setpts=PTS-STARTPTS[v{i}]"
        )
        parts.append(
            f"[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS[a{i}]"
        )
    inputs = "".join(f"[v{i}][a{i}]" for i in range(len(segments)))
    parts.append(f"{inputs}concat=n={len(segments)}:v=1:a=1[outv][outa]")
    return ";".join(parts)


def cut(video_path: Path, cuts_path: Path, out_path: Path) -> dict:
    cuts = json.loads(cuts_path.read_text(encoding="utf-8"))
    segments = cuts.get("keep_segments") or []
    if not segments:
        raise SystemExit("[cut] keep_segments vacío en cuts.json")

    # Para videos con muchos segmentos (cursos largos), el filter_complex puede ser
    # demasiado largo para la línea de comandos de Windows. Hacemos un fallback:
    # - si <= 100 segmentos: filter_complex inline (rápido)
    # - si > 100: usar concat demuxer (extraer cada segmento + concatenar)
    if len(segments) <= 100:
        return _cut_with_filter_complex(video_path, segments, out_path, cuts.get("duration"))
    return _cut_with_concat_demuxer(video_path, segments, out_path, cuts.get("duration"))


def _cut_with_filter_complex(video_path: Path, segments: list, out_path: Path, original_duration) -> dict:
    filter_complex = build_filter(segments)
    # Encoder adaptativo: NVENC si hay GPU NVIDIA funcional, libx264 si no.
    # CONSERVADOR: este path usa -filter_complex (trim/concat en CPU). NO inyectamos
    # decode hwaccel (input_path=None) porque -hwaccel_output_format cuda entrega
    # frames en VRAM que el filtergraph CPU no puede consumir. Solo adaptamos el
    # ENCODER (video_args) + faststart; safe_ffmpeg cubre el fallback runtime.
    ff = ffmpeg_full_args(input_path=None, quality="final")
    cmd = [
        str(FFMPEG_PATH),
        "-y",
        "-i", str(video_path),
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "[outa]",
        *ff["video_args"],
        "-c:a", "aac",
        "-b:a", "128k",
        *ff["container_args"],
        str(out_path),
    ]
    res = safe_ffmpeg(cmd, input_path=str(video_path))
    if res.returncode != 0:
        raise subprocess.CalledProcessError(res.returncode, cmd, res.stdout, res.stderr)
    total = sum(s["end"] - s["start"] for s in segments)
    return {
        "ok": True,
        "out": str(out_path),
        "segments": len(segments),
        "new_duration_sec": round(total, 3),
        "original_duration_sec": original_duration,
        "method": "filter_complex",
    }


def _cut_with_concat_demuxer(video_path: Path, segments: list, out_path: Path, original_duration) -> dict:
    """Para muchos segmentos: extraer cada uno y concatenar con demuxer."""
    import tempfile
    import os

    work_dir = Path(tempfile.mkdtemp(prefix="hermes_cut_"))
    list_file = work_dir / "list.txt"
    chunk_paths: list[Path] = []
    # Si el source trae bandera de rotación (vertical de celular), NO usar decode por
    # GPU: la rotación se saltearía y el clean.mp4 saldría girado. Con decode CPU
    # ffmpeg la hornea en los píxeles.
    src_rotated = source_is_rotated(video_path)

    try:
        for i, seg in enumerate(segments):
            start, end = float(seg["start"]), float(seg["end"])
            duration = end - start
            chunk_path = work_dir / f"chunk_{i:05d}.mp4"
            # Trim simple por chunk. Decode hwaccel solo si el source NO está rotado.
            ff = ffmpeg_full_args(
                input_path=(None if src_rotated else str(video_path)), quality="fast"
            )
            cmd = [
                str(FFMPEG_PATH),
                "-y",
                *ff["input_args"],
                "-ss", f"{start:.3f}",
                "-i", str(video_path),
                "-t", f"{duration:.3f}",
                *ff["video_args"],
                "-c:a", "aac",
                "-b:a", "128k",
                "-avoid_negative_ts", "make_zero",
                str(chunk_path),
            ]
            res = safe_ffmpeg(cmd, input_path=str(video_path))
            if res.returncode != 0:
                raise subprocess.CalledProcessError(res.returncode, cmd, res.stdout, res.stderr)
            chunk_paths.append(chunk_path)
            if (i + 1) % 20 == 0:
                print(f"[cut] {i + 1}/{len(segments)} chunks", file=sys.stderr)

        # Generar list file (formato concat demuxer)
        with open(list_file, "w", encoding="utf-8") as f:
            for cp in chunk_paths:
                # Escapar single quotes para ffmpeg
                safe = str(cp).replace("'", "\\'")
                f.write(f"file '{safe}'\n")

        # Concatenar
        cmd = [
            str(FFMPEG_PATH),
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            str(out_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    finally:
        # Limpiar archivos temporales
        for cp in chunk_paths:
            try:
                cp.unlink()
            except OSError:
                pass
        try:
            list_file.unlink()
        except OSError:
            pass
        try:
            work_dir.rmdir()
        except OSError:
            pass

    total = sum(s["end"] - s["start"] for s in segments)
    return {
        "ok": True,
        "out": str(out_path),
        "segments": len(segments),
        "new_duration_sec": round(total, 3),
        "original_duration_sec": original_duration,
        "method": "concat_demuxer",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", help="Path al video raw (absoluto o nombre en raw/)")
    parser.add_argument("--cuts", help="Path al cuts JSON (default: cuts/<video>.json)")
    parser.add_argument("--out", help="Path output mp4 (default: raw/<video>_cut.mp4)")
    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.is_absolute() and not video_path.exists():
        video_path = RAW_DIR / video_path
    if not video_path.exists():
        print(f"[error] video no encontrado: {video_path}", file=sys.stderr)
        return 1

    cuts_path = (
        Path(args.cuts)
        if args.cuts
        else CUTS_DIR / f"{video_path.stem}.json"
    )
    if not cuts_path.exists():
        print(f"[error] cuts JSON no encontrado: {cuts_path}", file=sys.stderr)
        return 1

    out_path = (
        Path(args.out)
        if args.out
        else video_path.with_name(f"{video_path.stem}_cut.mp4")
    )

    t0 = time.time()
    result = cut(video_path, cuts_path, out_path)
    result["elapsed_sec"] = round(time.time() - t0, 1)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
