# 🚀 Plan de optimización de velocidad — Viralito

> Fruto de una investigación de **17 agentes** (8 auditando el código desde sus entrañas + 8
> investigando la frontera 2024-2026 en labs/papers/docs oficiales + síntesis). Cada acción
> trae archivos, ganancia estimada, esfuerzo, riesgo y fundamento (código real o fuente).
> Fecha: 2026-06-15.

## TL;DR — la verdad incómoda

El cuello #1 es la **rasterización de frames de Remotion en CPU/SwiftShader** (Chromium headless
dibuja cada frame por software). El render encodea x264 en CPU y luego, si hay NVIDIA, se
re-encodea con NVENC. **La GPU está ociosa durante la fase más cara.**

Y el hallazgo que ahorra dinero y tiempo perdido: **subir el render a GPU (`gl=angle`) NO acelera
los estilos "planos"** (texto/imagen/video) — solo los que tienen blur, sombras, glitch, motion-blur
o WebGL. El código ya lo modela bien (opt-in). Las ganancias grandes para la mayoría de la gente
(equipos sin GPU dedicada) NO están en la GPU, sino en **computar menos por frame**, **saltar
trabajo redundante** (align, doble-transcripción, doble-encode, re-bundle), **solapar etapas** y
**quitar la contención de OneDrive/Defender**.

---

## Diagnóstico: cuellos reales, en orden de impacto

1. **Rasterización Remotion en CPU** — filtros pesados de `ViralVideo.tsx` (blur, drop-shadow RGB
   glitch, `feTurbulence`/`feDisplacementMap` del borde rasgado, vignette, **CameraMotionBlur con 15
   samples = 15 renders por frame**, duotono, textura papel) se computan por software.
2. **Decode del video fuente en CPU** — `OffthreadVideo` pide el raw por HTTP a `localhost:3000` y lo
   decodea con ffmpeg software; NVDEC/QSV detectado pero nunca usado en el render.
3. **Transcripción: el `align` (wav2vec2)** — pasada serial sobre TODO el audio, la etapa más cara en
   shorts y la que crashea en largos. El camino rápido (`BatchedInferencePipeline`, ~7-12x) **solo
   está cableado en largos**, no en shorts.
4. **Pipeline secuencial / `MAX_CONCURRENT=1`** — transcripción y análisis (que no saturan CPU) nunca
   solapan con el render de otro job; en largos cada etapa termina antes de empezar la siguiente.
5. **Cold start** — el bundle de webpack se re-arma en CADA arranque (el `.cache` se poda del payload);
   sin worker Python persistente, cada llamada re-importa torch/whisper y recarga modelos.
6. **Ollama** — no todos los callers usan `think:false`/`keep_alive`/`num_predict`; el análisis viral
   es secuencial clip por clip.
7. **`remove_background.py`** — loop Python por frame, blur a resolución completa, sin downscale,
   single-thread, MediaPipe en CPU.
8. **Doble-encode y pasadas ffmpeg sin fusionar** (x264→NVENC; mastering de audio + LUT por separado).

---

## CARRIL A — Equipos NORMALES (CPU / GPU integrada Intel) — la mayoría de los compradores

> Aquí está el 80% del beneficio para la mayoría. Casi todo es "hacer menos", no "usar más hardware".

### Quick wins (bajo esfuerzo)
| # | Acción | Cómo / archivos | Ganancia | Riesgo |
|---|---|---|---|---|
| A1 | **Saltar `align` por preset** (cablear `--no-align` en callers no-karaoke) | `--no-align` ya existe en `transcribe.py`; pasarlo desde `api/videos/transcribe/route.ts` y `long_form_pipeline.py` (re-transcribe del clean) según el preset | **30-50%** menos transcripción en shorts no-karaoke | bajo |
| A2 | **Ollama: un solo helper** con `think:false`+`/no_think`+`keep_alive`+`num_thread`+`num_predict` | unificar `generate_caption.py`, `generate_graphics`, `adapt_script` al patrón ya bueno de `analyze_clips.py:173-189` | **1.5-2x** en captions/gráficos + sin recargas de modelo | bajo |
| A3 | **No podar `remotion/node_modules/.cache`** (webpack) del payload | `desktop/bundle.ps1:118-122` | primer render tras boot **-15 a -40s** | bajo |
| A4 | **Sacar `DATA_ROOT`/temp/frames fuera de OneDrive + excluir esa carpeta de Defender** | doc + `config.py` paths; instrucción de instalación | menos contención de I/O y CPU durante el render | bajo |
| A5 | **`num_predict` (tope de tokens) en callers JSON de Ollama** | `generate_caption.py` etc. | **10-30%** menos latencia por llamada en CPU | bajo |
| A6 | **Caché por hash en `face_tracking` y clips extraídos** (paridad con `track_subject`) | `python/face_tracking*`, `extract_clips.py` | re-render/REVISAR casi gratis | bajo |
| A7 | **Diferir `maybeSweepOrphans` + scheduler unos segundos tras boot** | `frontend/instrumentation.ts` | arranque a "app usable" más rápido | bajo |

