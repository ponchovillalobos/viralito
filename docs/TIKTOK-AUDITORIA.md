# Auditoría de TikTok — para publicar al feed público automático

> Objetivo: pasar la app de **Sandbox → Producción auditada**, lo único que habilita publicar al
> **feed público** directo (sin el toque manual). El Sandbox solo prueba la integración; no publica
> contenido real. Esto es el trámite. Yo dejo el 90% listo; el usuario graba 1 video demo y envía.

## Qué desbloquea la auditoría
- **Direct Post al feed público** (PUBLIC_TO_EVERYONE) sin intervención → Viralito postea solo.
- Sin auditar, solo: inbox/borrador (a la bandeja) o SELF_ONLY a cuenta privada. Nada público.

## Dónde se hace
developers.tiktok.com → app **"Estrategia Viral Poncho"** → pestaña **Production** (no Sandbox) →
completar App review → **Submit for review**. TikTok revisa en días (típico 3-7).

## Checklist de lo que pide TikTok (Production)
1. **App icon** 1024×1024 (ya tenemos `Escritorio/viralito-icon.png`).
2. **App name**: Viralito · **Category**: Business · **Description** (abajo).
3. **Terms of Service URL** + **Privacy Policy URL** + **Website** — PÚBLICAS y REALES. El repo de
   GitHub sirve como sitio; para ToS/Privacy conviene páginas públicas de verdad (ver "Pendiente").
4. **Products**: Login Kit + Content Posting API. **Scopes**: user.info.basic, video.publish, video.upload.
5. **Redirect URI** (Web) público HTTPS — el del túnel o, mejor para producción, un dominio estable.
6. **Explicación de uso** de cada producto/scope (texto listo abajo).
7. **Video demo** (~1 min) del flujo end-to-end (guion abajo) — lo graba el usuario.
8. **Verificación de la URL de publicación** (si se usa pull_by_url; con push_by_file no hace falta).

## Texto para pegar — "Explain how each product and scope works"
> Viralito es una herramienta de escritorio que ayuda a creadores a editar videos con IA y a
> programar/publicar su contenido en sus redes desde un solo lugar. Usa **Login Kit** para que el
> creador autorice su propia cuenta de TikTok (scope user.info.basic para leer su perfil). Usa la
> **Content Posting API** para subir los videos que el creador ya editó en Viralito: video.upload
> para enviarlos como borrador a su bandeja de TikTok, y video.publish para publicarlos directo a su
> perfil cuando el creador lo elige. El creador siempre inicia la acción desde Viralito y controla
> título, descripción y privacidad de cada publicación.

## Guion del video demo (~1 min, lo graba el usuario)
1. Abrir Viralito → sección **Publicar** (mostrar el calendario + "Nuevo post").
2. Tocar **Nuevo post** → elegir un video de la lista → escribir la descripción → elegir **TikTok**
   → elegir fecha/hora → **Programar**.
3. Mostrar que el post aparece en el calendario.
4. (Opcional) Mostrar en Configuración → TikTok que la cuenta está **conectada**.
5. Mostrar el resultado en TikTok (la bandeja/el post).
> Grabar la pantalla (OBS / grabador de Windows), mp4 o mov, hasta 50 MB.

## Pendiente antes de enviar (lo que falta resolver)
- **ToS/Privacy públicas de verdad:** hoy apuntan al repo de GitHub. TikTok puede pedir páginas
  reales de Términos y Privacidad. Opción fácil: publicar 2 páginas simples (GitHub Pages o un
  hosting gratis) con el texto de ToS y Privacy de Viralito. (Se puede preparar cuando el user diga.)
- **Redirect estable:** el túnel Cloudflare cambia de URL si se reinicia. Para producción conviene un
  dominio fijo o un túnel nombrado. Para la revisión inicial, el túnel actual sirve mientras esté vivo.
- **Video demo:** lo graba el usuario (2 min de trabajo).

## Estado
- Integración: **funciona** (probado end-to-end en Sandbox: conexión OAuth + subida de video).
- Falta: completar Production + el video demo + enviar a review.
