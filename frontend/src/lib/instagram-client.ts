/**
 * Cliente para Instagram Graph API (publicar Reels) + OAuth con Facebook Login.
 * Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing/
 *
 * Flujo OAuth (Meta):
 *   1. Redirect a dialog/oauth con scopes de IG + pages.
 *   2. callback → code → short-lived token.
 *   3. Intercambiar por long-lived token (~60 días).
 *   4. Descubrir la cuenta IG Business vía /me/accounts → instagram_business_account.
 *
 * Credenciales (appId/appSecret/token) viven en user-settings.json local.
 */
import { readSettings } from "@/lib/user-settings";

export const META_GRAPH_VERSION = "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const IG_AUTHORIZE_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
export const IG_TOKEN_URL = `${GRAPH_BASE}/oauth/access_token`;

/**
 * Permisos necesarios:
 *  - instagram_basic + instagram_content_publish: publicar en la cuenta IG
 *  - pages_show_list + pages_read_engagement: listar páginas y leer la IG vinculada
 *  - business_management: descubrir la cuenta business
 */
export const IG_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  // Con la MISMA app/conexión de Meta, esto habilita publicar en la Página de Facebook
  // (Viralito reusa esta conexión para Facebook — el usuario conecta una sola app).
  "pages_manage_posts",
] as const;

export function getBaseUrl(): string {
  return (
    // URL pública HTTPS (túnel Cloudflare/ngrok o dominio) para redes que EXIGEN https en el
    // redirect (Meta/TikTok). Separada de VIRAL_API_HOST (que se usa también para llamadas internas).
    process.env.VIRAL_OAUTH_BASE_URL ??
    process.env.VIRAL_API_HOST ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000"
  );
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/instagram/callback`;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** Paso 2 — intercambia el authorization code por un token de corta duración. */
export async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: getRedirectUri(),
    code,
  });
  const res = await fetch(`${IG_TOKEN_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Meta token exchange falló: ${data?.error?.message ?? data?.error ?? res.status}`
    );
  }
  return data as TokenResponse;
}

/** Paso 3 — intercambia el token corto por uno de larga duración (~60 días). */
export async function exchangeForLongLived(
  shortToken: string,
  appId: string,
  appSecret: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${IG_TOKEN_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Meta long-lived exchange falló: ${data?.error?.message ?? data?.error ?? res.status}`
    );
  }
  return data as TokenResponse;
}

export interface DiscoveredIgAccount {
  igUserId: string;
  pageId: string;
  username: string;
}

/**
 * Paso 4 — descubre la cuenta de Instagram Business vinculada a alguna de las
 * Páginas del usuario. Devuelve la primera con instagram_business_account.
 */
export async function discoverInstagramUser(accessToken: string): Promise<DiscoveredIgAccount> {
  const params = new URLSearchParams({
    fields: "name,instagram_business_account{id,username}",
    access_token: accessToken,
  });
  const res = await fetch(`${GRAPH_BASE}/me/accounts?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Meta /me/accounts falló: ${data?.error?.message ?? data?.error ?? res.status}`
    );
  }
  const pages: Array<{ id: string; instagram_business_account?: { id: string; username?: string } }> =
    data.data ?? [];
  const withIg = pages.find((p) => p.instagram_business_account?.id);
  if (!withIg || !withIg.instagram_business_account) {
    throw new Error(
      "Ninguna de tus Páginas de Facebook tiene una cuenta de Instagram Business vinculada. " +
        "Convertí tu IG a Business/Creator y vinculala a una Página."
    );
  }
  return {
    igUserId: withIg.instagram_business_account.id,
    pageId: withIg.id,
    username: withIg.instagram_business_account.username ?? "",
  };
}

/**
 * Devuelve un access_token válido (si no expiró). Los user tokens de Meta no se
 * refrescan con refresh_token — si venció, hay que reconectar. Retorna null si no sirve.
 */
export async function getValidInstagramAccessToken(): Promise<string | null> {
  const settings = await readSettings();
  const { accessToken, accessTokenExpiresAt } = settings.instagram;
  if (!accessToken) return null;
  const SAFETY_MARGIN_MS = 5 * 60 * 1000;
  if (accessTokenExpiresAt && Date.now() < accessTokenExpiresAt - SAFETY_MARGIN_MS) {
    return accessToken;
  }
  // Sin mecanismo de refresh para user tokens → reconectar.
  return null;
}
