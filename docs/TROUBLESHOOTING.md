# Troubleshooting

> 📚 [Índice de documentación](./README.md) · [Setup](./SETUP.md) · [Uso](./USAGE.md)

Errores comunes y cómo solucionarlos. Si encuentras uno nuevo, agregalo acá.

## El dashboard no arranca

### `node : El término 'node' no se reconoce`

Node.js no está en el PATH. Soluciones:

```powershell
# Opción A: agregar al PATH solo para esta sesión
$env:PATH = "C:\Program Files\nodejs;$env:PATH"

# Opción B: agregar permanentemente
[Environment]::SetEnvironmentVariable("Path", "$env:PATH;C:\Program Files\nodejs", "User")
# después abrir terminal nueva
```

### `npm install` falla

```
npm error peer zod@"4.x" from @remotion/zod-types@4.0.x
```

Es un conflict de peer dependency. Solución:

```powershell
npm install --legacy-peer-deps
```

O actualizar `zod` a v4 en `package.json`:

```json
{
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

### Hot reload no funciona

Si el proyecto está dentro de OneDrive, el file watcher puede no detectar cambios. Solución:

En `frontend/next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  experimental: {
    // En Next 16 esto NO existe; comentar si te lo pide
    // watchOptions: { pollIntervalMs: 1000 }
  },
};
```

Alternativa: mover el proyecto a `C:\Code\Estrategia_Viral_Poncho\` (fuera de OneDrive).

## El editor falla

### `<button> dentro de <button>` (hydration error)

Solucionado en commit reciente. Si lo ves de nuevo, asegurar que `day-card.tsx` usa `<div role="button">` y NO `<button>` envolviendo a `<CopyButton>`.

### `Export Facebook doesn't exist in lucide-react`

Lucide-react quitó los íconos de marca en versiones recientes. Usar iconos genéricos:

```typescript
import { Music2, Camera, Briefcase, Users } from "lucide-react";
// NO importar: Facebook, Instagram, Linkedin (no existen)
```

### `Type error: ValueType | undefined no es asignable a number`

En el tooltip de Recharts. Cambiar:

```typescript
formatter={(v: number) => [v.toLocaleString("es"), "views"]}
// →
formatter={(v) => [Number(v).toLocaleString("es"), "views"]}
```

## Python falla

### `RuntimeError: sox extension is not supported on Windows`

silero-vad intenta usar torchaudio.sox que no funciona en Windows. Solución: el script `detect_silences.py` ya está adaptado para leer WAV con `wave` + numpy. Si tu copia es vieja, actualizar.

### `Could not load libtorchcodec`

Warning de pyannote/whisperx. Es **ignorable** — Whisper usa otro backend internamente y funciona igual.

### `FileNotFoundError: WinError 206 (filename or extension too long)`

ffmpeg con muchos segmentos para cortar (>200). El script `cut_silences.py` ya tiene fallback automático: si >100 segmentos, usa concat demuxer en vez de filter_complex. Si lo ves de nuevo, verificar que tu copia es la actualizada.

### `whisperx no se encuentra`

El venv no está activado. Verificar:

```powershell
.\venv\Scripts\Activate.ps1
# El prompt debe mostrar (venv)
```

Si Activate.ps1 da error de "execution policy":

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
# Y volver a intentar
```

### Whisper transcribe MUY mal

Si el video tiene mucho ruido o el speaker no es claro, modelo `small` puede confundir palabras. Soluciones:

```powershell
# A. Usar modelo medium (mejor calidad, más lento)
# Editar python/config.py:
WHISPER_MODEL = "medium"

