# Estilos visuales (base)

> **Actualizado:** este doc detalla los estilos base y su configuración JSON. El sistema
> hoy tiene **23 estilos** en total (`frontend/src/lib/style-registry.data.json` es la
> fuente de verdad del catálogo). Además de los base de aquí, incluye `cinematic_pro`,
> `broll_full`, `broll_pip`, `text_behind`, `pop_reels`, `graphics_pro`, `graphics_max`,
> `motion_pro`, `motion_beat`, `motion_grid`, `editorial`, `editorial_broll`,
> `kinetic_type`, `lottie_pop`, `paper_cut` y `cine_clasico`, más un set de efectos
> "nivel CapCut" (LUTs de color, light leaks, transiciones pro, tipografía cinética,
> beat-sync, motion tracking, quitar fondo con IA) que se aplican a **todos** los estilos vía
> `applyCapcutFx()`. Para el panorama completo y los estilos nuevos, ver
> **[EFFECTS.md](./EFFECTS.md)**.
>
> Nota: la fuente de verdad de los estilos es `frontend/src/lib/style-templates.ts`
> (no `styles.json`). Para usar un estilo, poné el `styleId` correspondiente en el proyecto.

## 1. Silent — `silent`

**Tagline**: Limpio, sin distracciones.

**Cuándo usar**: pedagógico, LinkedIn, casos donde la cara del speaker es lo único que importa.

**Elementos**:
- Subtítulos Bebas Neue 96px, color blanco, highlight en accent color
- **Sin b-roll automático**: silent nace con `bRoll: []` (sólo `broll_full`/`broll_pip` autollenan b-roll de Pexels por transcripción). El `bRollMode: "fullscreen"` es el default heredado, pero si no agregas clips a mano no se muestra nada — el estilo es deliberadamente limpio.
- 2-3 animaciones suaves: zoom on hook, glow keyword, shake emphasis
- Sin emphasis cards, sin stickers, sin floating emojis, sin vignette
- Color rotación opcional para subtítulos multicolor

**Configuración mínima en proyecto JSON**:
```json
{
  "styleId": "silent",
  "bRollMode": "fullscreen",
  "vignette": false,
  "captionBounce": false,
  "enableJumpCuts": false,
  "wordStickers": [],
  "floatingEmojis": [],
  "emphasisCards": [],
  "sfxMarks": [],
  "animations": [
    {"at": 0.5, "type": "zoom"},
    {"at": 15.0, "type": "glow"}
  ]
}
```

## 2. Punch — `punch`

**Tagline**: Impacto en momentos clave.

**Cuándo usar**: hooks de 3s, cierres con CTA fuerte, videos con 3-5 conceptos clave a memorizar.

**Elementos**: igual que Silent (tampoco autollena b-roll; nace con `bRoll: []`) +
- **3-5 emphasis cards fullscreen** que tapan todo durante 0.8-1.4s
- Cada card: emoji enorme (360px) + palabra gigante (90-220px auto-fit) + accent line creciente + blur de fondo
- Subtítulos siguen activos pero pausan visualmente durante la card

**Configuración**:
```json
{
  "styleId": "punch",
  "bRollMode": "fullscreen",
  "emphasisCards": [
    {"at": 0.5, "duration": 1.2, "word": "ERROR", "emoji": "🚫", "bg": "#0a0a0a", "color": "#ffffff", "accent": "#fb7185"},
    {"at": 30.0, "duration": 1.5, "word": "GUARDA", "emoji": "💾", "bg": "#0a0a0a", "color": "#ffffff", "accent": "#fb7185"}
  ]
}
```

## 3. Hype — `hype`

**Tagline**: Estilo MrBeast/Hormozi viral.

**Cuándo usar**: TikTok / Reels videos cortos con alta densidad de info, hooks que necesitan retención sub-3s, look "pro creator" con mucho movimiento.

