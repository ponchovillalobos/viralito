/**
 * Cliente para TikTok Content Posting API + OAuth.
 * Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
 */
import { readSettings, writeSettings } from "@/lib/user-settings";

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
export const TIKTOK_POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
export const TIKTOK_POST_INBOX_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";
export const TIKTOK_POST_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";
export const TIKTOK_CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"] as const;

/**
 * Base URL para redirect URIs OAuth. Por defecto localhost:3000.
 * Override con env var NEXT_PUBLIC_BASE_URL si después usás ngrok o un dominio.
 */
export function getBaseUrl(): string {
  return (
    process.env.VIRAL_API_HOST ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000"
  );
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/tiktok/callback`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  refresh_token: string;
  open_id: string;
  scope: string;
  token_type: string;
}

/** Intercambia un authorization code por access_token. */
export async function exchangeCodeForTokens(
  code: string,
  clientKey: string,
  clientSecret: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: getRedirectUri(),
    // PKCE: TikTok v2 exige code_verifier (debe coincidir con el code_challenge del /authorize).
    code_verifier: codeVerifier,
  });
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `TikTok token exchange falló: ${data.error_description ?? data.error ?? res.status}`
    );
  }
  return data as TokenResponse;
}

/** Refresca un access_token expirado usando el refresh_token guardado. */
export async function refreshAccessToken(
  refreshToken: string,
  clientKey: string,
  clientSecret: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `TikTok token refresh falló: ${data.error_description ?? data.error ?? res.status}`
    );
  }
  return data as TokenResponse;
}

interface TikTokUserInfo {
  open_id: string;
  union_id: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
}

/** Obtiene info básica de la cuenta conectada (display_name, username, etc.) */
export async function fetchUserInfo(accessToken: string): Promise<TikTokUserInfo> {
  const fields = "open_id,union_id,display_name,username,avatar_url";
  const res = await fetch(`${TIKTOK_USER_INFO_URL}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(`TikTok user info falló: ${data.error?.message ?? res.status}`);
  }
  return data.data?.user ?? {};
}

/**
 * Devuelve un access_token válido — refresca automáticamente si está por expirar.
 * Si no hay tokens en settings, retorna null.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const settings = await readSettings();
  const { accessToken, refreshToken, accessTokenExpiresAt, clientKey, clientSecret } =
    settings.tiktok;
  if (!accessToken) return null;
  // Renová si está vencido o vence en los próximos 5 min
  const SAFETY_MARGIN_MS = 5 * 60 * 1000;
  if (Date.now() < accessTokenExpiresAt - SAFETY_MARGIN_MS) {
    return accessToken;
  }
  if (!refreshToken || !clientKey || !clientSecret) {
    return null;
  }
  const fresh = await refreshAccessToken(refreshToken, clientKey, clientSecret);
  await writeSettings({
    tiktok: {
      ...settings.tiktok,
      accessToken: fresh.access_token,
      refreshToken: fresh.refresh_token,
      accessTokenExpiresAt: Date.now() + fresh.expires_in * 1000,
    },
  });
  return fresh.access_token;
}