# B. Editar manualmente el transcript en el dashboard tab Subtítulos antes de renderizar
```

## Remotion falla al renderizar

### `Bundling 6%` se queda colgado

A veces Remotion tarda en bundlear cuando hay deps nuevas. Esperar 1-2 min. Si pasa de 3 min, matar el proceso y relanzar.

### `Chrome Headless Shell download fail`

La primera vez Remotion baja Chrome Headless (~113 MB). Si falla por red, reintentar con conexión estable. Una vez bajado, no se vuelve a bajar.

### Render produce video corrupto o pantalla negra

Verificar:

1. **dev server está corriendo**: Remotion necesita que `localhost:3000` responda para servir el video raw y SFX vía API
2. **El rawVideoUrl es correcto**: revisar `remotion/props.json` — debe apuntar a `http://localhost:3000/api/...`
3. **El video raw existe**: en `C:\viral-data\videos\raw\<id>.mp4`

### `--props` is too long

Mismo error de comandos largos. Solución (ya implementada): el JSON se escribe a `remotion/props.json` y se pasa como `--props=props.json` (referenciando archivo, no inline).

### El render falla sin internet (`ERR_NAME_NOT_RESOLVED` / `fonts.gstatic.com`)

**Arreglado** (jun 2026). Antes el render bajaba ~24 tipografías de `fonts.gstatic.com`
en CADA corrida (vía `@remotion/google-fonts`); sin internet abortaba con
`Failed to load resource: net::ERR_NAME_NOT_RESOLVED` y el video "no salía" — y como
esas fuentes se importaban siempre, fallaba **cualquier estilo**, no solo los editoriales.
Ahora las fuentes se hornean a TTF locales (`remotion/public/fonts`, pobladas por
`python/download_fonts.py`) y se cargan con `staticFile` → **el render funciona 100%
offline**. Si una fuente faltara, cae a la del sistema en vez de abortar.

```powershell
# Re-bajar las fuentes locales (idempotente; necesita internet UNA vez)
cd python
.\venv\Scripts\python.exe download_fonts.py
```

Detalle técnico: `@remotion/fonts.loadFont` hace `cancelRender` si la fuente falla; el
loader propio en `remotion/src/layers/local-editorial-fonts.ts` usa `continueRender` en
el error → nunca aborta el render por una fuente.

## Pipeline long_form falla

### Ollama devuelve `{"clips": []}`

El transcript es muy largo y satura el contexto del modelo. Soluciones:

1. **Usar chunking** (ya implementado): `analyze_clips.py` divide automáticamente videos >15 min en chunks de 12 min
2. **Usar modelo más grande**:
   ```powershell
   .\venv\Scripts\python.exe long_form_pipeline.py D13_curso --render --model gemma4:26b
   ```
3. **Borrar proposal vacío y reintentar**:
   ```powershell
   Remove-Item "C:\viral-data\videos\long_form\proposals\D13_curso.json"
   .\venv\Scripts\python.exe long_form_pipeline.py D13_curso --render
   ```

### Ollama no responde

Verificar:

```powershell
curl http://localhost:11434/api/tags
```

Si no responde:
- Reiniciar Ollama desde el system tray
- Verificar que el modelo está instalado: `ollama list`
- Pull de nuevo: `ollama pull qwen3:1.7b`

### "Terminó pero faltan clips"

El pipeline ahora reporta los clips **realmente renderizados** (no solo los extraídos):
emite `rendered` / `render_tasks` / `render_failed` en el resumen final, y si algún clip
falla al renderizar, el panel avisa "X de Y clips se renderizaron — Z fallaron" en vez de
decir "listo" liso. Revisá el log del job (líneas `[fail] render clip …`) y volvé a generar
los faltantes.

### Extract clips produce MP4 muy chico (1-2 KB)

ffmpeg falló al extraer el rango. Posibles causas:

- El timestamp del clip está fuera del video CLEAN (verificar duraciones)
- Codec issue (HEVC source → forzar h264)

Solución: borrar el clip JSON específico, ajustar el rango, re-correr extract_clips.

### Re-transcribir tarda demasiado

Para video de 1h tarda 15-25 min. Si quieres skipear esa parte en futuros runs, el marker `.from_clean` se crea automáticamente. Para forzar re-transcribe:

```powershell
Remove-Item "C:\viral-data\videos\long_form\transcripts\D13_curso.from_clean"
```

