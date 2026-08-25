# Instrucciones para Claude Code

Este archivo se carga automáticamente al inicio de cada sesión. Contiene contexto crítico para retomar el proyecto sin que tengas que re-explorar.

## 🤖 Skills disponibles (dialogo conversacional)

El usuario prefiere trabajar **conversacionalmente con Claude**. Hay 4 skills en `.claude/skills/`:

| Skill | Cuándo invocar |
|---|---|
| **start-dev** | "arrancá", "encendé el dashboard", inicio de sesión, antes de renderizar |
| **edit-video** | "editá este video", "hacé un short de X", "generá un clip viral con estilo Y", "comparame 2 estilos del mismo video" |
| **process-long-form** | "procesá este curso", "extraé clips del video largo", videos de 30+ min |
| **view-renders** | "qué tengo listo", "abrí el D04", "mostrá los renders" |

**Cuando el user describe una intención, mapeá a la skill y seguila al pie de la letra**. Cada skill tiene instrucciones detalladas, comandos exactos y manejo de errores.

Hay TAMBIÉN un wizard del portal en `/editor/wizard` para usuarios que prefieren UI clickeable. Pero el flujo principal es por chat con vos.

## Propósito del proyecto

**Estrategia Viral Poncho** — sistema completo de planificación + edición + publicación de contenido viral para redes sociales (TikTok, Instagram, LinkedIn, Facebook). Nicho: comunicación + ventas + IA, audiencia hispanohablante.

3 grandes módulos:
1. **Dashboard** (Next.js): planificación 30 días + métricas
2. **Editor de shorts**: video corto → MP4 final con subs animados, B-roll, SFX, etc.
3. **Long form pipeline**: video largo (1h) → 1 MP4 limpio + 5-7 clips virales

## Arrancar dev server

El dashboard **arranca automáticamente al iniciar sesión de Windows** (autostart registrado en Task Scheduler). Si necesitás arrancarlo manualmente o no funciona:

```powershell
# Opción A: con el script (más limpio, abre browser solo)
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho"
.\start-dashboard.ps1

# Opción B: manual
cd "C:\Users\Poncho Robles\OneDrive\Documentos\Estrategia_Viral_Poncho\frontend"
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
npm run dev
# → http://localhost:3000
```

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

**Repo**:
```
Estrategia_Viral_Poncho/
├── frontend/        # Next.js dashboard
├── remotion/        # Composición de video
├── python/          # Scripts IA (venv aislado)
├── docs/            # Documentación
└── *.md             # README, este archivo, etc.
```

**Datos del usuario** (no en el repo):
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
  - El estilo `editorial` tiene 17 temas editoriales (nuevos: `art_deco`, `blueprint`, `noir`)
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

## Antes de hacer cambios al composition (`remotion/src/ViralVideo.tsx`)

Es el archivo más delicado del proyecto. Reglas:

1. NO romper subtítulos siempre visibles
2. NO mover stickers de top-center
3. NO sacar el `objectFit: cover` del rawVideo (sin él, videos horizontales quedan letterbox feo)
4. NO cambiar `wordStickerSchema` sin update de `build-props.mjs` y `build-clip-supreme.mjs`
5. Si agregás props nuevos: defaultProps + schema + build-props update + documentar en STYLES.md

## Referencias

- `README.md` — overview general
- `docs/SETUP.md` — instalación
- `docs/USAGE.md` — tutorial
- `docs/ARCHITECTURE.md` — técnica
- `docs/STYLES.md` — los estilos (23 en total)
- `docs/TROUBLESHOOTING.md` — errores comunes
