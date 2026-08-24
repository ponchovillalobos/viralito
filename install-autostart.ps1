# =============================================================================
# install-autostart.ps1 — Registra el dashboard en Task Scheduler
# =============================================================================
#
# Después de correr esto, el dashboard arranca automáticamente al iniciar sesión
# en Windows (sin que abras nada manualmente). Se ejecuta sin ventana visible
# y abre el navegador en http://localhost:3000 cuando está listo.
#
# Para desinstalar:
#   .\install-autostart.ps1 -Uninstall
#
# Para ejecutar la tarea ahora (test):
#   .\install-autostart.ps1 -RunNow
# =============================================================================

param(
    [switch]$Uninstall,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$TaskName = "EstrategiaViralPoncho_Dashboard"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartScript = Join-Path $ProjectRoot "start-dashboard.ps1"

if ($Uninstall) {
    try {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Host "✅ Autostart desinstalado." -ForegroundColor Green
    } catch {
        Write-Host "⚠ Tarea no encontrada (¿ya estaba desinstalada?)" -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path $StartScript)) {
    Write-Host "❌ No se encontró $StartScript" -ForegroundColor Red
    exit 1
}

# Verificar si ya existe
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "ℹ La tarea '$TaskName' ya existe — la reemplazo..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Definir trigger (al iniciar sesión del usuario actual)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Definir acción (PowerShell ejecuta el script de inicio)
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""

# Definir settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Definir principal (correr como el usuario actual, NO admin)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

# Registrar
Register-ScheduledTask -TaskName $TaskName `
    -Trigger $trigger `
    -Action $action `
    -Settings $settings `
    -Principal $principal `
    -Description "Arranca el dashboard Estrategia Viral Poncho automáticamente al iniciar sesión." | Out-Null

Write-Host "✅ Autostart registrado." -ForegroundColor Green
Write-Host ""
Write-Host "Tarea: $TaskName"
Write-Host "Trigger: al iniciar sesión de $env:USERNAME"
Write-Host "Script: $StartScript"
Write-Host ""
Write-Host "Comandos útiles:"
Write-Host "  Ejecutar ahora:  .\install-autostart.ps1 -RunNow"
Write-Host "  Desinstalar:     .\install-autostart.ps1 -Uninstall"
Write-Host "  Ver estado:      Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Logs:            Get-Content '$ProjectRoot\.dashboard.log' -Tail 30"

if ($RunNow) {
    Write-Host ""
    Write-Host "Ejecutando ahora..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 3
    Write-Host "Tarea iniciada. Revisar logs con: Get-Content .dashboard.log -Tail 30"
}
