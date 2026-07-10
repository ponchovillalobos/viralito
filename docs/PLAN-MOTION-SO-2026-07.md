# Plan de Producto — Viralito vs Motion.so

> ## Estado de implementación (2026-07-16)
>
> **Hechas + gate verde (tsc frontend + remotion + 159 tests + paridad 22↔22):**
> - ✅ **F1.b Marca desde URL/logo** — `python/brand_from_source.py`, `/api/brand`, widget `brand-kit-picker.tsx` en ambos wizards.
> - ✅ **F1.a Spring en captions** — `subtitle-layer.tsx` (pop orgánico bebas/anton, opacidad intacta).
> - ✅ **F1.c Set de transiciones** — `fade` agregado a `pro-transition-series-layer.tsx` (6 tipos); emisión opt-in (no auto-inyecta para no tapar subtítulos).
> - ✅ **F2.a Audiograma** — estilo nuevo `audiogram` (25 estilos), `audiogram-layer.tsx`, registro completo + ambos wizards.
> - ✅ **F2.d FX de lente** — `lens-fx-layer.tsx` (halación + aberración cromática) en vhs/cinematic_pro/cine_clasico.
> - ✅ **F2.c Callouts word-synced** — `stat-pop-layer.tsx` + `lower-third-layer.tsx` + `python/word_callouts.py` (opt-in, [] = idéntico).
> - ✅ **F3.b Servidor MCP** — `mcp/server.mjs` (8 tools, cero deps, verificado en vivo).
>
> - ✅ **F2.b Bumper de marca (SHORTS)** — composición SEPARADA `BrandBumper.tsx` (draw-on wipe del logo + tagline) + `render-bumper.mjs` + `python/bumper_concat.py` (ffmpeg concat en post, NO toca ViralVideo) + toggle en wizard de shorts + wiring en auto-build. Render verificado visualmente. Sliver: wiring en el pipeline de largos (bloques ya listos).
>
> **Pendientes — tanda pesada (requieren verificación con render/UI real, sesión dedicada):**
> - ⏳ **F2.b Bumper en LARGOS** — post-loop de concat sobre los clips renderizados (los 3 bloques ya sirven).
> - ⏳ **F3.a Storyboard previo** — Ollama scenes[] + UI ReviewView + thumbs; UI a validar.
> - ⏳ **F3.c Editar sin regenerar** — 3 subsistemas (chat-edit, drag overlay, render incremental); grande + riesgoso.
> - ⏳ **F2 Modo faceless** — pipeline nuevo (guion→escenas→b-roll→TTS→captions); grande. (El TTS local ya existe.)
>
> Falta: **rebuild del standalone** para que las 7 features queden vivas (reinicia la app).



## 1. Resumen ejecutivo

**Qué es Motion.so.** Agente cloud de motion design (text-to-video sobre Remotion): investiga, diseña, anima, hace voiceover y edita en un solo flujo, corriendo en el browser e integrado con Claude/ChatGPT vía MCP. Es motion graphics de marca (launch videos, demos, logo animations, ads), NO editor de clips virales de video crudo. SaaS por créditos, precio demo-gated, todo sube a su nube.

Job-to-be-done distinto al de Viralito: Motion **inventa** animaciones desde una frase; Viralito **corta tu video real** en tu máquina. No competimos de frente — copiamos las capacidades que suman, en local.

**4 ideas de mayor impacto:**

1. **Modo faceless (artículo/guion → video narrado)** — MODO NUEVO. La paridad más directa con el pitch de Motion ("text-to-video"), 100% offline reusando Piper/WhisperX/Ollama/Pexels/Remotion ya presentes. Mayor valor comercial.
2. **Marca desde URL/logo → style guide automático** — ENRIQUECE. Onboarding de marca en un paso; extrae paleta con PIL/cv2 (ya instalados) y mapea a los 17 temas editoriales con TTF local. Alto valor, cero deps nuevas.
3. **Estilo audiograma / waveform para podcast** — MODO NUEVO (estilo dedicado). Desbloquea el vertical podcast sin depender de cara; reusa `visualizeAudio` ya usado por motion_pro.
4. **Bumper de marca (intro/outro con logo animado + tagline)** — MODO NUEVO. Reusa el motor draw-on (`drawProps`) para trazar el logo; convierte a Viralito en herramienta de branding, no solo de clips.

