; ============================================================================
; instalador.nsi — Instalador web de Estrategia Viral Studio (español, MUI2)
;
; Qué hace:
;   1. Chequea el sistema (Windows 10+ x64, RAM >= 8 GB, disco >= 8 GB, GPU
;      informativa) en una página que NO deja avanzar hasta que todo pasa.
;   2. Descarga el zip del último GitHub Release con barra de progreso (INetC).
;   3. Verifica el SHA256 contra el SHA256SUMS.txt del mismo release.
;   4. Extrae todo a la carpeta elegida (PowerShell + .NET, con progreso).
;   5. Crea accesos directos en el Escritorio y el Menú Inicio.
;   6. Registra el desinstalador en Panel de Control / Apps.
;
; Compilar:  desktop\build-installer.ps1  (auto-detecta o baja NSIS portable)
; Requiere:  plugin INetC (el build script lo instala solo en el NSIS portable)
; ============================================================================

Unicode True
ManifestDPIAware true
SetCompressor /SOLID lzma

; ----------------------------------------------------------------------------
; Constantes
; ----------------------------------------------------------------------------
!define APP_NAME      "Viralito"
!define APP_ID        "EstrategiaViralStudio"
!define APP_VERSION   "0.4.3"
!define APP_PUBLISHER "Poncho Robles"
!define APP_URL       "https://github.com/ponchovillalobos/viralito"
!define APP_EXE       "desktop.exe"
!define ZIP_NAME      "EstrategiaViralStudio-v${APP_VERSION}.zip"
!define BASE_URL      "${APP_URL}/releases/latest/download"
!define ZIP_URL       "${BASE_URL}/${ZIP_NAME}"
!define SUMS_URL      "${BASE_URL}/SHA256SUMS.txt"
!define UNINST_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

!define MIN_RAM_MB    7400   ; "8 GB": las máquinas de 8 GB reportan ~7.8-8.0 GB
!define MIN_DISK_MB   8192   ; 8 GB libres (1 GB de zip + ~3.5 GB extraído + margen)

; El build script puede pasar /DOUTFILE=ruta\Setup.exe
!ifndef OUTFILE
  !define OUTFILE "EstrategiaViralStudio-Setup.exe"
!endif

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "C:\${APP_ID}"
RequestExecutionLevel admin
BrandingText "${APP_NAME} v${APP_VERSION}"

; Info de versión del Setup.exe (propiedades del archivo)
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1034 "ProductName"     "${APP_NAME}"
VIAddVersionKey /LANG=1034 "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey /LANG=1034 "FileVersion"     "${APP_VERSION}"
VIAddVersionKey /LANG=1034 "FileDescription" "Instalador de ${APP_NAME}"
VIAddVersionKey /LANG=1034 "LegalCopyright"  "${APP_PUBLISHER} (MIT)"

; ----------------------------------------------------------------------------
; Includes
; ----------------------------------------------------------------------------
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
${StrStr}            ; declara la función StrStr (instalador)
${StrTrimNewLines}   ; declara StrTrimNewLines (instalador)

; Escribe la fase actual al archivo que lee el slideshow (formato "titulo|detalle").
; "FIN" hace que el slideshow se cierre solo.
!macro Estado texto
  ClearErrors
  FileOpen $8 "$PLUGINSDIR\slide-estado.txt" w
  ${IfNot} ${Errors}
    FileWrite $8 "${texto}"
    FileClose $8
  ${EndIf}
!macroend

; ----------------------------------------------------------------------------
; Interfaz (MUI2) en español
; ----------------------------------------------------------------------------
!define MUI_ICON   "..\src-tauri\icons\icon.ico"
!define MUI_UNICON "..\src-tauri\icons\icon.ico"

; Imagenes de marca Viralito (las genera C:\hermes-data\brand\make-installer-art.py
; desde el icono maestro): banner lateral en Bienvenida/Final + header en el resto.
!define MUI_WELCOMEFINISHPAGE_BITMAP   "assets\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "assets\welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP   "assets\header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "assets\header.bmp"

