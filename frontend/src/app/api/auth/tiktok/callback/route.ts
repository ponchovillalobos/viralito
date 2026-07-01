import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
} from "@/lib/tiktok-client";
import { readSettings, writeSettings } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

/**
 * Callback OAuth de TikTok.
 * Recibe ?code=...&state=...; valida state contra la cookie, intercambia el code
 * por tokens, obtiene info de la cuenta, persiste todo y redirige al dashboard.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return makeErrorPage(
      `TikTok devolvió error: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`
    );
  }
  if (!code || !state) {
    return makeErrorPage("Faltan parámetros code/state en el callback.");
  }

  const cookieState = req.cookies.get("tiktok_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return makeErrorPage(
      "State inválido (posible CSRF). Intenta el login de nuevo desde Configuración."
    );
  }

  const settings = await readSettings();
  const { clientKey, clientSecret } = settings.tiktok;
  if (!clientKey || !clientSecret) {
    return makeErrorPage(
      "Faltan Client Key/Secret en Configuración. Guárdalos antes de conectar."
    );
  }

  // PKCE: el code_verifier guardado en el login se manda en el intercambio de token.
  const codeVerifier = req.cookies.get("tiktok_code_verifier")?.value;
  if (!codeVerifier) {
    return makeErrorPage(
      "Falta el code_verifier (PKCE). La sesión de conexión expiró — intenta conectar de nuevo."
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code, clientKey, clientSecret, codeVerifier);

    // Obtener username/display_name de la cuenta conectada
    let connectedUsername = "";
    try {
      const userInfo = await fetchUserInfo(tokens.access_token);
      connectedUsername = userInfo.username
        ? `@${userInfo.username}`
        : userInfo.display_name ?? "";
    } catch {
      // No es crítico — si falla, dejamos vacío y seguimos
    }

    await writeSettings({
      tiktok: {
        ...settings.tiktok,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        openId: tokens.open_id,
        connectedUsername,
      },
    });

    return makeSuccessPage(connectedUsername || tokens.open_id);
  } catch (err) {
    return makeErrorPage(err instanceof Error ? err.message : String(err));
  }
}

function makeSuccessPage(username: string) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>TikTok conectado</title>
  <style>
    body { background: #0a0a0a; color: #eee; font-family: ui-sans-serif, system-ui; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { max-width: 420px; padding: 32px; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; text-align: center; }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #10b98122; color: #10b981; font-size: 32px; display: grid; place-items: center; margin: 0 auto 20px; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 8px 0; color: #aaa; font-size: 14px; }
    .acc { color: #fa3c8d; font-family: ui-monospace, monospace; }
    a { display: inline-block; margin-top: 16px; padding: 8px 16px; background: linear-gradient(135deg, #fa3c8d, #ad23ee); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>TikTok conectado</h1>
    <p>Cuenta: <span class="acc">${escapeHtml(username)}</span></p>
    <p>Ya puedes programar y publicar desde la sección Publicar.</p>
    <a href="/publicar">Ir a Publicar</a>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function makeErrorPage(message: string) {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Error TikTok OAuth</title>
  <style>
    body { background: #0a0a0a; color: #eee; font-family: ui-sans-serif, system-ui; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { max-width: 480px; padding: 32px; border: 1px solid #ef444444; border-radius: 16px; }
    h1 { color: #ef4444; margin: 0 0 12px; font-size: 18px; }
    pre { background: #1a1a1a; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; color: #fca5a5; white-space: pre-wrap; }
    a { display: inline-block; margin-top: 16px; padding: 8px 16px; background: #333; color: #eee; text-decoration: none; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>OAuth de TikTok falló</h1>
    <pre>${escapeHtml(message)}</pre>
    <a href="/">Volver al dashboard</a>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}
