# Arquitectura técnica

## Stack completo

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 16 + React 19 + shadcn/ui + Recharts)        │
│  Puerto 3000                                                    │
│  - Master Plan + 4 dashboards de redes                          │
│  - Editor + Producción + Métricas                               │
│  - API routes que sirven videos, SFX, music, imágenes           │
└─────────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────────┐
│  REMOTION (subproyecto, React-based video composition)          │
│  - ViralVideo.tsx: composición 1080×1920 30fps con:             │
│    · OffthreadVideo del raw                                     │
│    · Subtítulos animados (palabra por palabra)                  │
│    · PiP B-roll o fullscreen B-roll                             │
│    · Word stickers (top-center) con emoji                       │
│    · Floating emojis (entran del lateral)                       │
│    · Emphasis cards fullscreen (Punch)                          │
│    · Zoom marks + reaction zoom punches + stutter shakes        │
│    · Caption bounce (spring overshoot)                          │
│    · Vignette radial                                            │
│    · Múltiples capas de Audio (SFX + música)                    │
│  - npx remotion render → MP4 H.264                              │
└─────────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────────┐
│  PYTHON SCRIPTS (venv aislado en python/venv/)                  │
│  - transcribe.py: WhisperX modelo small español + alignment     │
│    wav2vec2 → timestamps palabra por palabra precisos           │
│  - detect_silences.py: silero-vad → segmentos con voz           │
│  - cut_silences.py: ffmpeg filter_complex (≤100 seg) o          │
│    concat demuxer (>100 seg) → video sin silencios              │
│  - analyze_clips.py: Ollama localhost:11434 → identifica        │
│    clips virales en transcripts largos (chunked si >15 min)     │
│  - extract_clips.py: ffmpeg extrae rangos del CLEAN +           │
│    recorta el transcript con timestamps re-anclados a 0         │
│  - long_form_pipeline.py: orquesta los 7 pasos                  │
└─────────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────────┐
│  OLLAMA local (puerto 11434)                                    │
│  - qwen3:1.7b (rápido, default)                                 │
│  - gemma4:26b (mejor calidad, lento)                            │
│  → identifica clips de 30-60s + genera caption + hashtags +     │
│    slug + keywords por clip                                     │
└─────────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────────┐
│  EXTERNAL: Pexels API (gratis, 200 req/h)                       │
│  /api/pexels/search → busca B-roll vertical 9:16                │
└─────────────────────────────────────────────────────────────────┘
```

## Decisiones técnicas clave

### Next.js 16 con App Router

- App Router obligatorio (Pages Router es legacy)
- shadcn/ui asume App Router
- Turbopack (built-in en Next 16) más rápido que Webpack
- Server Components para API routes que sirven videos/streams

### shadcn/ui en lugar de Material UI o Chakra

- Componentes copiados al proyecto (no instalados como dependencia)
- Total control sobre estilos
- Match perfecto con Tailwind v4
- Sirve para dark mode nativo

### Recharts en lugar de Tremor v3

- Tremor v3 estaba descontinuado / problemas con React 19 + Tailwind v4
- shadcn/charts es un wrapper de Recharts oficial recomendado
- Tipos TypeScript correctos sin hacks

### Remotion como motor de render

- Composición declarativa en React → fácil mantener
- FFmpeg bundleado (no requiere instalación manual del usuario)
- Múltiples capas de Audio nativas
- Chrome Headless para renderizar HTML/CSS → MP4
- License gratis para empresas <3 empleados

### WhisperX en lugar de whisper o whisper.cpp

- whisper.cpp: rápido pero timestamps imprecisos (±500ms)
- faster-whisper: rápido pero sin word-level timestamps
- **WhisperX: timestamps palabra-a-palabra precisos** (forced alignment wav2vec2)
- Es lo único que permite hacer subtítulos animados sincronizados

### silero-vad para detección de silencios

- Modelo de 40 MB, corre en CPU
- Más fiable que `auto-editor`
- Output JSON con segmentos de voz

### Ollama local en lugar de OpenAI/Claude API

- Cero costo por uso
- Privacidad total (transcripts nunca salen del equipo)
- qwen3:1.7b suficiente para análisis estructurado (con chunking)
- gemma4:26b opcional para mejor calidad

### Pexels en lugar de Pixabay/Unsplash

- Mejor calidad de video stock
- Free tier sin tarjeta
- API simple, sin OAuth

### CC0-Public-Domain-Sounds en lugar de comprar SFX

- 100% gratis, sin atribución obligatoria
- Incluye Kenney UI/Interface (calidad profesional, estilo TikTok)
- Curados 14 sonidos esenciales

### localStorage para métricas

- Sin backend para MVP
- Datos viven en el navegador del usuario
- Export/Import JSON para backup
- Si en el futuro queremos sincronización, agregamos Supabase o Cloudflare D1

## Estructura de un proyecto JSON

Para shorts:

```json
{
  "id": "D01_test_01_hype_sfx",
  "videoId": "D01_test_01",
  "day": 1,
  "platforms": ["tiktok", "instagram"],
  "styleId": "hype_max_sfx",
  "accentColor": "#fb7185",
  "caption": "...",
  "status": "borrador",
  "subtitleStyle": "anton",
  "subtitleColor": "#ffffff",
  "subtitleHighlight": "#fb7185",
  "musicTrack": null,
  "musicVolume": 0.15,
  "bRollMode": "pip",
  "vignette": true,
  "colorRotation": [],
  "captionBounce": true,
  "enableJumpCuts": true,
  "bRoll": [{ "start": 6.5, "end": 10.5, "url": "..." }],
  "zoomMarks": [{ "at": 0.3, "duration": 0.7, "scale": 1.18 }],
  "reactionZooms": [{ "at": 4.2, "intensity": 1.35, "duration": 0.22 }],
  "stutterMarks": [{ "at": 11.5, "duration": 0.18 }],
  "wordStickers": [{
    "at": 0.5, "duration": 1.5, "word": "MALA IDEA",
    "emoji": "🚫", "position": "top-center", "rotation": -4,
    "bg": "#fb7185", "color": "#0a0a0a"
  }],
  "floatingEmojis": [{
    "at": 1.2, "duration": 1.3, "emoji": "🌳",
    "from": "right", "size": 220, "yOffset": -200
  }],
  "sfxMarks": [{ "at": 0.3, "sound": "swoosh.wav", "volume": 0.35 }],
  "emphasisCards": [],
  "animations": [],
  "manualSubtitles": []
}
```

Ver [STYLES.md](./STYLES.md) para qué combinaciones usar.

## API routes Next.js

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/videos/list` | GET | Lista shorts en `raw/` con metadata |
| `/api/videos/[id]/stream?source=raw\|render` | GET | Stream MP4 con Range support |
| `/api/videos/[id]/thumbnail` | GET | Thumbnail extraído con FFmpeg (cache 1d) |
| `/api/videos/[id]/rename` | POST | Renombra archivo + transcript + cuts + render + project |
| `/api/videos/transcribe` | POST/GET | Spawn transcribe.py / lee transcript |
| `/api/videos/cuts` | POST/GET | Spawn detect_silences.py / lee cuts |
| `/api/videos/render` | POST | Spawn npx remotion render |
| `/api/pexels/search?q=...&type=videos\|photos` | GET | Proxy a Pexels API |
| `/api/projects` | GET | Lista proyectos (shorts + long_form unidos) |
| `/api/projects/[id]` | GET/PUT/DELETE | CRUD proyecto |
| `/api/music/list` | GET | Lista tracks de música en assets/music/ |
| `/api/music/stream?file=...` | GET | Stream MP3 |
| `/api/sfx/list` | GET | Lista los 14 SFX curados |
| `/api/sfx/stream?file=...` | GET | Stream SFX (usado por Remotion) |
| `/api/long_form/stream?file=...&source=raw\|clean\|clip\|render` | GET | Stream videos del long_form |
| `/api/jobs/queue` | GET | Estado de la cola de trabajos en memoria (editor + long_form) |
| `/api/jobs/resume` | POST | Re-encola los jobs que quedaron SOLO en cola tras un reinicio (lo dispara el panel de tareas al montar) |
| `/api/projects/[id]/reveal-render` | POST | Abre el render final en el explorador |

