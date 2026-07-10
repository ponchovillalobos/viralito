# Servidor MCP de Viralito

Expone la edición de Viralito a cualquier agente que hable **Model Context Protocol**
(Claude Desktop, Claude Code, ChatGPT, Cursor…). Paridad con los "connectors" de
productos como Motion.so, pero **100% local**: el server solo habla con tu Viralito
en `127.0.0.1`, nada sale a internet.

## Requisitos

- Viralito corriendo (la app de escritorio o `npm run dev` del frontend en `:3100`).
- Node (el mismo que ya usa Viralito). **Cero dependencias** que instalar.

## Tools disponibles

| Tool | Qué hace |
|---|---|
| `list_styles` | Lista los estilos visuales (id, nombre, si sirve para largos) |
| `list_short_videos` | Lista los videos cortos disponibles |
| `list_long_videos` | Lista los videos largos importados |
| `list_renders` | Lista los videos ya renderizados (Mis videos) |
| `queue_status` | Estado de la cola (en curso / en espera / terminados) |
| `render_short` | Edita un corto con uno o más estilos |
| `process_long_form` | Extrae clips virales de un video largo |
| `long_form_progress` | Progreso de un trabajo de largos (por jobId) |

Las tools son envoltorios de las rutas Next que ya existen y ya respetan las reglas
duras (mono-color, subtítulos siempre visibles, offline). El MCP **no** genera render
nuevo: dispara los pipelines existentes.

## Configurar en Claude Desktop

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "viralito": {
      "command": "node",
      "args": ["D:/Poncho/Videos/Editor_Viral/viralito/mcp/server.mjs"],
      "env": { "VIRALITO_API_HOST": "http://127.0.0.1:3100" }
    }
  }
}
```

## Configurar en Claude Code

```bash
claude mcp add viralito -- node D:/Poncho/Videos/Editor_Viral/viralito/mcp/server.mjs
```

## Variables de entorno

- `VIRALITO_API_HOST` — dónde escucha Viralito (default `http://127.0.0.1:3100`).

## Probar a mano

```bash
# handshake + listar tools
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node server.mjs
```
