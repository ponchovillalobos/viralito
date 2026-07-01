/**
 * Upload de video a LinkedIn Posts API (REST v2).
 *
 * Flujo (Videos REST):
 *   1. POST /rest/videos?action=initializeUpload   → devuelve uploadInstructions[] + video URN
 *   2. PUT cada chunk al uploadUrl                  → capturar header ETag
 *   3. POST /rest/videos?action=finalizeUpload     → uploadedPartIds: [eTag1, ...]
 *   4. Poll GET /rest/videos/{urn}                  → status == "AVAILABLE"
 *   5. POST /rest/posts                             → publica el post con video URN
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
 *       https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 */
import { promises as fs, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { readSettings } from "@/lib/user-settings";
import {
  LI_API_VERSION,
  LI_PROTOCOL_VERSION,
  getValidLinkedInAccessToken,
} from "@/lib/linkedin-client";

/** Poll cada 3s hasta máximo 120s — la mayoría de videos cortos están AVAILABLE en <30s. */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40;

export type LinkedInVisibility = "PUBLIC" | "CONNECTIONS" | "LOGGED_IN_MEMBERS";

export interface LinkedInUploadOptions {
  /** Path absoluto al .mp4 a subir */
  filePath: string;
  /** Texto del post (commentary). LinkedIn permite hasta 3000 chars. */
  commentary: string;
  /** Visibilidad. Default PUBLIC. */
  visibility?: LinkedInVisibility;
  /** Path a una miniatura custom (opcional). Si existe, se sube como thumbnail del video. */
  thumbnailPath?: string;
}

export interface LinkedInPostResult {
  /** URN del post creado (urn:li:share:... o urn:li:ugcPost:...) */
  postUrn: string;
  /** URN del video subido (urn:li:video:...) */
  videoUrn: string;
}

interface InitializeUploadResponse {
  value: {
    uploadInstructions: Array<{
      uploadUrl: string;
      firstByte: number;
      lastByte: number;
    }>;
    video: string;
    /** Algunos endpoints también devuelven uploadToken */
    uploadToken?: string;
    /** URL para subir la miniatura (presente si uploadThumbnail=true). */
    thumbnailUploadUrl?: string;
  };
}

interface VideoStatusResponse {
  status: string;
  // ... otros campos no usados
}

/**
 * Construye los headers REST estándar para LinkedIn API.
 */
function restHeaders(accessToken: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LI_API_VERSION,
    "X-Restli-Protocol-Version": LI_PROTOCOL_VERSION,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Lee el personUrn de settings o falla si no hay cuenta conectada. */
async function getPersonUrn(): Promise<string> {
  const settings = await readSettings();
  const urn = settings.linkedin.personUrn;
  if (!urn) {
    throw new Error("No hay personUrn de LinkedIn. Conecta la cuenta en Configuración.");
  }
  return urn;
}

/**
 * Paso 1 — initializeUpload: pide al servidor URLs para subir chunks.
 */
async function initializeUpload(
  accessToken: string,
  personUrn: string,
  fileSizeBytes: number,
  withThumbnail: boolean
): Promise<InitializeUploadResponse["value"]> {
  const body = {
    initializeUploadRequest: {
      owner: personUrn,
      fileSizeBytes,
      uploadCaptions: false,
      uploadThumbnail: withThumbnail,
    },
  };
  const res = await fetch(
    "https://api.linkedin.com/rest/videos?action=initializeUpload",
    {
      method: "POST",
      headers: restHeaders(accessToken),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `LinkedIn initializeUpload falló: ${data?.message ?? res.status} ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  if (!data?.value?.uploadInstructions?.length || !data?.value?.video) {
    throw new Error("LinkedIn initializeUpload: respuesta sin uploadInstructions");
  }
  return data.value;
}

/**
 * Paso 2 — PUT chunks. Devuelve los ETags en orden.
 */
async function uploadChunks(
  filePath: string,
  instructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>
): Promise<string[]> {
  const eTags: string[] = [];
  for (let i = 0; i < instructions.length; i++) {
    const { uploadUrl, firstByte, lastByte } = instructions[i];
    const length = lastByte - firstByte + 1;
    const stream = createReadStream(filePath, { start: firstByte, end: lastByte });
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(length),
      },
      // @ts-expect-error — duplex requerido por undici para streams
      duplex: "half",
      body: webStream,
    });
    if (!putRes.ok && putRes.status !== 201) {
      const text = await putRes.text().catch(() => "");
      throw new Error(
        `LinkedIn chunk ${i + 1}/${instructions.length} falló: HTTP ${putRes.status} ${text.slice(0, 200)}`
      );
    }
    const eTag = putRes.headers.get("etag") ?? putRes.headers.get("ETag");
    if (!eTag) {
      throw new Error(`LinkedIn chunk ${i + 1}: respuesta sin ETag`);
    }
    eTags.push(eTag.replace(/"/g, ""));
  }
  return eTags;
}

/**
 * Paso 3 — finalizeUpload con los ETags capturados.
 */
async function finalizeUpload(
  accessToken: string,
  videoUrn: string,
  uploadedPartIds: string[],
  uploadToken: string
): Promise<void> {
  const body = {
    finalizeUploadRequest: {
      video: videoUrn,
      uploadToken,
      uploadedPartIds,
    },
  };
  const res = await fetch(
    "https://api.linkedin.com/rest/videos?action=finalizeUpload",
    {
      method: "POST",
      headers: restHeaders(accessToken),
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `LinkedIn finalizeUpload falló: ${data?.message ?? res.status}`
    );
  }
}

/**
 * Paso 4 — poll hasta que el video esté AVAILABLE.
 */
async function waitUntilAvailable(accessToken: string, videoUrn: string): Promise<void> {
  // El URN viene como urn:li:video:XYZ — la API espera el id encoded en la URL.
  const encoded = encodeURIComponent(videoUrn);
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`https://api.linkedin.com/rest/videos/${encoded}`, {
      headers: restHeaders(accessToken),
    });
    if (!res.ok) {
      // Una respuesta 404 efímera puede aparecer antes de que el video se registre.
      if (res.status === 404 && attempt < 3) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(`LinkedIn video status falló: ${data?.message ?? res.status}`);
    }
    const data = (await res.json()) as VideoStatusResponse;
    if (data.status === "AVAILABLE") return;
    if (data.status === "PROCESSING_FAILED") {
      throw new Error(`LinkedIn video processing falló`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`LinkedIn video no llegó a AVAILABLE tras ${POLL_MAX_ATTEMPTS} intentos`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Paso 5 — POST /rest/posts publica el feed post con el videoUrn.
 */
async function createPost(
  accessToken: string,
  personUrn: string,
  videoUrn: string,
  commentary: string,
  visibility: LinkedInVisibility
): Promise<string> {
  const body = {
    author: personUrn,
    commentary,
    visibility,
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: {
      media: {
        id: videoUrn,
      },
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify(body),
  });
  // POST /rest/posts devuelve 201 con el URN en el header `x-restli-id`.
  if (res.status !== 201 && !res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`LinkedIn create post falló: ${data?.message ?? res.status}`);
  }
  const postUrn = res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id") ?? "";
  return postUrn;
}

/** Sube la miniatura custom al thumbnailUploadUrl que devuelve initializeUpload (PUT directo). */
async function uploadThumbnailImage(uploadUrl: string, thumbnailPath: string): Promise<void> {
  const buf = await fs.readFile(thumbnailPath);
  const ext = thumbnailPath.split(".").pop()?.toLowerCase() ?? "jpg";
  const ct = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": ct },
    body: new Uint8Array(buf),
  });
  if (!res.ok) throw new Error(`thumbnail PUT ${res.status}`);
}

/**
 * Función pública — sube + publica un video a LinkedIn en un solo call.
 */
export async function uploadVideoToLinkedIn(
  opts: LinkedInUploadOptions
): Promise<LinkedInPostResult> {
  const accessToken = await getValidLinkedInAccessToken();
  if (!accessToken) {
    throw new Error("No hay access_token de LinkedIn. Conecta la cuenta en Configuración.");
  }
  const personUrn = await getPersonUrn();

  const stat = await fs.stat(opts.filePath);
  const fileSizeBytes = stat.size;
  if (fileSizeBytes === 0) throw new Error("El archivo de video está vacío.");

  // 1. Initialize (pide URL de miniatura si hay una custom)
  const withThumbnail = Boolean(opts.thumbnailPath);
  const init = await initializeUpload(accessToken, personUrn, fileSizeBytes, withThumbnail);

  // 1b. Subir la miniatura custom (si hay). Es opcional — si falla, se sigue con el thumbnail
  //     default de LinkedIn (no rompe la publicación).
  if (withThumbnail && init.thumbnailUploadUrl && opts.thumbnailPath) {
    try {
      await uploadThumbnailImage(init.thumbnailUploadUrl, opts.thumbnailPath);
    } catch (e) {
      console.warn(
        "[linkedin] subida de miniatura falló, sigo sin ella:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 2. Upload chunks
  const eTags = await uploadChunks(opts.filePath, init.uploadInstructions);

  // 3. Finalize
  await finalizeUpload(accessToken, init.video, eTags, init.uploadToken ?? "");

  // 4. Wait until AVAILABLE
  await waitUntilAvailable(accessToken, init.video);

  // 5. Create post
  const commentary = opts.commentary.slice(0, 3000);
  const visibility = opts.visibility ?? "PUBLIC";
  const postUrn = await createPost(accessToken, personUrn, init.video, commentary, visibility);

  return { postUrn, videoUrn: init.video };
}
