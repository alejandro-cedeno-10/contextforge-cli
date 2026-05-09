---
title: Cómo usar ContextForge (v0.3.10+)
description: Guía completa de instalación y uso. Tú hablas con tu agente sobre OpenSpec; ContextForge actúa por debajo vía MCP.
audience: dev
type: how-to
tags: [getting-started, pipeline, agents, openspec, mcp]
updated: 2026-05-09
---

# Cómo usar ContextForge

> **Filosofía v0.3.10+**: tú hablas con tu agente IA usando lenguaje natural sobre OpenSpec ("abre un proposal X", "cierra el change Y"). El agente, vía **MCP**, dispara los pasos de ContextForge automáticamente. Tú **no** ejecutas `forge` a mano salvo en setup o troubleshooting.

---

## 1. Setup (una sola vez)

### 1.1 Instala los CLI

```bash
# OpenSpec CLI — el comando que tú vas a usar
npm i -g @fission-ai/openspec

# ContextForge CLI — para `forge init` y troubleshooting
pnpm add -g @anai-raia-alex/contextforge-cli@0.3.10

# (alternativa Docker para el MCP: cero instalación local de Node)
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

Verifica:

```bash
node --version              # v22.x.x
pnpm --version              # 10.x.x
forge --help                # ayuda de la CLI
openspec --version          # OpenSpec
```

### 1.2 Inicializa el repo (corre `openspec init` por debajo)

```bash
cd tu-repo
pnpm forge init
```

Eso hace, transparente:

| Paso | Qué hace                                  | Artefacto                                                                    |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | Detecta AI IDEs instalados                | `claude`, `cursor`, `opencode` en PATH                                       |
| 2    | `openspec init . --tools=<detectados>`    | `openspec/`, instrucciones canónicas en `.claude/`, `.cursor/`, `.opencode/` |
| 3    | `forge scan`                              | `.contextforge/scan.json` (BLAKE3)                                           |
| 4    | `forge graph`                             | `.contextforge/graph.json` (grafo padre + cache por archivo)                 |
| 5    | `forge skills --force`                    | `.claude/skills/contextforge-domain-*.md` (uno por dominio del grafo)        |
| 6    | `forge context "<repo> initial overview"` | `.contextforge/context-pack.json`                                            |
| 7    | `forge viz`                               | `.contextforge/graph.html` (Cytoscape standalone)                            |

### 1.3 Wirea el MCP server al agente

El MCP server expone **10 tools** a tu agente IA. Hay dos formas de correrlo: Docker (cero deps) o npm (más rápido si ya tienes Node 22).

#### Opción A — Docker (recomendada)

```jsonc
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
        "ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest"
      ]
    }
  }
}
```

**¿Por qué esos args?** No son opcionales — sin ellos el container no encuentra tu repo:

| Arg                        | Para qué                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--rm -i`                  | El container se autodestruye al terminar (`--rm`) y mantiene stdin abierto (`-i`) para el protocolo MCP.                          |
| `-v "${PWD}:/project"`     | **Bind mount**: tu directorio actual (host) → `/project` (container). Sin esto, Docker está aislado y no ve tus archivos.         |
| `-e PROJECT_ROOT=/project` | Le dice al MCP server _"el repo es `/project`"_ para que encuentre `.contextforge/graph.json`. Sin esto, busca desde `/` y falla. |

#### Opción B — npm directo (más rápido, requiere Node 22+ local)

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

Sin bind mount (corre en el host), pero `PROJECT_ROOT` sigue siendo necesario para saber **qué repo servir** si tienes varios.

#### Wiring por agente

| Agente          | Archivo de config                      |
| --------------- | -------------------------------------- |
| **Claude Code** | `~/.claude/claude_desktop_config.json` |
| **Cursor**      | Settings → MCP servers                 |
| **OpenCode**    | `opencode.json` en el repo             |

Reinicia el agente. Verifica que ve los 10 tools (debe haber un panel/comando para listar tools MCP en cada agente).

---

## 2. Tu flujo diario — solo OpenSpec, nada de `forge`

### Caso A: abrir un proposal nuevo

**Tú le dices a tu agente**:

> _"Quiero proponer un change que arregle el race en `tokenLedger`. Llámalo `fix-token-race`."_

**El agente, por debajo**:

```jsonc
// 1. Pide el contexto relevante
{ "tool": "forge_context", "arguments": { "task": "fix race en tokenLedger" } }

// 2. Verifica qué changes activos hay
{ "tool": "forge_status" }

// 3. Genera el scaffold del change (CLI):
//    pnpm forge spec fix-token-race
//    → openspec/changes/fix-token-race/{proposal,design,tasks,specs/}
//    → openspec/changes/fix-token-race/graph.subset.{json,html}
//    → openspec/changes/fix-token-race/context.md
```

