# Prerequisites — Manifest completo

Lista exhaustiva de TODO lo que necesita el proyecto para funcionar. Si copiás el proyecto a otra máquina, asegurate de tener cada uno de estos items antes de arrancar.

> **🔌 100% portable**: el proyecto NO tiene paths hardcodeados al usuario "Poncho Robles" ni a versión específica de FFmpeg. Todos los paths se derivan automáticamente:
> - `PROJECT_ROOT` se calcula desde la ubicación de los scripts (no importa cómo se llame tu user Windows)
> - `DATA_ROOT` default `C:\viral-data\videos` (overridable via env var `VIRAL_DATA_ROOT` si querés tenerlo en otro lado, ej. `D:\`)
> - FFmpeg se auto-detecta por glob (`{DATA_ROOT}/../tools/ffmpeg-*/bin/`)
> - Si tu setup difiere, definí env vars en `frontend/.env.local` (ver ejemplo)

## Sistema operativo

- **Windows 11** (Home/Pro). Probado en 10.0.26200.
- PowerShell 5.1 o superior (viene con Windows).
- Mínimo 16 GB de RAM (32 GB ideal para correr todo en paralelo).
- Mínimo 30 GB libres en disco C: (el venv, modelos y videos pesan).
- CPU moderno (Intel i5/i7 8va gen o equivalente AMD). GPU opcional.

## Software a instalar manualmente (4 cosas)

### 1. Node.js 24 LTS

- Descargar: https://nodejs.org/en/download (LTS Windows x64 Installer)
- Tamaño: ~30 MB descarga
- Instalar con defaults
- Verificar: `node --version` → v22+ o v24+
- **Path típico**: `C:\Program Files\nodejs\`

### 2. Python 3.11 (NO 3.12 — algunas deps no son compatibles aún)

- Descargar: https://www.python.org/downloads/release/python-3119/ (Windows installer 64-bit)
- Tamaño: ~28 MB
- **CRÍTICO**: marcar **"Add Python to PATH"** en la pantalla del instalador
- Verificar: `python --version` → 3.11.x

### 3. Git

- Descargar: https://git-scm.com/download/win
- Instalar con defaults (acepta los predeterminados)
- Verificar: `git --version`

### 4. Ollama (motor de LLM local)

- Descargar: https://ollama.com/download/windows
- Tamaño instalador: ~700 MB
- Instalar (es un .exe normal)
- **Después de instalar, Ollama corre como servicio en el system tray automáticamente**
- Verificar: `curl http://localhost:11434/api/tags` debe responder JSON

## Modelos de Ollama (descargar después de instalar Ollama)

El sistema usa Ollama para identificar clips virales en videos largos. **No tenés que
elegir el modelo a mano**: al arrancar, `hw_profile.py` detecta tu hardware y elige el
mejor que tu equipo aguante. El instalador/«Configurar todo» lo descarga solo.

### Auto-selección por hardware (lo que hace el sistema)

| Tu equipo | Modelo elegido | Tamaño |
|---|---|---|
| RAM < 16 GB, o CPU/PC modesta | `qwen3:1.7b` | 1.4 GB |
| RAM ≥ 16 GB (CPU) | `qwen3:4b` | 2.5 GB |
| CPU fuerte (≥ 8 núcleos) + RAM ≥ 24 GB, **o** GPU con ≥ 5 GB VRAM | `qwen3:8b` | 5.2 GB |
| GPU con ≥ 16 GB VRAM | `qwen3:14b` | ~9 GB |

`qwen3:1.7b` queda siempre como red de seguridad (es el fallback si la detección falla).

### Forzar un modelo (opcional)

```powershell
# Override puntual en el pipeline:
python long_form_pipeline.py D13_curso --render --model qwen3:8b
# O fijar uno para todo con la variable de entorno VIRAL_OLLAMA_MODEL.
```

### Modelo de máxima calidad (opcional, NO viene por default): `gemma4:26b`

- **Tamaño**: ~17 GB. **Velocidad**: lento en CPU (~5-15 min por chunk sin GPU).
- **Calidad**: superior, pero en una máquina **sin GPU** un video largo puede tardar
  horas. Por eso no se instala por default — usalo solo si tenés GPU o mucho tiempo.
- **Comando**: `ollama pull gemma4:26b` y luego `--model gemma4:26b`.

### Otros modelos opcionales (no usados por default)

| Modelo | Tamaño | Uso | Cuándo |
|---|---|---|---|
| `llama3.2:3b` | 2 GB | Backup si qwen3:1.7b da mala calidad | Alternativa |
| `mistral:7b` | 4.1 GB | Mejor español que llama | Alternativa |
| `qwen2.5:7b` | 4.7 GB | Balance velocidad/calidad | Alternativa |

Listar modelos instalados:
```powershell
ollama list
```

Eliminar un modelo:
```powershell
ollama rm <nombre>
```

## Descargas automáticas (las hace el sistema)

### FFmpeg portable

- Descarga: https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
- Tamaño: ~90 MB
- Path destino: `C:\viral-data\tools\ffmpeg-8.1.1-essentials_build\`
- **Si la versión cambia**, actualizar `python/config.py` y `frontend/src/lib/paths.ts`
- Se descarga con el script `bootstrap.ps1`

### Chrome Headless Shell (Remotion)

- Se baja automáticamente la PRIMERA vez que rendereás con Remotion
- Tamaño: 113 MB
- Path: `~/.cache/remotion/...`
- Una sola vez, después se reutiliza

### Modelos WhisperX

- Se bajan automáticamente la primera vez que transcribís
- Tamaño total: ~1.5 GB
- Componentes:
  - **Whisper `small` español**: ~500 MB
  - **Alignment model wav2vec2 español**: ~1 GB
- Paths: `~/.cache/whisper/`, `~/.cache/torch/hub/`
- Comando manual de pre-descarga:
  ```powershell
  cd python
  .\venv\Scripts\python.exe transcribe.py --download-model small
  ```

### Pack de SFX (CC0)

- Repo: https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds
- Tamaño total: ~50 MB (200+ archivos)
- Path: `C:\viral-data\videos\assets\sfx\source\`
- 14 archivos curados copiados a `curated/` por el bootstrap

### Python deps (vía pip en venv)

Total ~3 GB. Componentes principales:
- `torch` + `torchaudio` (CPU only): ~2 GB
- `whisperx`: ~50 MB + descarga modelos
- `silero-vad`: ~40 MB
- `numpy`, `ffmpeg-python`: ~20 MB

### Node deps

`frontend/`: ~700 MB en `node_modules`. Paquetes principales:
- `next`: 16.2.6
- `react`: 19.2.4
- `recharts`: charts
- `@radix-ui/*`: primitivos UI
- `lucide-react`: iconos
- `sonner`: toasts
- `tailwindcss` v4

`remotion/`: ~500 MB. Paquetes principales:
- `remotion`: 4.0.300+
- `@remotion/cli`, `@remotion/google-fonts`, `@remotion/media-utils`, `@remotion/zod-types`
- `react` 19
- `zod` v4

## API Keys necesarias

### LLMs para captions virales — TODO POR OAUTH (sin API keys, sin costo extra)

El generador de captions usa **CLIs autenticadas vía OAuth** con tus suscripciones
existentes. Auto-detecta el mejor disponible:

1. **Claude Code CLI** (recomendado — usa tu suscripción Claude.ai Pro/Max)
   - Instalar: `npm install -g @anthropic-ai/claude-code`
   - Loguearse: `claude login` → abre el navegador y autoriza con tu cuenta de Claude.ai
   - Verificar: `claude --version` debe imprimir la versión
   - Costo: $0 extra (consume la cuota de tu suscripción existente)

2. **OpenAI Codex CLI** (usa tu suscripción ChatGPT Plus / Pro)
   - Instalar: `npm install -g @openai/codex`
   - Loguearse: `codex login` → autorización OAuth con cuenta de ChatGPT
   - Verificar: `codex --version`
   - Costo: $0 extra (consume la cuota semanal de ChatGPT Plus)

3. **Ollama local `qwen3:1.7b`** (fallback gratis, calidad básica)
   - Ya viene instalado por el bootstrap
   - Se usa automáticamente si no hay ni `claude` ni `codex` en el PATH

El detector mira `shutil.which("claude")` y `shutil.which("codex")` en tiempo
de ejecución. NO requiere variables de entorno ni `.env.local` para esto.

### Pexels (gratis, sin tarjeta)

- URL: https://www.pexels.com/api/new/
- Plan free: 200 requests/hora, 20K/mes
- Path env var: `frontend/.env.local` → `PEXELS_API_KEY=<tu-key>`
- **Reiniciar dev server después de pegar la key**

### NO se necesitan:

- OpenAI API key (usamos Codex CLI vía OAuth)
- Anthropic API key (usamos Claude CLI vía OAuth)
- Replicate API key
- Stripe / pagos
- Database remota (todo es local)

## Estructura de carpetas final esperada

```
<USER_HOME>\OneDrive\Documentos\Estrategia_Viral_Poncho\    ← el repo
├── frontend\
│   ├── node_modules\              (auto, no en git)
│   ├── .next\                     (auto, no en git)
│   ├── .env.local                 (manual, NO en git)
│   └── src\, package.json, etc.
├── remotion\
│   ├── node_modules\              (auto)
│   ├── props.json                 (auto-generado)
│   └── src\, package.json, etc.
├── python\
│   ├── venv\                      (auto, no en git)
│   ├── __pycache__\               (auto)
│   └── *.py, requirements.txt
├── .claude\skills\                (skills conversacionales)
├── docs\
├── *.md (README, CLAUDE, etc.)
└── bootstrap.ps1                  (instalador automático)

C:\viral-data\                    ← datos del usuario (NO en git, separado)
├── tools\ffmpeg-8.1.1-*\
└── videos\
    ├── raw\, transcripts\, cuts\, renders\, projects\
    ├── assets\
    │   ├── broll\
    │   ├── music\
    │   └── sfx\{source,curated\}
    └── long_form\
        ├── raw\, transcripts\, cuts\, clean\, proposals\, clips\, projects\, renders\
```

## Checklist completo de "todo listo"

Antes de arrancar a procesar videos en una máquina nueva, verificar que TODO esto está OK:

```powershell
# Node + Python + Git + Ollama instalados
node --version    # v22+ o v24+
python --version  # 3.11.x
git --version
ollama --version

# Ollama service + modelos
curl http://localhost:11434/api/tags
ollama list                                # debe listar qwen3:1.7b

# FFmpeg
& "C:\viral-data\tools\ffmpeg-8.1.1-essentials_build\bin\ffmpeg.exe" -version

# Carpetas de datos
Test-Path "C:\viral-data\videos\raw"
Test-Path "C:\viral-data\videos\long_form\raw"
Test-Path "C:\viral-data\videos\assets\sfx\curated"

# Frontend listo
Test-Path "frontend\node_modules"
Test-Path "frontend\.env.local"
Get-Content frontend\.env.local | Select-String "PEXELS_API_KEY=." # debe tener key

# Remotion listo
Test-Path "remotion\node_modules"

# Python venv + deps
Test-Path "python\venv\Scripts\python.exe"
.\python\venv\Scripts\python.exe -c "import whisperx, silero_vad, torch; print('OK')"
```

Si los 10 responden OK, el sistema está listo para procesar el primer video.

## Versiones probadas (a fecha del proyecto)

| Componente | Versión |
|---|---|
| Windows | 11 Home 10.0.26200 |
| Node.js | v24.15.0 |
| npm | 11.12.1 |
| Python | 3.11.9 |
| Git | 2.42+ |
| Ollama | 0.23.2 |
| FFmpeg | 8.1.1-essentials_build |
| Next.js | 16.2.6 |
| React | 19.2.4 |
| Remotion | 4.0.300+ |
| WhisperX | 3.1.0+ |
| silero-vad | 5.0+ |
| torch (CPU) | 2.8.0 |
| qwen3 (Ollama) | 1.7b |

## Costos

| Componente | Costo recurrente |
|---|---|
| Todo el stack | **$0/mes** |
| Pexels API | $0 (200 req/h en free tier) |
| Ollama (local) | $0 (corre en CPU) |
| Internet | Lo que tengas |

Si decidís usar Anthropic / OpenAI en vez de Ollama (mejor calidad pero pago): ~$0.50 por video largo procesado.

## Tamaño total en disco después del setup completo

| Item | Tamaño |
|---|---|
| Repo `Estrategia_Viral_Poncho/` (con node_modules) | ~2 GB |
| `python/venv/` | ~3 GB |
| Modelos WhisperX en `~/.cache/` | ~1.5 GB |
| Modelo Ollama (auto: `qwen3:1.7b`/`4b`/`8b`) | 1.4–5.2 GB |
| Bibliotecas de assets (música, sfx, iconos, lottie, ilustraciones) | ~3–4 GB |
| FFmpeg portable | 90 MB |
| `gemma4:26b` (opcional, NO por default) | ~17 GB |
| **Subtotal sistema** | **~12–15 GB** (auto) · **+17 GB** si agregás gemma4 |
| Videos procesados | ~100 MB por short, ~3 GB por video largo |
