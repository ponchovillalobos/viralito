# Tutorial de uso

> 📚 [Índice de documentación](./README.md) · ¿Sin instalar todavía? → [SETUP.md](./SETUP.md)

Cómo usar el sistema completo paso a paso. Asume que ya hiciste el [SETUP.md](./SETUP.md).

## Arrancar el dashboard

```powershell
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho\frontend"
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm run dev
```

Abrir **http://localhost:3000** en el browser. Vas a ver:

- **Master Plan** — vista panorámica del plan 30 días
- **Instagram / LinkedIn** — dashboards por red (TikTok y Facebook quedaron solo en los datos del plan, no en la nav)
- **Editor** — lista de videos crudos en `raw/`
- **Producción** — proyectos editoriales registrados
- **Mis métricas** — entrada manual de KPIs reales

> Mantené esta terminal abierta. El dashboard corre acá.

## Flujo 1: procesar un video corto (short ≤ 5 min)

### 1.1 Poner el video en raw/

```powershell
copy MiVideo.mp4 C:\viral-data\videos\raw\
```

Idealmente con nombre `D##_slug.mp4` desde el inicio (ej: `D01_prompt_40k.mp4`). Si tu cámara puso un nombre raro, lo renombras desde el dashboard después.

### 1.2 Abrir /editor en el dashboard

Vas a ver el video. Click en el ícono ✏️ para renombrar al estándar `D##_slug` (acepta sólo `a-zA-Z0-9_-`).

### 1.3 Click en la card → entras al workspace

3 columnas:
- **Izquierda**: preview del video con subtítulos en tiempo real
- **Centro**: timeline (placeholder)
- **Derecha**: tabs Meta / Subtítulos / B-roll / Música / FX / Export

### 1.4 Click "Transcribir"

⚠️ La PRIMERA vez tarda ~5-15 min (descarga modelos Whisper ~1.5 GB). Las siguientes son rápidas (~2-3 min para video de 30s).

### 1.5 Click "Detectar silencios"

Tarda ~30 s. Genera el JSON con los segmentos a conservar.

### 1.6 Configurar metadata (tab Meta)

- Día del calendario (1-30)
- Plataformas destino (chips multi-select)
- Caption (manual o lo dejas vacío y se autogenera después)

### 1.7 Configurar subtítulos (tab Subtítulos)

- Fuente: Bebas Neue (default) o Anton (más bold)
- Color base + highlight (color del video)
- Editar palabras transcritas si Whisper se equivocó (común con marcas tipo "ChatGPT")

### 1.8 Buscar B-roll (tab B-roll)

- Buscar términos en Pexels (ej: "laptop typing", "sales meeting")
- Click en card → se agrega al timeline en el `currentTime` del player
- Editar duración manual o eliminar

### 1.9 Música (tab Música)

Opcional. Si tenés MP3 en `C:\viral-data\videos\assets\music\` aparecen acá. Ajustar volumen (default 15%).

### 1.10 Animaciones (tab FX)

- Zoom on hook (3 frames al inicio)
- Glow keyword
- Shake emphasis

Click en los presets en el momento actual del player → se agregan al timestamp.

### 1.11 Render (tab Export)

- Quality: Preview (540×960, ~1 min) o Final (1080×1920, ~3-8 min)
- Click "Renderizar video"
- Cuando termina aparece el reproductor + botón "Descargar MP4"

### 1.12 Output

El MP4 final queda en `C:\viral-data\videos\renders\<id>.mp4`.

## Flujo 1 acelerado: vía CLI (para batch)

Si querés procesar varios videos sin entrar al dashboard, usa los scripts directamente:

```powershell
$env:PATH = "C:\viral-data\tools\ffmpeg-8.1.1-essentials_build\bin;$env:PATH"
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho\python"

# Para cada video
.\venv\Scripts\python.exe transcribe.py D01_tema.mp4
.\venv\Scripts\python.exe detect_silences.py D01_tema.mp4
.\venv\Scripts\python.exe cut_silences.py D01_tema.mp4   # genera D01_tema_cut.mp4
```

Crear proyecto JSON en `C:\viral-data\videos\projects\<id>.json` con la estructura de tu estilo (ver [STYLES.md](./STYLES.md)) y renderizar:

```powershell
cd ..\remotion
node build-props.mjs D01_tema "C:\viral-data\videos\projects\D01_tema_hype_sfx.json"
npx remotion render src/index.ts ViralVideo "C:\viral-data\videos\renders\D01_tema_hype_sfx.mp4" --props=props.json
```

## Flujo 2: procesar un video largo (curso ≥ 30 min)

### 2.1 Poner el video en long_form/raw/

```powershell
copy MiCurso.mp4 C:\viral-data\videos\long_form\raw\D13_curso_principal.mp4
```

Nombre: `D##_curso_<tema>.mp4`. Letras/números/guiones, sin acentos.