**Resultado** en `openspec/changes/fix-token-race/`:

```
proposal.md         ← Intent / Scope
design.md           ← Decisiones técnicas + sección "Context graph (subset)"
tasks.md            ← Checklist de implementación
specs/<dom>/spec.md ← Requirement+Scenario formal (openspec validate)
graph.subset.json   ← subgrafo congelado del change (validado por JSON Schema)
graph.subset.html   ← viewer Cytoscape standalone (abre en navegador)
context.md          ← mapa de lectura para el agente
```

### Caso B: implementar el change

**Tú le dices**:

> _"Implementa `fix-token-race`."_

**El agente, por debajo**:

```jsonc
// 1. Lee el subgrafo congelado del change (un solo call, cheap):
{ "tool": "forge_change_subgraph", "arguments": { "change_id": "fix-token-race" } }

// 2. Lee la guía de navegación:
{ "tool": "forge_change_context", "arguments": { "change_id": "fix-token-race" } }

// 3. Si necesita un vecino específico (raro):
{ "tool": "forge_neighbors", "arguments": { "file_path": "src/token/ledger.ts" } }

// 4. Antes de commit, valida guardrails:
{ "tool": "forge_check" }
```

El agente trabaja **solo con el subgrafo congelado del change** — no carga el repo completo. El prompt cache de Claude amortiza ÷28× el costo en iteraciones 2+ del SDD.

### Caso C: cerrar el change (auto-rebuild)

**Tú le dices**:

> _"Archiva `fix-token-race`."_

**El agente, por debajo, llama UN SOLO TOOL**:

```jsonc
{
  "tool": "forge_archive_change",
  "arguments": { "change_id": "fix-token-race" }
}
```

Que internamente ejecuta:

1. `openspec archive fix-token-race -y` → mueve a `openspec/specs/`
2. `forge scan` → reindexa el repo
3. Rebuild `.contextforge/graph.json` (con cache: solo lo que cambió)
4. **Refresh de todos los `graph.subset.json` de changes restantes** → ya no quedan stale

Devuelve un resumen al agente con `N nodes, M edges, X subgraphs refreshed`.

---

## 3. Mapping: lo que tú dices → lo que pasa por debajo

| Tú le dices al agente            | OpenSpec real (transparente) | MCP / `forge` que dispara                                                                   |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| "Inicializa el repo"             | `openspec init`              | `forge init` (envuelve openspec init + scan + graph + skills + context-pack + viz)          |
| "Empieza el change X"            | (no, lo abre el agente)      | `forge_context` + `forge spec X`                                                            |
| "Implementa el change X"         | `openspec validate X` (gate) | `forge_change_subgraph` + `forge_change_context` + `forge_neighbors` (raro) + `forge_check` |
| "Refresca el grafo del change X" | (n/a)                        | `forge spec X --refresh-subgraph` (no toca proposal/design/tasks)                           |
| "Archiva el change X"            | `openspec archive X -y`      | **`forge_archive_change`** (1 call → archive + rebuild padre + refresh todos los subgrafos) |
| "¿Qué changes hay activos?"      | `openspec list`              | `forge_status` (también lista changes con subgrafo + comando MCP literal a copiar)          |

---

## 4. Los 10 tools MCP — qué hace cada uno

| Tool                        | Cuándo                             | Devuelve                                                              |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `forge_status`              | Inicio de sesión                   | Frescura de artefactos + lista de changes con subgrafo                |
| `forge_context`             | Tarea nueva, sin change abierto    | Context-pack ranked por PageRank con budget de tokens                 |
| `forge_neighbors`           | Vecindario de un archivo concreto  | Imports / imported-by / symbols / tests                               |
| `forge_domain_map`          | Vista de alto nivel del repo       | Dominios + dependencias cruzadas                                      |
| `forge_check`               | Antes de commit                    | Validación de guardrails (allowedFiles, maxLocDelta)                  |
| **`forge_change_subgraph`** | Trabajando en un change (PRIMARIO) | Subgrafo congelado del change                                         |
| `forge_change_context`      | Trabajando en un change            | `context.md` (mapa de lectura)                                        |
| **`forge_archive_change`**  | Cerrar un change (PRIMARIO)        | `openspec archive` + auto-rebuild padre + refresh todos los subgrafos |
| `select_agent_context`      | Runtime, sin escribir disco        | Manifest en memoria por tarea                                         |
| `get_agent_manifest`        | Offline                            | Lee `.contextforge/agent-manifest.json` precomputado                  |

---

## 5. Comandos `forge` directos (solo para troubleshooting)

> Tu agente ya hace esto vía MCP. Solo úsalos si el agente falla, quieres verificar manualmente, o estás en un terminal sin agente.

### Pipeline base

