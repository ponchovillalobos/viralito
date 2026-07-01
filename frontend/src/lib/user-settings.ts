/**
 * Settings de usuario persistidos a un JSON fuera del repo (en el data root),
 * para que sobreviva renames del proyecto y no se commitee al git.
 *
 * Ubicación: <DATA_ROOT>/../user-settings.json  →  ej. C:\hermes-data\user-settings.json
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./paths";
import { writeJsonFileAtomic } from "@/lib/atomic-write";
import { withSerialLock } from "@/lib/serial-lock";

export interface UserSettings {
  handles: {
    tiktok: string;
    instagram: string;
    linkedin: string;
    facebook: string;
  };
  tiktok: {
    /** Client Key de la app registrada en https://developers.tiktok.com */
    clientKey: string;
    /** Client Secret de la misma app — guardado solo localmente, nunca al cliente */
    clientSecret: string;
    /** OAuth tokens obtenidos del callback (se completan automáticamente) */
    accessToken: string;
    refreshToken: string;
    /** Epoch ms en que expira el access_token */
    accessTokenExpiresAt: number;
    /** open_id de la cuenta TikTok conectada (devuelto por OAuth) */
    openId: string;
    /** username de la cuenta conectada (informativo) */
    connectedUsername: string;
  };
  linkedin: {
    /** Client ID de la app registrada en https://www.linkedin.com/developers/apps */
    clientId: string;
    /** Client Secret de la misma app */
    clientSecret: string;
    /** OAuth access token (60 días por defecto) */
    accessToken: string;
    /** Epoch ms en que expira el access_token */
    accessTokenExpiresAt: number;
    /** Refresh token (365 días). Opcional según permisos. */
    refreshToken: string;
    /** URN de la persona conectada (formato urn:li:person:<sub>) */
    personUrn: string;
    /** Nombre informativo de la cuenta conectada */
    connectedName: string;
    /**
     * Opt-in para métricas: si true, el OAuth pide también el scope
     * `r_member_postAnalytics` (Member Post Analytics API). Requiere que LinkedIn
     * haya APROBADO tu app para esa API — si no, el login fallará. Default false.
     */
    analyticsEnabled: boolean;
  };
  instagram: {
    /** App ID de la app de Meta (https://developers.facebook.com/apps) */
    appId: string;
    /** App Secret de la misma app */
    appSecret: string;
    /** Long-lived user access token (60 días) */
    accessToken: string;
    /** Epoch ms en que expira el access_token */
    accessTokenExpiresAt: number;
    /** ID de la cuenta de Instagram Business conectada */
    igUserId: string;
    /** ID de la Página de Facebook vinculada (para descubrir el IG user) */
    pageId: string;
    /** username informativo de la cuenta IG conectada */
    connectedUsername: string;
    /**
     * Base URL pública (HTTPS) desde la que Instagram puede DESCARGAR el video.
     * localhost no sirve — Instagram baja el archivo desde sus servidores.
     * Ej: una URL de túnel tipo Cloudflare/ngrok que apunta a tu :3000.
     */
    publicBaseUrl: string;
  };
  pixabay: {
    /** API key gratuita de https://pixabay.com/accounts/register/ — para descargar
     *  SFX y música CC0 al modo cinematográfico. */
    apiKey: string;
  };
}

const DEFAULTS: UserSettings = {
  handles: { tiktok: "", instagram: "", linkedin: "", facebook: "" },
  tiktok: {
    clientKey: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    accessTokenExpiresAt: 0,
    openId: "",
    connectedUsername: "",
  },
  linkedin: {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    refreshToken: "",
    personUrn: "",
    connectedName: "",
    analyticsEnabled: false,
  },
  instagram: {
    appId: "",
    appSecret: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    igUserId: "",
    pageId: "",
    connectedUsername: "",
    publicBaseUrl: "",
  },
  pixabay: { apiKey: "" },
};

export const SETTINGS_FILE = path.join(path.dirname(DATA_ROOT), "user-settings.json");

function normalizeHandle(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  return s.startsWith("@") ? s : `@${s}`;
}

/**
 * Fallback a .env.local para las credenciales de APP: si un campo está vacío en el archivo
 * de settings (el asistente), se toma de la variable de entorno. Así el usuario puede poner
 * las credenciales en .env.local en vez del asistente. Los TOKENS de usuario NO van acá —
 * se obtienen por OAuth al conectar la cuenta (clic en "Conectar").
 */
