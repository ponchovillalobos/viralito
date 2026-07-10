# Mejores Momentos (highlight reel one-shot)

De UN video largo (charla/podcast/webinar de 1-2 h) genera **UN solo video de ≤3 min**
con los momentos más increíbles/virales, **secuenciados por emoción**. No son N clips
sueltos: es un montage cohesivo, con subtítulos, música y estilo unificados.

**Adaptativo:** la duración depende de la CALIDAD del material. Si solo hay 90 s de oro,
el reel dura 90 s — nunca se rellena con relleno. Tope duro: 3 minutos.

## Cómo se usa

En el wizard de largos (`/largos`), Paso 4, tarjeta **🏆 Mejores Momentos** →
"Crear video de mejores momentos (≤3 min)". Elegí un estilo y un color como siempre.
Es **one-shot**: subís el video largo y sale el reel, sin pre-renderizar clips sueltos.

CLI directo:

```
python long_form_pipeline.py <video_id> --highlights [--highlights-max-seconds 180]
                             --styles supreme --aspect-ratio 9:16
```

## Cómo elige los momentos (el corazón)

`python/highlights.py` fusiona **tres señales que ya existen** en el proyecto:

1. **LLM con un prompt dedicado súper detallado** (`build_highlights_prompt`, distinto del
   de `analyze_clips.py`): busca CHISPAZOS de 8-30 s — remates que hacen reír, giros
   contraintuitivos, quotes citables, datos que impactan, revelaciones, picos emocionales —
   cada uno clasificado con `punchType`, `emotion` e `intensity`. Reusa el provider
   offline-aware (claude > codex > ollama) y el chunking para videos largos.
2. **`virality.py` `score_clip`** — score determinista 0-100 (hook/emoción/datos/ritmo/…).
3. **`emotion_director.py`** — curva de arousal + picos emocionales del AUDIO (librosa):
   los picos correlacionan con risas/gritos/clímax. Un momento que cae sobre un pico sube.

**Score fusionado** = `0.45·LLM + 0.30·virality + 0.25·arousal`. Selección **greedy adaptativa**:
suma momentos hasta llenar ≤180 s SIN bajar de un umbral de calidad (default 52); si el
material es flojo, corta antes → reel más corto. **Orden por arco emocional**: gancho más
fuerte al inicio → construcción (arousal creciente, emociones alternadas) → cierre memorable.

## Cómo se arma (reuso máximo, corte duro)

1. `extract_clips.extract_clip()` recorta cada momento (aspect/reframe) → segmentos uniformes.
2. Concat con **corte duro** (estilo viral 2026) → `clips/{video_id}_highlights_c01_reel.mp4`.
3. Se **re-transcribe el montage** (≤3 min → rápido) → karaoke exacto, sin aritmética de offsets.
4. El montage se trata como un **"clip sintético"** (`{video_id}_highlights_c01_reel`) con una
   proposal sintética de 1 clip → el pipeline de render supreme lo procesa **sin cambios**
   (subtítulos + UNA música + ducking + estilo unificados) → `renders/…_{style}.mp4`.

## Salidas

- `long_form/highlights/{video_id}.json` — curaduría auditable (momentos + emoción + scores).
- `long_form/proposals/{video_id}_highlights.json` — proposal sintética (1 clip).
- `long_form/clips/{video_id}_highlights_c01_reel.mp4` — el montage (corte duro).
- `long_form/transcripts/{video_id}_highlights_c01_reel.json` — transcript re-alineado.
- `long_form/renders/{video_id}_highlights_c01_reel_{style}.mp4` — el video final.

Aparece en **"Mis videos"** con el título "Mejores Momentos" (`viral-meta.ts`); el
`orphan-sweep` lo atribuye al video real (`longFormOwner`) y **nunca lo borra**.

## Diferencia con el "Supercut"

El **Supercut** (`python/supercut.py`, botón aparte) junta clips **ya renderizados**
individualmente (útil si ya generaste clips). **Mejores Momentos** es **one-shot** sobre
el video crudo, con selección dedicada + secuencia por emoción + render unificado. Ambos
coexisten.

## Transiciones

v1 = **cortes duros** (el ritmo viral 2026). Las transiciones suaves (xfade/whip) se
sumarían en el paso de concat de `highlights.assemble_montage` o inyectando
`proTransitions` en los timestamps de junta del clip sintético (pass-through ya existente
en `build-clip-props.mjs`).