## Pipeline de un short

```
raw/<id>.mp4
       │
       ▼  transcribe.py (WhisperX)
transcripts/<id>.json
       │
       ▼  detect_silences.py (silero-vad)
cuts/<id>.json
       │
       ▼  cut_silences.py (ffmpeg)
raw/<id>_cut.mp4   ← opcional para jump cuts
       │
       ▼  build-props.mjs (remap timestamps si jump cuts)
remotion/props.json
       │
       ▼  npx remotion render
renders/<id>.mp4
```

## Pipeline de un video largo

```
long_form/raw/<id>.mp4 (1h, horizontal)
       │
       ▼  transcribe.py
long_form/transcripts/<id>.json (raw, ~6000 palabras)
       │
       ▼  detect_silences.py
long_form/cuts/<id>.json (~500 segmentos)
       │
       ▼  cut_silences.py (concat demuxer si >100 seg)
long_form/clean/<id>_clean.mp4 ← OUTPUT 1 (sin silencios)
       │
       ▼  transcribe.py del clean (timestamps alineados)
long_form/transcripts/<id>.json (sobrescrito, ~5000 palabras)
       │
       ▼  analyze_clips.py (Ollama chunked si >15 min)
long_form/proposals/<id>.json (5-7 clips con caption/hashtags/slug)
       │
       ▼  extract_clips.py (ffmpeg extrae rangos del clean)
long_form/clips/<id>_cNN_<slug>.mp4
long_form/transcripts/<id>_cNN_<slug>.json (timestamps a 0)
       │
       ▼  build-clip-supreme.mjs (auto-genera stickers/emojis/sfx)
long_form/projects/<id>_cNN_<slug>.json
       │
       ▼  build-clip-props.mjs + npx remotion render
long_form/renders/<id>_cNN_<slug>_supreme.mp4 ← OUTPUT 2 (5-7 clips)
```

