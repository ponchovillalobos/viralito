/**
 * Publica un video en una PÁGINA de Facebook vía Graph API.
 *
 * Ventaja vs Instagram: sube el ARCHIVO directo (multipart a /{pageId}/videos) → NO necesita
 * una URL pública / túnel. Reusa la MISMA conexión de Meta que Instagram (settings.instagram:
 * misma app + user token + Página vinculada), así el usuario conecta UNA sola app para IG y FB.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/reference/page/videos/
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { readSettings } from "@/lib/user-settings";
import { GRAPH_BASE, getValidInstagramAccessToken } from "@/lib/instagram-client";
import { RENDERS_DIR, LF_RENDERS } from "@/lib/paths";

export interface FacebookPublishOptions {
  /** id del render (sin extensión). */
  videoId: string;
  source: "short" | "long_form";
  /** Descripción del post. */
  caption: string;
}

export interface FacebookPublishResult {
  videoPostId: string;
}

/** El posteo a una Página usa el PAGE access token, no el user token. Se deriva del user token. */
async function getPageAccessToken(pageId: string, userToken: string): Promise<string> {
  const url = `${GRAPH_BASE}/${pageId}?fields=access_token&access_token=${encodeURIComponent(userToken)}`;
  const res = await fetch(url);
  const data = (await res.json()) as { access_token?: string; error?: { message?: string } };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data?.error?.message ||
        "No se pudo obtener el token de la Página de Facebook. Reconectá Instagram/Facebook (Meta).",
    );
  }
  return data.access_token;
}

export async function publishVideoToFacebook(
  opts: FacebookPublishOptions,
): Promise<FacebookPublishResult> {
  const userToken = await getValidInstagramAccessToken();
  if (!userToken) {
    throw new Error(
      "No hay conexión de Meta. Conectá Instagram/Facebook en Configuración → Instagram (es la misma app).",
    );
  }
  const settings = await readSettings();
  const pageId = settings.instagram.pageId;
  if (!pageId) {
    throw new Error("Falta la Página de Facebook vinculada. Reconectá Instagram (Meta).");
  }

  const pageToken = await getPageAccessToken(pageId, userToken);

  // Ubicar el render y subirlo DIRECTO (sin túnel/URL pública).
  const base = opts.source === "long_form" ? LF_RENDERS : RENDERS_DIR;
  const filePath = path.join(base, `${opts.videoId}.mp4`);
  const buf = await fs.readFile(filePath);

  const form = new FormData();
  form.append("description", opts.caption.slice(0, 5000));
  form.append("access_token", pageToken);
  form.append("source", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), `${opts.videoId}.mp4`);

  const res = await fetch(`${GRAPH_BASE}/${pageId}/videos`, { method: "POST", body: form });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    throw new Error(data?.error?.message || "Facebook rechazó la subida del video.");
  }
  return { videoPostId: data.id };
}
