import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { readSettings } from "@/lib/user-settings";
import {
  TIKTOK_AUTHORIZE_URL,
  TIKTOK_SCOPES,
  getRedirectUri,
} from "@/lib/tiktok-client";

export const dynamic = "force-dynamic";

/**
 * Inicia el OAuth 2.0 flow de TikTok.
 * Lee el client_key de los settings (no de env vars — más fácil para el usuario).
 * Genera state CSRF random y lo guarda en cookie HttpOnly.
 * Redirige al usuario a la pantalla de autorización de TikTok.
 */
export async function GET(_req: NextRequest) {
  const settings = await readSettings();
  const clientKey = settings.tiktok.clientKey;

  if (!clientKey) {
    return NextResponse.json(
      {
        error:
          "Falta Client Key. Ve a Configuración (engranaje arriba a la derecha) y completa Client Key + Secret de tu app TikTok.",
      },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(24).toString("hex");

  // PKCE (obligatorio en TikTok v2): code_verifier random + code_challenge = base64url(SHA256(verifier)).
  const codeVerifier = crypto.randomBytes(32).toString("base64url"); // 43 chars, [A-Za-z0-9-_]
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: TIKTOK_SCOPES.join(","),
    redirect_uri: getRedirectUri(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authorizeUrl = `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;

  const response = NextResponse.redirect(authorizeUrl);
  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, maxAge: 600, path: "/" };
  // Cookie de state para validar en el callback (CSRF protection).
  response.cookies.set("tiktok_oauth_state", state, cookieOpts);
  // Cookie del code_verifier — se necesita en el callback para el intercambio de token (PKCE).
  response.cookies.set("tiktok_code_verifier", codeVerifier, cookieOpts);
  return response;
}
