"""SUPERCUT — highlight reel con los TOP momentos de un video largo (Mejora B).

Junta los N clips MÁS VIRALES ya renderizados (mismo estilo → look consistente) en
UN solo MP4: el "lo mejor de" que Riverside/Spikes venden como Magic Clips reel.
Cortes duros (el estilo viral 2026), loudness -14 LUFS al final.

Cómo elige:
  1. Lee proposals/{videoId}.json (ya ordenado por viralityScore).
  2. Para cada clip del top, busca su render {videoId}_cNN_{slug}_{style}.mp4.
  3. Usa el ESTILO con más renders disponibles entre los top (consistencia visual).
  4. Concatena con ffmpeg (concat demuxer + re-encode adaptativo de hw_profile:
     los renders pueden venir de encoders distintos — x264/NVENC — y el stream-copy
     con params mezclados produce archivos corruptos; re-encodear es lo seguro).
  5. Escribe LF_RENDERS/{videoId}_supercut_{style}.mp4 + su project JSON en
     LF_PROJECTS (caption = hooks del top) para que aparezca en "Mis videos".

Uso:
  python supercut.py <videoId> [--top 5] [--max-seconds 120] [--style editorial]
  → última línea JSON: {"ok": true, "path": "...", "clips": 5, "seconds": 98.2}
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from config import FFMPEG_PATH, FFPROBE_PATH, LF_PROPOSALS, LF_RENDERS, LF_PROJECTS
from hw_profile import ffmpeg_full_args
from normalize_audio import normalize as normalize_loudness

STYLE_SUFFIX = re.compile(
    r"_(editorial(?:_full|_broll)?|supreme|hype(?:_max)?(?:_sfx)?|silent|punch|cinematic_pro|"
    r"broll_(?:full|pip)|text_behind|pop_reels|graphics_(?:pro|max)|motion_(?:pro|beat|grid)|"
    r"kinetic_type|lottie_pop|paper_cut|cine_clasico)$"
)


def _norm(s: str) -> str:
    return re.sub(r"[-_ ]", "", s).lower()


def _probe_duration(path: Path) -> float:
    try:
        res = subprocess.run(
            [str(FFPROBE_PATH), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return float((res.stdout or "0").strip() or 0)
    except Exception:  # noqa: BLE001
        return 0.0


def find_renders_for_video(video_id: str) -> list[Path]:
    if not LF_RENDERS.exists():
        return []
    return [p for p in LF_RENDERS.glob("*.mp4") if p.stem.startswith(video_id) and "_supercut_" not in p.stem]


def build_supercut(video_id: str, top: int, max_seconds: float, style_pref: str | None) -> dict:
    prop_path = LF_PROPOSALS / f"{video_id}.json"
    if not prop_path.exists():
        return {"ok": False, "error": f"sin proposals para {video_id}"}
    data = json.loads(prop_path.read_text(encoding="utf-8"))
    clips = data.get("clips") if isinstance(data, dict) else data
    if not isinstance(clips, list) or not clips:
        return {"ok": False, "error": "proposals sin clips"}

    # Orden por score desc (los proposals ya suelen venir así, pero garantizamos).
    clips = sorted(clips, key=lambda c: -int(c.get("viralityScore", 0) or 0))
    renders = find_renders_for_video(video_id)
    if not renders:
        return {"ok": False, "error": "no hay clips renderizados de este video todavía"}

    # slug del proposal → renders que lo contienen, agrupados por estilo.
    def renders_for_slug(slug: str) -> dict[str, Path]:
        by_style: dict[str, Path] = {}
        ns = _norm(slug)
        for p in renders:
            if ns and ns in _norm(p.stem):
                m = STYLE_SUFFIX.search(p.stem)
                if m:
                    by_style[m.group(1)] = p
        return by_style

    top_clips = [c for c in clips if c.get("approved") is not False][: max(2, top)]
    per_clip = [(c, renders_for_slug(str(c.get("slug", "")))) for c in top_clips]
    per_clip = [(c, r) for c, r in per_clip if r]
    if len(per_clip) < 2:
        return {"ok": False, "error": "se necesitan al menos 2 clips renderizados del top"}

    # Estilo: el pedido si alcanza, si no el que MÁS clips del top cubre.
    style_count: dict[str, int] = {}
    for _, r in per_clip:
        for s in r:
            style_count[s] = style_count.get(s, 0) + 1
    if style_pref and style_count.get(style_pref, 0) >= 2:
        style = style_pref
    else:
        style = max(style_count, key=lambda s: style_count[s])

    chosen: list[tuple[dict, Path]] = [(c, r[style]) for c, r in per_clip if style in r]
    if len(chosen) < 2:
        return {"ok": False, "error": f"solo {len(chosen)} clip(s) renderizado(s) con estilo {style}"}

    # Cap de duración total.
    picked: list[tuple[dict, Path]] = []
    total = 0.0
    for c, p in chosen:
        d = _probe_duration(p)
        if d <= 0:
            continue
        if picked and total + d > max_seconds:
            break
        picked.append((c, p))
        total += d
    if len(picked) < 2:
        return {"ok": False, "error": "los clips del top no caben en el máximo de duración"}

    out = LF_RENDERS / f"{video_id}_supercut_{style}.mp4"
    tmp_out = out.with_name(out.stem + ".__building.mp4")

    # concat demuxer + re-encode adaptativo (NVENC si hay; ver docstring).
    with tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, dir=str(LF_RENDERS), encoding="utf-8"
    ) as f:
        for _, p in picked:
            f.write(f"file '{p.as_posix()}'\n")
        list_path = Path(f.name)
    try:
        ff = ffmpeg_full_args(input_path=None, quality="final")
        res = subprocess.run(
            [
                str(FFMPEG_PATH), "-y",
                "-f", "concat", "-safe", "0", "-i", str(list_path),
                *ff["video_args"],
                "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                *ff["container_args"],
                str(tmp_out),
            ],
            capture_output=True, text=True, timeout=1800,
        )
        if res.returncode != 0 or not tmp_out.exists() or tmp_out.stat().st_size < 100_000:
            last = ((res.stderr or "").strip().splitlines() or ["ffmpeg falló"])[-1]
            tmp_out.unlink(missing_ok=True)
            return {"ok": False, "error": f"concat falló: {last[:200]}"}
    finally:
        list_path.unlink(missing_ok=True)
    tmp_out.replace(out)

    # Loudness al estándar de redes (best-effort).
    try:
        normalize_loudness(out)
    except Exception as e:  # noqa: BLE001
        print(f"[supercut] loudnorm skipped: {e}", file=sys.stderr)

    # Project JSON → aparece en "Mis videos" con caption armado de los hooks.
    hooks = [str(c.get("hook", "")).strip() for c, _ in picked if c.get("hook")]
    caption = "Lo mejor en un solo video:\n" + "\n".join(f"• {h}" for h in hooks[:5])
    hashtags = []
    for c, _ in picked:
        for h in c.get("hashtags", []) or []:
            if isinstance(h, str) and h not in hashtags:
                hashtags.append(h)
    project = {
        "id": out.stem,
        "videoId": video_id,
        "styleId": style,
        "kind": "supercut",
        "caption": caption,
        "hashtags": hashtags[:8],
        "clips": [
            {"slug": c.get("slug"), "hook": c.get("hook"), "score": c.get("viralityScore")}
            for c, _ in picked
        ],
    }
    LF_PROJECTS.mkdir(parents=True, exist_ok=True)
    (LF_PROJECTS / f"{out.stem}.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return {
        "ok": True,
        "path": str(out),
        "id": out.stem,
        "style": style,
        "clips": len(picked),
        "seconds": round(total, 1),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Supercut: top momentos de un video largo en un MP4")
    ap.add_argument("video_id")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--max-seconds", type=float, default=120)
    ap.add_argument("--style", default=None, help="estilo preferido (si tiene ≥2 renders del top)")
    args = ap.parse_args()
    try:
        result = build_supercut(args.video_id, args.top, args.max_seconds, args.style)
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
