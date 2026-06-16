# Estilos y sistema de efectos

Cada video se renderiza con un **estilo** (`StyleId`) que arma un proyecto JSON
(`frontend/src/lib/style-templates.ts`) y luego se compone en Remotion
(`remotion/src/ViralVideo.tsx`). Todo es **opt-in y aditivo**: los campos del schema tienen
defaults vacíos, así que un estilo que no usa un efecto renderiza sin él.

---

## Estilos

| Estilo | Subtítulo | Extras propios |
|---|---|---|
| `silent` | bebas | solo LUT de color (limpio) |
| `punch` | bebas | emphasis cards + FX |
| `hype` | anton | stickers, emojis, zooms + **motion tracking** |
| `hype_max` | anton | + jump cuts + reaction zooms + **mirror/clone/split** |
| `hype_max_sfx` | anton | + SFX coordinados al transcript |
| `supreme` | cinematic | full stack (default clips largos) |
| `cinematic_pro` | cinematic | imágenes fullscreen + música + camera moves auto |
| `broll_full` | anton | **Pexels fullscreen** auto + **beat-sync** + mirror |
| `broll_pip` | anton | **Pexels PIP** auto + **beat-sync** + **quitar fondo IA** |

Todos pasan por `applyCapcutFx()`, que suma LUT + scene-fx + transiciones pro + tipografía
cinética (con un preset distinto por estilo para mantener identidad).

---

## Las "recetas CapCut" (nativas, headless)

### 1. LUTs de color profesional
- 6 LUTs `.cube` generados por `remotion/generate-luts.mjs`: `teal_orange`, `kodak_warm`,
  `bleach_bypass`, `cyberpunk`, `vintage_film`, `noir`.
- Se aplican **post-render con ffmpeg** (`lut3d`) en `auto-build/route.ts` — color real
  (mapeo 3D), no filtros CSS. Si el `.cube` falta, se saltea (no rompe).
- Regenerar: `node remotion/generate-luts.mjs`. Podés dropear packs comerciales `.cube` en
  `remotion/public/luts/` y referenciarlos por nombre.

### 2. Scene FX (atmósfera)
- `remotion/src/scene-fx.tsx` → `SceneFxLayer`: light leaks, bokeh, glow, dust — **procedurales**
  (gradientes + `@remotion/noise`), compuestos con `mixBlendMode: screen`. Sin assets externos.

### 3. Transiciones pro
- `ProTransitionLayer`: `whip`, `zoom_punch`, `glitch` (bandas RGB), `flash`, `reveal_lr/ud`
  (wipes con `clip-path`). Se colocan en keywords del transcript.

### 4. Tipografía cinética
- `KineticSubtitleLayer`: presets `pop`, `slide_up`, `type_on`, `bounce`, `glow_pulse`.
  Si el estilo elige `kineticPreset !== "none"`, reemplaza al subtítulo normal.

### 5. Mirror / clone / split (kaleidoscope)
- `remotion/src/mirror-fx.tsx` → `MirrorFxLayer`: `mirror_v`, `mirror_h`, `clone_3`, `split_2`.
  Renderiza copias del video base con transforms durante una ventana corta.

### 6. Beat-sync (cortar al ritmo) 🎵
- `python/detect_beats.py` (librosa) detecta los beats del track de música elegido.
- `auto-build` coloca `zoomMarks` + flashes en los beats más fuertes. Solo en estilos con
  `beatSync: true` y música (ej. `broll_full`/`broll_pip`). Si no hay música, no hace nada.

### 7. Motion tracking 🎯
- `python/track_subject.py` (OpenCV Haar) trackea la cara cuadro por cuadro → `trackPath`.
- `remotion/src/tracked-layer.tsx` → `TrackedLayer` pega un label (keyword + emoji) que
  **sigue la cara**. Se corre en estilos con `tracking: true` (ej. `hype`). Si falla, queda vacío.

### 8. Quitar fondo con IA 🪄
- `python/remove_background.py` (MediaPipe SelfieSegmenter) separa la persona y compone un MP4
  con el **fondo desenfocado** (look profundidad de campo). Output `{videoId}_fg.mp4` en `raw/`.
- `build-props.mjs` lo usa como video base. Solo en estilos con `removeBg: true` (ej. `broll_pip`).
- Modelo: `python/models/selfie_segmenter.tflite` (descargar, ver README). Si falta, se saltea.

> **Nota sobre alfa:** el ffmpeg "essentials" local no codifica webm con alfa de forma
> confiable, por eso el "quitar fondo" compone el resultado en Python (MP4 opaco) en vez de
> exportar un video transparente. Es más robusto y se ve igual de pro.

### 9. B-roll local (descarga + stream) ⚡
- `broll_full`/`broll_pip` autollenan clips de **Pexels por transcripción** (`lib/pexels.ts`
  → `autoMatchBroll`), que llegan como **URLs remotas** (`https://videos.pexels.com/...`).
- **Problema:** si esas URLs remotas se le pasan directo a Remotion `<OffthreadVideo>`, hace
  peticiones HTTP **por rango en CADA frame** para seekear → la CPU queda ociosa esperando la
  red y un video de 1 min puede tardar ~30 min.
- **Solución (antes de renderizar):** se **descarga** cada clip remoto UNA vez a
  `{DATA_ROOT}/assets/broll/<sha1(url)>.mp4` y se **re-codifica** con keyframes densos (GOP
  corto, `-an`) para seek instantáneo. La URL del clip se reescribe a
  `/api/assets/broll/stream?file=<sha>.mp4`, que sirve el archivo local con soporte **Range/206**.
  El seek pasa de segundos (red) a milisegundos (disco): render ~6× más rápido.
- **Dónde:** `remotion/broll-localize.mjs` (wizard/auto-build, vía `build-props.mjs`) y su espejo
  `frontend/src/lib/broll-localize.ts` (editor manual, vía `videos/render/route.ts`). Comparten el
  mismo cache por `sha` del URL. Es **best-effort**: si la descarga/ffmpeg falla, se deja la URL
  remota (lento pero no rompe). Los clips ya locales/relativos se dejan intactos.
- **Endpoint:** `frontend/src/app/api/assets/broll/stream/route.ts` — Range/206 + CORS abierto
  (el render headless lee desde otro origen) + guard de path-traversal (`?file` sin `..`/`/`/`\`).

---

## SFX coordinados
- `python/match_sfx_to_transcript.py` mapea ~16 familias de SFX a keywords del transcript
  (boom, whoosh, ding, bling, etc.) con volumen/offset por categoría.

## Cómo se conecta todo
```
Wizard / auto-build
  → style-templates.ts  (arma el project JSON con los campos del estilo)
  → [python] match_sfx / detect_beats / track_subject / remove_background  (opt-in)
  → build-props.mjs     (project JSON → props.json, remapeando timestamps si hay jump cuts)
  → npx remotion render ViralVideo
  → [ffmpeg] lut3d (color) + audio mastering   (post-render)
```

## No-regresión
Como todo es aditivo (defaults vacíos), un proyecto viejo sin estos campos renderiza igual que
antes. Verificación: `npx tsc --noEmit` en `frontend/` y `remotion/` debe dar 0 errores.
