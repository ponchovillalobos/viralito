# =============================================================================
# bootstrap.ps1 — Setup automático de Estrategia Viral Poncho en máquina nueva
# =============================================================================
#
# Uso:
#   1. Instalar primero: Node.js 24, Python 3.11, Git, Ollama (ver PREREQUISITES.md)
#   2. Clonar el repo: git clone <url> Estrategia_Viral_Poncho
#   3. cd Estrategia_Viral_Poncho
#   4. .\bootstrap.ps1
#
# Este script:
#   - Verifica prerequisitos
#   - Crea estructura de carpetas en C:\viral-data\
#   - Descarga FFmpeg portable
#   - Clona pack SFX CC0 y cura 14 archivos
#   - Pulla modelos Ollama (qwen3:1.7b)
#   - Instala deps de frontend
#   - Instala deps de remotion
#   - Crea venv Python e instala whisperx + silero-vad + torch CPU
#   - Pre-descarga modelos WhisperX
#   - Crea .env.local template
# =============================================================================

$ErrorActionPreference = "Stop"
$script:errors = @()

function Write-Step($msg) { Write-Host "`n[step] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠   $msg" -ForegroundColor Yellow }
function Write-Err($msg) {
  Write-Host "  ✗   $msg" -ForegroundColor Red
  $script:errors += $msg
}

# Detectar root del proyecto (donde está este script)
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot
Write-Host "`n=== bootstrap.ps1 — Estrategia Viral Poncho ===" -ForegroundColor Magenta
Write-Host "Project root: $ProjectRoot`n"

# =============================================================================
# STEP 1: Verificar prerequisitos manuales
# =============================================================================
Write-Step "Verificando prerequisitos manuales"

# Node
try {
  $nodeVer = & node --version 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Ok "Node: $nodeVer" }
  else { throw }
} catch {
  # Intentar agregar path estándar
  $stdNode = "C:\Program Files\nodejs"
  if (Test-Path "$stdNode\node.exe") {
    $env:PATH = "$stdNode;$env:PATH"
    Write-Ok "Node encontrado en $stdNode (agregado a PATH)"
  } else {
    Write-Err "Node.js no encontrado. Instalar desde https://nodejs.org/"
  }
}

# Python
try {
  $pyVer = & python --version 2>$null
  if ($pyVer -match "3\.11\.") { Write-Ok "Python: $pyVer" }
  elseif ($LASTEXITCODE -eq 0) { Write-Warn "Python detectado pero NO es 3.11: $pyVer (puede dar problemas)" }
  else { throw }
} catch {
  Write-Err "Python 3.11 no encontrado. Instalar desde https://www.python.org/downloads/release/python-3119/"
}

# Git
try {
  $gitVer = & git --version 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Ok "Git: $gitVer" }
  else { throw }
} catch {
  Write-Err "Git no encontrado. Instalar desde https://git-scm.com/download/win"
}

# Ollama
try {
  $r = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5
  Write-Ok "Ollama corriendo · modelos instalados: $($r.models.Count)"
  $script:ollamaOk = $true
  # El instalador de Ollama agrega su carpeta al PATH de USUARIO, pero una consola
  # abierta ANTES de instalarlo no lo ve. Resolver el .exe a mano evita el falso
  # "ollama no se reconoce" cuando el servicio SI esta corriendo.
  $script:ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $script:ollamaExe) {
    $cand = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $cand) { $script:ollamaExe = $cand }
  }
} catch {
  Write-Warn "Ollama no responde en localhost:11434. Necesario para long_form."
  Write-Warn "Instalar desde https://ollama.com/download/windows"
  $script:ollamaOk = $false
}

# =============================================================================
# STEP 2: Crear estructura de carpetas en C:\viral-data
# =============================================================================
Write-Step "Creando estructura de carpetas en C:\viral-data"