Enriquecimientos de soporte de alto ROI: **callouts/lower-thirds word-synced**, **spring en captions**, **set de transiciones**, **FX de lente (chromatic/halation/pixelate)**. Palancas de distribución: **servidor MCP** (paridad con "@mention connectors" de Motion) y **editar sin regenerar** (chat-to-edit + drag-drop + re-render incremental).

Excluido: **voiceover TTS local** (`local-tts-voiceover`) — ya existe y está cableado al render; no se duplica.

---

## 2. Tabla rankeada de propuestas

| # | Propuesta | Tipo | Valor | Esfuerzo | Offline | Verdict |
|---|-----------|------|-------|----------|---------|---------|
| 1 | Marca desde URL/logo → style guide | Enriquece | Alto | M | Sí | Proponer |
| 2 | Modo faceless (guion → video narrado) | **Modo nuevo** | Alto | L | Sí | Proponer |
| 3 | Estilo audiograma / waveform podcast | **Modo nuevo** | Alto | M | Sí | Proponer |
| 4 | Bumper de marca (intro/outro logo) | **Modo nuevo** | Alto | M | Sí | Proponer |
| 5 | Callouts / lower-thirds word-synced | Enriquece | Alto | M | Sí | Proponer |
| 6 | Servidor MCP (editar desde agentes) | Enriquece | Alto | M | Sí | Proponer |
| 7 | Editar sin regenerar (chat/drag/incremental) | **Modo nuevo** | Alto | L | Sí | Proponer |
| 8 | Storyboard/plan previo (ReviewView) | Enriquece | Alto | L | Sí | Proponer |
| 9 | FX de lente (chromatic/halation/pixelate) | **Modo nuevo** | Alto | M | Sí | Proponer |
| 10 | Spring orgánico en captions/stickers | Enriquece | Medio | S | Sí | Proponer |
| 11 | Set de transiciones `<TransitionSeries>` | Enriquece | Medio | M | Sí | Proponer |

**Marcado aparte (no se implementa):**

