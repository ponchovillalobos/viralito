"""Ajusta el principio y el final de un clip a una frontera natural del habla.

EL PROBLEMA, MEDIDO

El pipeline ya calculaba `cierran_frase` y lo escribía en la bitácora. En una
tanda real dio **17 de 23**: seis clips de cada veintitrés terminaban a mitad de
frase. La métrica existía y nadie hacía nada con ella — se medía el defecto y se
publicaba igual.

Y se nota. Un corto que corta en "y entonces lo que pasa es que—" se siente roto
en el primer segundo, antes de que nadie lea un titular.

QUÉ HACE

Mueve el borde a la frontera natural más cercana, dentro de una tolerancia
pequeña. Frontera natural = una palabra que termina en puntuación fuerte, o una
pausa real entre palabras.

No inventa contenido: sólo estira o encoge unas décimas hasta el punto donde el
orador respiró. Fuera de la tolerancia no toca nada — es mejor un corte
imperfecto que un clip que se lleva media idea ajena.

POR QUÉ LA TOLERANCIA ES ASIMÉTRICA

Al FINAL se permite estirar más que encoger (2.5 s contra 1.2 s): completar la
frase casi siempre mejora, y cortarla antes nunca. Al PRINCIPIO al revés — se
prefiere entrar un poco tarde, ya empezada la frase, que arrastrar el final de
la anterior, que no viene a cuento.
"""
from __future__ import annotations

# Puntuación que cierra una idea. Los dos puntos y el punto y coma cuentan:
# marcan una pausa que el oído reconoce como final aunque la gramática siga.
_CIERRE = (".", "!", "?", "…", ":", ";")

# Una pausa de esta duración entre palabras es un punto aunque no se escriba.
# 0.45 s es el mismo umbral que ya usaba la métrica de la bitácora, para que
# medir y corregir hablen del mismo fenómeno.
PAUSA_DE_CIERRE = 0.45


def _es_frontera(palabras: list[dict], i: int) -> bool:
    """¿La palabra `i` cierra una idea?"""
    w = palabras[i]
    if str(w.get("word", "")).strip().endswith(_CIERRE):
        return True
    if i + 1 >= len(palabras):
        return True  # la última del transcript siempre cierra
    hueco = float(palabras[i + 1].get("start", 0)) - float(w.get("end", 0))
    return hueco >= PAUSA_DE_CIERRE


def ajustar_final(fin: float, palabras: list[dict],
                  estirar: float = 2.5, encoger: float = 1.2) -> float:
    """Lleva el final del clip al cierre de frase más cercano.

    Prefiere ESTIRAR: completar la frase casi siempre mejora el clip, y cortarla
    antes nunca. Si no hay ninguna frontera a mano, devuelve el valor original.
    """
    if not palabras:
        return fin

    mejor = None
    mejor_dist = None
    for i, w in enumerate(palabras):
        try:
            t = float(w.get("end", 0))
        except (TypeError, ValueError):
            continue
        if not _es_frontera(palabras, i):
            continue
        d = t - fin
        if d > estirar or -d > encoger:
            continue
        # Empate: gana estirar. Un clip que respira de más se ve entero; uno
        # que respira de menos, cortado.
        peso = abs(d) if d >= 0 else abs(d) * 1.35
        if mejor_dist is None or peso < mejor_dist:
            mejor, mejor_dist = t, peso

    return mejor if mejor is not None else fin


def ajustar_inicio(inicio: float, palabras: list[dict],
                   atrasar: float = 1.5, adelantar: float = 0.8) -> float:
    """Lleva el principio del clip al arranque de una frase.

    Al revés que el final: se prefiere entrar un poco TARDE —ya empezada la
    frase— que arrastrar el cierre de la anterior, que no viene a cuento y suena
    a error de montaje.
    """
    if not palabras:
        return inicio

    mejor = None
    mejor_dist = None
    for i, w in enumerate(palabras):
        try:
            t = float(w.get("start", 0))
        except (TypeError, ValueError):
            continue
        # Arranca frase la primera palabra, o la que sigue a una frontera.
        if i > 0 and not _es_frontera(palabras, i - 1):
            continue
        d = t - inicio
        if d > atrasar or -d > adelantar:
            continue
        peso = abs(d) if d >= 0 else abs(d) * 1.35
        if mejor_dist is None or peso < mejor_dist:
            mejor, mejor_dist = t, peso

    return mejor if mejor is not None else inicio


def ajustar_clip(clip: dict, palabras: list[dict],
                 duracion_maxima: float = 75.0) -> tuple[dict, bool]:
    """Ajusta los dos bordes. Devuelve (clip, si_cambio).

    El tope de duración es una red: estirar el final no puede convertir un clip
    de 55 s en uno de 80. Si el ajuste se pasa, se deja el final como estaba.
    """
    try:
        ini = float(clip.get("start", 0))
        fin = float(clip.get("end", 0))
    except (TypeError, ValueError):
        return clip, False
    if fin <= ini:
        return clip, False

    nuevo_ini = ajustar_inicio(ini, palabras)
    nuevo_fin = ajustar_final(fin, palabras)

    if nuevo_fin - nuevo_ini > duracion_maxima:
        nuevo_fin = fin
    if nuevo_fin <= nuevo_ini:
        return clip, False

    cambio = abs(nuevo_ini - ini) > 0.01 or abs(nuevo_fin - fin) > 0.01
    if not cambio:
        return clip, False

    salida = dict(clip)
    salida["start"] = round(nuevo_ini, 2)
    salida["end"] = round(nuevo_fin, 2)
    return salida, True


def cierra_frase(fin: float, palabras: list[dict]) -> bool:
    """¿El clip termina en una frontera natural?

    Es la MISMA cuenta que la métrica `cierran_frase` de la bitácora, extraída
    acá para que medir y corregir no puedan discrepar. Cuando estaban escritas
    en dos sitios, arreglar una no movía la otra.
    """
    dentro = [w for w in palabras if float(w.get("start", 0)) <= fin]
    if not dentro:
        return False
    i = len(dentro) - 1
    return _es_frontera(palabras, i)
