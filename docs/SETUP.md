# Setup en máquina nueva (Windows 11)

Guía completa para reproducir el proyecto de cero en otra computadora. Todos los pasos están probados en Windows 11 Home + PowerShell.

> 📚 Volvé al **[índice de documentación](./README.md)** cuando quieras · Requisitos
> y descargas detalladas en **[PREREQUISITES.md](../PREREQUISITES.md)**.

## ⚡ Ruta rápida (resumen)

El camino completo, de un vistazo. Cada paso está explicado en detalle más abajo.

1. **Instalá** Node 24, Python 3.11, Git y Ollama → ver [Prerequisitos](#prerequisitos).
2. **Cloná** el repo y entrá: `git clone <url> && cd Estrategia_Viral_Poncho`.
3. **Dependencias:** `npm install` en `frontend/` y en `remotion/`; venv + `requirements.txt` en `python/`.
4. **ffmpeg:** bajá el portable a tu carpeta de tools (paso [FFmpeg](#descargar-ffmpeg-portable)).
5. **Arrancá:** `cd frontend && npm run dev` → http://localhost:3000.
6. **Descargá TODO el contenido de una vez:** en la app, **Mi sistema → «Configurar todo»**
   (modelo de voz + modelo de IA + música, efectos, iconos, animaciones, ilustraciones).
   Re-valida lo que ya esté, así que es seguro re-correrlo si algo quedó a medias.
7. **Verificá** que todo responde → ver [Verificar que todo funciona](#verificar-que-todo-funciona).
8. **Empezá** a editar → [USAGE.md](./USAGE.md).

> **Carpeta de datos:** todo lo pesado (videos, modelos, assets) vive FUERA del repo, por
> defecto en **`C:\viral-data\videos`** — el sistema la **detecta y crea sola**. Para usar
> otra ubicación seteá `VIRAL_DATA_ROOT`. (Instalaciones viejas pueden llamarla
> `C:\hermes-data`; es el mismo rol, otro nombre.)

## Prerequisitos

Necesitas instalar 4 cosas ANTES de clonar el repo:

### 1. Node.js 24 LTS

- Descargar: https://nodejs.org/en/download (versión LTS Windows 64-bit installer)
- Instalar con defaults
- Verificar en PowerShell nuevo: `node --version` → debe decir v22+ o v24

> ⚠️ Si `node` no responde después de instalar, agregar al PATH manualmente: `C:\Program Files\nodejs`

### 2. Python 3.11

- Descargar: https://www.python.org/downloads/release/python-3119/ (Windows installer 64-bit)
- **IMPORTANTE**: marcar "Add Python to PATH" durante la instalación
- Verificar: `python --version` → debe decir 3.11.x

### 3. Git

- Descargar: https://git-scm.com/download/win
- Instalar con defaults
- Verificar: `git --version`

### 4. Ollama (para análisis de clips virales con IA local)

- Descargar: https://ollama.com/download/windows
- Instalar
- Una vez instalado, en PowerShell:
  ```powershell
  ollama pull qwen3:1.7b
  ollama pull gemma4:26b   # opcional, mejor calidad pero más lento
  ```
- Verificar: `curl http://localhost:11434/api/tags` debe responder JSON con modelos

## Carpetas de datos

Crear la carpeta de datos del usuario (separada del repo para no contaminar OneDrive):

```powershell
New-Item -ItemType Directory -Force -Path `
  "C:\viral-data\videos\raw", `
  "C:\viral-data\videos\transcripts", `
  "C:\viral-data\videos\cuts", `
  "C:\viral-data\videos\renders", `
  "C:\viral-data\videos\projects", `
  "C:\viral-data\videos\assets\broll", `
  "C:\viral-data\videos\assets\music", `
  "C:\viral-data\videos\assets\sfx\source", `
  "C:\viral-data\videos\assets\sfx\curated", `
  "C:\viral-data\videos\long_form\raw", `
  "C:\viral-data\videos\long_form\transcripts", `
  "C:\viral-data\videos\long_form\cuts", `
  "C:\viral-data\videos\long_form\clean", `
  "C:\viral-data\videos\long_form\proposals", `
  "C:\viral-data\videos\long_form\clips", `
  "C:\viral-data\videos\long_form\projects", `
  "C:\viral-data\videos\long_form\renders", `
  "C:\viral-data\tools"
```

## Descargar FFmpeg portable

FFmpeg es necesario para procesar audio/video. NO usar el `winget install ffmpeg` (puede dar problemas con WhisperX). Usar el portable de gyan.dev:

```powershell
$url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$zip = "C:\viral-data\tools\ffmpeg.zip"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath "C:\viral-data\tools\" -Force
Remove-Item $zip
# Debe quedar C:\viral-data\tools\ffmpeg-8.x.x-essentials_build\bin\ffmpeg.exe
```

Después actualizar el path en `python/config.py` y `frontend/src/lib/paths.ts` si la versión bajada es distinta a la documentada.

## Clonar el repo

```powershell
cd "$env:USERPROFILE\OneDrive\Documentos"   # o donde quieras tener el proyecto
git clone <tu-repo-url> Estrategia_Viral_Poncho
cd Estrategia_Viral_Poncho
```

## Instalar dependencias del Frontend

```powershell
cd frontend
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm install
```

Esto baja ~400 paquetes (Next.js 16, React 19, shadcn/ui, Recharts, etc.). Tarda 2-4 min.

## Configurar variables de entorno del Frontend

Copiar el template y agregar tu API key de Pexels:

```powershell
Copy-Item frontend\.env.local.example frontend\.env.local
notepad frontend\.env.local
```

Obtener una API key gratis de Pexels (sin tarjeta):
1. Ir a https://www.pexels.com/api/new/
2. Crear cuenta gratis
3. Copiar la API key del dashboard
4. Pegarla en el archivo después de `PEXELS_API_KEY=`
5. Guardar

## Instalar dependencias del subproyecto Remotion

```powershell
cd ..\remotion
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm install
```

Esto baja Remotion (~500 paquetes incluyendo React 19 + zod v4 + Google Fonts). Tarda 2-4 min.

> En el primer render, Remotion descarga Chrome Headless Shell (~113 MB). Es una sola vez.

## Configurar Python venv + WhisperX + silero-vad

Esto es lo más pesado. Total ~3 GB de descarga (torch CPU + whisperx + modelos).

```powershell
cd ..\python
python -m venv venv

# Activar venv (en cada nueva terminal)
.\venv\Scripts\Activate.ps1

# Instalar torch CPU primero (más liviano que CUDA)
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Instalar el resto desde requirements.txt
# (whisperx, silero-vad, numpy, ffmpeg-python + OpenCV, MediaPipe, onnxruntime,
#  librosa, soundfile, Pillow, requests — para motion tracking, quitar fondo y beat-sync)
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

Total: ~2.5 GB. Tarda 5-10 min.

## Descargar assets (música, SFX, iconos, animaciones)

> ✅ **La forma fácil:** abrí la app y tocá **Mi sistema → «Configurar todo»**. Eso baja
> automáticamente TODAS las bibliotecas (música, efectos, iconos, animaciones,
> ilustraciones) y los modelos. **Con eso ya está** — los pasos manuales de abajo son solo
> un fallback por si querés bajar algo puntual a mano.

### (Manual / fallback) Pack de SFX curado

```powershell
cd "C:\viral-data\videos\assets\sfx\source"
git clone --depth=1 https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds.git .
```

Después copiar los 14 SFX curados a `curated\`:

```powershell
$source = "C:\viral-data\videos\assets\sfx\source"
$dest = "C:\viral-data\videos\assets\sfx\curated"
$map = @{
  "whoosh.ogg"      = "$source\kenney_interfacesounds\Audio\back_001.ogg"
  "swoosh.wav"      = "$source\Micro Pack - Organic Wooshes\Classic Swish 1.wav"
  "swoosh_soft.wav" = "$source\Micro Pack - Organic Wooshes\Gentle Swish.wav"
  "swoosh_quick.wav"= "$source\Micro Pack - Organic Wooshes\Swish 2.wav"
  "water_drop.ogg"  = "$source\40-cc0-water-splash-slime-sfx\bubble_01.ogg"
  "bloop.ogg"       = "$source\40-cc0-water-splash-slime-sfx\bubble_02.ogg"
  "splash.ogg"      = "$source\40-cc0-water-splash-slime-sfx\splash_01.ogg"
  "pop.ogg"         = "$source\kenney_interfacesounds\Audio\drop_001.ogg"
  "pop_short.ogg"   = "$source\kenney_interfacesounds\Audio\drop_002.ogg"
  "click.ogg"       = "$source\kenney_uiaudio\Audio\click1.ogg"
  "ding.ogg"        = "$source\kenney_interfacesounds\Audio\confirmation_001.ogg"
  "ding_bell.ogg"   = "$source\kenney_interfacesounds\Audio\confirmation_002.ogg"
  "notification.ogg"= "$source\kenney_interfacesounds\Audio\bong_001.ogg"
  "thud.wav"        = "$source\Micro Pack - Organic Wooshes\Thunk 1.wav"
}
foreach ($k in $map.Keys) {
  Copy-Item $map[$k] (Join-Path $dest $k) -Force
}
```

## Descargar modelos Whisper (primera vez)

WhisperX descarga los modelos automáticamente la primera vez que lo corres (~1.5 GB):

```powershell
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho\python"
.\venv\Scripts\python.exe transcribe.py --download-model small
```

Esto baja:
- Whisper `small` español (~500 MB)
- Alignment model wav2vec2 español (~1 GB)

## Generar LUTs de color + modelo de quitar-fondo

Estos assets **no van en el repo** (se generan/descargan). Ambos son opcionales: si faltan,
el render simplemente se saltea esos efectos sin romperse.

```powershell
# LUTs de color cinematográfico (CapCut FX) → remotion/public/luts/*.cube
cd ..\remotion
node generate-luts.mjs

# Modelo de quitar-fondo con IA (MediaPipe selfie segmenter, ~250 KB) → python/models/
cd ..\python
New-Item -ItemType Directory -Force -Path models | Out-Null
Invoke-WebRequest -Uri "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite" -OutFile "models\selfie_segmenter.tflite"
```

## Conectar redes sociales (opcional)

Para publicar directo desde la app, conectá LinkedIn y/o Instagram siguiendo
[SOCIAL_PUBLISHING.md](./SOCIAL_PUBLISHING.md) (asistentes en `/setup/linkedin` y
`/setup/instagram`). Las credenciales se guardan en `<DATA_ROOT>\..\user-settings.json`.

## Verificar que todo funciona

```powershell
# Activar venv
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho\python"
.\venv\Scripts\Activate.ps1

# Verificar imports
.\venv\Scripts\python.exe -c "import whisperx, silero_vad, torch; print('OK')"

# Verificar FFmpeg
& "C:\viral-data\tools\ffmpeg-8.1.1-essentials_build\bin\ffmpeg.exe" -version

# Verificar Ollama
curl http://localhost:11434/api/tags

# Verificar dashboard
cd ..\frontend
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm run dev
# abrir http://localhost:3000
```

Si los 4 responden, todo está listo. Procedé al [USAGE.md](./USAGE.md).

## Versiones probadas

| Componente | Versión |
|---|---|
| Windows | 11 Home 10.0.26200 |
| Node.js | v24.15.0 |
| npm | 11.12.1 |
| Python | 3.11.9 |
| FFmpeg | 8.1.1-essentials_build |
| Ollama | 0.23.2 |
| Next.js | 16.2.6 |
| Remotion | 4.0.300+ |
| React | 19.2.4 |
| WhisperX | 3.1.0+ |
| silero-vad | 5.0+ |
| torch (CPU) | 2.8.0 |

## Tamaño total en disco

- Repo `Estrategia_Viral_Poncho/`: ~2 GB (incluyendo node_modules)
- venv Python: ~3 GB
- Modelos WhisperX (en `~/.cache/whisper/` y `~/.cache/torch/hub/`): ~1.5 GB
- FFmpeg portable: ~90 MB
- Pack SFX: ~50 MB
- Modelos Ollama: ~1.3 GB (qwen3:1.7b) o ~17 GB (gemma4:26b)

**Total: ~12-15 GB** sin contar los videos que generes (~100 MB por short, ~3 GB por video largo limpio).

---

### Ver también

- **[USAGE.md](./USAGE.md)** — ya instalado, cómo hacés tu primer video.
- **[PREREQUISITES.md](../PREREQUISITES.md)** — requisitos mínimos y lista detallada de descargas.
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** — si algo no arranca o falla.
- **[Índice de documentación](./README.md)** — todo lo demás.
