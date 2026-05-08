# Claude Code — hook UserPromptSubmit

Este hook invoca `forge manifest` en memoria cada vez que el dev envía un prompt, e inyecta las skills/rules sugeridas como contexto adicional al modelo.

## Requisitos previos

1. `pnpm forge scan && pnpm forge graph` al menos una vez (los artefactos persisten).
2. MCP server corriendo o el CLI accesible en PATH.

## Configuración

Pega esto en `.claude/settings.json` (o `.claude/settings.local.json` si no quieres comitearlo):

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/.bin/forge manifest --agents=claude --force 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

### Alternativa via MCP (recomendada si OpenCode/Claude Code comparten el MCP server)

El agente llama la tool MCP `select_agent_context` al inicio de la conversación:

```json
{
  "tool": "select_agent_context",
  "input": { "task": "<el prompt del usuario>" }
}
```

La tool computa el manifiesto en memoria y devuelve JSON con `skills[]` y `rules[]` relevantes. Sin archivos escritos, sin latencia de disco.

**Wiring en `.claude/settings.json`** — tres opciones:

```jsonc
// A) Docker (más simple, sin instalar Node)
{
  "mcpServers": {
    "contextforge": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-v",
        "${PWD}:/project",
        "-e",
        "PROJECT_ROOT=/project",
        "ghcr.io/alejandro-cedeno-10/contextforge-mcp:v0.2.0"
      ]
    }
  }
}

// B) npm (Node 22+)
{
  "mcpServers": {
    "contextforge": {
      "command": "node",
      "args": [
        "./node_modules/@alejandro-cedeno-10/contextforge-mcp/dist/index.js"
      ],
      "env": { "PROJECT_ROOT": "." }
    }
  }
}
```

## Comportamiento del hook

- Si `scan.json`/`graph.json` no existen: produce una nota visible pero **no aborta el prompt** (exit 0 siempre).
- Si `.claude/skills/` está vacía: manifiesto vacío, sin error.
- El prompt del usuario NO se loguea ni persiste en disco.

## Notas

- Los archivos derivados (`.claude/agent-manifest.md`) están en `.gitignore` — son efímeros.
- Para regenerar manualmente sin el hook: `pnpm forge manifest --force`.
