# Repositorios open source utilizados

Lista **exhaustiva** de cada componente del stack con su repo GitHub, licencia y rol. Total: **~60 paquetes**, todos gratis y open source.

## 🎨 Frontend (Next.js dashboard)

### Dependencies (runtime)

| Paquete | Versión | Repo GitHub | Licencia | Rol |
|---|---|---|---|---|
| **next** | 16.2.6 | https://github.com/vercel/next.js | MIT | Framework principal del dashboard |
| **react** | 19.2.4 | https://github.com/facebook/react | MIT | Librería UI |
| **react-dom** | 19.2.4 | https://github.com/facebook/react | MIT | Renderer DOM de React |
| **@base-ui/react** | ^1.4.1 | https://github.com/mui/base-ui | MIT | Primitivos accesibles (usado por shadcn) |
| **shadcn** | ^4.7.0 | https://github.com/shadcn-ui/ui | MIT | CLI para instalar componentes shadcn/ui |
| **recharts** | ^3.8.0 | https://github.com/recharts/recharts | MIT | Gráficas (line/bar/donut charts) |
| **lucide-react** | ^1.16.0 | https://github.com/lucide-icons/lucide | ISC | 350+ iconos usados |
| **sonner** | ^2.0.7 | https://github.com/emilkowalski/sonner | MIT | Toast notifications |
| **next-themes** | ^0.4.6 | https://github.com/pacocoursey/next-themes | MIT | Soporte de dark mode |
| **class-variance-authority** | ^0.7.1 | https://github.com/joe-bell/cva | Apache 2.0 | Variantes de componentes |
| **clsx** | ^2.1.1 | https://github.com/lukeed/clsx | MIT | Concat condicional de className |
| **tailwind-merge** | ^3.6.0 | https://github.com/dcastil/tailwind-merge | MIT | Resolver conflictos Tailwind |
| **tw-animate-css** | ^1.4.0 | https://github.com/Wombosvideo/tw-animate-css | MIT | Animaciones CSS para Tailwind v4 |

### DevDependencies

| Paquete | Repo GitHub | Licencia | Rol |
|---|---|---|---|
| **tailwindcss** | https://github.com/tailwindlabs/tailwindcss | MIT | Engine de utility classes |
| **@tailwindcss/postcss** | https://github.com/tailwindlabs/tailwindcss | MIT | PostCSS plugin de Tailwind v4 |
| **typescript** | https://github.com/microsoft/TypeScript | Apache 2.0 | Tipos estáticos |
| **eslint** | https://github.com/eslint/eslint | MIT | Linter |
| **eslint-config-next** | https://github.com/vercel/next.js | MIT | Config ESLint para Next |
| **@types/node, react, react-dom** | https://github.com/DefinitelyTyped/DefinitelyTyped | MIT | Type definitions |

## 🎬 Remotion (motor de render de video)

| Paquete | Versión | Repo GitHub | Licencia | Rol |
|---|---|---|---|---|
| **remotion** | ^4.0.300 | https://github.com/remotion-dev/remotion | Remotion License (gratis <3 empleados) | Motor principal |
| **@remotion/cli** | ^4.0.300 | (mismo repo) | igual | CLI para render |
| **@remotion/fonts** | ^4.0.462 | (mismo repo) | igual | Carga fuentes desde TTF LOCALES (`loadFont` + `staticFile`); Bebas Neue, Anton, etc. **Las fuentes ya NO se bajan de gstatic** → render 100% offline |
| **@remotion/media-utils** | ^4.0.300 | (mismo repo) | igual | Utilidades media |
| **zod** | ^4.0.0 | https://github.com/colinhacks/zod | MIT | Validación de schemas |
| **Chromium / Chrome Headless Shell** | https://github.com/chromium/chromium | BSD | Renderiza HTML → PNG (descarga automática de Remotion) |

## 🐍 Python (IA local — venv)

### IA / Audio

