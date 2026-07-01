# Evaluación: programar y publicar videos en redes (referencia: Postiz)

> Análisis previo a cualquier cambio de código. Objetivo del usuario: agregar a Viralito la
> capacidad de **programar y publicar** los videos (con descripción, fecha, plataformas) en
> las redes disponibles, tomando `github.com/gitroomhq/postiz-app` como referencia, **sin
> romper nada** de lo existente. Fecha: 2026-06-30.

## 0. Resumen ejecutivo (la recomendación)

**NO** embeber/forkear Postiz ni adoptar su stack. **SÍ** extender el sistema de publicación
que Viralito **ya tiene**, usando Postiz como **referencia de la lógica por plataforma**.

Razones (las dos banderas rojas):
1. **Licencia:** Postiz es **AGPL-3.0** (copyleft de red). Copiar su código a Viralito
   obligaría a Viralito a ser AGPL — choca con el principio del proyecto ("todo el stack en
   CC0/MIT/BSD", CLAUDE.md). Leer/estudiar Postiz es libre; **copiar código no**.
2. **Stack:** Postiz corre sobre **NestJS + PostgreSQL + Redis + Temporal + Resend**. Viralito
   es **local-first, offline-capable, cero costo recurrente** (stores JSON + scheduler
   `setInterval` en el server Next). Meter Postgres/Redis/Temporal contradice esos principios
   y agrega infra pesada a una app de escritorio.

## 1. Lo que Viralito YA TIENE (no romper — es la base a extender)

| Pieza | Archivo | Estado |
|---|---|---|
| Plataformas | `frontend/src/lib/platforms.ts` | tiktok, instagram, linkedin, facebook (4 def; activas IG+LinkedIn) |
| OAuth | `api/auth/{instagram,linkedin,tiktok}/{login,callback}` | IG ✓ · LinkedIn ✓ · TikTok ✓ |
| Publicar | `api/{instagram,linkedin}/publish`, `api/tiktok/schedule` | IG (puente manual) · LinkedIn (auto) · TikTok (schedule) |
| Clientes/upload | `lib/{instagram,linkedin,tiktok}-{client,upload}.ts` | por plataforma |
| **Scheduler** | `lib/scheduled-uploads.ts` | store JSON + worker `setInterval(60s)`: escanea `pending` con `scheduledAt<=now`, marca `running`, dispara upload por plataforma, persiste. Estados: pending/running/published/**pending_manual** (puente IG)/failed |
| UI producción | `components/produccion/{schedule-dialog,schedule-status-badge,production-list,caption-tabs,upload-helper-dialog,instagram-helper-dialog}.tsx` | dialog de fecha/hora por video + estado; captions por plataforma |
| Métricas | `lib/metrics-store.ts`, ruta `/metricas` | engagement/viralRatio/retention |
| Tests | `lib/produccion/__tests__/{publish-actions,schedule-helpers}.test.ts` | cubren publish + helpers |

**Conclusión:** ya hay un **publicador ligero funcional de 3 redes** con scheduler propio. El
pedido NO es construir de cero: es **cerrar gaps** (más redes, calendario, robustez).

## 2. Lo que Postiz ofrece (y qué de eso conviene)

- **Plataformas (14+):** IG, YouTube, LinkedIn, Reddit, TikTok, Facebook, Pinterest, Threads,
  X, Bluesky, Mastodon, Dribbble, Slack, Discord. ← **lo valioso: la lógica por red**.
- **Scheduler robusto** (Temporal), **calendario** visual, multi-cuenta/equipos, analytics, AI.
- **Stack:** NestJS + Next + PostgreSQL(Prisma) + Redis + Temporal + Resend, monorepo pnpm,
  Docker Compose. Self-host = levantar todos esos servicios.
- **Referencia de oro:** `libraries/nestjs-libraries/src/integrations/social/*.ts` — **una
  clase por red** con OAuth (scopes, endpoints) + subida de media + publish. Ahí está el
  conocimiento duro de cada API (que es la parte difícil y cambiante). Se **estudia** y se
  **reimplementa limpio** en el estilo de Viralito (no se copia por la AGPL).

## 3. Aristas del análisis (todas)

### 3.1 Licencia (CRÍTICA) 🔴
AGPL-3.0. Copiar código Postiz → Viralito se vuelve AGPL (obligación de liberar fuente,
incluso en uso por red). Incompatible con "todo MIT/CC0". **Decisión: referencia sí, copia no.**

### 3.2 Arquitectura / stack (CRÍTICA) 🔴
Postgres+Redis+Temporal+NestJS vs Viralito local-first/offline/JSON/`setInterval`. Adoptar el
stack rompe "cero costo recurrente" + offline + simplicidad de la app de escritorio.

### 3.3 Realidad por plataforma (la parte difícil de verdad)
Cada red tiene su propio OAuth + API + límites; **no es un solo "publicar"**:
- **LinkedIn**: API estable, publish directo (ya funciona en Viralito). ✅ más fácil.
- **Instagram**: Graph API requiere **cuenta Business/Creator + página FB vinculada**; posteo
  directo de Reels es posible con tokens de larga duración, pero la API es quisquillosa →
  por eso Viralito tiene el **puente manual** (`pending_manual`). Realista mantenerlo semi-auto.
- **TikTok**: Content Posting API (ya con schedule en Viralito); requiere app aprobada + review.
- **Facebook**: Graph API (pages). Definido en Viralito pero **sin cablear** → gap concreto.
- **YouTube**: Data API v3 (resumable upload). Cuota diaria; subir 1 video ≈ 1600 unidades de
  10000/día → ~6 subidas/día por proyecto sin ampliación de cuota.
- **X/Twitter**: API v2 de **PAGO** (Basic ~100 USD/mes para postear con media). 🔴 costo.
- **Threads / Bluesky / Mastodon**: APIs libres y sencillas (buenas candidatas gratis).
- **Reddit/Pinterest/Discord/Slack**: nicho, opcionales.

### 3.4 Costo 🔴/🟡
- Infra Postiz (Postgres/Redis/Temporal) = costo/mantenimiento. Contra "cero costo".
- Algunas APIs de pago (X). Otras gratis (LinkedIn, Threads, Bluesky, Mastodon, YT con cuota).

### 3.5 Seguridad / secretos
Cada red = client_id/secret + tokens de usuario. Ya se maneja en `.env.local` (gitignored) +
callbacks OAuth. Sumar redes = sumar secretos, mismo patrón. **Nunca commitear secretos.**

### 3.6 Mantenimiento
Las APIs sociales cambian seguido. Postiz tiene un equipo que las mantiene; Viralito tendría
que mantener cada provider propio. → favorece **pocas redes bien hechas** sobre 14 frágiles.

### 3.7 Fiabilidad del scheduler
El worker `setInterval(60s)` vive en el process del server Next: si la app está cerrada, **no
publica** a la hora. Postiz (Temporal) sobrevive reinicios. Gap a cubrir: persistencia +
recuperación de "vencidos mientras estaba apagada" (ya hay patrón en la cola de jobs de Viralito).

## 4. Opciones de integración (con trade-offs)

| Opción | Qué es | Pros | Contras | Veredicto |
|---|---|---|---|---|
| **A. Forkear/embeber Postiz** | Copiar su código | Todo hecho | 🔴 AGPL contamina · 🔴 stack pesado · rompe principios | ❌ |
| **B. Postiz como sidecar** (Docker) + su API | Correr Postiz aparte, Viralito le manda posts | Sin copiar código (AGPL separado) · 14 redes | 🔴 Postgres/Redis/Temporal en la máquina del user · pesado para desktop · cero-costo roto · 2 apps que mantener | ⚠️ solo si el user quiere las 14 redes ya |
| **C. Extender lo propio, Postiz de referencia** | Reimplementar providers en el estilo Viralito + calendario + robustez | ✅ MIT/local/offline/cero-costo intactos · additive (no rompe IG/LinkedIn/TikTok) · incremental | Reimplementar cada red (trabajo por red) | ✅ **recomendado** |

## 5. Recomendación + plan por fases (aditivo, no rompe nada)

**Opción C.** Cada fase es additive y testeable; nada toca el render ni el pipeline.

- **Fase 0 — Fundaciones (bajo riesgo):**
  - Abstraer un **`SocialProvider` interface** (authUrl, exchangeCode, publish(media,caption,when))
    unificando IG/LinkedIn/TikTok que ya existen (refactor sin cambio de comportamiento).
  - **Calendario visual** en `/produccion` (mes/semana) leyendo `scheduled-uploads.json` —
    solo UI sobre datos que ya existen.
  - **Robustez del scheduler:** al arrancar, recuperar `pending` vencidos mientras estaba
    apagado (mismo patrón que la cola de jobs reanudable).
- **Fase 1 — Redes gratis y fáciles:** cablear **Facebook** (ya definido) + agregar **YouTube**
  (Data API v3) + **Threads/Bluesky** (APIs simples, gratis). Cada una = un provider nuevo + su
  OAuth + su botón, sin tocar las existentes.
- **Fase 2 — Programación fina:** descripción/hashtags por red ya generados (reusar caption-tabs),
  ventanas óptimas por red, recurrencia, cola de "publicar todos los de este lote".
- **Fase 3 (opcional):** X (avisar costo), Pinterest/Reddit si el nicho lo pide.

## 6. Cómo NO romper lo existente
- Todo **aditivo**: nuevos providers/rutas/UI; NO tocar `instagram/linkedin/tiktok` que ya andan.
- Gate verde cada paso (tsc 0, tests, paridad). Tests nuevos por provider.
- Secretos solo en `.env.local` (gitignored). Solo librerías MIT/Apache.
- Sin Postgres/Redis/Temporal: seguir con store JSON + scheduler propio (mejorado).
- Offline: publicar requiere red (obvio), pero la app y el render siguen funcionando sin ella.

## 7. Decisiones que necesito del usuario antes de implementar
1. ¿Qué **redes** priorizar? (sugerencia: cerrar Facebook + YouTube + Threads/Bluesky — gratis).
2. ¿Vale la pena **X** (API de pago ~100 USD/mes) o lo saltamos?
3. ¿Querés el **calendario** visual como primer entregable (alto impacto, bajo riesgo)?
4. ¿IG lo dejamos **semi-auto** (puente manual, como está) o intentamos full-auto (requiere
   cuenta Business + más fricción de setup)?

---

## 8. Dirección elegida por el usuario (2026-06-30) + plan refinado

**Lo que pidió:** la sección de publicación debe **verse y ordenarse como Postiz** (su repo);
usar **lo que ya sirve de Postiz** (reimplementado, no copiado — ver §3.1 licencia); agregarla
como una **sección nueva** (tarjeta en el home + su propio menú, como las del inicio);
**NO cambiar el funcionamiento** de creación de videos (render/wizard/editor); y **eliminar**
lo de redes que no usamos. (Considera que su sistema actual "no le sirve" y quiere el de Postiz.)

### 8.1 Método legal (AGPL-safe)
- Replicar el **look & feel / orden** de Postiz (calendario, composer, sidebar de canales) →
  legal (el diseño/UX se puede imitar; no se copia código).
- **Reimplementar** la lógica por red mirando los providers de Postiz como referencia técnica.
- **NO** pegar código Postiz literal (AGPL). Solo librerías MIT/Apache.

### 8.2 Estructura de Postiz a replicar (de su repo `apps/frontend/src/components`)
- **launches** → vista principal = **calendario** de posts programados (mes/semana/día).
- **new-launch / preview / provider-preview** → **composer**: escribís 1 vez, preview POR red,
  media, selector de fecha/hora.
- **channels (plugs)** → **sidebar de cuentas conectadas** con ícono/avatar por red.
- **analytics / platform-analytics** → métricas por red (Viralito ya tiene `/metricas`).

### 8.3 Nueva sección en Viralito (aditiva)
- Nueva **tarjeta en el home** (como las 4 actuales): "📅 Programar y publicar".
- Nueva ruta `/publicar` (o renombrar/absorber `/produccion`) con layout estilo Postiz:
  sidebar de canales + calendario central + botón "Nuevo post" → composer.
- Reusa datos que YA existen: `scheduled-uploads.json` (calendario), captions por red
  (`caption-tabs`), renders listos (`production-list`), métricas.

### 8.4 Keep / Remove del código de redes actual
**KEEP (sirve, se reusa bajo el nuevo look):**
- `scheduled-uploads.ts` (el motor de scheduling — se mejora, no se tira).
- `linkedin-client/upload` (LinkedIn anda auto — el mejor caso).
- `tiktok-client/upload` + `tiktok/schedule` (schedule funciona).
- `instagram-client/upload` (queda como semi-auto / puente manual).
- `platforms.ts`, `metrics-store.ts`, `notifications-store.ts`, OAuth callbacks.

**REMOVE/absorber (lo que "no usamos"):**
- Confirmar con el usuario qué exactamente no usa. Candidatos: componentes de `/produccion`
  que el nuevo look reemplace (schedule-dialog viejo → composer nuevo; production-list →
  integrada al calendario). Se ELIMINAN al reemplazarlos, no antes (para no romper).

### 8.5 Plan por fases (cada una aditiva, gate verde, no toca render/wizard)
- **Fase 0 — Cascarón estilo Postiz:** tarjeta en el home + ruta `/publicar` + layout
  (sidebar de canales + **calendario** leyendo `scheduled-uploads.json`) + botón "Nuevo post".
  Solo UI sobre datos existentes → riesgo casi nulo.
- **Fase 1 — Composer estilo Postiz:** escribir 1 vez + preview por red + media (el render
  listo) + fecha/hora → crea entries en `scheduled-uploads`. Reusa captions por red.
- **Fase 2 — Robustez del scheduler:** recuperar programados vencidos tras reinicio.
- **Fase 3 — Más redes (reimplementadas de referencia):** Facebook (ya def) + YouTube +
  Threads/Bluesky (gratis). Un provider por red, aditivo.
- **Fase 4 — Limpieza:** eliminar los componentes viejos de `/produccion` ya reemplazados.

### 8.6 Riesgo / no romper
- La creación de videos (render, wizard, editor, largos) **NO se toca** en ninguna fase.
- Cada fase: tsc 0 + tests + paridad; solo aditivo hasta la Fase 4 (limpieza controlada).
- Secretos solo en `.env.local`. Sin Postgres/Redis/Temporal (seguimos JSON + scheduler propio).

---

## 9. Estado de implementación (loop 2026-06-30)

**HECHO, probado y en vivo (aditivo, sin tocar la creación de videos):**
- **Fase 0** (f5bb796): tarjeta home + /publicar + sidebar de canales + calendario mensual + /api/scheduled/list.
- **Fase 1** (f53087e): composer estilo Postiz (elegir video → redes → descripción → fecha/hora → programa). Test funcional OK (crea entry pending → aparece en el calendario).
- **Fase 2** (140c3b2): abrir /publicar arranca el scheduler → recupera programados vencidos tras reinicio. Verificado en log.
- **Fase 4** (c89cb25): /publicar es el HUB único (calendario + composer + ProductionList absorbida). /produccion → redirect 307 a /publicar. Home a 4 tarjetas.

Redes que FUNCIONAN hoy (reusadas): **LinkedIn** (auto), **TikTok** (schedule), **Instagram** (semi-auto/puente).

**Fase 3 (más redes) — BLOQUEADA por credenciales del usuario:**
Agregar Facebook / YouTube / Threads / Bluesky requiere, por red, una **app de desarrollador
+ client_id/secret** (o app-password en Bluesky) que SOLO el usuario puede crear en la consola
de cada plataforma. No se puede construir+probar sin eso (la regla del loop es "probar cada
fase"; el publish real necesita una cuenta conectada). Además tocar el scheduler para sumar una
red es riesgoso sin poder testear el publish.
- **Más fácil / sin app de dev:** **Bluesky** (usa handle + app-password que el user genera en
  Ajustes → App Passwords, 30 seg). Buena primera red nueva.
- **Necesitan app de dev (Meta/Google):** Facebook (Meta app), Threads (Meta app), YouTube
  (Google Cloud project + OAuth). Cuota YT ~6 subidas/día sin ampliación.
- **Plan:** cuando el usuario diga qué red + provea las credenciales (en .env.local, nunca
  commit), se construye ESE provider (OAuth/session + upload + platform en el scheduler +
  opción en el composer) y se prueba end-to-end.