$folders = @(
  "C:\viral-data\tools",
  "C:\viral-data\videos\raw",
  "C:\viral-data\videos\transcripts",
  "C:\viral-data\videos\cuts",
  "C:\viral-data\videos\renders",
  "C:\viral-data\videos\projects",
  "C:\viral-data\videos\assets\broll",
  "C:\viral-data\videos\assets\music",
  "C:\viral-data\videos\assets\sfx\source",
  "C:\viral-data\videos\assets\sfx\curated",
  "C:\viral-data\videos\long_form\raw",
  "C:\viral-data\videos\long_form\transcripts",
  "C:\viral-data\videos\long_form\cuts",
  "C:\viral-data\videos\long_form\clean",
  "C:\viral-data\videos\long_form\proposals",
  "C:\viral-data\videos\long_form\clips",
  "C:\viral-data\videos\long_form\projects",
  "C:\viral-data\videos\long_form\renders"
)
foreach ($f in $folders) {
  if (-not (Test-Path $f)) { New-Item -ItemType Directory -Force -Path $f | Out-Null }
}
Write-Ok "$($folders.Count) carpetas creadas/verificadas"

# =============================================================================
# STEP 3: Descargar FFmpeg portable
# =============================================================================
Write-Step "Descargando FFmpeg portable"

$ffmpegExists = Get-ChildItem "C:\viral-data\tools\" -Directory -Filter "ffmpeg-*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ffmpegExists) {
  Write-Ok "FFmpeg ya existe en $($ffmpegExists.FullName)"
} else {
  # Dos origenes para el MISMO build de gyan.dev: su web cae con 503 con cierta
  # frecuencia, y GyanD/codexffmpeg en GitHub publica exactamente los mismos zips.
  # Se fija la serie 8.x a proposito: FFmpeg 9 retiro "-filter_complex_script" y
  # es una major sin probar contra este pipeline.
  $fuentes = @(
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip"
  )
  $zip = "C:\viral-data\tools\ffmpeg.zip"
  $bajado = $false
  foreach ($url in $fuentes) {
    try {
      Write-Host "  Descargando $url (~100 MB)..." -NoNewline
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      Write-Host " OK"
      $bajado = $true
      break
    } catch {
      Write-Host " FALLO"
      Write-Warn "Origen no disponible ($($_.Exception.Message)). Probando el siguiente..."
    }
  }
  if ($bajado) {
    try {
      Expand-Archive -Path $zip -DestinationPath "C:\viral-data\tools\" -Force
      Remove-Item $zip
      $ffmpegDir = Get-ChildItem "C:\viral-data\tools\" -Directory -Filter "ffmpeg-*" | Select-Object -First 1
      Write-Ok "FFmpeg extraído: $($ffmpegDir.Name)"
    } catch {
      Write-Err "Error extrayendo FFmpeg: $_"
    }
  } else {
    Write-Err "Error descargando FFmpeg: ningún origen respondió (probados: $($fuentes.Count))"
  }
}

# =============================================================================
# STEP 4: Clonar pack SFX CC0 + curar 14 archivos
# =============================================================================
Write-Step "Descargando pack SFX (CC0 Public Domain Sounds)"

$sfxSource = "C:\viral-data\videos\assets\sfx\source"
if ((Test-Path "$sfxSource\.git") -and (Test-Path "$sfxSource\kenney_interfacesounds")) {
  Write-Ok "Pack SFX ya clonado"
} else {
  try {
    Push-Location $sfxSource
    # NO usar "2>&1" con comandos nativos: en PowerShell 5.1 cada linea de stderr
    # se convierte en ErrorRecord y, con $ErrorActionPreference="Stop", dispara el
    # catch aunque el comando haya salido con codigo 0. git escribe "Cloning into..."
    # en stderr SIEMPRE. Se comprueba $LASTEXITCODE, que es la senal real.
    & git clone --depth=1 https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds.git . | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git clone termino con codigo $LASTEXITCODE" }
    Pop-Location
    Write-Ok "Pack SFX clonado"
  } catch {
    Write-Err "Error clonando pack SFX: $_"
  }
}