| Paquete | Versión | Repo GitHub | Licencia | Rol |
|---|---|---|---|---|
| **whisperx** | 3.8.5 | https://github.com/m-bain/whisperX | BSD-4 | Transcripción + forced alignment palabra-a-palabra |
| **silero-vad** | 6.2.1 | https://github.com/snakers4/silero-vad | MIT | Voice Activity Detection (silencios) |
| **pyannote-audio** | 4.0.4 | https://github.com/pyannote/pyannote-audio | MIT | VAD interno usado por WhisperX |
| **pyannote-core** | 6.0.1 | https://github.com/pyannote/pyannote-core | MIT | Tipos base de pyannote |
| **pyannote-database** | 6.1.1 | https://github.com/pyannote/pyannote-database | MIT | Datasets de pyannote |
| **pyannote-metrics** | 4.1 | https://github.com/pyannote/pyannote-metrics | MIT | Métricas de pyannote |
| **pyannote-pipeline** | 4.0.0 | https://github.com/pyannote/pyannote-pipeline | MIT | Pipelines de pyannote |
| **transformers** | 4.57.6 | https://github.com/huggingface/transformers | Apache 2.0 | Modelos de Hugging Face (wav2vec2) |
| **huggingface_hub** | 0.36.2 | https://github.com/huggingface/huggingface_hub | Apache 2.0 | Descarga de modelos |
| **tokenizers** | 0.22.2 | https://github.com/huggingface/tokenizers | Apache 2.0 | Tokenización para transformers |
| **safetensors** | 0.7.0 | https://github.com/huggingface/safetensors | Apache 2.0 | Formato seguro de pesos |
| **onnxruntime** | 1.26.0 | https://github.com/microsoft/onnxruntime | MIT | Runtime ONNX (para silero-vad) |

### PyTorch (deep learning)

| Paquete | Versión | Repo GitHub | Licencia | Rol |
|---|---|---|---|---|
| **torch** | 2.8.0 (CPU) | https://github.com/pytorch/pytorch | BSD | Runtime de DL |
| **torchaudio** | 2.8.0 | https://github.com/pytorch/audio | BSD | I/O de audio |
| **torchcodec** | 0.7.0 | https://github.com/pytorch/torchcodec | BSD | Decodificación de video |
| **torchvision** | 0.23.0 | https://github.com/pytorch/vision | BSD | Procesamiento de imagen |
| **torchmetrics** | 1.9.0 | https://github.com/Lightning-AI/torchmetrics | Apache 2.0 | Métricas |
| **torch-audiomentations** | 0.12.0 | https://github.com/asteroid-team/torch-audiomentations | MIT | Aug de audio (usado por pyannote) |
| **torch_pitch_shift** | 1.2.5 | https://github.com/KentoNishi/torch-pitch-shift | MIT | Pitch shifting |

### Utilidades

| Paquete | Versión | Repo GitHub | Licencia | Rol |
|---|---|---|---|---|
| **numpy** | 2.4.5 | https://github.com/numpy/numpy | BSD | Arrays/cómputo |
| **scipy** | 1.17.1 | https://github.com/scipy/scipy | BSD | Algoritmos científicos |
| **pandas** | 3.0.3 | https://github.com/pandas-dev/pandas | BSD | Dataframes |
| **networkx** | 3.6.1 | https://github.com/networkx/networkx | BSD | Grafos |
| **nltk** | 3.9.4 | https://github.com/nltk/nltk | Apache 2.0 | NLP utilities |
| **ffmpeg-python** | 0.2.0 | https://github.com/kkroening/ffmpeg-python | Apache 2.0 | Wrapper Python de FFmpeg |
| **requests** | 2.34.2 | https://github.com/psf/requests | Apache 2.0 | HTTP client |
| **tqdm** | 4.67.3 | https://github.com/tqdm/tqdm | MIT/MPL | Progress bars |
| **filelock** | 3.29.0 | https://github.com/tox-dev/filelock | Unlicense | File locks |

### Modelos IA descargados automáticamente (no son pip packages)

| Modelo | Fuente | Licencia | Rol |
|---|---|---|---|
| **Whisper `small` español** | https://github.com/openai/whisper | MIT | Transcripción de voz |
| **wav2vec2 alignment (español)** | https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-spanish | Apache 2.0 | Alineación palabra-a-palabra |

Se descargan a `~/.cache/whisper/` y `~/.cache/huggingface/` la primera vez que corres transcribe.py.

## 🤖 Ollama (LLM local)

