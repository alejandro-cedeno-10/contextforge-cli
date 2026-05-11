# ContextForge Source of Truth

## Estado

- Version: `v0.3-draft`
- Fecha: `2026-05-11`
- Reemplaza: `v0.2-draft` (2026-05-06)
- Release actual: `v0.3.10` (paquetes en npmjs.com bajo `@anai-raia-alex`, imagen MCP en GHCR)
- Alcance de runtime: `outputs agnostic; OpenCode = integrador de referencia`
- Politica de implementacion: `plan_only` por defecto

### Cambios respecto a v0.2

1. Sprints S1–S14 completados. Suite: 341/341 tests.
2. Capa semantica (Pass-5): detectores de dominios, capas, endpoints, flujos, conceptos Louvain. Vue + Nuxt soportados.
3. MCP server con 14 tools: `forge_status`, `forge_context`, `forge_neighbors`, `forge_domain_map`, `forge_semantic_map`, `forge_flow`, `forge_check`, `forge_rebuild_graph`, `forge_implement`, `forge_spec`, `forge_archive_change`, `forge_change_context`, `forge_change_manifest`, `forge_change_subgraph`.
4. Flujo OpenSpec completo desde MCP: context → spec → implement → check → archive. Sin shell, sin pnpm.
5. Skills auto-generadas por dominio (`contextforge-domain-*`) + skill de flujo SDD completo.
6. `forge manifest` produce `agent-manifest.json` con seleccion de skills por tarea.
7. `forge_change_subgraph` + `graph.subset.json`: subgrafo congelado por change para navegacion barata.
8. `forge_archive_change` auto-rebuild grafo padre y refresca subgrafos de changes activos.
9. `forge sync --refresh-subgraphs`: equivalente CLI de archive sin MCP.
10. DV-13 nueva: MCP-first workflow como patron de referencia para agentes.
11. `agent-context.md` creado en `.contextforge/` como punto de entrada obligatorio para agentes.

---

## Vision del producto

ContextForge es una capa de inteligencia de codigo `deterministic-first` que produce artefactos JSON validados (`scan`, `graph`, `context-pack`, `implement-plan`) reusables por cualquier agente (OpenCode, Claude Code, Cursor, Codex). Su funcion es minimizar tokens enviados al modelo manteniendo precision tecnica, y servir como motor de contexto para flujos Spec Driven Development apoyados en OpenSpec.

Propuesta central:

- OpenSpec (o Spec-Kit) organiza el lifecycle del cambio.
- ContextForge descubre y empaqueta el contexto minimo verificable, con evidencia y presupuesto explicito.
- El mismo `context-pack.json` alimenta multiples agentes sin re-indexar.

---

## Posicionamiento

### Lo que ContextForge **es**

- Pipeline determinista `scan -> graph -> context -> spec -> implement-plan`.
- Generador de artefactos JSON validados por JSON Schema.
- Motor de seleccion token-aware con presupuesto explicito y trazabilidad.
- Productor de specs SDD compatibles con la estructura OpenSpec (`openspec/changes/<id>/`).

### Lo que ContextForge **no es**

- No es un clon de OpenSpec ni Spec-Kit.
- No es un wrapper de embeddings (no compite con `@codebase` de Continue).
- No es indexador propietario (no compite con Cursor indexing).
- No es bulk-packer (no compite con repomix en empaquetar todo).
- No reemplaza al agente de codigo: alimenta su contexto.

### Moat (combinacion no replicada hoy)

1. Determinismo end-to-end + artefactos JSON validados (Aider es determinista pero solo emite texto; Repomix emite JSON pero no rankea).
2. Cache reutilizable entre agentes (Cursor/Continue/Cody mantienen indices opacos, no compartibles).
3. Interop nativa con OpenSpec (Spec-Kit usa formato propio; OpenSpec no genera contexto de codigo).
4. Grafo + ranking + budgeting + SDD en un unico pipeline (Aider tiene 1 pieza, Repomix 2, OpenSpec 1).
5. `context-pack` cacheable por hash, no por query (ahorro real con cache de Anthropic 90% off en cache reads).

