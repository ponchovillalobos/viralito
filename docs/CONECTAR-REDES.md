# Conectar tus redes — guía para NO ingenieros

> Objetivo: LinkedIn, Instagram, TikTok y Facebook publicando desde Viralito.
> **Lo único que hacés vos:** crear una "app de desarrollador" gratis en cada plataforma (son
> TUS cuentas, nadie las puede crear por vos) y copiar **2 códigos**. Todo lo demás ya está hecho.

## Cómo se pegan los códigos (lo más fácil)
**NO tenés que editar archivos ni el `.env`.** Adentro de la app:

1. Abrí Viralito → ícono de **Configuración** (engranaje, arriba).
2. Tocá **"Conectar LinkedIn"** / **"Conectar Instagram"** / **"Conectar TikTok"** / **"Conectar Facebook"**.
3. Se abre un **asistente paso a paso**: te dice qué clickear, te da un **link para copiar**
   (el "redirect"), y tiene una **cajita para pegar** los 2 códigos. Un paso a la vez, cada uno
   con su ✓.
4. Al pegar los 2 códigos → **conecta solo** (te manda a la red para autorizar y volvés).

Los códigos quedan guardados en la app (no en un archivo). Listo.

## Qué códigos necesitás por red (los 2 valores)

### 1) LinkedIn
- **App:** https://www.linkedin.com/developers/apps → **Create app** (gratis).
- **Productos:** activá **"Share on LinkedIn"** y **"Sign In with LinkedIn"**.
- **Redirect:** el asistente te da el link exacto → pegalo en la app de LinkedIn ("Auth" → Redirect URLs).
- **Copiás:** **Client ID** + **Client Secret** (pestaña "Auth") → pegás en el asistente.
- *(LinkedIn tarda unas horas en aprobar el permiso de posteo; el asistente te avisa.)*

### 2) Instagram + 3) Facebook (¡la MISMA app de Meta para las dos!)
- **App:** https://developers.facebook.com/apps → **Crear app** → tipo "Business" (gratis).
- **Vinculá** tu cuenta de **Instagram Business/Creator** a una **Página de Facebook**
  (en Instagram: Configuración → Cuenta → vincular a una Página de FB). Esto habilita IG **y** FB.
- **Redirect:** el asistente te da el link → pegalo en Meta (Facebook Login → Settings → Valid OAuth Redirect URIs).
- **Copiás:** **App ID** + **App Secret** (Configuración → Básica) → pegás en el asistente de Instagram.
- Con esa misma conexión, **Facebook queda listo también** (postea a tu Página de FB).
- ⚠️ *Meta descarga el video desde un link público para IG. Para eso hace falta una URL pública
  (un "túnel" gratis tipo Cloudflare). Facebook en cambio sube el archivo directo (no necesita túnel).
  Si no tenés túnel, IG queda en modo "semi-automático" (te avisa cuándo publicar); FB va automático.*

### 4) TikTok
- **App:** https://developers.tiktok.com → **Manage apps** → crear app (gratis).
- **Producto:** activá **"Content Posting API"**.
- **Redirect:** el asistente te da el link → pegalo en TikTok.
- **Copiás:** **Client Key** + **Client Secret** → pegás en el asistente.
- *(TikTok revisa la app antes de permitir postear; puede tardar. El asistente te guía.)*

## Resumen de lo tuyo
| Red | App gratis en | Copiás | Dónde pegás |
|---|---|---|---|
| LinkedIn | linkedin.com/developers | Client ID + Secret | Config → Conectar LinkedIn |
| Instagram + Facebook | developers.facebook.com | App ID + Secret (1 sola app) | Config → Conectar Instagram |
| TikTok | developers.tiktok.com | Client Key + Secret | Config → Conectar TikTok |

**3 apps, 6 códigos, todo pegado en formularios de la app. Cero archivos, cero `.env`.**