Write-Step "Curando 14 SFX en assets/sfx/curated/"

$sfxDest = "C:\viral-data\videos\assets\sfx\curated"
$sfxMap = @{
  "whoosh.ogg"       = "$sfxSource\kenney_interfacesounds\Audio\back_001.ogg"
  "swoosh.wav"       = "$sfxSource\Micro Pack - Organic Wooshes\Classic Swish 1.wav"
  "swoosh_soft.wav"  = "$sfxSource\Micro Pack - Organic Wooshes\Gentle Swish.wav"
  "swoosh_quick.wav" = "$sfxSource\Micro Pack - Organic Wooshes\Swish 2.wav"
  "water_drop.ogg"   = "$sfxSource\40-cc0-water-splash-slime-sfx\bubble_01.ogg"
  "bloop.ogg"        = "$sfxSource\40-cc0-water-splash-slime-sfx\bubble_02.ogg"
  "splash.ogg"       = "$sfxSource\40-cc0-water-splash-slime-sfx\splash_01.ogg"
  "pop.ogg"          = "$sfxSource\kenney_interfacesounds\Audio\drop_001.ogg"
  "pop_short.ogg"    = "$sfxSource\kenney_interfacesounds\Audio\drop_002.ogg"
  "click.ogg"        = "$sfxSource\kenney_uiaudio\Audio\click1.ogg"
  "ding.ogg"         = "$sfxSource\kenney_interfacesounds\Audio\confirmation_001.ogg"
  "ding_bell.ogg"    = "$sfxSource\kenney_interfacesounds\Audio\confirmation_002.ogg"
  "notification.ogg" = "$sfxSource\kenney_interfacesounds\Audio\bong_001.ogg"
  "thud.wav"         = "$sfxSource\Micro Pack - Organic Wooshes\Thunk 1.wav"
}
$copied = 0
foreach ($k in $sfxMap.Keys) {
  if (Test-Path $sfxMap[$k]) {
    Copy-Item $sfxMap[$k] (Join-Path $sfxDest $k) -Force
    $copied++
  }
}
Write-Ok "$copied/$($sfxMap.Count) SFX copiados a curated/"

# =============================================================================
# STEP 5: Pull modelo Ollama qwen3:1.7b
# =============================================================================
if ($script:ollamaOk) {
  Write-Step "Verificando modelo Ollama qwen3:1.7b (1.3 GB)"
  try {
    $models = Invoke-RestMethod -Uri "http://localhost:11434/api/tags"
    $hasQwen = $models.models | Where-Object { $_.name -like "qwen3:1.7b*" }
    if ($hasQwen) {
      Write-Ok "qwen3:1.7b ya instalado"
    } else {
      Write-Host "  Descargando qwen3:1.7b (~1.3 GB, primera vez)..." -ForegroundColor Yellow
      if (-not $script:ollamaExe) { throw "Ollama responde en el puerto pero no se encontro ollama.exe (PATH desactualizado: reabrir la consola)" }
      & $script:ollamaExe pull qwen3:1.7b
      if ($LASTEXITCODE -ne 0) { throw "ollama pull termino con codigo $LASTEXITCODE" }
      Write-Ok "qwen3:1.7b descargado"
    }
  } catch {
    Write-Err "Error con Ollama: $_"
  }
}

# =============================================================================
# STEP 6: npm install en frontend
# =============================================================================
Write-Step "Instalando deps de frontend (~700 MB, ~3 min)"

$env:PATH = "C:\Program Files\nodejs;$env:PATH"
Push-Location "$ProjectRoot\frontend"
if (Test-Path "node_modules") {
  Write-Ok "frontend/node_modules ya existe (skip)"
} else {
  try {
    # Sin "2>&1": npm escribe "npm warn deprecated ..." en stderr en toda instalacion
    # limpia; con la redireccion eso se volvia un error terminante falso.
    & npm install | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm install termino con codigo $LASTEXITCODE" }
    Write-Ok "frontend deps instaladas"
  } catch {
    Write-Err "Error en npm install frontend: $_"
  }
}
Pop-Location