### Modo Mejores Momentos (`--highlights`)

Alternativa one-shot al flujo de N clips: de un video largo arma UN solo video de ≤3 min
con lo mejor, secuenciado por emoción. `python/highlights.py` fusiona LLM (prompt dedicado)
+ `virality.py` + `emotion_director.py` (picos de arousal), selecciona adaptativo ≤180s y
ordena por arco emocional; extrae los momentos, los concatena (corte duro) y re-transcribe
el montage, que se renderiza como un **clip sintético** (`{id}_highlights_c01_reel`) por el
pipeline supreme normal (sin tocar el render). Detalle: `docs/HIGHLIGHTS.md`.

### Reanudable y resiliente (largos)

- **Export incremental**: cada render se escribe a su `.mp4` final apenas termina, así un
  corte de luz o un fallo a mitad del lote NO pierde lo ya renderizado.
- **Skip de lo ya renderizado**: al re-correr, los clips cuyo `.mp4` final ya existe y es
  válido (>100 KB) se saltan. Para forzar regenerar TODO: `VIRAL_FORCE_RENDER=1`.
- **Reporte real**: el resumen JSON final emite `rendered` / `render_tasks` / `render_failed`
  (clips realmente renderizados, no solo extraídos) → la UI avisa "X de Y se renderizaron".
- **Provider offline-aware**: `analyze_clips.py` y `generate_caption.py` chequean DNS antes de
  intentar el provider OAuth (claude/codex); sin internet van directo a Ollama local sin colgarse.

### Cola de trabajos (jobs)

