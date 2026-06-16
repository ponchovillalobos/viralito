"use client";

/**
 * useLocalStorageList — lista de strings (ids) persistida en localStorage, pensada
 * para FAVORITOS y RECIENTES de la galería de stickers.
 *
 * - SSR-safe: arranca con el valor inicial y lee localStorage recién en el efecto
 *   de montaje (evita mismatch de hidratación de Next).
 * - `cap` recorta la lista (útil para "recientes": guarda sólo los N más nuevos).
 * - `push` inserta al frente y deduplica; `toggle` agrega/quita (favoritos); el
 *   estado y localStorage se mantienen en sync ante cambios desde otra pestaña.
 */
import { useCallback, useEffect, useState } from "react";

export function useLocalStorageList(key: string, cap = Infinity) {
  const [list, setList] = useState<string[]>([]);

  // Lectura inicial SÓLO en cliente (post-montaje) para no romper la hidratación.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Lectura post-montaje a propósito (SSR-safe, ver arriba): no se puede usar un
        // initializer de useState sin romper la hidratación de Next.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed)) setList(parsed.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      /* localStorage no disponible o JSON corrupto → lista vacía */
    }
  }, [key]);

  const persist = useCallback(
    (next: string[]) => {
      setList(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* cuota llena o modo privado → ignorar, la UI sigue con el estado en memoria */
      }
    },
    [key]
  );

  // Inserta al frente, deduplica y recorta a `cap`. Ideal para "recientes".
  const push = useCallback(
    (id: string) => {
      setList((prev) => {
        const next = [id, ...prev.filter((x) => x !== id)].slice(0, cap);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key, cap]
  );

  // Agrega o quita un id (favoritos).
  const toggle = useCallback(
    (id: string) => {
      setList((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key]
  );

  // Sincroniza entre pestañas: si otra pestaña cambia la clave, reflejarlo aquí.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : [];
        if (Array.isArray(parsed)) setList(parsed.filter((x): x is string => typeof x === "string"));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  return { list, push, toggle, setList: persist };
}
