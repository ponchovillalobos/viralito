"""Sintetiza una biblioteca básica de SFX cortos para el modo cinematográfico.

Genera WAV mono 22050 Hz usando solo stdlib (wave + math + struct + random),
luego convierte a MP3 con ffmpeg. NO requiere numpy/scipy ni archivos externos.

Los SFX son lo suficientemente simples para sentirse "naturales" en un video corto
sin pretender ser grabaciones profesionales. Si más adelante se quieren reemplazar
con grabaciones reales de Mixkit/Pixabay, basta poner los .mp3 en C:\\hermes-data\\sfx\\
con los mismos nombres.

Uso:
  python synth_sfx.py --out-dir C:/hermes-data/sfx
"""
from __future__ import annotations

import argparse
import math
import random
import struct
import subprocess
import sys
import wave
from pathlib import Path

# ffmpeg path (reusar la lógica del proyecto)
try:
    from config import FFMPEG_PATH
    FFMPEG = str(FFMPEG_PATH)
except Exception:
    FFMPEG = "ffmpeg"

SAMPLE_RATE = 22050


def write_wav(samples: list[float], path: Path) -> None:
    """Escribe lista de floats normalizados [-1, 1] como WAV 16-bit mono."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        frames = b"".join(
            struct.pack("<h", max(-32768, min(32767, int(s * 32767)))) for s in samples
        )
        wf.writeframes(frames)


def convert_to_mp3(wav_path: Path, mp3_path: Path) -> None:
    """Convierte WAV a MP3 con ffmpeg (160kbps mono)."""
    cmd = [
        FFMPEG, "-y", "-i", str(wav_path),
        "-b:a", "128k", "-ac", "1",
        str(mp3_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    wav_path.unlink(missing_ok=True)


def envelope(n: int, attack_s: float, sustain_s: float, decay_s: float, total_s: float) -> list[float]:
    """ADSR-lite: rampa de attack → sustain plano → rampa de decay → silencio."""
    sr = SAMPLE_RATE
    attack_n = int(attack_s * sr)
    sustain_n = int(sustain_s * sr)
    decay_n = int(decay_s * sr)
    total_n = int(total_s * sr)
    env: list[float] = []
    for i in range(total_n):
        if i < attack_n:
            env.append(i / max(1, attack_n))
        elif i < attack_n + sustain_n:
            env.append(1.0)
        elif i < attack_n + sustain_n + decay_n:
            t = (i - attack_n - sustain_n) / max(1, decay_n)
            env.append(1.0 - t)
        else:
            env.append(0.0)
    if len(env) < n:
        env.extend([0.0] * (n - len(env)))
    return env[:n]


def low_pass(samples: list[float], cutoff_hz: float) -> list[float]:
    """Filtro low-pass 1-pole simple. cutoff_hz aproximado."""
    rc = 1 / (2 * math.pi * cutoff_hz)
    dt = 1 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    out = [samples[0]]
    for i in range(1, len(samples)):
        out.append(out[-1] + alpha * (samples[i] - out[-1]))
    return out


# ─── Síntesis de cada SFX ─────────────────────────────────────────────────────

def gen_whoosh(out: Path, duration: float = 0.8, sweep_low: float = 100, sweep_high: float = 2000) -> None:
    """Whoosh = white noise filtrado con sweep de cutoff frequency."""
    n = int(duration * SAMPLE_RATE)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    out_samples = []
    # Filtro variable
    rc_state = 0.0
    for i in range(n):
        t = i / n
        # Cutoff barre de low → high → low (bell shape)
        cutoff = sweep_low + (sweep_high - sweep_low) * math.sin(math.pi * t)
        rc = 1 / (2 * math.pi * cutoff)
        dt = 1 / SAMPLE_RATE
        alpha = dt / (rc + dt)
        rc_state = rc_state + alpha * (noise[i] - rc_state)
        out_samples.append(rc_state)
    env = envelope(n, 0.05, duration * 0.4, duration * 0.5, duration)
    final = [s * e * 0.6 for s, e in zip(out_samples, env)]
    wav_path = out.with_suffix(".wav")
    write_wav(final, wav_path)
    convert_to_mp3(wav_path, out)


def gen_typewriter_key(out: Path) -> None:
    """Click metálico corto + decay rápido."""
    duration = 0.15
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Click inicial = ruido + tono alto que decae fast
        noise = random.uniform(-1, 1) * math.exp(-t * 80)
        tone = math.sin(2 * math.pi * 1400 * t) * math.exp(-t * 30) * 0.3
        samples.append((noise + tone) * 0.5)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_camera_shutter(out: Path) -> None:
    """Click mecánico tipo cámara con doble pop (apertura + cierre)."""
    duration = 0.35
    n = int(duration * SAMPLE_RATE)
    samples = [0.0] * n
    # Pop 1 en t=0.02
    pop1_start = int(0.02 * SAMPLE_RATE)
    for i in range(pop1_start, min(pop1_start + 800, n)):
        t = (i - pop1_start) / SAMPLE_RATE
        samples[i] = random.uniform(-1, 1) * math.exp(-t * 60) * 0.7
    # Pop 2 en t=0.18 (cierre del obturador)
    pop2_start = int(0.18 * SAMPLE_RATE)
    for i in range(pop2_start, min(pop2_start + 1200, n)):
        t = (i - pop2_start) / SAMPLE_RATE
        samples[i] += random.uniform(-1, 1) * math.exp(-t * 40) * 0.6
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_vhs_static(out: Path, duration: float = 0.4) -> None:
    """Pop + ráfaga de white noise tipo VHS arrancando."""
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Pop inicial
        pop = math.exp(-t * 50) * (random.uniform(-1, 1) if t < 0.05 else 0)
        # Noise sostenido decayendo
        noise = random.uniform(-1, 1) * (1 - t / duration) * 0.4
        samples.append((pop + noise) * 0.5)
    # Filtrar para que el noise no sea agudo puro
    samples = low_pass(samples, 4000)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_glitch(out: Path) -> None:
    """Pulsos cortos random de sawtooth — sensación de error digital."""
    duration = 0.25
    n = int(duration * SAMPLE_RATE)
    samples = [0.0] * n
    # Generar 3-5 burst de sawtooth a frecuencias random
    bursts = random.randint(3, 5)
    for _ in range(bursts):
        burst_start = int(random.random() * (n - 1000))
        burst_dur = random.randint(500, 1500)
        freq = random.choice([200, 400, 800, 1200, 1800])
        for i in range(burst_start, min(burst_start + burst_dur, n)):
            t = (i - burst_start) / SAMPLE_RATE
            # Sawtooth simple
            phase = (t * freq) % 1.0
            value = (phase * 2 - 1) * math.exp(-t * 20) * 0.5
            samples[i] += value
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_paper_rustle(out: Path) -> None:
    """White noise filtrado modulado con envelope irregular."""
    duration = 0.6
    n = int(duration * SAMPLE_RATE)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    filtered = low_pass(noise, 3500)
    # Modulación tipo papel agitado
    samples = []
    for i, s in enumerate(filtered):
        t = i / SAMPLE_RATE
        # Multiplicador irregular
        mod = 0.5 + 0.5 * math.sin(2 * math.pi * 6 * t + math.sin(20 * t))
        samples.append(s * mod * 0.4)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_ding(out: Path) -> None:
    """Tono claro con decay largo — campanita digital."""
    duration = 0.7
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Tono fundamental + 2 armónicos
        fundamental = math.sin(2 * math.pi * 880 * t)
        harm2 = math.sin(2 * math.pi * 1320 * t) * 0.3
        harm3 = math.sin(2 * math.pi * 1760 * t) * 0.15
        env = math.exp(-t * 4)
        samples.append((fundamental + harm2 + harm3) * env * 0.4)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_swoosh_cinematic(out: Path) -> None:
    """Whoosh largo más dramático para transiciones cinemáticas."""
    gen_whoosh(out, duration=1.2, sweep_low=80, sweep_high=3000)


def gen_transition_up(out: Path) -> None:
    """Sweep up rápido — transición a beat más alto."""
    duration = 0.5
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 200 + 1200 * (t / duration) ** 2
        s = math.sin(2 * math.pi * freq * t)
        env = math.sin(math.pi * (t / duration))
        samples.append(s * env * 0.35)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_transition_down(out: Path) -> None:
    """Sweep down — transición a beat más bajo."""
    duration = 0.5
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 1400 - 1200 * (t / duration) ** 2
        s = math.sin(2 * math.pi * freq * t)
        env = math.sin(math.pi * (t / duration))
        samples.append(s * env * 0.35)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_drum_hit(out: Path) -> None:
    """Kick drum corto — para enfatizar momentos."""
    duration = 0.4
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Pitch sweep 120 → 50 Hz + envelope corto
        freq = 120 * math.exp(-t * 6) + 50
        s = math.sin(2 * math.pi * freq * t)
        env = math.exp(-t * 8)
        samples.append(s * env * 0.7)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_heartbeat(out: Path) -> None:
    """Latido doble — tensión narrativa."""
    duration = 1.2
    n = int(duration * SAMPLE_RATE)
    samples = [0.0] * n
    # Beat 1 en t=0.1
    for i in range(int(0.1 * SAMPLE_RATE), min(int(0.25 * SAMPLE_RATE), n)):
        t = (i - 0.1 * SAMPLE_RATE) / SAMPLE_RATE
        freq = 80 * math.exp(-t * 8) + 30
        samples[i] = math.sin(2 * math.pi * freq * t) * math.exp(-t * 10) * 0.6
    # Beat 2 en t=0.45
    for i in range(int(0.45 * SAMPLE_RATE), min(int(0.6 * SAMPLE_RATE), n)):
        t = (i - 0.45 * SAMPLE_RATE) / SAMPLE_RATE
        freq = 80 * math.exp(-t * 8) + 30
        samples[i] = math.sin(2 * math.pi * freq * t) * math.exp(-t * 10) * 0.5
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_deep_boom(out: Path) -> None:
    """Boom cinematográfico grave — momentos de revelación."""
    duration = 1.5
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Sub-bass 40 Hz sostenido + harmonics
        fund = math.sin(2 * math.pi * 40 * t)
        h2 = math.sin(2 * math.pi * 80 * t) * 0.3
        # Envelope con attack lento + decay largo
        env = (1 - math.exp(-t * 4)) * math.exp(-t * 1.5)
        samples.append((fund + h2) * env * 0.7)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_reverse_whoosh(out: Path) -> None:
    """Whoosh en reversa — buenas para builds/anticipación."""
    duration = 0.8
    n = int(duration * SAMPLE_RATE)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    samples = []
    rc_state = 0.0
    for i in range(n):
        t = i / n
        # Cutoff baja → alta (al revés del whoosh normal)
        cutoff = 80 + 3000 * t
        rc = 1 / (2 * math.pi * cutoff)
        dt = 1 / SAMPLE_RATE
        alpha = dt / (rc + dt)
        rc_state = rc_state + alpha * (noise[i] - rc_state)
        # Envelope creciente: 0 → 1 (anticipación)
        env = t ** 2
        samples.append(rc_state * env * 0.7)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_impact_hit(out: Path) -> None:
    """Impacto seco — golpe dramático para revelación."""
    duration = 0.5
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Click inicial corto
        click = random.uniform(-1, 1) * math.exp(-t * 200) * 0.5 if t < 0.01 else 0
        # Sub-bass que sigue
        bass = math.sin(2 * math.pi * 60 * t) * math.exp(-t * 6) * 0.7
        # Mid-noise tail
        noise_tail = random.uniform(-1, 1) * math.exp(-t * 12) * 0.2
        samples.append(click + bass + noise_tail)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_riser_short(out: Path) -> None:
    """Riser corto — build de 1.5s para anticipación."""
    duration = 1.5
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Pitch que sube exponencialmente
        freq = 80 * math.exp(t * 2)
        s = math.sin(2 * math.pi * freq * t)
        # Saw secundario para más cuerpo
        saw = ((freq * t) % 1.0) * 2 - 1
        # Envelope creciente fuerte
        env = (t / duration) ** 1.5
        samples.append((s + saw * 0.3) * env * 0.4)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_pop(out: Path) -> None:
    """Pop corto — acentos rápidos en palabras."""
    duration = 0.15
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Tono alto que decae muy rápido
        freq = 800 * math.exp(-t * 40) + 200
        s = math.sin(2 * math.pi * freq * t)
        env = math.exp(-t * 50)
        samples.append(s * env * 0.5)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_click_select(out: Path) -> None:
    """Click UI corto — para enfatizar palabras clave."""
    duration = 0.1
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        s = math.sin(2 * math.pi * 1200 * t)
        env = math.exp(-t * 60)
        samples.append(s * env * 0.4)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_tape_stop(out: Path) -> None:
    """Tape stop — efecto de cinta detenida bruscamente."""
    duration = 0.6
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Pitch que baja exponencialmente
        freq = 400 * math.exp(-t * 5)
        s = math.sin(2 * math.pi * freq * t)
        env = math.exp(-t * 3)
        samples.append(s * env * 0.5)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_static_burst(out: Path) -> None:
    """Burst de estática TV súbito — buenísimo para entrada de imagen tipo recuerdo."""
    duration = 0.3
    n = int(duration * SAMPLE_RATE)
    samples = [random.uniform(-1, 1) * (1 - i / n) ** 1.5 * 0.5 for i in range(n)]
    # Low pass para que no sea tan agudo
    samples = low_pass(samples, 5000)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def gen_reveal_chime(out: Path) -> None:
    """Chime suave para momentos de revelación."""
    duration = 1.2
    n = int(duration * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        # Acorde mayor: 523 (C5) + 659 (E5) + 784 (G5)
        c = math.sin(2 * math.pi * 523 * t)
        e = math.sin(2 * math.pi * 659 * t) * 0.7
        g = math.sin(2 * math.pi * 784 * t) * 0.5
        env = math.exp(-t * 2.5)
        samples.append((c + e + g) * env * 0.3)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


def _typewriter_key_into(buf: list[float], start_n: int, *, pitch: float = 1400.0, gain: float = 1.0) -> None:
    """Mezcla UN golpe de tecla (mismo timbre que gen_typewriter_key) dentro de
    `buf` a partir de la muestra `start_n`. Click de ruido + tono metálico que
    decaen rápido. Aditivo sobre el buffer (no lo pisa)."""
    key_n = int(0.15 * SAMPLE_RATE)
    n = len(buf)
    for j in range(key_n):
        i = start_n + j
        if i >= n:
            break
        t = j / SAMPLE_RATE
        noise = random.uniform(-1, 1) * math.exp(-t * 80)
        tone = math.sin(2 * math.pi * pitch * t) * math.exp(-t * 30) * 0.3
        buf[i] += (noise + tone) * 0.5 * gain


def gen_typewriter(out: Path) -> None:
    """Máquina de escribir antigua COMPLETA (~2.4s): una ráfaga de teclas con
    espaciado irregular (ritmo de tecleo humano) + una campanilla 'ding' al final
    de línea + el golpe grave del retorno del carro. Reusa el mismo timbre de tecla
    que gen_typewriter_key; cada tecla varía levemente el pitch para que no suene
    robótica."""
    duration = 2.4
    n = int(duration * SAMPLE_RATE)
    samples = [0.0] * n
    # Ráfaga de ~16 teclas hasta t≈1.7s, con gaps irregulares (60-160 ms).
    t_cursor = 0.05
    while t_cursor < 1.7:
        start = int(t_cursor * SAMPLE_RATE)
        pitch = random.uniform(1250.0, 1650.0)
        gain = random.uniform(0.8, 1.0)
        _typewriter_key_into(samples, start, pitch=pitch, gain=gain)
        t_cursor += random.uniform(0.06, 0.16)
    # Campanilla de fin de línea (margin bell) en t≈1.85s: tono claro con decay.
    bell_start = int(1.85 * SAMPLE_RATE)
    for j in range(int(0.5 * SAMPLE_RATE)):
        i = bell_start + j
        if i >= n:
            break
        t = j / SAMPLE_RATE
        bell = math.sin(2 * math.pi * 2100 * t) + math.sin(2 * math.pi * 3150 * t) * 0.4
        samples[i] += bell * math.exp(-t * 9) * 0.28
    # Retorno del carro en t≈2.0s: golpe mecánico grave + ruido de fricción corto.
    carriage_start = int(2.0 * SAMPLE_RATE)
    for j in range(int(0.35 * SAMPLE_RATE)):
        i = carriage_start + j
        if i >= n:
            break
        t = j / SAMPLE_RATE
        thunk = math.sin(2 * math.pi * 180 * t) * math.exp(-t * 14) * 0.5
        friction = random.uniform(-1, 1) * math.exp(-t * 20) * 0.25
        samples[i] += thunk + friction
    write_wav(samples, out.with_suffix(".wav"))


def gen_film_reel(out: Path) -> None:
    """Proyector de cine antiguo (~2.5s, loopeable): traqueteo rítmico del engranaje
    a 24 fps (un click mecánico por fotograma) + zumbido grave del motor + leve
    ruido de fricción de la película pasando por el portillo. Síntesis pura: cada
    click es un transitorio de ruido filtrado con un pequeño tono; el motor es una
    sinusoide grave con su 2º armónico modulada por la frecuencia de fotograma.

    Loopeable: la duración es múltiplo entero del periodo de fotograma y el motor
    arranca/termina en fase, así que se puede encadenar sin pop audible."""
    fps = 24.0
    period = 1.0 / fps  # 24 clicks por segundo
    frames = 60          # 60 fotogramas = 2.5 s exactos (múltiplo del periodo → loop)
    duration = frames * period
    n = int(round(duration * SAMPLE_RATE))
    samples = [0.0] * n

    # 1) Zumbido del motor: fundamental grave + 2º armónico, fase entera al final.
    motor_hz = 60.0  # zumbido eléctrico tipo motor de proyector
    for i in range(n):
        t = i / SAMPLE_RATE
        motor = (
            math.sin(2 * math.pi * motor_hz * t) * 0.10
            + math.sin(2 * math.pi * motor_hz * 2 * t) * 0.04
        )
        samples[i] += motor

    # 2) Ruido de fricción continuo de la película (banda baja-media), suave.
    friction = [random.uniform(-1, 1) for _ in range(n)]
    friction = low_pass(friction, 2200)
    for i in range(n):
        samples[i] += friction[i] * 0.06

    # 3) Click del engranaje en CADA fotograma: transitorio de ruido + tic metálico
    #    que decae en ~18 ms. Pequeñas variaciones de gain/pitch para que no suene
    #    perfectamente mecánico.
    click_n = int(0.018 * SAMPLE_RATE)
    for f in range(frames):
        start = int(round(f * period * SAMPLE_RATE))
        pitch = random.uniform(900.0, 1200.0)
        gain = random.uniform(0.7, 1.0)
        for j in range(click_n):
            i = start + j
            if i >= n:
                break
            t = j / SAMPLE_RATE
            burst = random.uniform(-1, 1) * math.exp(-t * 180)
            tic = math.sin(2 * math.pi * pitch * t) * math.exp(-t * 140) * 0.4
            samples[i] += (burst + tic) * 0.5 * gain

    # Normalización suave para que el mix de motor+fricción+clicks no clippee.
    peak = max((abs(s) for s in samples), default=1.0) or 1.0
    if peak > 0.9:
        scale = 0.9 / peak
        samples = [s * scale for s in samples]

    write_wav(samples, out.with_suffix(".wav"))


def gen_breath_in(out: Path) -> None:
    """Inhalación cortita filtrada — íntimo/dramático antes de revelación."""
    duration = 0.6
    n = int(duration * SAMPLE_RATE)
    noise = [random.uniform(-1, 1) for _ in range(n)]
    samples = []
    rc_state = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        cutoff = 600 + 800 * (t / duration)
        rc = 1 / (2 * math.pi * cutoff)
        dt = 1 / SAMPLE_RATE
        alpha = dt / (rc + dt)
        rc_state = rc_state + alpha * (noise[i] - rc_state)
        # Envelope bell (entra y sale)
        env = math.sin(math.pi * (t / duration))
        samples.append(rc_state * env * 0.4)
    wav_path = out.with_suffix(".wav")
    write_wav(samples, wav_path)
    convert_to_mp3(wav_path, out)


# ─── Catálogo ─────────────────────────────────────────────────────────────────

CATALOG: dict[str, tuple[str, callable]] = {  # type: ignore[valid-type]
    # name -> (category, generator)
    "whoosh-short.mp3": ("whoosh", lambda p: gen_whoosh(p, 0.5, 150, 2000)),
    "whoosh-long.mp3": ("whoosh", lambda p: gen_whoosh(p, 1.0, 80, 1800)),
    "whoosh-up.mp3": ("whoosh", lambda p: gen_whoosh(p, 0.6, 300, 3000)),
    "whoosh-down.mp3": ("whoosh", lambda p: gen_whoosh(p, 0.6, 3000, 300)),
    "typewriter-key.mp3": ("typewriter", gen_typewriter_key),
    "camera-shutter.mp3": ("camera", gen_camera_shutter),
    "old-camera.mp3": ("camera", gen_camera_shutter),  # variante (pop simple)
    "vhs-static-on.mp3": ("vhs", lambda p: gen_vhs_static(p, 0.4)),
    "vhs-static-off.mp3": ("vhs", lambda p: gen_vhs_static(p, 0.25)),
    "vhs-rewind.mp3": ("vhs", lambda p: gen_glitch(p)),
    "paper-rustle.mp3": ("paper", gen_paper_rustle),
    "ding.mp3": ("notification", gen_ding),
    "glitch-short.mp3": ("glitch", gen_glitch),
    "transition-up.mp3": ("transition", gen_transition_up),
    "transition-down.mp3": ("transition", gen_transition_down),
    "swoosh-cinematic.mp3": ("transition", gen_swoosh_cinematic),
    # ─── Cinematic exclusive (sprint actual) ─────────────────────────────
    "drum-hit.mp3": ("drum", gen_drum_hit),
    "heartbeat.mp3": ("dramatic", gen_heartbeat),
    "deep-boom.mp3": ("dramatic", gen_deep_boom),
    "reverse-whoosh.mp3": ("transition", gen_reverse_whoosh),
    "impact-hit.mp3": ("impact", gen_impact_hit),
    "riser-short.mp3": ("build", gen_riser_short),
    "pop.mp3": ("accent", gen_pop),
    "click-select.mp3": ("accent", gen_click_select),
    "tape-stop.mp3": ("vhs", gen_tape_stop),
    "static-burst.mp3": ("vhs", gen_static_burst),
    "reveal-chime.mp3": ("dramatic", gen_reveal_chime),
    "breath-in.mp3": ("dramatic", gen_breath_in),
}


# ─── SFX curados (WAV directo, NO mp3) ─────────────────────────────────────────
# Estos NO van al CATALOG (que produce .mp3 + manifest.json): se escriben como .wav
# crudo donde el render los busca por basename. Hoy los consume el estilo
# `cine_clasico` (frontend/.../auto-build/lib/cine-clasico.ts → sfxMarks). Sin esta
# síntesis, un clone fresco no tendría typewriter.wav / film_reel.wav (eran copias
# a mano). El generador deja el .wav final (write_wav NO borra ni convierte a mp3).
CURATED_WAV: dict[str, callable] = {  # type: ignore[valid-type]
    # basename.wav -> generador (recibe el Path destino; write_wav usa with_suffix)
    "typewriter.wav": gen_typewriter,
    "film_reel.wav": gen_film_reel,
}


def _synth_curated_wav(out_dir: Path, force: bool) -> dict:
    """Genera SOLO los CURATED_WAV como .wav en out_dir (típicamente .../sfx/curated).
    Aditivo: no toca otros archivos ni escribe manifest.json. Idempotente: salta los
    que ya existen salvo --force."""
    import json

    out_dir.mkdir(parents=True, exist_ok=True)
    created = 0
    skipped = 0
    errors: list[str] = []
    for filename, gen in CURATED_WAV.items():
        out_path = out_dir / filename
        if out_path.exists() and not force:
            skipped += 1
            continue
        try:
            random.seed(hash(filename))  # determinismo (mismo patrón que main)
            gen(out_path)  # write_wav deja el .wav final, sin convert_to_mp3
            print(f"  + curated/{filename}", file=sys.stderr)
            created += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  ! ERROR {filename}: {exc}", file=sys.stderr)
            errors.append(f"{filename}: {exc}")
    res = {
        "ok": not errors,
        "out_dir": str(out_dir),
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }
    print(json.dumps(res, ensure_ascii=False))
    return res


def main() -> int:
    # argparse con subcomando OPCIONAL: sin subcomando = comportamiento legacy
    # (CATALOG → .mp3 + manifest.json, requiere --out-dir). Subcomando `curated-wav`
    # = solo los CURATED_WAV como .wav (para .../sfx/curated). No rompe llamadas viejas.
    if len(sys.argv) >= 2 and sys.argv[1] == "curated-wav":
        sub = argparse.ArgumentParser(prog="synth_sfx.py curated-wav")
        sub.add_argument("--out-dir", required=True, help="Directorio destino (.../assets/sfx/curated)")
        sub.add_argument("--force", action="store_true", help="Regenerar aunque ya existan")
        a = sub.parse_args(sys.argv[2:])
        res = _synth_curated_wav(Path(a.out_dir), a.force)
        return 0 if res["ok"] else 1

    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True, help="Directorio donde guardar los .mp3")
    parser.add_argument("--force", action="store_true", help="Regenerar aunque ya existan")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[sfx-synth] generando {len(CATALOG)} SFX en {out_dir}", file=sys.stderr)
    created = 0
    skipped = 0
    for filename, (category, gen) in CATALOG.items():
        out_path = out_dir / filename
        if out_path.exists() and not args.force:
            skipped += 1
            continue
        try:
            random.seed(hash(filename))  # determinismo
            gen(out_path)
            print(f"  + {category}/{filename}", file=sys.stderr)
            created += 1
        except Exception as exc:
            print(f"  ! ERROR {filename}: {exc}", file=sys.stderr)

    # Guardar manifiesto
    import json
    manifest = []
    for filename, (category, _) in CATALOG.items():
        p = out_dir / filename
        if p.exists():
            manifest.append({
                "name": filename,
                "category": category,
                "sizeBytes": p.stat().st_size,
            })
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    print(f"[sfx-synth] {created} creados, {skipped} ya existían", file=sys.stderr)
    print(json.dumps({"ok": True, "created": created, "skipped": skipped, "total": len(manifest)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
