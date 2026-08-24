# =============================================================================
# start-dashboard.ps1 — Arranca el dashboard de Estrategia Viral Poncho
# =============================================================================
#
# Uso manual:
#   .\start-dashboard.ps1
#
# Uso automático (al iniciar Windows):
#   .\install-autostart.ps1   (lo registra en Task Scheduler)
#
# Este script:
#   1. Verifica que Node.js, Python y Ollama estén disponibles
#   2. Arranca Ollama si no está corriendo
#   3. Levanta `npm run dev` del frontend en background
#   4. Espera a que el dashboard esté listo
#   5. Abre http://localhost:3000 en el navegador por defecto
# =============================================================================

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $ProjectRoot "frontend"
$LogFile = Join-Path $ProjectRoot ".dashboard.log"

# Asegurar Node en PATH
$nodePath = "C:\Program Files\nodejs"
if (Test-Path "$nodePath\node.exe") {
    $env:PATH = "$nodePath;$env:PATH"
}

# Log helper
function Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    "$ts $msg" | Out-File -Append $LogFile -Encoding UTF8
    Write-Host "[$ts] $msg"
}

Log "=== start-dashboard.ps1 ==="

# 1. Verificar Node
try {
    $nodeVer = & node --version 2>$null
    Log "Node $nodeVer detectado"
} catch {
    Log "ERROR: Node.js no encontrado en PATH"
    exit 1
}

# 2. Verificar Ollama (opcional pero recomendado)
try {
    $r = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 2>$null
    Log "Ollama OK (modelos: $($r.models.Count))"
} catch {
    # Intentar arrancar Ollama si está instalado
    $ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
    if (Test-Path $ollamaExe) {
        Log "Arrancando Ollama..."
        Start-Process -FilePath $ollamaExe -WindowStyle Hidden
        Start-Sleep -Seconds 5
    } else {
        Log "ADVERTENCIA: Ollama no corriendo (necesario solo para long_form)"
    }
}

# 3. Verificar si el dashboard ya está corriendo
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 3 -UseBasicParsing 2>$null
    if ($resp.StatusCode -eq 200) {
        Log "Dashboard ya corre en localhost:3000"
        Start-Process "http://localhost:3000"
        exit 0
    }
} catch { }

# 4. Arrancar npm run dev en background (sin ventana visible)
Log "Arrancando npm run dev desde $FrontendDir"
Set-Location $FrontendDir
$proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev > `"$LogFile.npm.log`" 2>&1" `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -PassThru
Log "Proceso npm lanzado (PID $($proc.Id))"

# 5. Esperar hasta 60s a que el dashboard responda
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -UseBasicParsing 2>$null
        if ($resp.StatusCode -eq 200) {
            $ready = $true
            Log "Dashboard listo después de $i segundos"
            break
        }
    } catch { }
}

if ($ready) {
    Log "Abriendo http://localhost:3000 en el navegador"
    Start-Process "http://localhost:3000"
    exit 0
} else {
    Log "ERROR: Dashboard no respondió en 60s. Revisar $LogFile.npm.log"
    exit 1
}
