"""Motion tracking del sujeto (cara) para pegar texto/stickers que lo siguen.

Uso:
    python track_subject.py <ruta_video> [sample_every_seg] [downscale_w]

Salida (stdout, una línea JSON):
    {"fps": 30.0, "points": [{"t":0.0,"x":0.5,"y":0.33,"w":0.2,"h":0.28}, ...]}

x,y = centro de la cara normalizado (0..1). Lo usa Remotion (TrackedLayer) para
posicionar un label que sigue al sujeto. Muestrea cada `sample_every` segundos
(default 0.4s) e INTERPOLA entre muestras → trayectoria suave con menos trabajo.
Usa el detector Haar de OpenCV (incluido, sin descargas).

VELOCIDAD (sin perder calidad visual del video — trackPath es SOLO la trayectoria
de la cara, el video final NO se toca):
  1) DETECCIÓN EN FRAME REDUCIDO: Haar sobre el frame original es lento. Reducimos
     el frame a `downscale_w` px de ancho ANTES de detectMultiScale y escalamos las
     coordenadas de vuelta. La posición de la cara no necesita precisión de pixel
     para seguirla → mismo resultado visual, varias veces más rápido.
  2) MUESTREO ADAPTATIVO: el caller (auto-build) pasa sample_every/downscale_w según
     el hardware (hw_profile.recommend.tracking_sample_sec / tracking_downscale_w).
     En equipos modestos se muestrea más espaciado.
  3) INTERPOLACIÓN: entre muestras detectadas se interpolan puntos a un paso fino
     (~0.12s) para que el seguimiento se vea fluido aunque se detecte espaciado.
  4) CACHÉ por video: si ya se calculó el trackPath de este archivo (mismo mtime/
     tamaño y mismos params) se reusa <DATA_ROOT>/cache/track/<hash>.json.

Si algo falla, devuelve {"points": []} → el caller sigue sin tracking.
"""
import sys
import json
import hashlib

try:
    import config  # noqa: F401
except Exception:
    config = None  # type: ignore[assignment]

# Paso fino al que se interpola la trayectoria final (suave aunque se detecte espaciado).
_INTERP_STEP_SEC = 0.12


def _cache_path(video_path, sample_every, downscale_w):
    """Ruta del JSON cacheado para (archivo + mtime + tamaño + params). None si no hay DATA_ROOT."""
    try:
        import os

        data_root = getattr(config, "DATA_ROOT", None) if config else None
        if data_root is None:
            return None
        st = os.stat(video_path)
        key = "|".join([
            os.path.abspath(video_path),
            str(int(st.st_mtime)),
            str(int(st.st_size)),
            f"{float(sample_every):.4f}",
            str(int(downscale_w)),
            "v2",  # bump si cambia el formato/algoritmo
        ])
        h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
        from pathlib import Path

        return Path(data_root) / "cache" / "track" / f"{h}.json"
    except Exception:  # noqa: BLE001
        return None