### 2.2 Arrancar el pipeline completo

```powershell
$env:PATH = "C:\viral-data\tools\ffmpeg-8.1.1-essentials_build\bin;C:\Program Files\nodejs;$env:PATH"
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho\python"
.\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal --render
```

Esto corre automáticamente:

| Paso | Tiempo (1h video) |
|---|---|
| 1. Transcribe del raw | 20-35 min |
| 2. Detect silences | 30s |
| 3. Cut silences → CLEAN | 5-25 min (depende de cantidad de silencios) |
| 4. Re-transcribe del CLEAN | 15-25 min |
| 5. Ollama analyze (chunked) | 2-10 min |
| 6. Extract 10-15 clips | 1-2 min |
| 7. Render cada clip estilo Supreme | ~4 min × N clips |

**Total: 50-100 min para video de 1h.**

### 2.3 Outputs

Después tendrás:

1. **`long_form/clean/<id>_clean.mp4`** — tu video largo con silencios cortados, sin estilos virales. Ideal para YouTube long form.

2. **`long_form/renders/<id>_cNN_<slug>_supreme.mp4`** — **10-15 clips** de 30-60s con estilo Supreme listos para TikTok/Reels. El techo lo ajusta el pipeline según la duración (≈1 clip cada 5 min, mínimo 15, tope 30); Ollama saca solo los que valen.

3. **`long_form/projects/<id>_cNN_<slug>.json`** — proyecto JSON de cada clip con caption viral generado por Ollama, hashtags, día, plataformas, etc.

### 2.4 Opciones del pipeline

```powershell
# Saltarse el render (solo extraer clips para revisarlos)
.\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal

# Ajustar el techo de clips (default: ~1 cada 5 min, mínimo 15, tope 30).
# Subilo si querés MÁS variantes; bajalo si solo querés los top.
.\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal --render --max-clips 20

# El modelo se autodetecta según el hardware (qwen3:1.7b / 4b / 8b / 14b). Para forzar:
.\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal --render --model qwen3:8b
# Máxima calidad (lento sin GPU): --model gemma4:26b

# Saltar transcribe (si ya tenés el JSON)
.\venv\Scripts\python.exe long_form_pipeline.py D13_curso_principal --skip-transcribe --render
```

## Flujo 3: registrar métricas reales

### 3.1 Publicar el video en redes

**LinkedIn e Instagram** se publican **directo desde Producción** (botones LI / IG) una vez
conectadas las cuentas — ver [SOCIAL_PUBLISHING.md](./SOCIAL_PUBLISHING.md). Para otras redes,
subí el MP4 final a mano.

### 3.2 Anotar las métricas en el dashboard

En el browser, ir a **/metricas** → "Nueva entrada":

- Red: TikTok / Instagram / LinkedIn / Facebook
- Día: 1-30
- Fecha publicación
- Views, Likes, Comments, Shares
- Follows nuevos (opcional)
- Saves (solo IG)
- Notas

Click "Guardar entrada".

### 3.3 Ver gráficas reales

Las gráficas por red muestran tus datos reales (cuando hay entradas) con badge "datos reales" verde. Sin entradas, muestran mock.

### 3.4 Backup

En `/metricas` → "Exportar JSON" descarga un backup. Cuando cambies de máquina, "Importar JSON" lo restaura.

## Flujo 4: ciclo cerrado con pestaña Producción

1. Renderizás un short → aparece su proyecto JSON
2. Vas a **/produccion** → ves todos los proyectos con thumbnail
3. Click "Abrir en editor" para editar/re-renderizar
4. Marcás "publicado" cuando lo subiste
5. Vas a `/metricas` y pegás los KPIs reales

## Atajos útiles

```powershell
# Comandos rápidos en PowerShell

# Listar todos los renders
ls "C:\viral-data\videos\renders\"

# Abrir carpeta de outputs en Explorer
explorer "C:\viral-data\videos\renders"

# Tamaño total ocupado por outputs
"{0:N1} GB" -f ((Get-ChildItem -Recurse "C:\viral-data\videos\renders" | Measure-Object Length -Sum).Sum / 1GB)
```

## Renders importantes para ver