**Elementos**:
- Subtítulos Anton 96px, color blanco + highlight accent
- **B-roll en PiP** (cuadro 540×720 vertical, centrado abajo, borde 5px del accent + glow)
- **Word stickers top-center** rotados, fondo accent, texto negro (siempre top-center; los JSONs viejos con top-right/left se ignoran)
- **Floating emojis** entrando del lateral (left/right/top/bottom), hover 1.2s, salida con fade
- **Zoom rítmicos** sincronizados con keywords (1.10-1.22x con curva senoidal, 0.5-0.7s)
- **Vignette** radial sutil
- Mono-color: TODO usa el mismo accent (no chile-mole-pozole)

**Configuración**:
```json
{
  "styleId": "hype",
  "accentColor": "#fb7185",
  "subtitleStyle": "anton",
  "subtitleHighlight": "#fb7185",
  "bRollMode": "pip",
  "vignette": true,
  "captionBounce": false,
  "wordStickers": [...7 stickers...],
  "floatingEmojis": [...4-5 emojis...],
  "zoomMarks": [...5-7 zooms...]
}
```

## 4. Hype Max — `hype_max`

**Tagline**: Hype + técnicas virales avanzadas.

**Cuándo usar**: TikTok agresivo, máxima retención, video corto con alta densidad.

**Elementos**: igual que Hype +
- **Jump cuts**: silencios cortados automáticamente con silero-vad + ffmpeg
- **Reaction zoom punches**: zoom abrupto 1.0 → 1.42 en 3 frames + shake 14px (en finales de frase)
- **Caption bounce**: spring overshoot (1.0 → 1.08 → 1.0) en cada palabra
- **Stutter marks**: shake X violento 0.18s en momentos antes del punchline

**Configuración**:
```json
{
  "styleId": "hype_max",
  "enableJumpCuts": true,
  "captionBounce": true,
  "reactionZooms": [
    {"at": 4.2, "intensity": 1.42, "duration": 0.22},
    {"at": 17.0, "intensity": 1.4, "duration": 0.22}
  ],
  "stutterMarks": [
    {"at": 11.5, "duration": 0.18},
    {"at": 26.4, "duration": 0.18}
  ]
  // + todo lo de hype
}
```

## 5. Hype Max SFX — `hype_max_sfx`

**Tagline**: El premium con sonidos coordinados.

**Cuándo usar**: cuando quieras el look viral con audio puntuando palabras clave. Default para la mayoría de shorts.

**Elementos**: igual que Hype Max +
- **5-7 SFX coordinados** con momentos clave (whoosh, pop, ding, gota, bloop, notification, etc.)
- Volumen sutil 0.3-0.45 (no tapa la voz)
- Variar el SFX en cada uso (no repetir 2 seguidos)

**Configuración**:
```json
{
  "styleId": "hype_max_sfx",
  "sfxMarks": [
    {"at": 0.3, "sound": "swoosh.wav", "volume": 0.35},
    {"at": 8.4, "sound": "water_drop.ogg", "volume": 0.5},
    {"at": 11.6, "sound": "pop.ogg", "volume": 0.4},
    {"at": 14.8, "sound": "ding.ogg", "volume": 0.35},
    {"at": 18.3, "sound": "bloop.ogg", "volume": 0.35},
    {"at": 21.1, "sound": "notification.ogg", "volume": 0.45}
  ]
  // + todo lo de hype_max
}
```

## Bonus: Supreme — `supreme`

**Tagline**: Fusión total para clips del long_form pipeline.

Combina Punch + Hype Max + SFX. Es el estilo automático que aplica el orquestador `long_form_pipeline.py` a cada clip extraído del video largo.

**Elementos**: TODO lo anterior +
- 2-3 **emphasis cards fullscreen** estratégicas:
  - Inicio: hook
  - Mitad: insight pico
  - Final: CTA "GUARDALO"
- Generado automáticamente desde el transcript del clip

No requiere configuración manual — `build-clip-supreme.mjs` lo arma desde la propuesta de Ollama.

## 6. Tipografía cinética — `kinetic_type`

**Tagline**: Subtítulos gigantes que rebotan + fondo mesh que late con la música, sin emojis.

**Cuándo usar**: cuando querés un look limpio y rítmico centrado en la palabra, sin stickers ni floating emojis. Ideal para frases punchy y contenido de autoridad.