function applyEnvCredentials(s: UserSettings): UserSettings {
  const env = process.env;
  s.linkedin.clientId ||= (env.LINKEDIN_CLIENT_ID ?? "").trim();
  s.linkedin.clientSecret ||= (env.LINKEDIN_CLIENT_SECRET ?? "").trim();
  s.tiktok.clientKey ||= (env.TIKTOK_CLIENT_KEY ?? "").trim();
  s.tiktok.clientSecret ||= (env.TIKTOK_CLIENT_SECRET ?? "").trim();
  // Instagram Y Facebook usan la MISMA app de Meta (META_APP_ID/SECRET).
  s.instagram.appId ||= (env.META_APP_ID ?? "").trim();
  s.instagram.appSecret ||= (env.META_APP_SECRET ?? "").trim();
  s.instagram.publicBaseUrl ||= (env.META_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return s;
}

export async function readSettings(): Promise<UserSettings> {
  let s: UserSettings;
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    s = {
      handles: {
        tiktok: normalizeHandle(parsed.handles?.tiktok ?? ""),
        instagram: normalizeHandle(parsed.handles?.instagram ?? ""),
        linkedin: normalizeHandle(parsed.handles?.linkedin ?? ""),
        facebook: normalizeHandle(parsed.handles?.facebook ?? ""),
      },
      tiktok: {
        clientKey: (parsed.tiktok?.clientKey ?? "").trim(),
        clientSecret: (parsed.tiktok?.clientSecret ?? "").trim(),
        accessToken: parsed.tiktok?.accessToken ?? "",
        refreshToken: parsed.tiktok?.refreshToken ?? "",
        accessTokenExpiresAt: parsed.tiktok?.accessTokenExpiresAt ?? 0,
        openId: parsed.tiktok?.openId ?? "",
        connectedUsername: parsed.tiktok?.connectedUsername ?? "",
      },
      linkedin: {
        clientId: (parsed.linkedin?.clientId ?? "").trim(),
        clientSecret: (parsed.linkedin?.clientSecret ?? "").trim(),
        accessToken: parsed.linkedin?.accessToken ?? "",
        accessTokenExpiresAt: parsed.linkedin?.accessTokenExpiresAt ?? 0,
        refreshToken: parsed.linkedin?.refreshToken ?? "",
        personUrn: parsed.linkedin?.personUrn ?? "",
        connectedName: parsed.linkedin?.connectedName ?? "",
        analyticsEnabled: parsed.linkedin?.analyticsEnabled ?? false,
      },
      instagram: {
        appId: (parsed.instagram?.appId ?? "").trim(),
        appSecret: (parsed.instagram?.appSecret ?? "").trim(),
        accessToken: parsed.instagram?.accessToken ?? "",
        accessTokenExpiresAt: parsed.instagram?.accessTokenExpiresAt ?? 0,
        igUserId: parsed.instagram?.igUserId ?? "",
        pageId: parsed.instagram?.pageId ?? "",
        connectedUsername: parsed.instagram?.connectedUsername ?? "",
        publicBaseUrl: (parsed.instagram?.publicBaseUrl ?? "").trim().replace(/\/+$/, ""),
      },
      pixabay: { apiKey: (parsed.pixabay?.apiKey ?? "").trim() },
    };
  } catch {
    s = {
      handles: { ...DEFAULTS.handles },
      tiktok: { ...DEFAULTS.tiktok },
      linkedin: { ...DEFAULTS.linkedin },
      instagram: { ...DEFAULTS.instagram },
      pixabay: { ...DEFAULTS.pixabay },
    };
  }
  return applyEnvCredentials(s);
}

