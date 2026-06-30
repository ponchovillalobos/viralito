# LOOP LOG — Consejo de Calidad Viralito

> Una entrada por loop. Formato: fecha · fase · foco · baseline→después · evidencia (comandos+salidas) · veredicto del consejo · próximo foco · docs tocados.

---

## Loop 1 — 2026-06-25 — PHASE 0 (definir objetivos)

**Foco:** construir el scorecard medible de TODO el sistema + el índice de docs. Cero cambios de código de la app.

**Evidencia medida (baselines reales):**
```
# gate de ingeniería (objetivo k)
cd frontend && npx tsc --noEmit        -> exit 0
cd remotion && npx tsc --noEmit        -> exit 0
cd frontend && npm test                -> Test Files 11 passed, Tests 124 passed
                                          Paridad estilos .ts:20 · .mjs:20 (OK)
# estilos (objetivo h)
style-registry.data.json               -> 23 ids (19 longForm)
# miniaturas (objetivo i)
frontend/public/theme-thumbs/*.png     -> 20 PNG (temas editoriales)
frontend/public/style-thumbs/*.png     -> 0 PNG (objetivo i baseline = 0/23)
# render (objetivos b,c) — observado en sesión (jobs 114iql/if1tqa)
render editorial 1920x1080 ~28-34s clip-> ~60-90s/clip; 8/8 MP4 principales válidos;
                                          variantes _fxfused a veces 0KB/768KB (gap)
# docs (objetivo p)
README/CLAUDE/CAPACIDADES dicen "22 estilos" -> registry tiene 23 (claim obsoleto)
```

**Entregables creados (no app code):**
- `docs/QUALITY_SCORECARD.md` — `status: READY-FOR-REVIEW`. 16 objetivos (a–p) sobre 10 dominios, cada uno con instrumento + baseline + tiers Bueno/Excelente/Perfecto + peso + experto dueño.
- `docs/INDEX.md` — mapa de 31 docs (26 en `docs/` + 5 en raíz) → dominio/objetivo/código/estado; deuda de docs registrada.
- `docs/LOOP_LOG.md` — este archivo.

**Veredicto del consejo (10 expertos):** scorecard firmado. Retos al usuario registrados en el scorecard (§Resumen): prohibido objetivo sin número; distinción visual de miniaturas (no solo "existe"); ⚠️ rendimientos decrecientes en WER 5% y render 40s; hueco no pedido `_fxfused` inválidos; deuda "22→23 estilos". Pendiente de medición que necesita server: `/api/doctor?deep=1` (objetivo m); y instrumentos a construir: WER (e), eval de prompts (g), throughput largos (d), onboarding (n), telemetry de timing/uso (c/j/o).

**Próximo foco (cuando status=APPROVED):** orden por impacto÷riesgo, BAJO riesgo primero → (i) miniaturas pre-generadas, (p) docs, (k) CI gates, (o) telemetry. Lo que toca render/IA/pipeline se PROPONE y PAUSA.

**Docs tocados:** QUALITY_SCORECARD.md (nuevo), INDEX.md (nuevo), LOOP_LOG.md (nuevo).

**STOP — esperando aprobación del usuario** (marcar `status: APPROVED` en el scorecard).

---

## Loop 1 (rev) — 2026-06-25 — PHASE 0 — integración del prompt refinado (Ultraplan)

**Foco:** alinear los 3 archivos de estado al prompt refinado aprobado por el usuario (Ultraplan). Sin cambios de código de la app.

**Cambios vs versión 1:**
- Scorecard re-numerado a **17 objetivos a–q** (antes 16). **Nuevo (h): Matching de SFX al contexto** (`match_sfx_to_transcript.py`, baseline ~3/10 según audit — "perdí dinero" dispara *bling* alegre).
- Objetivo (j) Miniaturas: instrumento ahora es un **script NUEVO `remotion/generate-style-thumbs.mjs`** (hermano de `generate-theme-thumbs.mjs`), no un genérico.
- Guardas: agregadas las **reglas virales del proyecto** (subtítulos siempre visibles, stickers top-center, mono-color por video, sin emojis al inicio del caption, hashtags ES sin acentos).
- **Discrepancia spec↔código registrada (objetivo q):** el prompt refinado asume *paridad 23↔23*; el medido es **20↔20** (registry 23 ids, style-templates 20 bloques). Se mantiene el número real 20↔20; reconciliar el gap es tarea de (q)/(l).

**Evidencia (re-confirmada):** tsc frontend 0 · tsc remotion 0 · 124 tests · paridad **20↔20** · registry **23** ids (19 largos) · style-thumbs **0/23**.

**Docs tocados:** QUALITY_SCORECARD.md (v2), INDEX.md (v2), LOOP_LOG.md (esta entrada).

**STOP — esperando aprobación del usuario** (marcar `status: APPROVED`).

---

## Loop 2 — 2026-06-29 — PHASE N — objetivo (j) Miniaturas pre-generadas (BAJO riesgo, auto)

**Foco:** (j) miniaturas reales por estilo. Usuario aprobó con "continua" → `status: APPROVED`.

**Cambio (aditivo, bajo riesgo):**
- NUEVO `remotion/generate-style-thumbs.mjs` — recorre los 23 ids de `style-registry.data.json`, arma cada project con `buildProjectForStyle(ctx, styleId)` (mismo builder del render real → miniatura honesta), saca un `remotion still --scale=0.25` sobre el video `avatar`, valida >10KB/no-negro, copia a `frontend/public/style-thumbs/{id}.png`.
- `frontend/src/components/editor/wizard/style-mini-demo.tsx` — `StyleMiniDemo` ahora muestra el PNG real primero (`/style-thumbs/{id}.png`), con fallback al demo CSS vía `onError`. Cablea AMBOS wizards (ya usaban StyleMiniDemo) sin tocarlos.

