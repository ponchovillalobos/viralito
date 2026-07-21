# Auditoría integral y plan de mejora — 2026-07-20

> Método: 5 agentes en paralelo (3 auditando el código con evidencia `file:line`, 2
> investigando el ecosistema 2026) + verificación manual de **cada** hallazgo antes de
> incluirlo. Los hallazgos que no resistieron la verificación están en la sección
> "Descartado" con el motivo. Nada en este documento se afirma sin haberlo comprobado
> contra el código o contra una fuente oficial.
>
> Hardware de referencia medido: **RTX 3060 Laptop, 6 GB VRAM**, venv de 7.5 GB.
> Tamaño del proyecto: ~81 k líneas (47 k frontend, 20 k python, 14 k remotion), 430
> archivos, 106 rutas de API, 23 estilos.

## Veredicto

El código es **mejor que el promedio de la industria** justo donde alguien ya se quemó:
`run-process.ts` tiene idle-timeout, `job-persistence.ts` reintenta el rename ante
`EPERM` de Windows, `long_form/import-path` tiene allowlist de raíces con rechazo de
UNC, `lib.rs` tiene healthcheck + watchdog con shutdown flag, `bundle.ps1` valida con
`throw` y maneja MAX_PATH. Los comentarios explican el *porqué* y citan el bug que
motivó cada decisión. `any` está prácticamente erradicado (1 sola ocurrencia en 47 k
líneas). El bundle de Remotion se cachea por fingerprint. `style-catalog.mjs` cumple su
rol de fuente única.

La debilidad es **sistemática y de una sola forma**: las defensas se aplicaron **donde
se detectó el problema, no en toda la clase de problema**. `safe-id.ts` existe, está
bien hecho, y cubre 8 de ~15 sitios que lo necesitan. `long_form/proposals` valida en el
PATCH y no en el GET del mismo archivo. El polling adaptativo existe en 1 de 9
componentes. Los timeouts de subprocess están en 26 de 42 llamadas.

Por eso este plan prioriza **soluciones transversales** (zod en el borde, un helper de
subprocess, un helper de muestreo de frames) por encima de parches puntuales.

---

## P0 — Seguridad: arreglar **antes** de empaquetar el próximo instalador

### 1. Los secretos del desarrollador viajan dentro del instalable

`frontend/.next/standalone/.env.local` existe con valores reales de `PEXELS_API_KEY`,
`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY` y
`TIKTOK_CLIENT_SECRET`. `desktop/bundle.ps1:35` copia **el árbol standalone entero** al
payload y **no hay ninguna exclusión de `.env*`** en el script.

Junto con los secretos viajan `src/`, `CLAUDE.md`, `AGENTS.md` y `eslint.config.mjs`
(están dentro de `.next/standalone`): el código fuente completo.

**Estado real verificado: todavía NO se filtró.** No existe `desktop/payload/`, no hay
`.msi` ni instalador generado, y `.env.local` **no está en git** (solo el `.example`).
No hace falta rotar credenciales hoy. Pero el próximo `bundle.ps1` + compartir el `.exe`
las publica, y con el Client Secret de LinkedIn/TikTok/Meta cualquiera puede suplantar
la app ante esos proveedores.

