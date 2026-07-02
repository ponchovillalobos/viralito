# Plan de Mejoras Viralito — Julio 2026

> Auditoría exhaustiva con 6 agentes simultáneos (2026-07-02): rendimiento, interfaz/UX,
> funcionalidades/robustez, estilos/assets + investigación web de competidores 2025-2026
> (OpusClip, Submagic, Vizard, Klap, Riverside, Metricool) y mejores prácticas técnicas
> (Remotion, faster-whisper, ffmpeg NVENC, APIs de publicación).

## Diagnóstico global

| Dominio | Estado | Nota |
|---|---|---|
| Funcionalidad end-to-end | ✅ Sólida | 101 rutas API, 23 estilos, pipeline largos 7 pasos, scheduler con retry |
| Rendimiento | ⚠️ Mejorable | Shorts renderizan EN SERIE; APIs sin caché; pipeline largos secuencial |
| Interfaz | ⚠️ Mejorable | 28 problemas: 6 graves (errores silenciosos), 20 medios (accesibilidad/estados) |
| Estilos | ⚠️ 5.6/10 | Meta "supremo" 8.5; falta motion blur, SFX ciego, duplicación 95% en variantes |
| Robustez | ⚠️ Riesgos | Instagram sin refresh token, scheduler no verifica render en disco, tests no cubren scheduler/uploads |
| vs Competidores | 💰 Ventaja | Cubrimos el core que cuesta USD 50-90/mes en la nube; faltan 6 features de retención 100% viables local |

---

## FASE 1 — Quick wins (≈1 semana, bajo riesgo)

### 1.1 Interfaz: matar errores silenciosos (ALTA prioridad UX)
Todos los `.catch(() => {})` tragan errores sin avisar. El usuario ve pantallas vacías sin saber por qué.
- `production-list.tsx:184` — batch delete con `Promise.all().catch(() => false)` → `Promise.allSettled` + toast con conteo de fallos
- `publish-calendar.tsx:79,120` — fetch calendario y settings silenciosos → toast de error
- `long-form-wizard.tsx:~480` — fetch lista de largos silencioso → toast
- `research-workspace.tsx:123,1300,1400` — 3 fetches + modal de adaptación SIN spinner (parece congelado) → Loader2 + "Generando versión con tu voz…"
- `wizard-client.tsx:~625` — fetch música silencioso → toast
- `schedule-dialog.tsx:~150` — JSON parse silencioso → toast

### 1.2 Interfaz: upload de largos con progreso visible
`long-form-wizard.tsx:~650` — hoy no se ve "Subiendo 52 de 120 MB". Agregar barra de % (el streaming ya existe).

### 1.3 Rendimiento: APIs calientes
- `/api/projects` (route.ts:48-85) — lee 100+ JSONs por request, ~100 requests/sesión → caché en memoria con TTL 30-60s invalidada al escribir
- `/api/viral-ranking` (route.ts:66-69) — readFile SERIAL → `Promise.all`; matching O(n²) (109-115) → índice `Map<slugNormalizado, clip>`
- `python/virality.py:26-50` — pre-compilar regexes

### 1.4 Robustez: scheduler
- Verificar existencia del render ANTES de crear entry y al inicio de `processUpload` (scheduled-uploads.ts:228) → error claro "el video ya no existe, regeneralo" en vez de ENOENT
- Aviso visible en /publicar cuando un post queda `failed` (hoy falla en silencio)
- Recordatorio en UI: los posts solo se publican con la app abierta

### 1.5 Interfaz: pulido accesible (media prioridad)
- 18+ botones icon-only sin `aria-label`/`title` (production-list, music-picker, animations-panel, broll-picker, thumbnail-button, video-list, metrics-table, schedule-dialog)
- Skeletons durante loading (calendario, wizard, largos)
- Empty states con CTA (propuestas de largos vacías, listas vacías)
- Hints en botones deshabilitados ("Generá descripción primero")