### Esfuerzo medio (alto impacto)
| # | Acción | Cómo / archivos | Ganancia | Riesgo |
|---|---|---|---|---|
| A8 | **`BatchedInferencePipeline` (VAD batching) también en shorts** cuando no hay align | `transcribe.py` (ya existe `_try_batched_transcribe`), `transcribe/route.ts` | hasta **7-12x** en la fase ASR | medio |
| A9 | **Worker Python persistente** para transcribe/caption (espejo del render-server) | nuevo proceso de larga vida; evita re-importar torch + recargar modelos por llamada | **-varios s a -10s+** por llamada tras la 1ª | medio |
| A10 | **`remove_background`: downscale de la inferencia y del blur** | `python/remove_background.py:99-122` | **2-4x** en el paso más lento del subsistema | medio |
| A11 | **Trackers: `seek`+`grab` solo de los frames muestreados** (no decodificar el 100%) | `track_subject.py`, `face_tracking*` | **5-15x** menos frames decodificados | medio |
| A12 | **Solapar transcripción/análisis con el render de otro job** (pipeline staging) en vez de `MAX_CONCURRENT=1` | cola de jobs (`editor-jobs`/render-server-client) | **15-35%** de wall-clock en lotes | medio |
| A13 | **Servir el video fuente como `file://`** en vez de HTTP `localhost:3000` | `remotion/build-props.mjs:157` | **5-15%** + menos timeouts bajo 16 workers | medio |
| A14 | **`large-v3-turbo-ct2` / distil-whisper en CPU potente** (hoy CPU nunca recibe el turbo) | `hw_profile.py:288-291`, `config.py` | **1.5-2x** ASR + mejor WER (es ~9.7%→~5%) | medio |
| A15 | **Reducir trabajo por frame en estilos**: `CameraMotionBlur` 15 samples → adaptativo por hardware; condicionar filtros pesados | `remotion/src/ViralVideo.tsx:612-618` y capas FX | ataca el cuello #1 directamente en CPU | medio |
| A16 | **Fusionar pasadas ffmpeg post-render** (mastering de audio + LUT en un comando) | `auto-build/route.ts`, `videos/render/route.ts` | **1-3s** por video con LUT | bajo |
| A17 | **Prioridad `BELOW_NORMAL` + afinidad de cores** a los workers de render | spawns de Remotion/ffmpeg/Chromium | responsividad de UI + **5-12%** en CPUs grandes | medio |

### Apuesta grande (alto esfuerzo, para equipos solo-iGPU)
| # | Acción | Cómo | Ganancia | Riesgo |
|---|---|---|---|---|
| A18 | **Backend `whisper.cpp` + Vulkan** opcional para el ASR | binario por subproceso, seleccionable por `hw_profile`, fallback a whisperx | **1.5-3x** en CPU pura; en iGPU Intel/AMD vía **Vulkan** le gana a CTranslate2-CPU | medio |

---

## CARRIL B — Equipos CON GPU (NVIDIA)

> Aquí sí vale subir trabajo a la GPU, pero con cabeza: la GPU ayuda en **rasterización de escenas
> con filtros**, **decode**, **encode** e **inferencia** — no en escenas planas.

| # | Acción | Cómo / archivos | Ganancia | Riesgo |
|---|---|---|---|---|
| B1 | **`gl=angle` por DEFAULT en equipos con GPU** (hoy requiere `VIRAL_REMOTION_GL=angle`), con **test de paridad de pixel** como gate y el reciclado de proceso que ya existe | `hw_profile.py:367`, `render-server.mjs` | **30-60%** menos por frame en escenas con blur/sombras/glitch/motion-blur (cinematic/editorial/transiciones) | medio |
| B2 | **NVENC tuning del encode final**: `-tune hq -rc-lookahead 32 -bf 3 -b_ref_mode middle -multipass qres` (gate B-frames por `cap>=7.5`; Pascal no tiene B-frames H.264) | `hw_profile.py:562-577` (rama `final`) | archivos **10-25% más chicos** a igual calidad, gratis (encode GPU barato) | bajo |
| B3 | **`num_gpu` (offload de capas) en Ollama según VRAM** + `OLLAMA_FLASH_ATTENTION=1` + `KV_CACHE q8_0` | `config.py`, arranque de Ollama | **1.5-4x** captions/análisis cuando hay GPU parcialmente usable | medio |
| B4 | **`int8_float16` en GPUs Turing+** para el modelo de voz (no en Pascal) + `large-v3-turbo` | `hw_profile.py:263-264` | **10-20%** + menos VRAM, mejor WER | medio |
| B5 | **Solapar render-x264 (CPU) con post-encode NVENC (GPU)** por pipeline en largos | `long_form_pipeline.py` STEP 7, `lf_render_pool.py` | **10-20%** del wall-clock del paso de render en largos | medio |
| B6 | **Pipeline GPU zero-copy** (`scale_cuda`/`overlay_cuda` o `vpp_qsv`) en reframe/crop, en vez de desactivar el hwaccel cuando hay `-vf` | `extract_clips.py:186-249`, `cut_silences.py:58` | reframe/crop **2-4x** + libera CPU para el render | alto |
| B7 | **MediaPipe GPU delegate** (ImageSegmenter/FaceDetector) | `remove_background.py`, trackers | **2-5x** en la inferencia | medio |
| B8 | **AV1 por hardware (opt-in)** como encoder del entregable | `hw_profile.py`, toggle "archivo más liviano" | archivos finales **30-50% más chicos** | medio |

