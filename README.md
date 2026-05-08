# ContextForge

Token-efficient CLI que convierte cualquier repositorio en un índice consultable de conocimiento. Produce artefactos JSON validados — grafo de dependencias, paquete de contexto, spec OpenSpec, plan de implementación — listos para ser consumidos por cualquier agente de IA (Claude Code, OpenCode, Cursor, Codex).

**Ahorro verificado:** 94.4 % de tokens vs. carga completa del repo (`full_repo_dump`) · ratio de compresión 17.9×.

---

## Instalación

**Desde npmjs.com** (público, sin token):

```bash
# CLI (uso diario)
pnpm add -g @anai-raia-alex/contextforge-cli         # global
# o
pnpm add -D @anai-raia-alex/contextforge-cli         # por proyecto

# MCP server (para agentes que lo invoquen via Node)
pnpm add -D @anai-raia-alex/contextforge-mcp
```

**Imagen Docker del MCP server** (público, sin token):

```bash
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

**Desde fuente** (desarrollo en este repo):

```bash
# Requisitos: Node.js >= 22, pnpm
git clone https://github.com/alejandro-cedeno-10/contextforge-cli.git
cd contextforge-cli
pnpm install
pnpm build
```

---

## Uso rápido

```bash
# 1. Inicializar (una sola vez)
pnpm forge init

# 2. Indexar el repositorio
pnpm forge scan

# 3. Construir el grafo de dependencias
pnpm forge graph

# 4. Seleccionar contexto para una tarea
pnpm forge context "fix authentication bug"

# 5. Generar spec OpenSpec con evidencia del grafo
pnpm forge spec fix-auth-bug

# 6. Generar plan de implementación con guardrails
pnpm forge implement fix-auth-bug

# 7. Validar cambios post-edición
pnpm forge implement --check

# 8. Visualizar el grafo (abre graph.html)
pnpm forge viz

# 9. Scaffold de documentación Diátaxis
pnpm forge docs

# 10. Auto-generar skills por dominio para Claude Code
pnpm forge skills

# 11. Generar agent-manifest (skills/rules relevantes a la tarea actual)
#     Nota: forge context ya lo genera automáticamente. Este comando lo regenera
#     a partir del context-pack actual sin re-rankear archivos.
pnpm forge manifest
```

---

## Comandos

| Comando                                             | Descripción                                                                                                                | LLM requerido |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `forge init`                                        | Inicializa `.contextforge/` con directorios y plantillas                                                                   | No            |
| `forge scan`                                        | Indexa archivos con hashes BLAKE3, detecta lenguaje y tipo                                                                 | No            |
| `forge graph`                                       | Construye grafo de dependencias (nodos file/symbol, 5 edge types)                                                          | No            |
| `forge context "<tarea>" [--no-manifest] [--force]` | Selecciona archivos relevantes via PageRank + BFS + presupuesto · genera agent-manifest auto (opt-out con `--no-manifest`) | No            |
| `forge spec <id>`                                   | Genera spec en formato OpenSpec (`changes/<id>/`) con evidencia del grafo                                                  | No            |
| `forge implement <id>`                              | Produce plan con guardrails derivados del context-pack                                                                     | No            |
| `forge implement --check`                           | Valida cambios del agente contra guardrails                                                                                | No            |
| `forge viz`                                         | Genera visualización HTML interactiva del grafo                                                                            | No            |
| `forge docs [--force]`                              | Scaffold de documentación Diátaxis (tutorials/how-to/reference/explanation/adr/architecture)                               | No            |
| `forge skills [--force]`                            | Auto-genera skills por dominio en `.claude/skills/ctx-*.md` para auto-loading en Claude Code                               | No            |
| `forge manifest [--agents=...] [--force]`           | Selecciona skills/rules relevantes a la tarea + emite renderers Claude/Cursor/OpenCode                                     | No            |
| `forge sync [--since X] [--rebuild]`                | Reporta delta desde un ref de git (por defecto `HEAD~1`) y dominios afectados                                              | No            |
| `forge impact`                                      | Health check de artifacts + cobertura de skills por dominio                                                                | No            |

---

## Artefactos generados

Todos los JSON son validados con JSON Schema 2020-12 antes de escribirse.

```
.contextforge/
  scan.json                  # archivos indexados con hashes BLAKE3
  graph.json                 # nodos (file + symbol) y edges tipados
  context-pack.json          # archivos seleccionados dentro del presupuesto
  token-ledger.json          # métricas de ahorro de tokens vs baseline
  implement-plan.json        # guardrails: allowedFiles, maxLocDelta, etc.
  agent-manifest.json        # skills/rules relevantes a la tarea (neutral)
  graph.html                 # visualización interactiva (Cytoscape.js)
  manifests/opencode-readme.md  # instrucciones MCP para OpenCode