```bash
pnpm forge scan && pnpm forge graph                          # base
pnpm forge graph --force                                     # rebuild ignorando cache
pnpm forge graph --with-calls --with-refs                    # más aristas semánticas (opt-in)
pnpm forge graph --export=dot > graph.dot                    # Graphviz
pnpm forge graph --export=graphml > graph.graphml            # Gephi
```

### Sobre un change concreto

```bash
pnpm forge spec mi-feature                                   # primera vez (proposal/design/tasks/specs + subgrafo + html + context.md)
pnpm forge spec mi-feature --refresh-subgraph                # solo refresca subgrafo, no toca proposal/design
pnpm forge spec mi-feature --subgraph-full                   # subgrafo completo (debugging, default es "compact")
pnpm forge spec mi-feature --no-openspec                     # forzar fallback (sin openspec CLI)
```

### Sincronizar tras cambios externos al código

```bash
pnpm forge sync --since main                                 # delta vs main (qué dominios tocó)
pnpm forge sync --rebuild                                    # rebuild padre
pnpm forge sync --rebuild --refresh-subgraphs                # rebuild padre + refresca todos los subgrafos activos
```

### Visualización y salud

```bash
pnpm forge viz                                               # genera .contextforge/graph.html
pnpm forge impact                                            # health check de artefactos + cobertura
pnpm forge implement --check                                 # valida git diff vs guardrails (gate pre-commit)
```

### LLM enrich (opt-in, requiere `ANTHROPIC_API_KEY`)

```bash
ANTHROPIC_API_KEY=sk-... pnpm forge graph --enrich           # añade summary/tags/complexity a símbolos exportados
```

---

## 6. Verificar que tienes la versión actual (0.3.10)

```bash
npm view @anai-raia-alex/contextforge-cli version            # 0.3.10
npm view @anai-raia-alex/contextforge-core version           # 0.3.10
npm view @anai-raia-alex/contextforge-mcp version            # 0.3.10
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

Si tienes una versión vieja:

```bash
pnpm add -g @anai-raia-alex/contextforge-cli@latest
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

---

## 7. Si algo se rompe — recovery

| Problema                                                                             | Comando                                                                                |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| El grafo padre quedó stale (alguien corrió `openspec archive` directo bypassing MCP) | `pnpm forge sync --rebuild --refresh-subgraphs`                                        |
| El subgrafo de un change está stale tras editar el grafo padre                       | `pnpm forge spec <change-id> --refresh-subgraph`                                       |
| Un change se quedó sin `graph.subset.json` (creado antes de v0.3.7)                  | `pnpm forge context "<la tarea>"; pnpm forge spec <id>`                                |
| Cache del grafo está corrupto (raro)                                                 | `rm .contextforge/graph.cache.json && pnpm forge graph --force`                        |
| Skills en `.claude/skills/` desincronizadas                                          | `pnpm forge skills --force`                                                            |
| MCP server no responde                                                               | `docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest` y reinicia el agente |

---

## TL;DR — la tabla más corta posible

| Tú dices          | Comando OpenSpec (transparente)        | Lo que ContextForge hace por debajo (vía MCP)                                      |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| "Setup"           | `openspec init`                        | `forge init` (envuelve)                                                            |
| "Abre proposal X" | (lo abre el agente, no tú)             | `forge spec X` → escribe el change con subgrafo + viewer + context.md              |
| "Implementa X"    | `openspec validate X` antes del commit | `forge_change_subgraph` + `forge_check`                                            |
| "Cierra X"        | (lo hace el agente, no tú)             | **`forge_archive_change`** → archive + rebuild padre + refresh todos los subgrafos |

**El truco**: la skill `.claude/skills/contextforge-openspec-change.md` y las descriptions reforzadas de los MCP tools le dicen al agente que **siempre** prefiera el subgrafo del change y que **nunca** corra `openspec archive` directo. Por eso "todo se hace con OpenSpec" desde tu perspectiva, pero ContextForge actúa por debajo automáticamente.

---

## Lecturas relacionadas

- [`docs/explanation/contextforge-and-openspec.md`](../explanation/contextforge-and-openspec.md) — los 3 roles (CF / OpenSpec / agente IA)
- [`docs/integrations/claude-code-hook.md`](../integrations/claude-code-hook.md) — hook `UserPromptSubmit` para inyectar manifest live
- [`docs/integrations/cursor-rules.md`](../integrations/cursor-rules.md) — los 3 modos de rules en Cursor
- [`docs/integrations/opencode-mcp.md`](../integrations/opencode-mcp.md) — wiring detallado de OpenCode con MCP
- [`docs/token-savings-architecture.md`](../token-savings-architecture.md) — análisis de ahorro de tokens por capas
- [`CHANGELOG.md`](../../CHANGELOG.md) — historial completo, especialmente v0.3.7 a v0.3.10