# Crear .env.local si no existe
if (-not (Test-Path "$ProjectRoot\frontend\.env.local")) {
  if (Test-Path "$ProjectRoot\frontend\.env.local.example") {
    Copy-Item "$ProjectRoot\frontend\.env.local.example" "$ProjectRoot\frontend\.env.local"
    Write-Ok ".env.local creado desde template"
    Write-Warn "Editar frontend\.env.local y poner tu PEXELS_API_KEY"
  } else {
    @"
# Pexels API key - obtenela en https://www.pexels.com/api/new/
PEXELS_API_KEY=
"@ | Out-File "$ProjectRoot\frontend\.env.local" -Encoding utf8
    Write-Warn ".env.local creado vacío. Editar y poner tu PEXELS_API_KEY"
  }
}

# =============================================================================
# STEP 7: npm install en remotion
# =============================================================================
Write-Step "Instalando deps de remotion (~500 MB, ~3 min)"

Push-Location "$ProjectRoot\remotion"
if (Test-Path "node_modules") {
  Write-Ok "remotion/node_modules ya existe (skip)"
} else {
  try {
    & npm install | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm install termino con codigo $LASTEXITCODE" }
    Write-Ok "remotion deps instaladas"
  } catch {
    Write-Err "Error en npm install remotion: $_"
  }
}
Pop-Location

# =============================================================================
# STEP 8: Crear venv Python + instalar deps
# =============================================================================
Write-Step "Creando venv Python + deps (~3 GB, ~10 min)"

Push-Location "$ProjectRoot\python"

if (Test-Path "venv\Scripts\python.exe") {
  Write-Ok "python/venv ya existe (skip creación)"
} else {
  try {
    # El proyecto EXIGE 3.11 (3.12 rompe dependencias). "python" a secas toma el
    # primero del PATH, que en una maquina con varias versiones puede ser 3.12 y
    # crea el venv equivocado en silencio. Se prefiere el lanzador "py -3.11".
    $pyLauncher = (Get-Command py -ErrorAction SilentlyContinue)
    $usoLauncher = $false
    if ($pyLauncher) {
      & py -3.11 --version 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $usoLauncher = $true }
    }
    if ($usoLauncher) {
      & py -3.11 -m venv venv
      Write-Ok "venv creado con py -3.11"
    } else {
      & python -m venv venv
      Write-Warn "Python 3.11 no localizado por el lanzador; venv creado con el 'python' del PATH"
    }
    if ($LASTEXITCODE -ne 0) { throw "creacion del venv termino con codigo $LASTEXITCODE" }
    Write-Ok "venv creado"
  } catch {
    Write-Err "Error creando venv: $_"
  }
}

# torch CPU primero
$pyExe = "$ProjectRoot\python\venv\Scripts\python.exe"
if (Test-Path $pyExe) {
  try {
    # Sondeo de import: si el modulo NO esta, Python escribe el traceback en stderr.
    # Con $ErrorActionPreference="Stop" esa salida se vuelve error TERMINANTE y el
    # catch se dispara ANTES de que pip llegue a correr (sintoma: "Error instalando
    # torch: Traceback (most recent call last):"). Se baja el nivel solo aqui.
    $eapPrev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $pyExe -c "import torch" 2>$null
    $ErrorActionPreference = $eapPrev
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "torch ya instalado"
    } else {
      Write-Host "  Instalando torch CPU + torchaudio (~2 GB)..." -ForegroundColor Yellow
      & $pyExe -m pip install --upgrade pip --quiet
      & $pyExe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu --quiet
      Write-Ok "torch CPU instalado"
    }
  } catch {
    Write-Err "Error instalando torch: $_"
  }

  try {
    $eapPrev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $pyExe -c "import whisperx, silero_vad" 2>$null
    $ErrorActionPreference = $eapPrev
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "whisperx + silero-vad ya instalados"
    } else {
      Write-Host "  Instalando whisperx + silero-vad + utilidades..." -ForegroundColor Yellow
      # requirements.txt es la fuente de verdad: la lista suelta se quedaba corta
      # (faltaban mediapipe, opencv-python, onnxruntime, librosa, soundfile, Pillow,
      # requests) y el pipeline fallaba mas tarde con ModuleNotFoundError.
      if (Test-Path "requirements.txt") {
        & $pyExe -m pip install -r requirements.txt --quiet
      } else {
        & $pyExe -m pip install whisperx silero-vad numpy ffmpeg-python --quiet
      }
      if ($LASTEXITCODE -ne 0) { throw "pip install termino con codigo $LASTEXITCODE" }
      Write-Ok "deps Python instaladas"
    }
  } catch {
    Write-Err "Error instalando deps Python: $_"
  }
}
Pop-Location