---

## Objetivos estrategicos

- Reducir tokens por tarea sin perder precision tecnica.
- Evitar relectura completa del repositorio cuando existan artefactos vigentes (cache por hash).
- Entregar specs y planes accionables respaldados por evidencia del grafo.
- Mantener outputs JSON estrictamente validados por schema.
- Permitir consumo desde cualquier agente compatible con archivos JSON locales.

---

## Principios no negociables

- Determinismo primero en `forge scan` y `forge graph`. Sin LLM por defecto.
- Sin prose fuera de schema en salidas JSON.
- Reutilizacion incremental basada en hash (BLAKE3).
- Contexto minimo viable con presupuesto explicito.
- Trazabilidad: tarea -> nodos -> archivos -> criterios -> pruebas.
- Outputs portables: cualquier agente puede consumir `.contextforge/*.json`.

---

## Decisiones vigentes

| ID    | Decision                                                                                                             | Estado                  |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| DV-01 | Outputs son tool-agnostic; OpenCode es el integrador de referencia (no el alcance)                                   | **Reformulada en v0.2** |
| DV-02 | Estrategia base: `deterministic-first`                                                                               | Vigente                 |
| DV-03 | Contratos de salida: `JSON Schema 2020-12 obligatorio`                                                               | Vigente                 |
| DV-04 | Objetivo primario: `token efficiency con calidad tecnica`                                                            | Vigente                 |
| DV-05 | Parser: `web-tree-sitter` (WASM, portable, sin native build)                                                         | Vigente                 |
| DV-06 | Grafo: `graphology` + `graphology-metrics/centrality/pagerank`                                                       | Vigente                 |
| DV-07 | Hash: `BLAKE3` (npm `@noble/hashes/blake3`) para fingerprinting                                                      | Vigente                 |
| DV-08 | Tokenizer canonico: Anthropic `messages.count_tokens` con fallback `js-tiktoken` (`o200k_base`)                      | Vigente                 |
| DV-09 | Edge types canonicos: `defines`, `imports`, `calls`, `references`, `tests`                                           | Vigente                 |
| DV-10 | Algoritmo seleccion: Personalized PageRank + BFS depth=2 + greedy budget pack                                        | Vigente                 |
| DV-11 | Interop: `forge spec` emite estructura OpenSpec (`changes/<id>/`) con subgrafo congelado + context.md                | **Expandida en v0.3**   |
| DV-12 | CPG (Code Property Graph) deferred indefinidamente. Symbol-level reference graph cubre 80% del valor a 5% del costo. | Vigente                 |
| DV-13 | MCP-first como patron de referencia: flujo completo sin shell/pnpm via 14 tools (`forge_status` → `forge_archive_change`) | **Nueva en v0.3**  |

---

## Diferenciadores y ventajas

### 1) Ahorro de tokens por diseno

- Personalized PageRank para rankear archivos/simbolos por relevancia desde seeds.
- Presupuesto de tokens (`maxInputTokens`) con recorte por prioridad y degradacion progresiva (`full -> excerpt -> summary`).
- Modos de inclusion por archivo: `summary`, `excerpt`, `full`.
- Optimizado para Anthropic prompt caching (cache write 1.25x, cache read 0.1x = 90% off).

### 2) Grafo tecnico como indice principal

- Nodos `file` y `symbol` con IDs estables (`file:<path>`, `symbol:<path>#<name>`).
- 5 edge types tipados (`defines`, `imports`, `calls`, `references`, `tests`).
- Subgrafo orientado a tarea para reducir ruido.
- Base para detectar blast radius y pruebas afectadas.

### 3) Specs con evidencia

- Cada spec referencia nodos/archivos concretos del grafo.
- Razon de inclusion por archivo y enlace a contratos tecnicos.
- Compatible con formato OpenSpec (Given/When/Then + RFC 2119).

### 4) Mejor aptitud para brownfield

- Analiza arquitectura real antes de proponer cambios.
- Detecta dependencias reales, no solo intencion textual.
- Reduce retrabajo por supuestos incorrectos del sistema.

