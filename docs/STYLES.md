# Estilos visuales (base)

> **Actualizado:** este doc detalla los estilos base y su configuración JSON. El sistema
> hoy tiene **más estilos** (`cinematic_pro`, `broll_full`, `broll_pip`) y un set de efectos
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

## 14 SFX disponibles

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
