# INDEX — Mapa de documentación (tejido conectivo)

```
status: vigente
version: 2  (alineado al prompt refinado de Ultraplan + scorecard v2, objetivos a–q)
fecha: 2026-06-25
proposito: memoria entre loops. Cada loop del /loop LEE este índice ANTES de actuar y lo ACTUALIZA después de cada cambio. Sin esto se pierde contexto entre iteraciones.
```

> **Cómo usarlo.** Antes de tocar un objetivo del [`QUALITY_SCORECARD.md`](QUALITY_SCORECARD.md), abrí acá qué doc(s) describen esa feature y qué archivos de código toca. Después de cualquier cambio, actualizá el/los doc(s) afectados + su fila acá + el [`LOOP_LOG.md`](LOOP_LOG.md). Estado por doc: **vigente** | **desactualizado** | **histórico** (plan ya ejecutado, no es fuente de verdad viva).

## Estado / memoria del loop (leer primero)

| Doc | Rol |
|---|---|
| [QUALITY_SCORECARD.md](QUALITY_SCORECARD.md) | Objetivos medibles ("definición de perfecto"), tiers, baselines, dueños. **Fuente de verdad de calidad.** |
| [LOOP_LOG.md](LOOP_LOG.md) | Bitácora: una entrada por loop (foco, baseline→después, evidencia, docs tocados). |
| INDEX.md (este) | Mapa doc↔dominio↔objetivo↔código↔estado. |

## Documentación de producto / arquitectura (fuente de verdad viva)

| Doc | Dominio | Objetivos scorecard | Código principal | Estado |
|---|---|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitectura general, pipelines largos/shorts | a,b,c,d | `python/long_form_pipeline.py`, `frontend/src/app/api/editor/auto-build/*`, `remotion/*` | vigente |
| [CAPACIDADES.md](CAPACIDADES.md) | Inventario de features | todos | (transversal) | **desactualizado** (revisar "22 estilos" → 23; objetivo p) |
| [STYLES.md](STYLES.md) | Estilos + temas editoriales + SFX | h,h2,i | `frontend/src/lib/style-registry.data.json`, `style-templates.ts`, `remotion/style-templates.mjs` | **revisar** (¿incluye editorial_full?) |
| [EFFECTS.md](EFFECTS.md) | FX del motor Remotion | b,h2 | `remotion/src/scene-fx.tsx`, `remotion/src/layers/*` | vigente |
| [CINEMATIC_MODE.md](CINEMATIC_MODE.md) / [CINEMATIC_TIMELINE.md](CINEMATIC_TIMELINE.md) | Modo cine | h2 | `frontend/src/app/api/editor/auto-build/lib/cine-clasico.ts`, `ViralVideo.tsx` (bwWindows) | vigente |
| [EDITORIAL-NEXT.md](EDITORIAL-NEXT.md) / [PLAN-EDITORIAL-SUPREMO.md](PLAN-EDITORIAL-SUPREMO.md) | Editorial | h2,i | `remotion/src/layers/editorial-*.tsx` | revisar (editorial_full nuevo) |
| [SOCIAL_PUBLISHING.md](SOCIAL_PUBLISHING.md) | Scheduling/uploads | p | `frontend/src/lib/scheduled-uploads.ts`, `*-client.ts` | vigente |
| (IA — SFX matching, objetivo h) | Matching SFX↔contexto | h | `python/match_sfx_to_transcript.py`, `python/synth_sfx.py` | revisar (audit ~3/10) |
| [UI.md](UI.md) / [USAGE.md](USAGE.md) | UX/wizard | j,k | `frontend/src/components/.../wizard-*.tsx`, `long-form-wizard.tsx` | revisar (cambios de sesión: nav fija, Crear 1 clic, editorial_full) |
| (Miniaturas por estilo, objetivo j) | Previews pre-generadas | j | `remotion/generate-style-thumbs.mjs` → `frontend/public/style-thumbs/*.png` (23); `style-mini-demo.tsx` (PNG + fallback CSS) | vigente (loop 2, 2026-06-29) |
| [RENDIMIENTO.md](RENDIMIENTO.md) / [PLAN_OPTIMIZACION.md](PLAN_OPTIMIZACION.md) | Performance | c,d | `python/hw_profile.py`, `lf_render_pool.py`, render path | vigente (plan parcial) |
| [SETUP.md](SETUP.md) / [PREREQUISITES.md](../PREREQUISITES.md) / [INSTALADOR.md](INSTALADOR.md) / [AUTOSTART.md](AUTOSTART.md) | Onboarding/instalación | n | `python/setup_all.py`, `desktop/*` | vigente |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Fallas conocidas | a,b | (transversal) | vigente (incluye fix fuentes lazy + reframe) |
| [REPOS.md](REPOS.md) | Repos/estructura | — | — | vigente |
| [README.md](../README.md) | Visión general | todos | — | **desactualizado** ("22 estilos" → 23; objetivo p) |
| [CLAUDE.md](../CLAUDE.md) | Instrucciones internas / pitfalls | a (fuentes), k | (transversal) | **desactualizado** ("22 estilos" → 23) |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Gates de ingeniería | k,l | tsc, `npm test`, `check-style-parity.mjs` | vigente |

## Auditorías / planes (histórico — NO fuente de verdad viva, sí contexto)

| Doc | Para qué | Estado |
|---|---|---|
| [AUDITORIA-SUPREMO.md](AUDITORIA-SUPREMO.md) | Scores 5.6/10, meta ≥8.5, gaps por dominio. **Base del scorecard.** | histórico (referencia) |
| [AUDITORIA-LANZAMIENTO.md](AUDITORIA-LANZAMIENTO.md) / [LANZAMIENTO.md](LANZAMIENTO.md) / [PLAN-LANZAMIENTO.md](PLAN-LANZAMIENTO.md) / [RELEASE.md](RELEASE.md) | Lanzamiento/release | histórico |
| [ROADMAP.md](ROADMAP.md) | Backlog + meta "instalar→1er video <30min" | vigente (backlog) |
| [NIVEL_2.md](NIVEL_2.md) | Olas de features | histórico |
| [INVESTIGACION-MOTION-DESIGN.md](INVESTIGACION-MOTION-DESIGN.md) | Investigación FX | referencia |
| [ESTRATEGIA_VIRAL_7_DIAS.md](../ESTRATEGIA_VIRAL_7_DIAS.md) | Estrategia de contenido (no técnica) | referencia |

## Memorias externas (fuera del repo, contexto del asistente)

`C:\Users\alfon\.claude\projects\D--Poncho-Videos-Editor-Viral\memory\` — facetrack, broll, styles-growth, offline-fonts, etc. (no son docs del repo; complementan el contexto de sesiones previas).

## Deuda de documentación detectada (objetivo p)

- **"22 estilos" → 23**: corregir en `README.md`, `CLAUDE.md`, `CAPACIDADES.md`, `STYLES.md` (registry tiene 23; `editorial_full` agregado en sesión 2026-06-25).
- `STYLES.md` / `UI.md` / editorial docs: revisar que mencionen `editorial_full` (pantalla completa) y los cambios de wizard de la sesión (nav fija, "Crear" 1 clic, reframe 16:9 estable).