**Elementos**:
- Subtítulos gigantes con bounce (spring overshoot) palabra por palabra
- Fondo mesh animado que pulsa al beat de la música (familia `motion` + `music`)
- **Sin emojis, sin stickers, sin floating emojis** — la tipografía es la protagonista
- Mono-color por video

**Configuración mínima**:
```json
{
  "styleId": "kinetic_type",
  "captionBounce": true,
  "wordStickers": [],
  "floatingEmojis": []
}
```

## 7. Animado con stickers — `lottie_pop`

**Tagline**: Lleno de vida: stickers animados (Lottie) + íconos + fondo aurora + karaoke.

**Cuándo usar**: contenido juvenil y enérgico donde querés máxima vida en pantalla con animaciones reales (no estáticas).

**Elementos**:
- **Stickers animados Lottie** + íconos line-art elegidos según lo que decís (`illustrations: true`)
- Fondo aurora animado (familia `motion` + `music`)
- Subtítulos karaoke
- Mono-color por video

**Configuración mínima**:
```json
{
  "styleId": "lottie_pop"
}
```

## 8. Papel recortado — `paper_cut`

**Tagline**: Collage editorial: tu video en un panel de papel recortado + titulares serif.

**Cuándo usar**: estética editorial artesanal tipo collage/zine, con tu video enmarcado en un panel de papel recortado y titulares serif.

**Elementos**:
- Tu video en un panel de papel recortado (look collage)
- Titulares serif gigantes
- Estilo de largos (`longForm: true`), sin gráficas automáticas

**Configuración mínima**:
```json
{
  "styleId": "paper_cut"
}
```

## 9. Editorial con archivo — `editorial_broll`

**Tagline**: Editorial documental + videos de archivo (Pexels) que ilustran lo que dices.

**Cuándo usar**: documental premium con material de apoyo. Es el estilo `editorial`
(panel lateral + titulares serif gigantes + ilustraciones doradas) **más** videos de
archivo de Pexels que ilustran lo que decís, montados en cortinillas sobre el lienzo.

**Elementos**: igual que `editorial` +
- **Videos de archivo (Pexels)** elegidos por transcripción que ilustran el tema
- Se montan en **cortinillas** sobre el lienzo editorial (no a pantalla completa)
- Requiere API key gratis de Pexels (opcional) para el material de archivo
- `illustrations: true` — sigue usando las ilustraciones line-art doradas del editorial

**Configuración mínima**:
```json
{
  "styleId": "editorial_broll"
}
```

## 10. Cine clásico — `cine_clasico` 🎞️🎙️

**Tagline**: Cine antiguo: en los momentos dramáticos la voz suena a radio vieja y la imagen se vuelve blanco y negro.

**Cuándo usar**: relatos con carga emocional donde querés un giro cinematográfico de
época en los picos. Fuera de los picos es cine elegante; en los picos del **director
emocional** entra el drama de cine antiguo.

**Elementos**:
- **Look base** (siempre): subtítulos cine, film grain, LUT cálido desaturado (`kodak_warm`),
  viñeta y música baja — lo hornea `buildProjectForStyle`.
- **En los picos del director emocional** (enriquecedor por-pico, opt-in, best-effort):
  - **Voz** → suena a radio/teléfono antiguo: band-limit (highpass 400 + lowpass 3000)
    **gateado por ventana** (telefónico solo dentro del pico, full-range afuera).
  - **Imagen** → **blanco y negro** + grano solo dentro de cada ventana de pico
    (`project.bwWindows`).
  - **SFX** → cine antiguo: `typewriter.wav` y `film_reel.wav` (máquina de escribir +
    carrete de proyector) alternados al inicio de cada ventana de pico.
- **Best-effort**: si no se obtienen picos, el estilo renderiza igual como cine elegante base.
- Todo gateado a `styleId === "cine_clasico"` (ver `frontend/src/app/api/editor/auto-build/lib/cine-clasico.ts`).

