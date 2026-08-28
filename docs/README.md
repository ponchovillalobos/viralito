# 📚 Documentación — Viralito / Estrategia Viral Poncho

Índice central de toda la documentación del proyecto. Si volvés al proyecto (o lo
seguís **desde otra computadora**), empezá por **[Setup en una PC nueva](#-empezar-de-cero-pc-nueva)**.

> **¿Dónde viven tus datos?** Los videos, modelos y assets NO van en el repo (son
> pesados). Viven en una carpeta de datos aparte: por defecto **`C:\viral-data\videos`**,
> que el sistema **detecta y crea solo**. Podés cambiarla con la variable de entorno
> `VIRAL_DATA_ROOT`. (Instalaciones viejas pueden usar `C:\hermes-data` — es solo un
> nombre distinto de la misma carpeta.) Ver [SETUP.md](./SETUP.md) y [PREREQUISITES](../PREREQUISITES.md).

---

## 🚀 Empezar de cero (PC nueva)

Seguí este orden y arrancás sin trabarte:

1. **[PREREQUISITES.md](../PREREQUISITES.md)** — qué instalar ANTES (Node, Python, Git,
   Ollama, ffmpeg) + **requisitos mínimos del equipo**.
2. **[SETUP.md](./SETUP.md)** — clonar el repo, instalar dependencias y dejar todo listo
   paso a paso (incluye verificación final).
3. **Descargar todo el contenido** — en la app: **Mi sistema → «Configurar todo»** baja en
   una sola pasada el modelo de voz, el modelo de IA y TODAS las bibliotecas (música,
   efectos, iconos, animaciones, ilustraciones).
4. **[USAGE.md](./USAGE.md)** — tu primer video, paso a paso.

> Resumen ultra-corto también en el **[README principal](../README.md)**.

---

## 📖 Uso (cómo se maneja)

| Doc | De qué trata |
|---|---|
| **[USAGE.md](./USAGE.md)** | Tutorial: shorts (chat/CLI) + pipeline de videos largos → clips. |
| **[STYLES.md](./STYLES.md)** | Los 25 estilos visuales y cuándo usar cada uno. |
| **[EFFECTS.md](./EFFECTS.md)** | Sistema de efectos: LUTs, transiciones, tipografía cinética, beat-sync, tracking. |
| **[CAPACIDADES.md](./CAPACIDADES.md)** | Catálogo completo de lo que la app sabe hacer. |
| **[CINEMATIC_MODE.md](./CINEMATIC_MODE.md)** | Modo cinematográfico (imágenes full, grano, color). |
| **[SOCIAL_PUBLISHING.md](./SOCIAL_PUBLISHING.md)** | Conectar y publicar en LinkedIn e Instagram. |
| **[AUTOSTART.md](./AUTOSTART.md)** | Que el dashboard arranque solo al iniciar Windows. |
| **[RENDIMIENTO.md](./RENDIMIENTO.md)** | Cómo el sistema se adapta a tu hardware (modelo IA, encoder, workers). |
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | Errores comunes y cómo resolverlos. |

---

## 🏗️ Técnica (cómo está hecho)

| Doc | De qué trata |
|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Stack y diseño: Next.js + Remotion + Python + Ollama. |
| **[REPOS.md](./REPOS.md)** | Todas las dependencias open-source (MIT/CC0/Apache). |
| **[UI.md](./UI.md)** | Principios de diseño de la interfaz. |
| **[CINEMATIC_TIMELINE.md](./CINEMATIC_TIMELINE.md)** | Composición por capas del modo cine. |
| **[CONTRIBUTING.md](../CONTRIBUTING.md)** | Guía para tocar el código (subproyectos, verificación, convenciones). |
| **[CLAUDE.md](../CLAUDE.md)** | Contexto para trabajar con Claude Code (skills, reglas críticas). |

---

## 📦 Lanzamiento (publicar la app descargable)

| Doc | De qué trata |
|---|---|
| **[RELEASE.md](./RELEASE.md)** | Checklist para publicar una versión nueva (build + GitHub Release). |
| **[INSTALADOR.md](./INSTALADOR.md)** | Cómo se arma el `Setup.exe` (NSIS, verificación SHA256). |
| **[PLAN-LANZAMIENTO.md](./PLAN-LANZAMIENTO.md)** | Plan de salida al mercado. |

---

## 🗂️ Historial, planes e investigación

Documentos de planificación, auditorías y research. Útiles como referencia/memoria, pero
**no hacen falta para usar ni instalar** el proyecto.

| Doc | De qué trata |
|---|---|
| [AUDITORIA-LANZAMIENTO.md](./AUDITORIA-LANZAMIENTO.md) | Auditoría de lanzamiento (hallazgos + fixes). |
| [AUDITORIA-SUPREMO.md](./AUDITORIA-SUPREMO.md) | Auditoría del estilo Supreme. |
| [PLAN-EDITORIAL-SUPREMO.md](./PLAN-EDITORIAL-SUPREMO.md) | Plan del estilo Editorial. |
| [EDITORIAL-NEXT.md](./EDITORIAL-NEXT.md) | Ideas de mejora para Editorial. |
| [PLAN_OPTIMIZACION.md](./PLAN_OPTIMIZACION.md) | Plan de optimización de velocidad. |
| [INVESTIGACION-MOTION-DESIGN.md](./INVESTIGACION-MOTION-DESIGN.md) | Research de motion design en Remotion. |
| [LANZAMIENTO.md](./LANZAMIENTO.md) | Sprint para dejar la app "vendible". |
| [NIVEL_2.md](./NIVEL_2.md) | Sprint de features avanzados. |
| [ROADMAP.md](./ROADMAP.md) | Cadencia semanal de trabajo. |
| [ESTRATEGIA_VIRAL_7_DIAS.md](../ESTRATEGIA_VIRAL_7_DIAS.md) | Estrategia de contenido de 7 días (negocio, no técnica). |

---

_¿Falta algo o un link no abre? Es un bug de docs — corregilo o avisá._
