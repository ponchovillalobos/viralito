/**
 * Implementa el upload completo a TikTok Content Posting API.
 *
 * Flujo:
 *   1. Query creator_info para validar permissions + saber max_video_post_duration_sec
 *   2. Init upload: POST /v2/post/publish/video/init/ (Direct Post) o /v2/post/publish/inbox/video/init/ (Inbox)
 *      - Devuelve { publish_id, upload_url }
 *   3. Upload el archivo en chunks a upload_url (PUT con Content-Range)
 *   4. Poll status: POST /v2/post/publish/status/fetch/ con publish_id hasta status=PUBLISH_COMPLETE
 */
import { promises as fs, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  TIKTOK_POST_INIT_URL,
  TIKTOK_POST_INBOX_URL,
  TIKTOK_POST_STATUS_URL,
  TIKTOK_CREATOR_INFO_URL,
  getValidAccessToken,
} from "@/lib/tiktok-client";

// TikTok exige chunks ≥ 5 MB excepto el último. Usamos 10 MB para reducir requests.
const CHUNK_BYTES = 10 * 1024 * 1024;

export type PrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY" | "FOLLOWER_OF_CREATOR";

export interface UploadOptions {
  /** Path absoluto al .mp4 a subir */
  filePath: string;
  /** Caption / título del post */
  title: string;
  /** Direct = publica directo · Inbox = manda al draft de la app TikTok del usuario */
  mode: "direct" | "inbox";
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  /** Disclosure (publicidad pagada). Default false. */
  brandContentToggle?: boolean;
  brandOrganicToggle?: boolean;
}

export interface UploadResult {
  publishId: string;
  status: "PROCESSING_UPLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED" | string;
  publicAccessToken?: string;
  failReason?: string;
}

interface CreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: PrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const res = await fetch(TIKTOK_CREATOR_INFO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(
      `creator_info falló: ${data.error?.message ?? res.status}. Probable causa: scope video.publish no aprobado.`
    );
  }
  return data.data as CreatorInfo;
}

interface InitResponse {
  publish_id: string;
  upload_url: string;
}

export async function uploadVideoToTikTok(opts: UploadOptions): Promise<UploadResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("No hay access_token de TikTok. Conecta la cuenta en Configuración.");
  }

  // 1. Tamaño del archivo
  const stat = await fs.stat(opts.filePath);
  const videoSize = stat.size;
  if (videoSize === 0) throw new Error("El archivo de video está vacío.");

  // 2. Calcular chunks. TikTok exige que TODOS los chunks midan chunk_size EXCEPTO el último,
  //    que absorbe el resto (puede ser entre 1x y 2x chunk_size). Por eso total_chunk_count =
  //    floor(video_size / chunk_size), NO ceil: con ceil, un video de p.ej. 12 MB daría un último
  //    chunk de 2 MB (< 5 MB mínimo) → "The total chunk count is invalid". Con floor, ese video va
  //    en 1 solo chunk (video completo). Videos <= CHUNK_BYTES también van en 1 chunk.
  const totalChunkCount = Math.max(1, Math.floor(videoSize / CHUNK_BYTES));
  const chunkSize = totalChunkCount === 1 ? videoSize : CHUNK_BYTES;

  // 3. Init: pedir upload URL
  const initUrl = opts.mode === "direct" ? TIKTOK_POST_INIT_URL : TIKTOK_POST_INBOX_URL;

  const postInfo =
    opts.mode === "direct"
      ? {
          title: opts.title.slice(0, 2200), // TikTok max 2200 chars
          privacy_level: opts.privacyLevel ?? "SELF_ONLY",
          disable_comment: opts.disableComment ?? false,
          disable_duet: opts.disableDuet ?? false,
          disable_stitch: opts.disableStitch ?? false,
          brand_content_toggle: opts.brandContentToggle ?? false,
          brand_organic_toggle: opts.brandOrganicToggle ?? false,
        }
      : undefined; // Inbox no acepta post_info

  const initBody = {
    ...(postInfo ? { post_info: postInfo } : {}),
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunkCount,
    },
  };

  const initRes = await fetch(initUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(initBody),
  });
  const initData = await initRes.json();
  if (!initRes.ok || initData.error?.code !== "ok") {
    throw new Error(
      `init falló: ${initData.error?.message ?? initRes.status} (code: ${initData.error?.code})`
    );
  }
  const { publish_id, upload_url } = initData.data as InitResponse;

  // 4. Subir cada chunk con PUT + Content-Range
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const end = i === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1;
    const length = end - start + 1;

    const stream = createReadStream(opts.filePath, { start, end });
    const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

    const putRes = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(length),
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
      },
      // @ts-expect-error — `duplex` is required by undici when sending a stream
      duplex: "half",
      body: webStream,
    });

    if (!putRes.ok && putRes.status !== 201 && putRes.status !== 206) {
      const text = await putRes.text().catch(() => "");
      throw new Error(`Chunk ${i + 1}/${totalChunkCount} falló: HTTP ${putRes.status} ${text.slice(0, 200)}`);
    }
  }

  // 5. Devolvemos publish_id — el estado final se polea aparte
  return {
    publishId: publish_id,
    status: "PROCESSING_UPLOAD",
  };
}

export async function fetchPublishStatus(publishId: string): Promise<UploadResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("No hay access_token de TikTok.");
  const res = await fetch(TIKTOK_POST_STATUS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") {
    throw new Error(`status fetch falló: ${data.error?.message ?? res.status}`);
  }
  return {
    publishId,
    status: data.data?.status ?? "UNKNOWN",
    publicAccessToken: data.data?.publicaly_available_post_id?.[0],
    failReason: data.data?.fail_reason,
  };
}