**Configuración mínima**:
```json
{
  "styleId": "cine_clasico"
}
```
El drama por-pico se arma automáticamente desde el director emocional; no requiere
configuración manual.

## 11. VHS Retro — `vhs` 📼

**Tagline**: Cámara de los 90: grano, scanlines, ► PLAY con contador y glitch de tracking.

**Cuándo usar**: contenido que gana con lo "imperfecto/analógico" — storytime, humor,
nostalgia, behind-the-scenes. Tendencia sostenida 2026 ("analog nostalgia"): el grano
lee como REAL contra la estética AI-perfecta.

**Elementos** (100% procedurales, `remotion/src/layers/vhs-overlay-layer.tsx`):
- **Scanlines CRT** (repeating-linear-gradient, multiply) + viñeta de tubo.
- **OSD VCR**: `▶ PLAY 0:MM:SS` (contador real del clip) abajo-izquierda y `● REC`
  parpadeante arriba-derecha, en monospace con halo y jitter de 1px.
- **Tracking glitch** cada ~5s: 2 bandas horizontales que saltan con tinte RGB +
  banda de ruido inferior (feTurbulence). Determinista (seeds fijos, sin Date.now).
- **Flicker de brillo** sutil senoidal + micro-ruido.
- **Base**: subtítulos bebas, film grain + viñeta, LUT `vintage_film.cube` (post-fx).
  Sin sceneFx ni proTransitions: el glitch del overlay ES la transición (look raw).
- Prop opt-in `vhsLook` (boolean; default false = render idéntico para el resto).
  Cableado en `build-props.mjs` y `build-clip-props.mjs`.

**Configuración mínima**:
```json
{
  "styleId": "vhs"
}
```

### 25. Audiograma (`audiogram`) 🎙️

Clip de podcast: una **onda de barras mono-color baila con la VOZ real** del clip
(`voiceoverUrl ?? rawVideoUrl`) + branding del show. Desbloquea el vertical
podcast/entrevista sin depender de la imagen.

- **Motor**: `remotion/src/layers/audiogram-layer.tsx` reusa `useWindowedAudioData` +
  `visualizeAudio` de `@remotion/media-utils` (mismo patrón que `AudioPulse`). 100%
  offline, cero deps nuevas.
- **Reglas**: TODAS las barras usan el `accentColor` único (mono-color); la onda vive en
  una banda media (~64% de altura) para NO tapar los subtítulos (abajo) ni los stickers
  (arriba-centro).
- Prop opt-in `audiogram` (`{handle, logoUrl, bars, y, height}` o `null` = render idéntico).
  Cableado en `build-props.mjs`, `build-clip-props.mjs` y `ViralVideo.tsx`.

**Configuración mínima**:
```json
{
  "styleId": "audiogram"
}
```

## 16 SFX disponibles

