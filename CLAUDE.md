# Instrucciones para Claude Code

Este archivo se carga automáticamente al inicio de cada sesión. Contiene contexto crítico para retomar el proyecto sin que tengas que re-explorar.

## Cómo se usa Viralito

**Por la interfaz**, que es el camino real y completo:

| Pantalla | Para qué |
|---|---|
| `/editor/wizard` | un video corto, paso a paso |
| `/largos` | un video largo, del que salen varios clips virales |
| `/produccion` | los videos ya hechos: descripción lista para publicar, y marcar en qué redes los subiste |
| `/metricas` | cómo rindieron |

**Por consola**, para lo que la interfaz no cubre — ver la sección de comandos
más abajo.

> Acá había una tabla de **4 skills en `.claude/skills/`** (`start-dev`,
> `edit-video`, `process-long-form`, `view-renders`) descritas como "el flujo
> principal", con la interfaz relegada a "para quien prefiere UI clickeable".
> Esa carpeta **no existe** y nunca existió en este repo. Un archivo de
> instrucciones que describe un mecanismo inexistente es peor que uno
> incompleto: manda a buscar algo que no está, y hace desconfiar del resto de lo
> que dice. Si algún día se escriben esas skills, esta sección vuelve — con los
> archivos.

## Propósito del proyecto

**Estrategia Viral Poncho** — sistema completo de planificación + edición + publicación de contenido viral para redes sociales (TikTok, Instagram, LinkedIn, Facebook). Nicho: comunicación + ventas + IA, audiencia hispanohablante.

3 grandes módulos:
1. **Dashboard** (Next.js): planificación 30 días + métricas
2. **Editor de shorts**: video corto → MP4 final con subs animados, B-roll, SFX, etc.
3. **Long form pipeline**: video largo (1h) → 1 MP4 limpio + 5-7 clips virales

## Arrancar dev server

El dashboard **arranca automáticamente al iniciar sesión de Windows** (autostart registrado en Task Scheduler). Si necesitás arrancarlo manualmente o no funciona:

```powershell
# Opción A: con el script (más limpio, abre el browser solo).
# Es portable: resuelve su propia ubicación, así que corre desde donde esté el clon.
.\start-dashboard.ps1

# Opción B: manual, desde la raíz del repo
cd frontend
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm run dev
# → http://localhost:3000
```

> Estos comandos llevaban una ruta absoluta a
> `C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho`, que es
> otra máquina y otro proyecto. El script en sí siempre fue portable (resuelve
> su propia ubicación); lo que no funcionaba era el `cd` de la documentación.

Ver `docs/AUTOSTART.md` para configuración del autostart.

## Convenciones críticas

### Naming de archivos

- **Shorts**: `D##_slug.mp4` (ej: `D01_prompt_40k.mp4`)
- **Proyectos**: `D##_slug_<estilo>.json` (ej: `D01_prompt_40k_hype_sfx.json`)
- **Long form raw**: `D##_curso_<tema>.mp4`
- **Clips de long form**: `D##_curso_<tema>_c##_<slug-del-clip>.mp4`

Solo caracteres `[a-zA-Z0-9_-]`. NO espacios, NO acentos.

### 25 estilos visuales disponibles

No los listes acá. La fuente de verdad es `frontend/src/lib/style-registry.data.json`,
y el union `StyleId` sale de `STYLE_IDS` en `style-registry.ts`. Esta sección tenía
una lista escrita a mano que se quedó en 23 (le faltaban `vhs` y `audiogram`), igual
que las copias del tipo que había en los dos asistentes. Toda lista paralela del
catálogo termina desactualizada; el test `estilos-alcanzables.test.ts` cuida que
cada estilo del registro tenga puerta de entrada en algún asistente.

`silent`, `punch`, `hype`, `hype_max`, `hype_max_sfx` (+ `supreme` para clips de long_form). Ver `docs/STYLES.md`. Fuente de verdad del catálogo: `frontend/src/lib/style-registry.data.json`.