### 5) Planes AI-ready con guardrails

- `implement-plan.json` con `allowed_files`, `forbidden_paths`, `max_loc_delta`, `required_tests`.
- Facil de consumir por OpenCode/Claude Code/Codex sin prompt inflado.

---

## Alcance y no alcance

### En alcance (MVP v0.2)

- Pipeline CLI: `init`, `scan`, `graph`, `context`, `spec`, `implement`.
- Artefactos en `.contextforge/` validados por JSON Schema.
- Lenguajes con grammars tree-sitter maduros: TS/JS, Python, Go, Rust, Java.
- Integrador de referencia: OpenCode.
- Export a estructura OpenSpec opcional (`forge spec --emit openspec`).
- Token measurement vs baseline `full_repo_dump`.

### Fuera de alcance (por ahora)

- LLM obligatorio en `scan` o `graph`.
- Edicion automatica de codigo en `implement` por defecto (siempre `plan_only`).
- Visualizaciones avanzadas de grafo (CLI + JSON exportable es suficiente).
- Code Property Graph (CPG) tipo Joern: overkill para context selection.
- Embeddings/RAG: no compite con `@codebase` de Continue (deja eso al integrador).
- Indexing remoto: todo es local-first.

---

## Arquitectura objetivo

### Paquetes

| Paquete                 | Responsabilidad                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/core`         | Scanner, parser tree-sitter, builder de grafo, selector de contexto, validadores schema, tokenizador. |
| `packages/cli`          | Comandos `forge` y orquestacion del pipeline.                                                         |
| `packages/agents`       | Plantillas, prompts y skills compartidos para OpenCode/Claude Code.                                   |
| `packages/integrations` | Adaptadores: OpenCode (referencia), futuro Claude Code, Codex, Cursor.                                |

### Artefactos base

| Artefacto                                     | Schema                                    | Determinista                        |
| --------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `.contextforge/scan.json`                     | `docs/schemas/scan.schema.json`           | Si                                  |
| `.contextforge/graph.json`                    | `docs/schemas/graph.schema.json`          | Si                                  |
| `.contextforge/context-pack.json`             | `docs/schemas/context-pack.schema.json`   | Si (modo summary opcionalmente LLM) |
| `.contextforge/spec.sdd.md`                   | (markdown estructurado)                   | Mixto (LLM permitido)               |
| `.contextforge/implement-plan.json`           | `docs/schemas/implement-plan.schema.json` | Si (estructura)                     |
| `.contextforge/token-ledger.json`             | `docs/schemas/token-ledger.schema.json`   | Si                                  |
| `.contextforge/cache/<hash>.fingerprint.json` | (interno)                                 | Si                                  |

---

## Metodologia de medicion de tokens

### Por que importa

Sin metodologia, "ahorro de tokens" no es medible y las metricas de exito (seccion final) son humo. La metodologia debe ser publicada, reproducible y auditada por CI.

### Tokenizer canonico

- **Primario**: Anthropic `messages.count_tokens` (POST `/v1/messages/count_tokens`). Gratis, exacto al billing salvo "small differences", requiere API key. Apto para batch al final del pipeline.
- **Fallback offline**: `js-tiktoken` con encoding `o200k_base` (GPT-4o/5). Determinista sin red.
- **No usar**: `@anthropic-ai/tokenizer` npm (oficialmente obsoleto para Claude 3+, error >10% en codigo).
- **Nota critica**: Claude Opus 4.7 tokenizer infla conteos +0% a +35% vs Opus 4.6. Registrar siempre el tokenizador real, no asumir.

### Baseline doble

Toda medicion compara contra **dos** baselines:

1. `full_repo_dump`: todos los archivos no-ignorados concatenados (a la repomix sin compress). Limite superior de tokens.
2. `naive_top_k`: top-K archivos por path-distance al primer seed (heuristico naive). Baseline mas justa para casos pequenos.

`savings_pct = (baseline_tokens - packed_tokens) / baseline_tokens * 100`
`compression_ratio = baseline_tokens / packed_tokens` (mas legible cuando savings > 90%)

### Costos de referencia (pricing snapshot 2026-05-06, USD/1M tokens)

| Modelo                  | Input | Output | Cache write 5m | Cache read |
| ----------------------- | ----- | ------ | -------------- | ---------- |
| Claude Haiku 4.5        | $1    | $5     | $1.25          | $0.10      |
| Claude Sonnet 4.6       | $3    | $15    | $3.75          | $0.30      |
| Claude Opus 4.7         | $5    | $25    | $6.25          | $0.50      |
| Gemini 2.5 Pro (<=200k) | $1.25 | $10    | -              | -          |
| GPT-5.2 Pro             | $21   | $168   | -              | -          |

Reportar costo en 3 escenarios: no-cache, cache-write, cache-read steady-state.

### Estructura `token-ledger.json`

Ver `docs/schemas/token-ledger.schema.json`. Campos clave:

- `tokenizer.name`, `tokenizer.model`, `tokenizer.fallback_used`
- `baseline.strategy` (`full_repo_dump` | `naive_top_k`), `baseline.tokens`
- `packed.tokens`, `packed.system_prompt_tokens`, `packed.tool_schema_tokens`
- `savings.absolute_tokens`, `savings.savings_pct`, `savings.compression_ratio`
- `cost_usd` con `baseline_input`, `packed_input_no_cache`, `packed_input_with_cache`
- `cache.ttl`, `cache.hit_ratio_observed`
- `pricing_snapshot_date` (auditable)

---

## Algoritmo de seleccion de contexto

### Pipeline interno de `forge context`

```
inputs: graph.json, task description, seeds[], budget

