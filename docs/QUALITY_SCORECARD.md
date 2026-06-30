# QUALITY SCORECARD — Viralito

```
status: APPROVED  (usuario: "continua" → arranca PHASE N por lo de bajo riesgo)
version: 2  (alineado al prompt refinado de Ultraplan — objetivos a–q)
generado_por: Consejo de Calidad (10 expertos) — PHASE 0 del /loop
fecha: 2026-06-25
```

> **Qué es esto.** La "definición de perfecto" MEDIBLE de la app. Cada objetivo tiene un **instrumento** concreto (comando/script/archivo que lo mide) y un **número**. Targets escalonados **Bueno / Excelente / Perfecto**. Los loops de mejora (PHASE N) miden contra esto y suben de a un nivel. Reglas/consejo/flujo: prompt del `/loop` + [`docs/INDEX.md`](INDEX.md) · bitácora: [`docs/LOOP_LOG.md`](LOOP_LOG.md).
>
> **Baseline.** Medido AHORA salvo donde dice *(observado en sesión)* / *(audit)* / *(instrumento a construir)*.

## Resumen del consejo (firma + retos)

Promedio auto-declarado del repo: **5.6/10**, meta "supremo" ≥8.5 (`docs/AUDITORIA-SUPREMO.md`: Motor 6.9, Python/IA 5.5, Frontend 5.5, Largos 4.8, Robustez 5.2). Gate de ingeniería **verde HOY**: tsc 0, **124 tests**, **paridad 20↔20**. **23 estilos** en registry (19 largos).

**Lo que el consejo RETÓ:**
1. *"Optimizado/perfecto"* sin número está prohibido — toda fila lleva instrumento + cifra. Sin medición posible hoy (WER, prompts, SFX, throughput) → **el primer trabajo del objetivo es construir el instrumento**.
2. **Discrepancia spec↔código detectada:** el prompt refinado asume *paridad 23↔23*, pero el medido es **20↔20** (registry tiene 23 ids; `style-templates` define 20 bloques — 3 ids del registry no tienen bloque propio en el parity). A reconciliar: ¿por qué 23 vs 20? Mientras tanto el número real es **20↔20**.
3. **Miniaturas (j):** existen 20 theme-thumbs (temas editoriales) pero **0/23 por estilo**. Reto: medir **distinción visual** (que 2 estilos no se vean iguales), no solo "existe el PNG".
4. **Rendimientos decrecientes** marcados ⚠️ (WER 5%, render 40s) — priorizar Excelente y seguir.
5. **Hueco no pedido:** `_fxfused` variants a veces 0KB/768KB *(observado)* → la tasa de éxito real es peor si se cuentan → en (b).
6. **Deuda de docs (q):** README/CLAUDE/CAPACIDADES dicen "22 estilos"; el registry tiene **23**.

---

## A. Render & Offline — *Experto 1*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| a | Render 100% offline | render con DNS cortado → MP4 válido | render real red bloqueada + `ffprobe`; fuentes lazy `remotion/src/layers/local-editorial-fonts.ts` | Editoriales offline-OK *(sesión, fix fuentes lazy)*; 23+largos no verificado con DNS off | 1 estilo | todos los editoriales | **23 + largos** | 10 |
| b | Tasa de éxito de render | % MP4 válido (>100KB, dims+duración, audio) **incl. `_fxfused`** | lote + `ffprobe` + `frontend/src/lib/orphan-sweep.ts` `MIN_RENDER_BYTES` | principales 8/8 *(sesión)*; **`_fxfused` a veces 0KB/768KB** | 97% | 99% | 100% incl. fxfused | 9 |

## B. Performance & Throughput — *Experto 2*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| c | Render p50 por clip ~30s | s/clip (1920×1080 editorial, CPU) | render cronometrado + timing en `telemetry.ts` *(persistir timing de éxito)* | ~60–90s/clip *(observado)* | ≤90s | ≤60s | ≤40s ⚠️ | 6 |
| d | Throughput largos | video 80 min → clips listos | pipeline cronometrado `python/lf_render_pool.py` + `long_form_pipeline.py` *(instrumento a construir)* | ~30 min/8 clips de fuente ~28 min *(sesión)*; 80 min sin medir | ≤45 min | ≤30 min | ≤20 min | 6 |

## C. IA / ML — *Experto 3*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| e | WER transcripción ES | Word Error Rate | **a construir** `python/eval_wer.py` + clip ref. con transcript ground-truth | sin medir | ≤12% | ≤8% | ≤5% ⚠️ | 8 |
| f | Honestidad de clips / virality | top-clips reales vs clickbait | `python/virality.py` (existe, largos) + **rúbrica a construir** anti-clickbait, N clips | virality 0-100 (largos); sin rúbrica honestidad | rúbrica + ≥70% honestos | ≥85% | ≥95% | 7 |
| g | Calidad de prompts | score rúbrica por proveedor (claude/codex/ollama) | **a construir** harness eval sobre muestras (`python/generate_caption.py`, `analyze_clips.py`) | sin medir | rúbrica + ≥7/10 | ≥8.5/10 | ≥9/10 | 6 |
| h | **Matching de SFX al contexto** | % SFX correctos vs transcript en muestra etiquetada | **a construir** muestra etiquetada vs `python/match_sfx_to_transcript.py` | **~3/10** *(audit: "perdí dinero" dispara *bling* alegre)* | ≥60% | ≥80% | ≥95% | 6 |

