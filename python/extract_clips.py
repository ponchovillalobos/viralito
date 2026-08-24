"""Extrae los clips propuestos desde el video CLEAN.

Uso:
  python extract_clips.py <video_id>
  python extract_clips.py <video_id> --clips 0,2,5   # solo esas posiciones (0-based)

Para cada clip en long_form/proposals/{video_id}.json:
  - Recorta [start, end] del long_form/clean/{video_id}_clean.mp4
  - Guarda long_form/clips/{video_id}_clip_NN.mp4
  - Recorta sub-transcript con timestamps re-anclados a 0
  - Guarda long_form/transcripts/{video_id}_clip_NN.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from hw_profile import ffmpeg_full_args
from lib.ffmpeg_safe_run import safe_ffmpeg
from config import (
    FFMPEG_PATH,
    LF_CLEAN,
    LF_CLIPS,
    LF_PROPOSALS,
    LF_RAW,
    LF_TRANSCRIPTS,
    LF_ROOT,
    ensure_long_form_dirs,
)

# Path para los face tracks (uno por clip) — se crea cuando --face-tracking está activo
LF_FACE_TRACKS = LF_ROOT / "face_tracks"

PYTHON_DIR = Path(__file__).resolve().parent
# El MISMO intérprete que está corriendo este script: venv en dev, Python
# embeddable en el paquete distribuible (la ruta hardcodeada al venv rompía
# los sub-spawns en máquinas de usuarios finales).
VENV_PYTHON = Path(sys.executable)


def _probe_dims_rotation(video_path: Path) -> tuple[int, int, int] | None:
    """(width, height, rotation) del primer video stream. None si falla.

    OJO: ffprobe reporta los píxeles tal cual están ALMACENADOS. Los videos de
    celular suelen guardarse APAISADOS (p.ej. 1920x1080) con una BANDERA de
    rotación (90/270) que el reproductor aplica para mostrarlos verticales. Si
    solo miramos width/height creemos que un 9:16 vertical es 16:9 → lo
    reencuadramos y, peor, con decode por GPU ffmpeg no aplica la rotación y el
    video sale GIRADO. Por eso devolvemos también la rotación (grados, 0/90/180/270)."""
    try:
        from config import FFPROBE_PATH
    except ImportError:
        return None
    try:
        result = subprocess.run(
            [
                str(FFPROBE_PATH),
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries",
                "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
                "-of", "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        data = json.loads(result.stdout or "{}")
        streams = data.get("streams") or []
        if not streams:
            return None
        s = streams[0]
        w, h = int(s.get("width") or 0), int(s.get("height") or 0)
        if w <= 0 or h <= 0:
            return None
        rot = 0
        # 1) tag legacy "rotate" (mov/mp4 viejos)
        tags = s.get("tags") or {}
        if tags.get("rotate") is not None:
            try:
                rot = int(float(tags["rotate"]))
            except (TypeError, ValueError):
                rot = 0
        # 2) displaymatrix side-data (ffmpeg moderno) — pisa al tag si está
        for sd in s.get("side_data_list") or []:
            if sd.get("rotation") is not None:
                try:
                    rot = int(float(sd["rotation"]))
                except (TypeError, ValueError):
                    pass
                break
        rot = abs(rot) % 360
        # snap a 0/90/180/270 (algunos archivos traen -90 → 270, etc.)
        rot = min((0, 90, 180, 270), key=lambda r: abs(r - rot))
        return w, h, rot
    except Exception:
        return None


def detect_aspect(video_path: Path) -> tuple[int, int] | None:
    """(width, height) de PANTALLA (display) — ya con la rotación aplicada.

    Si el archivo está apaisado pero tiene bandera de rotación 90/270, devolvemos
    las dimensiones verticales (swap), que es lo que el usuario realmente ve. Así
    needs_reframe juzga el aspect REAL y no reencuadra un vertical creyéndolo
    horizontal."""
    probe = _probe_dims_rotation(video_path)
    if not probe:
        return None
    w, h, rot = probe
    if rot in (90, 270):
        return h, w
    return w, h


def source_is_rotated(video_path: Path) -> bool:
    """True si el source trae bandera de rotación (90/180/270). En ese caso hay que
    decodificar por CPU (sin -hwaccel) para que ffmpeg HORNEE la rotación en los
    píxeles; con decode por GPU la rotación se saltea y el video sale girado."""
    probe = _probe_dims_rotation(video_path)
    return bool(probe and probe[2] != 0)


def needs_reframe(clean_path: Path, target_aspect: str | None) -> bool:
    """True si el source tiene aspect distinto al target (con tolerancia 5%)."""
    if target_aspect not in ("9:16", "16:9"):
        return False
    dims = detect_aspect(clean_path)
    if not dims:
        return False
    src_w, src_h = dims
    src_ratio = src_w / src_h
    target_ratio = 9 / 16 if target_aspect == "9:16" else 16 / 9
    return abs(src_ratio - target_ratio) > 0.05


def _esc(expr: str) -> str:
    """Escapa las comas para el parser de filtergraph de ffmpeg (`,` separa filtros;
    dentro de una expresión hay que pasarla como `\\,`). Los `:` estructurales del
    crop NO se tocan (separan las 4 opciones w:h:x:y)."""
    return expr.replace(",", "\\,")


def build_crop_filter(target_aspect: str, face_bbox: tuple[float, float, float, float] | None) -> str:
    """Devuelve el filtro -vf crop ESTÁTICO para ffmpeg.

    Si face_bbox = (cx, cy, w, h) normalizado, centra el crop en esa posición.
    Si no, center crop estándar.

    target_aspect:
      "9:16" → recortar horizontal del source. Tamaño objetivo: ih*9/16 × ih.
      "16:9" → recortar vertical del source. Tamaño objetivo: iw × iw*9/16.
    """
    if target_aspect == "9:16":
        # Output dim: width = ih*9/16, height = ih.
        # X offset por defecto: (iw - ih*9/16) / 2  (center crop).
        # Con face_bbox: queremos x = cx*iw - (ih*9/16)/2.  Clamp 0..(iw - ih*9/16).
        if face_bbox:
            cx, _, _, _ = face_bbox
            # Usar 'min/max' de ffmpeg para clampear sin que se salga del frame.
            x_expr = _esc(f"max(0,min(iw-ih*9/16,({cx:.4f})*iw-(ih*9/16)/2))")
            return f"crop=ih*9/16:ih:{x_expr}:0"
        return "crop=ih*9/16:ih"
    elif target_aspect == "16:9":
        # Output dim: width = iw, height = iw*9/16.
        if face_bbox:
            _, cy, _, _ = face_bbox
            y_expr = _esc(f"max(0,min(ih-iw*9/16,({cy:.4f})*ih-(iw*9/16)/2))")
            return f"crop=iw:iw*9/16:0:{y_expr}"
        return "crop=iw:iw*9/16"
    raise ValueError(f"target_aspect inválido: {target_aspect}")


# Máximo de keyframes en la expresión de crop temporal. La trayectoria se
# submuestrea a este tope para que la expresión ffmpeg quede acotada (un clip
# largo muestreado cada 5 frames puede dar cientos de puntos).
_MAX_CROP_KEYFRAMES = 60


def run_face_tracking(clip_path: Path, out_json: Path, single_frame: bool = True) -> list[dict] | None:
    """Ejecuta face_tracking.py sobre clip_path. Devuelve la lista de samples
    {t, cx, cy, w, h} (trayectoria), o None si no se detectó cara.

    single_frame=True → detecta solo en el frame del medio (1 sample, crop estático).
    single_frame=False → detecta cada N frames (trayectoria → crop que SIGUE la cara).
    """
    cmd = [
        str(VENV_PYTHON),
        str(PYTHON_DIR / "face_tracking.py"),
        str(clip_path),
        str(out_json),
    ]
    if single_frame:
        cmd.append("--single-frame")
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
    except subprocess.CalledProcessError as e:
        print(f"[face] tracking falló: {e.stderr[-200:]}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"[face] tracking timeout en {clip_path.name}", file=sys.stderr)
        return None

    try:
        data = json.loads(out_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return None

    samples = data.get("samples", [])
    if not samples:
        print(f"[face] sin samples — no se detectó cara en {clip_path.name}", file=sys.stderr)
        return None
    return samples


def _mean_bbox(samples: list[dict]) -> tuple[float, float, float, float]:
    """Promedio cx/cy/w/h de los samples (para metadata y crop estático)."""
    n = max(1, len(samples))
    return (
        sum(s["cx"] for s in samples) / n,
        sum(s["cy"] for s in samples) / n,
        sum(s["w"] for s in samples) / n,
        sum(s["h"] for s in samples) / n,
    )


def _downsample_keyframes(samples: list[dict], axis: str) -> list[tuple[float, float]]:
    """(t, valor[axis]) submuestreado a <= _MAX_CROP_KEYFRAMES, conservando 1º y último.
    `axis` es 'cx' (reframe 9:16) o 'cy' (reframe 16:9)."""
    pts = [(float(s["t"]), float(s[axis])) for s in samples]
    pts.sort(key=lambda p: p[0])
    if len(pts) <= _MAX_CROP_KEYFRAMES:
        return pts
    stride = (len(pts) + _MAX_CROP_KEYFRAMES - 1) // _MAX_CROP_KEYFRAMES
    kept = pts[::stride]
    if kept[-1][0] != pts[-1][0]:
        kept.append(pts[-1])
    return kept


def _piecewise_expr(keyframes: list[tuple[float, float]]) -> str:
    """Expresión ffmpeg de la trayectoria como interpolación lineal por tramos en `t`.
    Fuera del rango: se mantiene el primer/último valor (sin extrapolar)."""
    if not keyframes:
        return "0.5"
    if len(keyframes) == 1:
        return f"{keyframes[0][1]:.5f}"
    chain = f"{keyframes[-1][1]:.5f}"  # t >= t_last → último valor
    for i in range(len(keyframes) - 2, -1, -1):
        t0, c0 = keyframes[i]
        t1, c1 = keyframes[i + 1]
        span = max(1e-6, t1 - t0)
        seg = f"({c0:.5f}+({(c1 - c0):.5f})*(t-{t0:.5f})/{span:.5f})"
        chain = f"if(lt(t,{t1:.5f}),{seg},{chain})"
    t_first, c_first = keyframes[0]
    return f"if(lt(t,{t_first:.5f}),{c_first:.5f},{chain})"


def build_tracked_crop_filter(target_aspect: str, samples: list[dict]) -> str:
    """Filtro -vf crop que SIGUE la cara cuadro a cuadro (expresión en `t`).

    Para 9:16 mueve el offset X según cx(t); para 16:9 mueve el offset Y según cy(t).
    Clampeado a [0, dim-crop] para no descubrir borde. Si hay <2 keyframes degrada a
    crop estático (idéntico a build_crop_filter)."""
    if target_aspect == "9:16":
        kf = _downsample_keyframes(samples, "cx")
        if len(kf) < 2:
            return build_crop_filter(target_aspect, (kf[0][1], 0.0, 0.0, 0.0) if kf else None)
        cx_expr = _piecewise_expr(kf)
        x_expr = _esc(f"max(0,min(iw-ih*9/16,({cx_expr})*iw-(ih*9/16)/2))")
        return f"crop=ih*9/16:ih:{x_expr}:0"
    elif target_aspect == "16:9":
        kf = _downsample_keyframes(samples, "cy")
        if len(kf) < 2:
            return build_crop_filter(target_aspect, (0.0, kf[0][1], 0.0, 0.0) if kf else None)
        cy_expr = _piecewise_expr(kf)
        y_expr = _esc(f"max(0,min(ih-iw*9/16,({cy_expr})*ih-(iw*9/16)/2))")
        return f"crop=iw:iw*9/16:0:{y_expr}"
    raise ValueError(f"target_aspect inválido: {target_aspect}")


def extract_clip(
    clean_path: Path,
    start: float,
    end: float,
    out_path: Path,
    target_aspect: str | None = None,
    face_tracking: str = "off",
    clip_id: str | None = None,
) -> dict:
    """Recorta el clip [start, end] del CLEAN.

    Si target_aspect cambia el aspect del source, aplica crop:
      - face_tracking == "off": center crop ciego
      - face_tracking == "single": 2 pases — primero extraer sin crop, detectar cara, recortar centrado en la cara
      - face_tracking == "per-frame": idem pero promediando cara por frame

    Devuelve dict con metadata útil: { center_crop: bool, face_detected: bool, face_bbox: [cx,cy,w,h] | None }
    """
    metadata: dict = {"center_crop": False, "face_detected": False, "face_bbox": None}

    # ¿El source trae bandera de rotación (video vertical de celular)? Si la hay,
    # decodificamos por CPU para que ffmpeg HORNEE la rotación; con decode por GPU
    # (qsv/cuda) la rotación se saltea y el clip sale GIRADO.
    src_rotated = source_is_rotated(clean_path)

    if not needs_reframe(clean_path, target_aspect) or face_tracking == "off":
        # Path simple: extract con (o sin) center crop, 1 solo pase de ffmpeg
        will_crop = (
            target_aspect in ("9:16", "16:9")
            and needs_reframe(clean_path, target_aspect)
        )
        # CONSERVADOR: solo inyectamos decode hwaccel cuando NO hay -vf crop (el crop
        # corre en CPU y -hwaccel_output_format cuda entregaría frames en VRAM que el
        # filtro no consume) Y el source NO está rotado (la rotación necesita decode
        # CPU para hornearse). Con crop o con rotación → encoder adaptativo solo.
        ff = ffmpeg_full_args(
            input_path=(None if (will_crop or src_rotated) else str(clean_path)),
            quality="final",
        )
        cmd = [
            str(FFMPEG_PATH),
            "-y",
            *ff["input_args"],
            "-ss", f"{start:.3f}",
            "-i", str(clean_path),
            "-to", f"{end - start:.3f}",
        ]
        if will_crop:
            cmd.extend(["-vf", build_crop_filter(target_aspect, None)])
            metadata["center_crop"] = True
        cmd.extend([
            # Encoder adaptativo: h264_nvenc si hay GPU NVIDIA funcional, libx264 si no.
            *ff["video_args"],
            "-c:a", "aac",
            "-b:a", "128k",
            *ff["container_args"],
            str(out_path),
        ])
        res = safe_ffmpeg(cmd, input_path=str(clean_path))
        if res.returncode != 0:
            raise subprocess.CalledProcessError(res.returncode, cmd, res.stdout, res.stderr)
        return metadata

    # Path face-aware: 2 pases de ffmpeg + face_tracking entre medio
    # Pase 1: extract temporal sin crop espacial → archivo .tmp.mp4
    tmp_path = out_path.with_suffix(".tmp.mp4")
    # Pase 1: trim temporal puro (sin -vf). Decode hwaccel SOLO si el source no está
    # rotado; si lo está, CPU para hornear la rotación (si no, el tmp sale girado y
    # arruina el face-tracking + el crop del pase 2).
    ff1 = ffmpeg_full_args(
        input_path=(None if src_rotated else str(clean_path)), quality="fast"
    )
    res1 = safe_ffmpeg([
        str(FFMPEG_PATH),
        "-y",
        *ff1["input_args"],
        "-ss", f"{start:.3f}",
        "-i", str(clean_path),
        "-to", f"{end - start:.3f}",
        # intermedio (se re-encodea en pase 2): velocidad sobre tamaño
        *ff1["video_args"],
        "-c:a", "aac",
        "-b:a", "128k",
        *ff1["container_args"],
        str(tmp_path),
    ], input_path=str(clean_path))
    if res1.returncode != 0:
        raise subprocess.CalledProcessError(res1.returncode, "ffmpeg pase1", res1.stdout, res1.stderr)

    # Face tracking sobre el tmp
    LF_FACE_TRACKS.mkdir(parents=True, exist_ok=True)
    face_json = LF_FACE_TRACKS / f"{clip_id or out_path.stem}.json"
    single_frame = face_tracking == "single"
    samples = run_face_tracking(tmp_path, face_json, single_frame=single_frame)
    metadata["face_detected"] = bool(samples)
    mean_bbox = _mean_bbox(samples) if samples else None
    metadata["face_bbox"] = list(mean_bbox) if mean_bbox else None
    metadata["face_tracked"] = bool(samples) and not single_frame and len(samples) >= 2

    # Pase 2: reframe.
    #   - per-frame con >=2 samples → crop que SIGUE la cara cuadro a cuadro (expr en t).
    #   - single (o per-frame con 1 sample) → crop estático centrado en la cara.
    #   - sin cara → center crop ciego.
    if metadata["face_tracked"]:
        crop_filter = build_tracked_crop_filter(target_aspect, samples)
    else:
        crop_filter = build_crop_filter(target_aspect, mean_bbox)
    # Pase 2: lleva -vf crop (CPU) → NO inyectar decode hwaccel (input_path=None),
    # solo encoder adaptativo + faststart.
    ff2 = ffmpeg_full_args(input_path=None, quality="final")
    res2 = safe_ffmpeg([
        str(FFMPEG_PATH),
        "-y",
        "-i", str(tmp_path),
        "-vf", crop_filter,
        *ff2["video_args"],
        "-c:a", "copy",
        *ff2["container_args"],
        str(out_path),
    ], input_path=str(tmp_path))
    if res2.returncode != 0:
        raise subprocess.CalledProcessError(res2.returncode, "ffmpeg pase2", res2.stdout, res2.stderr)

    # Cleanup tmp
    try:
        tmp_path.unlink()
    except OSError:
        pass

    if metadata["face_tracked"]:
        print(
            f"[face] {out_path.name} SIGUE la cara · {len(samples)} samples",
            file=sys.stderr,
        )
    elif mean_bbox:
        print(
            f"[face] {out_path.name} centrado en cx={mean_bbox[0]:.2f} cy={mean_bbox[1]:.2f}",
            file=sys.stderr,
        )
    else:
        print(
            f"[face] {out_path.name} sin cara detectada → center crop fallback",
            file=sys.stderr,
        )
    return metadata


def slice_transcript(transcript_path: Path, start: float, end: float) -> dict:
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    sliced_words = []
    for w in data.get("words", []):
        ws, we = float(w["start"]), float(w["end"])
        if we < start:
            continue
        if ws > end:
            break
        sliced_words.append({
            "word": w["word"],
            "start": round(max(0.0, ws - start), 3),
            "end": round(min(end - start, we - start), 3),
            "score": w.get("score", 1.0),
        })
    return {
        "video": f"clip",
        "language": data.get("language", "es"),
        "model": data.get("model", "small"),
        "duration": round(end - start, 3),
        "source_range": [start, end],
        "words": sliced_words,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_id", help="ID del video largo (sin extensión)")
    parser.add_argument(
        "--aspect-ratio",
        choices=["9:16", "16:9"],
        default=None,
        help="Si se pasa y no coincide con el source, aplica center-crop con ffmpeg.",
    )
    parser.add_argument(
        "--face-tracking",
        choices=["off", "single", "per-frame"],
        default="off",
        help=(
            "Reframe siguiendo el rostro detectado. "
            "off=center crop ciego (default). "
            "single=detección 1-frame del medio del clip (rápido, ~1s/clip). "
            "per-frame=sample cada 5 frames (preciso, ~5-10s/clip)."
        ),
    )
    parser.add_argument(
        "--clips",
        default=None,
        help=(
            "Índices de clips a extraer, separados por coma (posición 0-based en el "
            "proposals JSON, ej. '0,2,5'). Sin este flag se extraen TODOS (retrocompatible). "
            "Los clip_id conservan su número de posición completo (cNN), se pida el "
            "subset que se pida."
        ),
    )
    args = parser.parse_args()

    # Subset opcional de clips aprobados (flujo REVISAR antes de generar).
    selected: set[int] | None = None
    if args.clips is not None and args.clips.strip():
        try:
            selected = {int(x) for x in args.clips.split(",") if x.strip()}
        except ValueError:
            print(f"[error] --clips inválido: {args.clips!r} (espero '0,2,5')", file=sys.stderr)
            return 1
        if not selected:
            selected = None

    ensure_long_form_dirs()

    proposal_path = LF_PROPOSALS / f"{args.video_id}.json"
    if not proposal_path.exists():
        print(f"[error] no encontré {proposal_path}", file=sys.stderr)
        return 1
    proposal = json.loads(proposal_path.read_text(encoding="utf-8"))
    clips = proposal.get("clips", [])
    if not clips:
        print("[error] proposals sin clips", file=sys.stderr)
        return 1

    # Fuente: preferir el CLEAN (sin silencios) si existe; si no, cortar del RAW.
    # El modo "clips rápidos" no transcribe ni recorta silencios del video entero
    # (inviable en videos de 80 min), así que corta directo del raw.
    clean_path = LF_CLEAN / f"{args.video_id}_clean.mp4"
    if clean_path.exists():
        source_path = clean_path
    else:
        source_path = None
        for ext in (".mp4", ".mov", ".mkv", ".webm", ".m4v"):
            cand = LF_RAW / f"{args.video_id}{ext}"
            if cand.exists():
                source_path = cand
                break
        if source_path is None:
            print(f"[error] no encontré ni clean ni raw para {args.video_id}", file=sys.stderr)
            return 1
        print(f"[extract] sin clean — cortando del raw {source_path.name}", file=sys.stderr)

    # Si existe el transcript COMPLETO del video, cada clip se obtiene cortándolo (rápido).
    # Si NO existe (modo clips rápidos), transcribimos CADA clip por separado: 30-60s de
    # audio es liviano y seguro, a diferencia de transcribir los 80 min de una.
    # OJO: un transcript a nivel FRASE (modo inteligente, alignment="segment") tiene
    # timestamps de palabra INTERPOLADOS (sirven para ELEGIR clips, no para karaoke).
    # En ese caso re-transcribimos cada clip (50s alinea bien) para subtítulos precisos.
    full_transcript_path = LF_TRANSCRIPTS / f"{args.video_id}.json"
    use_full = False
    if full_transcript_path.exists():
        try:
            _t = json.loads(full_transcript_path.read_text(encoding="utf-8"))
            use_full = _t.get("alignment") != "segment"  # solo si es nivel palabra
        except Exception:
            use_full = False
    if not use_full:
        print("[extract] transcript ausente o a nivel frase — se transcribe cada clip (karaoke preciso)", file=sys.stderr)

    results = []
    # Clips que necesitan transcripción: se acumulan y se transcriben en UN solo
    # proceso al final (--batch) — antes se spawneaba un python NUEVO por clip,
    # recargando torch + el modelo Whisper 15+ veces por video (minutos perdidos).
    pending_transcriptions: list[tuple[Path, int]] = []  # (out_transcript, idx en results)
    if selected is not None:
        valid = {i for i in selected if 0 <= i < len(clips)}
        if not valid:
            print(
                f"[error] ninguno de los índices {sorted(selected)} existe "
                f"(hay {len(clips)} clips propuestos)",
                file=sys.stderr,
            )
            return 1
        print(
            f"[extract] solo los aprobados: {len(valid)} de {len(clips)} clips "
            f"(posiciones {sorted(valid)})",
            file=sys.stderr,
        )

    for i, clip in enumerate(clips, start=1):
        # Subset aprobado: i es 1-based, las posiciones llegan 0-based.
        if selected is not None and (i - 1) not in selected:
            continue
        slug = clip.get("slug") or f"clip-{i:02d}"
        clip_id = f"{args.video_id}_c{i:02d}_{slug}"
        out_mp4 = LF_CLIPS / f"{clip_id}.mp4"
        out_transcript = LF_TRANSCRIPTS / f"{clip_id}.json"
        try:
            meta = extract_clip(
                source_path,
                clip["start"],
                clip["end"],
                out_mp4,
                target_aspect=args.aspect_ratio,
                face_tracking=args.face_tracking,
                clip_id=clip_id,
            )
            if use_full:
                sub = slice_transcript(full_transcript_path, clip["start"], clip["end"])
                out_transcript.write_text(json.dumps(sub, ensure_ascii=False, indent=2), encoding="utf-8")
                n_words = len(sub["words"])
            else:
                # Se transcribe DESPUÉS, en un solo batch (una carga de modelo).
                pending_transcriptions.append((out_transcript, len(results)))
                n_words = 0
            results.append({
                "clip_id": clip_id,
                "index": i,
                "slug": slug,
                "ok": True,
                "duration": clip["end"] - clip["start"],
                "words": n_words,
                "face_detected": meta.get("face_detected"),
                "face_bbox": meta.get("face_bbox"),
            })
        except subprocess.CalledProcessError as e:
            # safe_ffmpeg() fuerza text=True, asi que e.stderr YA es str. El
            # .decode() de antes lanzaba AttributeError aca dentro y tumbaba el
            # batch ENTERO de clips en vez de marcar fallido solo este. Se acepta
            # bytes por si alguna llamada futura no pasa por safe_ffmpeg.
            err = e.stderr
            if isinstance(err, bytes):
                err = err.decode("utf-8", errors="ignore")
            results.append({"clip_id": clip_id, "index": i, "ok": False, "error": str(err or e)[:300]})
        except Exception as e:
            results.append({"clip_id": clip_id, "index": i, "ok": False, "error": str(e)})

    # ── BATCH de transcripción: TODOS los clips pendientes con UNA carga de modelo ──
    if pending_transcriptions:
        print(
            f"[extract] transcribiendo {len(pending_transcriptions)} clips en batch "
            "(modelo se carga una sola vez)...",
            file=sys.stderr, flush=True,
        )
        jobs = [
            {"video": str(LF_CLIPS / f"{results[idx]['clip_id']}.mp4"), "out": str(tpath)}
            for tpath, idx in pending_transcriptions
        ]
        batch_file = LF_TRANSCRIPTS / f"_batch_{args.video_id}.json"
        batch_file.write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")
        try:
            tr = subprocess.run(
                [str(VENV_PYTHON), str(PYTHON_DIR / "transcribe.py"), "--batch", str(batch_file)],
                capture_output=True, text=True,
            )
            if tr.returncode != 0:
                print(f"[extract] batch de transcripción falló: {tr.stderr[-400:]}", file=sys.stderr)
        finally:
            batch_file.unlink(missing_ok=True)
        # Completar words[] por clip; los que fallaron quedan con transcript vacío
        # (clip sin subtítulos, pero el pipeline NUNCA se rompe por esto).
        for tpath, idx in pending_transcriptions:
            if not tpath.exists():
                tpath.write_text(
                    json.dumps({"duration": results[idx].get("duration", 50), "words": []}, ensure_ascii=False),
                    encoding="utf-8",
                )
            try:
                results[idx]["words"] = len(json.loads(tpath.read_text(encoding="utf-8")).get("words", []))
            except Exception:
                results[idx]["words"] = 0

    print(json.dumps({"ok": True, "clips": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
