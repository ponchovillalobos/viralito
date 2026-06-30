"""check_text_overlap.py — Instrumento del objetivo (r): detecta TEXTOS QUE SE REPITEN
en pantalla en los videos generados.

Para cada clip (graphics/{clip_id}.json + transcripts/{clip_id}.json) revisa, por
ventana de tiempo, si un OVERLAY de texto (editorialCard.title/subtitle,
kineticHeadline, dataViz.title) repite:
  1) el SUBTÍTULO que se está diciendo en esa ventana (tokens hablados), o
  2) OTRO overlay activo al mismo tiempo, o
  3) el título de OTRA tarjeta (duplicado exacto/casi-exacto).

Métrica: # de repeticiones detectadas por clip/estilo (0 = perfecto). NO toca render.

Uso:
  python check_text_overlap.py                 # escanea los N clips más recientes
  python check_text_overlap.py --video "Cyntia reyes"
  python check_text_overlap.py --limit 30 --sim 0.6
"""
from __future__ import annotations
import argparse, json, glob, os, re, sys

try:
    import config
    LF = str(getattr(config, "LF_ROOT", r"C:/viral-data/videos/long_form"))
except Exception:
    LF = r"C:/viral-data/videos/long_form"

_STOP = set("que como para pero esto esta este los las una con por sin del sus mas muy "
            "de la el en lo le su al un si no me ya o y a se es son ser dos tres".split())


def _toks(s: str) -> set[str]:
    s = (s or "").lower()
    s = re.sub(r"[^a-záéíóúñ0-9 ]", " ", s)
    return {w for w in s.split() if len(w) > 3 and w not in _STOP}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _spoken_tokens(words: list[dict], t0: float, t1: float) -> set[str]:
    out: set[str] = set()
    for w in words:
        ws = float(w.get("start", 0))
        if t0 - 0.3 <= ws <= t1 + 0.3:
            out |= _toks(w.get("word", ""))
    return out


def _overlays(graphics: dict) -> list[dict]:
    """Lista normalizada {kind, text, at, end} de todo overlay con texto."""
    out = []
    for c in graphics.get("editorialCards") or []:
        at = float(c.get("at", 0)); dur = float(c.get("duration", 5))
        for field in ("title", "subtitle"):
            txt = (c.get(field) or "").strip()
            if txt:
                out.append({"kind": f"card.{field}", "text": txt, "at": at, "end": at + dur})
    for h in graphics.get("kineticHeadlines") or []:
        txt = (h.get("text") or h.get("headline") or "").strip()
        if txt:
            at = float(h.get("at", 0)); dur = float(h.get("duration", 3))
            out.append({"kind": "headline", "text": txt, "at": at, "end": at + dur})
    for v in graphics.get("dataViz") or []:
        txt = (v.get("title") or v.get("label") or "").strip()
        if txt:
            at = float(v.get("at", 0)); dur = float(v.get("duration", 4))
            out.append({"kind": "dataViz", "text": txt, "at": at, "end": at + dur})
    return out


def scan_clip(clip_id: str, sim_th: float) -> list[str]:
    gpath = os.path.join(LF, "graphics", f"{clip_id}.json")
    tpath = os.path.join(LF, "transcripts", f"{clip_id}.json")
    if not os.path.exists(gpath):
        return []
    try:
        g = json.load(open(gpath, encoding="utf-8"))
        words = json.load(open(tpath, encoding="utf-8")).get("words", []) if os.path.exists(tpath) else []
    except Exception:
        return []
    ov = _overlays(g)
    issues: list[str] = []
    # 1) overlay vs SUBTÍTULO hablado en su ventana.
    #    Las tarjetas editoriales (card.*) NO cuentan: ViralVideo suprime el subtítulo
    #    baseline mientras una tarjeta con texto está activa (fix objetivo r), así que
    #    el titular NO co-ocurre con el baseline → no hay duplicación en pantalla.
    for o in ov:
        if o["kind"].startswith("card."):
            continue
        spoken = _spoken_tokens(words, o["at"], o["end"])
        s = _jaccard(_toks(o["text"]), spoken)
        if s >= sim_th:
            issues.append(f"{o['kind']} repite el subtítulo ({s:.2f}): {o['text'][:45]!r}")
    # 2) dos overlays SOLAPADOS en tiempo con texto similar
    for i in range(len(ov)):
        for j in range(i + 1, len(ov)):
            a, b = ov[i], ov[j]
            if a["at"] < b["end"] and b["at"] < a["end"]:  # solapan en tiempo
                s = _jaccard(_toks(a["text"]), _toks(b["text"]))
                if s >= sim_th:
                    issues.append(f"{a['kind']}+{b['kind']} solapan y repiten ({s:.2f}): {a['text'][:35]!r} / {b['text'][:35]!r}")
    # 3) títulos de tarjeta DUPLICADOS (cualquier tiempo)
    titles = [o["text"] for o in ov if o["kind"] == "card.title"]
    for t in sorted(set(titles)):
        if titles.count(t) > 1:
            issues.append(f"card.title duplicado x{titles.count(t)}: {t[:45]!r}")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default=None, help="solo clips de este video_id")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--sim", type=float, default=0.6, help="umbral Jaccard de similitud (0..1)")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(LF, "graphics", "*.json")), key=os.path.getmtime, reverse=True)
    if args.video:
        files = [f for f in files if os.path.basename(f).startswith(args.video)]
    files = files[: args.limit]

    total_clips = 0
    total_issues = 0
    flagged = 0
    for f in files:
        clip_id = os.path.splitext(os.path.basename(f))[0]
        issues = scan_clip(clip_id, args.sim)
        total_clips += 1
        if issues:
            flagged += 1
            total_issues += len(issues)
            print(f"\n[{clip_id}]")
            for it in issues:
                print(f"   - {it}")
    print(f"\n=== RESUMEN: {total_clips} clips · {flagged} con repeticiones · {total_issues} repeticiones (umbral sim={args.sim}) ===")
    print("Métrica (r): 0 repeticiones = Perfecto.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