### ⚠️ A verificar antes de prometer (contradicción entre agentes)
- **Decode por NVDEC y encode NVENC DIRECTO dentro de Remotion** (saltarse el doble-encode):
  un agente dice que Remotion 4.x acepta `hardwareAcceleration: "if-possible"`; otro (investigación)
  afirma que **a junio 2026 esa opción es solo macOS/VideoToolbox**. Si Remotion lo habilita en
  Windows (NVDEC/NVENC), sería una ganancia grande (**15-40%** en decode + una pasada de encode menos).
  **Acción: verificar en la doc/versión instalada de Remotion antes de implementarlo.** Mientras tanto,
  el post-encode NVENC actual (re-encode) es lo correcto.

---

## ❌ Descartar (humo / no vale el riesgo)

- **WebGPU en headless** — cae a "software only" pese a los flags; experimental. Vigilar 2026+.
- **Flags Linux/Vulkan/EGL** (`--use-angle=vulkan`, `nvidia-smi` al boot, X11/DISPLAY) — son recetas
  Linux/AWS; en Windows el backend correcto es ANGLE→D3D11 (que `gl=angle` ya usa).
- **Subir `concurrency` más allá de ~16** — rendimiento **sublineal** y a veces peor (Remotion #4949);
  el cap actual (`min(16, cpus-2)`) es correcto. Medir el óptimo con `npx remotion benchmark`.
- **HEVC/AV1 como DEFAULT del entregable** — rompe compatibilidad de subida a redes; solo opt-in.
- **Reescribir el render fuera del navegador** (compositor Skia nativo, etc.) — enorme, sin ROI hoy.

---

## Orden recomendado de ejecución

1. **Ola 1 (quick wins, 1-2 días):** A1, A2, A3, A4, A5, A7 + B2 (NVENC tuning). Cero o bajo riesgo,
   impacto inmediato en TODOS los equipos.
2. **Ola 2 (medio, gran impacto):** A8 (batched ASR en shorts), A9 (worker Python), A10/A11 (media),
   A12 (solapar etapas), A16 (fusión ffmpeg) + B1 (`gl=angle` default con gate de paridad), B3, B4.
3. **Ola 3 (avanzado/opt-in):** A15 (menos trabajo/frame), A18 (whisper.cpp+Vulkan), B5, B6, B7, B8,
   y la verificación de `hardwareAcceleration` de Remotion en Windows.

Cada ola: `tsc` 0, `npm test` + `pytest` verdes, smoke render real, y **medir antes/después** con un
video patrón (no confiar en estimaciones — `npx remotion benchmark` + cronometrar el pipeline).

## Fuentes clave
- Remotion: [Using the GPU](https://www.remotion.dev/docs/gpu) · [--gl options](https://www.remotion.dev/docs/gl-options) · [chromium-flags](https://www.remotion.dev/docs/chromium-flags) · [#4949 bottleneck](https://github.com/remotion-dev/remotion/issues/4949) · [benchmark](https://www.remotion.dev/docs/cli/benchmark)
- ffmpeg HW: [NVIDIA Transcoding Guide](https://developer.nvidia.com/blog/nvidia-ffmpeg-transcoding-guide/) · [StreamFX NVENC VOD](https://github.com/Vhonowslend/StreamFX-Public/wiki/Encoder-FFmpeg-NVENC) · [HWAccelIntro](https://trac.ffmpeg.org/wiki/HWAccelIntro)
- ASR: [large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) · faster-whisper / whisper.cpp (Vulkan en iGPU)
- Pipelines/papers: ReFrame (ICML 2025, caching/memoization por dependencias) y técnicas de "computar menos por frame".