!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "La instalación todavía no terminó.$\r$\n$\r$\n¿Seguro que quieres salir?"
!define MUI_UNABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "¡Bienvenido a ${APP_NAME}!"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instala ${APP_NAME}: el editor de videos virales con IA que corre 100% en tu computadora — gratis, en español, sin nube y sin API keys.$\r$\n$\r$\nQué va a pasar:$\r$\n  1. Revisamos que tu computadora cumpla los requisitos.$\r$\n  2. Se descarga la app (~1 GB, necesitas internet).$\r$\n  3. Se instala y te deja un acceso directo en el escritorio.$\r$\n$\r$\nNo necesitas instalar nada más para empezar: Node, Python y ffmpeg ya van adentro. (El modo inteligente de videos largos usa una IA local gratuita y opcional — la app te guía si la quieres.)$\r$\n$\r$\nPresiona Siguiente para empezar."

!define MUI_DIRECTORYPAGE_TEXT_TOP "Elige dónde instalar ${APP_NAME}.$\r$\n$\r$\nRecomendado: dejar la carpeta como está. Evita carpetas dentro de OneDrive o Google Drive (la app pesa varios GB y la sincronización la rompe)."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Carpeta de instalación"

!define MUI_FINISHPAGE_TITLE "¡Listo, a crear!"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} quedó instalado.$\r$\n$\r$\nTienes un acceso directo en el Escritorio y otro en el Menú Inicio.$\r$\n$\r$\nLa primera vez que transcribas un video, la app descarga el modelo de voz (~1.5 GB, una sola vez, con barra de progreso).$\r$\n$\r$\nSi Windows muestra un aviso azul de SmartScreen al abrirla: toca $\"Más información$\" y luego $\"Ejecutar de todas formas$\". Es normal en apps sin firma digital paga; no es un virus."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${APP_NAME} ahora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirApp

!define MUI_UNCONFIRMPAGE_TEXT_TOP "Se va a desinstalar ${APP_NAME} de la carpeta de abajo.$\r$\n$\r$\nTus videos y renders NO se borran: viven fuera de esta carpeta (por ejemplo en C:\viral-data). Presiona Desinstalar para continuar."

; Páginas del instalador
!insertmacro MUI_PAGE_WELCOME
Page custom PagChequeoCrear
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirSalir
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Páginas del desinstalador
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Spanish"

; ----------------------------------------------------------------------------
; Variables de la página de chequeo
; ----------------------------------------------------------------------------
Var IntentosDescarga   ; reintentos automaticos de la descarga del zip
Var IntentosSums       ; reintentos automaticos del SHA256SUMS.txt
Var Dialogo
Var LblArch
Var LblWin
Var LblRam
Var LblDisco
Var LblGpu
Var LblResumen
Var BtnReintentar
Var SysOK
Var GpuTxt

; ============================================================================
; Página custom: chequeo del sistema (no deja avanzar si algo falla)
; ============================================================================
Function PagChequeoCrear
  !insertmacro MUI_HEADER_TEXT "Revisando tu computadora" "Verificamos que todo esté listo antes de instalar."

  nsDialogs::Create 1018
  Pop $Dialogo
  ${If} $Dialogo == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "Estos son los requisitos para que ${APP_NAME} funcione bien:"
  Pop $0

  ${NSD_CreateLabel} 8u 26u 100% 11u ""
  Pop $LblArch
  ${NSD_CreateLabel} 8u 39u 100% 11u ""
  Pop $LblWin
  ${NSD_CreateLabel} 8u 52u 100% 11u ""
  Pop $LblRam
  ${NSD_CreateLabel} 8u 65u 100% 22u ""
  Pop $LblDisco
  ${NSD_CreateLabel} 8u 89u 100% 11u ""
  Pop $LblGpu

  ${NSD_CreateLabel} 0 106u 100% 22u ""
  Pop $LblResumen

  ${NSD_CreateButton} 0 130u 110u 14u "Volver a comprobar"
  Pop $BtnReintentar
  ${NSD_OnClick} $BtnReintentar RevisarSistema

  Call RevisarSistema
  nsDialogs::Show
FunctionEnd