La cola vive en memoria (`globalThis`, no se persiste). Cada store de jobs (editor / long_form)
persiste la `request` de cada job y, en un reinicio, marca `resumable: true` a los que quedaron
SOLO en cola (nunca arrancaron). El panel de tareas, al montar, llama `POST /api/jobs/resume`,
que los vuelve a encolar reusando el MISMO `processJob` de cada ruta. Un render a medias NO se
reanuda (no es seguro retomarlo); ese se relanza a mano desde el wizard.

### "Mis videos" (Producción)

`GET /api/projects` une shorts + clips de largos y descarta los que ya no tienen video de
respaldo. El checker (`frontend/src/lib/orphan-sweep.ts`) exige que el **render final exista y
sea reproducible** (>100 KB) → un render roto/truncado queda oculto y reaparece al re-generarlo.
En el cliente (`production-list.tsx`), las variantes de estilo del MISMO clip se agrupan por
base-id (quitando el sufijo `_{styleId}`) en una sola tarjeta con chips para alternar entre estilos.

## Composición Remotion: capas (de atrás hacia adelante)

```
1. Background negro #000
2. OffthreadVideo del raw (con scale + shake aplicados)
3. B-roll (fullscreen o PiP centrado abajo 540×720)
4. Vignette radial (transparent center → 0.55 black)
5. Glow inset (si animation glow activa)
6. SubtitleLayer (palabra única, posición fija bottom-320)
7. FloatingEmojiLayer (entradas laterales con wobble)
8. WordStickerLayer (sello rotado, siempre top-center 180px)
9. EmphasisCardLayer (fullscreen con blur, emoji 360px + palabra hasta 220px)
10. Audio de SFX (múltiples sequences)
11. Audio de música (single layer)
```

## Composición Remotion: schemas (zod)

Cada elemento del JSON del proyecto tiene un schema validado:

- `wordSchema`: word + start + end
- `bRollSchema`: start + end + url
- `animationSchema`: at + type (zoom/glow/shake)
- `emphasisCardSchema`: at + duration + word + emoji + bg + color + accent
- `zoomMarkSchema`: at + duration + scale
- `wordStickerSchema`: at + duration + word + emoji + position + rotation + bg + color
- `floatingEmojiSchema`: at + duration + emoji + from + size + yOffset
- `reactionZoomSchema`: at + intensity + duration
- `stutterMarkSchema`: at + duration
- `sfxMarkSchema`: at + sound + url + volume

## Convenciones de naming

- **Shorts**: `D##_slug` (ej: `D01_prompt_40k`)
- **Proyectos de shorts**: `D##_slug_<estilo>` (ej: `D01_prompt_40k_hype_sfx`)
- **Long form**: `D##_curso_<tema>` (ej: `D13_curso_principal`)
- **Clips de long form**: `D##_curso_<tema>_c##_<slug-del-clip>` (ej: `D13_curso_principal_c01_tres-errores-ventas`)
- **Renders finales**: igual al proyecto + `.mp4`

## Costos totales

| Componente | Costo |
|---|---|
| Node.js | $0 |
| Python | $0 |
| WhisperX | $0 |
| silero-vad | $0 |
| Remotion | $0 (empresas <3 empleados) |
| Ollama | $0 |
| Pexels API | $0 (200 req/h sin tarjeta) |
| SFX CC0 | $0 |
| FFmpeg | $0 |
| Fuentes (TTF OFL/Apache locales) | $0 |
| **Total** | **$0** |

> Las tipografías ya **no** se bajan de `fonts.gstatic.com` en cada render: `python/download_fonts.py`
> hornea 43 fuentes OFL/Apache a `remotion/public/fonts` (una vez, con internet) y el render las
> carga locales en modo lazy → **cero red en el render**. Ver [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#el-render-falla-sin-internet-err_name_not_resolved--fontsgstaticcom)
> y `remotion/src/layers/local-editorial-fonts.ts`.

Si decides usar OpenAI/Claude API en vez de Ollama: ~$0.50 por video largo procesado.