## D. Estilos & Editorial — *Expertos 4 + 5*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| i | Cobertura & distinción de estilos | ¿23 alcanzan? distinción visual | conteo `style-registry.data.json` + distancia perceptual entre style-thumbs *(depende de j)* + revisión Experto 4/5 (editorial_full/broll en sesión OK) | 23 estilos (19 largos); distinción **no medida** | mapa por familia | 0 pares casi-idénticos | gaps cubiertos + cada par distinto + 3 variantes editoriales "pro" | 6 |

## E. UX, Wizard & Preview — *Experto 6*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| j | **Miniaturas pre-generadas por estilo** | 23 PNG >10KB, no-negras, distintas, cableadas en wizard | `remotion/generate-style-thumbs.mjs` (hermano de `generate-theme-thumbs.mjs`: reusa still + validación tamaño/no-negro) sobre `avatar`; Next :3100 → `frontend/public/style-thumbs/{id}.png`; cableado en `style-mini-demo.tsx` (PNG primero, fallback CSS) | **23/23 stills** generadas (180–253 KB, válidas) + cableadas → **nivel Excelente** ✅ *(live tras rebuild del standalone)* | editorial cubierto | **23 stills ✅** | 23 + GIF movimiento | 8 |
| k | Flujo del wizard | "Siguiente" visible + "Crear" 1 clic + pasos mínimos + funnel | inspección + **telemetry de pasos a construir** (`telemetry.ts`) | nav fija + "Crear" 1 clic *(sesión)*; funnel **no instrumentado** | nav+crear OK | + funnel medido | + abandono < umbral | 6 |

## F. Ingeniería & Tests — *Experto 9 (QA, VETO)*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| l | Gates verdes | tsc 0 + tests + paridad | `cd frontend && npx tsc --noEmit && npm test`; `cd remotion && npx tsc --noEmit` | **tsc 0, 124 tests, paridad 20↔20** *(medido HOY)*; remotion-tsc + py_compile **no** en CI | actual | + remotion-tsc + py_compile en CI | + smoke de render en CI | 9 |
| m | Cobertura de caminos críticos | tests de render/cola/largos | vitest `frontend/src/**/__tests__` | 124 tests; render/cola/largos ≈ 0% directo ("tests 3/10") | +1 suite crítica | render+cola+largos cubiertos | cada bug fija un test de regresión | 6 |

## G. Assets & Licencias — *Experto 7*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| n | Assets completos + licencias | conteos vs umbral + 0 no-libres | `GET /api/doctor?deep=1` (música≥40, sfx≥150, lottie≥25, iconos≥9000) + `remotion/license-check.mjs` | umbrales definidos; **doctor sin correr** (necesita server) | doctor verde | + license-check CC0/OFL/Apache 0 alertas | + manifiesto de licencias por asset | 5 |

## H. Producto & Onboarding — *Experto 10*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| o | Instalar → primer video | minutos en PC limpia | cron del setup (`python/setup_all.py` / `bootstrap.ps1`) + 1er render | sin medir (meta ROADMAP <30 min) | ≤30 min | ≤20 min | ≤10 min | 7 |

## I. Métricas & Aprendizaje — *Experto 8*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| p | Loop que aprende | cobertura instrumentación + insights accionables | `frontend/src/lib/telemetry.ts` (parcial) + `/api/metrics/insights` | telemetry solo errores; **sin timing de éxito ni uso por estilo** | + timing éxito | + uso por estilo | insights sugieren mejor estilo/música | 5 |

## J. Documentación — *Experto 9 + 10*

| # | Objetivo | Métrica | Instrumento | Baseline | Bueno | Excelente | Perfecto | Peso |
|---|---|---|---|---|---|---|---|---|
| q | Documentación sincronizada | doc refleja código + INDEX completo | barrido claims doc-vs-código + revisión [`INDEX.md`](INDEX.md) | INDEX creado; **≥1 claim obsoleto** ("22 estilos" vs 23) + spec dice "23↔23" vs real 20↔20 | INDEX completo | 0 claims obsoletos | cada cambio actualiza sus docs en el mismo loop | 6 |

---

## Guardas heredadas del prompt (recordatorio para PHASE N)
Aditivo / 1 cambio por loop · gate verde + render real cada loop · offline jamás se rompe (TTF lazy, nunca @remotion/google-fonts; IA→Ollama) · `.env.local` nunca se commitea · assets SOLO CC0/OFL/Apache · **reglas virales intactas: subtítulos siempre visibles, stickers SIEMPRE top-center, mono-color por video, sin emojis al inicio del caption, hashtags en español sin acentos** · push solo si el usuario lo pide.

## Próximos focos (impacto÷riesgo, BAJO riesgo primero)
1. ~~**(j) Miniaturas**~~ ✅ **HECHO** (loop 2): generador + 23/23 stills + cableado en `style-mini-demo.tsx`. Pendiente Perfecto = GIF en movimiento.
2. **(q) Docs** — corregir "22→23", reconciliar paridad 20 vs 23, completar INDEX. Auto. ← **próximo**
3. **(l) Gates CI** — remotion-tsc + py_compile. Auto.
3. **(l) Gates CI** — remotion-tsc + py_compile. Auto.
4. **(p) Telemetry** timing/uso — habilita medir (c)/(k). Auto.
5. **(e/g/h) Construir instrumentos IA** (WER, eval prompts, SFX) — instrumento Auto; el cambio de prompt/SFX RIESGOSO → pausa.
6. **(a/b/c/d/f/i)** render/pipeline/IA → **RIESGOSO**: proponer + PAUSAR.

> Para arrancar PHASE N: cambiá `status: APPROVED` y relanzá `/loop`.