Curados en `C:\viral-data\videos\assets\sfx\curated\`:

| Archivo | Tipo | Cuándo usar |
|---|---|---|
| `whoosh.ogg` | Whoosh metálico ligero | Transiciones, intros |
| `swoosh.wav` | Swoosh largo orgánico | Cambios de escena |
| `swoosh_soft.wav` | Swoosh muy sutil | Transiciones discretas |
| `swoosh_quick.wav` | Swoosh corto | Cuts rápidos |
| `water_drop.ogg` | Gota de agua | Pausas, silencio, énfasis "limpio" |
| `bloop.ogg` | Bubble pop | Aparición de stickers |
| `splash.ogg` | Splash agua | Cierres de sección |
| `pop.ogg` | Pop bajo | Keywords sutiles |
| `pop_short.ogg` | Pop muy corto | Cada sticker (no abusar) |
| `click.ogg` | Click UI | Interacciones, pequeños CTAs |
| `ding.ogg` | Ding suave | Insights, "ojo a esto" |
| `ding_bell.ogg` | Campana ligera | Momentos AHA |
| `notification.ogg` | Notification beep | CTA fuerte |
| `thud.wav` | Thud grave | Impactos negativos ("error", "no") |
| `typewriter.wav` | Máquina de escribir | Picos dramáticos de `cine_clasico` |
| `film_reel.wav` | Carrete de proyector | Picos dramáticos de `cine_clasico` |

> `typewriter.wav` y `film_reel.wav` se sintetizan localmente con
> `python/synth_sfx.py curated-wav` (para el estilo `cine_clasico`).

## Temas editoriales

El estilo `editorial` (y `editorial_broll`) tiene **17 sub-temas** de fuente/fondo con
identidad propia (cada uno con su miniatura en `frontend/public/theme-thumbs/`). La
fuente de verdad son `EDITORIAL_THEMES` en el wizard. Los más recientes:

| Tema | `theme` id | Look |
|---|---|---|
| Art Déco | `art_deco` | Lujo 1920, crema y dorado |
| Blueprint | `blueprint` | Plano de ingeniería, azul y cian |
| Noir | `noir` | Cine negro, blanco y negro |

(además de Clásico, FT salmón, Vogue noir, Zine riso, Stripe press, Prensa 1900,
Japón mincho, Brutalista, Docu rojo, etc.)

## Paletas de color recomendadas

Para mantener consistencia visual y diferenciar videos:

```javascript
const PALETTE = [
  "#fb7185", // rosa coral - urgencia / advertencia
  "#a78bfa", // violeta - autoridad / persuasión
  "#fbbf24", // amarillo - claridad / objetivo
  "#34d399", // emerald - crecimiento / cambio positivo
  "#22d3ee", // cyan - tecnología / claridad
  "#ec4899", // magenta - intensidad / hot take
  "#fb923c", // naranja - acción / urgencia
  "#a3e635", // lime - energía / fresh
  "#6366f1", // indigo - IA / futuro
  "#c084fc", // violeta claro - elegancia
];
```

Cuando uses Hype/Hype Max/Hype Max SFX, elegir UN color por video (no mezclar). Para 30 videos en 30 días, el script `build-block2.mjs` rota la paleta automáticamente.

## Énfasis: congelado y escala medida

Dos recursos que no pertenecen a ningún estilo — se aplican por encima de
cualquiera de los 25. Los dos vinieron de revisar el proyecto hermano, y los dos
llenan un hueco concreto del catálogo, no son adorno.

### Congelado (`freezeMarks`)

La imagen se detiene un instante mientras subtítulos y stickers siguen
animando. Es lo contrario de todo lo demás del catálogo: barridos, destellos y
zooms existen para PASAR de un plano a otro; el congelado detiene el tiempo para
que una frase aterrice.

Lo coloca solo el director emocional (`fx-enrichments.ts`), **uno por video** y
sólo si el pico supera 0.7 — por encima del umbral de las chispas (0.6). El
límite es deliberado: repetido deja de leerse como énfasis y empieza a leerse
como que el video se traba. Dura 0.35 s, lo justo para notarse sin parecer un
error de reproducción.

Medido sobre un clip real, comparando los cuadros 92 y 98 con y sin la marca:

```
banda central del video (sin subtítulos ni stickers)
  con congelado    PSNR = inf      → idénticos bit a bit
  sin congelado    PSNR = 18.83 dB → el video avanza

cuadro completo (subtítulos incluidos)
  con congelado    PSNR = 22.82 dB
  sin congelado    PSNR = 16.98 dB
