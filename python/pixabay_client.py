"""Cliente para descargar audio (SFX + música) desde Pixabay API.

CUIDADO CON LA LICENCIA. Este archivo decía "Pixabay es CC0", y no lo es desde
enero de 2019: hoy rige la Pixabay Content License, que NO es CC0 ni equivalente.

La diferencia importa para el producto, no en abstracto:
  - Usar el audio DENTRO de un video que producís: permitido, incluso comercial.
  - Redistribuir los archivos como archivos —empaquetarlos con la app, venderlos
    sueltos, subirlos a otro banco de sonidos— NO está permitido.

O sea que estos assets sirven para editar, pero NO pueden viajar dentro de una
copia del programa que se venda o se reparta. El catálogo curado del proyecto es
CC0 de verdad y ése sí se puede empaquetar; esto es un extra que cada quien baja
con SU propia API key, a su nombre, y queda en SU máquina. Por eso la descarga
pide la key del usuario en vez de traer una nuestra.

Texto de la licencia: https://pixabay.com/service/license-summary/
Requiere API key gratuita: https://pixabay.com/accounts/register/

Doc oficial de la API: https://pixabay.com/api/docs/

PENDIENTE DE VERIFICAR: la doc pública de Pixabay documenta imágenes y videos;
no se pudo confirmar desde acá que `/api/sounds/` y `/api/music/` sigan vivos
(la red de la prueba bloqueó incluso el endpoint documentado, así que el
resultado no prueba nada en ninguna dirección). Si la descarga devuelve 404,
empezar por ahí antes de sospechar de la key.

Endpoints usados:
  /api/sounds/   — efectos de sonido cortos
  /api/music/    — pistas musicales

Uso:
  python pixabay_client.py search --key XXX --type sfx --q "cinematic impact" --max 5
  python pixabay_client.py download-pack --key XXX --out-dir <dir>
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


PIXABAY_SOUNDS = "https://pixabay.com/api/sounds/"
PIXABAY_MUSIC = "https://pixabay.com/api/music/"

# Pack pre-curado: queries que disparo cuando el user activa modo cinematic
SFX_PACK = [
    ("cinematic impact", 3, ["cinematic-impact-1.mp3", "cinematic-impact-2.mp3", "cinematic-impact-3.mp3"]),
    ("dramatic hit", 2, ["dramatic-hit-1.mp3", "dramatic-hit-2.mp3"]),
    ("whoosh transition", 3, ["whoosh-transition-1.mp3", "whoosh-transition-2.mp3", "whoosh-transition-3.mp3"]),
    ("swoosh cinematic", 2, ["swoosh-cinematic-1.mp3", "swoosh-cinematic-2.mp3"]),
    ("vhs static", 2, ["vhs-static-real-1.mp3", "vhs-static-real-2.mp3"]),
    ("tape glitch", 1, ["tape-glitch.mp3"]),
    ("camera shutter", 2, ["camera-shutter-real-1.mp3", "camera-shutter-real-2.mp3"]),
    ("tension drone", 2, ["tension-drone-1.mp3", "tension-drone-2.mp3"]),
    ("magic chime", 2, ["magic-chime-1.mp3", "magic-chime-2.mp3"]),
    ("epic reveal", 2, ["epic-reveal-1.mp3", "epic-reveal-2.mp3"]),
]

MUSIC_PACK = [
    ("cinematic instrumental", 1, ["cinematic-instrumental-1.mp3"]),
    ("epic background", 1, ["epic-background.mp3"]),
    ("dramatic piano", 1, ["dramatic-piano.mp3"]),
    ("lofi inspirational", 1, ["lofi-inspirational.mp3"]),
    ("chill background", 1, ["chill-background.mp3"]),
    ("tension underscore", 1, ["tension-underscore.mp3"]),
    ("cinematic instrumental 2", 1, ["cinematic-instrumental-2.mp3"]),
]


def search(api_key: str, kind: str, query: str, count: int = 5, max_duration: int | None = None) -> list[dict[str, Any]]:
    """Busca en /sounds/ o /music/ y devuelve la lista de hits.

    kind: "sfx" | "music"
    """
    base = PIXABAY_SOUNDS if kind == "sfx" else PIXABAY_MUSIC
    params: dict[str, str] = {
        "key": api_key,
        "q": query,
        "per_page": str(max(3, count * 2)),  # pedir extra para tener opciones
    }
    if max_duration:
        # Pixabay API: max_duration (en segundos) no es param oficial en /sounds/
        # pero podemos filtrar después por el campo `duration` del response.
        pass
    url = f"{base}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "ViralPoncho/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"Pixabay {kind} HTTP {e.code}: {body}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Pixabay {kind} URL error: {e.reason}")

    hits = data.get("hits", [])
    # Filtrar por duración si aplica
    if max_duration:
        hits = [h for h in hits if (h.get("duration") or 0) <= max_duration]
    # Ordenar por likes desc
    hits.sort(key=lambda h: -(h.get("likes") or 0))
    return hits[:count]


def download_to(url: str, dest_path: Path, timeout: int = 60) -> int:
    """Descarga URL → file. Devuelve bytes. Hace 2 retries con backoff."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            dest_path.write_bytes(data)
            return len(data)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt == 2:
                raise RuntimeError(f"download failed after 3 attempts: {e}")
            time.sleep(2 ** attempt)
    return 0