Function RevisarSistema
  StrCpy $SysOK "1"

  ; --- 1) Windows de 64 bits -----------------------------------------------
  ${If} ${RunningX64}
    ${NSD_SetText} $LblArch "✔  Windows de 64 bits"
  ${Else}
    ${NSD_SetText} $LblArch "✘  Tu Windows es de 32 bits. La app necesita Windows de 64 bits."
    StrCpy $SysOK "0"
  ${EndIf}

  ; --- 2) Windows 10 o más nuevo -------------------------------------------
  ${If} ${AtLeastWin10}
    ${NSD_SetText} $LblWin "✔  Windows 10 u 11"
  ${Else}
    ${NSD_SetText} $LblWin "✘  Necesitas Windows 10 u 11. Tu versión de Windows es más vieja."
    StrCpy $SysOK "0"
  ${EndIf}

  ; --- 3) RAM >= 8 GB (GlobalMemoryStatusEx) -------------------------------
  System::Call "*(i 64, i 0, l 0, l 0, l 0, l 0, l 0, l 0, l 0) p . r0"
  System::Call "kernel32::GlobalMemoryStatusEx(p r0) i . r2"
  System::Call "*$0(i, i, l . r1)"
  System::Free $0
  ${If} $2 = 0
    ; No se pudo medir: no bloqueamos por las dudas
    ${NSD_SetText} $LblRam "✔  Memoria RAM: no se pudo medir (seguimos igual)"
  ${Else}
    System::Int64Op $1 / 1048576
    Pop $1
    ${If} $1 >= ${MIN_RAM_MB}
      ${NSD_SetText} $LblRam "✔  Memoria RAM: $1 MB (suficiente)"
    ${Else}
      ${NSD_SetText} $LblRam "✘  Tu computadora necesita al menos 8 GB de RAM (detectamos $1 MB)."
      StrCpy $SysOK "0"
    ${EndIf}
  ${EndIf}

  ; --- 4) Disco >= 8 GB libres en la unidad de destino ----------------------
  StrCpy $0 $INSTDIR 3   ; "C:\"
  ClearErrors
  ${DriveSpace} "$0" "/D=F /S=M" $1
  ${If} ${Errors}
    ${NSD_SetText} $LblDisco "✔  Espacio en disco: no se pudo medir (se revisa de nuevo al elegir carpeta)"
  ${ElseIf} $1 >= ${MIN_DISK_MB}
    ${NSD_SetText} $LblDisco "✔  Espacio libre en $0  $1 MB (suficiente)"
  ${Else}
    ${NSD_SetText} $LblDisco "✘  Necesitas al menos 8 GB libres en el disco $0 (quedan $1 MB).$\r$\nLibera espacio (vacía la papelera, borra descargas viejas) y toca $\"Volver a comprobar$\"."
    StrCpy $SysOK "0"
  ${EndIf}

  ; --- 5) GPU (informativo, nunca bloquea; se consulta una sola vez) --------
  ${If} $GpuTxt == ""
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)"'
    Pop $2
    Pop $3
    ${StrTrimNewLines} $3 $3
    ${If} $2 = 0
    ${AndIf} $3 != ""
      StrCpy $GpuTxt $3
    ${Else}
      StrCpy $GpuTxt "no detectada (la app funciona igual, solo renderiza más lento)"
    ${EndIf}
  ${EndIf}
  ${NSD_SetText} $LblGpu "i  Tarjeta gráfica: $GpuTxt"

  ; --- Resumen + botón Siguiente -------------------------------------------
  GetDlgItem $2 $HWNDPARENT 1
  ${If} $SysOK = 1
    SetCtlColors $LblResumen 0x006600 transparent
    ${NSD_SetText} $LblResumen "Todo listo. Presiona Siguiente para continuar."
    EnableWindow $2 1
  ${Else}
    SetCtlColors $LblResumen 0xCC0000 transparent
    ${NSD_SetText} $LblResumen "Falta resolver los puntos marcados con ✘. El botón Siguiente se activa cuando todo esté bien."
    EnableWindow $2 0
  ${EndIf}
FunctionEnd