Para un short nuevo, default = `hype_max_sfx`.

### Subtítulos siempre visibles

NUNCA ocultar los subtítulos cuando aparece un sticker. Eliminado en commit reciente porque el usuario lo pidió explícitamente. Si volves a ocultarlos, romperás la regla.

### Stickers SIEMPRE top-center

Los `wordStickers` se renderizan SIEMPRE en `top: 180px, center horizontal` independiente del `position` que diga el JSON. Es una regla del composition para evitar cortes en los bordes.

### Mono-color por video

Cada short debe usar UN solo `accentColor` para sticker bg, highlight, vignette glow, border PiP. No mezclar colores ("chile mole y pozole" = mal).

### Caption viral

Para clips del long_form, Ollama genera caption + hashtags automáticamente. Para shorts manuales, el caption se escribe en el campo `caption` del proyecto JSON.

## Estructura de carpetas crítica

**Repo** (el proyecto se llama `viralito/`; el nombre viejo
`Estrategia_Viral_Poncho/` era de otro clon):
```
viralito/
├── frontend/        # Next.js dashboard
├── remotion/        # Composición de video
├── python/          # Scripts IA (venv aislado)
├── desktop/         # wrapper Tauri (el instalador se compila en GitHub Actions)
├── mcp/             # servidor MCP propio
├── docs/            # Documentación
└── *.md             # README, este archivo, etc.
```

**Datos del usuario** (no en el repo). La ruta de abajo es la que el proyecto
busca **por omisión**; cuál se usa de verdad lo decide `VIRAL_DATA_ROOT` en
`frontend/.env.local`, y en esta máquina apunta a `D:\viral-data\`:
```
C:\viral-data\
├── tools\ffmpeg-*\
└── videos\
    ├── raw\, transcripts\, cuts\, renders\, projects\
    ├── assets\{broll,music,sfx\{source,curated\}}
    └── long_form\{raw,transcripts,cuts,clean,proposals,clips,projects,renders}
```

## Comandos clave

```powershell
# Procesar un short manualmente vía CLI
cd python
$env:PATH = "C:\viral-data\tools\ffmpeg-8.1.1-essentials_build\bin;$env:PATH"
.\venv\Scripts\python.exe transcribe.py D##_slug.mp4
.\venv\Scripts\python.exe detect_silences.py D##_slug.mp4
.\venv\Scripts\python.exe cut_silences.py D##_slug.mp4

# Procesar un video largo end-to-end
.\venv\Scripts\python.exe long_form_pipeline.py D##_curso_<tema> --render

# Render con Remotion (después de crear el proyecto JSON)
cd remotion
node build-props.mjs <video_id> "<path al proyecto JSON>"
npx remotion render src/index.ts ViralVideo "C:\viral-data\videos\renders\<id>.mp4" --props=props.json
```

## Decisiones técnicas no negociables

1. **Cero costo recurrente**: nada de OpenAI/Claude API si Ollama puede hacerlo
2. **Open source**: todo el stack en CC0/MIT/BSD
3. **Mono-color por video**: regla viral del usuario
4. **Subtítulos siempre visibles**: regla del usuario
5. **Stickers solo top-center**: para no cortarse
6. **Sin emojis al inicio del caption**: regla viral del usuario
7. **Hashtags en español sin acentos**: regla del usuario

## Flujo típico de una sesión

1. Usuario manda video(s) crudos → pegarlos en `raw/` o `long_form/raw/`
2. Renombrar a convención `D##_slug`
3. Procesar (transcribe → detect → cut → analyze si es long_form)
4. Crear proyecto JSON con el estilo elegido
5. Render con Remotion
6. Abrir el MP4 final con `Start-Process`
7. Si el usuario aprueba, hacer commit / push opcional

## Pitfalls comunes