```

El `inf` de la banda central es la comprobación que importa: el video se detiene
de verdad. La diferencia que queda en el cuadro completo son los overlays, que
siguen su curso — que es exactamente el efecto buscado.

**Ese `inf` vale cuando nada más se mueve sobre esa banda.** Repetida la medición
en un pico con un destello (`sceneFx`) y un micro punch-in encima, da 24.55 dB
contra 18.85 dB sin la marca: el congelado sigue funcionando —la diferencia cae a
la mitad— pero no llega a `inf` porque el destello y el zoom no se detienen.

Y no se detienen **a propósito**. `<Freeze>` congela el tiempo de lo que envuelve,
que es el nodo del video; los overlays y el encuadre son hermanos suyos y siguen
corriendo. Un congelado con un push-in suave encima es un recurso clásico, no un
defecto: la imagen se detiene, la cámara sigue entrando. Por construcción se dan
juntos —el congelado va al pico ≥0.7 y el reaction-zoom a los ≥0.55, así que el
pico máximo recibe los dos— y se deja así queriendo.

### Escala medida (`escala_medida`)

Transición de entrada/salida para inserts: la imagen entra al 50 % y crece a
tamaño normal con curva suave (*smoothstep*, `p·p·(3−2p)`). Ni aparece de la
nada como `fade`, ni invade como `zoom_out`.

El agente VFX de `cinematic_assembly.py` la ofrece y la recomienda para inserts
informativos (fotos, capturas, gráficos). **El respaldo mecánico sigue siendo
`fade`**, a propósito: es el valor conservador y no depende del criterio del
modelo. La evidencia de que la escala lee mejor viene del proyecto hermano —
suficiente para ofrecerla, no para voltear un default de este proyecto sin
medirlo acá.

### Por qué cada uno lleva su propio guardián

Los dos nacieron rotos de la misma forma, y no de una que dé error:

- `escala_medida` estaba en el enum de Zod y en el `switch` que la dibuja, pero
  **ausente de la lista del prompt**, que es lo único que el modelo lee. Válida,
  tipada, y jamás elegida.
- `freezeMarks` se escribía en el proyecto y el composition sabía aplicarlo,
  pero **ningún builder de props lo copiaba**. El composition recibía siempre la
  lista vacía.

Ninguna de las dos habría fallado un render. Por eso hay ahora dos tests que
recorren la cadena entera: `transiciones-alcanzables.test.ts` (las tres copias
de la lista de transiciones dicen lo mismo) y `congelado-cableado.test.ts` (los
cinco eslabones del congelado). Los dos se comprobaron rompiéndolos a propósito.

### Barridos de color en los cortes a B-roll (`proTransitionSeries`)

Un panel del acento cruza el cuadro con las transiciones **oficiales** de
Remotion (`@remotion/transitions`: `slide`, `wipe`, `flip`, `clockWipe`). Es el
complemento de `proTransitions`, que son las caseras y ponen destellos en los
beats: aquéllas parpadean, éstas barren.

**Dónde.** Sólo donde el video corta de imagen de verdad: la entrada del B-roll
a pantalla completa. Un barrido a mitad de un plano continuo no lee como
transición, lee como error. En modo `pip` el B-roll es una ventanita y el plano
no corta, así que ahí no va ninguno.

**Cuántos.** Tres como máximo, sobre segmentos de 1.2 s o más, con la dirección
alternada. Quince barridos no se ven editados, se ven nerviosos; y barrer para
tapar medio segundo de archivo no compensa.

**De qué color.** El acento, uno solo — la misma regla mono-color de siempre.

#### La capa abortaba el render y nadie lo sabía

`ProTransitionSeriesLayer` estaba montada en el composition y cableada en los
**dos** builders de props desde antes. Su array llegaba siempre vacío, y la
lectura fácil era "nadie la usa todavía". La real era otra:

```
The duration of a <TransitionSeries.Sequence /> must not be shorter than
the duration of the next <TransitionSeries.Transition />.
The transition is 14 frames long, but the sequence is only 6 frames long
```

`pad = round(dur * 0.4)` es **siempre** menor que `dur`. La capa tiraba el render
entero cada vez que se activaba: nunca pudo funcionar. No lo delataba nada porque
nadie había llenado el array jamás — el defecto y su encubrimiento eran la misma
cosa.

Al arreglarlo apareció un segundo problema debajo: con los dos paneles opacos que
tenía (`color` → `colorTo`), la capa no barría nada, **tapaba** el cuadro de punta
a punta. Ahora la estructura es `vacío → COLOR → vacío`, y el panel de color dura
`2*dur` porque con `dur` las dos transiciones se lo comen entero, se solapan y el
barrido no aparece en ningún fotograma — comprobado renderizando, no razonando.

Verificado de punta a punta en un render completo de 44 s: la luminancia media
salta de 98 a 150 exactamente en el segundo del barrido y vuelve 0.3 s después.
