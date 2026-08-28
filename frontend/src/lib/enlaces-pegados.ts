/**
 * Interpretar una tanda de enlaces pegados a mano.
 *
 * Quien copia once enlaces de un chat no los trae ordenados: vienen con saltos
 * de línea, comas, espacios de más, alguno repetido y alguna línea que no es un
 * enlace. Rechazar la tanda entera por eso sería hacerle limpiar a mano lo que
 * el programa puede limpiar solo.
 *
 * Vive aparte de la ruta HTTP para poder probarse sin levantar un servidor.
 */

export interface EnlacesPegados {
  /** Listas para encolar, en el orden en que se pegaron y sin repetir. */
  buenas: string[];
  /** Repetidas DENTRO de la misma pegada (las que ya estaban en cola las filtra el store). */
  repetidas: string[];
  /** Texto que no es un enlace http/https usable. */
  rechazadas: { texto: string; motivo: string }[];
}

/**
 * Sólo http(s). Sin esto, un `file:///…` o un `--flag` disfrazado de enlace
 * llegaría a la línea de comandos de yt-dlp.
 */
export function esEnlaceUsable(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

export function interpretarEnlaces(entrada: string | string[]): EnlacesPegados {
  const crudo = Array.isArray(entrada) ? entrada.map(String) : [String(entrada ?? "")];

  const piezas = crudo
    .flatMap((x) => x.split(/[\s,;]+/))
    .map((x) => x.trim())
    // Los enlaces pegados de un documento suelen traer paréntesis o puntos
    // finales que no son parte de la dirección.
    .map((x) => x.replace(/[.,;)\]]+$/, ""))
    .filter(Boolean);

  const buenas: string[] = [];
  const repetidas: string[] = [];
  const rechazadas: { texto: string; motivo: string }[] = [];
  const vistas = new Set<string>();

  for (const p of piezas) {
    if (!esEnlaceUsable(p)) {
      rechazadas.push({ texto: p, motivo: "no es un enlace http/https" });
      continue;
    }
    if (vistas.has(p)) {
      repetidas.push(p);
      continue;
    }
    vistas.add(p);
    buenas.push(p);
  }

  return { buenas, repetidas, rechazadas };
}