; ============================================================================
; Página de carpeta: re-chequeo de espacio + aviso OneDrive
; ============================================================================
Function DirSalir
  ; ¿Eligió una carpeta dentro de OneDrive? Mala idea con varios GB.
  ${StrStr} $R0 "$INSTDIR" "OneDrive"
  ${If} $R0 != ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "Esa carpeta está dentro de OneDrive.$\r$\n$\r$\nLa app pesa varios GB y OneDrive intentaría sincronizarla, lo que la rompe y te llena la nube.$\r$\n$\r$\nElige una carpeta fuera de OneDrive (la recomendada es C:\${APP_ID})."
    Abort   ; se queda en esta página
  ${EndIf}

  ; ¿Hay 8 GB libres en la unidad elegida?
  StrCpy $0 $INSTDIR 3
  ClearErrors
  ${DriveSpace} "$0" "/D=F /S=M" $1
  ${IfNot} ${Errors}
    ${If} $1 < ${MIN_DISK_MB}
      MessageBox MB_ICONEXCLAMATION|MB_OK "En la unidad $0 quedan $1 MB libres y se necesitan al menos 8 GB (8192 MB).$\r$\n$\r$\nLibera espacio o elige otra unidad."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

; ============================================================================
; Instalación
; ============================================================================
Section "Instalar ${APP_NAME}" SecInstalar
  SetDetailsPrint both

  ; Si la app quedó abierta de una instalación anterior, cerrarla
  nsExec::Exec 'taskkill /F /IM ${APP_EXE}'
  Pop $0

  InitPluginsDir
  File "/oname=$PLUGINSDIR\instalar-helper.ps1" "instalar-helper.ps1"

  ; --------------------------------------------------------------------------
  ; Slideshow: ventana visual con capturas + funciones mientras se instala.
  ; Corre como proceso SEPARADO (su propio message loop), asi anima aunque el
  ; instalador este bloqueado bajando/extrayendo. Se cierra solo al leer "FIN".
  ; Es ADITIVO: si por lo que sea no abre, la instalacion procede igual.
  ; --------------------------------------------------------------------------
  File "/oname=$PLUGINSDIR\slideshow.ps1" "slideshow.ps1"
  File "/oname=$PLUGINSDIR\slide1.png" "assets\slide1.png"
  File "/oname=$PLUGINSDIR\slide2.png" "assets\slide2.png"
  File "/oname=$PLUGINSDIR\slide3.png" "assets\slide3.png"
  File "/oname=$PLUGINSDIR\slide4.png" "assets\slide4.png"
  File "/oname=$PLUGINSDIR\slide5.png" "assets\slide5.png"
  File "/oname=$PLUGINSDIR\slide6.png" "assets\slide6.png"
  File "/oname=$PLUGINSDIR\app.ico" "assets\app.ico"

  !insertmacro Estado "Preparando la instalación...|"
  Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\slideshow.ps1" -Carpeta "$PLUGINSDIR" -Estado "$PLUGINSDIR\slide-estado.txt" -Zip "$INSTDIR\${ZIP_NAME}"'

  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"

  ; --------------------------------------------------------------------------
  ; 1) DESCARGA con barra de progreso (INetC) + reintentos
  ; --------------------------------------------------------------------------
descargar:
  DetailPrint "Descargando ${APP_NAME} (~1 GB) desde GitHub..."
  !insertmacro Estado "Descargando Viralito (~1 GB)|"
  inetc::get /CAPTION "${APP_NAME} — descargando" \
    /BANNER "Bajando la app (~1 GB). Esto puede tardar varios minutos según tu internet..." \
    /CANCELTEXT "Cancelar" \
    /QUESTION "Si cancelas, la instalación se detiene. ¿Cancelar la descarga?" \
    /RESUME "Se interrumpió la descarga. ¿Reintentar desde donde quedó?" \
    "${ZIP_URL}" "$INSTDIR\${ZIP_NAME}" /END
  Pop $0
  WriteINIStr "$INSTDIR\instalar-debug.ini" pasos descarga "$0"
  StrCmp $0 "OK" verificar
  ; Reintento automático (hasta 3 intentos): los cortes de internet transitorios
  ; no deben tumbar la instalación, sobre todo en modo silencioso.
  IntOp $IntentosDescarga $IntentosDescarga + 1
  IntCmp $IntentosDescarga 3 0 reintentar_descarga 0
  ; /SD = respuesta por defecto en modo silencioso (sin ella, /S se cuelga esperando clic)
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "No se pudo descargar la app (motivo: $0).$\r$\n$\r$\nRevisa que tengas internet y vuelve a intentar." /SD IDCANCEL IDRETRY descargar
  !insertmacro Estado "FIN"
  Abort "Instalación cancelada: falló la descarga."