1. resolve_seeds(task, seeds) -> seed_node_ids[]
   - Si no se pasan seeds: extraer entidades del task con heuristica (file paths mencionados, identificadores en backticks).
   - Si task vacio y seeds vacios: error.

2. compute_personalized_pagerank(graph, seed_node_ids)
   - Algoritmo: PageRank con personalization vector.
   - Boost: seed_files = 100, simbolos mencionados = 10, default = 1.
   - alpha = 0.85, iteraciones = 50, tolerancia = 1e-6.
   - Libreria: graphology + graphology-metrics/centrality/pagerank.

3. expand_via_bfs(graph, seed_node_ids, depth=2)
   - BFS desde seeds, profundidad 2 (configurable).
   - Captura dependencias directas + indirectas razonables.

4. score_nodes(pagerank_score, bfs_distance, edge_types_seen)
   - score = pagerank_score * (1 / (1 + bfs_distance)) * edge_type_multiplier
   - edge_type_multiplier: tests=1.2, defines=1.0, imports=0.8, calls=1.0, references=0.6.

5. greedy_pack(scored_nodes, budget, mode_policy)
   - Ordenar por score desc.
   - Anadir hasta exceder budget.
   - Si excede: degradar mode `full -> excerpt -> summary` por orden de menor score primero.
   - Si aun excede: excluir nodos con score mas bajo.
   - Registrar `reason` por archivo: `seed`, `direct_import`, `transitive_dep`, `test_for`, `referenced_symbol`.

6. emit_pack(selected_nodes, ledger_metadata)
   - Escribir context-pack.json conforme a schema.
   - Escribir token-ledger.json con baseline/packed/savings.
