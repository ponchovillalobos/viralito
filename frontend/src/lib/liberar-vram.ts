/**
 * Pedirle a Ollama que suelte el modelo antes de una etapa que necesita memoria.
 *
 * Ollama mantiene el modelo cargado unos minutos tras la última llamada para no
 * pagar la recarga entre peticiones seguidas. Durante el análisis eso es lo
 * correcto. El problema es después: nadie le decía que lo soltara, así que el
 * render arrancaba con la memoria todavía tomada por un modelo que ya terminó su
 * trabajo.
 *
 * Medido en esta máquina mientras renderizaba un short (estilo editorial):
 *
 *     GPU  : 0-11 % de uso          ← el render no es trabajo de GPU
 *     VRAM : 5150 MB de 6144        ← y ~4.9 GB eran Ollama sin hacer nada
 *     RAM  : 25 de 27.9 GB          ← llama-server sumaba 2.75 GB más
 *     CPU  : 79-100 %               ← esto sí es el cuello de botella real
 *
 * O sea que el render competía por memoria contra un proceso ocioso, en las dos
 * memorias a la vez. En una placa de 6 GB eso deja ~1 GB libre, y el propio
 * render de Remotion abre catorce procesos de Chrome.
 *
 * Es best-effort a propósito: corre en el camino crítico de un render y no puede
 * tumbarlo porque Ollama no contestó. Si falla se pierde memoria libre, no
 * trabajo, y Ollama la devuelve sola cuando vence su propio plazo.
 */

const OLLAMA_URL = process.env.VIRAL_OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.VIRAL_OLLAMA_MODEL ?? "qwen3:8b";

export async function liberarOllama(modelo = OLLAMA_MODEL): Promise<boolean> {
  try {
    // `keep_alive: 0` con un pedido vacío es la forma documentada de descargarlo.
    const r = await fetch(`${OLLAMA_URL.replace(/\/+$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