.claude/agent-manifest.md           # manifest renderer Claude Code
.cursor/rules/contextforge-active.mdc  # rule auto-attached por dominios tocados

openspec/changes/<id>/
  proposal.md          # intent, scope, por qué
  design.md            # enfoque técnico con archivos del grafo
  tasks.md             # checklist de implementación numerado
  specs/<domain>/spec.md  # delta spec: ADDED / MODIFIED / REMOVED requirements
```

Resultado real en este repo (medido sobre el commit actual): **128 archivos → 50 seleccionados → 11 988 tokens** (ahorro 94.4 %, ratio 17.9×). Grafo: 368 nodos, 267 edges.

### Schemas

| Artefacto             | Schema                                    |
| --------------------- | ----------------------------------------- |
| `scan.json`           | `docs/schemas/scan.schema.json`           |
| `graph.json`          | `docs/schemas/graph.schema.json`          |
| `context-pack.json`   | `docs/schemas/context-pack.schema.json`   |
| `implement-plan.json` | `docs/schemas/implement-plan.schema.json` |
| `token-ledger.json`   | `docs/schemas/token-ledger.schema.json`   |
| `agent-manifest.json` | `docs/schemas/agent-manifest.schema.json` |

---

## Arquitectura de ahorro de tokens

El ahorro ocurre en dos capas acumulativas:

```
CAPA 1 — Preparación (una vez, 0 tokens):
  forge scan    → indexa archivos + hashes BLAKE3
  forge graph   → grafo de dependencias (determinista, sin LLM)
  forge context → PageRank + BFS + presupuesto

CAPA 2 — Context pack (por sesión del agente):
  Sin ContextForge:  ~214 600 tokens  →  ~$0.64/sesión (Claude Sonnet 4.6)
  Con context-pack:  ~11 988 tokens   →  ~$0.036/sesión (94.4 % ahorro, 17.9× compresión)
```

Ver `docs/token-savings-architecture.md` para análisis completo con tabla de costos por modelo.

---

## Spec OpenSpec (`forge spec`)

`forge spec <id>` siempre emite en formato **OpenSpec** — estructura de cambios accionable y compatible con el estándar:

```
openspec/changes/fix-auth-bug/
  proposal.md              # contexto y motivación del cambio
  design.md                # decisiones técnicas respaldadas por el grafo
  tasks.md                 # tareas numeradas T1, T1.1, T2...
  specs/auth/spec.md       # delta spec con secciones:
                           #   ## ADDED Requirements
                           #   ## MODIFIED Requirements
                           #   ## REMOVED Requirements
```

Cada requirement usa formato **Given/When/Then + RFC 2119** (MUST/SHALL/SHOULD/MAY).
Los archivos referenciados en `design.md` y `tasks.md` vienen directamente del `context-pack` — evidencia trazable del grafo.

---

## Documentación Diátaxis (`forge docs`)

`forge docs` genera la estructura [Diátaxis](https://diataxis.fr/) lista para usar:

```bash
pnpm forge docs            # Crea folders + INDEX.md (no sobrescribe)
pnpm forge docs --force    # Sobrescribe archivos existentes
```

**Estructura generada:**

```
docs/
  INDEX.md                          # Punto de entrada con tabla de navegación
  tutorials/                        # Aprender paso a paso
  how-to/                           # Recetas para tareas concretas
  reference/                        # Datos exactos (OpenAPI, env vars)
  explanation/                      # Por qué del diseño
  adr/README.md                     # Plantilla MADR para decisiones
  architecture/module-relationships.md  # Auto desde .contextforge/graph.json
```

**Convenciones de frontmatter** (cada doc nuevo):

```yaml
---
title: "Título conciso"
description: "Una línea — el agente decide si leer el resto sin gastar tokens"
audience: both | dev | ops
type: tutorial | how-to | reference | explanation | architecture
tags: [tag1, tag2]
updated: YYYY-MM-DD
---
```

`architecture/module-relationships.md` se deriva automáticamente del grafo: lista dominios + dependencias cruzadas. Sin LLM.

---

## Skills por dominio (`forge skills`)

`forge skills` auto-genera un skill por dominio del grafo en `.claude/skills/ctx-<domain>.md`. Cada skill describe los archivos clave, dependencias cruzadas y tests del dominio, con frontmatter (`name`, `description`, `tags`) preparado para que Claude Code lo auto-cargue cuando el dev abre archivos de ese dominio.

```bash
pnpm forge skills            # Genera skills sin sobrescribir existentes
pnpm forge skills --force    # Regenera todos los skills desde cero
```

**Características:**

- **Determinista**: deriva de `.contextforge/graph.json`. Sin LLM, sin red, byte-for-byte estable entre runs.
- **Token-efficient**: cada skill ≤ 50 líneas (~300-500 tokens).
- **Scope claro**: orden de archivos por degree (in + out edges); cross-domain deps en secciones `Depends on` / `Used by`.
- **Coexiste con skills task-oriented** (`contextforge-*.md` curados manualmente): los generados usan el prefijo `ctx-*`.
- **Slug**: `packages/core` → `ctx-packages-core.md`, `src` → `ctx-src.md`. Dominios con < 2 archivos se omiten y se reportan en el output.

```yaml
---
name: ctx-packages-core
description: Domain context for packages/core — 18 files, 13 tests, used by 1
tags: [packages/core, domain-skill]
---
```

---

## Agent manifest por tarea (`forge manifest`)

`forge context "<tarea>"` ya emite **automáticamente** un agent-manifest derivado del context-pack. El manifest declara qué skills y rules son relevantes para esa tarea, computado de forma determinista a partir de los dominios tocados.

```bash
pnpm forge context "fix race en tokenLedger"
# → .contextforge/context-pack.json
# → .contextforge/agent-manifest.json    (neutral, validado contra schema)
# → .claude/agent-manifest.md            (Claude Code)
# → .cursor/rules/contextforge-active.mdc  (Cursor Auto Attached)
# → .contextforge/manifests/opencode-readme.md  (OpenCode MCP)

