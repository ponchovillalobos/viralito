# Capacidades del sistema — Estrategia Viral Poncho

Catálogo completo de lo que hace la plataforma. Todo corre **local y gratis** (sin
suscripciones ni API keys de pago). Última actualización: 2026-06.

> Arquitectura: **Next.js** (portal + API) · **Remotion** (motor de render de video) ·
> **Python** (IA: transcripción, análisis, visión, audio). Los datos viven en
> `C:\hermes-data\videos` (no en el repo). El código vive en OneDrive.

---

## 1. Estilos de edición (shorts)

Cada estilo es una "receta" que arma el video automáticamente. Se eligen en el editor.

| Estilo | Para qué | Destacado |
|---|---|---|
| **Hype** (🔥) | Viral estándar, el recomendado | subtítulos grandes, zooms, tracking |
| **Impacto** (🥊) | Resaltar frases clave | emphasis cards en momentos top |
| **Viral intenso** (⚡ hype_max) | Más energía | jump cuts + reaction zooms + stutter |
| **Viral con sonidos** (🎵 hype_max_sfx) | Lo más llamativo | + efectos de sonido |
| **Premium** (👑 supreme) | Máxima calidad | todo activado (karaoke, end-screen, lottie…) |
| **Limpio** (🤍 silent) | Sobrio/profesional | solo subtítulos + color |
| **Con videos de apoyo** (🎞️ broll_full) | B-roll a pantalla completa | Pexels auto por transcripción |
| **Videos de apoyo chico** (🖼️ broll_pip) | B-roll en PIP | + quitar fondo |
| **Texto detrás de vos** (🧍 text_behind) | Efecto CapCut clásico | palabra detrás del sujeto |
| **Gráficos & Motion** (📊 graphics_pro) | Datos animados | charts + titulares + edición dinámica |
| **Gráficos Max** (📈 graphics_max) | Lo anterior al máximo | + jump cuts + reaction zooms |
| **Motion Pro** (✨ motion_pro) | Animación pura y limpia | fondo aurora audio-reactivo, sin emojis |
| **Motion Beat** (🎧 motion_beat) | El fondo late con la música | gradiente mesh + zooms al beat |
| **Motion Grid** (🌐 motion_grid) | Look retro-tech | cuadrícula en perspectiva + gráficas |
| **Editorial** (📰 editorial) | Documental premium | video en panel + titulares serif + 265 ilustraciones line-art animadas con variedad por video, 4 temas (Clásico/Tinta/Crema/Bold) |

También: **modo cinematográfico** (opt-in) con imágenes fullscreen, film grain, camera
moves y color grading por densidad (KODAK/FUJI/BLEACH).

---

## 2. Subtítulos y tipografía

- **3 tratamientos**: bebas (viral), anton (peso), cinematic (cine, glow).
- **Karaoke real** con relleno progresivo: las palabras dichas quedan resaltadas, la
  activa con pop+glow, las próximas atenuadas.
- **6 presets cinéticos**: pop, slide_up, type_on, bounce, glow_pulse, karaoke.
- **10 tipografías** (Google Fonts gratis): Bebas, Anton, Montserrat, Poppins, Oswald,
  Bangers (cómic), Luckiest Guy, Archivo Black, Teko, Righteous. Selector en el wizard.
- Rotación de color por palabra, bounce opcional.

---

## 3. Efectos visuales (FX)

- **Transiciones (9)**: whip, zoom_punch, glitch, flash, reveal_lr, reveal_ud,
  light_streak, swipe_blur, iris.
- **Cámara**: zoom, reaction zoom (punch), shake, camera moves (pan/zoom), motion blur
  cinematográfico (regla 180°).
- **Mirror/Clone/Split**: mirror_v, mirror_h, clone_3, split_2.
- **Jump cuts** por pausas + **beat-sync** (corta/zoomea al ritmo de la música).
- **Speed ramps** (slow-mo en énfasis), **auto-reframe** 16:9→9:16 siguiendo la cara.
- **Vignette**, **film grain**.

## 4. Color

- **6 LUTs** profesionales (.cube): teal_orange, kodak_warm, cyberpunk, vintage_film,
  bleach_bypass, noir — aplicados en post con ffmpeg.
- **3 moods cinematográficos** por `cinematicDensity` (warm / cool / bleach bypass).

---

## 5. Gráficos & Motion (data-viz + titulares)

- **Gráficas animadas (4)**: contador, barras, línea, dona (SVG, animadas).
- **Titulares poderosos (6 efectos)**: split_letters, glitch, shimmer, draw_on,
  gradient_sweep, tracking_in.
- **Generación automática** desde el transcript (`generate_graphics.py`): las gráficas
  solo salen si el contenido menciona números; los titulares salen siempre.
- **Densidad ~1 cada 10s** (escala con la duración) y **ultra variedad** (efecto, color,
  posición, tamaño y duración rotando — dos seguidos nunca repiten).
