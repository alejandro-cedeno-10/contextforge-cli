# ContextForge

> Pipeline determinista que convierte cualquier repo en un índice consultable por agentes IA. **94.4 % menos tokens por sesión, 17.9× compresión, ÷28× costo SDD con prompt caching** — sin LLM en el pipeline, sin lock-in de agente.

```
214 600 tokens (todo el repo)  →  11 988 tokens (lo que importa a la tarea)
```

[![tests](https://img.shields.io/badge/tests-221%2F221-brightgreen)]() [![savings](https://img.shields.io/badge/tokens-94.4%25%20saved-brightgreen)]() [![npm](https://img.shields.io/badge/npm-%40anai--raia--alex%2Fcontextforge--cli-blue)](https://www.npmjs.com/package/@anai-raia-alex/contextforge-cli) [![docker](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/alejandro-cedeno-10/contextforge-cli/pkgs/container/contextforge-mcp)

---

## El problema en una frase

Cada vez que tu agente IA empieza una sesión, **carga todo el repo o lee a ciegas**. Y cuando le pides un PRD/spec, lo escribe sobre arena: cita archivos que no existen, repite trabajo, se inventa cross-references. Tres puntos de fricción:

1. **Contexto disperso** — el agente no sabe qué archivos importan a tu tarea.
2. **Specs desconectados del código** — escritos a mano se desactualizan; escritos por el agente se inventan referencias.
3. **Sin validación estructural** — cada PR tiene un spec con formato distinto.

ContextForge ataca los tres con tres capas determinísticas (cero LLM) **que se apoyan en OpenSpec, no lo reemplazan**.

---

## Instalación

**npm — público, sin token:**

```bash
# CLI (uso diario)
pnpm add -g @anai-raia-alex/contextforge-cli         # global
# o
pnpm add -D @anai-raia-alex/contextforge-cli         # por proyecto

# MCP server (para agentes vía Node)
pnpm add -D @anai-raia-alex/contextforge-mcp

# OpenSpec CLI (recomendado, activa el modo handoff)
npm i -g @fission-ai/openspec
```

**Docker — sin instalar Node, multi-arch (amd64+arm64):**

```bash
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

**Desde fuente (desarrollo):**

```bash
git clone https://github.com/alejandro-cedeno-10/contextforge-cli.git
cd contextforge-cli
pnpm install && pnpm build
```

---

## Quick start (5 comandos para empezar)

```bash
# 1. Inicializar (corre 'openspec init' si está en PATH; instala instrucciones del agente)
pnpm forge init

# 2. Indexar el repo (incremental; cache por hash)
pnpm forge scan
pnpm forge graph

# 3. Por cada tarea
pnpm forge context "fix race en tokenLedger writer"

# 4. SDD opcional (con OpenSpec)
pnpm forge spec mi-feature-id    # spec-input + handoff/fallback
openspec validate mi-feature-id

# 5. Implementar con guardrails
pnpm forge implement mi-feature-id
# (trabajas con el agente)
pnpm forge implement --check     # gate pre-commit
```

---

## Las tres capas

### Capa 1 — Grafos para ahorrar tokens

En lugar de "leer todo el repo", **rankeamos los archivos por relevancia** a tu tarea con el grafo de dependencias real del código + Personalized PageRank.

**Pipeline:**

```bash
pnpm forge scan       # Indexa con BLAKE3 (incremental)
pnpm forge graph      # Grafo file + symbol con tree-sitter
pnpm forge context "<tarea>"   # PageRank + BFS + budget
```

**Algoritmo:**

```
1. resolve_seeds(task)        → archivos semilla por keywords
2. personalized_pagerank()    → ranking de relevancia (alpha=0.85, 50 iter)
3. bfs_expand(depth=2)        → captura deps directas + transitivas
4. score_nodes()              → pagerank × (1/bfs_dist) × edge_multiplier
5. greedy_pack(budget=12000)  → llena hasta 12k tokens (full → excerpt → summary)
```

**Edge multipliers:** `tests=1.2 · defines=1.0 · calls=1.0 · imports=0.8 · references=0.6`

**Ahorro medido en este repo:**

| Sin ContextForge                    | Con context-pack          |
| ----------------------------------- | ------------------------- |
| 214 600 tokens                      | 11 988 tokens             |
| ~$0.64 / sesión (Claude Sonnet 4.6) | ~$0.036 / sesión          |
| 128 archivos enviados               | 50 archivos seleccionados |

**Compresión: 17.9× · Ahorro: 94.4 %**

### Capa 2 — SDD apoyando a OpenSpec (no compitiendo con él)

> v0.3.0+ — `forge spec` ya **no genera el spec final**. Genera la **entrada** (`spec-input.json` + `spec-prompt.md`) para que OpenSpec o un agente IA lo escriban con todo el contexto correcto.

**Tres roles separados, cada uno hace lo suyo:**

```
       ┌─────────────────────┐    ┌─────────────────────┐    ┌────────────────┐
       │   ContextForge      │    │     OpenSpec        │    │   Agente IA    │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
ROL    │  Selección de       │    │  Estructura +       │    │  Redacción     │
       │  contexto           │    │  validación         │    │                │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
TÉC.   │  PageRank + BFS +   │    │  Schemas RFC 2119   │    │  LLM           │
       │  budget tokens      │    │  Given/When/Then    │    │                │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
INPUT  │  scan + graph +     │    │  spec-input.json    │    │  spec-prompt.md│
       │  task               │    │                     │    │  + context-pack│
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
OUTPUT │  context-pack +     │    │  proposal/design/   │    │  .md llenos    │
       │  spec-input + prompt│    │  tasks/spec.md      │    │  + commits     │
       └─────────────────────┘    └─────────────────────┘    └────────────────┘
```

**Pipeline SDD completo:**

```bash
pnpm forge context "<tarea>"          # context-pack + agent-manifest
pnpm forge spec mi-feature-id         # spec-input + handoff/fallback
openspec list                          # ver changes activos
openspec validate mi-feature-id        # validación oficial
pnpm forge implement mi-feature-id     # plan con guardrails
# (trabajas con el agente)
pnpm forge implement --check           # gate pre-commit
openspec archive mi-feature-id -y      # al mergear: mueve a specs/
```

**Modo handoff vs modo fallback:**

| Modo                                              | Cuándo                          | Qué pasa                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Handoff** (default si OpenSpec CLI está)        | `openspec --version` resuelve   | `forge spec` ejecuta `openspec new change` + emite `.contextforge/spec-prompt.md` con instrucciones canónicas + contexto del grafo. El dev pega ese prompt en su agente |
| **Fallback** (sin OpenSpec CLI o `--no-openspec`) | CLI ausente, CI sin instalación | ContextForge emite el scaffold con **formato moderno** (`### Requirement:` + `#### Scenario:`). Cuando se instale el CLI después, `openspec validate` pasa sin retoque  |

Mismo contrato (`spec-input.json`), dos formas de consumirlo. Portable Mac/Linux/Windows.

**Forma de cada Requirement (RFC 2119 + Given/When/Then):**

```markdown
### Requirement: System produces fix-token-race within budget

The system MUST implement the change `fix-token-race` while respecting
`guardrails.allowedFiles` and not exceeding `guardrails.maxLocDelta`.

#### Scenario: change is implemented within scope

- **Given** a valid `.contextforge/context-pack.json` for the task
- **When** the developer runs `pnpm forge implement fix-token-race`
- **Then** `pnpm forge implement --check` exits with code 0
```

**Guardrails de implementación (derivados del grafo):**

`forge implement` produce `implement-plan.json` cuyos campos vienen del context-pack:

- `allowedFiles[]` ← exactamente los archivos del pack
- `forbiddenPaths[]` — nunca tocar
- `maxLocDelta` — derivado del tamaño del pack
- `maxFilesChanged` — `allowedFiles.length + 2`

`forge implement --check` valida tu `git diff` antes del commit. Si te saliste del scope, te lo dice exactamente y el commit no pasa.

### Capa 3 — Solo cargar las skills/rules que aplican a la tarea

`forge context` ya emite **5 artefactos sin paso extra**:

```
.contextforge/context-pack.json              ← archivos relevantes
.contextforge/token-ledger.json              ← métricas
.contextforge/agent-manifest.json            ← NEUTRAL (validado por schema)
.claude/agent-manifest.md                    ← renderer Claude Code
.cursor/rules/contextforge-active.mdc        ← renderer Cursor (Auto-Attached)
.contextforge/manifests/opencode-readme.md   ← renderer OpenCode
```

**Reglas de matching (priorizadas):**

1. `alwaysApply: true` → siempre incluida.
2. frontmatter `domains: [..]` ∩ dominios tocados → match domain.
3. nombre `ctx-<slug>` del dominio tocado → match explicit (retrocompatible con `forge skills`).
4. nada matchea → skipped (con razón).

Frontmatter mal formado nunca crashea: cae en `skipped` con `frontmatter parse error`.

**Activación por agente (sin pasos manuales después de setup):**

| Agente          | Cómo se carga                                                                          | Setup                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Claude Code** | Hook `UserPromptSubmit` regenera el manifest en cada prompt                            | Pegar snippet en `.claude/settings.json` (ver `docs/integrations/claude-code-hook.md`) |
| **OpenCode**    | El agente llama tool MCP `select_agent_context({task})` al inicio. Live, sin disco     | `opencode.json` ya configurado                                                         |
| **Cursor**      | Rule Auto-Attached con `globs:` por dominio. Se activa al abrir un archivo del dominio | Sin setup; `forge context` regenera la rule                                            |

---

## Cómo el grafo le da superpoderes a OpenSpec

> El bloque clave de v0.3.0+. Sin grafo, OpenSpec hace su trabajo bien pero el agente trabaja a ciegas. Con grafo, el spec se vuelve trazable, validable y barato.

**1. El `spec-input.json` deriva del grafo, no del repo.**

| Campo             | Lo aporta el grafo                                                     |
| ----------------- | ---------------------------------------------------------------------- |
| `affectedFiles`   | El context-pack ya filtró por PageRank → spec apunta a archivos reales |
| `crossDomainDeps` | El grafo de imports → design.md menciona dependencias correctas        |
| `domain`          | Inferencia por mayoría de paths del pack                               |
| `evidence`        | Referencias trazables a los artefactos JSON validados                  |
| `purpose`         | Inferencia determinista del nombre del archivo                         |

**2. El agente recibe el spec-prompt, NO el repo.**

`forge spec` genera `.contextforge/spec-prompt.md` con 4 secciones:

```
1. Contexto del repo (de ContextForge)
   - Tarea, dominio inferido, archivos afectados, cross-domain deps, evidencia
2. Instrucciones canónicas de OpenSpec
   - Lo que devuelve `openspec instructions proposal --change <id> --json`
3. Restricciones para tu salida
   - Token budget, allowed files, formato moderno
4. Output esperado
   - Editar openspec/changes/<id>/{proposal,design,tasks,specs}.md
```

El agente no abre el repo. Solo lee este prompt + el context-pack si necesita más detalle.

**3. El multiplicador escondido — prompt caching.**

Claude descuenta **90 % del precio** de tokens cacheados. ContextForge mete un boost porque su output **es determinista**:

- Mismo `forge context` → mismo `context-pack.json` byte-a-byte.
- Mismo `forge spec` → mismo `spec-prompt.md` byte-a-byte.

Entre las **iteraciones 2, 3, N** del SDD, el agente cachea todo el prompt. Solo paga full por el delta.

**4. Ahorro doble medido.**

```
Por iteración SDD:
  Sin ContextForge   217 600 tokens   $0.65
  Con ContextForge    18 988 tokens   $0.057   (-91%)

3 iteraciones de un feature normal:
  Sin caching         3 × $0.65 = $1.96
  Con caching activo  $0.07     (÷28×)
```

**5. Trazabilidad auditable.**

Cada path en `design.md` apunta a un archivo del `context-pack.json`. Cada commit puede verificarse con `forge implement --check` contra `allowedFiles[]` derivado del pack.

**Tabla — qué aporta cada herramienta:**

| Aporte                                                    | ContextForge | OpenSpec | Agente IA |
| --------------------------------------------------------- | :----------: | :------: | :-------: |
| Ranking de archivos por relevancia                        |      ✓       |          |           |
| Grafo de dependencias                                     |      ✓       |          |           |
| Token budget + selección por presupuesto                  |      ✓       |          |           |
| Trazabilidad (cada archivo viene del pack)                |      ✓       |          |           |
| Schemas estables (Requirement+Scenario)                   |              |    ✓     |           |
| Validación estructural (`openspec validate`)              |              |    ✓     |           |
| Templates canónicos por artefacto                         |              |    ✓     |           |
| Instalación de instrucciones por agente (`openspec init`) |              |    ✓     |           |
| Redacción de prosa                                        |              |          |     ✓     |
| Decisiones de diseño contextual                           |              |          |     ✓     |
| Determinismo + cacheabilidad                              |      ✓       |    ✓     |           |

---

## Documentación generada para agentes (`forge init`)

`forge init` genera `.contextforge/agent-context.md` — un archivo derivado que cualquier agente puede leer al iniciar sesión y entender:

- Qué artefactos hay disponibles y en qué orden leerlos.
- Cómo consumirlos (no leer el repo a ciegas).
- La receta SDD completa (ContextForge ⊕ OpenSpec).
- Política para agentes (no specs a mano, no bullets, gate pre-commit).
- Tabla de comandos clave por intención.

Adicionalmente, `forge init` detecta si `openspec` CLI está en PATH y, si el directorio `openspec/` no existe, ejecuta:

```bash
openspec init . --tools=claude,cursor,opencode --force
```

Eso instala las **instrucciones canónicas de OpenSpec** para los 3 agentes (las que aparecen en `.claude/`, `.cursor/rules/`, `opencode.json`). Idempotente: si el directorio `openspec/` ya existe, salta.

---

## Comandos completos

| Comando                                             | Qué hace                                                                    | LLM |
| --------------------------------------------------- | --------------------------------------------------------------------------- | :-: |
| `forge init`                                        | `.contextforge/` + `agent-context.md` + `openspec init` (si está)           | No  |
| `forge scan`                                        | Indexa con BLAKE3 (incremental)                                             | No  |
| `forge graph`                                       | Grafo file + symbol con tree-sitter                                         | No  |
| `forge context "<tarea>" [--no-manifest] [--force]` | PageRank + BFS + budget · auto-emite manifest                               | No  |
| `forge spec <id> [--no-openspec]`                   | spec-input.json + handoff/fallback OpenSpec                                 | No  |
| `forge implement <id>`                              | Plan con guardrails derivados del pack                                      | No  |
| `forge implement --check`                           | Valida diff vs guardrails                                                   | No  |
| `forge skills [--force]`                            | Auto-genera skills por dominio (`ctx-<domain>.md`)                          | No  |
| `forge manifest [--agents=...] [--force]`           | Re-genera manifest sin re-rankear                                           | No  |
| `forge sync [--since X] [--rebuild]`                | Reporta delta desde un ref de git                                           | No  |
| `forge impact`                                      | Health check de artefactos + cobertura                                      | No  |
| `forge viz`                                         | Visualización HTML interactiva del grafo                                    | No  |
| `forge docs [--force]`                              | Scaffold Diátaxis (tutorials/how-to/reference/explanation/adr/architecture) | No  |

**Política**: ningún comando llama a un LLM. Todo es derivable, reproducible, auditable.

---

## Workflows recomendados

### A) Bug fix puntual

```bash
pnpm forge context "fix <descripción del bug>"
# El agente ya tiene el contexto correcto en .claude/agent-manifest.md
# y el pack en .contextforge/context-pack.json
pnpm forge implement --check    # antes de commit
```

### B) Feature nueva con SDD completo

```bash
pnpm forge context "implement <feature>"
pnpm forge spec mi-feature-id            # spec-input + handoff/fallback
# El agente recibe spec-prompt.md y llena los .md
openspec validate mi-feature-id          # validación oficial
pnpm forge implement mi-feature-id       # plan con guardrails
# (el agente implementa)
pnpm forge implement --check             # gate pre-commit
openspec archive mi-feature-id -y        # al mergear
```

### C) Auditoría / health check

```bash
pnpm forge sync --since main             # delta vs main
pnpm forge impact                        # cobertura de skills + estado
openspec list                            # changes activos en SDD
```

---

## Servidor MCP

`packages/mcp` expone **7 tools** consumibles por cualquier cliente MCP (Claude Code, OpenCode, etc.).

| Tool                   | Propósito                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| `forge_status`         | Estado de los artefactos (frescura, conteos, savings)                       |
| `forge_domain_map`     | Mapa de dominios + dependencias cruzadas                                    |
| `forge_neighbors`      | Vecinos directos de un archivo en el grafo                                  |
| `forge_context`        | Selección PageRank para una tarea (con o sin contenido)                     |
| `forge_check`          | Valida git diff contra guardrails del implement-plan                        |
| `select_agent_context` | **Runtime**: computa agent-manifest en memoria para una tarea (cache mtime) |
| `get_agent_manifest`   | **Offline**: lee `.contextforge/agent-manifest.json` precomputado           |

**Wiring (Docker, recomendado):**

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

**Wiring (npm):**

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

---

## Artefactos generados

Todos los JSON validados con JSON Schema 2020-12 antes de escribirse.

```
.contextforge/
  scan.json                  # archivos con hashes BLAKE3
  graph.json                 # 368 nodos, 267 edges
  context-pack.json          # archivos seleccionados dentro del presupuesto
  token-ledger.json          # métricas auditables del ahorro
  agent-manifest.json        # skills/rules relevantes a la tarea (neutral)
  spec-input.json            # entrada determinista para OpenSpec / agente
  spec-prompt.md             # prompt copy-paste (modo handoff)
  implement-plan.json        # guardrails: allowedFiles, maxLocDelta, etc.
  agent-context.md           # documentación del repo para agentes IA
  graph.html                 # visualización interactiva (Cytoscape.js)
  manifests/opencode-readme.md   # instrucciones MCP para OpenCode

.claude/agent-manifest.md           # manifest renderer Claude Code
.cursor/rules/contextforge-active.mdc  # rule auto-attached por dominios tocados

openspec/changes/<id>/
  proposal.md          # intent, scope, why, alternatives
  design.md            # decisiones técnicas con archivos del grafo
  tasks.md             # T1, T1.1, T2... checklist
  specs/<dominio>/spec.md   # ## ADDED Requirements + ### Requirement: + #### Scenario:
```

### Schemas

| Artefacto             | Schema                                    |
| --------------------- | ----------------------------------------- |
| `scan.json`           | `docs/schemas/scan.schema.json`           |
| `graph.json`          | `docs/schemas/graph.schema.json`          |
| `context-pack.json`   | `docs/schemas/context-pack.schema.json`   |
| `implement-plan.json` | `docs/schemas/implement-plan.schema.json` |
| `token-ledger.json`   | `docs/schemas/token-ledger.schema.json`   |
| `agent-manifest.json` | `docs/schemas/agent-manifest.schema.json` |
| `spec-input.json`     | `docs/schemas/spec-input.schema.json`     |

---

## Métricas reales (este repo, hoy)

| Métrica                  | Valor                                                |
| ------------------------ | ---------------------------------------------------- |
| Tests                    | **221 / 221** verde (22 archivos)                    |
| Coverage                 | ≥ 80 % global · módulos `manifest/` y `spec/` ≥ 95 % |
| Token savings            | **94.4 %** vs baseline                               |
| Compresión               | **17.9×** por sesión · **÷28×** SDD con caching      |
| Archivos del repo        | 128                                                  |
| Archivos en context-pack | 50                                                   |
| Tokens del context-pack  | 11 988                                               |
| Tokens baseline          | 214 606                                              |
| Grafo                    | 368 nodos, 267 edges                                 |
| Comandos `forge`         | 13                                                   |
| Tools MCP                | 7                                                    |

---

## Distribución

| Canal                              | Identificador                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| **npmjs.com** (público, sin token) | `@anai-raia-alex/contextforge-{core,cli,mcp}`                                  |
| **GitHub Container Registry**      | `ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest` (multi-arch amd64+arm64) |
| **Repo público**                   | https://github.com/alejandro-cedeno-10/contextforge-cli                        |

---

## Integración con agentes — matriz

| Agente            | Configuración                                                                              | Selección por tarea                                                            | Estado     |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- |
| **Claude Code**   | `.claude/skills/` (3 task-oriented + N auto-generadas) · hook `UserPromptSubmit`           | Hook inyecta manifest live + JSON precomputado                                 | Listo      |
| **Cursor**        | `.cursor/rules/contextforge.mdc` (alwaysApply) + `contextforge-active.mdc` (Auto-Attached) | Rule por glob regenerada por `forge context` (Cursor no tiene hooks reactivos) | Listo      |
| **OpenCode**      | `opencode.json` con MCP server registrado                                                  | Tool MCP `select_agent_context({task})` live                                   | Listo      |
| **Codex / otros** | Leen `.contextforge/*.json` directamente                                                   | Lectura directa de `agent-manifest.json`                                       | Compatible |

Los `.contextforge/*.json` son **portables**. Cualquier agente futuro los puede consumir sin modificación.

---

## Principios

- **Determinismo primero**: ningún comando llama a un LLM. Reproducible, auditable, cacheable.
- **OpenSpec por defecto**: `forge spec` delega a OpenSpec CLI cuando está, fallback determinista cuando no.
- **Cache por hash**: si `scan.json` no cambió, `forge graph` salta el rebuild.
- **Presupuesto explícito**: cada context-pack tiene `maxInputTokens` trazable en `token-ledger.json`.
- **JSON validado**: ningún artefacto se escribe sin pasar JSON Schema.
- **Portable**: cualquier agente puede consumir `.contextforge/*.json` sin modificación.
- **Sin lock-in**: si mañana sale otra herramienta SDD, lee los mismos JSON.

---

## Para la exposición — los 5 puntos memorables

1. **94 % menos tokens por sesión** — verificado con `token-ledger.json`, no estimado.
2. **÷28× costo SDD con prompt caching** — porque el output es determinista byte-a-byte.
3. **No competimos con OpenSpec, lo apoyamos**. Tres roles separados (CF / OpenSpec / agente). Si OpenSpec evoluciona, no nos pisamos.
4. **El agente solo carga lo de tu tarea actual** — context-pack + manifest. Las 100 skills viejas no entran al contexto.
5. **Sin lock-in**. Los `.contextforge/*.json` son neutrales. Si mañana sale otra herramienta, los puede consumir igual.

---

## Estructura del monorepo

```
packages/
  core/   → scanner, parser tree-sitter, graph builder, selector PageRank,
            packer, schema validator, skill builder, agent-manifest, spec-input,
            spec promptRenderer
  cli/    → comandos forge (init, scan, graph, context, spec, implement, manifest,
            skills, sync, impact, viz, docs)
  mcp/    → servidor MCP con 7 tools

.claude/skills/    → 3 skills task-oriented (contextforge-*) +
                     N auto-generadas (ctx-*) +
                     agent-manifest.md (per-task)
.cursor/rules/     → contextforge.mdc (alwaysApply) +
                     contextforge-active.mdc (Auto-Attached, regenerada por tarea)
opencode.json      → configuración MCP para OpenCode
docs/integrations/ → guías de wiring por agente
docs/explanation/  → contextforge-and-openspec.md (lectura clave)
```

---

## Tests

```bash
pnpm test               # todos los tests
pnpm test:coverage      # con cobertura
pnpm typecheck          # tsc -b --force (project references)
```

Suite actual: **221/221 tests pasando** (22 archivos), coverage global ≥ 80 % · módulos `manifest/` y `spec/` ≥ 95 %.

---

## Documentación

| Documento                                       | Descripción                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `docs/explanation/contextforge-and-openspec.md` | **Lectura clave**: 3 roles (CF / OpenSpec / agente), ahorro medido, prompt caching ÷28× |
| `docs/how-to/use-contextforge.md`               | Guía paso a paso: instalación, pipeline, integración por agente                         |
| `docs/integrations/claude-code-hook.md`         | Snippet copy-paste para activar manifest en runtime en Claude Code                      |
| `docs/integrations/cursor-rules.md`             | Los 3 modos de rules en Cursor + estrategia recomendada                                 |
| `docs/integrations/opencode-mcp.md`             | Ejemplo de `select_agent_context` desde OpenCode                                        |
| `docs/token-savings-architecture.md`            | Análisis de ahorro de tokens por capas con tabla de costos                              |
| `docs/EXAMPLES/end-to-end-flow.md`              | Walkthrough completo del pipeline con outputs reales                                    |
| `docs/IMPLEMENTATION_TASKS.md`                  | Backlog de sprints con criterios verificables                                           |
| `docs/CHANGELOG-schemas.md`                     | Historial de cambios de schemas                                                         |
| `openspec/changes/forge-spec-as-prepare-step/`  | OpenSpec change del re-arquitectura v0.3.0                                              |
| `openspec/changes/agent-manifest/`              | OpenSpec change del manifest por tarea                                                  |
| `openspec/changes/auto-domain-skills/`          | OpenSpec change de las skills auto-generadas                                            |
| `CONTEXTFORGE_SOURCE_OF_TRUTH.md`               | Decisiones de diseño, arquitectura, roadmap                                             |

---

## Licencia

MIT