pnpm forge manifest --force                       # regenera sin re-rankear
pnpm forge manifest --agents=cursor               # solo Cursor
pnpm forge context "..." --no-manifest            # opt-out
```

**Cómo se activa por sesión** (sin pasos manuales):

- **Claude Code**: hook `UserPromptSubmit` (ver `docs/integrations/claude-code-hook.md`) inyecta el manifest en el contexto de cada prompt.
- **OpenCode**: el agente llama `select_agent_context({ task })` como primera tool MCP — manifest computado live, sin tocar disco.
- **Cursor**: `.cursor/rules/contextforge-active.mdc` se activa automáticamente cuando abres un archivo de los dominios tocados (Auto Attached).

**Reglas de matching** (priorizadas):

1. `alwaysApply: true` → siempre incluida.
2. `domains: [...]` (frontmatter) ∩ dominios tocados → `matchType: domain`.
3. Skill llamada `ctx-<slug>` cuyo slug deslugificado matchea un dominio tocado → `matchType: explicit` (retrocompatible con `forge skills`).
4. Sin match → cae en `skipped` con razón.

Frontmatter mal formado nunca crashea: el archivo cae en `skipped` con `frontmatter parse error`.

---

## Grafo interactivo (`forge viz`)

`forge viz` genera `.contextforge/graph.html` — abre en cualquier navegador, sin servidor.

**Vistas:**

- **Grafo**: red completa file + symbol con layout cola
- **Dominios**: agrupación por paquete con layout topológico horizontal (Kahn)

**Features:**

- Click en nodo → resumen en lenguaje natural (define N símbolos, importado por M archivos…)
- Tour guiado por los archivos del context-pack (prev/next con auto-zoom + highlight de vecindad)
- Nodos del context-pack resaltados en naranja
- Búsqueda de nodo por nombre

---

## Algoritmo de selección de contexto

```
1. resolve_seeds(task)       → identifica archivos/símbolos semilla
2. personalized_pagerank()   → ranking de relevancia (alpha=0.85, 50 iter.)
3. bfs_expand(depth=2)       → captura dependencias directas + transitivas
4. score_nodes()             → pagerank × (1 / bfs_dist) × edge_multiplier
5. greedy_pack(budget=12000) → full → excerpt → summary por score desc.
6. emit(context-pack + token-ledger)
```

Edge multipliers: `tests=1.2 · defines=1.0 · calls=1.0 · imports=0.8 · references=0.6`

---

## Estructura del monorepo

```
packages/
  core/   → scanner, parser tree-sitter, graph builder, selector PageRank,
            packer, schema validator, skill builder, agent-manifest builder + renderers
  cli/    → comandos forge, orquestación del pipeline (cmdContext, cmdManifest...)
  mcp/    → servidor MCP con 7 tools para agentes

.claude/skills/    → 3 skills task-oriented (contextforge-*) +
                     N skills auto-generadas por dominio (ctx-*) +
                     agent-manifest.md (per-task)
.cursor/rules/     → contextforge.mdc (alwaysApply) +
                     contextforge-active.mdc (Auto Attached, regenerada por tarea)