**Evidencia:**
```
node remotion/generate-style-thumbs.mjs   -> 23/23 miniaturas (180–253 KB, válidas)
ls frontend/public/style-thumbs/*.png     -> 23 PNG
cd frontend && npx tsc --noEmit           -> 0
cd frontend && npm test                   -> 124 tests, paridad 20↔20
cd remotion && npx tsc --noEmit           -> 0
```
Verificado a ojo: `hype_max_sfx.png` = la mujer del video con stickers rosados (render real, distinto).

**Resultado:** objetivo (j) **0/23 → 23/23 stills + cableado = nivel Excelente** ✅. Perfecto (GIF) pendiente. **Live tras rebuild del standalone** (el server actual es el build viejo en uso por el usuario; no se rebuildea para no interrumpir).

**Veredicto QA:** gate verde, sin regresión, offline intacto. Aprobado para commit autónomo (bajo riesgo).

**Próximo foco:** (q) Documentación — corregir "22→23 estilos", reconciliar paridad 20 vs 23, completar INDEX.

**Docs tocados:** QUALITY_SCORECARD.md (objetivo j + próximos focos), LOOP_LOG.md (esta entrada), INDEX.md (generador + style-thumbs).

---

## Loop 3 — 2026-06-29 — PHASE N — objetivo (t) Volumen de música en el wizard (BAJO riesgo, auto)

**Foco:** el usuario pidió bajar el volumen de la música para que no tape el audio original. Nuevos objetivos r/s/t/u agregados al scorecard.

**Cambio (aditivo, bajo riesgo) — factor multiplicador (preserva el tuning por estilo):**
- `long-form-wizard.tsx`: slider "Volumen de música" 0–100% (`musicVolumePct`, default 100) en el Step 3; se envía `musicVolume: pct/100` en ambos bodies.
- `process/route.ts`: `musicVolume?` en el body; pushea `--music-volume <0..1>` solo si <1.
- `long_form_pipeline.py`: arg `--music-volume` (float) → `build_one_clip(music_volume=...)` → build_args argv[10].
- `build-clip-supreme.mjs`: lee argv[10]; tras `buildProjectForStyle`, `project.musicVolume *= factor` (clamp 0..1). El ducking (musicVolumeCurve) sigue operando sobre el nuevo base.

**Evidencia (prueba funcional real):**
```
build-clip-supreme motion_grid SIN factor   -> musicVolume 0.14
build-clip-supreme motion_grid con "0.3"    -> musicVolume 0.042  (= 0.14 × 0.3) ✓
cd frontend && npx tsc --noEmit             -> 0
cd frontend && npm test                     -> 124 tests, paridad OK
python -m py_compile long_form_pipeline.py  -> OK
```

**Resultado:** objetivo (t) **HECHO** ✅. Live en el wizard tras rebuild del standalone.

**Veredicto QA:** gate verde, sin regresión, additive. Aprobado para commit autónomo.

**Próximo foco:** (r) textos repetidos — INVESTIGAR (es fix de render → propuesta + pausa para aprobación). Luego (s) validación transcripción/traducción, (u) descripciones.

**Docs tocados:** QUALITY_SCORECARD.md (nuevos objetivos r/s/t/u), LOOP_LOG.md (esta entrada).

---

## Loop 4 — 2026-06-29 — PHASE N — objetivo (r) Textos repetidos ("revisalos todos")

**Foco:** el usuario pidió revisar TODOS los estilos por textos repetidos.

**Instrumento (bajo riesgo, ya commiteado 7a0cb0a):** `python/check_text_overlap.py` mide repeticiones en pantalla (overlay ≈ subtítulo hablado / overlays solapados / títulos duplicados). **Baseline: 31 repeticiones en 19/30 clips.** Patrón dominante: editorial `card.title` ≈ el subtítulo baseline (similitud hasta 1.00) → el titular serif y el subtítulo de abajo muestran la misma frase.

**Fix (render — el usuario aprobó con "revisalos todos" + "haz pruebas"):**
- `remotion/src/ViralVideo.tsx`: nuevo `activeEditorialCardWithText`; el `EditorialSubtitleBaseline` se OMITE mientras una tarjeta editorial con título/subtítulo está activa (el titular ya muestra esa frase → las palabras siguen visibles; entre tarjetas el baseline reaparece). Respeta "subtítulos siempre visibles" (el texto está en el titular).
- `python/check_text_overlap.py`: check #1 ahora salta `card.*` (el baseline se suprime durante tarjetas → no co-ocurren).

**Evidencia (medida + visual):**
```
check_text_overlap --limit 30   ANTES: 31 repeticiones / 19 clips
                                 DESPUÉS: 1 / 1 clip   (−97%)
still editorial c08 @5s: el subtítulo "Número tres…" que duplicaba el titular "Número dos…" DESAPARECIÓ
still @26s (sin tarjeta): baseline "podamos ser más entendibles" SÍ visible (no se eliminó global)
tsc remotion 0 · tsc frontend 0 · 124 tests · paridad OK
```

**Resultado:** objetivo (r) **31 → 1 = Excelente** ✅. Residual: 1 caso `card.subtitle+dataViz` (borde; ⚠️ rendimiento decreciente para llegar a 0).

**Próximo foco:** (s) validación transcripción/traducción (construir instrumento) · (u) descripciones (verificar completitud).

**Docs tocados:** ViralVideo.tsx, check_text_overlap.py, QUALITY_SCORECARD.md (r 31→1), LOOP_LOG.md.