```

### Justificacion

- **Personalized PageRank**: probado por Aider sobre repos reales. Determinista, ~50 iteraciones, O(k(V+E)).
- **BFS depth=2**: limita explosion combinatoria sin perder dependencias relevantes.
- **Greedy pack vs Knapsack 0/1**: knapsack DP O(n\*B) es overkill y no aprovecha estructura del grafo. Greedy con scoring graph-aware da resultado practicamente equivalente.
- **Steiner tree y CPG**: descartados (NP-hard / overkill).
- **No embeddings en MVP**: anaden no-determinismo y coste de indexing. Si en v0.5+ se demuestra que mejora recall, anadir como signal adicional via Reciprocal Rank Fusion (a la Cody).

### Modos de inclusion (`mode_policy`)

| Modo      | Contenido                                                    | Token cost aproximado |
| --------- | ------------------------------------------------------------ | --------------------- |
| `full`    | Archivo completo                                             | 100%                  |
| `excerpt` | Symbols relevantes + signaturas + 5 lineas contexto cada uno | 30-50%                |
| `summary` | Solo signaturas exports + path/imports                       | 5-15%                 |

`summary` se genera deterministically desde el AST tree-sitter (no LLM). Si futuro: opcion `--llm-summarize` para summary semantico.

---

## Estrategia de actualizacion incremental

### Hashing por contenido

- Cada archivo: BLAKE3 hash de bytes (rapido, criptografico, ~5x SHA-256 en Node).
- Cache por archivo en `.contextforge/cache/<file_hash>.fingerprint.json` con: AST nodes extraidos, simbolos, edges salientes.

### Invalidacion en cascade

Cuando cambia `src/auth.ts`:

1. Recalcular hash de `src/auth.ts`. Si igual: skip total.
2. Si distinto: re-parse archivo, regenerar nodos `symbol:src/auth.ts#*` y edges salientes (`imports`, `calls`, `defines`).
3. Edges entrantes (`X imports auth`, `X calls auth.foo`) NO se recomputan automaticamente. Se revalidan solo si la signatura del simbolo destino cambio.
4. PageRank se recomputa solo si la topologia cambio (delta de edges > 0). Cambios solo en cuerpos no afectan ranking.

Inspiracion: Bazel content-addressed cache + Turborepo lockfile-aware invalidation.

### Cache hit reporting

`forge scan/graph/context` deben emitir en stdout:

```
[scan] 1234 files, 12 changed, 1222 cache-hit (98.9%)
[graph] topology unchanged, PageRank skipped (cache-hit)
[context] pack regenerated for new task "fix auth bug"
```

---

## Integracion con OpenSpec

### Estructura OpenSpec relevante

```
openspec/
  specs/<domain>/spec.md             # base spec (autoridad actual)
  changes/<change-id>/
    proposal.md                       # intent, scope, why
    design.md                         # technical approach
    tasks.md                          # implementation checklist
    specs/<domain>/spec.md            # delta spec (ADDED/MODIFIED/REMOVED)
  changes/archive/<date>-<id>/...     # cambios cerrados
```

Delta spec usa secciones `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`. Requirements en formato Given/When/Then + RFC 2119.

### Comando `forge spec --emit openspec`

`forge spec "fix-auth-bug" --emit openspec` produce:

```
openspec/changes/fix-auth-bug/
  proposal.md       # generado desde plantilla con context-pack como evidencia
  design.md         # diseno propuesto basado en grafo
  tasks.md          # tareas con files referenciados desde context-pack
  specs/auth/spec.md # delta spec ADDED/MODIFIED
```

Tambien sigue funcionando el modo legacy `forge spec "fix-auth-bug"` que produce solo `.contextforge/spec.sdd.md`.

### Soporte futuro Spec-Kit

Spec-Kit usa `constitution.md` + workflow spec->plan->tasks pero formato propio. Si gana traccion, anadir `--emit speckit` como segundo target. No se compromete arquitectura: ambos consumen el mismo `context-pack` y `graph`.

---

## Analisis competitivo

### Tabla comparativa (Mayo 2026)

