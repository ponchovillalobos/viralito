"""Detección de cara por frame para reframe inteligente vertical/horizontal.

Usa MediaPipe Tasks API (BlazeFace short-range) — la API legacy `mp.solutions`
fue removida en mediapipe>=0.10.10. Requiere el modelo .tflite descargado en
python/models/blaze_face_short_range.tflite (~225 KB, se descarga con setup).

Uso:
  python face_tracking.py <input.mp4> <output.json>
  python face_tracking.py <input.mp4> <output.json> --sample-every 5
  python face_tracking.py <input.mp4> <output.json> --single-frame    # MVP rápido

Output JSON:
  {
    "video": "<path>",
    "width": 1920, "height": 1080, "fps": 30, "duration": 12.4,
    "samples": [{"t": 0.0, "cx": 0.52, "cy": 0.45, "w": 0.18, "h": 0.32}, ...],
    "single_frame": false,
    "detection_rate": 0.95
  }

Coordenadas normalizadas [0,1]:
  - cx, cy: centro del bbox
  - w, h: ancho/alto del bbox
  - t: tiempo en segundos

Si NUNCA hay cara, samples queda vacío y el caller debe fallback a center-crop.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

try:
    import cv2
except ImportError as exc:
    print(f"[error] falta opencv-python: {exc}", file=sys.stderr)
    print("Instalá con: pip install opencv-python", file=sys.stderr)
    sys.exit(1)

# MediaPipe BlazeFace es OPCIONAL: da mejor detección, pero si no está instalado
# (o si falta el .tflite) caemos al detector Haar de OpenCV — que viene incluido
# en cv2, no descarga nada y funciona offline. Así el reframe NUNCA se queda sin
# detección silenciosamente (la causa raíz de "los videos salen cortados").
try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    _HAS_MEDIAPIPE = True
except Exception:  # ImportError o fallo de carga de la lib nativa
    _HAS_MEDIAPIPE = False

# Modelo .tflite — opcional, ~225 KB. Si falta, se usa Haar (ver arriba).
MODEL_PATH = Path(__file__).parent / "models" / "blaze_face_short_range.tflite"


def smooth_ema(history: deque, alpha: float = 0.7) -> tuple[float, float, float, float] | None:
    """EMA exponential moving average sobre los últimos N bboxes para evitar flickering."""
    if not history:
        return None
    items = list(history)
    smoothed = items[0]
    for next_bbox in items[1:]:
        smoothed = tuple(alpha * next_bbox[i] + (1 - alpha) * smoothed[i] for i in range(4))
    return smoothed


class OneEuroFilter:
    """Filtro 1€ (Casiez et al. 2012) para el CENTRO del crop que sigue la cara.

    Cutoff adaptativo: a velocidad baja filtra FUERTE (mata el jitter/tembleque de la
    detección frame a frame), a velocidad alta filtra POCO (sigue movimientos rápidos
    sin lag). Es el estándar para señales de tracking; el EMA fijo obligaba a elegir
    entre temblar o arrastrarse. w/h siguen con EMA (el tamaño no debe saltar).
    """

    def __init__(self, min_cutoff: float = 0.35, beta: float = 0.4, d_cutoff: float = 1.0) -> None:
        self.min_cutoff = min_cutoff  # Hz — más bajo = más suave en reposo
        self.beta = beta              # cuánto abre el cutoff con la velocidad
        self.d_cutoff = d_cutoff
        self._prev_t: float | None = None
        self._prev_x: float | None = None
        self._prev_dx = 0.0

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        import math
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def __call__(self, t: float, x: float) -> float:
        if self._prev_t is None or t <= self._prev_t:
            self._prev_t, self._prev_x, self._prev_dx = t, x, 0.0
            return x
        dt = t - self._prev_t
        dx = (x - self._prev_x) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1 - a_d) * self._prev_dx
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, dt)
        x_hat = a * x + (1 - a) * (self._prev_x if self._prev_x is not None else x)
        self._prev_t, self._prev_x, self._prev_dx = t, x_hat, dx_hat
        return x_hat


class FaceDetector:
    """Detector de rostros con dos backends. Preferencia BlazeFace (MediaPipe,
    más preciso); fallback Haar (OpenCV, sin descargas, offline). El atributo
    `.backend` dice cuál quedó activo ('blazeface' | 'haar')."""

    def __init__(self) -> None:
        self._mp = None
        self._cascade = None
        self.backend = ""

        if _HAS_MEDIAPIPE and MODEL_PATH.exists():
            try:
                base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
                options = mp_vision.FaceDetectorOptions(
                    base_options=base_options,
                    min_detection_confidence=0.4,
                )
                self._mp = mp_vision.FaceDetector.create_from_options(options)
                self.backend = "blazeface"
            except Exception as exc:  # noqa: BLE001
                print(f"[face] BlazeFace no cargó ({exc}); uso Haar", file=sys.stderr)

        if self._mp is None:
            cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            self._cascade = cv2.CascadeClassifier(cascade_path)
            if self._cascade.empty():
                raise RuntimeError(
                    "No hay backend de detección disponible: ni BlazeFace .tflite "
                    f"({MODEL_PATH}) ni el cascade Haar de OpenCV ({cascade_path})."
                )
            self.backend = "haar"

    def detect(self, frame_rgb, frame_w: int, frame_h: int) -> tuple[float, float, float, float] | None:
        """Devuelve (cx, cy, w, h) NORMALIZADO [0,1] del rostro dominante, o None."""
        if self._mp is not None:
            return self._detect_blaze(frame_rgb, frame_w, frame_h)
        return self._detect_haar(frame_rgb, frame_w, frame_h)

    def _detect_blaze(self, frame_rgb, frame_w: int, frame_h: int):
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        result = self._mp.detect(mp_image)
        if not result.detections:
            return None
        # La cara con mayor score (típicamente el speaker dominante).
        best = max(
            result.detections,
            key=lambda d: d.categories[0].score if d.categories else 0,
        )
        bbox = best.bounding_box  # En píxeles
        cx = (bbox.origin_x + bbox.width / 2) / frame_w
        cy = (bbox.origin_y + bbox.height / 2) / frame_h
        return (cx, cy, bbox.width / frame_w, bbox.height / frame_h)

    def _detect_haar(self, frame_rgb, frame_w: int, frame_h: int):
        gray = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2GRAY)
        faces = self._cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(max(16, int(frame_w * 0.05)), max(16, int(frame_w * 0.05))),
        )
        if len(faces) == 0:
            return None
        # La cara más grande (el speaker dominante en plano).
        fx, fy, fw, fh = max(faces, key=lambda f: int(f[2]) * int(f[3]))
        cx = (fx + fw / 2.0) / frame_w
        cy = (fy + fh / 2.0) / frame_h
        return (cx, cy, fw / frame_w, fh / frame_h)

    def close(self) -> None:
        if self._mp is not None:
            try:
                self._mp.close()
            except Exception:  # noqa: BLE001
                pass


def process_video(
    input_path: Path,
    output_path: Path,
    sample_every: int = 5,
    single_frame: bool = False,
    log_progress: bool = True,
) -> dict:
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / fps if fps > 0 else 0.0

    detector = FaceDetector()
    print(f"[face] backend={detector.backend}", file=sys.stderr)

    samples: list[dict] = []
    bbox_history: deque = deque(maxlen=5)
    # Centro del crop con filtro 1€ (jitter muerto, sin lag); w/h se quedan en EMA.
    euro_cx = OneEuroFilter()
    euro_cy = OneEuroFilter()
    detected_count = 0
    sampled_count = 0
    frame_idx = 0
    middle_frame = total_frames // 2 if total_frames > 0 else 0

    # RENDIMIENTO (auditoría 2026-07-20): antes el bucle hacía `cap.read()` en TODOS
    # los frames y descartaba los que no tocaban por muestreo — decodificaba el 100%
    # del video para analizar 1 de cada `sample_every` (y en `single_frame`, para
    # analizar UNO). `grab()` avanza el frame sin hacer el retrieve (armar el ndarray
    # + conversión de color), que es la parte cara; `read()` sólo en los que sí se
    # analizan. Medido en un clip de 33 s: 6.11 s → 3.56 s en barrido (1.71x) y
    # 3.33 s → 2.01 s en single-frame (1.66x), con salida IDÉNTICA.
    #
    # NO usar `cap.set(CAP_PROP_POS_FRAMES, ...)` para saltar al frame del medio:
    # se probó y es sólo 0.2 s más rápido, pero decodifica desde el keyframe previo
    # sin la cadena completa de referencias y devuelve píxeles levemente distintos
    # → el centro de la cara se corría ~1% y el encuadre cambiaba. No vale la pena.
    target_frame = middle_frame

    try:
        while True:
            sampled = (
                frame_idx == target_frame
                if single_frame
                else frame_idx % sample_every == 0
            )
            if sampled:
                ret, frame_bgr = cap.read()
            else:
                # grab(): avanza el frame sin decodificarlo ni armar el ndarray.
                ret = cap.grab()
                frame_bgr = None
            if not ret:
                break

            if not sampled:
                frame_idx += 1
                continue

            sampled_count += 1
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            detection = detector.detect(frame_rgb, width, height)
            t = frame_idx / fps

            if detection:
                bbox_history.append(detection)
                detected_count += 1
            elif bbox_history:
                # No detectó pero hay historial — repetir último para suavizar gap
                bbox_history.append(bbox_history[-1])
            else:
                # Aún no hay cara detectada en ningún frame anterior — saltar este sample
                frame_idx += 1
                continue

            smoothed = smooth_ema(bbox_history, alpha=0.7)
            if smoothed:
                _, _, w, h = smoothed
                # cx/cy: filtro 1€ sobre la detección cruda (con gap-fill) — adaptativo
                # a la velocidad. En single-frame pasa directo (primer sample = x).
                raw = bbox_history[-1]
                cx = euro_cx(t, raw[0])
                cy = euro_cy(t, raw[1])
                samples.append({
                    "t": round(t, 3),
                    "cx": round(max(0.0, min(1.0, cx)), 4),
                    "cy": round(max(0.0, min(1.0, cy)), 4),
                    "w": round(max(0.0, min(1.0, w)), 4),
                    "h": round(max(0.0, min(1.0, h)), 4),
                })

            if log_progress and sampled_count > 0 and sampled_count % 60 == 0:
                pct = (frame_idx / total_frames * 100) if total_frames else 0
                print(
                    f"[face] frame {frame_idx}/{total_frames} ({pct:.0f}%) · "
                    f"detectados {detected_count}/{sampled_count}",
                    file=sys.stderr,
                )

            frame_idx += 1
            if single_frame:
                break
    finally:
        cap.release()
        detector.close()

    detection_rate = detected_count / max(1, sampled_count)
    result = {
        "video": str(input_path),
        "width": width,
        "height": height,
        "fps": fps,
        "duration": round(duration, 3),
        "backend": detector.backend,
        "single_frame": single_frame,
        "sample_every": sample_every if not single_frame else 0,
        "samples": samples,
        "detected_count": detected_count,
        "sampled_count": sampled_count,
        "detection_rate": round(detection_rate, 3),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"[ok] {len(samples)} samples · detection_rate={detection_rate:.0%} · "
        f"out={output_path}",
        file=sys.stderr,
    )
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="Path al video .mp4")
    parser.add_argument("output", help="Path donde guardar el JSON")
    parser.add_argument(
        "--sample-every",
        type=int,
        default=5,
        help="Muestrear cada N frames (default 5 ≈ 6Hz a 30fps). Más alto = más rápido.",
    )
    parser.add_argument(
        "--single-frame",
        action="store_true",
        help="MVP rápido: detectar la cara solo en el frame del medio. Crop estático.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"[error] no existe {input_path}", file=sys.stderr)
        return 1

    try:
        result = process_video(
            input_path,
            output_path,
            sample_every=args.sample_every,
            single_frame=args.single_frame,
        )
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    print(json.dumps({
        "ok": True,
        "samples": len(result["samples"]),
        "detection_rate": result["detection_rate"],
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
