# ContextForge

Token-efficient CLI que convierte cualquier repositorio en un índice consultable de conocimiento. Produce artefactos JSON validados — grafo de dependencias, paquete de contexto, spec OpenSpec, plan de implementación — listos para ser consumidos por cualquier agente de IA (Claude Code, OpenCode, Cursor, Codex).

**Ahorro verificado:** 90 % de tokens vs. carga completa del repo (`full_repo_dump`).

---

## Instalación

```bash
# Requisitos: Node.js >= 22, pnpm
git clone <repo>
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
```

---

## Comandos

| Comando                              | Descripción                                                                                  | LLM requerido |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------- |
| `forge init`                         | Inicializa `.contextforge/` con directorios y plantillas                                     | No            |
| `forge scan`                         | Indexa archivos con hashes BLAKE3, detecta lenguaje y tipo                                   | No            |
| `forge graph`                        | Construye grafo de dependencias (nodos file/symbol, 5 edge types)                            | No            |
| `forge context "<tarea>"`            | Selecciona archivos relevantes via PageRank + BFS + presupuesto                              | No            |
| `forge spec <id>`                    | Genera spec en formato OpenSpec (`changes/<id>/`) con evidencia del grafo                    | No            |
| `forge implement <id>`               | Produce plan con guardrails derivados del context-pack                                       | No            |
| `forge implement --check`            | Valida cambios del agente contra guardrails                                                  | No            |
| `forge viz`                          | Genera visualización HTML interactiva del grafo                                              | No            |
| `forge docs [--force]`               | Scaffold de documentación Diátaxis (tutorials/how-to/reference/explanation/adr/architecture) | No            |
| `forge sync [--since X] [--rebuild]` | Reporta delta desde un ref de git (por defecto `HEAD~1`) y dominios afectados                | No            |
| `forge impact`                       | Health check de artifacts + cobertura de skills por dominio                                  | No            |

---

## Artefactos generados

Todos los JSON son validados con JSON Schema 2020-12 antes de escribirse.

```
.contextforge/
  scan.json            # archivos indexados con hashes BLAKE3
  graph.json           # nodos (file + symbol) y edges tipados
  context-pack.json    # archivos seleccionados dentro del presupuesto
  token-ledger.json    # métricas de ahorro de tokens vs baseline
  implement-plan.json  # guardrails: allowedFiles, maxLocDelta, etc.
  graph.html           # visualización interactiva (Cytoscape.js)

openspec/changes/<id>/
  proposal.md          # intent, scope, por qué
  design.md            # enfoque técnico con archivos del grafo
  tasks.md             # checklist de implementación numerado
  specs/<domain>/spec.md  # delta spec: ADDED / MODIFIED / REMOVED requirements
```

Resultado real en este repo: 70 archivos → 30 seleccionados → 11 700 tokens (ahorro 90.3 %).

### Schemas

| Artefacto             | Schema                                    |
| --------------------- | ----------------------------------------- |
| `scan.json`           | `docs/schemas/scan.schema.json`           |
| `graph.json`          | `docs/schemas/graph.schema.json`          |
| `context-pack.json`   | `docs/schemas/context-pack.schema.json`   |
| `implement-plan.json` | `docs/schemas/implement-plan.schema.json` |
| `token-ledger.json`   | `docs/schemas/token-ledger.schema.json`   |

---

## Arquitectura de ahorro de tokens

El ahorro ocurre en dos capas acumulativas:

```
CAPA 1 — Preparación (una vez, 0 tokens):
  forge scan    → indexa archivos + hashes BLAKE3
  forge graph   → grafo de dependencias (determinista, sin LLM)
  forge context → PageRank + BFS + presupuesto

CAPA 2 — Context pack (por sesión del agente):
  Sin ContextForge:  ~121 000 tokens  →  ~$0.36/sesión
  Con context-pack:  ~11 700 tokens   →  ~$0.035/sesión  (90% ahorro)
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
  core/         → scanner, parser tree-sitter, graph builder,
                  selector PageRank, packer, schema validator
  cli/          → comandos forge, orquestación del pipeline
  mcp/          → servidor MCP con 5 tools para agentes
  integrations/ → adaptadores (OpenCode como referencia)

.claude/skills/    → 3 skills concisas para Claude Code
.cursor/rules/     → reglas para que Cursor use los artifacts
opencode.json      → configuración MCP para OpenCode
```

---

## Tests

```bash
pnpm test               # todos los tests
pnpm test --coverage    # con cobertura
```

Suite actual: **120/120 tests pasando**, coverage ≥ 80 % en todas las métricas.

Áreas cubiertas: scanner · graph builder · selector PageRank · packer · schema validator · spec render · OpenSpec · treeSitter parser · scanCache · implementValidator · MCP handlers.

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

| Agente            | Configuración                                          | Estado        |
| ----------------- | ------------------------------------------------------ | ------------- |
| **Claude Code**   | `.claude/skills/contextforge-*.md` (3 skills concisas) | ✅ Listo      |
| **Cursor**        | `.cursor/rules/contextforge.mdc` (alwaysApply)         | ✅ Listo      |
| **OpenCode**      | `opencode.json` con MCP server registrado              | ✅ Listo      |
| **Codex / otros** | Leen `.contextforge/*.json` directamente               | ✅ Compatible |

Los artefactos JSON en `.contextforge/` son portables — cualquier agente los puede consumir sin modificación.

---

## Próximamente

**MCP Server** — queries quirúrgicas al grafo durante la implementación (97 % de ahorro adicional):

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "npx",
      "args": ["@alejandro-cedeno-10/contextforge-mcp"],
      "env": { "PROJECT_ROOT": "." }
    }
  }
}
```

Tools: `forge_status` · `forge_domain_map` · `forge_neighbors` · `forge_context` · `forge_check`

---

## Documentación

| Documento                            | Descripción                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| `docs/token-savings-architecture.md` | Análisis de ahorro de tokens por capas con tabla de costos         |
| `docs/EXAMPLES/end-to-end-flow.md`   | Walkthrough completo del pipeline con outputs reales               |
| `docs/IMPLEMENTATION_TASKS.md`       | Backlog de sprints con criterios verificables                      |
| `docs/CHANGELOG-schemas.md`          | Historial de cambios de schemas                                    |
| `CONTEXTFORGE_SOURCE_OF_TRUTH.md`    | Decisiones de diseño, arquitectura, roadmap y análisis competitivo |

---

## Licencia

MIT