| Tool                 | Determinismo | Algoritmo                         | Output                 | Token-aware     | Spec interop       | Open source  |
| -------------------- | ------------ | --------------------------------- | ---------------------- | --------------- | ------------------ | ------------ |
| Aider repo-map       | Si           | Tree-sitter + PageRank            | Texto en prompt        | Parcial         | No                 | Si           |
| Continue `@codebase` | No           | Embeddings + AST + FTS            | Inyectado              | Si              | No                 | Si           |
| Cursor indexing      | No           | AST + Merkle + embeddings remotos | Opaco                  | Si (interno)    | No                 | No           |
| Sourcegraph Cody     | Hibrido      | Code Graph (SCIP) + agent loops   | Opaco                  | Parcial         | No                 | Parcial      |
| Repomix              | Si           | Glob + tree-sitter compress       | XML/MD/JSON            | Si              | No                 | Si           |
| RepoPrompt           | Si (manual)  | Seleccion humana + Code Maps      | Texto                  | Si              | No                 | No           |
| OpenSpec             | Si           | Convencion + deltas               | MD estructurado        | No              | **Es el estandar** | Si           |
| Spec-Kit             | Si           | Templates + constitution          | MD                     | No              | Propio             | Si           |
| code2prompt          | Si           | Glob + Handlebars + tokenizer     | Texto/MD               | Si              | No                 | Si           |
| files-to-prompt      | Si           | Concat                            | Texto                  | No              | No                 | Si           |
| **ContextForge**     | **Si**       | **PageRank + BFS + budget**       | **JSON validado + MD** | **Si (ledger)** | **Si (OpenSpec)**  | **Si (MIT)** |

### Riesgos competitivos

| Riesgo                                                      | Probabilidad                 | Mitigacion                                                                      |
| ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Repomix anade ranking PageRank y se come `scan+context`     | Media                        | Adelantar interop OpenSpec + ledger publico que repomix no tiene.               |
| Aider expone `repo-map` como JSON reusable                  | Media-baja                   | Diferenciar con multi-agent reuse + spec emission.                              |
| OpenSpec absorbe `opsx scan/context`                        | Baja-media                   | Mantener compatibilidad bidireccional; ofrecer `forge` como ejecucion mas rica. |
| Spec-Kit (Microsoft/GitHub) desplaza OpenSpec como estandar | Media                        | Soportar ambos targets (`--emit openspec\|speckit`).                            |
| Cursor/Cody comoditizan via "indexing as a service"         | Alta dentro de su ecosistema | No competir; mantener foco multi-agent CLI local-first.                         |

---

## Politica de tokens

### Presupuesto por defecto

- `maxInputTokens`: 12000 (conservador, ajustable por flag `--budget`).
- Configurable global en `.contextforge/config.json`.

### Orden de prioridad para incluir contexto

1. Entrypoints del cambio (seeds explicitos).
2. Dependencias directas (BFS depth 1).
3. Tests del area afectada (edge `tests`).
4. Dependencias transitivas (BFS depth 2) por score.
5. Autorizacion/validacion y contratos tocados.
6. Documentacion estrictamente necesaria.

### Regla de recorte progresivo

Si excede budget:

1. Degradar `mode: full -> excerpt` para el nodo de menor score.
2. Si aun excede: degradar `excerpt -> summary`.
3. Si aun excede: excluir nodos por score ascendente, registrando exclusion en `context-pack.json/excluded[]`.

### Registro obligatorio

`token-ledger.json` se emite en cada ejecucion de `forge context`. CI debe validar que existe y cumple schema.

---

## Roadmap por fases

### Fase 1 - Hardening del baseline (Sprint 1-2) ✅

- Validacion JSON Schema obligatoria en todos los comandos.
- Migrar SHA-256 a BLAKE3 en scanner.
- Cache por hash de scan.json (skip si no hay cambios).
- Mensajeria CLI clara para cache hit/miss.

### Fase 2 - Grafo real (Sprint 3) ✅

- Integrar `web-tree-sitter` para TS/JS, Python, Go, Rust, Java.
- Extraer simbolos y referencias deterministicamente.
- Emitir nodos `symbol:` y 5 edge types canonicos.
- Test de cobertura: grafo no vacio para repo de muestra.

### Fase 3 - Context selector v1 (Sprint 4) ✅

- Personalized PageRank via graphology.
- BFS depth=2 + scoring + greedy pack.
- Modos `full`/`excerpt`/`summary` deterministas.
- Token ledger generado.
- Acceptance: context-pack <= budget en repo de referencia, savings > 80% vs full_repo_dump.

### Fase 4 - Spec evidence-backed (Sprint 5) ✅

- Plantilla SDD con inyeccion de evidencia (paths, simbolos, criterios verificables).
- Modo `--emit openspec` con estructura `changes/<id>/`.
- Delta specs con secciones ADDED/MODIFIED/REMOVED.