**Ganancia estimada Fase 1:** app se siente confiable (nunca "muere en silencio") + 5-20s menos por sesión de navegación + scheduler a prueba de renders borrados.

---

## FASE 2 — Retención de videos: las 6 palancas locales (≈2-3 semanas)

Features que los competidores cobran USD 15-49/mes, 100% viables offline con nuestro stack.
Ordenadas por impacto según evidencia de retención 2026 (hook 1-3s decide 71%; captions word-by-word = +12-15% completion; 85% mira sin audio):

1. **Auto-zoom / punch-in dinámico** (Submagic "Auto Zooms") — zoom-in en picos de energía del audio + keywords del transcript. Ya calculamos RMS para facetrack; agregar keyframes de `scale` en Remotion. **La palanca de retención #1 de 2026.**
2. **Corte de silencios + muletillas** (Vizard/Descript) — VAD + word timestamps ya existentes; detectar "eh/este/o sea" + pausas muertas y recortar segmentos. Sube densidad y completion.
3. **Score de viralidad EXPLICABLE** — no solo el número: desglose (hook, emoción, pacing, cierre) + sugerencia de mejora. La queja #1 de OpusClip es su score caja negra. Diferenciador directo.
4. **Generador de hooks + variantes A/B** — LLM local genera 2-3 hooks para los primeros 3s; Remotion renderiza variantes del mismo clip para testear.
5. **SFX context-aware** (FASE 1.5 de AUDITORIA-SUPREMO) — match_sfx.py hoy es ciego al sentimiento ("perdí dinero" → bling alegre). Sentiment local + diccionario español. 3/10 → 7/10.
6. **Estilo KARAOKE real** — palabra-por-palabra con color activo + beat-sync (trending +40% en Submagic/CapCut). Nuevo estilo sobre kinetic_type/pop_reels. 4-6 h.

Además, del plan "supremo":
7. **Motion blur en transiciones** — afecta los 23 estilos, whip/zoom/flip3d se ven "congeladas". +1.2 puntos. 4-6 h.
8. **Previews de estilos EN MOVIMIENTO** — 3s de video real por estilo en el wizard (hoy PNG estático; los 138 PNG ya existen). ~10 MB de disco, 3-4 h. Benchmark: Canva/OpusClip/CapCut todos lo tienen.

---

## FASE 3 — Rendimiento profundo + deuda técnica (≈2 semanas)

### Rendimiento
- **Pool de renders para shorts** — hoy `render-server.mjs:265` serializa; con pool N=3 (como ya hace lf_render_pool en largos): 50 renders × 60s = 50 min → ~17 min
- **faster-whisper 1.2.1 + BatchedInferencePipeline** (`batch_size=16`, `int8_float16`, modelo turbo) — benchmark: 13 min de audio en ~16s (RTX 3070Ti). Offline ✔
- **Pipeline ffmpeg 100% GPU** para recorte/reencuadre: `-hwaccel cuda -hwaccel_output_format cuda` + `scale_cuda` + `h264_nvenc -preset p7 -tune hq -rc vbr -cq 19` — 10-50x realtime, sin roundtrip PCIe. Offline ✔
- **loudnorm 2-pass a -14 LUFS** (target de todas las redes): `I=-14 TP=-1.5 LRA=11` (o ffmpeg-normalize). Audio consistente entre posts
- **One Euro filter** en el centro del crop del reencuadre — mata el jitter sin lag; reset del filtro en cortes de escena. Reemplaza suavizado actual
- **DAG en pipeline de largos** — detect+cut en paralelo con re-transcribe donde sea seguro: 10-15 min de ganancia por video largo
- **transcribe.py: auto-chunking >15 min** — evita OOM (hoy 1h de video ≈ 4GB+ RAM)
- Remotion: `audioCodec: "mp3"` en etapa de combinado (mucho más rápido que aac), evaluar tag `<Video>` nuevo, `npx remotion benchmark` para afinar concurrency
- (Opcional, medir primero) NVENC en Remotion v4.0.484+ para largos/FX — requiere ffmpeg propio con NVENC en Windows (`--binaries-directory`); en shorts NO ayuda (frame render es el cuello, no el encode)