- **No `<button>` dentro de `<button>`** en React (causa hydration error). Day cards usan `<div role="button">`
- **lucide-react NO tiene íconos de marca** (Facebook, Instagram, Linkedin). Usar genéricos
- **Recharts tooltip**: el tipo de `formatter` debe aceptar `(v) =>` no `(v: number) =>`
- **ffmpeg filter_complex muy largo en Windows**: si >100 segmentos usar concat demuxer
- **WhisperX en transcripts >15 min**: chunking obligatorio para que Ollama no se sature
- **OneDrive locks files**: si Next.js hot reload no funciona, mover proyecto fuera de OneDrive
- **Stickers SIEMPRE top-center**: ignorar el `position` del JSON viejo
- **Fuentes del render = TTF LOCALES, NUNCA `@remotion/google-fonts`**: cargar fuentes por red (gstatic) rompe el render offline y aborta CUALQUIER estilo sin internet (fue la causa raíz de "los videos no salían"). Agregar fuentes vía `python/download_fonts.py` (baja 43 TTF OFL/Apache → `remotion/public/fonts`) + registrarlas con el helper `F` de `remotion/src/layers/local-editorial-fonts.ts`. Ese loader es **LAZY**: `new FontFace(...)` + `document.fonts.add(face)` **SIN `.load()`** → el browser baja la fuente sólo cuando un glyph la usa. NO usa `delayRender` (bajo render concurrente de largos una `delayRender` por fuente se quedaba sin limpiar → Remotion abortaba el clip con `delayRender ... not cleared after 58000ms`; el `setTimeout` NO sirve porque Remotion controla los timers del render). NO usa `@remotion/fonts.loadFont` (hace `cancelRender` en fallo) ni `@remotion/google-fonts` (carga a nivel de módulo desde gstatic). Si una fuente falta → cae a la del sistema, nunca aborta.

## Estado actual del proyecto

Documentado en `README.md`. Resumen:

- ✅ Dashboard funcional con 8 rutas
- ✅ 25 estilos visuales implementados y **los 25 elegibles** desde los asistentes. `supreme` aparece en las dos listas Y además el pipeline de largos se lo asigna solo a cada clip (la doc decía antes que era sólo automático: era falso). `editorial_full` = editorial a pantalla completa en horizontal; los estilos editoriales usan panel (video + texto/ilustraciones al costado) en V y H
  - Nuevos: `cine_clasico` (cine antiguo: voz a radio vieja + B&W + máquina de escribir/proyector en los picos del director emocional), `editorial_broll` (Editorial + B-roll Pexels en cortinillas), `kinetic_type`, `lottie_pop`, `paper_cut`
  - El estilo `editorial` tiene **20** temas editoriales (nuevos: `art_deco`, `blueprint`,
    `noir`). Fuente de verdad: `frontend/src/lib/editorial-themes.ts` — estaban escritos
    dos veces, uno por wizard, y la copia de largos ya había perdido el campo `hint`
- ✅ Pipeline shorts: transcribe + cuts + render
- ✅ Pipeline long form: transcribe + cuts + analyze + extract + render
- ✅ 16 SFX CC0 curados (incluye `typewriter.wav` y `film_reel.wav` para `cine_clasico`)
- ✅ Pexels integrado
- ✅ 17 videos renderizados (D01-D12 + clips de D13)
- ✅ **Render 100% offline**: fuentes editoriales horneadas a TTF locales (lazy load, sin red en render) — ver pitfall de fuentes arriba
- ✅ **Cola reanudable**: los jobs que quedaron SOLO en cola (nunca arrancaron) sobreviven un reinicio de la app — el panel de tareas los re-encola vía `POST /api/jobs/resume` (cada store persiste su `request` y marca `resumable`). Un render a medias NO se reanuda (se relanza a mano)
- ✅ **"Mis videos" (Producción)** muestra SOLO videos con render reproducible (>100 KB; los renders rotos/truncados quedan ocultos y reaparecen al re-generar — filtro en `frontend/src/lib/orphan-sweep.ts` → `/api/projects`). Las variantes de estilo del MISMO clip (ej. `..._editorial` + `..._supreme`) se AGRUPAN en una sola tarjeta con chips (`production-list.tsx`, agrupa por base-id quitando el sufijo `_{styleId}`)
- ✅ **Pipeline largos resiliente**: export incremental (cada render se escribe a disco al terminar) + SKIP de clips ya renderizados al re-correr (default; `VIRAL_FORCE_RENDER=1` fuerza regenerar TODO). El resumen JSON final reporta `rendered` / `render_tasks` / `render_failed`
- ✅ **Wizards** con barra de navegación FIJA al fondo (`fixed inset-x-0 bottom-0`, "Siguiente" siempre visible). El flujo recorre los pasos y un solo "Crear" final hace todo. En largos: "Crear todos los videos" (modo `full`, un jalón) o "revisar los momentos antes" (modo `analyze`, 2 pasos)
- ✅ **Provider de clips/caption offline-aware**: `analyze_clips.py` y `generate_caption.py` chequean DNS (`_online()`); offline van DIRECTO a Ollama local en vez de colgarse intentando el provider OAuth (claude/codex)
- ⏳ Pendiente opcional: skills `.claude` para invocar pipeline desde Claude Code

