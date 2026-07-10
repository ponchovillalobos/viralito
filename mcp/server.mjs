#!/usr/bin/env node
/**
 * Servidor MCP de Viralito (F3.b) — expone la edición de Viralito a CUALQUIER agente
 * (Claude Desktop, Claude Code, ChatGPT, Cursor…) por Model Context Protocol.
 *
 * DISEÑO (offline-first, cero deps):
 *   - Implementa el protocolo MCP por STDIO (JSON-RPC 2.0, mensajes por línea) en
 *     Node puro — NO usa @modelcontextprotocol/sdk para no sumar dependencias ni
 *     romper la regla de "todo local/CC0". El contrato MCP stdio es simple.
 *   - Las TOOLS son envoltorios delgados sobre las rutas Next que YA existen y YA
 *     respetan las reglas duras (mono-color, subtítulos, offline). El MCP NO genera
 *     render nuevo: dispara pipelines existentes.
 *   - Habla SOLO con el server local (127.0.0.1). VIRALITO_API_HOST lo configura
 *     (default http://127.0.0.1:3100). No abre NADA a internet.
 *
 * USO:
 *   node viralito/mcp/server.mjs
 * En Claude Desktop / Code, registrar como MCP server con command "node" y args
 * [ruta a este archivo]. Ver README.md.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.VIRALITO_API_HOST ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const PROTOCOL_VERSION = "2024-11-05";

// ─── Helpers HTTP contra el server local ──────────────────────────────────────
async function apiGet(pathname) {
  const r = await fetch(`${API}${pathname}`);
  if (!r.ok) throw new Error(`GET ${pathname} → HTTP ${r.status}`);
  return r.json();
}
async function apiPost(pathname, body) {
  const r = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `POST ${pathname} → HTTP ${r.status}`);
  return data;
}

// Lista de estilos: se lee del registry (fuente de verdad), sin HTTP.
function listStyles() {
  const p = path.join(__dirname, "..", "frontend", "src", "lib", "style-registry.data.json");
  const data = JSON.parse(readFileSync(p, "utf-8"));
  return data.map((e) => ({ id: e.id, name: e.name, tagline: e.tagline, longForm: e.longForm }));
}

// ─── Definición de TOOLS ──────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "list_styles",
    description:
      "Lista los estilos visuales disponibles en Viralito (id, nombre, si sirve para videos largos).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => listStyles(),
  },
  {
    name: "list_short_videos",
    description: "Lista los videos cortos (raw) disponibles para editar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => apiGet("/api/videos/list"),
  },
  {
    name: "list_long_videos",
    description: "Lista los videos largos (cursos/charlas) importados para extraer clips.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => apiGet("/api/long_form/list"),
  },
  {
    name: "list_renders",
    description: "Lista los videos ya renderizados (Mis videos / Producción).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => apiGet("/api/projects"),
  },
  {
    name: "queue_status",
    description: "Estado de la cola de edición: trabajos en curso, en espera y terminados.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => apiGet("/api/jobs/queue"),
  },
  {
    name: "render_short",
    description:
      "Edita un video corto con uno o más estilos. Dispara el pipeline existente (respeta mono-color y subtítulos).",
    inputSchema: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "id del video corto (de list_short_videos)" },
        styles: {
          type: "array",
          items: { type: "string" },
          description: "ids de estilo (de list_styles), ej. ['hype_max_sfx']",
        },
        accentColor: { type: "string", description: "color hex mono, ej. '#fb7185'" },
      },
      required: ["videoId", "styles"],
      additionalProperties: false,
    },
    handler: async (args) =>
      apiPost("/api/editor/auto-build", {
        videoId: args.videoId,
        styles: args.styles,
        accentColor: args.accentColor ?? "#fb7185",
      }),
  },
  {
    name: "process_long_form",
    description:
      "Extrae clips virales de un video largo con el estilo elegido. Dispara el pipeline de largos existente.",
    inputSchema: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "id del video largo (de list_long_videos)" },
        styles: { type: "array", items: { type: "string" }, description: "ids de estilo" },
        accentColor: { type: "string", description: "color hex mono" },
        aspectRatio: { type: "string", enum: ["9:16", "1:1", "16:9"], description: "formato" },
      },
      required: ["videoId", "styles"],
      additionalProperties: false,
    },
    handler: async (args) =>
      apiPost("/api/long_form/process", {
        videoId: args.videoId,
        styles: args.styles,
        accentColor: args.accentColor ?? "#fb7185",
        aspectRatio: args.aspectRatio ?? "9:16",
        mode: "full",
        render: true,
      }),
  },
  {
    name: "long_form_progress",
    description: "Progreso detallado de un trabajo de video largo (por jobId).",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
      additionalProperties: false,
    },
    handler: async (args) =>
      apiGet(`/api/long_form/progress?jobId=${encodeURIComponent(args.jobId)}`),
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ─── Loop JSON-RPC por STDIO (mensajes por línea) ─────────────────────────────
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  // Notificaciones (sin id) no llevan respuesta.
  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "viralito", version: "0.1.0" },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return; // sin respuesta
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }
  if (method === "tools/call") {
    const tool = TOOL_BY_NAME.get(params?.name);
    if (!tool) {
      replyError(id, -32602, `tool desconocida: ${params?.name}`);
      return;
    }
    try {
      const out = await tool.handler(params.arguments ?? {});
      reply(id, {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      });
    } catch (e) {
      // Error de tool: se reporta como contenido isError (no rompe la sesión MCP).
      reply(id, {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      });
    }
    return;
  }
  if (typeof id !== "undefined") {
    replyError(id, -32601, `método no soportado: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    return; // línea no-JSON: ignorar
  }
  handle(msg).catch((e) => {
    if (msg && typeof msg.id !== "undefined") {
      replyError(msg.id, -32603, e instanceof Error ? e.message : String(e));
    }
  });
});

process.stderr.write(`[viralito-mcp] listo · API=${API} · ${TOOLS.length} tools\n`);