opencode.json      → configuración MCP para OpenCode
docs/integrations/ → guías de wiring por agente (claude-code-hook, cursor-rules, opencode-mcp)
```

---

## Tests

```bash
pnpm test               # todos los tests
pnpm test --coverage    # con cobertura
```

Suite actual: **202/202 tests pasando** (20 archivos), coverage global ≥ 80 % · módulo `manifest/` ≥ 95 %.

Áreas cubiertas: scanner · graph builder · selector PageRank · packer · schema validator · spec render · OpenSpec · treeSitter parser · scanCache · implementValidator · MCP handlers · skill builder · agent manifest + 3 renderers · CLI type-surface anti-regression.

---

## Principios

- **Determinismo primero**: `forge scan` y `forge graph` nunca llaman a ningún LLM.
- **OpenSpec por defecto**: `forge spec` siempre emite estructura compatible con el estándar OpenSpec.
- **Cache por hash**: si `scan.json` no cambió, `forge graph` salta el rebuild.
- **Presupuesto explícito**: cada context-pack tiene `maxInputTokens` trazable en `token-ledger.json`.
- **JSON validado**: ningún artefacto se escribe sin pasar JSON Schema.
- **Portable**: cualquier agente puede consumir `.contextforge/*.json` sin modificación.

---

## Integración con agentes de IA

| Agente            | Configuración                                                                                          | Selección por tarea                               | Estado        |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------- |
| **Claude Code**   | `.claude/skills/` (3 task-oriented + N auto-generadas) · hook `UserPromptSubmit` (ver docs)            | ✅ Hook inyecta manifest live + JSON precomputado | ✅ Listo      |
| **Cursor**        | `.cursor/rules/contextforge.mdc` (alwaysApply) + `contextforge-active.mdc` (Auto Attached por dominio) | ⚠️ Limitada (sin hooks reactivos al prompt)       | ✅ Listo      |
| **OpenCode**      | `opencode.json` con MCP server registrado                                                              | ✅ Tool MCP `select_agent_context({task})` live   | ✅ Listo      |
| **Codex / otros** | Leen `.contextforge/*.json` directamente                                                               | Lectura directa de `agent-manifest.json`          | ✅ Compatible |

Los artefactos JSON en `.contextforge/` son portables — cualquier agente los puede consumir sin modificación. Ver `docs/integrations/` para guías de wiring por agente.

---

## Servidor MCP

`packages/mcp` expone **7 tools** consumibles por cualquier cliente MCP (Claude Code, OpenCode, etc.).

**Distribución:** dos canales oficiales.

| Canal                                  | Identificador                                                                    | Cuándo usar                                     |
| -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| **GitHub Container Registry** (Docker) | `ghcr.io/alejandro-cedeno-10/contextforge-mcp:v0.2.4` (multi-arch amd64 + arm64) | No quieres instalar Node — solo Docker          |
| **npmjs.com** (npm)                    | `@anai-raia-alex/contextforge-mcp@0.2.4`                                         | Tienes Node 22+ y prefieres binarios sin Docker |

```jsonc
// Opción A — Docker (sin Node)
{
  "mcpServers": {
    "contextforge": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-v", "${PWD}:/project",
        "-e", "PROJECT_ROOT=/project",
        "ghcr.io/alejandro-cedeno-10/contextforge-mcp:v0.2.4"
      ]
    }
  }
}

// Opción B — npm
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

| Tool                   | Propósito                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `forge_status`         | Estado de los artefactos (frescura, conteos, savings)                                     |
| `forge_domain_map`     | Mapa de dominios + dependencias cruzadas                                                  |
| `forge_neighbors`      | Vecinos directos de un archivo en el grafo                                                |
| `forge_context`        | Selección PageRank para una tarea (con o sin contenido)                                   |
| `forge_check`          | Valida git diff contra guardrails del implement-plan                                      |
| `select_agent_context` | **Runtime**: computa agent-manifest en memoria para una tarea (cache mtime de scan/graph) |
| `get_agent_manifest`   | **Offline**: lee `.contextforge/agent-manifest.json` precomputado                         |

---

## Documentación

| Documento                               | Descripción                                                           |
| --------------------------------------- | --------------------------------------------------------------------- |
| `docs/token-savings-architecture.md`    | Análisis de ahorro de tokens por capas con tabla de costos            |
| `docs/EXAMPLES/end-to-end-flow.md`      | Walkthrough completo del pipeline con outputs reales                  |
| `docs/IMPLEMENTATION_TASKS.md`          | Backlog de sprints con criterios verificables                         |
| `docs/CHANGELOG-schemas.md`             | Historial de cambios de schemas                                       |
| `docs/integrations/claude-code-hook.md` | Snippet copy-paste para activar manifest en runtime en Claude Code    |
| `docs/integrations/cursor-rules.md`     | Los 3 modos de rules en Cursor + estrategia recomendada               |
| `docs/integrations/opencode-mcp.md`     | Ejemplo de `select_agent_context` desde OpenCode                      |
| `openspec/changes/agent-manifest/`      | Spec OpenSpec del feature agent-manifest (proposal/design/tasks/spec) |
| `CONTEXTFORGE_SOURCE_OF_TRUTH.md`       | Decisiones de diseño, arquitectura, roadmap y análisis competitivo    |

---

## Licencia

MIT