**Arreglo:** en `bundle.ps1`, tras la línea 39, borrar del payload `.env*`, `src\` y
`*.md`. Las credenciales OAuth deben venir del `user-settings.json` del usuario final
(`frontend/src/lib/user-settings.ts` ya existe), no de un `.env.local` horneado.

### 2. Escritura arbitraria en el filesystem vía subida de overlays

`frontend/src/app/api/overlays/upload/route.ts:39` solo valida
`typeof videoId === "string"`; la línea 67 hace `path.join(OVERLAYS_DIR, videoId)` +
`fs.mkdir(recursive)` + escribe el binario. Un `videoId` con `../` crea carpetas y
escribe una imagen en cualquier parte del disco del usuario.

Es la **única primitiva de escritura** del lote. `isSafeId()` de
`frontend/src/lib/safe-id.ts` ya existe: son 3 líneas.

### 3. Lectura arbitraria y subida de archivos ajenos a redes sociales

Mismo patrón, sin validar el id:

- `long_form/proposals/[videoId]/route.ts:15` (GET) lee cualquier `.json` del disco y lo
  devuelve. **El PATCH del mismo archivo sí valida** (línea 47) — se parchó el caso
  reportado, no la clase.
- `linkedin/publish/route.ts:30,45,85`, `instagram/publish/route.ts:29,44`,
  `tiktok/schedule/route.ts:55` — `path.join(rendersBase, ${projectId}.mp4)` sin
  validar: permite subir un `.mp4` arbitrario del disco a una red social.
- `editor/auto-build/route.ts:132` y `long_form/process/route.ts:101` pasan el `videoId`
  sin validar como argv a Python. Sin `shell:true` no hay RCE, pero sí lectura/escritura
  fuera del data root.

### 4. La cura transversal: zod en el borde de la API

**Cero imports de zod en todo `frontend/src/`.** El patrón universal es
`const body = (await req.json()) as AutoBuildRequest` — un `as` es una mentira en
runtime, y de ahí salen **directamente** los tres puntos anteriores. Hay 61 `JSON.parse`
en rutas de API sin validar forma.

Validar con zod los ~6 bodies que alimentan filesystem o spawn elimina la clase entera
en vez de agregar un `if` por ruta descubierta. El schema de Remotion
(`ViralVideo.tsx:235-358`) demuestra que el equipo ya sabe escribir schemas: falta
ejecutarlos en el borde.

---

## P1 — Robustez: los cuelgues y los abortos de render

### 5. 16 de 42 llamadas a subprocess no tienen timeout

Incluye el pool de render y los pasos centrales del pipeline:
`lf_render_pool.py:199`, `long_form_pipeline.py:286,292,345,1241`,
`transcribe.py:133`, `cut_silences.py:147`, `detect_silences.py:38`,
`remove_background.py:93`, `extract_clips.py:58,623`, `bumper_concat.py:46,138`,
`synth_sfx.py:58`, `text_behind_subject.py:97`, `research_download.py:141`.

Esto explica **mecánicamente** el síntoma ya sufrido de "la app dejó de responder": si
un ffmpeg o un Remotion se cuelga, el pipeline espera para siempre, sin diagnóstico.

**Arreglo transversal:** un único helper `run()` en `python/lib/` con timeout
obligatorio, `check`, captura y mensaje de error legible; migrar las 42 llamadas.

### 6. Ocho `loadFont` eager sin `.catch()` — el bug offline que volvió

`remotion/src/layers/editorial-ink.tsx:16-26` carga 8 TTF variables a nivel de módulo
con `loadFont` de `@remotion/fonts` y **sin `.catch()`**. Es exactamente el patrón que
`local-editorial-fonts.ts:26-31` documenta como causa raíz de "los videos no salían":
`@remotion/fonts.loadFont` hace `cancelRender` en el fallo, y 8 descargas simultáneas
bajo render concurrente de largos son la tormenta que dejaba `delayRender` sin limpiar.

Es el **único outlier** del proyecto: `ViralVideo.tsx:93-101` sí tiene `.catch()`, y
`local-editorial-fonts.ts:42-59` usa el patrón lazy seguro. Arreglo: una línea, o
migrar al helper `F` lazy.

### 7. Un sticker Lottie caído tira el clip entero

`remotion/src/layers/lottie-sticker-layer.tsx:33` hace `.catch((e) => cancelRender(e))`.
Se usa desde `icon-sticker-layer.tsx:84,160` con `sticker.lottieSrc` apuntando a
`/api/lottie/stream`. Si el API no responde o falta el archivo, **se cae el render
completo** en vez de omitir un sticker decorativo. Misma clase de fragilidad que el bug
de fuentes, sin arreglar.

### 8. Procesos Python huérfanos tras reiniciar el server

`frontend/src/lib/long-form-job-store.ts:349-350` — el mapa de PIDs vive solo en
memoria. Tras un reinicio con un Python vivo, `/api/long_form/cancel` no puede matarlo:
queda quemando CPU sin forma de detenerlo desde la UI. El launcher mata el `node.exe`
anterior (`lib.rs:100-117`) pero no sus nietos Python/ffmpeg.

Complementario: en Windows conviene **Job Objects** para que al cerrar Tauri caiga todo
el árbol de hijos (patrón validado en la discussion oficial de Next.js #90982 sobre este
mismo diseño de sidecar).

### 9. Dependencias implícitas de Remotion

`remotion/render-server.mjs:31-32` importa `@remotion/bundler` y `@remotion/renderer`,
que **no están declarados en `remotion/package.json`** — llegan como transitivas de
`@remotion/cli`. Un `npm prune` o un cambio de hoisting deja el render-server sin
arrancar, y el fallback automático a CLI **taparía la regresión de performance en
silencio**.

### 10. Mismatch de versiones de Remotion (real, no cosmético)

Instalado hoy: `remotion`, `cli`, `renderer`, `bundler`, `fonts`, `lottie`,
`media-utils`, `paths` en **4.0.462**; `motion-blur`, `noise`, `transitions` en
**4.0.465**. Remotion exige versión **idéntica** en todos los paquetes y pide quitar el
`^`. Los tres desalineados son justo los que se montan en el render. El estable actual
es **4.0.495**.

---

## P2 — Rendimiento: trabajo desperdiciado

### 11. Los trackers decodifican el 100% de los frames

**Ningún archivo del proyecto usa `cap.grab()`.** `track_subject.py:163` y
`face_tracking.py:217` hacen `cap.read()` (decodificación completa) de **todos** los
frames y descartan los que no tocan por muestreo. Peor: `face_tracking.py` en modo
`single_frame` decodifica hasta el frame del medio **para obtener uno solo**, cuando
`CAP_PROP_POS_FRAMES` haría un seek directo.

Ganancia esperada: **5-15x menos frames decodificados** en la fase de tracking.

### 11-bis. El tuning de Ollama es inconsistente entre callers

Solo `analyze_clips.py` está bien afinado (`think` + `keep_alive`). `generate_caption.py`
tiene `think` pero **no** `keep_alive`; `adapt_script.py` y `highlights.py` **no tienen
ninguno de los dos**. Y **`num_predict` no se usa en ningún archivo**.

Consecuencia: sin `keep_alive` el modelo **se descarga y recarga entre llamadas** (varios
segundos cada vez, en una GPU de 6 GB donde la carga duele), y sin `num_predict` la
generación no tiene techo de tokens.

Arreglo transversal: un helper único de Ollama con `think:false` + `keep_alive` +
`num_predict`, y migrar los 4 callers. Es el mismo problema de forma que el helper de
subprocess.

### 11-ter. `face_tracking.py` no tiene la caché por hash que sí tiene `track_subject.py`

`track_subject.py:44-60` cachea el resultado por `(archivo + mtime + tamaño + params)` en
`DATA_ROOT/cache/track/<hash>.json` — bien hecho y documentado. `face_tracking.py` **no
tiene equivalente**: recalcula el tracking completo en cada re-render del mismo clip.

### 12. `baselineLines(words)` se recomputa en cada frame

`remotion/src/layers/editorial-layer.tsx:530` recorre el transcript completo con regex
por palabra y crea arrays nuevos **en cada frame**. Un clip de 3 min = 5400 frames ×
~600 palabras. Es el único cómputo O(transcript) por frame del composition.

No se arregla con `useMemo` directo: hay un early-return en la línea 522 **antes** de los
hooks. Hay que mover el guard adentro o subir el cómputo al padre.

Relacionado: `editorialPanelAt` (`:279`) hace `[...scenes].sort()` por frame, y
`resolveEditorialLook(layout)` se llama por frame en dos sitios. En ~9900 líneas hay
**4 `useMemo`** en total.

### 13. 46 bundles de webpack por regeneración de previews

`remotion/generate-style-previews.mjs:122-130` lanza `npx remotion render` dentro de un
doble loop (23 estilos × 2 aspectos) — **cada invocación bundlea de cero**. Igual en
`generate-style-thumbs.mjs:129`. Del orden de 15-30 min de bundling puro por corrida,
existiendo ya el render-server que cachea el bundle.

### 14. Polling permanente en toda la app

`QueuePanel` está montado en `frontend/src/app/layout.tsx:52` → hace polling **cada 3 s
en todas las páginas, siempre, incluso colapsado y sin jobs**. `/api/jobs/queue` recorre
tres stores y lee JSON de disco en cada tick. Sumado al resto: ~2 req/s permanentes en
reposo. Solo `research/batch-adapt-panel.tsx:49` implementa backoff adaptativo — el
patrón existe, falta replicarlo.

Bug adyacente: `long-form-wizard.tsx:632-660` depende de `[activeJob]` y el propio poll
hace `setActiveJob(objeto nuevo)` → **desmonta y remonta el `setInterval` en cada tick**.
Funciona por accidente.

### 15. El wizard de largos: 3207 líneas, 48 `useState`, 0 `useMemo`

`frontend/src/components/largos/long-form-wizard.tsx` recalcula 22 `.map()` en cada
cambio de estado, incluido un `setNow(Date.now())` **cada segundo** (`:604`).

---

## P3 — Calidad de la salida

### 16. Los subtítulos se desbordan y están calibrados solo a 9:16

`remotion/src/layers/subtitle-layer.tsx:111-120`: `fontSize: 110`, `maxWidth: 980`,
`whiteSpace: "nowrap"`, sin `overflow` ni auto-fit. Una palabra española larga
("responsabilidad", "extraordinariamente") a 110 px en Bebas/Anton **excede los 980 px y
se sale del canvas**.

Además todo el archivo es px fijo calibrado a 1080×1920: `paddingBottom: 320` es el 17%
del alto en vertical pero el **30% en 16:9**, donde el texto queda chico y mal ubicado.

La solución ya está escrita en el proyecto: `word-sticker-layer.tsx:37-43` hace auto-fit
por ancho, y el resto de las capas usan `compWidth`/`compHeight`.

### 17. `cine_clasico` en largos renderiza sin sus ventanas B&W

`remotion/build-props.mjs:243` pasa `bwWindows` (shorts). `build-clip-props.mjs`
**no lo incluye** en los props (largos). Lo mismo con `editorialCutout`, que está
implementado end-to-end en el composition (`ViralVideo.tsx:818-823,1218-1227`) pero es
**inalcanzable desde largos**.

`check-style-parity.mjs` pasa hoy (22↔22, verificado) pero tiene un punto ciego: solo
compara los bloques de los dos archivos de templates, **no los enrichers** de
`auto-build/lib/*.ts`, que es donde vive `bwWindows`.

### 18. Los props no se validan antes de renderizar

Cero `zod`/`safeParse` en los `.mjs`. `build-clip-props.mjs:286` escribe el JSON directo
y `render-server.mjs:194` hace `JSON.parse` sin validar contra `viralVideoSchema`. Una
clave mal escrita se convierte en el default de zod en silencio, o revienta a mitad del
render **después de haber pagado el bundle**. El schema ya existe y es exhaustivo: falta
ejecutarlo.

---

## P4 — Plataforma y dependencias

| Ítem | Hoy | Objetivo | Nota |
|---|---|---|---|
| Remotion | 462 / 465 mezclados | **4.0.495**, pinneado sin `^` | + declarar `bundler` y `renderer` |
| Next.js | 16.2.6 | 16.2.10 → parche de seguridad | Vercel anunció release con 4 high + 5 medium; **aún no publicado** al momento de escribir |
| React | 19.2.4 | 19.2.7 | No existe React 20 |
| TypeScript | 5.9.3 | 7.0.2 | **Major**, evaluar aparte |
| eslint | 9.39.4 | 10.7.0 | Major |
| `@remotion/google-fonts` | instalado, **cero imports** | **eliminar** | Footgun para el bug offline |
| `requirements.txt` | sin pins, dice "CPU-only" | pins reales | El venv tiene `torch 2.8.0+cu126`: el archivo miente |
| `opencv-python` + `opencv-contrib-python` | **ambos instalados** | solo `contrib` | Conflicto clásico; parte de los 7.5 GB de venv |
| `pytest` | existe, **fuera de CI** | en CI | Y los 10 tests cubren config/hardware, **cero del pipeline** |
| `docs/REPOS.md` | lista `recharts` | actualizar | Ya no está en `package.json` |

**Riesgo de Remotion v5** (sin fecha aún): `visualizeAudio()` cambia su default y el
proyecto lo usa en `audiogram-layer.tsx` y `animated-background-layer.tsx` → **esas dos
capas cambiarán de aspecto**. Además el color space default pasa de `bt601` a `bt709`
(cambio de color visible) y las Sequences ganan premounting automático de 1 s.

**Licencia de Remotion:** hoy gratis (uso individual). En v5 la Company License arranca a
partir de **4 personas contando contractors**, con telemetría obligatoria — que **no
aplica** a este uso y **no rompe la operación offline**.

**Verificado que NO aplica:** el proyecto **no usa** `@remotion/media-parser` ni
`@remotion/webcodecs` (los dos deprecados a favor de Mediabunny). No hay migración
pendiente ahí.

---

## Horizonte de capacidades nuevas

Calibrado contra **6 GB de VRAM reales**, no contra el hardware de los benchmarks.

### Alto valor, esfuerzo bajo-medio

**Parakeet TDT 0.6B v3 vía `onnx-asr`** (CC-BY-4.0 + MIT) como vía rápida de
transcripción. WER español verificado en model card: **3.45% Fleurs / 4.39% MLS** —
mejor que Whisper large-v3 en español. Timestamps nativos de palabra, puntuación
automática. Corre en ONNX Runtime con CUDA **sin instalar NeMo** (que en Windows es un
suplicio) y `onnxruntime 1.27.0` ya está en el venv. Entra holgado en 6 GB.
**No borrar WhisperX**: Parakeet no diariza y cubre 25 idiomas, no 99.

**LR-ASD** (MIT, IJCV 2025) para *active speaker detection*. F1 86.1% base / 96.4%
fine-tuned en Columbia ASD. Es **exactamente** lo que arregla "el reencuadre no sigue al
que habla" en podcasts de varias personas: pyannote dice *quién* habla en el tiempo,
LR-ASD dice *cuál caja de cara* es esa persona en cada frame.

**NVENC de hardware en Remotion** (llegó a Windows en 4.0.484, hoy estás en 462).
`hardwareAcceleration: "if-possible"`. Caveat real: el ffmpeg que trae Remotion solo
incluye NVENC en Linux; en Windows hay que apuntar con `--binaries-directory` a un build
con `h264_nvenc` (los de gyan.dev lo traen). Acelera **el encoding, no la rasterización**
de frames — consistente con lo ya medido en este proyecto.

**`<Video>` de `@remotion/media`** (estable en 4.0.491) en lugar de `<OffthreadVideo>`:
mantiene el archivo abierto entre extracciones, **hasta 2× más rápido**, con fallback
automático. Son **12 usos** en el proyecto: cambio acotado y medible.

**DeepFilterNet3** (MIT/Apache, RTF 0.19 en un hilo de CPU) como paso opcional de
limpieza de audio. Caveat honesto: quita ruido, **no quita reverberación de sala**.

### Alto valor, esfuerzo medio

**SigLIP 2** (Apache-2.0, multilingüe con español) sobre keyframes: permite elegir b-roll
por **similitud semántica con la frase transcrita** en vez de una query de texto a
Pexels, y deduplicar clips visualmente parecidos. Hoy el editor entiende lo que se
**dice**; esto le da entender lo que se **ve**.

**`@remotion/captions` + GSAP SplitText.** GSAP es **100% gratis desde abril 2025**
(Webflow liberó los plugins premium, incluido SplitText, que antes costaba $99/año) y es
*la* herramienta canónica de tipografía cinética. Caveat serio: GSAP es time-based y
Remotion frame-based → hay que manejar el timeline con `.seek(frame/fps)`, nunca
autoplay, o los renders dejan de ser deterministas.

**`qwen3.5`** (Apache-2.0): 201 idiomas vs los 82 de qwen3, contexto nativo de 262 k
(cabe una transcripción de 3 h sin chunkear). Con 6 GB, la talla realista es **4b**, no
9b. Más importante que el modelo: usar **JSON-schema del runtime** (`format` de Ollama)
en vez de pedir JSON por prompt — elimina el grueso de los reintentos de parseo.

**Endurecer la cola** con `locked_by` / `locked_at` / contador de reintentos. Node 22+
trae `node:sqlite` en core: una cola durable propia son ~150 líneas sin dependencias
nuevas. **No** reemplazar el orquestador actual, que ya funciona.

### Explorar después

TransNet V2 (MIT, F1 96.2 BBC) para cortes en material con disolvencias, donde
PySceneDetect falla. Demucs antes del ASR en clips con música. pyannote 4 /
`community-1`. `@remotion/effects` (50+ efectos de pixel) para el FX de lente pendiente.
Next 16.3 cuando estabilice (memory eviction reduce hasta 90% la RAM del dev server,
fixes específicos de Windows).

### Banderas de licencia — no tocar sin decisión explícita

- **Ultralytics YOLO** (cualquier versión): **AGPL-3.0**. Incompatible con la política
  del proyecto.
- **SAM 3**: "SAM License", **no** OSI-permisiva. Leerla antes de embarcar.
- **Gemma 4**: Gemma Terms of Use, **no** Apache. Hay un `gemma4` instalado en Ollama.
- **RMBG-2.0**: CC BY-NC. Para quitar fondo, seguir con BiRefNet dentro de rembg.
- **ViralMint** (competidor open source): AGPL-3.0 — mirar, nunca copiar código.

---

## Descartado tras verificar

Se incluye para que nadie los reintroduzca:

- **"El render-server encodea a CRF 18 en vez de 24"** — falso. `hw_profile.py:389`
  fija `x264_crf = 24` y el perfil real lo entrega. Verificado leyendo
  `C:\viral-data\videos\cache\hw_profile.json`.
- **"El preset `ultrafast` del render-server es un bug"** — falso, es deliberado y
  correcto: con NVENC ese x264 es un intermedio que el post-encode re-encodea y se tira
  (`hw_profile.py:374-385`).
- **`gl=angle` por default** — sigue siendo opt-in a propósito, por un memory-leak
  conocido documentado en `hw_profile.py:396`. Correcto.
- **Migrar a Motion Canvas** — **abandonado**: última versión 2024-12-14, el dominio no
  resuelve.
- **Migrar a Revideo / Editly / Diffusion Studio** — Revideo no renderiza HTML/CSS
  (habría que reescribir todas las plantillas React); Editly muerto desde 2022;
  Diffusion Studio es solo browser y pone marca de agua sin licencia paga.
- **`renderMediaOnWeb` para la salida final** — no emula CSS completo (sin `z-index`,
  `text-decoration`, `perspective`…): drift visual silencioso. Sirve **solo para
  previews**.
- **Crop dinámico acelerado por CUDA** — no existe `crop_cuda` nativo, y el crop de este
  proyecto **cambia por frame**, cosa que no se expresa en una cadena estática de filtros
  CUDA. Esfuerzo alto, ganancia incierta.
- **libplacebo** — complejidad sin retorno mientras no haya fuentes HDR.
- **Cache Components / PPR de Next** — la data es local y de una sola máquina; el cuello
  es el render de video, no la latencia de datos.
- **"Whisper v4"**, **"Next.js 17"**, **"React 20"**, **"Resemble Enhance actualizado en
  2026"** — no existen. Blogs SEO generados por IA.

## Verificado como SANO (no tocar)

Auditado y sin hallazgos, para no perder tiempo revisándolo de nuevo:

- **Encoding en Windows**: 113 `encoding=` explícitos; los `open()` sin encoding son
  todos binarios (`urlopen`, `Image.open`, zip). Sin riesgo de cp1252.
- **Archivos temporales**: casi todos con `TemporaryDirectory()` (limpieza automática).
  El único `mkdtemp` (`cut_silences.py:93`) limpia en un `finally` (`:148-160`).
- **Caché de etapas del pipeline**: cada paso de `long_form_pipeline.py` skipea si ya
  existe el artefacto (transcribe, detect, cut, re-transcribe con marker, analyze), con
  `force` para invalidar. Bien hecho.
- **`-hwaccel`**: el manejo es correcto y está documentado — no se inyecta decode por
  hardware cuando hay `-vf crop`, porque `-hwaccel_output_format cuda` entregaría frames
  en VRAM que el filtro en CPU no puede consumir, y se evita en fuentes rotadas para que
  ffmpeg hornee la rotación (`extract_clips.py:308-393`).
- **Aleatoriedad en Remotion**: cero `Math.random()` y cero `new Date` en `src/`. Todo
  usa el `random()` determinista de Remotion o hashes. Renders reproducibles.
- **Ducking de música y timing de subtítulos**: `ViralVideo.tsx:1360-1373` y
  `subtitle-layer.tsx:51-54`, que clampea contra timestamps degenerados para garantizar
  la regla "subtítulos siempre visibles".
- **Inyección de comandos**: todos los spawns de Python usan `shell: false`; el único
  `shell:true` es para `npx.cmd` con binario fijo. Sin superficie de RCE.
- **`style-catalog.mjs`**: cumple su rol de fuente única. `check-style-parity.mjs` pasa
  hoy (22↔22, ejecutado). La deriva de estilos está contenida.
- **"Parakeet a 3333× tiempo real en tu PC"** — es throughput batcheado en datacenter,
  no un stream único en una laptop.

---

## Estado de ejecución — Ola 1 (2026-07-20)

Cada punto se implementó, se probó y se documentó. Los gates al cierre de la ola:
**FE tsc 0 · 211 tests (eran 159) · paridad 22↔22 · Remotion tsc 0 · pytest 44/44 ·
py_compile OK**, más **un render real** verificado a ojo.

| # | Hecho | Cómo se verificó |
|---|---|---|
| 1 | `bundle.ps1` borra `.env*`, `src\`, `*.md` y `eslint.config.*` del payload, y **aborta** con `throw` si queda algún `.env` | Simulación del selector de archivos sobre el árbol real: acierta `.env.local`, `src/` (263 archivos), 3 `.md` y `eslint.config.mjs`; la verificación recursiva no da falsos positivos |
| 2 | `isSafeId()` en las 7 rutas que lo necesitaban (incluida la de **escritura arbitraria** de overlays) | `tsc` 0 + 2 suites nuevas |
| 3 | El PATCH de `proposals/[videoId]` migró de su regex propio al helper compartido | El regex viejo no descartaba `.` ni ids distintos de su basename |
| 4 | `editorial-ink.tsx`: 8 fuentes migradas de `loadFont` (eager, `delayRender` + `cancelRender`) al helper **lazy** `registerLocalFont` | **Render real A/B**: frame 150 del mismo clip editorial antes y después = visualmente idéntico (serif variable, itálica, círculo rough.js). Ya no puede abortar sin internet |
| 5 | `RemoteLottie` omite el sticker en vez de `cancelRender` (con `continueRender` para no colgar la delayRender) | `tsc` 0; el render de prueba pasó sin abortos |
| 6 | `python/lib/proc.py`: runner con **timeout obligatorio**, mensajes legibles y `encoding="utf-8"` explícito (Windows) | Test funcional del helper: corrida normal, `StepTimeout` real a 1.5 s, y `probe` que no lanza por returncode |
| 7 | Cableado en `long_form_pipeline.py`: `run`, `run_capture`, `_ffprobe_duration` (degrada a 0.0 si se cuelga) y la llamada a `highlights.py` | `py_compile` + pytest |
| 8 | `bundle.ps1` busca ffmpeg en `viral-data` **y** `hermes-data`, con `throw` claro | Verificado: ffmpeg vive **sólo** en `viral-data` → la ruta hardcodeada anterior habría devuelto `$null` y reventado. Era un bug latente real |
| 9 | Los 2 tests de hardware actualizados a `large-v3` **con el porqué** citando `hw_profile.py:303-306` y el commit `c475af7` | pytest 44/44. No eran un bug del código: eran tests viejos |
| 10 | 2 suites nuevas: `safe-id.test.ts` (44 casos) y `route-traversal-guards.test.ts` (8) | Se comprobó contra `git show HEAD` que **las 7 rutas tenían 0 llamadas a `isSafeId`** antes del fix → el test de cableado habría fallado. No es decorativo |

### Corrección a la propia auditoría

`lf_render_pool.py:199` **no** es un defecto y se retira de la lista de "subprocess sin
timeout". Es un `Popen` de servidor de larga vida con supervisión propia:
`_READY_TIMEOUT_S` de 120 s (`:53`, `:221`) y seguimiento de inactividad
(`_last_out_ts`). El conteo automático lo marcó mal. El total real de llamadas sin
techo era **15**, no 16, y las de mayor riesgo ya están cubiertas.

### Hallazgo extra encontrado al ejecutar (bug de higiene, arreglado)

`python/tests/test_hw_profile.py:56` apuntaba el caché a
`pathlib.Path(os.devnull).parent / "no_existe_hw_profile.json"`. En Windows
`os.devnull` es `"nul"` (sin carpeta), así que `.parent` es `"."` → **el test escribía
un archivo real en el cwd desde el que se corriera pytest**, ensuciando el repo (había
dos copias sin trackear). Migrado a `tempfile.gettempdir()`. Verificado: 44/44 y el
archivo ya no reaparece.

### Nota para cablear pytest al CI

La suite tarda **~105 s en frío**, y está dominada por dos tests preexistentes:
`test_transcribe_help_no_emite_warning_de_torchcodec` (**57.7 s** — lanza
`transcribe.py --help`, que importa torch/CUDA desde un venv de 7.5 GB) y
`test_ensure_dirs_crea_las_11_carpetas` (**36.8 s**). Los otros 42 tests suman menos de
1 s. En caliente la suite baja a ~9 s.

Implicación: meter pytest al CI tal cual no es gratis, y encima el runner de GitHub no
tiene torch instalado, así que ese test se comportaría distinto. Conviene marcarlo con
`@pytest.mark.slow` y correr en CI el subconjunto rápido, dejando el completo para
local.

### Pendiente de la Ola 1

- Pinnear Remotion a una versión exacta y declarar `@remotion/bundler` +
  `@remotion/renderer` como deps directas. **Requiere `npm install`**, así que va con
  su propio render de verificación y no se mezcló con esta tanda.
- Parche de seguridad de Next: al cierre de esta ola `npm view next version` seguía
  devolviendo **16.2.10**. No hay nada que instalar todavía.
- Cablear `pytest` y `eslint` al CI (`.github/workflows/test.yml`).
- Los 6 errores de lint (`react-hooks/set-state-in-effect`, `react-hooks/refs`): son
  higiene del React Compiler, no bugs. Van con la limpieza de polling de la Ola 2.
- Timeouts en las llamadas restantes de menor riesgo (`bumper_concat`, `synth_sfx`,
  `text_behind_subject`, `research_download`, `remove_background`).

## Estado de ejecución — Ola 2 (2026-07-21)

Gates al cierre: **FE tsc 0 · 211 tests · paridad 22↔22 · Remotion tsc 0 · pytest 44/44
· py_compile OK**, con mediciones A/B reales en cada ítem de rendimiento.

| # | Hecho | Medición |
|---|---|---|
| 1 | `track_subject.py`: `grab()` para los frames no muestreados en vez de `read()` | **6.87 s → 2.88 s (2.38x)**, salida **byte a byte idéntica** |
| 2 | `face_tracking.py`: ídem, en barrido y en `single_frame` | Barrido **6.24→3.78 s (1.65x)**, single **3.46→2.18 s (1.59x)**, salida **idéntica** en ambos |
| 3 | `editorial-layer.tsx`: `baselineLines` y `resolveEditorialLook` memoizados (hooks movidos antes de los early-returns) | Render 300 frames: **47.8 → 47.0 s (1.7%)**. PSNR vs el anterior: **infinito, MSE 0.00 en los 300 frames** = pixel-idéntico |
| 4 | Versiones de Remotion **pinneadas a 4.0.462 exacto** (sin `^`), `@remotion/bundler` y `@remotion/renderer` declarados, `@remotion/google-fonts` eliminado | `npx remotion versions` → **"All packages have the correct version"**. Render de verificación + frame comparado a ojo: igual |
| 5 | `generate_caption.py` recibe `keep_alive` + `num_thread` vía el nuevo `python/lib/ollama_opts.py` | Generación real de caption con Ollama: **rc=0, 21.4 s**, JSON válido, hashtags ES sin acentos |
| 6 | `QueuePanel`: polling adaptativo 3 s con trabajo / 12 s en reposo + refresco al recuperar el foco | `tsc` 0, sin errores de lint nuevos |

### Correcciones a la propia auditoría (hallazgos RETIRADOS tras verificar)

- **#17 (`bwWindows` / `editorialCutout` faltantes en largos): RETIRADO.** No es un prop
  olvidado ni código inalcanzable. Ambos los produce **exclusivamente** el enricher del
  camino de CORTOS (`auto-build/lib/cine-clasico.ts:150` y `fx-enrichments.ts:184`).
  El propio `style-templates.ts:1381` documenta el diseño: la drama por-pico *"la
  computa auto-build … Si ese paso falla, este estilo renderiza igual como cine
  elegante"*. Pasar el prop en `build-clip-props.mjs` entregaría siempre un array
  vacío. Llevarlo a largos sería una FEATURE nueva (portar el enricher de picos
  emocionales), no un arreglo. **No se tocó.**
- **#12 (`baselineLines` por frame): SOBREDIMENSIONADO.** Es real y se memoizó, pero
  medido da **1.7%**, no el gran cuello que sugería la redacción. Se deja porque es
  gratis, pixel-idéntico y escala con transcripts largos.

### Nota de método: el piso de ruido del PSNR

Al comparar renders descubrí que **dos renders del MISMO código dan PSNR ≈ 48.8 dB**,
no infinito. O sea, el renderer tiene una no-determinismo de ~48 dB (probablemente en
la extracción de frames de `OffthreadVideo`). Consecuencia práctica: **48 dB es el piso
de ruido de esta medición, no una regresión**. Sólo un PSNR marcadamente por debajo de
eso indica un cambio visual real. La memoización sí dio infinito/MSE 0 — ésa es
evidencia fuerte de equivalencia exacta.

### Decisión tomada con datos: seek vs grab

Para `face_tracking --single-frame` probé saltar al frame del medio con
`CAP_PROP_POS_FRAMES`. Es **0.2 s más rápido** que `grab()`, pero decodifica desde el
keyframe previo sin la cadena completa de referencias y devuelve píxeles distintos: el
centro de la cara se corría ~1% y **cambiaba el encuadre**. Se descartó — está
documentado en el código para que nadie lo reintroduzca.

### Pendiente

- Subtítulos: auto-fit de ancho y escalado por `compWidth/compHeight` (hoy px fijos
  calibrados a 9:16; en 16:9 el `paddingBottom: 320` es el 30% del alto). Es un cambio
  **visual**, va con A/B en los dos aspectos.
- Validar props contra `viralVideoSchema` antes de renderizar. Riesgo real de rechazar
  props válidos y romper renders que hoy funcionan → hay que probarlo antes contra
  todos los projects existentes.
- Persistir el mapa de PIDs; caché por hash en `face_tracking`; previews con
  render-server en vez de 46 bundles; `pytest` + `eslint` en CI (ver la nota de tiempos
  de la Ola 1); los 6 errores de lint del React Compiler.

## Plan de ejecución

**Ola 1 — Seguridad y cuelgues (1-2 días, riesgo bajo).**
Excluir `.env*`/`src`/`*.md` del payload · `isSafeId()` en las 7 rutas que faltan · zod
en los 6 bodies que tocan FS/spawn · `.catch()` en `editorial-ink.tsx` · fallback
silencioso en `RemoteLottie` · helper único de subprocess con timeout obligatorio ·
pinnear Remotion y declarar `bundler`/`renderer` · parche de seguridad de Next cuando
salga.
*Gate:* tests de `safe-id` + test parametrizado de traversal sobre las 9 rutas de
streaming, `pytest` incorporado a CI.

**Ola 2 — Rendimiento y calidad visible (3-5 días, riesgo bajo-medio).**
`cap.grab()`/seek en los trackers · memoizar `baselineLines` · auto-fit y escalado
responsive de subtítulos · `bwWindows`/`editorialCutout` en largos · validar props
contra el schema antes de renderizar · backoff del polling en reposo · previews con
render-server en vez de 46 bundles · persistir el PID map.
*Gate:* render real en 9:16 **y** 16:9 comparado contra el actual, y medición
antes/después con `npx remotion benchmark`.

**Ola 3 — Capacidades nuevas (por decidir, una por vez).**
`<Video>` de `@remotion/media` (12 usos, medible) → Parakeet como vía rápida de ASR →
LR-ASD para el reencuadre de podcasts → NVENC de hardware en Remotion → SigLIP 2 para
b-roll semántico.
*Regla:* cada una entra sola, con render real antes/después, y se revierte si no gana.

**Deuda estructural a mediano plazo (no es una tarde).**
Actualizador diferencial: hoy cada update es una redescarga manual de 5-7 GB **sin
firmar**, con instrucciones anti-SmartScreen. Es el mayor lastre operativo para vender.

## Regla de verificación

Ningún ítem se declara listo sin: `tsc` en 0, `npm test` + `pytest` verdes, paridad de
estilos, **un render real** en los dos aspectos, y una medición antes/después cuando el
ítem prometa velocidad. Estimar no cuenta.
