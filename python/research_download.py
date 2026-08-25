"""Descarga un video viral de TikTok/IG/YouTube + extrae metadata + transcribe.

Uso:
  python research_download.py <url> <output_dir> <item_id>

Pasos:
  1. yt-dlp descarga video + info.json + thumbnail (+ comments si la plataforma lo permite)
  2. Normaliza el shape de la metadata (autor, hashtags, views, likes, comments, etc.)
  3. Llama transcribe.transcribe() para obtener el guión hablado completo
  4. Emite JSON final al stdout con los paths de los archivos generados.

Headers de progreso al stderr para que el endpoint TS pueda mapear el status:
  ========== STEP 1: download ==========
  ========== STEP 2: transcribe ==========
  ========== STEP 3: index ==========
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from config import DATA_ROOT, FFMPEG_PATH

# DATA_ROOT es .../videos; las cookies viven a su lado, no dentro de los videos.
COOKIES_DIR = DATA_ROOT.parent / "cookies"


def detect_platform(url: str) -> str:
    """Detecta la plataforma por dominio."""
    if re.search(r"tiktok\.com", url, re.IGNORECASE):
        return "tiktok"
    if re.search(r"instagram\.com", url, re.IGNORECASE):
        return "instagram"
    if re.search(r"youtube\.com|youtu\.be", url, re.IGNORECASE):
        return "youtube"
    return "unknown"


def url_kind(url: str) -> str:
    """Distingue URL de post específico vs URL de perfil/canal.

    Posts específicos que yt-dlp puede bajar sin login:
      - tiktok.com/@user/video/<id>
      - instagram.com/{reel,reels,p,tv}/<id>
      - youtube.com/{watch,shorts}/<id> | youtu.be/<id>

    Perfiles (requieren login para listar y NO se pueden bajar como video):
      - tiktok.com/@user                       (sin /video/)
      - instagram.com/<user>/                  (sin /reel/, /p/, /tv/)
      - youtube.com/@user, /c/<channel>        (channel pages)
    """
    u = url.lower().rstrip("/")
    # TikTok
    if "tiktok.com" in u:
        if "/video/" in u or "/photo/" in u:
            return "post"
        return "profile"
    # Instagram
    if "instagram.com" in u:
        if re.search(r"/(reel|reels|p|tv)/[A-Za-z0-9_-]+", u):
            return "post"
        return "profile"
    # YouTube
    if "youtube.com" in u or "youtu.be" in u:
        if re.search(r"(youtube\.com/(watch\?v=|shorts/|embed/)|youtu\.be/[A-Za-z0-9_-]+)", u):
            return "post"
        return "profile"
    return "unknown"


def detect_browser_for_cookies() -> str | None:
    """Detecta qué browser está instalado para `--cookies-from-browser`.
    Necesario para Instagram (siempre) y a veces TikTok.
    Orden de preferencia: Edge (default Windows) → Brave → Chrome → Firefox.
    """
    from pathlib import Path as _P
    home = _P.home()
    candidates = [
        ("edge", home / "AppData/Local/Microsoft/Edge/User Data"),
        ("brave", home / "AppData/Local/BraveSoftware/Brave-Browser/User Data"),
        ("chrome", home / "AppData/Local/Google/Chrome/User Data"),
        ("firefox", home / "AppData/Roaming/Mozilla/Firefox/Profiles"),
    ]
    for name, path in candidates:
        if path.exists():
            return name
    return None


def find_yt_dlp() -> list[str]:
    """Devuelve el comando para invocar yt-dlp. Preferí el módulo Python
    para no depender de un .exe en PATH."""
    return [sys.executable, "-m", "yt_dlp"]


def run_yt_dlp(url: str, output_dir: Path, item_id: str, platform: str) -> Path:
    """Ejecuta yt-dlp y devuelve el path del .mp4 descargado.

    Para IG/TikTok intenta pasar cookies del browser instalado.
    YouTube públicos funcionan sin cookies.
    """
    output_template = str(output_dir / f"{item_id}.%(ext)s")
    cmd = find_yt_dlp() + [
        url,
        "--no-warnings",
        "--write-info-json",
        "--write-comments",
        "--write-thumbnail",
        "--merge-output-format", "mp4",
        "--ffmpeg-location", str(FFMPEG_PATH.parent),
        "-o", output_template,
        "--extractor-args", "youtube:comments_max=50",
    ]

    # Cookies: IG bloquea sin login. TikTok a veces también.
    # YouTube usualmente no necesita.
    if platform in ("instagram", "tiktok"):
        # Preferí archivo cookies.txt si existe (no falla por DPAPI).
        # El usuario lo exporta con extensión "Get cookies.txt LOCALLY" del browser.
        # El path se DERIVA de DATA_ROOT: estaba fijo a C:\hermes-data (el nombre
        # legacy), asi que en cualquier instalacion nueva —que usa C:\viral-data—
        # el archivo no se encontraba nunca y la feature estaba muerta.
        cookies_file = COOKIES_DIR / f"{platform}.txt"
        if cookies_file.exists():
            cmd.extend(["--cookies", str(cookies_file)])
            print(f"[yt-dlp] usando cookies.txt manual: {cookies_file}", file=sys.stderr)
        else:
            browser = detect_browser_for_cookies()
            if browser:
                cmd.extend(["--cookies-from-browser", browser])
                print(f"[yt-dlp] usando cookies de {browser} (puede fallar por DPAPI)", file=sys.stderr)
            else:
                print(
                    "[warn] no se detectó browser instalado para cookies — "
                    "Instagram/TikTok pueden fallar",
                    file=sys.stderr,
                )

    print(f"[yt-dlp] descargando {url}", file=sys.stderr)
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        stderr_tail = proc.stderr[-500:]
        print(f"[yt-dlp] stderr: {stderr_tail}", file=sys.stderr)
        # Mejor error según el patrón conocido
        if "Failed to decrypt with DPAPI" in proc.stderr:
            raise RuntimeError(
                "yt-dlp no puede leer cookies de Edge/Chrome/Brave en Windows (bug "
                "DPAPI #10927). Soluciones: (a) instalar Firefox y loguearte ahí en "
                "Instagram, (b) usar un archivo cookies.txt exportado con la extensión "
                "\"Get cookies.txt LOCALLY\" y guardarlo en "
                f"{COOKIES_DIR / 'instagram.txt'}"
            )
        if "Could not copy Chrome cookie database" in proc.stderr:
            raise RuntimeError(
                "El browser está abierto y bloquea su base de cookies. Cerrá Edge/Brave/"
                "Chrome completamente y reintentá. O usá Firefox que no tiene este lock."
            )
        if "Instagram sent an empty media response" in proc.stderr or "is not granting access" in proc.stderr:
            raise RuntimeError(
                "Instagram bloquea este post sin login. Pasos: (1) loguearte en Firefox "
                "(yt-dlp lee sus cookies sin problemas) o (2) exportá cookies.txt y "
                f"guardalo en {COOKIES_DIR / 'instagram.txt'}"
            )
        if "IP address is blocked" in proc.stderr:
            raise RuntimeError(
                "TikTok bloqueó tu IP para este post. Probá otro video o usá VPN."
            )
        if "Unable to extract data" in proc.stderr:
            raise RuntimeError(
                "yt-dlp no pudo extraer datos. Verificá que la URL sea de un post "
                "específico (no de perfil) y que el post sea público."
            )
        raise RuntimeError(f"yt-dlp exit={proc.returncode}: {stderr_tail}")

    # Buscar el mp4 generado
    candidates = list(output_dir.glob(f"{item_id}.mp4"))
    if not candidates:
        # yt-dlp a veces deja otras extensiones
        candidates = list(output_dir.glob(f"{item_id}.*"))
        candidates = [c for c in candidates if c.suffix.lower() in (".mp4", ".mov", ".mkv", ".webm")]
    if not candidates:
        raise RuntimeError(f"yt-dlp no produjo archivo de video en {output_dir}")
    return candidates[0]


def parse_info_json(info_path: Path) -> dict[str, Any]:
    """Normaliza el shape del info.json de yt-dlp."""
    if not info_path.exists():
        return {}
    try:
        raw = json.loads(info_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

    # Hashtags: vienen como `tags` array, o pueden venir embebidos en la description
    hashtags = list(raw.get("tags") or [])
    desc = raw.get("description") or ""
    # Buscar #hashtags dentro de la description si no había tags
    if not hashtags and desc:
        hashtags = re.findall(r"#[A-Za-z0-9_áéíóúñÁÉÍÓÚÑ]+", desc)
    # Normalizar
    hashtags = list({h.lstrip("#").strip() for h in hashtags if h})[:30]

    # Comments
    comments_raw = raw.get("comments") or []
    comments: list[dict[str, Any]] = []
    for c in comments_raw[:50]:
        comments.append({
            "author": c.get("author") or c.get("author_id") or "?",
            "text": (c.get("text") or "").strip()[:500],
            "likes": c.get("like_count") or 0,
            "is_reply": bool(c.get("parent")),
        })

    # Fecha — yt-dlp da `upload_date` como "YYYYMMDD"
    upload_date = raw.get("upload_date") or ""
    posted_at = ""
    if len(upload_date) == 8:
        posted_at = f"{upload_date[0:4]}-{upload_date[4:6]}-{upload_date[6:8]}"

    return {
        "url": raw.get("webpage_url") or raw.get("original_url") or "",
        "author": raw.get("uploader") or raw.get("channel") or raw.get("creator") or "?",
        "author_url": raw.get("uploader_url") or raw.get("channel_url") or "",
        "title": raw.get("title") or "",
        "caption": desc.strip()[:2000],
        "hashtags": hashtags,
        "views": raw.get("view_count") or 0,
        "likes": raw.get("like_count") or 0,
        "comments_count": raw.get("comment_count") or len(comments),
        "comments": comments,
        "duration": raw.get("duration") or 0,
        "posted_at": posted_at,
        "thumbnail_url": raw.get("thumbnail") or "",
        "raw_extractor": raw.get("extractor") or raw.get("extractor_key") or "",
    }


def find_thumbnail(output_dir: Path, item_id: str) -> Path | None:
    """yt-dlp guarda thumbnail con extensión variable (.jpg/.webp/.png). Buscar el primero."""
    for ext in (".jpg", ".jpeg", ".webp", ".png"):
        candidate = output_dir / f"{item_id}{ext}"
        if candidate.exists():
            return candidate
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="URL del video viral (TikTok/IG/YouTube)")
    parser.add_argument("output_dir", help="Directorio donde guardar archivos")
    parser.add_argument("item_id", help="ID único del item en la biblioteca")
    args = parser.parse_args()

    url = args.url
    output_dir = Path(args.output_dir)
    item_id = args.item_id
    output_dir.mkdir(parents=True, exist_ok=True)

    platform = detect_platform(url)
    if platform == "unknown":
        print(f"[error] URL no reconocida (debe ser TikTok/IG/YouTube): {url}", file=sys.stderr)
        return 1

    kind = url_kind(url)
    if kind == "profile":
        print(
            f"[error] La URL es de un PERFIL ({url}), no de un post específico.\n"
            f"  Necesitás copiar la URL de un video/reel/short individual.\n"
            f"  Ejemplos válidos:\n"
            f"    TikTok:    https://www.tiktok.com/@user/video/1234567890\n"
            f"    Instagram: https://www.instagram.com/reel/Cabc123/\n"
            f"    YouTube:   https://www.youtube.com/shorts/abc123  o  https://youtu.be/abc123",
            file=sys.stderr,
        )
        return 1

    # ─── STEP 1: descarga ─────────────────────────────────────────────────────
    # Strategy:
    #   - Instagram → ig_embed_downloader primero (no requiere cookies). Si falla,
    #     fallback a yt-dlp con cookies.
    #   - TikTok / YouTube → yt-dlp directo.
    print("\n========== STEP 1: download ==========", file=sys.stderr)
    video_path: Path
    thumbnail_path: Path | None = None
    metadata: dict[str, Any] = {}

    if platform == "instagram":
        try:
            from ig_embed_downloader import extract_reel_info, download_reel, download_thumbnail
            print("[ig-embed] intentando descarga vía endpoint público /embed/", file=sys.stderr)
            info = extract_reel_info(url)
            video_path = output_dir / f"{item_id}.mp4"
            size = download_reel(info, video_path)
            print(f"[ig-embed] OK · {size:,} bytes · autor={info.author}", file=sys.stderr)
            # thumbnail best-effort
            tp = output_dir / f"{item_id}.jpg"
            if download_thumbnail(info, tp):
                thumbnail_path = tp
            # Metadata mínima — IG embed no expone views/likes/comments
            metadata = {
                "url": url,
                "author": info.author,
                "author_url": f"https://www.instagram.com/{info.author}/",
                "title": info.caption[:80] if info.caption else "",
                "caption": info.caption,
                "hashtags": list({h.lstrip("#") for h in re.findall(r"#[A-Za-z0-9_áéíóúñÁÉÍÓÚÑ]+", info.caption)})[:30],
                "views": 0,
                "likes": 0,
                "comments_count": 0,
                "comments": [],
                "duration": 0,
                "posted_at": "",
                "thumbnail_url": info.thumbnail_url,
                "raw_extractor": "ig_embed",
            }
        except Exception as exc_embed:
            print(f"[ig-embed] falló: {exc_embed}", file=sys.stderr)
            print("[fallback] intentando con yt-dlp...", file=sys.stderr)
            try:
                video_path = run_yt_dlp(url, output_dir, item_id, platform)
                info_path = output_dir / f"{item_id}.info.json"
                metadata = parse_info_json(info_path)
                thumbnail_path = find_thumbnail(output_dir, item_id)
            except Exception as exc_ytdlp:
                print(
                    f"[error] ambos métodos fallaron. embed: {exc_embed} · yt-dlp: {exc_ytdlp}",
                    file=sys.stderr,
                )
                return 1
    else:
        # TikTok / YouTube → yt-dlp directo
        try:
            video_path = run_yt_dlp(url, output_dir, item_id, platform)
            info_path = output_dir / f"{item_id}.info.json"
            metadata = parse_info_json(info_path)
            thumbnail_path = find_thumbnail(output_dir, item_id)
        except Exception as exc:
            print(f"[error] download falló: {exc}", file=sys.stderr)
            return 1

    metadata["platform"] = platform

    metadata_normalized = output_dir / f"{item_id}.metadata.json"
    metadata_normalized.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"[ok] download · {metadata.get('duration', 0)}s · "
        f"autor={metadata.get('author')} · views={metadata.get('views', 0)}",
        file=sys.stderr,
    )

    # ─── STEP 2: transcribe con WhisperX ──────────────────────────────────────
    print("\n========== STEP 2: transcribe ==========", file=sys.stderr)
    transcript_path = output_dir / f"{item_id}.transcript.json"
    try:
        # Import diferido para que la falla de whisperx no afecte el download
        from transcribe import transcribe as wx_transcribe

        result = wx_transcribe(video_path)
        transcript_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(
            f"[ok] transcribe · {len(result.get('words', []))} palabras · "
            f"{result.get('duration', 0)}s",
            file=sys.stderr,
        )
    except Exception as exc:
        # Si la transcripción falla, igual queremos preservar el download.
        # Guardamos un transcript vacío con el error como nota.
        print(f"[warn] transcribe falló (preservamos download): {exc}", file=sys.stderr)
        transcript_path.write_text(
            json.dumps({
                "words": [],
                "duration": metadata.get("duration", 0),
                "error": str(exc),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ─── STEP 3: índice — solo confirma cierre ───────────────────────────────
    print("\n========== STEP 3: index ==========", file=sys.stderr)

    final = {
        "ok": True,
        "platform": platform,
        "videoPath": str(video_path),
        "thumbnailPath": str(thumbnail_path) if thumbnail_path else "",
        "metadataPath": str(metadata_normalized),
        "transcriptPath": str(transcript_path),
    }
    print(json.dumps(final, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