reintentar_descarga:
  DetailPrint "La descarga falló ($0); reintentando en 5 segundos (intento $IntentosDescarga de 3)..."
  Sleep 5000
  Goto descargar

  ; --------------------------------------------------------------------------
  ; 2) VERIFICACIÓN SHA256 contra el SHA256SUMS.txt del release
  ; --------------------------------------------------------------------------
verificar:
  DetailPrint "Verificando que la descarga esté completa y sin alterar..."
  !insertmacro Estado "Verificando la descarga|Comprobando que llegó completa y sin alterar..."
  inetc::get /SILENT "${SUMS_URL}" "$PLUGINSDIR\SHA256SUMS.txt" /END
  Pop $0
  WriteINIStr "$INSTDIR\instalar-debug.ini" pasos sums "$0"
  StrCmp $0 "OK" verificar_hash
  IntOp $IntentosSums $IntentosSums + 1
  IntCmp $IntentosSums 3 0 reintentar_sums 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "No se pudo descargar el archivo de verificación (SHA256SUMS.txt).$\r$\n$\r$\nRevisa tu internet y vuelve a intentar." /SD IDCANCEL IDRETRY verificar
  !insertmacro Estado "FIN"
  Abort "Instalación cancelada: no se pudo verificar la descarga."
reintentar_sums:
  DetailPrint "No bajó el archivo de verificación ($0); reintentando en 5 segundos (intento $IntentosSums de 3)..."
  Sleep 5000
  Goto verificar

verificar_hash:
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\instalar-helper.ps1" verificar "$INSTDIR\${ZIP_NAME}" "$PLUGINSDIR\SHA256SUMS.txt" "$INSTDIR"'
  Pop $0
  WriteINIStr "$INSTDIR\instalar-debug.ini" pasos verificar "$0"
  StrCmp $0 "0" extraer
  Delete "$INSTDIR\${ZIP_NAME}"
  IntOp $IntentosDescarga $IntentosDescarga + 1
  IntCmp $IntentosDescarga 3 0 redescargar_hash 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "La descarga llegó dañada o incompleta (la huella SHA256 no coincide).$\r$\n$\r$\nVamos a descargarla de nuevo." /SD IDCANCEL IDRETRY descargar
  !insertmacro Estado "FIN"
  Abort "Instalación cancelada: la descarga no pasó la verificación."
redescargar_hash:
  DetailPrint "La verificación no pasó (código $0); descargando de nuevo (intento $IntentosDescarga de 3)..."
  Goto descargar

  ; --------------------------------------------------------------------------
  ; 3) EXTRACCIÓN (miles de archivos; muestra progreso en el detalle)
  ; --------------------------------------------------------------------------
extraer:
  DetailPrint "Configurando Viralito en tu equipo..."
  !insertmacro Estado "Configurando Viralito en tu equipo|Dejando todo listo para ti, un momento..."
  ; OJO: el placeholder del parametro Sums es "none", NO "-". powershell.exe -File
  ; interpreta un guion suelto como inicio de parametro, falla el binding y muere
  ; con codigo != 0 antes de correr el script (bug que tumbaba la extraccion).
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\instalar-helper.ps1" extraer "$INSTDIR\${ZIP_NAME}" "none" "$INSTDIR"'
  Pop $0
  WriteINIStr "$INSTDIR\instalar-debug.ini" pasos extraer "$0"
  ; OJO: usamos ETIQUETAS, NO saltos relativos (+3). El macro Estado "FIN"
  ; expande a varias instrucciones y un +3 caeria DENTRO del macro/Abort aun
  ; con exito (extraer=0) -> la instalacion abortaba justo despues de extraer
  ; (sin accesos directos, sin desinstalador, sin ARP). Bug real en maquina
  ; limpia; lo ocultaban las pruebas sobre una instalacion previa.
  StrCmp $0 "0" extraccion_ok
  MessageBox MB_ICONSTOP|MB_OK "No se pudieron extraer los archivos (código $0).$\r$\n$\r$\nCierra otros programas, asegúrate de tener espacio libre y corre el instalador de nuevo. El detalle del error está en el log de arriba." /SD IDOK
  !insertmacro Estado "FIN"
  Abort "Instalación cancelada: falló la extracción."