## Rendimiento: qué está medido y qué lo gobierna

Los números salen de la bitácora (`python/ver_bitacora.py`) y de `nvidia-smi`, no
de estimaciones. Medidos el 24 ago 2026 en la máquina de desarrollo (RTX 3060
Laptop 6 GB, Ryzen 5 5600H, 28 GB RAM).

**Dónde se va el tiempo** (suma de 3 ejecuciones de largos):

| etapa | % del total | media |
|---|---|---|
| analizar_clips | 67.8 % | 531 s |
| extraer_clips | 21.0 % | 493 s |
| transcribe | 11.2 % | 87 s |

**Transcripción en GPU.** `bootstrap.ps1` instalaba siempre el PyTorch de CPU, así
que ninguna máquina con GPU la usaba y nada avisaba. Ahora detecta la placa e
instala el índice CUDA. Un video de 98.9 min: **~36 min → 174.9 s**, y encima con
`large-v3` en vez de `small`.

**La memoria se administra por etapa.** Ollama mantiene el modelo cargado unos
minutos tras la última llamada — correcto mientras se analiza, un problema
después. Retenía 4.7 GB de VRAM y 2.75 GB de RAM durante todo el render. Se
libera explícitamente antes de extraer clips y antes de renderizar, en los dos
pipelines. Regla general: **cada etapa sostiene sólo lo que necesita y suelta
antes de entregar el turno.**

**Se paraleliza lo que ESPERA, no lo que calcula.** El análisis de clips va hasta
4 trozos en vuelo cuando el proveedor es una CLI de red (claude/codex), porque
ahí el equipo espera. Con Ollama sigue secuencial a propósito: es un servidor
local sobre una sola placa de 6 GB, y lanzar varias no las acelera, las encola.

**Aceleración por GPU del render (`chromium_gl=angle`): ENCENDIDA.** Estuvo
apagada con un motivo válido —posible diferencia de píxel, sin prueba que lo
descartara— hasta que la prueba se escribió (`python/probar_paridad_gl.py`).
Sobre un clip real de 41 s:

```
por software     123.3 s
con la placa      64.8 s     47.5 % más rápido
PSNR medio       43.65 dB
control sw↔sw    49.37 dB de media, 33.19 dB de mínimo
```

El control importa: el render **no es determinista**, así que el peor fotograma
con la placa (31.86 dB) queda en el piso de ruido del propio motor. Para apagarla
sin tocar código: `VIRAL_REMOTION_GL=off`.

**Segunda medición (27 ago 2026), sobre un proyecto real y pesado** —
`pop_reels`, 44 s, con todos los efectos encendidos. La primera se hizo sobre un
clip liviano; ésta se hizo sobre lo que la máquina renderiza de verdad:

