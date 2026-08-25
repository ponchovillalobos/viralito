"""BUMPER CONCAT (F2.b) — concatena [intro] + main + [outro] con ffmpeg, en post.

DISEÑO SEGURO: el bumper es una composición Remotion SEPARADA (BrandBumper). Este
helper solo pega los mp4 ya renderizados al render principal, SIN tocar ViralVideo ni
el pipeline de render de los clips. Normaliza todo a las dimensiones/fps del main y le
pone audio silencioso al bumper (que no tiene) para que el concat filter cuadre.

Uso:
  python bumper_concat.py --main main.mp4 --out final.mp4 [--intro intro.mp4] [--outro outro.mp4]

Si no se pasa ni --intro ni --outro, copia main→out (no-op seguro). Nunca corrompe el
main: escribe a un temporal y solo reemplaza si ffmpeg salió ok.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def ffmpeg_bin() -> str:
    override = os.environ.get("VIRAL_FFMPEG_EXE")
    if override and Path(override).exists():
        return override
    # Ruta típica del proyecto; si no, confiar en PATH.
    guess = Path("C:/viral-data/tools/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe")
    return str(guess) if guess.exists() else "ffmpeg"


def ffprobe_bin() -> str:
    fb = ffmpeg_bin()
    p = Path(fb)
    if p.name.startswith("ffmpeg"):
        cand = p.with_name(p.name.replace("ffmpeg", "ffprobe"))
        if cand.exists():
            return str(cand)
    return "ffprobe"


def probe(path: str) -> dict:
    """(width, height, fps, has_audio, duration) del video."""
    out = subprocess.run(
        [ffprobe_bin(), "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    info = {"width": 1080, "height": 1920, "fps": 30.0, "has_audio": False, "duration": 0.0}
    try:
        data = json.loads(out.stdout)
        for s in data.get("streams", []):
            if s.get("codec_type") == "video":
                info["width"] = int(s.get("width", info["width"]))
                info["height"] = int(s.get("height", info["height"]))
                fr = s.get("r_frame_rate", "30/1")
                if "/" in fr:
                    a, b = fr.split("/")
                    info["fps"] = float(a) / float(b) if float(b) else 30.0
            elif s.get("codec_type") == "audio":
                info["has_audio"] = True
        info["duration"] = float(data.get("format", {}).get("duration", 0.0) or 0.0)
    except Exception:  # noqa: BLE001
        pass
    return info


def main() -> None:
    ap = argparse.ArgumentParser(description="Concatena intro/outro de marca al render")
    ap.add_argument("--main", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--intro", default="")
    ap.add_argument("--outro", default="")
    args = ap.parse_args()

    segments = []
    if args.intro and Path(args.intro).exists():
        segments.append(args.intro)
    segments.append(args.main)  # el main SIEMPRE va en el medio
    main_idx = len(segments) - 1
    if args.outro and Path(args.outro).exists():
        segments.append(args.outro)

    # Sin bumpers → copiar main→out (no-op seguro).
    if len(segments) == 1:
        if os.path.abspath(args.main) != os.path.abspath(args.out):
            shutil.copyfile(args.main, args.out)
        print(json.dumps({"ok": True, "segments": 1, "note": "sin bumper, copia directa"}))
        return

    main_info = probe(args.main)
    W, H, FPS = main_info["width"], main_info["height"], round(main_info["fps"]) or 30

    ff = ffmpeg_bin()
    inputs = []
    for seg in segments:
        inputs += ["-i", seg]
    # Fuente de audio silencioso (para los bumpers, que no traen audio).
    inputs += ["-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=48000"]
    silent_idx = len(segments)

    # filter_complex: normalizar cada video a WxH+fps+yuv420p; audio real del segmento
    # si lo tiene, si no silencio recortado a su duración.
    parts = []
    concat_labels = []
    for i, seg in enumerate(segments):
        parts.append(
            f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},format=yuv420p[v{i}]"
        )
        info = main_info if i == main_idx else probe(seg)
        if info["has_audio"]:
            parts.append(f"[{i}:a]aresample=48000,asetpts=PTS-STARTPTS[a{i}]")
        else:
            dur = max(0.1, info["duration"] or 1.4)
            parts.append(
                f"[{silent_idx}]atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,"
                f"aformat=sample_rates=48000:channel_layouts=stereo[a{i}]"
            )
        concat_labels.append(f"[v{i}][a{i}]")

    n = len(segments)
    parts.append("".join(concat_labels) + f"concat=n={n}:v=1:a=1[v][a]")
    filter_complex = ";".join(parts)

    tmp_out = args.out + ".__bumper.mp4"
    cmd = [
        ff, "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        tmp_out,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0 or not Path(tmp_out).exists():
        print(json.dumps({"ok": False, "error": proc.stderr[-400:]}))
        sys.exit(1)
    # Reemplazo atómico-ish: solo tras éxito.
    os.replace(tmp_out, args.out)
    print(json.dumps({"ok": True, "segments": n, "width": W, "height": H, "fps": FPS}))


if __name__ == "__main__":
    main()
