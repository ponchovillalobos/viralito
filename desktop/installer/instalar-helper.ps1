# instalar-helper.ps1 - lo ejecuta el instalador NSIS via nsExec.
# Acciones:
#   verificar <zip> <sums> <destino>  -> compara SHA256 del zip contra SHA256SUMS.txt
#   extraer   <zip> <->    <destino>  -> extrae el zip con .NET (rapido) y progreso
#
# OJO: este archivo va EMPACADO dentro del Setup.exe. Sin acentos a proposito:
# la salida pasa por el log del instalador y la consola OEM los rompe.
# Exit codes: 0 ok, 1 hash no coincide, 2 no se encontro hash esperado, 3 error.

param(
  [Parameter(Mandatory = $true)][string]$Accion,
  [Parameter(Mandatory = $true)][string]$Zip,
  # NO obligatorio: 'extraer' no usa Sums. Si fuera Mandatory y el binding
  # fallara (p.ej. un arg raro desde powershell.exe -File), PowerShell intenta
  # preguntar interactivamente y, sin consola, muere con codigo != 0 ANTES de
  # correr el script — exactamente el bug que tumbaba la extraccion.
  [string]$Sums = '',
  [Parameter(Mandatory = $true)][string]$Destino
)

$ErrorActionPreference = 'Stop'

# Cada mensaje va al log del instalador (stdout) Y a un archivo en la carpeta
# de instalacion: en modo silencioso el log de NSIS no se ve, y este archivo
# es la unica forma de diagnosticar que paso.
$script:LogPath = Join-Path $Destino 'instalar-helper.log'
function W([string]$m) {
  Write-Output $m
  try { Add-Content -LiteralPath $script:LogPath -Value ('[' + (Get-Date -Format 'HH:mm:ss') + "] $m") } catch {}
}
W "--- accion: $Accion ---"