### Fase 5 - Implement-plan con guardrails (Sprint 6) ✅

- `implement-plan.json` con `allowed_files`, `forbidden_paths`, `max_loc_delta`, `required_tests`.
- Validacion de plan contra schema obligatoria.
- Comando `forge implement --check` que valida plan sin ejecutar.

### Fase 6 - Integradores adicionales (Sprints 7-9) ✅

- Adaptador Claude Code (skills + `.claude/` directory).
- Adaptador Cursor (`.cursor/rules/`).
- `forge viz`: grafo HTML interactivo con grupos de dominios.
- MCP server v1 (`forge_context`, `forge_neighbors`, `forge_domain_map`, `forge_check`, `forge_status`).
- `forge docs`: scaffolding Diátaxis.
- `forge skills` / `forge manifest`: skills auto-generadas por dominio + agent-manifest.

### Fase 7 - Publicacion y flujo SDD completo via MCP (Sprints 10-14) ✅

- Publicacion npmjs.com (`@anai-raia-alex/contextforge-core`, `contextforge-cli`, `contextforge-mcp`) + Docker MCP en GHCR.
- `forge sync` + `forge impact`.
- MCP tools para el flujo SDD completo: `forge_spec`, `forge_implement`, `forge_rebuild_graph`, `forge_archive_change`, `forge_change_subgraph`, `forge_change_context`, `forge_change_manifest`.
- Capa semantica Pass-5: detectors (layers, endpoints, flows, concepts Louvain, Vue/Nuxt).
- `forge_semantic_map`, `forge_flow` MCP tools.
- `forge sync --refresh-subgraphs` para refresh CLI sin MCP.
- Subgrafos congelados por change (`graph.subset.json` + `context.md`).
- Skills con prefijo unificado `contextforge-domain-*`.

### Fase 8 - Post-v0.3 (pendiente)

- Soporte Spec-Kit como segundo target (`--emit speckit`).
- Adaptador Codex.
- Embeddings como signal adicional via Reciprocal Rank Fusion (v0.5+).
- Benchmark de ahorro de tokens publicado y reproducible en CI.

---

## Plan de trabajo (sprints con entregables)

Ver `docs/IMPLEMENTATION_TASKS.md` para breakdown detallado con archivos, dependencias npm, tests y criterios de aceptacion.

| Sprint | Foco                                      | Estado        | Entregable principal                                              |
| ------ | ----------------------------------------- | ------------- | ----------------------------------------------------------------- |
| S1     | Schemas + validacion                      | ✅ Completado | Validador en core, CI gate, exit code 2                           |
| S2     | Cache + BLAKE3                            | ✅ Completado | Cache hit/miss reportado, `scan` skip si no cambios               |
| S3     | Grafo tree-sitter                         | ✅ Completado | Edges reales TS/JS/Python, nodos symbol                           |
| S4     | Context selector                          | ✅ Completado | PageRank + BFS + budget pack + token ledger                       |
| S5     | Spec SDD evidence-backed                  | ✅ Completado | `--emit openspec`, delta specs, `forge spec` delega a OpenSpec    |
| S6     | Implement-plan guardrails                 | ✅ Completado | allowed_files, max_loc_delta, validador, `forge implement --check` |
| S7     | Grafo visual interactivo                  | ✅ Completado | `forge viz` HTML con grupos de dominios                           |
| S8     | MCP Server                                | ✅ Completado | 5 tools iniciales: context, neighbors, domain_map, check, status  |
| S9     | Diataxis docs + Claude skills             | ✅ Completado | `forge docs`, `forge skills`, `.claude/skills/`                   |
| S10    | Publicacion GitHub Packages               | ✅ Completado | npmjs.com + Docker MCP en GHCR                                    |
| S11    | forge sync + forge impact                 | ✅ Completado | Deteccion de drift, blast-radius, health check                    |
| S12    | forge skills (auto-domain-skills)         | ✅ Completado | Skills por dominio auto-generadas desde el grafo                  |
| S13    | agent-manifest + MCP tools SDD completo  | ✅ Completado | `forge manifest`, `forge_spec`, `forge_implement`, subgrafos       |
| S14    | CI fix + capa semantica + archive tool   | ✅ Completado | Pass-5, 14 MCP tools, `forge_archive_change`, 341 tests           |

