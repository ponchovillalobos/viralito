"""Descarga las fuentes VARIABLES editoriales (OFL) desde el repo oficial de
Google Fonts (raw.githubusercontent.com — sin API key) a remotion/public/fonts/.

Los nombres originales traen brackets ("Fraunces[SOFT,WONK,opsz,wght].ttf") que
PowerShell trata como wildcards y staticFile() no quiere — se guardan con
nombre plano. Idempotente: si el archivo ya existe con tamaño > 0, lo salta.

Uso:  python download_fonts.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/google/fonts/main"

# (carpeta bajo el repo —incluye la licencia: ofl/ o apache/—, archivo original, nombre local plano)
FONTS = [
    # ── Variables editoriales (Ola 2 — editorial-ink) ──
    ("ofl/fraunces", "Fraunces[SOFT,WONK,opsz,wght].ttf", "fraunces-var.ttf"),
    ("ofl/fraunces", "Fraunces-Italic[SOFT,WONK,opsz,wght].ttf", "fraunces-italic-var.ttf"),
    ("ofl/bodonimoda", "BodoniModa[opsz,wght].ttf", "bodonimoda-var.ttf"),
    ("ofl/bodonimoda", "BodoniModa-Italic[opsz,wght].ttf", "bodonimoda-italic-var.ttf"),
    ("ofl/robotoserif", "RobotoSerif[GRAD,opsz,wdth,wght].ttf", "robotoserif-var.ttf"),
    ("ofl/bricolagegrotesque", "BricolageGrotesque[opsz,wdth,wght].ttf", "bricolage-var.ttf"),
    ("ofl/newsreader", "Newsreader[opsz,wght].ttf", "newsreader-var.ttf"),
    ("ofl/newsreader", "Newsreader-Italic[opsz,wght].ttf", "newsreader-italic-var.ttf"),
    # ── Fuentes editoriales OFFLINE (editorial-themes / editorial-layer / ViralVideo) ──
    # Antes se bajaban de fonts.gstatic.com EN CADA RENDER vía @remotion/google-fonts →
    # sin internet el render abortaba. Ahora se hornean a TTF locales (cero red en render).
    ("ofl/oldstandardtt", "OldStandard-Regular.ttf", "OldStandardTT-Regular.ttf"),
    ("ofl/oldstandardtt", "OldStandard-Bold.ttf", "OldStandardTT-Bold.ttf"),
    ("ofl/oldstandardtt", "OldStandard-Italic.ttf", "OldStandardTT-Italic.ttf"),
    ("ofl/cormorantgaramond", "CormorantGaramond[wght].ttf", "CormorantGaramond-var.ttf"),
    ("ofl/cormorantgaramond", "CormorantGaramond-Italic[wght].ttf", "CormorantGaramond-italic-var.ttf"),
    ("ofl/karla", "Karla[wght].ttf", "Karla-var.ttf"),
    ("ofl/spacemono", "SpaceMono-Regular.ttf", "SpaceMono-Regular.ttf"),
    ("ofl/spacemono", "SpaceMono-Bold.ttf", "SpaceMono-Bold.ttf"),
    ("ofl/imfellenglish", "IMFeENrm28P.ttf", "IMFellEnglish-Regular.ttf"),
    ("ofl/imfellenglish", "IMFeENit28P.ttf", "IMFellEnglish-Italic.ttf"),
    ("ofl/josefinsans", "JosefinSans[wght].ttf", "JosefinSans-var.ttf"),
    ("ofl/josefinsans", "JosefinSans-Italic[wght].ttf", "JosefinSans-italic-var.ttf"),
    ("ofl/dmsans", "DMSans[opsz,wght].ttf", "DMSans-var.ttf"),
    ("ofl/intertight", "InterTight[wght].ttf", "InterTight-var.ttf"),
    ("ofl/spacegrotesk", "SpaceGrotesk[wght].ttf", "SpaceGrotesk-var.ttf"),
    ("ofl/ibmplexmono", "IBMPlexMono-Regular.ttf", "IBMPlexMono-Regular.ttf"),
    ("ofl/ibmplexmono", "IBMPlexMono-Bold.ttf", "IBMPlexMono-Bold.ttf"),
    ("ofl/shipporimincho", "ShipporiMincho-Regular.ttf", "ShipporiMincho-Regular.ttf"),
    ("ofl/shipporimincho", "ShipporiMincho-Bold.ttf", "ShipporiMincho-Bold.ttf"),
    ("ofl/zenkakugothicnew", "ZenKakuGothicNew-Regular.ttf", "ZenKakuGothicNew-Regular.ttf"),
    ("ofl/zenkakugothicnew", "ZenKakuGothicNew-Bold.ttf", "ZenKakuGothicNew-Bold.ttf"),
    ("ofl/librefranklin", "LibreFranklin[wght].ttf", "LibreFranklin-var.ttf"),
    ("ofl/librefranklin", "LibreFranklin-Italic[wght].ttf", "LibreFranklin-italic-var.ttf"),
    ("ofl/spectral", "Spectral-Regular.ttf", "Spectral-Regular.ttf"),
    ("ofl/spectral", "Spectral-Bold.ttf", "Spectral-Bold.ttf"),
    ("ofl/cinzel", "Cinzel[wght].ttf", "Cinzel-var.ttf"),
    ("ofl/jetbrainsmono", "JetBrainsMono[wght].ttf", "JetBrainsMono-var.ttf"),
    ("ofl/playfairdisplay", "PlayfairDisplay[wght].ttf", "PlayfairDisplay-var.ttf"),
    ("ofl/playfairdisplay", "PlayfairDisplay-Italic[wght].ttf", "PlayfairDisplay-italic-var.ttf"),
    ("apache/specialelite", "SpecialElite-Regular.ttf", "SpecialElite-Regular.ttf"),
    ("ofl/dmserifdisplay", "DMSerifDisplay-Regular.ttf", "DMSerifDisplay-Regular.ttf"),
    ("ofl/dmserifdisplay", "DMSerifDisplay-Italic.ttf", "DMSerifDisplay-Italic.ttf"),
    ("ofl/lora", "Lora[wght].ttf", "Lora-var.ttf"),
    ("ofl/lora", "Lora-Italic[wght].ttf", "Lora-italic-var.ttf"),
    ("ofl/abrilfatface", "AbrilFatface-Regular.ttf", "AbrilFatface-Regular.ttf"),
]

OUT_DIR = Path(__file__).resolve().parent.parent / "remotion" / "public" / "fonts"


def quote(name: str) -> str:
    return name.replace("[", "%5B").replace("]", "%5D").replace(",", "%2C")


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ok = 0
    for folder, original, local in FONTS:
        dest = OUT_DIR / local
        if dest.exists() and dest.stat().st_size > 10_000:
            print(f"ya existe: {local}")
            ok += 1
            continue
        url = f"{BASE}/{folder}/{quote(original)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "estrategia-viral-fonts/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                f.write(r.read())
            kb = dest.stat().st_size // 1024
            print(f"descargada: {local} ({kb} KB)")
            ok += 1
        except Exception as e:  # noqa: BLE001 — reportar y seguir con las demás
            print(f"ERROR {local}: {e}", file=sys.stderr)
            if dest.exists():
                dest.unlink()
    print(f"{ok}/{len(FONTS)} fuentes listas en {OUT_DIR}")
    return 0 if ok == len(FONTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
