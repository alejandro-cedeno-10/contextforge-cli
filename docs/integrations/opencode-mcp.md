# OpenCode — selección de contexto vía MCP

OpenCode consume el MCP server de ContextForge (`opencode.json` ya lo registra). La selección de skills/rules por tarea se hace llamando la tool `select_agent_context` al inicio de la conversación.

## Flujo de sesión

Al arrancar una conversación en OpenCode con una tarea específica, el agente llama:

```json
{
  "tool": "select_agent_context",
  "input": {
    "task": "fix race condition in tokenLedger writer"
  }
}
```

La tool:

1. Carga `scan.json` y `graph.json` (desde caché en memoria si no han cambiado).
2. Computa los dominios tocados a partir del grafo.
3. Escanea `.claude/skills/` y `.cursor/rules/` leyendo frontmatter.
4. Devuelve el manifiesto JSON con `skills[]` (activas + razón) y `skipped.skills[]`.
5. **No escribe ningún archivo** — cómputo en memoria.

### Respuesta ejemplo

```json
{
  "schemaVersion": "1.0.0",
  "task": "fix race condition in tokenLedger writer",
  "domainsTouched": ["packages/core"],
  "skills": [
    {
      "path": ".claude/skills/ctx-packages-core.md",
      "name": "ctx-packages-core",
      "reason": "task touches packages/core",
      "matchType": "domain"
    }
  ],
  "rules": [
    {
      "path": ".cursor/rules/contextforge.mdc",
      "reason": "skill marked alwaysApply",
      "matchType": "alwaysApply"
    }
  ],
  "skipped": {
    "skills": [{ "name": "ctx-packages-mcp", "reason": "domain not touched" }],
    "rules": []
  }
}
```

El agente usa la lista `skills[]` para saber qué contexto de dominio leer, y puede ignorar los `skipped`.

## Tool alternativa: `get_agent_manifest`

Si ya corriste `forge manifest` y quieres leer el snapshot del disco:

```json
{
  "tool": "get_agent_manifest",
  "input": {}
}
```

Devuelve el contenido de `.contextforge/agent-manifest.json`. Si el archivo no existe, responde: `"Run 'forge manifest' first."`.

## Configuración requerida

Hay tres formas de correr el MCP server. Elige según cómo lo instalaste:

### Opción A — Docker (recomendado, sin instalar Node)

Imagen multi-arch en GHCR (público):

```bash
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:v0.2.4
```

`opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.schema.json",
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
        "ghcr.io/alejandro-cedeno-10/contextforge-mcp:v0.2.4"
      ]
    }
  }
}
```

### Opción B — npm package (requiere Node 22+)

```bash
pnpm add -D @anai-raia-alex/contextforge-mcp@0.2.4
```

```jsonc
{
  "mcpServers": {
    "contextforge": {
      "command": "node",
      "args": ["./node_modules/@anai-raia-alex/contextforge-mcp/dist/index.js"],
      "env": { "PROJECT_ROOT": "." }
    }
  }
}
```

### Opción C — desde el monorepo clonado

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": { "PROJECT_ROOT": "." }
    }
  }
}
```

## Cuando los artefactos no existen

Si `scan.json`/`graph.json` no están en `.contextforge/`, `select_agent_context` devuelve un manifiesto degradado con:

```json
{
  "domainsTouched": [],
  "notes": ["scan/graph missing — run forge scan && forge graph"]
}
```

El agente puede usar eso como señal para sugerir al dev que corra el pipeline.