def download_pack(api_key: str, kind: str, out_dir: Path) -> dict[str, Any]:
    """Descarga el pack pre-curado de SFX o música.

    Para cada query del pack, busca, toma los top N por likes y descarga.
    Devuelve un manifest con los archivos descargados.
    """
    pack = SFX_PACK if kind == "sfx" else MUSIC_PACK
    manifest: list[dict[str, Any]] = []
    failed: list[str] = []
    out_dir.mkdir(parents=True, exist_ok=True)

    for query, count, filenames in pack:
        try:
            hits = search(api_key, kind, query, count=count, max_duration=8 if kind == "sfx" else None)
        except Exception as e:
            print(f"[pixabay] search '{query}' failed: {e}", file=sys.stderr)
            failed.append(query)
            continue
        if not hits:
            print(f"[pixabay] no hits para '{query}'", file=sys.stderr)
            continue
        for i, hit in enumerate(hits[:count]):
            if i >= len(filenames):
                break
            filename = filenames[i]
            dest = out_dir / filename
            if dest.exists():
                print(f"[pixabay] skip (ya existe): {filename}", file=sys.stderr)
                manifest.append({
                    "filename": filename,
                    "query": query,
                    "duration": hit.get("duration"),
                    "skipped": True,
                })
                continue
            # URL de descarga: campo `audio` o `previewURL` según endpoint
            audio_url = hit.get("audio") or hit.get("previewURL") or hit.get("audioURL")
            if not audio_url:
                # Algunos hits exponen las URLs en `media[]` con tipos. Buscar mp3.
                for m in hit.get("media", []):
                    if m.get("type") == "audio/mpeg" or m.get("path", "").endswith(".mp3"):
                        audio_url = m.get("path")
                        break
            if not audio_url:
                print(f"[pixabay] no audio URL en hit para '{query}' (id={hit.get('id')})", file=sys.stderr)
                continue
            try:
                bytes_written = download_to(audio_url, dest)
                manifest.append({
                    "filename": filename,
                    "query": query,
                    "duration": hit.get("duration"),
                    "bytes": bytes_written,
                    "pixabay_id": hit.get("id"),
                    "page_url": hit.get("pageURL"),
                    "tags": hit.get("tags"),
                })
                print(f"[pixabay] + {kind}/{filename} ({bytes_written} bytes)", file=sys.stderr)
            except Exception as e:
                print(f"[pixabay] download failed for {filename}: {e}", file=sys.stderr)
                failed.append(filename)
            # Rate limit: 100 req/min — espaciar 0.6s entre downloads
            time.sleep(0.6)

    # Guardar manifest
    manifest_path = out_dir / "manifest_pixabay.json"
    manifest_path.write_text(
        json.dumps({"items": manifest, "failed": failed}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return {
        "ok": True,
        "kind": kind,
        "out_dir": str(out_dir),
        "downloaded": len([m for m in manifest if not m.get("skipped")]),
        "skipped": len([m for m in manifest if m.get("skipped")]),
        "failed": len(failed),
        "manifest": manifest,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_search = sub.add_parser("search")
    p_search.add_argument("--key", required=True)
    p_search.add_argument("--type", choices=["sfx", "music"], required=True)
    p_search.add_argument("--q", required=True)
    p_search.add_argument("--max", type=int, default=5)

    p_pack = sub.add_parser("download-pack")
    p_pack.add_argument("--key", required=True)
    p_pack.add_argument("--type", choices=["sfx", "music"], required=True)
    p_pack.add_argument("--out-dir", required=True)

    args = parser.parse_args()

    if args.cmd == "search":
        try:
            hits = search(args.key, args.type, args.q, count=args.max)
            print(json.dumps({"ok": True, "hits": hits}, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            return 1
    elif args.cmd == "download-pack":
        try:
            result = download_pack(args.key, args.type, Path(args.out_dir))
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
