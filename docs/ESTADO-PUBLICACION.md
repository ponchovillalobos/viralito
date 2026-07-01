# Estado de "Publicar y programar" — para retomar

> Resumen para cuando vuelvas. La app + el túnel quedan corriendo. **No se hizo push.**

## ✅ Lo que quedó HECHO, probado y commiteado
- **Sección "Programar y publicar"** completa: calendario + composer + hub (absorbe "Mis videos").
  En vivo en `localhost:3100/publicar`. Gate verde (tsc 0, 124 tests, paridad).
- **Pipeline de publicación PROBADO end-to-end** (modo dry-run): programar → worker → verifica el
  render → marca "publicado" → aparece en el calendario. Funciona. Lo único que falta en modo real
  es la llamada a la API de la red (que necesita tu cuenta conectada).
- **4 redes cableadas en el código:** LinkedIn, Instagram, TikTok, Facebook (FB reusa la app Meta de IG).
- **Bugs reales de TikTok arreglados:** OAuth con **PKCE** (TikTok v2 lo exige) + soporte de **túnel
  HTTPS** (`VIRAL_OAUTH_BASE_URL`) para el redirect, en las 3 redes OAuth.
- **Túnel Cloudflare** corriendo: `https://almost-inquiry-rush-confidential.trycloudflare.com` → localhost:3100.
- **Credenciales de TikTok** cargadas en `.env.local` (Client Key + Secret). Vacías: LinkedIn, Meta.

## ⛔ Lo que necesita VOS (no lo puedo hacer solo)
Publicar de verdad necesita una red **conectada** (token OAuth), y eso requiere autorizar en el
navegador con tu cuenta. Ninguna está conectada todavía.

## 🎯 Recomendación para publicar rápido = LinkedIn
LinkedIn funciona con **localhost** directo — sin túnel, sin sandbox, sin revisión. Es el camino
más confiable para ver un video publicándose HOY. Pasos (te guío cuando estés):
1. Crear app gratis en https://www.linkedin.com/developers/apps
2. Productos: "Share on LinkedIn" + "Sign In with LinkedIn".
3. Pegar Client ID + Secret en `.env.local` (líneas `LINKEDIN_CLIENT_ID=` / `LINKEDIN_CLIENT_SECRET=`).
4. Registrar el redirect `http://localhost:3100/api/auth/linkedin/callback`.
5. Reiniciar la app → Configuración → Conectar LinkedIn → autorizar → **publicar**.

## 🟡 TikTok — a mitad de camino (su portal es finicky)
- Bug del código: **arreglado** (PKCE + túnel).
- Su **portal Sandbox no persistía la config** (productos/scopes/ícono se borraban al guardar),
  casi seguro porque rechazaba el redirect `http://localhost`. Ya está el **túnel HTTPS** para eso.
- Falta: reconectar la extensión de Chrome, re-subir el ícono (`Escritorio/viralito-icon.png`),
  guardar con el redirect del túnel ya puesto, y autorizar el OAuth **entrando por la URL del túnel**
  (no localhost — así las cookies del OAuth coinciden con el dominio del redirect).
- TikTok Sandbox creado + tu cuenta `ponchoroble` agregada como target user.

## Cómo se prueba el pipeline sin conectar nada (dry-run)
Arrancar la app con `VIRAL_PUBLISH_DRYRUN=1` → programar un post desde el composer → el worker lo
marca "publicado" (simulado) en ~1 tick. Sirve para validar todo el flujo sin credenciales.

---

## 🎉 TikTok — CONECTADO y publicando (logrado)
Primera publicación real de Viralito → TikTok (video subido a borradores de la cuenta ponchoroble).
Lo que se destrabó:
- **OAuth con PKCE** (commit dd33383) — TikTok v2 lo exige.
- **Túnel Cloudflare HTTPS** (VIRAL_OAUTH_BASE_URL) — TikTok rechaza `localhost` en el redirect; con
  el túnel el Sandbox **guardó la config** (antes se borraba) y el OAuth conectó.
- **Fix del chunk** (commit bee2062) — `total_chunk_count` con `floor` (no `ceil`), que daba
  "The total chunk count is invalid".
- **Modo inbox/borrador** — una app SIN auditar solo puede subir a borradores (no directo a público).
  El video llega a los borradores de TikTok y el usuario lo publica desde la app. Para publicación
  100% automática al feed público hay que mandar la app a **auditoría** en developers.tiktok.com.

**Cómo publicar en TikTok ahora:** programar con `mode: "inbox"` → el worker sube el video a los
borradores → abrir TikTok en el celular → publicar el borrador.

**Nota del túnel:** la URL `https://almost-inquiry-rush-confidential.trycloudflare.com` es del túnel
cloudflared actual; si cloudflared se reinicia, la URL cambia y hay que re-registrar el redirect en
el Sandbox de TikTok + actualizar VIRAL_OAUTH_BASE_URL. Mientras el túnel siga vivo, todo funciona.
