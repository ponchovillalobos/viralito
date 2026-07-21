# bundle.ps1 — Arma la carpeta `payload/` distribuible junto al exe de Tauri.
# El launcher la detecta sola: con payload, la app corre en CUALQUIER máquina
# sin instalar node/python/ffmpeg.
#
# Uso (desde desktop/):  powershell -ExecutionPolicy Bypass -File bundle.ps1
# Resultado: desktop\src-tauri\target\release\payload\  (+5-7 GB por torch/whisperx)
#
# Después de correrlo: zip de la carpeta release\ completa (exe + payload) o
# instalador NSIS apuntando ahí. Los modelos de WhisperX (~2 GB) se descargan
# solos en la primera transcripción del usuario (no van en el payload).

$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot\.."
$out = "$PSScriptRoot\src-tauri\target\release\payload"

Write-Host "== Payload -> $out"
# Payload LIMPIO siempre: Copy-Item -Recurse ANIDA la carpeta si el destino ya
# existe (un re-bundle dejaba el standalone viejo sirviendo y el nuevo enterrado
# en standalone\standalone). Es un artefacto de build: se borra y rearma entero.
if (Test-Path $out) {
  # robocopy /MIR con carpeta vacia: borra arboles con rutas mas largas que
  # MAX_PATH (torch tiene headers anidados que Remove-Item no puede tocar).
  $empty = "$env:TEMP\__empty_payload"
  New-Item -ItemType Directory -Force $empty | Out-Null
  robocopy $empty $out /MIR /NFL /NDL /NJH /NJS | Out-Null
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  Remove-Item $empty -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force $out | Out-Null

# 1) Server Next standalone (+static +public)
Write-Host "[1/5] frontend standalone..."
$fe = "$out\frontend\.next"
New-Item -ItemType Directory -Force $fe | Out-Null
Copy-Item "$repo\frontend\.next\standalone" "$fe\standalone" -Recurse -Force
Copy-Item "$repo\frontend\.next\static" "$fe\standalone\.next\static" -Recurse -Force
if (Test-Path "$repo\frontend\public") {
  Copy-Item "$repo\frontend\public" "$fe\standalone\public" -Recurse -Force
}

# 1.5) SANEO DEL STANDALONE — CRITICO, NO QUITAR.
# `next build` deja dentro de .next\standalone una copia de cosas del repo que NO
# deben viajar al usuario final:
#   - .env / .env.local        → SECRETOS REALES del dev (PEXELS_API_KEY,
#                                LINKEDIN_CLIENT_SECRET, META_APP_SECRET,
#                                TIKTOK_CLIENT_SECRET). Con el Client Secret
#                                cualquiera puede SUPLANTAR la app ante LinkedIn/
#                                TikTok/Meta. Las credenciales OAuth del usuario
#                                final salen de su user-settings.json, no de aca.
#   - src\                     → codigo fuente completo del frontend.
#   - *.md (CLAUDE.md, AGENTS.md), eslint.config.*  → notas internas del repo.
# Se borran DESPUES de copiar (no antes: el repo no se toca).
$sa = "$fe\standalone"
Get-ChildItem $sa -Filter ".env*" -Force -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue
if (Test-Path "$sa\src") { Remove-Item "$sa\src" -Recurse -Force }
Get-ChildItem $sa -Filter "*.md" -File -Force -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $sa -Filter "eslint.config.*" -File -Force -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# VALIDACION DURA: si por lo que sea quedo un .env en el payload, ABORTAR. Es
# preferible no tener instalador a publicar los secretos del dev.
$leaked = Get-ChildItem $sa -Filter ".env*" -Recurse -Force -ErrorAction SilentlyContinue
if ($leaked) {
  throw "ABORTADO: quedaron archivos .env en el payload ($($leaked.FullName -join ', ')). NO distribuir."
}

# 2) Node portable (el mismo node.exe del sistema; ~80 MB)
Write-Host "[2/5] node..."
New-Item -ItemType Directory -Force "$out\node" | Out-Null
$nodeSrc = (Get-Command node).Source
Copy-Item $nodeSrc "$out\node\node.exe" -Force
# npx/npm para `npx remotion render` (vienen junto a node)
$nodeDir = Split-Path $nodeSrc
foreach ($f in @("npx.cmd", "npm.cmd", "node_modules")) {
  if (Test-Path "$nodeDir\$f") { Copy-Item "$nodeDir\$f" "$out\node\$f" -Recurse -Force }
}
# VALIDACION DURA: sin npx, los renders del payload fallan en silencio en la
# maquina del usuario. Mejor reventar ACA, en build time.
if (-not (Test-Path "$out\node\npx.cmd")) {
  throw "npx.cmd no se encontro junto a node ($nodeDir) - el payload no podria renderizar. Instala node con npm incluido."
}

# 3) Remotion (proyecto + node_modules; el render corre desde acá)
Write-Host "[3/5] remotion (esto tarda)..."
robocopy "$repo\remotion" "$out\remotion" /E /NFL /NDL /NJH /NJS /XD "vendor" | Out-Null
if (-not (Test-Path "$out\remotion\node_modules\.bin")) {
  throw "remotion\node_modules quedo incompleto en el payload - corre npm install en remotion\ y rearma."
}

# 4) Python PORTABLE: scripts + runtime embeddable (NO el venv de dev, que no es
#    relocatable). Construir antes con make-python-runtime.ps1.
Write-Host "[4/5] python portable (esto tarda)..."
if (-not (Test-Path "$repo\python\runtime\python.exe")) {
  throw "Falta python\runtime — corré primero desktop\make-python-runtime.ps1"
}
robocopy "$repo\python" "$out\python" /E /NFL /NDL /NJH /NJS /XD "__pycache__" "venv" | Out-Null

# 5) ffmpeg
Write-Host "[5/5] ffmpeg..."
# El resto del proyecto migro a C:\viral-data (paths.ts / config.py usan viral-data
# primero y hermes-data solo como fallback legacy). Este paso seguia hardcodeado a
# hermes-data: en una maquina limpia devolvia $null y reventaba dos lineas mas abajo
# con "Cannot index into a null array", que no dice nada. Buscamos en ambos y
# fallamos con un mensaje util.
$ff = $null
foreach ($base in @("C:\viral-data\tools", "C:\hermes-data\tools")) {
  if (Test-Path $base) {
    $ff = Get-ChildItem $base -Directory -Filter "ffmpeg-*" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($ff) { break }
  }
}
if (-not $ff) {
  throw "No se encontro ffmpeg-* en C:\viral-data\tools ni C:\hermes-data\tools - el payload no podria cortar ni renderizar video."
}
New-Item -ItemType Directory -Force "$out\tools\ffmpeg\bin" | Out-Null
Copy-Item "$($ff.FullName)\bin\ffmpeg.exe" "$out\tools\ffmpeg\bin\" -Force
Copy-Item "$($ff.FullName)\bin\ffprobe.exe" "$out\tools\ffmpeg\bin\" -Force

# 5.5) PODA de peso muerto que NO se usa en runtime: acelera la descarga y la
#      instalación (menos archivos = menos I/O y menos escaneo de antivirus) SIN
#      cambiar funcionalidad. Quita ~1 GB y ~16k archivos. Lo que se poda:
#       - torch\include (headers C++) y torch\lib\*.lib (libs de ENLACE): solo
#         sirven para COMPILAR extensiones; nunca se cargan al correr.
#       - tests/test de los paquetes Python: código de prueba, jamás corre.
#       - remotion *.map (mapas de depuración) y *.md (docs).
#       - remotion node_modules\.cache (caché de webpack, ~332 MB): se regenera
#         solo; NO confundir con .remotion (Chromium headless ~270MB que SÍ se
#         necesita para renderizar — ese NO se toca).
#       - site-packages matplotlib/pandas/sklearn/mpl_toolkits (+sus .libs):
#         ~150 MB, 0 imports en python\*.py del proyecto (verificado por grep).
#         NO se podan numba/llvmlite/scipy: librosa/whisperx los requieren.
Write-Host "[6/6] podando peso muerto (no-runtime)..."
$emptyP = "$env:TEMP\__poda_vacia"
New-Item -ItemType Directory -Force $emptyP | Out-Null
function Remove-DirLong($d) {
  # robocopy /MIR vacía árboles con rutas > MAX_PATH (Remove-Item no puede).
  if (Test-Path -LiteralPath $d) {
    robocopy $emptyP $d /MIR /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
    & cmd.exe /c "rmdir /s /q `"$d`"" 2>$null
  }
}
function Remove-FilesByPattern($root, $pattern) {
  if (-not (Test-Path -LiteralPath $root)) { return }
  Get-ChildItem -LiteralPath $root -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
    try { [System.IO.File]::Delete('\\?\' + $_.FullName) } catch {}
  }
}
$sp = "$out\python\runtime\Lib\site-packages"
Remove-DirLong "$sp\torch\include"
Remove-FilesByPattern "$sp\torch\lib" "*.lib"
Get-ChildItem -LiteralPath $sp -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in 'tests', 'test' } | ForEach-Object { Remove-DirLong $_.FullName }
Remove-FilesByPattern "$out\remotion" "*.map"
Remove-FilesByPattern "$out\remotion" "*.md"

# Caché de webpack de Remotion (~332 MB): peso muerto, se regenera solo. OJO:
# solo .cache; .remotion (Chromium headless del render) NO se toca.
$rcache = "$out\remotion\node_modules\.cache"
if (Test-Path -LiteralPath $rcache) {
  Write-Host "  - podando remotion\node_modules\.cache (webpack)"
  Remove-DirLong $rcache
}

# Libs de data-science sin uso en runtime (0 imports en python\*.py): matplotlib,
# pandas, sklearn, mpl_toolkits y sus .libs (DLLs satélite). ~150 MB.
# NO se podan numba/llvmlite/scipy (librosa/whisperx los necesitan).
foreach ($pkg in @('matplotlib', 'matplotlib.libs', 'pandas', 'pandas.libs', `
                   'sklearn', 'scikit_learn.libs', 'mpl_toolkits')) {
  $d = "$sp\$pkg"
  if (Test-Path -LiteralPath $d) {
    Write-Host "  - podando site-packages\$pkg"
    Remove-DirLong $d
  }
}

Remove-Item $emptyP -Force -ErrorAction SilentlyContinue

$size = (Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1GB
Write-Host ("== Payload listo: {0:N1} GB" -f $size)

# 6) Checksum del exe (para publicar junto a la descarga: el usuario puede
#    verificar integridad y las instrucciones anti-SmartScreen lo referencian).
$exe = "$PSScriptRoot\src-tauri\target\release\desktop.exe"
if (Test-Path $exe) {
  $hash = (Get-FileHash $exe -Algorithm SHA256).Hash
  "$hash  desktop.exe" | Out-File "$PSScriptRoot\src-tauri\target\release\SHA256SUMS.txt" -Encoding ascii
  Write-Host "== SHA256 de desktop.exe: $hash (guardado en SHA256SUMS.txt)"
}
Write-Host "== Probalo: ejecutá desktop\src-tauri\target\release\desktop.exe"