- Disponible en largos (toggle del wizard) y en shorts (estilos graphics_pro / max).

## 6. Virality Score (0-100)

Cada clip de un video largo recibe un **puntaje viral 0-100** (`virality.py`), calculado
local sin API con 6 factores: fuerza del hook, carga emocional, datos concretos, ritmo de
habla, duración (sweet spot 30-45s) y cierre/CTA. Los clips se reordenan de más a menos
viral y el wizard muestra un badge 🔥 con el puntaje + razones.

---

## 7. Assets (todos gratis / CC0)

- **Música**: 54 temas CC0 de FreePD vía GitHub (sin API key), por mood. Ampliable.
  También clientes opcionales de Freesound/Pixabay (requieren key gratis).
- **SFX**: banco sintetizado local + repo CC0 de GitHub + matching automático a la
  transcripción (palabra → sonido).
- **B-roll**: Pexels por transcripción (`autoMatchBroll`), fullscreen o PIP. Sólo en
  `broll_full`/`broll_pip` (los demás estilos nacen con `bRoll: []`). Antes de renderizar, el
  clip remoto se descarga y normaliza a local (`{DATA_ROOT}/assets/broll`) y se sirve vía
  `/api/assets/broll/stream` para que Remotion no seekee por HTTP frame-a-frame (render ~6× más
  rápido). Ver `docs/EFFECTS.md` §9.
- **Imágenes/overlays**: subida manual + matching a timestamps + modo cinematográfico.
- **Emojis**: 139 curados (renderizan a color). **Stickers animados (Lottie, 4)**:
  pulse_ring, sparkle, star5, arrow_down. **Iconos**: 30 (lucide).

---

## 8. Inteligencia artificial (local)

- **Transcripción**: WhisperX, palabra-a-palabra, ES; modo chunked para videos de 80-90 min.
- **Auto-clipping de largos**: Ollama lee todo y elige los momentos virales (mín 15);
  fallback heurístico si Ollama está offline.
- **Captions/hooks**: Claude Code / Codex / Ollama (OAuth, sin API keys) + dataset de
  hooks virales reales, tono LATAM, multi-red.
- **Voz IA**: Piper (TTS) + XTTS (clonación de voz).
- **Traducción**: argos-translate offline (texto).
- **Visión**: tracking de cara, quitar fondo (MediaPipe), texto-detrás-del-sujeto.
- **Audio**: detección de silencios (VAD) + corte, detección de beats (librosa).

> Nota: las features con **Ollama** caen a heurística si el modelo local está apagado.

---

## 9. Publicación y gestión

- **Redes**: LinkedIn (auto), Instagram (auto, requiere túnel), TikTok (listo, oculto
  hasta aprobación de su API). Bridge manual (copia el caption) como respaldo.
- **Programación**: scheduler con worker (LinkedIn/TikTok/IG bridge).
- **Métricas**: entrada manual + sync de LinkedIn (si la app está aprobada).
- **Producción ("Mis videos")**: galería de shorts; borrar individual o **en lote** (selección múltiple).
- **Editor ("Mis videos" subidos)**: subir, renombrar, **borrar** (del disco, con limpieza
  de derivados).
- **Limpieza automática**: al borrar un video, sus derivados (proyectos, renders,
  transcripts, cuts) se podan solos (~2x/día) y desaparecen del portal al instante.
  Trigger manual: `POST /api/maintenance/sweep`.

---

## 10. Rendimiento y robustez

- **Cola de render** persistente (serial), progreso en vivo, reconciliación tras reinicio.
- **Cache de duración** en el listado de videos (ffprobe no se re-spawnea por video en
  cada carga → listado ~20x más rápido en cargas repetidas).
- Listados con `Cache-Control: no-store` (siempre reflejan el disco real).
- Todos los pasos opcionales (FX, IA, assets) son **best-effort**: si fallan, el render
  igual sale (no rompen el pipeline).

---

## 11. Cómo se usa (rápido)

1. **Subí** un video en el editor (o importá un video largo en "Largos").
2. **Elegí** estilo, color y tipografía → "Crear automático".
3. El sistema transcribe, edita y renderiza en segundo plano (progreso en vivo).
4. En **Producción** generás el caption (IA), elegís redes y publicás/programás.
5. Para **largos**: el sistema propone clips con su **Virality Score**; elegís y renderiza.

---

## 12. Vs. el mercado (resumen)

Competimos con **Opus Clip / Submagic** en automatización (auto-clipping, virality score,
captions, gráficos, auto-reframe) con un costo **$0** vs. sus $19-39/mes + créditos de IA.
No somos un editor manual con timeline (CapCut/Premiere). Ventajas propias: clonación de
voz, texto-detrás-del-sujeto, gráficos automáticos y todo local/gratis sin watermark.

Huecos conocidos (futuro): publicación directa a YouTube Shorts, editor de transcript en
la UI, emojis a color uniformes (set Fluent), doblaje multi-idioma con re-timing.
