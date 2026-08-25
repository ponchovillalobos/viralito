"""Transcribe un video con WhisperX y produce JSON con timestamps palabra-a-palabra.

Uso:
  python transcribe.py <ruta_video.mp4>
  python transcribe.py --download-model small
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from config import (
    CUTS_DIR,
    FFMPEG_PATH,
    RAW_DIR,
    TRANSCRIPTS_DIR,
    WHISPER_COMPUTE_TYPE,
    WHISPER_DEVICE,
    WHISPER_LANGUAGE,
    WHISPER_MODEL,
    ensure_dirs,
)

# Silencia ~15 líneas de ruido cosmético al importar whisperx: torchcodec no
# carga (libtorchcodec_coreN.dll) porque el ffmpeg bundleado es estático, y
# whisperx cae a otro decoder igual. No afecta la transcripción.
import warnings

warnings.filterwarnings(
    "ignore", message=r".*torchcodec is not installed correctly.*", category=UserWarning
)
warnings.filterwarnings("ignore", module="pyannote.audio.core.io")
warnings.filterwarnings("ignore", message=r".*torchcodec.*", category=UserWarning)


# ── Plan de VELOCIDAD (overrides por env, sin degradar el default) ───────────
# Por qué beam=1: faster-whisper/whisperx decodifican con beam_size=5 por
# default (lento). Con voz limpia, beam=1 da WER casi igual y decodifica ~1.5x
# más rápido. condition_on_previous_text=False evita arrastre de errores y
# acelera. AMBOS son configurables por env:
#   VIRAL_WHISPER_BEAM=5   → vuelve al beam clásico (si el karaoke se ve sensible)
#   VIRAL_WHISPER_CONDITION_PREV=1 → reactiva el condicionamiento por texto previo
# Si dudás del karaoke con beam=1, dejá beam=1 (default) y reportá; el override
# VIRAL_WHISPER_BEAM=5 recupera la calidad anterior exacta.

def _batch_size(device: str) -> int:
    """Cuántos fragmentos de voz se transcriben a la vez, según el hardware.

    El valor estaba escrito a mano como `16 if device == "cuda" else 8` en TRES
    lugares de este archivo. El peso del modelo no depende del lote, pero la
    memoria de trabajo sí, así que un número pensado para una tarjeta grande deja
    a una chica al borde: medido en una RTX 3060 de 6 GB, el lote 16 llegaba a
    5893 MB de 6144 — 251 MB libres, con el escritorio ya adentro de esa cuenta.

    Bajarlo no cambia qué se transcribe ni con qué modelo: sólo cuántos
    fragmentos van juntos. La decisión vive en hw_profile con el resto de las
    recomendaciones por hardware; si no está disponible se conserva el valor de
    antes, que es exactamente el comportamiento previo.
    """
    try:
        from hw_profile import detect  # noqa: PLC0415

        bs = detect().get("recommend", {}).get("whisper_batch_size")
        if isinstance(bs, int) and bs > 0:
            return bs
    except Exception:  # noqa: BLE001
        pass
    return 16 if device == "cuda" else 8


def _whisper_beam() -> int:
    """beam_size para el decoder. Default 1 (rápido); override VIRAL_WHISPER_BEAM."""
    try:
        return max(1, int(os.environ.get("VIRAL_WHISPER_BEAM", "1")))
    except (TypeError, ValueError):
        return 1


def _condition_on_previous() -> bool:
    """condition_on_previous_text. Default False (rápido, sin arrastre).

    Override: VIRAL_WHISPER_CONDITION_PREV=1 lo reactiva.
    """
    return os.environ.get("VIRAL_WHISPER_CONDITION_PREV", "0").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _asr_options() -> dict[str, Any]:
    """Opciones de decodificación para whisperx.load_model(asr_options=...).

    whisperx mergea esto sobre sus defaults (ver asr.load_model), así que sólo
    pisamos beam_size y condition_on_previous_text; el resto queda intacto.
    """
    return {
        "beam_size": _whisper_beam(),
        "condition_on_previous_text": _condition_on_previous(),
    }


def _cpu_threads(device: str) -> int | None:
    """Hilos CTranslate2 para CPU = núcleos FÍSICOS (clamp >=4). None en GPU.

    CTranslate2 (backend de faster-whisper) usa 4 hilos por default; en CPUs de
    6-8+ cores conviene usar los cores físicos. Import lazy de hw_profile para no
    pagar el costo cuando corremos en GPU.
    """
    if device == "cuda":
        return None
    try:
        import hw_profile

        cores = int(hw_profile.detect().get("cores_physical") or 0)
    except Exception:  # noqa: BLE001 — si falla la detección, dejamos el default de whisperx
        return None
    return max(4, cores)


def _load_model_kwargs(device: str) -> dict[str, Any]:
    """kwargs extra para whisperx.load_model: asr_options + threads (CPU)."""
    kwargs: dict[str, Any] = {"asr_options": _asr_options()}
    threads = _cpu_threads(device)
    if threads is not None:
        kwargs["threads"] = threads
    print(
        f"[transcribe] beam={kwargs['asr_options']['beam_size']} "
        f"condition_prev={kwargs['asr_options']['condition_on_previous_text']} "
        f"threads={threads if threads is not None else 'gpu/default'}",
        file=sys.stderr,
    )
    return kwargs


def extract_audio(video_path: Path, out_wav: Path) -> None:
    """Extrae pista de audio a WAV mono 16kHz (formato preferido por Whisper).

    Si ffmpeg falla, NO tiramos un CalledProcessError con un exit code críptico:
    leemos su stderr y damos un mensaje accionable (video corrupto / sin audio),
    que es lo que termina viendo el usuario en el panel del job.
    """
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
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or "").lower()
        if "moov atom not found" in err or "invalid data" in err:
            raise RuntimeError(
                "El video está incompleto o corrupto (falta el átomo moov). "
                "Probablemente la subida se cortó — volvé a subirlo."
            )
        if "does not contain any stream" in err or "output file #0 does not contain" in err:
            raise RuntimeError("El video no tiene pista de audio; no se puede transcribir.")
        # Otro error de ffmpeg: pasar el final del stderr, que es lo informativo.
        tail = (proc.stderr or "").strip().splitlines()[-5:]
        raise RuntimeError("ffmpeg no pudo extraer el audio:\n" + "\n".join(tail))
    # ffmpeg salió 0 pero por las dudas: si no hay WAV o pesa nada, no hay audio.
    if not out_wav.exists() or out_wav.stat().st_size < 1024:
        raise RuntimeError("El video no produjo audio (¿pista de audio vacía?).")


def transcribe(
    video_path: Path, model_size: str = WHISPER_MODEL, align: bool = True
) -> dict[str, Any]:
    """Transcribe palabras. Retorna dict con words[].

    align=True (DEFAULT): corre whisperx.align() → timestamps por PALABRA precisos,
    necesarios para subtítulos karaoke (presets karaoke). Es la etapa CARA.

    align=False: SALTA el align. Produce words[] a nivel FRASE interpolando los
    timestamps de cada segmento (reusa _segments_to_words). Mucho más rápido y
    suficiente para presets que NO usan karaoke (Limpio / Revista / Clips, que sólo
    necesitan saber qué se dijo y aproximadamente cuándo). El caller lo pide con
    --no-align en la CLI. NO cambia el camino karaoke (default sigue con align).
    """
    import whisperx

    # Decisión de device/compute_type en UN solo lugar: config (autodetectado por
    # hardware vía hw_profile, con override por env VIRAL_WHISPER_DEVICE/_COMPUTE_TYPE).
    device, compute_type = WHISPER_DEVICE, WHISPER_COMPUTE_TYPE
    batch_size = _batch_size(device)
    print(f"[transcribe] device={device} compute={compute_type} align={align}", file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "audio.wav"
        extract_audio(video_path, wav_path)

        print(f"[transcribe] cargando modelo whisperx '{model_size}'...", file=sys.stderr)
        model = whisperx.load_model(
            model_size,
            device=device,
            compute_type=compute_type,
            language=WHISPER_LANGUAGE,
            **_load_model_kwargs(device),
        )

        print("[transcribe] transcribiendo...", file=sys.stderr)
        audio = whisperx.load_audio(str(wav_path))
        result = model.transcribe(audio, batch_size=batch_size, language=WHISPER_LANGUAGE)

        if not align:
            # Camino rápido: sin align, words[] a nivel frase (interpolado).
            print("[transcribe] SIN align (nivel frase)...", file=sys.stderr)
            words = _segments_to_words(result.get("segments", []), offset=0.0)
            return {
                "video": video_path.name,
                "language": WHISPER_LANGUAGE,
                "model": model_size,
                "duration": round(len(audio) / 16000.0, 3),
                "alignment": "segment",  # marca: timestamps por frase, no palabra
                "words": words,
            }

        print("[transcribe] cargando modelo de alineación...", file=sys.stderr)
        align_model, metadata = whisperx.load_align_model(language_code=WHISPER_LANGUAGE, device=device)

        print("[transcribe] alineando palabras...", file=sys.stderr)
        aligned = whisperx.align(
            result["segments"],
            align_model,
            metadata,
            audio,
            device,
            return_char_alignments=False,
        )

        words: list[dict[str, Any]] = []
        for segment in aligned.get("segments", []):
            for w in segment.get("words", []):
                if "start" in w and "end" in w:
                    words.append(
                        {
                            "word": w.get("word", "").strip(),
                            "start": round(float(w["start"]), 3),
                            "end": round(float(w["end"]), 3),
                            "score": round(float(w.get("score", 0.0)), 3),
                        }
                    )

        return {
            "video": video_path.name,
            "language": WHISPER_LANGUAGE,
            "model": model_size,
            "duration": round(len(audio) / 16000.0, 3),
            "words": words,
        }


def _segments_to_words(
    segments: list[dict[str, Any]], offset: float
) -> list[dict[str, Any]]:
    """Convierte segmentos (sin alineación) en un array `words[]` interpolando timestamps.

    WhisperX `model.transcribe()` sin `align()` da segmentos con texto + start/end de
    frase, pero NO timestamps por palabra. Para *elegir* clips virales no hace falta
    precisión palabra-por-palabra (alcanza ~frase), así que repartimos los tokens del
    segmento linealmente en su ventana de tiempo. La precisión real para el karaoke se
    saca después, clip por clip, en extract_clips (esos clips duran ~50s, no crashean).
    """
    words: list[dict[str, Any]] = []
    for seg in segments:
        try:
            seg_start = offset + float(seg["start"])
            seg_end = offset + float(seg["end"])
        except (KeyError, ValueError, TypeError):
            continue
        toks = str(seg.get("text", "")).strip().split()
        if not toks:
            continue
        span = max(0.1, seg_end - seg_start)
        per = span / len(toks)
        for k, tok in enumerate(toks):
            words.append({
                "word": tok,
                "start": round(seg_start + k * per, 3),
                "end": round(seg_start + (k + 1) * per, 3),
                "score": 0.0,
            })
    return words


def _try_batched_transcribe(
    wav_path: Path,
    model_size: str,
    device: str,
    compute_type: str,
) -> list[dict[str, Any]] | None:
    """Intenta transcribir TODO el audio de una vez con BatchedInferencePipeline.

    faster-whisper (que whisperx usa por debajo) trae BatchedInferencePipeline:
    hace VAD + batching de los segmentos de voz y los corre en paralelo, ~7-12x
    más rápido que el loop secuencial por ventanas. La memoria queda acotada
    porque procesa sólo segmentos de voz (no el audio crudo entero a la vez).

    Devuelve un words[] a nivel FRASE (mismo formato/semántica que el loop por
    ventanas: interpolado vía _segments_to_words con offset=0, porque cada
    segmento ya trae sus start/end absolutos del audio completo).

    Es CONSERVADOR: si la lib no está, el modelo/dispositivo no lo soporta, o algo
    truena, devuelve None y el caller cae al método por ventanas (probado en prod).
    """
    try:
        from faster_whisper import BatchedInferencePipeline, WhisperModel
    except Exception as exc:  # faster_whisper viejo / sin la clase
        print(f"[chunked] BatchedInferencePipeline no disponible ({exc}); uso ventanas", file=sys.stderr)
        return None

    try:
        print(f"[chunked] probando BatchedInferencePipeline (VAD batching) '{model_size}'...", file=sys.stderr)
        # cpu_threads = cores físicos en CPU (clamp >=4); en GPU dejamos el default
        # de CTranslate2. beam=1 + condition_on_previous_text=False por el plan de
        # velocidad (override por env, ver helpers arriba).
        wm_kwargs: dict[str, Any] = {}
        threads = _cpu_threads(device)
        if threads is not None:
            wm_kwargs["cpu_threads"] = threads
        base = WhisperModel(model_size, device=device, compute_type=compute_type, **wm_kwargs)
        pipeline = BatchedInferencePipeline(model=base)
        # batch_size alto en GPU, moderado en CPU. VAD recorta silencios.
        batch_size = _batch_size(device)
        beam = _whisper_beam()
        cond_prev = _condition_on_previous()
        print(
            f"[chunked] beam={beam} condition_prev={cond_prev} "
            f"cpu_threads={threads if threads is not None else 'gpu/default'}",
            file=sys.stderr,
        )
        seg_iter, _info = pipeline.transcribe(
            str(wav_path),
            batch_size=batch_size,
            language=WHISPER_LANGUAGE,
            vad_filter=True,
            beam_size=beam,
            condition_on_previous_text=cond_prev,
            # Tiempos REALES por palabra, del propio modelo. Antes se pedían solo
            # los de cada frase y las palabras se repartían linealmente dentro de
            # ella, lo que deja a todas pegadas: medido sobre un video de 99
            # minutos, de 10.800 huecos entre palabras sólo 55 eran mayores que
            # cero, y la mediana era exactamente 0.000s.
            #
            # Eso no afecta a los subtítulos —cada clip se re-transcribe con
            # alineación propia, y ahí los huecos sí son reales— pero sí a la
            # ELECCIÓN de dónde termina cada clip: el ajuste al fin de frase busca
            # puntuación o una pausa de ≥0.5s, y sin pausas reales quedaban 26
            # candidatos en 99 minutos. Por eso 7 de cada 20 clips cerraban a
            # mitad de oración.
            #
            # No es gratis (el modelo alinea por atención cruzada), pero es mucho
            # más barato que cargar un alineador aparte, y sin esto la mitad del
            # criterio de corte no existe.
            word_timestamps=True,
        )
        # faster_whisper devuelve Segment (objeto), no dict: normalizamos a dicts
        # con text/start/end para reusar _segments_to_words tal cual.
        segs: list[dict[str, Any]] = []
        palabras_reales: list[dict[str, Any]] = []
        for s in seg_iter:
            try:
                segs.append({"text": s.text, "start": float(s.start), "end": float(s.end)})
            except Exception:
                continue
            # `words` puede venir vacío o ausente según versión/segmento; se juntan
            # las que haya y recién al final se decide si alcanzan.
            for pw in (getattr(s, "words", None) or []):
                try:
                    palabras_reales.append({
                        "word": str(pw.word).strip(),
                        "start": round(float(pw.start), 3),
                        "end": round(float(pw.end), 3),
                        "score": round(float(getattr(pw, "probability", 0.0) or 0.0), 3),
                    })
                except (AttributeError, TypeError, ValueError):
                    continue
        if not segs:
            print("[chunked] BatchedInferencePipeline no devolvió segmentos; uso ventanas", file=sys.stderr)
            return None
        # Se exige una cobertura razonable antes de confiar en las palabras reales:
        # una lista a medias mezclada con interpolación sería peor que interpolar
        # todo, porque los huecos dejarían de significar lo mismo a lo largo del video.
        esperadas = sum(len(str(x["text"]).split()) for x in segs)
        if palabras_reales and esperadas and len(palabras_reales) >= esperadas * 0.9:
            words = palabras_reales
        else:
            if palabras_reales:
                print(
                    f"[chunked] tiempos por palabra incompletos ({len(palabras_reales)} de "
                    f"~{esperadas}): se interpola, como antes",
                    file=sys.stderr,
                )
            words = _segments_to_words(segs, offset=0.0)
        print(
            f"[chunked] BatchedInferencePipeline OK · {len(segs)} frases · {len(words)} palabras",
            file=sys.stderr, flush=True,
        )
        return words
    except Exception as exc:  # noqa: BLE001 — cualquier fallo → fallback seguro
        print(f"[chunked] BatchedInferencePipeline falló ({exc}); caigo a ventanas", file=sys.stderr)
        return None


def transcribe_chunked(
    video_path: Path,
    model_size: str = WHISPER_MODEL,
    chunk_sec: int = 900,
) -> dict[str, Any]:
    """Transcribe videos LARGOS en ventanas de ~15 min, a nivel FRASE (sin align).

    Por qué: transcribir+alinear los 80-90 min de una sola vez revienta la memoria
    (la etapa de alineación de WhisperX murió a las 2h en prod). Acá:
      - extraemos el audio completo (ffmpeg de 90 min es liviano),
      - cargamos el modelo UNA vez,
      - transcribimos por ventanas de ~15 min (probado seguro: ~1.5GB RSS),
      - NO alineamos (esa es la parte cara y que crashea),
      - sintetizamos `words[]` interpolando los timestamps de cada frase.
    El resultado alimenta a analyze_clips (Ollama) para elegir lo más viral.
    """
    import gc

    import whisperx

    device, compute_type = WHISPER_DEVICE, WHISPER_COMPUTE_TYPE
    batch_size = _batch_size(device)
    print(f"[chunked] device={device} compute={compute_type}", file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "audio.wav"
        extract_audio(video_path, wav_path)

        # CAMINO RÁPIDO (~7-12x): un solo pase con VAD batching si está disponible.
        # Si no, cae al loop por ventanas de abajo (probado en prod). Necesitamos la
        # duración total para el dict de salida; la sacamos del WAV sin cargar todo
        # el audio en RAM dos veces.
        try:
            import wave

            with wave.open(str(wav_path), "rb") as wf:
                total_sec_hdr = wf.getnframes() / float(wf.getframerate() or 16000)
        except Exception:
            total_sec_hdr = 0.0

        batched_words = _try_batched_transcribe(wav_path, model_size, device, compute_type)
        if batched_words is not None:
            # La marca de alineación se DEDUCE de los datos, no se afirma: este
            # camino ahora pide tiempos por palabra al modelo, pero cae a
            # interpolar si vinieron incompletos, y quien lea el transcript
            # necesita saber cuál de las dos cosas pasó. Interpolar reparte las
            # palabras linealmente dentro de cada frase, así que quedan pegadas —
            # si aparecen huecos de verdad, los tiempos son del modelo.
            _huecos = sum(
                1 for a, b in zip(batched_words, batched_words[1:])
                if float(b.get("start", 0)) - float(a.get("end", 0)) > 0.001
            )
            _por_palabra = len(batched_words) > 1 and _huecos > len(batched_words) * 0.25
            return {
                "video": video_path.name,
                "language": WHISPER_LANGUAGE,
                "model": model_size,
                "duration": round(total_sec_hdr, 3),
                "alignment": "word" if _por_palabra else "segment",
                "method": "batched",
                "words": batched_words,
            }

        print(f"[chunked] cargando modelo whisperx '{model_size}'...", file=sys.stderr)
        model = whisperx.load_model(
            model_size,
            device=device,
            compute_type=compute_type,
            language=WHISPER_LANGUAGE,
            **_load_model_kwargs(device),
        )

        audio = whisperx.load_audio(str(wav_path))
        sr = 16000
        total_sec = len(audio) / sr
        n_windows = max(1, int((total_sec + chunk_sec - 1) // chunk_sec))
        print(
            f"[chunked] {total_sec / 60:.1f} min → {n_windows} ventana(s) de ~{chunk_sec // 60} min",
            file=sys.stderr,
        )

        words: list[dict[str, Any]] = []
        for wi in range(n_windows):
            ws = wi * chunk_sec
            we = min((wi + 1) * chunk_sec, total_sec)
            if we - ws < 1.0:
                continue
            slice_audio = audio[int(ws * sr): int(we * sr)]
            print(
                f"[chunked] ventana {wi + 1}/{n_windows} "
                f"({ws / 60:.0f}-{we / 60:.0f} min) transcribiendo...",
                file=sys.stderr, flush=True,
            )
            t0 = time.time()
            try:
                result = model.transcribe(
                    slice_audio, batch_size=batch_size, language=WHISPER_LANGUAGE
                )
            except Exception as exc:
                print(f"[chunked] ventana {wi + 1} falló: {exc} — sigo", file=sys.stderr)
                del slice_audio
                gc.collect()
                continue
            segs = result.get("segments", [])
            new_words = _segments_to_words(segs, offset=ws)
            words.extend(new_words)
            print(
                f"[chunked] ventana {wi + 1}/{n_windows}: "
                f"{len(segs)} frases · {len(new_words)} palabras · {time.time() - t0:.0f}s",
                file=sys.stderr, flush=True,
            )
            del slice_audio, result, segs, new_words
            gc.collect()

        return {
            "video": video_path.name,
            "language": WHISPER_LANGUAGE,
            "model": model_size,
            "duration": round(total_sec, 3),
            "alignment": "segment",  # marca: timestamps por frase, no palabra
            "words": words,
        }


def download_model(model_size: str) -> None:
    """Descarga los DOS modelos que necesita transcribir (voz + alineación) con
    REINTENTOS. Sin esto, un corte de internet a media descarga dejaba el caché
    incompleto y la transcripción fallaba después — la causa #1 de "no transcribe".
    """
    import time

    import whisperx

    fases = [
        (
            f"modelo de voz '{model_size}'",
            lambda: whisperx.load_model(
                model_size, device="cpu", compute_type=WHISPER_COMPUTE_TYPE, language=WHISPER_LANGUAGE
            ),
        ),
        (
            "modelo de alineación (timestamps por palabra)",
            lambda: whisperx.load_align_model(language_code=WHISPER_LANGUAGE, device="cpu"),
        ),
    ]
    intentos = 4
    for nombre, cargar in fases:
        for i in range(1, intentos + 1):
            try:
                print(f"[download] descargando {nombre} (intento {i}/{intentos})...", flush=True)
                cargar()
                break
            except Exception as e:  # red caída, HF temporalmente abajo, etc.
                if i >= intentos:
                    print(f"[download] no se pudo descargar {nombre} tras {intentos} intentos: {e}", flush=True)
                    raise
                espera = min(30, 5 * i)
                print(f"[download] falló ({e}); reintento en {espera}s...", flush=True)
                time.sleep(espera)
    print("OK")


def transcribe_batch(jobs: list[dict[str, str]], model_size: str = WHISPER_MODEL) -> int:
    """Transcribe N videos CORTOS (clips de ~50s) con UNA sola carga de modelo.

    Antes, extract_clips spawneaba un proceso Python NUEVO por clip → torch +
    Whisper + alignment se cargaban 15+ veces por video largo (minutos de
    overhead puro). Acá: 1 carga, N clips. Cada job: {"video": path, "out": path}.
    Un clip que falla NO corta el batch (queda sin transcript; el caller pone
    uno vacío).
    """
    import whisperx

    device, compute_type = WHISPER_DEVICE, WHISPER_COMPUTE_TYPE
    batch_size = _batch_size(device)
    print(
        f"[batch] {len(jobs)} clips · device={device} · modelo se carga UNA sola vez",
        file=sys.stderr, flush=True,
    )
    model = whisperx.load_model(
        model_size, device=device, compute_type=compute_type, language=WHISPER_LANGUAGE,
        **_load_model_kwargs(device),
    )
    align_model, metadata = whisperx.load_align_model(language_code=WHISPER_LANGUAGE, device=device)

    ok_count = 0
    for i, job in enumerate(jobs, start=1):
        video_path = Path(job["video"])
        out_path = Path(job["out"])
        try:
            with tempfile.TemporaryDirectory() as tmp:
                wav = Path(tmp) / "audio.wav"
                extract_audio(video_path, wav)
                audio = whisperx.load_audio(str(wav))
                result = model.transcribe(audio, batch_size=batch_size, language=WHISPER_LANGUAGE)
                aligned = whisperx.align(
                    result["segments"], align_model, metadata, audio, device,
                    return_char_alignments=False,
                )
                words: list[dict[str, Any]] = []
                for segment in aligned.get("segments", []):
                    for w in segment.get("words", []):
                        if "start" in w and "end" in w:
                            words.append({
                                "word": w.get("word", "").strip(),
                                "start": round(float(w["start"]), 3),
                                "end": round(float(w["end"]), 3),
                                "score": round(float(w.get("score", 0.0)), 3),
                            })
                out = {
                    "video": video_path.name,
                    "language": WHISPER_LANGUAGE,
                    "model": model_size,
                    "duration": round(len(audio) / 16000.0, 3),
                    "words": words,
                }
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
                ok_count += 1
                print(f"[batch] {i}/{len(jobs)} OK · {len(words)} palabras · {video_path.name}", file=sys.stderr, flush=True)
        except Exception as e:  # noqa: BLE001 — un clip malo no corta el batch
            print(f"[batch] {i}/{len(jobs)} FALLÓ {video_path.name}: {e}", file=sys.stderr, flush=True)

    print(json.dumps({"ok": True, "batch": len(jobs), "transcribed": ok_count}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", nargs="?", help="Path al video .mp4 (o solo nombre si está en raw/)")
    parser.add_argument("--download-model", metavar="SIZE", help="Descarga el modelo sin transcribir")
    parser.add_argument("--out", help="Path JSON de salida (default: transcripts/<video>.json)")
    parser.add_argument(
        "--batch", metavar="JOBS_JSON",
        help='Transcribe N clips con UNA carga de modelo. JSON: [{"video": path, "out": path}, ...]',
    )
    parser.add_argument(
        "--chunked",
        action="store_true",
        help="Transcribir en ventanas (nivel frase, sin align). Para videos largos sin crashear.",
    )
    parser.add_argument(
        "--chunk-sec", type=int, default=900,
        help="Tamaño de ventana en seg para --chunked (default 900 = 15 min).",
    )
    parser.add_argument(
        "--no-align",
        action="store_true",
        help=(
            "Saltar la alineación por palabra (whisperx.align). MÁS RÁPIDO; "
            "produce words[] a nivel frase. Úsalo en presets SIN karaoke "
            "(Limpio/Revista/Clips). El default (con align) se mantiene para karaoke."
        ),
    )
    args = parser.parse_args()

    ensure_dirs()

    if args.download_model:
        download_model(args.download_model)
        return 0

    if args.batch:
        # utf-8-sig: tolera BOM (PowerShell escribe JSON con BOM por default).
        jobs = json.loads(Path(args.batch).read_text(encoding="utf-8-sig"))
        return transcribe_batch(jobs)

    if not args.video:
        parser.error("Especificá un video, --batch o --download-model")

    video_path = Path(args.video)
    if not video_path.is_absolute() and not video_path.exists():
        video_path = RAW_DIR / video_path

    if not video_path.exists():
        print(f"[error] video no encontrado: {video_path}", file=sys.stderr)
        return 1

    out_path = Path(args.out) if args.out else TRANSCRIPTS_DIR / f"{video_path.stem}.json"

    t0 = time.time()
    if args.chunked:
        result = transcribe_chunked(video_path, chunk_sec=args.chunk_sec)
    else:
        result = transcribe(video_path, align=not args.no_align)
    elapsed = time.time() - t0

    result["meta"] = {"elapsed_sec": round(elapsed, 1)}

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"ok": True, "out": str(out_path), "words": len(result["words"]), "elapsed_sec": round(elapsed, 1)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
