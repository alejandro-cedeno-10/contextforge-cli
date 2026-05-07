# ContextForge

Token-efficient CLI que convierte cualquier repositorio en un índice consultable de conocimiento. Produce artefactos JSON validados — grafo de dependencias, paquete de contexto, spec SDD, plan de implementación — listos para ser consumidos por cualquier agente de IA (Claude Code, OpenCode, Cursor, Codex).

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

# 5. Generar spec SDD
pnpm forge spec fix-auth-bug

# 6. Generar plan de implementación con guardrails
pnpm forge implement fix-auth-bug

# 7. Validar cambios post-edición
pnpm forge implement --check

# 8. Visualizar el grafo (abre graph.html)
pnpm forge viz
```

---

## Comandos

| Comando | Descripción | LLM requerido |
|---|---|---|
| `forge init` | Inicializa `.contextforge/` con directorios y plantillas | No |
| `forge scan` | Indexa archivos con hashes BLAKE3, detecta lenguaje y tipo | No |
| `forge graph` | Construye grafo de dependencias (nodos file/symbol, 5 edge types) | No |
| `forge context "<tarea>"` | Selecciona archivos relevantes via PageRank + BFS + presupuesto | No |
| `forge spec <id>` | Genera spec SDD con evidencia del grafo | Opcional |
| `forge spec <id> --emit openspec` | Genera estructura OpenSpec (`changes/<id>/`) | Opcional |
| `forge implement <id>` | Produce plan con guardrails derivados del context-pack | No |
| `forge implement --check` | Valida cambios del agente contra guardrails | No |
| `forge viz` | Genera visualización HTML interactiva del grafo | No |

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
```

Resultado real en este repo: 70 archivos → 30 seleccionados → 11 700 tokens (ahorro 90.3 %).

### Schemas

| Artefacto | Schema |
|---|---|
| `scan.json` | `docs/schemas/scan.schema.json` |
| `graph.json` | `docs/schemas/graph.schema.json` |
| `context-pack.json` | `docs/schemas/context-pack.schema.json` |
| `implement-plan.json` | `docs/schemas/implement-plan.schema.json` |
| `token-ledger.json` | `docs/schemas/token-ledger.schema.json` |

---

## Arquitectura de ahorro de tokens

El ahorro ocurre en tres capas acumulativas:

```
CAPA 1 — Preparación (una vez, 0 tokens):
  forge scan    → indexa archivos + hashes BLAKE3
  forge graph   → grafo de dependencias (determinista, sin LLM)
  forge context → PageRank + BFS + presupuesto

CAPA 2 — Context pack (por sesión del agente):
  Sin ContextForge:  ~121 000 tokens  →  ~$0.36/sesión
  Con context-pack:  ~11 700 tokens   →  ~$0.035/sesión  (90% ahorro)

CAPA 3 — MCP on-demand (por query durante implementación):
  forge_context("tarea"):  ~2 000–4 000 tokens  →  ~$0.01/sesión  (97% ahorro)
```

Ver `docs/token-savings-architecture.md` para análisis completo con tabla de costos por modelo.

---

## MCP Server

El servidor MCP permite que los agentes consulten el grafo de forma quirúrgica durante la implementación, en lugar de cargar el contexto completo al inicio de la sesión.

### Configuración (`opencode.json` / `claude.json`)

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

El archivo `opencode.json` ya está configurado en este repo.

### Tools disponibles

| Tool | Descripción | Tokens aprox. |
|---|---|---|
| `forge_status` | Estado de artifacts en `.contextforge/` | ~400 |
| `forge_domain_map` | Mapa de dominios con dependencias cruzadas | ~600 |
| `forge_neighbors` | Vecinos BFS de un archivo (imports/tests/defines) | ~300 |
| `forge_context` | Archivos relevantes para una tarea (PageRank) | ~2 000 |
| `forge_check` | Valida guardrails contra `git diff HEAD` | ~200 |

### Compilar el servidor MCP

```bash
pnpm --filter @contextforge/mcp build
```

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
  agents/       → plantillas y skills compartidos (pendiente)
```

---

## Tests

```bash
pnpm test               # todos los tests
pnpm test --coverage    # con cobertura
```

Suite actual: **91/91 tests pasando**.

Áreas cubiertas: scanner · graph builder · selector PageRank · packer · schema validator · spec render · OpenSpec · treeSitter parser · scanCache · implementValidator.

---

## Principios

- **Determinismo primero**: `forge scan` y `forge graph` nunca llaman a ningún LLM.
- **Cache por hash**: si `scan.json` no cambió, `forge graph` salta el rebuild.
- **Presupuesto explícito**: cada context-pack tiene `maxInputTokens` trazable en `token-ledger.json`.
- **JSON validado**: ningún artefacto se escribe sin pasar JSON Schema.
- **Portable**: cualquier agente puede consumir `.contextforge/*.json` sin modificación.

---

## Documentación

| Documento | Descripción |
|---|---|
| `docs/token-savings-architecture.md` | Análisis de ahorro de tokens por capas con tabla de costos |
| `docs/EXAMPLES/end-to-end-flow.md` | Walkthrough completo del pipeline con outputs reales |
| `docs/IMPLEMENTATION_TASKS.md` | Backlog de sprints con criterios verificables |
| `docs/CHANGELOG-schemas.md` | Historial de cambios de schemas |
| `CONTEXTFORGE_SOURCE_OF_TRUTH.md` | Decisiones de diseño, arquitectura, roadmap y análisis competitivo |

---

## Licencia

MIT