export async function writeSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  // Serializamos TODO el read-modify-write: dos callbacks OAuth concurrentes (ej.
  // TikTok y LinkedIn conectándose a la vez) leían el mismo `current` y el último en
  // escribir pisaba los tokens del otro. Con el lock, el segundo lee el archivo ya
  // actualizado por el primero. La escritura final ya es atómica (writeJsonFileAtomic).
  return withSerialLock("user-settings", async () => {
  const current = await readSettings();
  const next: UserSettings = {
    handles: {
      tiktok: normalizeHandle(patch.handles?.tiktok ?? current.handles.tiktok),
      instagram: normalizeHandle(patch.handles?.instagram ?? current.handles.instagram),
      linkedin: normalizeHandle(patch.handles?.linkedin ?? current.handles.linkedin),
      facebook: normalizeHandle(patch.handles?.facebook ?? current.handles.facebook),
    },
    tiktok: {
      clientKey: (patch.tiktok?.clientKey ?? current.tiktok.clientKey).trim(),
      clientSecret: (patch.tiktok?.clientSecret ?? current.tiktok.clientSecret).trim(),
      accessToken: patch.tiktok?.accessToken ?? current.tiktok.accessToken,
      refreshToken: patch.tiktok?.refreshToken ?? current.tiktok.refreshToken,
      accessTokenExpiresAt:
        patch.tiktok?.accessTokenExpiresAt ?? current.tiktok.accessTokenExpiresAt,
      openId: patch.tiktok?.openId ?? current.tiktok.openId,
      connectedUsername: patch.tiktok?.connectedUsername ?? current.tiktok.connectedUsername,
    },
    linkedin: {
      clientId: (patch.linkedin?.clientId ?? current.linkedin.clientId).trim(),
      clientSecret: (patch.linkedin?.clientSecret ?? current.linkedin.clientSecret).trim(),
      accessToken: patch.linkedin?.accessToken ?? current.linkedin.accessToken,
      accessTokenExpiresAt:
        patch.linkedin?.accessTokenExpiresAt ?? current.linkedin.accessTokenExpiresAt,
      refreshToken: patch.linkedin?.refreshToken ?? current.linkedin.refreshToken,
      personUrn: patch.linkedin?.personUrn ?? current.linkedin.personUrn,
      connectedName: patch.linkedin?.connectedName ?? current.linkedin.connectedName,
      analyticsEnabled: patch.linkedin?.analyticsEnabled ?? current.linkedin.analyticsEnabled,
    },
    instagram: {
      appId: (patch.instagram?.appId ?? current.instagram.appId).trim(),
      appSecret: (patch.instagram?.appSecret ?? current.instagram.appSecret).trim(),
      accessToken: patch.instagram?.accessToken ?? current.instagram.accessToken,
      accessTokenExpiresAt:
        patch.instagram?.accessTokenExpiresAt ?? current.instagram.accessTokenExpiresAt,
      igUserId: patch.instagram?.igUserId ?? current.instagram.igUserId,
      pageId: patch.instagram?.pageId ?? current.instagram.pageId,
      connectedUsername: patch.instagram?.connectedUsername ?? current.instagram.connectedUsername,
      publicBaseUrl: (patch.instagram?.publicBaseUrl ?? current.instagram.publicBaseUrl)
        .trim()
        .replace(/\/+$/, ""),
    },
    pixabay: {
      apiKey: (patch.pixabay?.apiKey ?? current.pixabay?.apiKey ?? "").trim(),
    },
  };
  await writeJsonFileAtomic(SETTINGS_FILE, next);
  return next;
  });
}

/** True si tenemos credenciales de app TikTok configuradas */
export function hasTikTokAppCredentials(s: UserSettings): boolean {
  return Boolean(s.tiktok.clientKey && s.tiktok.clientSecret);
}

/** True si la cuenta TikTok está OAuth-conectada y el token todavía sirve */
export function hasValidTikTokToken(s: UserSettings): boolean {
  return Boolean(
    s.tiktok.accessToken &&
      s.tiktok.accessTokenExpiresAt &&
      s.tiktok.accessTokenExpiresAt > Date.now()
  );
}

/** True si tenemos credenciales de app LinkedIn configuradas */
export function hasLinkedInAppCredentials(s: UserSettings): boolean {
  return Boolean(s.linkedin.clientId && s.linkedin.clientSecret);
}

/** True si la cuenta LinkedIn está OAuth-conectada y el token todavía sirve */
export function hasValidLinkedInToken(s: UserSettings): boolean {
  return Boolean(
    s.linkedin.accessToken &&
      s.linkedin.accessTokenExpiresAt &&
      s.linkedin.accessTokenExpiresAt > Date.now()
  );
}

/** True si tenemos credenciales de app de Meta/Instagram configuradas */
export function hasInstagramAppCredentials(s: UserSettings): boolean {
  return Boolean(s.instagram.appId && s.instagram.appSecret);
}

/** True si la cuenta IG está conectada (token vigente + igUserId) */
export function hasValidInstagramToken(s: UserSettings): boolean {
  return Boolean(
    s.instagram.accessToken &&
      s.instagram.igUserId &&
      s.instagram.accessTokenExpiresAt &&
      s.instagram.accessTokenExpiresAt > Date.now()
  );
}