| Componente | Repo GitHub | Licencia | Rol |
|---|---|---|---|
| **Ollama** | https://github.com/ollama/ollama | MIT | Runtime de LLMs local |
| **Qwen3** (modelo qwen3:1.7b) | https://github.com/QwenLM/Qwen3 | Apache 2.0 | Default para identificar clips virales |
| **Gemma** (modelo gemma4:26b, opcional) | https://github.com/google-deepmind/gemma | Gemma Terms | Modelo más grande, mejor calidad |

## 🎵 Assets (sonidos, fuentes)

| Componente | Repo / URL | Licencia | Rol |
|---|---|---|---|
| **CC0-Public-Domain-Sounds** | https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds | CC0 | Pack de 200+ SFX |
| └─ Kenney Interface Sounds | https://kenney.nl/assets/interface-sounds (incluido) | CC0 | click, pop, ding, drop |
| └─ Kenney UI Audio | https://kenney.nl/assets/ui-audio (incluido) | CC0 | UI clicks, rollover, switch |
| └─ Kenney Digital Audio | https://kenney.nl/assets/digital-audio (incluido) | CC0 | Notificaciones, alerts |
| └─ Kenney Impact Sounds | https://kenney.nl/assets/impact-sounds (incluido) | CC0 | Impactos, thud |
| └─ Organic Wooshes | (incluido en repo CC0) | CC0 | swoosh, swish, whoosh |
| └─ Water Splash Slime SFX | (incluido en repo CC0) | CC0 | gota de agua, splash, bloop |
| **Google Fonts** | https://github.com/google/fonts | OFL | Bebas Neue, Anton (subtítulos virales) |

## 🎞️ Tools standalone

| Componente | Repo GitHub | Licencia | Rol |
|---|---|---|---|
| **FFmpeg** | https://github.com/FFmpeg/FFmpeg | LGPL/GPL | Procesamiento de audio/video |
| **FFmpeg Windows builds** (Gyan) | https://github.com/GyanD/codexffmpeg (releases en https://www.gyan.dev/ffmpeg/builds/) | LGPL | Build essentials portable usado |
| **Node.js** | https://github.com/nodejs/node | MIT | Runtime de Next.js + Remotion |
| **CPython** | https://github.com/python/cpython | PSF | Runtime Python 3.11 |
| **Git** | https://github.com/git/git | GPLv2 | Control de versiones |

## 🌐 APIs externas (sin código local)

| API | URL | Plan free | Rol |
|---|---|---|---|
| **Pexels** | https://www.pexels.com/api/ | 200 req/h, 20K/mes, **sin tarjeta** | Búsqueda de B-roll |

## 📦 Inspiración estructural

| Recurso | URL | Rol |
|---|---|---|
| **claude-code-video-toolkit** | https://github.com/digitalsamba/claude-code-video-toolkit | Patrón `.claude/skills/`. NO se clonó código (su pipeline no incluye Whisper); solo se tomó la idea |

## 📊 Conteo y costos

- **Total paquetes/repos**: ~60
- **Costo recurrente**: **$0/mes** (todos free o CC0)
- **Costo one-time**: ~6 GB de descargas
- **Licencias**: 100% compatibles con uso comercial (MIT, BSD, Apache, CC0, OFL, LGPL)

## ✅ Verificación rápida

```powershell
# Frontend (~13 deps directas)
cd frontend; npm list --depth=0

# Remotion (~8 deps directas)
cd ..\remotion; npm list --depth=0

# Python (~30 paquetes principales)
cd ..\python; .\venv\Scripts\python.exe -m pip list

# Ollama
ollama list   # debe mostrar qwen3:1.7b
```

## 📜 Resumen de licencias

| Tipo | Significado |
|---|---|
| **MIT / BSD / Apache** | Uso comercial OK, sin atribución obligatoria |
| **CC0 / Unlicense** | Dominio público, libre uso |
| **OFL** | Fuentes libres |
| **LGPL** (FFmpeg) | OK usar como librería |
| **GPL** (Git) | Solo si distribuís código de Git modificado |
| **PSF** (Python) | Permissive |
| **Remotion License** | Gratis <3 empleados |
| **Gemma Terms** | Permite uso comercial con restricciones |

**Todas permiten uso comercial gratuito en setups personales o de equipos pequeños.**