---

## Riesgos y mitigaciones

| Riesgo                                             | Mitigacion                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Sobreinclusion de archivos                         | caps + scoring + recorte progresivo + ledger auditable.            |
| Drift de schemas                                   | tests de compatibilidad por version + `schemaVersion` obligatorio. |
| Specs vagas                                        | checklist de accionabilidad + evidencia obligatoria de grafo.      |
| Dependencia accidental de LLM en fase determinista | tests que verifican que `scan`/`graph` no llaman red.              |
| tree-sitter native build falla en Windows/ARM      | DV-05 fija WASM (`web-tree-sitter`), sin native compile.           |
| Tokenizer drift Claude 4.7 (+35%)                  | DV-08 fija `count_tokens` API + registra modelo en ledger.         |
| Repomix anade ranking                              | Adelantar OpenSpec interop + multi-agent reuse como moat.          |

---

## Metricas de exito

Todas las metricas requieren baseline definido (ver Metodologia de medicion).

| Metrica                                        | Target MVP                    | Como medir                              |
| ---------------------------------------------- | ----------------------------- | --------------------------------------- |
| Reduccion tokens vs `full_repo_dump`           | >= 80% en repos > 50 archivos | `token-ledger.json`                     |
| Reduccion tokens vs `naive_top_k`              | >= 30%                        | `token-ledger.json`                     |
| % tareas dentro de budget sin recorte agresivo | >= 70%                        | conteo runs con mode=`full` mayoritario |
| Cache hit ratio en re-scan sin cambios         | >= 95%                        | logs de scan                            |
| Validacion schema en CI                        | 100% (gate obligatorio)       | exit code de validador                  |
| Tiempo `scan -> spec` en repo 1k archivos      | < 10s caliente, < 60s frio    | benchmark CI                            |
| Cost reduction efectiva con cache reads        | >= 90% en steady-state        | `token-ledger.json/cost_usd`            |

---

## Criterios de aceptacion globales

- [ ] `scan` y `graph` no realizan llamadas de red (test verifica).
- [ ] JSON generado siempre validado por schema (CI gate).
- [ ] `context-pack` cumple budget y mantiene accionabilidad (test con repo de muestra).
- [ ] `implement` conserva `plan_only` por defecto.
- [ ] Flujo OpenCode documentado y estable.
- [ ] `--emit openspec` produce estructura conforme a OpenSpec.
- [ ] Existen metricas medibles de ahorro de tokens (`token-ledger.json` siempre emitido).
- [ ] Outputs son consumibles por al menos 2 agentes distintos sin modificacion (probado: OpenCode + Claude Code).

---

## Referencias

### Investigacion citada

- Aider repo-map: https://aider.chat/docs/repomap.html
- Aider PageRank post: https://aider.chat/2023/10/22/repomap.html
- OpenSpec docs: https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md
- Spec-Kit: https://github.com/github/spec-kit
- Repomix: https://github.com/yamadashy/repomix
- Sourcegraph SCIP: https://sourcegraph.com/blog/announcing-scip
- Anthropic count_tokens: https://docs.anthropic.com/en/api/messages-count-tokens
- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- graphology: https://github.com/graphology/graphology
- web-tree-sitter: https://www.npmjs.com/package/web-tree-sitter
- BLAKE3 Vercel adoption: https://github.com/vercel/next.js/pull/31249
- Practical Code RAG at Scale: https://arxiv.org/abs/2510.20609

### Documentos relacionados en este repo

- `AGENTS.md` - reglas globales del agente
- `CLAUDE.md` - notas para Claude Code
- `docs/schemas/*.schema.json` - contratos de artefactos
- `docs/IMPLEMENTATION_TASKS.md` - breakdown ejecutable por sprint
- `deep-research-report.md` - investigacion previa (pre-v0.2, mantener como historico)