| Propuesta | Tipo | Verdict | Razón |
|-----------|------|---------|-------|
| Voiceover TTS local (Piper/Coqui) | — | **Ya existe** | `python/tts.py` + `xtts.py` + `applyVoiceover` cableados al render vía `/api/voiceover/stream`. El único delta (narrador por-escena) lo cubre el Modo faceless (#2). |

Criterio de ranking: valor comercial × reuso de infra existente ÷ riesgo. Los 3 primeros pesan por diferenciación directa contra Motion con esfuerzo contenido.

---

## 3. Plan por fases

### F1 — Rápido, alto valor (quick wins, riesgo bajo)

**Objetivo:** subir el techo de calidad visual y cerrar el onboarding de marca sin tocar los caminos delicados del render.

**F1.a — Spring orgánico en captions** (S, riesgo bajo)
- Construir: migrar la ruta no-cinematic (bebas/anton) de fadeIn lineal a `spring()` de entrada, igual que ya hace 'cinematic'. Opcional: `subtitleStyle: 'kinetic'` con stagger por-letra.
- Archivos: `remotion/src/layers/subtitle-layer.tsx` (líneas 59-68, 78-87); opt B: `build-props.mjs`, `build-clip-supreme.mjs`, `style-registry.data.json`.
- Deps: Remotion `spring` (ya instalado). Cero nuevas.
- Riesgo: bajo. Guardar `Math.max(0.05, entrySpring)` en frame 0 para NO violar "subtítulos siempre visibles". Split por-letra puede empujar palabras 12+ chars fuera de `maxWidth 980px` → probar.

**F1.b — Marca desde URL/logo** (M, riesgo medio)
- Construir: `python/brand_from_source.py` — extrae paleta (`Image.quantize` / `cv2.kmeans`), snap del acento a los 20 colores vetados de `PALETTE`, mapeo fondo/hue → vecino de los 17 `EDITORIAL_THEME_DEFS`. Emite `{palette, accent, themeId, fontTitle}`.
- Archivos: `python/brand_from_source.py` (nuevo), `frontend/src/app/api/brand/route.ts` (nuevo, multipart offline / URL online degradable), paso "Marca" en `wizard-client.tsx` y `long-form-wizard.tsx`. Reusa `apply-wizard-overrides.ts:50` y `brandKit.logoUrl` de `schemas.ts:205`.
- Deps: Pillow, numpy, opencv-python (todas ya en `requirements.txt`); `requests`+`re` stdlib para URL. Cero libs JS.
- Riesgo: logos con gradiente/foto dan color turbio; detección de fuente real inviable offline. Mitigación: acento SNAP a los 20 vetados (contraste de subs garantizado), "tipografía" = tema editorial con TTF local, usuario siempre sobreescribe.

**F1.c — Set de transiciones** (M, riesgo medio)
- Construir: agregar `fade` al schema `kind`; `generateProTransitionSeries(ctx)` que emite cortinillas en cortes editoriales con `color=colorTo=ctx.accentColor` (mono-color); activar SOLO en `editorial_broll`.
- Archivos: `remotion/src/layers/pro-transition-series-layer.tsx`, `style-templates.mjs`+`.ts`, `remotion/src/ViralVideo.tsx` (~1381, montar por DEBAJO de subtítulos/stickers en z-order). Largos heredan vía `build-clip-props.mjs:153`.
- Deps: `@remotion/transitions` + `/fade` (ya instalado).
- Riesgo: panel de color puede tapar subs si el z-order queda mal → montar debajo y/o alinear `at` a gaps sin habla. Default `[]` mantiene los otros 22 estilos intactos.

### F2 — Modos nuevos de creación (diferenciación, riesgo medio)

**Objetivo:** abrir formatos que hoy Viralito no cubre y que copian capacidades núcleo de Motion, todo offline.

**F2.a — Estilo audiograma / podcast** (M, riesgo medio-bajo)
- Construir: `remotion/src/layers/audiogram-layer.tsx` — reusa `useWindowedAudioData`+`visualizeAudio` (patrón de `AudioPulse` en `animated-background-layer.tsx`) apuntado a `voiceoverUrl ?? rawVideoUrl` (la VOZ, no la música); barras mono-color `accentColor`, altura `sqrt(freq[i])`; branding `{show,handle,logo}`; reusa `progressBar:true` existente.
- Archivos: layer nuevo, `ViralVideo.tsx` (schema nullable + montaje), `style-registry.data.json` (entry 'audiogram'), `style-templates.ts`+`.mjs` (branch), `build-props.mjs`+`build-clip-supreme.mjs` (pasar prop). Sube a 25 estilos.
- Deps: `@remotion/media-utils` (ya), Anton TTF local (ya), logo PNG CC0 opcional.
- Riesgo: verificar que el clip tenga pista de audio (si mudo → `voiceoverUrl`); forzar TODAS las barras a `accentColor` (no gradiente); barras abajo/lados, banda de subs libre.

**F2.b — Bumper de marca (intro/outro)** (M, riesgo medio)
- Construir: `remotion/src/layers/brand-bumper-layer.tsx` — draw-on del logo reusando `drawProps` de `line-art-icons.tsx` (modo SVG = traza contorno; modo raster = reveal por máscara wipe + spring); tagline con TTF local y wordStagger tras terminar el logo. `brandBumperSchema` reusa `logoUrl` de brandKit. Montar en Sequences propias (inicio/cierre), el outro convive con/reemplaza `end-screen-layer.tsx`.
- Archivos: layer nuevo, `schemas.ts`, composición root de `remotion/src`, `style-registry.data.json`+`style-templates.ts/.mjs`+build-props, toggle en ambos wizards. Opcional: `python/vectorize_logo.py` (vtracer MIT) para trazar logos raster.
- Deps: Remotion + React (ya), `drawProps` (ya), TTF local (ya).
- Riesgo: draw-on real requiere SVG con paths; raster cae a reveal por máscara. Medir `pathLength` en runtime es caro → usar `pathLength=1` normalizado o precomputar en build. Montar intro empuja el timeline (+durIn) → recalcular `durationInFrames` y offsets de captions/b-roll/audio.

**F2.c — Callouts / lower-thirds word-synced** (M, riesgo medio)
- Construir: `python/word_callouts.py` — detecta cifras word-level por regex determinista → statPops en `words[idx].start`; arma lowerThird de apertura desde `speakerName/speakerRole` del wizard u Ollama sobre el intro. `stat-pop-layer.tsx` (contador spring, top-center) + `lower-third-layer.tsx` (banda ~70%, arriba de subs).
- Archivos: `remotion/src/schemas.ts` (2 schemas), 2 layers nuevos, `ViralVideo.tsx`, `build-props.mjs`+`build-clip-supreme.mjs` (`filterAndRemap(...,['at'])`), `python/long_form_pipeline.py` + builder shorts, campos en ambos wizards, registro en `style-templates` para editorial/graphics_pro/editorial_full, doc en `STYLES.md`.
- Deps: Remotion, WhisperX words (ya), Ollama opcional (labels), TTF local, regex stdlib.
- Riesgo: lower-third NO puede vivir en bottom (ahí van subs) → banda ~68-74%. Accent/bg derivan del `accentColor` único. Schema nuevo obliga actualizar build-props Y build-clip-supreme + defaultProps + STYLES.md o rompe largos/supreme. Cap de N pops (ej. 6) contra falsos positivos. Todo opt-in aditivo: arrays vacíos = render idéntico.

**F2.d — FX de lente (chromatic/halation/pixelate)** (M, riesgo medio)
- Construir: `remotion/src/layers/lens-fx-layer.tsx` — `lensFxSchema` + `LensFxDefs` con 3 filtros SVG procedurales (feColorMatrix/feOffset/feGaussianBlur/feBlend/feMorphology) sobre el `OffthreadVideo` base. Halación tinta con `accentColor`.
- Archivos: layer nuevo, `ViralVideo.tsx` (prop `videoFx` default `[]`, extender builder `videoFilter` L748), `build-props.mjs`+`build-clip-supreme.mjs`, `style-templates.ts/.mjs`+`style-registry.data.json` (chromatic+halation en vhs/y2k, halation sutil en cinematic_pro/cine_clasico), doc STYLES.md.
- Deps: Remotion, `@remotion/noise` (ya). Cero nuevas.
- Riesgo: toca `ViralVideo.tsx` (el archivo más delicado) — anexar al `videoFilter` sin tocar `objectFit:cover`. `feGaussianBlur` grande es caro en largos CPU-bound → cap de radio + solo en ventanas `[at,duration]`. Prefijar ids de filtro por composición (`viral-chromatic-{id}`) contra colisión. Aberración cromática rompe mono-color por definición → documentar excepción, solo VHS/Y2K.

### F3 — Ambicioso, plataforma (mayor esfuerzo/riesgo, mayor apalancamiento)

**Objetivo:** convertir Viralito de "generador" en "editor iterable" y en "endpoint editable por cualquier agente" — paridad con el ángulo MCP de Motion.

**F3.a — Storyboard/plan previo** (L, riesgo medio)
- Construir: extender `analyze_clips.py` (prompt → `scenes[]` con beat/visualHint/pacingTarget); `python/plan_storyboard.py` deriva paleta mono-color (colorthief+Pillow sobre keyframes ffmpeg) + ritmo base (densidad de segmentos WhisperX) + thumbs reales por escena. Escribe al `proposals/{video_id}.json` existente.
- Archivos: `analyze_clips.py`, `plan_storyboard.py` (nuevo), `long-form-wizard.tsx` (ReviewView ~2778-2896: panel Storyboard desplegable, chip de paleta, slider de pacing), extender PATCH a `/api/long_form/proposals/[videoId]`.
- Deps: ffmpeg (ya), colorthief (MIT, pip), Pillow (ya), Ollama+WhisperX (ya).
- Riesgo: latencia Ollama (scenes) + extracción de thumbs → generar storyboard LAZY solo para clips que el user expande, no los 10-15 de golpe.

**F3.b — Servidor MCP** (M, riesgo medio)
- Construir: paquete `viralito/mcp/server.mjs` (StdioServerTransport) con ~8 tools que envuelven rutas Next YA existentes: `create_project`, `list_styles`, `render_short`, `render_long`, `supercut`, `hook_variants`, `job_status`, `get_result`. Token local `VIRALITO_MCP_TOKEN`, bind solo a `127.0.0.1`.
- Archivos: `viralito/mcp/server.mjs`+`README.md`, `@modelcontextprotocol/sdk` explícito en `frontend/package.json`, script `npm run mcp`, opcional `frontend/src/app/api/mcp/route.ts` (HTTP/SSE para ChatGPT).
- Deps: `@modelcontextprotocol/sdk` (MIT, ya transitivo), zod (ya), inspector (MIT, solo dev).
- Riesgo: exponer endpoints locales a agentes externos exige token + loopback; no abre nada a internet. El MCP NO genera render nuevo, solo dispara pipelines que ya respetan las reglas duras. **Ángulo de venta directo: paridad con "@mention connectors" de Motion sin salir del 100% offline.**

**F3.c — Editar sin regenerar** (L, riesgo medio)
- Construir: 3 capas. (1) `chat-edit/route.ts` → Ollama local devuelve PATCH JSON validado contra allowlist, aplicado con `updateProject()` existente. (2) `canvas-overlay.tsx` — overlay DOM sobre el `<video>` nativo, drag/resize muta `x/y/scale` en el mismo sistema de coords de Remotion. (3) Re-render incremental: segmentar el export, hashear props por segmento, cachear mp4 por hash, concatenar con ffmpeg concat; `VIRAL_FORCE_RENDER=1` fuerza full.
- Archivos: `frontend/src/app/api/projects/[id]/chat-edit/route.ts`, `ChatEditPanel` en `workspace.tsx`, `canvas-overlay.tsx`, `videos/render/route.ts` + remotion.
- Deps: Ollama (ya), ffmpeg concat (ya), `@use-gesture/react` (MIT, opcional; alternativa pointer events nativos cero-deps).
- Riesgo: schema de chat-edit debe bloquear ocultar subtítulos y >1 color base y solo referenciar TTF locales. loudnorm -14 se re-aplica en el concat final, NO por segmento, para no romper el LUFS.

---

## 4. Nota de venta

**Motion.so valida el mercado, y su modelo refuerza el nuestro.** Que una empresa construya un agente de motion design sobre Remotion y lo venda como SaaS prueba tres cosas útiles para Viralito:

1. **Hay demanda real de text-to-video con agente.** El Modo faceless (#2) y el MCP (#6) copian ese pitch — pero corriendo en la máquina del usuario. Cada capacidad que Motion cobra por crédito, Viralito la da a costo marginal cero.

2. **El eje de diferenciación es privacidad + economía, no features.** Motion sube tu video crudo y tus assets a su nube y factura por render sin precio público. Viralito: tu material nunca sale de tu disco, pagás una vez, render ilimitado con TU GPU/CPU. Para creadores con material bajo NDA, mercados LatAm sensibles a suscripción en USD, o quien no quiere subir gigabytes, es checkbox de compra — no nota al pie.

3. **Categorías separadas, no competencia frontal.** Motion inventa animaciones de marca desde una frase; Viralito corta TU video real en clips virales. Las 11 propuestas suben la barra visual y suman los formatos donde Motion es fuerte (faceless, bumpers, branding), sin abandonar el job-to-be-done propio.

**Remotion permite productos comerciales — confirmado.** Es source-available y explícitamente admite venta; Motion.so es la prueba viva. Gratis para individuos, non-profits y empresas ≤3 personas. Si Viralito se vende siendo ≥4 personas o automatiza renders, se compra la company license (Creators ~$25/seat/mes, Automators $0.01/render mín $100/mes, Enterprise desde $500/mes) — mismo terreno legal que pisa Motion. Convertirlo en trust signal: "construido sobre stack con licencia comercial, no un hack". El modelo de Viralito (pago único al usuario final) es compatible.

Contra-mensaje de una línea si te comparan: **"Motion inventa animaciones desde una frase; Viralito trabaja con TU video real, en TU máquina, sin cuotas por render."**

---

## 5. Recomendación final

**Empezar por F1.b — Marca desde URL/logo → style guide automático.**

Por qué esta y no el Modo faceless (que tiene mayor valor bruto):

- **Máximo ROI inmediato.** Cero deps nuevas (Pillow/numpy/opencv ya en `requirements.txt`), cero API paga, cero red en render. Esfuerzo M, no L.
- **Reusa todo lo cableado.** El acento va a `accentColor` (ya existe), el tema a `editor-theme` override que ya consume `apply-wizard-overrides.ts:50`, el logo al `BrandWatermarkLayer` existente (`schemas.ts:205`). Es integración, no motor nuevo.
- **Desbloquea el resto.** El bumper de marca (F2.b), los lower-thirds (F2.c) y el faceless (F2.a) todos consumen `logoUrl`/`accentColor`/`editorialTheme`. Tener un "brand kit" derivado de un solo paso hace que las fases siguientes se sientan coherentes en vez de sueltas.
- **Riesgo acotado y reversible.** El punto flojo (color turbio de logos-foto, fuente real no detectable) está mitigado de origen: acento SNAP a los 20 colores vetados (contraste de subs garantizado + mono-color respetado), "tipografía" = tema editorial con TTF local, y el usuario siempre sobreescribe. No toca `ViralVideo.tsx` ni el path de render delicado.

Secuencia sugerida: **F1.b (marca) → F1.a (spring, quick win en paralelo) → F2.a (audiograma, primer modo nuevo de bajo riesgo) → F2.b (bumper, ya con brand kit listo) → F3.b (MCP, palanca de distribución).** El Modo faceless (#2, esfuerzo L) entra cuando el brand kit y el bumper ya existan, porque los reusa para verse terminado.