## "Edité varios videos y no salieron" / la cola se pierde al reiniciar

Dos causas, ambas arregladas (jun 2026):

1. **Falla de fuentes sin internet** — ver arriba [«El render falla sin internet»](#el-render-falla-sin-internet-err_name_not_resolved--fontsgstaticcom). Era la causa #1: offline, cualquier estilo abortaba.
2. **La cola se perdía al reiniciar la app.** La cola vive en memoria; antes un reinicio
   (cierre/reapertura del desktop, recompilación, crash) marcaba los videos **encolados**
   como "se interrumpió porque la app se reinició" y NO los re-corría. Ahora cada job
   persiste su configuración (`request`) y, al reabrir la app, los que quedaron **solo en
   cola** (nunca arrancaron) **se reanudan solos** — lo dispara el panel de tareas vía
   `POST /api/jobs/resume`. Un render a medias NO se reanuda (no es seguro retomarlo); ese
   se relanza a mano desde el wizard.

> Nota: los jobs que ya habían fallado *antes* de este arreglo no tienen la config guardada
> → no se auto-reanudan. Relanzá esos una vez desde el wizard.

## Pexels no devuelve resultados

### API key inválida

Verificar que `frontend/.env.local` tiene `PEXELS_API_KEY=<tu-key>` sin espacios. Reiniciar el dev server después de cambiarla.

### Rate limit (200 req/h)

Si saturás el límite (raro), esperar 1 hora o cachear búsquedas comunes. El error responde con HTTP 429.

## El video PiP se ve mal

### B-roll cortado en el PiP

Solucionado en commit reciente: cuadro 540×720 vertical con `objectFit: contain`. Si lo ves cortado, verificar `ViralVideo.tsx` línea de `PipBRollLayer`.

### Letterbox feo en video horizontal source

El composition usa `objectFit: cover` por defecto para center-crop horizontal → 9:16. Si querés mantener todo el frame:

```tsx
{rawVideoUrl && (
  <OffthreadVideo
    src={rawVideoUrl}
    style={{ width: "100%", height: "100%", objectFit: "contain" }}
  />
)}
```

## El dashboard muestra mock en vez de datos reales

### `/metricas` está vacío

Necesitas agregar entradas manualmente. La primera vez que pegas una entrada para una red, las gráficas de esa red empiezan a mostrar "datos reales" (badge verde).

Si las habías agregado y desaparecieron:
- Verificar localStorage no se haya borrado por limpieza del navegador
- Re-importar desde el JSON de backup (Mis métricas → Importar JSON)

### Las stats cards no se actualizan

Hard refresh el navegador (Ctrl+Shift+R). El componente usa estado local + custom event.

## Performance

### Render Remotion muy lento

- Cerrar otras apps pesadas durante el render
- Usar preset Preview para iteración (540×960, ~4x más rápido)
- Solo usar Final cuando estás conforme con el resultado

### Transcribir tarda mucho

WhisperX en CPU usa todos los cores. Si tu PC es lenta, considerar:
- Modelo `tiny` o `base` (más rápido, menos preciso)
- GPU NVIDIA con CUDA (requiere reinstalar torch con CUDA)

### npm install muy lento

- Verificar que no estás detrás de un proxy corporativo
- Cambiar registry: `npm config set registry https://registry.npmjs.org/`

## Datos / backup

### Perdí mis renders

Los renders están en `C:\viral-data\videos\renders\` y `long_form/renders/`. Esos archivos NO están en el repo. Hacer backup periódico:

```powershell
Compress-Archive -Path "C:\viral-data\videos\renders" -DestinationPath "$env:USERPROFILE\Desktop\renders-backup-$(Get-Date -Format yyyy-MM-dd).zip"
```

### Quiero reset total

```powershell
# CUIDADO: borra TODO lo procesado
Remove-Item -Recurse -Force "C:\viral-data\videos\transcripts"
Remove-Item -Recurse -Force "C:\viral-data\videos\cuts"
Remove-Item -Recurse -Force "C:\viral-data\videos\renders"
Remove-Item -Recurse -Force "C:\viral-data\videos\projects"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\clean"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\transcripts"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\cuts"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\proposals"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\clips"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\projects"
Remove-Item -Recurse -Force "C:\viral-data\videos\long_form\renders"
# Volver a crear las carpetas (ver SETUP.md)
```

## Video largo: salen MUY pocos clips (3-4 en vez de 10-15)

El prompt de análisis ahora pide **entre 10 y 15 clips** (techo dinámico ≈1 cada 5 min,
mínimo 15, tope 30) y recorre todo el video, no solo el arranque. Si aun así salen pocos:

- **Es un video corto** (< 15 min): hay menos material; es normal sacar menos.
- **El modelo Ollama es demasiado chico.** El modelo se **autodetecta según el hardware**
  (`hw_profile.py`): qwen3:1.7b (RAM baja) → qwen3:4b (≥16 GB) → **qwen3:8b** (CPU fuerte
  con ≥24 GB, o GPU) → qwen3:14b (≥16 GB VRAM). En una máquina sin GPU pero con buen CPU
  y 32 GB, ahora elige **qwen3:8b** solo. Si querés forzar otro:
  ```powershell
  # Borrá el análisis viejo para forzar regenerar
  Remove-Item "C:\hermes-data\videos\long_form\proposals\D13_curso_principal.json"
  # Balance recomendado en CPU:
  .\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal --render --model qwen3:8b --skip-transcribe
  # Máxima calidad (lento sin GPU, ~3-5h en un video de varias horas):
  .\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal --render --model gemma4:26b --skip-transcribe
  ```
- **Forzá más candidatos**: subí el techo con `--max-clips 20`.

## No suena la música / siempre suena la misma

La música **no se versiona en GitHub** (los `.mp3` están en `.gitignore` — son cientos de
MB). Viven en `C:\hermes-data\videos\assets\music` (o `C:\viral-data\...` según tu setup).

- **No hay música en ningún render** → la carpeta está vacía. Descargá la biblioteca CC0:
  ```powershell
  cd python
  .\venv\Scripts\python.exe github_music.py            # FreePD / SoundSafari (CC0)
  .\venv\Scripts\python.exe download_music_library.py  # Incompetech + Chosic
  .\venv\Scripts\python.exe download_lofi_music.py     # open-lofi (166 tracks)
  ```
- **Suena, pero no pega con el tono del video** → era un bug de mapeo: el director
  emocional emite los moods `hype / tension / inspirador / chill / epico`, pero los
  archivos se llaman `-energetic-`, `-epic-`, `-calm-`, `-lofi-`… Antes 3 de 5 moods no
  matcheaban nada y la pista salía al azar. Ya está arreglado con un mapa de alias en
  `pickRandomMusicTrack` (`frontend/src/lib/style-templates.ts`).

## Subir un video grande falla / se trunca

Los topes de subida se elevaron: **16 GB** shorts, **64 GB** largos (server) y **8 GB** en
el navegador. Pero subir por HTTP **buffea el archivo entero en RAM**, así que un video
enorme (HEVC de 2h+, decenas de GB) puede reventar la memoria igual. Para esos usá
**«Importar por ruta»** en el wizard de largos (o `/api/long_form/import-path`): copia/
hardlink por filesystem, sin pasar por HTTP ni RAM, **sin límite de tamaño**.

## Reportar bugs

Si encontrás un error nuevo:

1. Capturar el output completo del comando que falló
2. Copiar la línea exacta del error
3. Agregarlo a este archivo con la solución (cuando la encuentres)

Para diagnosticar:

```powershell
# Ver últimos errores en background tasks
Get-ChildItem "$env:LOCALAPPDATA\Temp\claude\*\tasks\*.output" -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 5

# Ver logs de Next.js
# (corren en la terminal donde lanzaste npm run dev)
```