### Deuda técnica / robustez
- **Refactor editorial** (editorial/full/broll, 95% overlap) y **broll** (full/pip, 96%) → base compartida; bugs se arreglan en 1 lugar
- **Parity gate → spec JSON compartido** — el regex actual (check-style-parity.mjs:44-63) no chequea props anidadas; la divergencia de 2026-06 (largos sin LUT) puede repetirse
- **Tests de caminos críticos** — scheduler (runTick/processUpload/retry), token refresh, upload APIs: hoy CERO cobertura
- **Tracking facial robusto** — YuNet/SCRFD (ONNX) en vez de Haar fallback (falla >45°); ByteTrack para identidad entre frames
- Retry del scheduler con backoff (hoy ventana fija de 10 min pierde reintentos)
- Validación de input en `/api/long_form/process` y `/api/videos/render` (styles inválidos hoy pasan en silencio)

---

## FASE 4 — Expansión (mes 2)

1. **YouTube Shorts como siguiente red** — la de MENOR fricción 2026: `videos.insert` bajó de 1600 a ~100 unidades de cuota (≈100 uploads/día gratis), funciona con canal personal, OAuth simple. TikTok/Instagram requieren auditoría/cuenta business. Bonus: YouTube SÍ da analytics por API → habilita el loop de aprendizaje
2. **Supercuts / highlight reel** (Mejora B pendiente) — stitch de los top-N momentos ya detectados
3. **Loop de analytics → score** — traer métricas reales (YouTube API; LinkedIn personal está bloqueado por Partner Program) y ajustar el score de viralidad por cuenta
4. **Layout multi-hablante** — diarización local (pyannote/WhisperX) + corte del crop al hablante activo
5. **Brand kit** — logo, colores, fuente, watermark como preset persistido
6. **Formato 1:1 real en estilos** — la auditoría marca 0/23 estilos generando 1:1 (el wizard lo ofrece) → verificar y cablear; también silent/punch/text_behind sin 16:9
7. **Estilos nuevos de nicho** — LO-FI/ASMR (2-3 h) y Documental ligero (3-4 h)
8. **Limpieza de audio 1-click** — DeepFilterNet/RNNoise local antes del render
9. **Cifrado de tokens OAuth en reposo** (AES + keyfile local) — hoy user-settings.json en texto plano
10. **Refresh de tokens con cron interno** — LinkedIn refresh existe pero solo se dispara al usarlo; Instagram no tiene refresh (limitación de Meta, documentar reconexión cada 60 días)

### Requiere API externa (opt-in, decidir después)
- Dubbing/traducción de voz (Klap, 29 idiomas) — local con XTTS es viable pero calidad media
- B-roll generativo (Veo/Kling) cuando Pexels no tiene el clip
- Eye-contact correction, avatares IA — solo API, baja prioridad

---

## Correcciones a reportes de agentes (verificado en sesión)
- TikTok NO "funciona" público: solo sandbox/inbox; direct-post real requiere auditoría (docs/TIKTOK-AUDITORIA.md, 90% listo)
- Música: memoria de sesiones dice 78 pistas; auditoría contó 54 en C:\viral-data — reconciliar conteo antes de tocar umbrales del doctor

## No tocar (reglas vigentes)
- Creación de videos funciona: cambios al motor de render/wizard/largos son RIESGOSOS → pausar y consultar antes
- Offline nunca se rompe (fuentes TTF locales, sin red en render)
- Assets solo CC0/OFL/Apache/MIT; .env.local jamás se commitea
- Gate antes de cada commit: `cd frontend && npx tsc --noEmit && npm test` (+ parity)
