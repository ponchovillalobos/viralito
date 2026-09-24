"""Reglas del director tipográfico, sin Ollama (usar_llm=False)."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import type_director as td  # noqa: E402


def _palabras(texto: str, paso: float = 0.4, desde: float = 0.0) -> list[dict]:
    out, t = [], desde
    for w in texto.split():
        out.append({"word": w, "start": round(t, 3), "end": round(t + paso * 0.8, 3)})
        t += paso
    return out


TEXTO = (
    "pues la verdad es que yo nunca pensé que esto iba a funcionar "
    "pero después de 20 intentos entendí el secreto y todo cambió para siempre "
    "así que hoy les cuento exactamente cómo lo logramos con muchísima paciencia "
    "y mucha constancia durante meses enteros sin descansar ni un solo día"
)


def test_separacion_minima_entre_heroes():
    h = td.dirigir(_palabras(TEXTO), 40.0, usar_llm=False)
    ats = [x["at"] for x in h]
    assert ats == sorted(ats)
    assert all(b - a >= td.GAP_MIN_S for a, b in zip(ats, ats[1:]))


def test_la_cifra_lleva_su_efecto():
    h = td.dirigir(_palabras(TEXTO), 40.0, usar_llm=False)
    cifras = [x for x in h if any(c.isdigit() for c in x["text"])]
    assert cifras and all(x["effect"] == td.MOVE_CIFRA for x in cifras)


def test_como_mucho_dos_efectos_de_texto():
    h = td.dirigir(_palabras(TEXTO * 3), 120.0, usar_llm=False)
    efectos = {x["effect"] for x in h if x["effect"] != td.MOVE_CIFRA}
    assert len(efectos) <= 2


def test_dosis_corta_y_no_arranca_en_el_primer_segundo():
    h = td.dirigir(_palabras(TEXTO), 40.0, usar_llm=False)
    assert h
    assert all(x["at"] >= 0.9 for x in h)
    assert all(x["duration"] <= td.MAX_SPAN_S + 0.45 for x in h)


def test_bordes_vacios_se_recortan():
    words = _palabras("un poquito en")
    assert td._recorta_bordes([0, 1, 2], words) == [1]


def test_transcript_corto_no_inventa():
    assert td.dirigir(_palabras("hola a todos"), 3.0, usar_llm=False) == []