Para entender qué hace cada estilo, ver los videos de ejemplo en `C:\viral-data\videos\renders\`:

- `D01_test_01.mp4` — Estilo **Silent** (subtítulos limpios)
- `D01_test_02.mp4` — Estilo **Punch** (emphasis cards)
- `D01_test_03.mp4` — Estilo **Hype** (PiP + stickers + emojis)
- `D01_test_04.mp4` — Estilo **Hype Max** (+ jump cuts + reaction zooms)
- `D05_test_sfx_hype.mp4` — Estilo **Hype Max SFX** (+ sonidos sutiles)
- `D02-D04_*_punch.mp4` y `D02-D04_*_hype.mp4` — Bloque 1
- `D06-D12_*_hype_sfx.mp4` — Bloque 2 (cada uno con un color distinto)

Ver [STYLES.md](./STYLES.md) para detalles de cada uno.

## Traer un video de YouTube

Los dos asistentes aceptan enlaces: `/editor/wizard` (un video corto) y
`/largos` (un curso del que salen varios clips). El archivo cae en la **misma
carpeta** que si lo subieras a mano, así que desde ahí el pipeline es idéntico —
no hay un "camino de YouTube" aparte que pueda comportarse distinto.

### Varios de una vez

En `/largos` podés pegar **muchos enlaces juntos**, como vengan: uno por línea,
separados por comas, o con texto suelto entre medias. Se bajan **de a uno** y
podés cerrar la pantalla: la cola sigue sola.

De a uno a propósito, no todos a la vez. Bajar en paralelo pelea por el disco y
la red con lo que se esté renderizando, y en este proyecto ya está medido que
dos cosas pesadas a la vez tardan más que una detrás de otra.

No se encola dos veces el mismo enlace —ni dentro de la misma pegada ni contra
lo que ya está esperando—, porque bajar dos horas de video por duplicado no lo
arregla nadie después.

Por consola:

```bash
python descargar_de_url.py <url> --flujo corto           # → raw/
python descargar_de_url.py <url> --flujo largo           # → long_form/raw/
python descargar_de_url.py <url> --flujo largo --id D21_curso_ventas
python descargar_de_url.py <url> --flujo largo --exigir-calidad
```

### Si llega en mala calidad

Pedir "hasta 1080p" **no garantiza 1080p**. Cuando YouTube limita a quien
descarga, sirve formatos degradados y yt-dlp baja el que haya, contento. Pasó:
de una tanda de once videos, nueve llegaron en 640×360 — 224 MB para 110
minutos. El archivo existe, dura lo que debe y abre bien; sólo se ve mal, y no
te enterás hasta ver el render.

Por eso el script **mide** la resolución del archivo y la reporta (`ancho`,
`alto`, `calidad_degradada`). Por debajo de 720p avisa. Con `--exigir-calidad`
además falla y **borra** el archivo, para no dejarte un video malo pareciendo
bueno.

Si te pasa: **esperá un rato y volvé a bajarlo**. La degradación de YouTube pasa
sola. Lo que NO conviene es forzar un cliente concreto (`player_client`): yt-dlp
ya prueba varios y se queda con el que más ofrece, y nombrarle uno a mano es
justo lo que provocó aquellos nueve videos en 360p.

Sin `--id`, el nombre sale del título del video convertido a la convención
`D##_slug`: *"Cómo VENDER más en 2026 | Estrategia #1"* → `D03_como_vender_mas_en_2026_estrategia_1`.

**Se baja en H.264, no en AV1**, aunque YouTube ofrezca AV1 con mejor
compresión. Medido en esta máquina decodificando 30 s del mismo material con
`-hwaccel cuda`:

```
AV1     4436 ms
H.264   1975 ms      2.2x más rápido
```

El audio se pide en **AAC (m4a)**, no en Opus. YouTube sirve Opus por omisión, y
aunque Opus dentro de un MP4 se lee bien —comprobado extrayendo audio y cortando
el video—, dejaría dos formatos distintos entrando al mismo pipeline según de
dónde vino el archivo: AAC si lo grabaste vos, Opus si vino de YouTube. Esa clase
de diferencia no rompe nada hoy y aparece semanas después, en el único paso que
asumía AAC.

La RTX 3060 sí decodifica AV1 por hardware —Ampere lo trae; lo que no tiene es
*codificarlo*— así que no es que AV1 no funcione. Es que el pipeline decodifica
el mismo video muchas veces (transcribir, detectar silencios, extraer clips,
renderizar, re-encodear) y ahí un 2.2× se multiplica. Si no hay H.264
disponible, cae a lo que haya.

Al terminar dice cuánto dura y **si el flujo elegido encaja**: si pediste "corto"
y bajaste 40 minutos, te lo avisa — pero no cambia de flujo por su cuenta.

### Si el video pide iniciar sesión

Guardá las cookies del navegador en `<datos>/cookies/youtube.txt` (formato
Netscape) y volvé a intentar. El mensaje de error ya te dice la ruta exacta.

> **Sobre qué se descarga:** esto baja lo que le pidas. Está pensado para tu
> propio material y para contenido sobre el que tengas derechos, igual que
> cualquier archivo que pongas en `raw/` a mano.

### Un detalle que costó encontrar

yt-dlp necesita **ffmpeg** para unir video y audio, que YouTube sirve por
separado. Desde una consola con ffmpeg en el `PATH` funciona; lanzado por el
servidor, no — y fallaba con *"no pudo bajar el video"* sin mencionar ffmpeg por
ningún lado. Ahora se le pasa la ruta que el proyecto ya resuelve, así que no
depende del `PATH` de quien lo llame.