try {
  switch ($Accion) {

    'verificar' {
      $nombre = Split-Path $Zip -Leaf
      $linea = Get-Content -LiteralPath $Sums |
        Where-Object { $_ -match [regex]::Escape($nombre) } |
        Select-Object -First 1
      if (-not $linea) {
        W "No encontre la huella de $nombre en SHA256SUMS.txt"
        exit 2
      }
      $esperado = ($linea.Trim() -split '\s+')[0]
      W 'Calculando huella SHA256 de la descarga (tarda un momento)...'
      $real = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
      if ($real -eq $esperado) {
        W 'Integridad verificada: la descarga esta completa y sin alterar.'
        exit 0
      }
      W "La huella no coincide. Esperada: $esperado / Real: $real"
      exit 1
    }

    'extraer' {
      if (-not (Test-Path -LiteralPath $Destino)) {
        New-Item -ItemType Directory -Force -Path $Destino | Out-Null
      }

      $destFull = $Destino.TrimEnd('\')
      try { $rp = (Resolve-Path -LiteralPath $Destino -ErrorAction Stop).Path; if ($rp) { $destFull = $rp.TrimEnd('\') } } catch {}
      $prefijo = $destFull + '\'

      # Cierra procesos que corren DESDE la carpeta de instalacion (node/python
      # de una version abierta) que dejan .pyd/.dll BLOQUEADOS y rompen la
      # sobrescritura. CIM = lee ExecutablePath cross-bitness (NSIS 32-bit no
      # podria con (Get-Process).Path sobre procesos 64-bit). Solo toca ESTA
      # carpeta; jamas node/python ajenos del sistema.
      function Cerrar-Bloqueadores {
        $b = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefijo, [System.StringComparison]::OrdinalIgnoreCase)
          })
        foreach ($x in $b) {
          W ("Cerrando proceso que bloquea archivos: $($x.Name) (PID $($x.ProcessId))")
          try { Stop-Process -Id $x.ProcessId -Force -ErrorAction Stop } catch { W ("  no se pudo cerrar: " + $_.Exception.Message) }
        }
        if ($b.Count -gt 0) { W ("Cerre $($b.Count) proceso(s) de una version abierta."); Start-Sleep -Seconds 3 }
      }

      # METODO 1: tar.exe del sistema (firmado por MS, los AV no lo bloquean;
      # maneja zip64 y rutas largas). Devuelve $true si extrajo bien.
      function Extraer-Tar {
        $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (-not (Test-Path -LiteralPath $tar)) { W 'tar.exe no esta en este Windows; uso el metodo alternativo...'; return $false }
        W 'Configurando los archivos de Viralito...'
        $errFile = Join-Path $env:TEMP ('evs-tar-' + [Guid]::NewGuid().ToString('N') + '.log')
        $p = Start-Process -FilePath $tar -ArgumentList ('-xf "' + $Zip + '" -C "' + $Destino + '"') -NoNewWindow -PassThru -RedirectStandardError $errFile
        $null = $p.Handle   # PS 5.1 no cachea el handle sin esto y ExitCode llega null
        $min = 0
        while (-not $p.HasExited) {
          Start-Sleep -Seconds 20
          $min += 0.33
          W ('Configurando... seguimos trabajando ({0:N0} min)' -f $min)
        }
        $p.WaitForExit()
        $codigo = $p.ExitCode; if ($null -eq $codigo) { $codigo = -1 }
        $detalle = ''
        if (Test-Path -LiteralPath $errFile) { $detalle = (Get-Content -LiteralPath $errFile -TotalCount 5) -join ' | '; Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue }
        if ($codigo -eq 0) { return $true }
        W ("tar no termino (codigo $codigo): $detalle")
        return $false
      }

      # METODO 2 (respaldo): .NET con prefijo \\?\ (rutas largas). Lanza si falla.
      function Extraer-Net {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archivo = [IO.Compression.ZipFile]::OpenRead($Zip)
        try {
          $total = $archivo.Entries.Count; $i = 0; $paso = [Math]::Max(1, [int][Math]::Floor($total / 20))
          W "Metodo alternativo: configurando $total archivos..."
          foreach ($e in $archivo.Entries) {
            $i++
            $rel = $e.FullName -replace '/', '\'
            if ($rel -match '\.\.') { continue }
            $script:entradaActual = $rel
            $ruta = Join-Path $Destino $rel
            if ($rel.EndsWith('\') -or $e.Name -eq '') { [IO.Directory]::CreateDirectory('\\?\' + $ruta) | Out-Null }
            else {
              $dir = Split-Path $ruta
              [IO.Directory]::CreateDirectory('\\?\' + $dir) | Out-Null
              [IO.Compression.ZipFileExtensions]::ExtractToFile($e, '\\?\' + $ruta, $true)
            }
            if ($i % $paso -eq 0) { W ("Configurando... {0}%" -f ([int](100 * $i / $total))) }
          }
        }
        finally { $archivo.Dispose() }
      }

      # Hasta 3 intentos: cada uno re-cierra bloqueadores y prueba tar, luego
      # .NET. Resiste bloqueos TRANSITORIOS (un antivirus escaneando un .pyd un
      # instante, handles que tardan en liberarse) — la causa mas comun de que
      # "fallara la extraccion" en maquinas ajenas.
      $maxIntentos = 3
      for ($intento = 1; $intento -le $maxIntentos; $intento++) {
        if ($intento -gt 1) { W ("Reintentando (intento $intento de $maxIntentos)..."); Start-Sleep -Seconds 6 }
        Cerrar-Bloqueadores
        if (Extraer-Tar) { W 'Extraccion completa.'; exit 0 }
        try {
          Extraer-Net
          W 'Extraccion completa.'
          exit 0
        } catch {
          $script:ultimoError = $_.Exception.Message
          W ("Intento $intento no pudo: " + $_.Exception.Message)
          if ($_.Exception.InnerException) { W ("  Causa: " + $_.Exception.InnerException.Message) }
          if ($script:entradaActual) { W ("  Archivo en curso: " + $script:entradaActual) }
        }
      }
      W ("No se pudo configurar tras $maxIntentos intentos. Ultimo error: " + $script:ultimoError)
      exit 3
    }

    default {
      W "Accion desconocida: $Accion"
      exit 3
    }
  }
}
catch {
  # Error con TODO el detalle: tipo, mensaje, inner y linea — para que el log
  # del instalador diga exactamente que paso (foto del usuario = diagnostico).
  $e = $_.Exception
  W ("ERROR: [" + $e.GetType().Name + "] " + $e.Message)
  if ($e.InnerException) {
    W ("  Causa interna: [" + $e.InnerException.GetType().Name + "] " + $e.InnerException.Message)
  }
  if ($script:entradaActual) {
    W ("  Archivo en curso: " + $script:entradaActual)
  }
  W ("  Donde: " + $_.InvocationInfo.PositionMessage)
  exit 3
}