```
por software     945.4 s     35.3 MB
con la placa     377.4 s     35.2 MB     60.1 % más rápido
PSNR medio        40.56 dB
PSNR mínimo       37.43 dB
```

El número que decide es el **mínimo**: 37.43 dB, por encima del peor fotograma
del control software↔software (33.19 dB). La diferencia que introduce la placa
es *menor que la que el motor introduce contra sí mismo*. Queda encendida.

La mejora crece con el peso del proyecto (47.5 % en el clip liviano, 60.1 % en
éste), que es lo esperable: cuanto más dibuja el navegador, más se nota quién
dibuja.

**Cuidado con la tabla de arriba: son porcentajes de LO MEDIDO, no del total.**
Hasta el 25 ago la bitácora sólo instrumentaba cuatro etapas. En la única corrida
histórica con render, lo no medido —gráficos, render, LUT, mastering, re-encode,
normalización— fue el **69.8 % del tiempo total** (1744 de 2499 s). Ya están
instrumentadas las seis etapas; las corridas nuevas sí reflejan el total.

**Sobre la concurrencia del render.** Esta sección afirmaba que subirla no
ayudaría, deduciéndolo de ver el procesador al 100 %. Medido después sobre un
clip real: `--concurrency 3` (el valor que calcula `hw_profile` hoy) tarda
131.7 s y `--concurrency 6` tarda **107.8 s, un 18 % menos**. La deducción era
incorrecta. Antes de cambiar la fórmula falta repetir el barrido con el *pool*
de `render-server.mjs`, que es el camino real de producción — la medición se hizo
con el CLI directo, que re-empaqueta en cada corrida.

**Lo que sí está medido sobre correr cosas en paralelo:** un render de Remotion
tardó **20.6× más** (266 s → 5492 s) al competir con una generación de Ollama.
El render no usa VRAM (69 MB durante toda la corrida): la contención es de
procesador. Por eso la cola es serial por omisión, y por eso subir
`VIRAL_MAX_CONCURRENT_JOBS` sin planificar por etapa puede ser catastrófico y no
sólo "algo más lento".

## Antes de hacer cambios al composition (`remotion/src/ViralVideo.tsx`)

Es el archivo más delicado del proyecto. Reglas:

1. NO romper subtítulos siempre visibles
2. NO mover stickers de top-center
3. NO sacar el `objectFit: cover` del rawVideo (sin él, videos horizontales quedan letterbox feo)
4. NO cambiar `wordStickerSchema` sin update de `build-props.mjs` y `build-clip-supreme.mjs`
5. Si agregás props nuevos: defaultProps + schema + build-props update + documentar en STYLES.md
6. **Un prop nuevo son CINCO eslabones, no dos.** Lo vigila
   `check-campos-alcanzables.mjs`, dentro de `npm test`: recorre los 56 campos
   del composition y exige que alguien los **escriba**, no que alguien los
   reenvíe. Los `build-*.mjs` reenvían todo, así que mirarlos a ellos no delata
   nada — es lo que dejó pasar cuatro efectos inalcanzables en un día. Quien lo escribe, el tipo que
   lo declara, `build-props.mjs` (shorts), `build-clip-props.mjs` (largos) y el
   composition que lo aplica. Saltarse un builder no rompe nada: el composition
   recibe el default vacío y el efecto no existe, sin un solo error. Pasó con
   `freezeMarks`. Si el prop lo elige un modelo local, hay un sexto eslabón — la
   lista dentro del prompt — y pasó con `escala_medida`. Cablealo entero y
   dejale un test que recorra la cadena (`congelado-cableado.test.ts`,
   `transiciones-alcanzables.test.ts` son los dos ejemplos).

## Referencias

- `README.md` — overview general
- `docs/SETUP.md` — instalación
- `docs/USAGE.md` — tutorial
- `docs/ARCHITECTURE.md` — técnica
- `docs/STYLES.md` — los estilos (25) + los énfasis que se aplican sobre cualquiera
- `docs/TROUBLESHOOTING.md` — errores comunes