extraccion_ok:
  IfFileExists "$INSTDIR\${APP_EXE}" programa_ok 0
  MessageBox MB_ICONSTOP|MB_OK "La extracción terminó pero falta el programa principal (${APP_EXE}).$\r$\n$\r$\nDescarga de nuevo el instalador y vuelve a intentar." /SD IDOK
  !insertmacro Estado "FIN"
  Abort "Instalación cancelada: instalación incompleta."

programa_ok:
  Delete "$INSTDIR\${ZIP_NAME}"   ; el zip ya no hace falta (libera ~1 GB)

  ; --------------------------------------------------------------------------
  ; 4) ACCESOS DIRECTOS (Escritorio + Menú Inicio, para todos los usuarios)
  ; --------------------------------------------------------------------------
  DetailPrint "Creando accesos directos..."
  SetShellVarContext all
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Crea videos virales con IA, 100% en tu compu"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Desinstalar ${APP_NAME}.lnk" "$INSTDIR\Desinstalar.exe"

  ; --------------------------------------------------------------------------
  ; 5) DESINSTALADOR + registro en Panel de Control / Apps
  ; --------------------------------------------------------------------------
  DetailPrint "Registrando el desinstalador..."
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName"          "${APP_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion"       "${APP_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher"            "${APP_PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon"          "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout"         "${APP_URL}"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString"      '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  ; EstimatedSize es solo un número informativo en Agregar/quitar programas.
  ; Antes con ${GetSize} se ESCANEABAN los ~43k archivos al final de CADA
  ; instalación (segundos perdidos sin beneficio). Valor fijo ~2.5 GB: instala
  ; más rápido y el número sigue siendo correcto.
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" 2600000

  !insertmacro Estado "FIN"   ; cierra el slideshow
  DetailPrint "¡Listo! ${APP_NAME} quedó instalado en $INSTDIR"
SectionEnd

; Abrir la app SIN permisos de administrador (vía explorer)
Function AbrirApp
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_EXE}"'
FunctionEnd

; ============================================================================
; Desinstalación
; ============================================================================
Section "Uninstall"
  SetDetailsPrint both

  ; Cerrar la app si está corriendo. /T = mata también el ÁRBOL (los hijos
  ; node.exe/python.exe del payload), que si no quedan bloqueando archivos y
  ; el borrado deja miles de archivos sin quitar.
  nsExec::Exec 'taskkill /F /IM ${APP_EXE} /T'
  Pop $0
  Sleep 1500

  ; Accesos directos
  SetShellVarContext all
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  ; La carpeta tiene rutas MUY largas (node_modules/torch) que RMDir no puede
  ; borrar. Truco robocopy: espejar una carpeta vacía la vacía siempre.
  ; OJO: /R:1 /W:1 — sin esto robocopy reintenta 1 millón de veces (30s c/u)
  ; sobre cualquier archivo bloqueado y el desinstalador se cuelga para siempre.
  DetailPrint "Borrando archivos (puede tardar un par de minutos)..."
  CreateDirectory "$TEMP\evs_vacia"
  nsExec::ExecToLog 'robocopy "$TEMP\evs_vacia" "$INSTDIR" /MIR /NFL /NDL /NJH /NJS /R:1 /W:1'
  Pop $0
  RMDir /r "$INSTDIR"
  RMDir "$TEMP\evs_vacia"

  ; Registro
  DeleteRegKey HKLM "${UNINST_KEY}"

  DetailPrint "Listo. Tus videos y renders (fuera de esta carpeta) quedaron intactos."
SectionEnd
