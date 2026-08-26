"""Hooks A/B — genera 3 VARIANTES de gancho para un clip (los primeros 3s deciden el 71%).

Reusa TODA la infraestructura de generate_caption.py: providers OAuth (claude/codex)
con fallback offline a Ollama, dataset de hooks virales verificados (viral_hooks.json)
como few-shot, y extracción robusta de JSON. 100% local cuando no hay internet.

Uso:
  python hook_variants.py --text "transcript del clip..." [--current "hook actual"] [--provider auto]
  → stdout: {"ok": true, "variants": ["...", "...", "..."], "provider": "ollama"}
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

# Reuso directo: providers, few-shot de hooks reales, JSON parsing.
from generate_caption import (
    OLLAMA_MODEL,
    OLLAMA_URL,
    auto_provider,
    default_model,
    extract_json_from_text,
    pick_few_shot_hooks,
    _run_cli_utf8,
)
import urllib.request
from lib import ollama_opts as _ollama_opts


def build_variants_prompt(clip_text: str, current_hook: str) -> str:
    few_shot = pick_few_shot_hooks(clip_text[:64] or "hooks", count=4)
    examples = (
        f"\nHOOKS VIRALES REALES (referencia de estructura, no copies textual):\n{few_shot}\n"
        if few_shot
        else ""
    )
    current = f'\nHOOK ACTUAL (haz variantes DISTINTAS a este): "{current_hook}"\n' if current_hook else ""
    return (
        "Eres un experto en videos virales en español para TikTok/Reels/Shorts.\n"
        "Tu tarea: escribir 3 VARIANTES de gancho (hook) para los primeros 3 segundos del clip.\n"
        "Reglas duras:\n"
        "- Español neutro LATAM, tono humano, directo, sin sonar a anuncio.\n"
        "- Máximo 12 palabras por hook. Sin emojis al inicio. Sin comillas.\n"
        "- Cada variante usa una ESTRATEGIA distinta: (1) pregunta/curiosidad,\n"
        "  (2) dato/cifra impactante, (3) declaración polémica o error común.\n"
        "- El hook debe ser FIEL al contenido del clip (nada de clickbait falso).\n"
        f"{examples}{current}\n"
        f"TRANSCRIPT DEL CLIP:\n{clip_text}\n\n"
        'Responde SOLO este JSON: {"variants": ["hook 1", "hook 2", "hook 3"]}'
    )


def call_ollama_variants(prompt: str) -> dict[str, Any]:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        # Modelos "thinking" (qwen3): sin esto el output se va a `thinking` y
        # `response` llega VACÍO → "Expecting value". Ollama viejo ignora el campo.
        "think": False,
        # Del modulo compartido, como los otros llamadores. Sin `keep_alive` el
        # modelo se descarga entre llamadas y hay que recargarlo (segundos cada
        # vez, y en una placa de 6 GB la carga duele); sin `num_thread` las capas
        # que quedan en CPU usan el default de 4 hilos en vez de los nucleos
        # fisicos reales.
        "keep_alive": _ollama_opts.KEEP_ALIVE,
        "num_thread": _ollama_opts.num_thread(),
        "options": {"temperature": 0.9, "num_ctx": 4096},
    }
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return extract_json_from_text(body.get("response", ""))


def call_cli_variants(provider: str, prompt: str) -> dict[str, Any]:
    model = default_model(provider)
    if provider == "claude":
        args = ["claude", "-p", "--output-format", "text"]
        if model:
            args += ["--model", model]
        code, out, err = _run_cli_utf8(args, prompt)
    else:  # codex
        args = ["codex", "exec", "-"]
        code, out, err = _run_cli_utf8(args, prompt)
    if code != 0:
        raise RuntimeError(f"{provider} CLI falló ({code}): {err[-300:]}")
    return extract_json_from_text(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True, help="transcript del clip (texto plano)")
    ap.add_argument("--current", default="", help="hook actual (para no repetirlo)")
    ap.add_argument("--provider", default="auto", choices=["auto", "claude", "codex", "ollama"])
    args = ap.parse_args()

    provider = auto_provider() if args.provider == "auto" else args.provider
    prompt = build_variants_prompt(args.text[:4000], args.current)

    try:
        if provider == "ollama":
            data = call_ollama_variants(prompt)
        else:
            try:
                data = call_cli_variants(provider, prompt)
            except Exception as e:  # noqa: BLE001 — provider OAuth caído → Ollama local
                print(f"[hook-variants] {provider} falló ({e}); fallback a ollama", file=sys.stderr)
                provider = "ollama"
                data = call_ollama_variants(prompt)
        variants = [
            str(v).strip().strip('"')
            for v in (data.get("variants") or [])
            if isinstance(v, str) and str(v).strip()
        ][:3]
        if not variants:
            raise ValueError("el modelo no devolvió variantes")
        print(json.dumps({"ok": True, "variants": variants, "provider": provider}, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
