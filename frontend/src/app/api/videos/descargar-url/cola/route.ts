/**
 * Cola de descargas: pegás VARIOS enlaces y se bajan de a uno.
 *
 *   POST /api/videos/descargar-url/cola  { urls: string[], flujo }  → encola
 *   GET  /api/videos/descargar-url/cola                             → estado
 *
 * Hermana de `/api/videos/descargar-url`, que baja UNO y espera. Aquella sigue
 * existiendo y sirve para un enlace suelto; ésta es para una lista.
 *
 * La diferencia que importa no es la cantidad: es que aquélla mantiene la
 * petición abierta hasta que el video termina (tope de 30 minutos). Con once
 * videos de dos horas eso son once esperas delante de la pantalla, y una
 * recarga las pierde todas. Acá la respuesta vuelve enseguida con los ids, y el
 * trabajo sigue en la cola compartida del proyecto.
 */
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { PYTHON_DIR, PYTHON_EXE } from "@/lib/paths";
import { runProcess, parseLastJsonLine } from "@/lib/run-process";
import { enqueue } from "@/lib/job-queue";
import {
  crearDescarga,
  actualizarDescarga,
  listarDescargas,
  yaEnCola,
} from "@/lib/descargas-store";
import { interpretarEnlaces } from "@/lib/enlaces-pegados";

export const dynamic = "force-dynamic";

interface Salida {
  ok?: boolean;
  id?: string;
  duracion_s?: number;
  error?: string;
  pista?: string;
}

export async function GET() {
  return NextResponse.json({ descargas: await listarDescargas() });
}

export async function POST(req: NextRequest) {
  let body: { urls?: unknown; flujo?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "el cuerpo no es JSON" }, { status: 400 });
  }

  const flujo = body.flujo === "corto" ? "corto" : "largo";

  // Se acepta una lista o un texto pegado de cualquier manera: un enlace por
  // linea, separados por comas, o con espacios de mas. Quien copia once enlaces
  // de un chat no los trae ordenados. Lo interpreta `enlaces-pegados`, que vive
  // aparte para poder probarse sin levantar un servidor.
  const { buenas, repetidas: repetidasEnLaPegada, rechazadas } = interpretarEnlaces(
    (body.urls as string | string[]) ?? ""
  );

  if (!buenas.length && !repetidasEnLaPegada.length) {
    return NextResponse.json(
      { error: "no viene ningún enlace usable", rechazadas },
      { status: 400 }
    );
  }

  const aceptadas: { id: string; url: string }[] = [];
  const repetidas: string[] = [...repetidasEnLaPegada];
  const ahora = Date.now();

  for (const url of buenas) {
    // Ya esperando de antes. Bajar dos horas de video por duplicado no lo
    // arregla nadie después.
    if (await yaEnCola(url)) {
      repetidas.push(url);
      continue;
    }

    const d = await crearDescarga(url, flujo, ahora);
    aceptadas.push({ id: d.id, url });

    enqueue("descarga", d.id, async () => {
      const args = [
        path.join(PYTHON_DIR, "descargar_de_url.py"),
        url,
        "--flujo",
        flujo,
      ];
      // Sin tope de tiempo corto: un video de dos horas en 1080p tarda lo que
      // tarda, y matarlo a la mitad deja un archivo roto que después parece un
      // video válido de 0 segundos.
      const r = await runProcess(PYTHON_EXE, args, PYTHON_DIR, undefined, 3 * 60 * 60 * 1000);
      const datos = parseLastJsonLine<Salida>(r.stdout || "") ?? {};

      if (!r.ok || datos.ok === false || !datos.id) {
        await actualizarDescarga(d.id, {
          estado: "fallo",
          terminadoEn: Date.now(),
          error:
            [datos.error, datos.pista].filter(Boolean).join(" — ") ||
            (r.stderr || "").slice(-300) ||
            "la descarga terminó sin decir por qué",
        });
        return;
      }
      await actualizarDescarga(d.id, {
        estado: "listo",
        videoId: datos.id,
        duracionS: datos.duracion_s,
        terminadoEn: Date.now(),
      });
    });
  }

  return NextResponse.json({
    encoladas: aceptadas.length,
    ids: aceptadas,
    repetidas,
    rechazadas,
    descargas: await listarDescargas(),
  });
}
