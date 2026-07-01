/**
 * Cliente para LinkedIn Posts API (REST v2) + OAuth 2.0.
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *       https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *
 * Versión de la API: la pasamos por header LinkedIn-Version (formato YYYYMM).
 * Actualizar a un mes corriente cada ~12 meses.
 */
import { readSettings, writeSettings } from "@/lib/user-settings";

export const LI_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const LI_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
export const LI_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

/** Header obligatorio para REST endpoints. Update periódico recomendado. */
export const LI_API_VERSION = "202605";
export const LI_PROTOCOL_VERSION = "2.0.0";

/**
 * Scope OIDC + posting.
 * - openid + profile: para userinfo (saca el `sub` que es el id de la persona)
 * - w_member_social: para crear posts en nombre del miembro (Open Permission)
 */
export const LI_SCOPES = ["openid", "profile", "w_member_social"] as const;

/**
 * Scope opt-in para la Member Post Analytics API (`memberCreatorPostAnalytics`).
 * NO es self-serve: LinkedIn tiene que aprobar tu app para esta API. Solo se pide
 * en el OAuth si `settings.linkedin.analyticsEnabled` está en true.
 * Doc: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics
 */
export const LI_ANALYTICS_SCOPE = "r_member_postAnalytics";

/** Métricas de un post personal que devuelve la API. */
export type LiPostMetric = "IMPRESSION" | "MEMBERS_REACHED" | "REACTION" | "COMMENT" | "RESHARE";

/**
 * Total (lifetime) de una métrica para un post propio vía memberCreatorPostAnalytics.
 * Devuelve el count o null si falla (ej. 403 si la app no está aprobada para la API).
 */
export async function fetchMemberPostMetric(
  accessToken: string,
  postUrn: string,
  queryType: LiPostMetric
): Promise<number | null> {
  // El param `entity` va como (share:<urn-encoded>) o (ugc:<urn-encoded>) según el tipo.
  const enc = encodeURIComponent(postUrn);
  const entity = postUrn.includes(":ugcPost:") ? `(ugc:${enc})` : `(share:${enc})`;
  const url =
    `https://api.linkedin.com/rest/memberCreatorPostAnalytics` +
    `?q=entity&entity=${entity}&queryType=${queryType}&aggregation=TOTAL`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": LI_API_VERSION,
        "X-Restli-Protocol-Version": LI_PROTOCOL_VERSION,
      },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const el = data?.elements?.[0];
    return el?.count != null ? Number(el.count) : 0;
  } catch {
    return null;
  }
}

/** Base URL para redirect URIs OAuth. Default localhost:3000. */
export function getBaseUrl(): string {
  return (
    // URL pública HTTPS (túnel/dominio) con prioridad, para redes que exijan https en el redirect.
    process.env.VIRAL_OAUTH_BASE_URL ??
    process.env.VIRAL_API_HOST ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "http://localhost:3000"
  );
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/linkedin/callback`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  /** No todos los flows devuelven refresh_token. Si no viene, el token dura 60d. */
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

/** Intercambia un authorization code por access_token. */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(LI_TOKEN_URL, {
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
      `LinkedIn token exchange falló: ${data.error_description ?? data.error ?? res.status}`
    );
  }
  return data as TokenResponse;
}

/** Refresca un access_token expirado (sólo si hubo refresh_token en el flow). */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(LI_TOKEN_URL, {
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
      `LinkedIn token refresh falló: ${data.error_description ?? data.error ?? res.status}`
    );
  }
  return data as TokenResponse;
}

export interface LinkedInUserInfo {
  /** Identificador del miembro (3+ chars). Sirve para construir el personUrn. */
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
}

/** Llama al endpoint OIDC userinfo y devuelve sub + nombre. */
export async function fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const res = await fetch(LI_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `LinkedIn userinfo falló: ${data?.message ?? data?.error ?? res.status}`
    );
  }
  return data as LinkedInUserInfo;
}

/** Construye el URN de persona a partir del `sub` del userinfo. */
export function personUrnFromSub(sub: string): string {
  if (!sub) return "";
  return sub.startsWith("urn:li:person:") ? sub : `urn:li:person:${sub}`;
}

/**
 * Devuelve un access_token válido — refresca automáticamente si está por expirar.
 * Si no hay tokens en settings, retorna null.
 */
export async function getValidLinkedInAccessToken(): Promise<string | null> {
  const settings = await readSettings();
  const { accessToken, refreshToken, accessTokenExpiresAt, clientId, clientSecret } =
    settings.linkedin;
  if (!accessToken) return null;
  // Renová si vence en los próximos 5 min
  const SAFETY_MARGIN_MS = 5 * 60 * 1000;
  if (Date.now() < accessTokenExpiresAt - SAFETY_MARGIN_MS) {
    return accessToken;
  }
  // Si no hay refresh, no podemos renovar — el user tiene que reautenticar.
  if (!refreshToken || !clientId || !clientSecret) {
    return null;
  }
  try {
    const fresh = await refreshAccessToken(refreshToken, clientId, clientSecret);
    await writeSettings({
      linkedin: {
        ...settings.linkedin,
        accessToken: fresh.access_token,
        accessTokenExpiresAt: Date.now() + fresh.expires_in * 1000,
        refreshToken: fresh.refresh_token ?? settings.linkedin.refreshToken,
      },
    });
    return fresh.access_token;
  } catch (err) {
    console.warn("[linkedin-client] refresh falló:", err);
    return null;
  }
}