# =============================================================================
# STEP 9: Pre-descargar modelos WhisperX
# =============================================================================
Write-Step "Pre-descargando modelos WhisperX (small español + alignment, ~1.5 GB)"

if (Test-Path "$pyExe") {
  Push-Location "$ProjectRoot\python"
  try {
    $eapPrev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $pyExe transcribe.py --download-model small | Out-Null
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $eapPrev
    if ($rc -ne 0) { throw "transcribe.py --download-model termino con codigo $rc" }
    Write-Ok "Modelos WhisperX descargados"
  } catch {
    Write-Warn "Error descargando modelos WhisperX. Se descargarán en la primera transcripción."
  }
  Pop-Location
}

# =============================================================================
# STEP 10: Verificación final
# =============================================================================
Write-Step "Verificación final"

$ffmpegFolder = Get-ChildItem "C:\viral-data\tools\" -Directory -Filter "ffmpeg-*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ffmpegFolder -and (Test-Path (Join-Path $ffmpegFolder.FullName "bin\ffmpeg.exe"))) {
  Write-Ok "FFmpeg detectable: $($ffmpegFolder.Name) (auto-detect activo)"
} else {
  Write-Err "FFmpeg no detectable en C:\viral-data\tools\ffmpeg-*\bin\"
}

$sfxCount = (Get-ChildItem "C:\viral-data\videos\assets\sfx\curated\" -ErrorAction SilentlyContinue | Measure-Object).Count
if ($sfxCount -ge 12) {
  Write-Ok "$sfxCount SFX en curated/"
} else {
  Write-Err "Solo $sfxCount SFX en curated/ (esperado >= 12)"
}

$envFile = "$ProjectRoot\frontend\.env.local"
if (Test-Path $envFile) {
  $envContent = Get-Content $envFile -Raw
  if ($envContent -match "PEXELS_API_KEY=\S") {
    Write-Ok "PEXELS_API_KEY configurada"
  } else {
    Write-Warn "PEXELS_API_KEY vacía. Editar frontend\.env.local con tu key (https://www.pexels.com/api/new/)"
  }
}

# =============================================================================
# RESUMEN
# =============================================================================
Write-Host "`n=== RESUMEN ===" -ForegroundColor Magenta

if ($script:errors.Count -eq 0) {
  Write-Host "`n✅ Setup completo!" -ForegroundColor Green
  Write-Host "`nProxIMOS pasos:" -ForegroundColor Cyan
  Write-Host "  1. Editar frontend\.env.local y poner PEXELS_API_KEY"
  Write-Host "  2. Arrancar dashboard: cd frontend; npm run dev"
  Write-Host "  3. Abrir http://localhost:3000"
  Write-Host "  4. Leer docs\USAGE.md para tutorial completo"
} else {
  Write-Host "`n⚠ Setup terminó con $($script:errors.Count) error(es):" -ForegroundColor Yellow
  foreach ($e in $script:errors) {
    Write-Host "  - $e" -ForegroundColor Red
  }
  Write-Host "`nVer docs\TROUBLESHOOTING.md para soluciones." -ForegroundColor Yellow
}

Write-Host ""