def _interpolate(samples, fps, duration_idx):
    """Interpola los puntos detectados a un paso fino para una trayectoria suave.

    `samples` = lista de (t, x, y, w, h) detectados (ordenada por t). Devuelve la
    lista final de dicts a paso `_INTERP_STEP_SEC`. Si hay 0/1 muestra, la devuelve
    tal cual (no hay nada que interpolar)."""
    if not samples:
        return []
    if len(samples) == 1:
        t, x, y, w, h = samples[0]
        return [{"t": round(t, 3), "x": round(x, 4), "y": round(y, 4),
                 "w": round(w, 4), "h": round(h, 4)}]

    out = []
    t_end = samples[-1][0]
    step = _INTERP_STEP_SEC
    j = 0  # índice del segmento [samples[j], samples[j+1]]
    t = samples[0][0]
    # Avanzar en pasos finos desde la primera muestra hasta la última.
    n_steps = int(round((t_end - samples[0][0]) / step)) + 1
    for i in range(n_steps):
        t = samples[0][0] + i * step
        if t > t_end:
            t = t_end
        # Buscar el segmento que contiene t.
        while j < len(samples) - 2 and samples[j + 1][0] < t:
            j += 1
        a = samples[j]
        b = samples[j + 1]
        span = b[0] - a[0]
        frac = 0.0 if span <= 1e-9 else (t - a[0]) / span
        frac = min(max(frac, 0.0), 1.0)
        x = a[1] + (b[1] - a[1]) * frac
        y = a[2] + (b[2] - a[2]) * frac
        w = a[3] + (b[3] - a[3]) * frac
        h = a[4] + (b[4] - a[4]) * frac
        out.append({
            "t": round(t, 3),
            "x": round(float(min(max(x, 0), 1)), 4),
            "y": round(float(min(max(y, 0), 1)), 4),
            "w": round(float(min(max(w, 0), 1)), 4),
            "h": round(float(min(max(h, 0), 1)), 4),
        })
    return out


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"points": [], "error": "no input"}))
        return
    video_path = sys.argv[1]
    sample_every = float(sys.argv[2]) if len(sys.argv) > 2 else 0.4
    downscale_w = int(sys.argv[3]) if len(sys.argv) > 3 else 480
    if sample_every <= 0:
        sample_every = 0.4
    if downscale_w <= 0:
        downscale_w = 0  # 0 = sin downscale

    # CACHÉ: si existe un JSON válido para (archivo+mtime+tamaño+params), reusarlo.
    cache_file = _cache_path(video_path, sample_every, downscale_w)
    if cache_file is not None:
        try:
            if cache_file.exists():
                cached = cache_file.read_text(encoding="utf-8")
                # Validar que es JSON con points antes de servirlo tal cual.
                obj = json.loads(cached)
                if isinstance(obj, dict) and "points" in obj:
                    sys.stdout.write(cached if cached.endswith("\n") else cached + "\n")
                    return
        except Exception:  # noqa: BLE001
            pass

    try:
        import cv2

        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)
        if face_cascade.empty():
            print(json.dumps({"points": [], "error": "cascade not loaded"}))
            return

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(json.dumps({"points": [], "error": "cannot open video"}))
            return
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps:
            print("[track_subject] CAP_PROP_FPS devolvió 0 — asumiendo fps=30",
                  file=sys.stderr)
            fps = 30.0
        step = max(1, int(round(sample_every * fps)))

        samples = []  # (t, cx, cy, w_norm, h_norm) en coords NORMALIZADAS del frame original
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % step == 0:
                h, w = frame.shape[:2]
                # 1) DETECCIÓN EN FRAME REDUCIDO: reducimos antes de detectar.
                if downscale_w and w > downscale_w:
                    scale = downscale_w / float(w)
                    small = cv2.resize(
                        frame, (downscale_w, max(1, int(round(h * scale)))),
                        interpolation=cv2.INTER_AREA,
                    )
                else:
                    small = frame
                sh, sw = small.shape[:2]
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                faces = face_cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5,
                    minSize=(int(sw * 0.06), int(sw * 0.06)),
                )
                if len(faces) > 0:
                    fx, fy, fw, fh = max(faces, key=lambda f: int(f[2]) * int(f[3]))
                    # Normalizar usando el tamaño REDUCIDO (la normalización es
                    # invariante a la escala → mismas coords 0..1 que el original).
                    cx = (fx + fw / 2.0) / sw
                    cy = (fy + fh / 2.0) / sh
                    samples.append((
                        round(idx / fps, 3),
                        float(min(max(cx, 0), 1)),
                        float(min(max(cy, 0), 1)),
                        float(fw / sw),
                        float(fh / sh),
                    ))
            idx += 1
        cap.release()

        # 3) INTERPOLACIÓN: trayectoria suave a paso fino entre muestras detectadas.
        points = _interpolate(samples, fps, idx)
        result = {"fps": round(float(fps), 3), "points": points}
        out_str = json.dumps(result)

        # 4) Guardar en caché (best-effort; si falla, no rompe). NO cachear un
        # resultado con points vacío: sería un fallo de detección que quedaría
        # "pegado" para siempre en el cache.
        if cache_file is not None and points:
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(out_str, encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass

        print(out_str)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"points": [], "error": str(e)}))


if __name__ == "__main__":
    main()
