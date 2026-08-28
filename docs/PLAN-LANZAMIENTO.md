# Plan de Lanzamiento — App de escritorio + GitHub con donaciones (2026-06-09)

## 1. ¿Está lista la app? — VEREDICTO HONESTO

**El motor: SÍ.** Edita cortos y largos, transcribe, 25 estilos, director
emocional, ilustraciones animadas, muletillas, copys por red, timeline, previews.
Probado end-to-end con renders reales.

**Para que la BAJEN en sus equipos: NO todavía.** Hoy correrla exige: Python
3.11+venv con ~15 paquetes, Node 18+, ffmpeg en un path específico, Ollama
opcional, `npm run dev` en frontend, y los modelos de WhisperX (~2 GB primera
vez). Un usuario normal no puede con eso. **Falta exactamente esto:**

| # | Falta | Esfuerzo | Bloqueante |
|---|---|---|---|
| 1 | ~~Empaquetado 1-clic~~ ✅ **HECHO 2026-06-10**: payload autocontenido de 3.3 GB (`desktop/bundle.ps1`) con node + server standalone + remotion + **Python embeddable portable** (`make-python-runtime.ps1`, 2.5 GB, smoke + scripts reales verificados) + ffmpeg. El launcher lo detecta solo. **VERIFICADO end-to-end**: server desde el payload (200, 15 videos) + render real vía remotion del payload. Distribución hoy: zipear `desktop\src-tauri\target\release\` (exe + payload). Pendiente menor: meter el payload dentro del NSIS (config de bundle.resources) para un solo .exe instalador. | — | ✅ |
| 2 | ~~`next build` de producción verificado~~ ✅ **HECHO 2026-06-09**: `output:"standalone"` configurado, build limpio al primer intento, server.js probado en vivo (puerto 3100, home 200, scheduler arranca; OJO: debe ejecutarse CON cwd = carpeta standalone y copiando `.next/static` + `public` adentro) | — | ✅ |
| 3 | Onboarding 1ra vez: descarga de modelos WhisperX con barra de progreso | 3-4 días | SÍ |
| 4 | ~~Paths portables~~ ✅ **HECHO 2026-06-09**: el launcher detecta `payload/` junto al exe (modo distribuible: node+remotion+python+ffmpeg adentro, env VIRAL_* completos) con fallback al repo (dev); en máquinas nuevas crea `%USERPROFILE%\ViralStudio\videos` solo, CERO preguntas. `desktop/bundle.ps1` arma el payload. ⚠️ PENDIENTE del payload: el venv de Python NO es relocatable (pyvenv.cfg apunta al Python base) — hay que migrar a **Python embeddable + pip install -t** antes del primer instalador público. Los modelos WhisperX se descargan solos en la 1ra transcripción. | — | ✅ (dev verificado) |
| 5 | Hardware mínimo documentado + modo "lite" si hay <8 GB RAM | 2 días | NO |
| 6 | Tests del flujo crítico (cola/render) para no romper en máquinas ajenas | 1 semana | Recomendado |
| 7 | Icono, nombre final, pantalla "Acerca de" con licencias de terceros | 1-2 días | NO |

**Total realista: 5-6 semanas** a versión descargable estable.

## 2. RUTA DE EMPAQUE (decidida: Tauri)

**Tauri** (vs Electron): instalador ~15 MB vs ~150 MB, menos RAM, Rust hace de
launcher. Arquitectura:

```
ViralStudio.exe (Tauri)
 ├─ arranca el server Next (standalone build, node embebido o sidecar)
 ├─ arranca nada de Python al inicio (lazy: solo al transcribir)
 ├─ bundle: ffmpeg.exe + ffprobe.exe (los que ya usamos, ~80 MB)
 ├─ bundle: Python embeddable (3.11, ~25 MB) + wheels preinstaladas
 ├─ 1er arranque: elige carpeta de datos + descarga modelos WhisperX (progreso)
 └─ ventana = WebView apuntando a localhost (la UI actual tal cual)
```

Pasos concretos:
1. `next build` con `output: "standalone"` → server.js autocontenido.
2. `tauri init` + sidecar config (node + python como external binaries).
3. Script de bundle: copiar ffmpeg, python-embed + site-packages congelado.
4. Onboarding screen (elige carpeta, baja modelos, test de render de 3s).
5. `tauri build` → instalador .msi/.exe + auto-update opcional (tauri-updater).

## 3. PLAN GITHUB + DONACIONES

El repo YA es público (github.com/ponchovillalobos/estrategia-viral-poncho).
Para que la gente lo use Y done:

**Semana 1 — presentable:**
- [ ] LICENSE raíz: **MIT** (las dependencias lo permiten; vendor ya trae la suya)
- [x] `.github/FUNDING.yml` (creado — activar GitHub Sponsors o Ko-fi y descomentar)
- [ ] README nuevo: GIF demo de 20s (un render con ilustraciones animadas),
      "qué hace" en 5 bullets, instalación, comparación vs Opus Clip ($0 vs $29/mes),
      botón de donar arriba
- [ ] Renombrar repo a algo de producto (ej. `viral-studio`) — redirect automático
- [ ] Topics: `remotion`, `video-editing`, `ai`, `whisper`, `shorts`, `spanish`

**Semana 2 — comunidad:**
- [ ] Releases con el instalador (cuando exista) — la gente dona cuando USA
- [ ] Issues templates + CONTRIBUTING.md cortito
- [ ] 3 videos cortos del propio producto mostrándose a sí mismo (meta-marketing)
      publicados en TikTok/IG con link al repo

**Modelo de donación recomendado:** gratis TODO + donaciones (Ko-fi/Sponsors)
+ tier "sponsor" con su nombre en el README. Cuando haya tracción: instalador
"pro" con auto-update por donación mensual (el código sigue MIT).

## 4. SIMPLIFICACIÓN DE PRODUCTO (HECHA hoy)

- **Nav de 6 → 4 secciones**: Inicio · Crear video · Videos largos · Mis videos.
  Métricas e Inspiración siguen por URL/Inicio pero fuera del menú.
- **Publicación automática y cronograma: FUERA del producto** (flag
  `PUBLISHING_ENABLED`, env `NEXT_PUBLIC_VIRAL_PUBLISHING=1` lo re-enciende para
  uso personal). El flujo público es: render → copiar texto por red → pegar.
  Razón: OAuth/apps aprobadas por red no escalan a usuarios anónimos.
- **Pexels b-roll se queda** como campo de API key OPCIONAL en Configuración
  (gratuita, el que la quiera la pone; sin key los estilos b-roll avisan).

## 5. ESTADO DE LIMPIEZA DE CÓDIGO (auditado hoy)

- `tsc --noEmit` = 0 errores en frontend Y remotion; Python compila completo.
- Test de paridad shorts/largos automático (`node remotion/check-style-parity.mjs`).
- Suite vitest existente pasa (run-process, atomic-write, helpers).
- Deuda conocida y aceptada (no bloquea lanzamiento): duplicación .ts/.mjs de
  estilos (mitigada por el test de paridad), props de ViralVideo extensos (50+
  campos, funcional), 0% cobertura de tests en cola/render (ítem 6 del §1).
- Sin código muerto detectado en la auditoría UX (ninguna sección fantasma).
