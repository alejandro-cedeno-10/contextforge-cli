# ContextForge - Implementation Tasks (v0.2)

Breakdown ejecutable por sprint. Cada task incluye: archivos a tocar, deps a anadir, tests a escribir, criterios de aceptacion verificables. Disenado para que un agente (Claude Code, OpenCode, Codex) pueda tomar una task y ejecutarla con minimo contexto adicional.

## Estado actual (2026-05-07)

| Sprint | Foco                                                                | Estado        |
| ------ | ------------------------------------------------------------------- | ------------- |
| S1     | Schemas + validacion JSON                                           | ✅ Completado |
| S2     | Cache + BLAKE3                                                      | ✅ Completado |
| S3     | Grafo tree-sitter                                                   | ✅ Completado |
| S4     | Context selector PageRank                                           | ✅ Completado |
| S5     | Spec OpenSpec (default)                                             | ✅ Completado |
| S6     | Implement-plan guardrails                                           | ✅ Completado |
| S7     | Grafo visual interactivo                                            | ✅ Completado |
| S8     | MCP Server                                                          | ✅ Completado |
| S9     | Diátaxis docs scaffolder + Claude skills                            | ✅ Completado |
| S10    | GitHub Packages publish workflow                                    | ✅ Completado |
| S11    | forge sync + forge impact (Aspens-inspired)                         | ✅ Completado |
| S12    | forge skills (domain skills auto-gen)                               | ✅ Completado |
| S13    | agent-manifest (per-task selection) + 2 MCP tools + auto en context | ✅ Completado |
| S14    | CI fix (tipos explícitos + serial build + typecheck step)           | ✅ Completado |

**Suite de tests**: 202/202 pasando (20 archivos). **Coverage**: ≥ 80 % global · módulo `manifest/` ≥ 95 %.
**Ahorro tokens verificado**: 94.4 % (11 988 / 214 606), ratio de compresión 17.9×.
**Release**: v0.2.4 (paquetes públicos en npmjs.com bajo `@anai-raia-alex` + imagen Docker MCP en `ghcr.io/alejandro-cedeno-10/contextforge-mcp`).

**Convenciones**:

- Task ID: `S<n>.T<m>` (sprint, task).
- Cada task se completa cuando todos los criterios `[ ]` pasan.
- Si una task descubre trabajo nuevo no listado, abrir sub-task `S<n>.T<m>.<k>` antes de continuar.

---

## Sprint 1 - Schemas + Validacion ✅ COMPLETADO

**Objetivo**: Cerrar contratos, hacer validacion JSON Schema obligatoria, gate en CI. Sin esto, todo lo demas es especulativo.

### S1.T1 - Anadir validador JSON Schema a `packages/core`

- **Archivos a crear**: `packages/core/src/schema/validator.ts`, `packages/core/__tests__/validator.unit.test.ts`.
- **Deps a anadir** (root o packages/core): `ajv@^8`, `ajv-formats@^3`.
- **Implementacion**:
  - Cargar schemas desde `docs/schemas/*.schema.json` al inicializar.
  - Exportar `validate(name: 'scan' | 'graph' | 'context-pack' | 'implement-plan' | 'token-ledger', payload: unknown): { valid: boolean; errors: ErrorObject[] }`.
  - Helper `validateOrThrow(name, payload)` que lanza `SchemaValidationError` con detalle.
- **Tests**:
  - `validator.unit.test.ts` cubre cada schema con: 1 fixture valido, 2 fixtures invalidos (campo faltante, tipo incorrecto).
- **Criterios**:
  - [ ] `pnpm test` pasa con cobertura del validador para los 5 schemas.
  - [ ] Importar `import { validate } from '@contextforge/core/schema/validator'` funciona desde `packages/cli`.

### S1.T2 - Integrar validacion en cada comando CLI

- **Archivos a tocar**: `packages/cli/src/index.ts`, `packages/cli/__tests__/cli.commands.int.test.ts`.
- **Implementacion**:
  - `cmdScan`, `cmdGraph`, `cmdContext`, `cmdImplement`: tras construir el payload, llamar `validateOrThrow(...)` antes de escribir.
  - Codigo de salida 2 cuando la validacion falla (distinguible de error de IO = 1).
- **Tests**:
  - Test que monkey-patcha el scanner para devolver payload invalido y verifica exit code 2 + mensaje claro.
- **Criterios**:
  - [ ] `pnpm forge scan` falla limpio si el output no valida.
  - [ ] Test de integracion verifica gate en al menos 2 comandos.

### S1.T3 - CI gate: validacion obligatoria en GitHub Actions

- **Archivos a tocar**: `.github/workflows/ci.yml`.
- **Implementacion**:
  - Anadir step `pnpm forge scan && pnpm forge graph && pnpm forge context "ci-self-check"` y verificar que produce JSON valido.
  - Step adicional con `ajv validate -s docs/schemas/scan.schema.json -d .contextforge/scan.json` (usar `ajv-cli`).
- **Deps**: `ajv-cli@^5` como devDep root.
- **Criterios**:
  - [ ] CI rojo si cualquier artefacto no valida.
  - [ ] CI verde con la baseline actual.

### S1.T4 - Mover schemas inline del scanner a referencias externas

- **Archivos a tocar**: `packages/core/src/scanner.ts`, `packages/cli/src/index.ts`.
- **Implementacion**:
  - Sustituir `schemaVersion: "0.1.0"` hardcoded por constante exportada desde `packages/core/src/schema/versions.ts`.
  - Bumpear a `"0.2.0"` y documentar breaking changes en `docs/CHANGELOG-schemas.md`.
- **Criterios**:
  - [ ] Todos los artefactos emitidos llevan `schemaVersion: "0.2.0"`.
  - [ ] Tests existentes actualizados.

---

## Sprint 2 - Cache + BLAKE3 + reuso incremental ✅ COMPLETADO

**Objetivo**: Skip de trabajo cuando no hay cambios. Sin esto, "no relectura completa" es mentira.

### S2.T1 - Reemplazar SHA-256 por BLAKE3 en scanner

- **Archivos a tocar**: `packages/core/src/scanner.ts`, `packages/core/__tests__/scanner.unit.test.ts`.
- **Deps a anadir**: `@noble/hashes@^1` (provee blake3 puro JS, sin native).
- **Implementacion**:
  - Reemplazar `createHash('sha256')` por `blake3.create()`.
  - Anadir campo `hashAlgorithm: 'blake3'` al ScanResult conforme schema.
  - Mantener fallback opcional `--hash sha256` para retrocompatibilidad (1 release).
- **Tests**:
  - Verificar que hash de archivo conocido coincide con vector de prueba blake3.
- **Criterios**:
  - [ ] Scan emite hashes blake3 por default.
  - [ ] Schema validation pasa (`hashAlgorithm` enum).

### S2.T2 - Cache por hash en `forge scan`

- **Archivos a crear**: `packages/core/src/cache/scanCache.ts`, `packages/core/__tests__/scanCache.unit.test.ts`.
- **Implementacion**:
  - Mantener `.contextforge/cache/scan-cache.json` con `{ files: { [path]: { hash, size, mtime, kind, lang } } }`.
  - Antes de hashear: stat + comparar mtime y size. Si igual al cache, reusar hash sin leer contenido.
  - Si distinto: re-hashear y actualizar cache.
  - Reportar al final: `[scan] 1234 files: 12 changed, 1222 cache-hit (98.9%)`.
- **Criterios**:
  - [ ] Re-correr `forge scan` sin cambios usa cache (medible: tiempo < 20% del primer run en repo > 500 archivos).
  - [ ] Cambiar 1 archivo invalida solo ese (test verifica).

### S2.T3 - Cache de scan referenciable desde graph

- **Archivos a tocar**: `packages/cli/src/index.ts` (cmdGraph).
- **Implementacion**:
  - `graph.json` debe llevar `scanRef: { path, scanHash }` conforme schema.
  - `scanHash` = blake3 del propio `scan.json` serializado.
  - Si scanHash no cambio entre runs: graph puede skip rebuild (preparacion para S3.T4).
- **Criterios**:
  - [ ] Field `scanRef` presente y correcto en `graph.json`.

---

## Sprint 3 - Grafo real con tree-sitter ✅ COMPLETADO

**Objetivo**: Pasar de "lista de archivos" a "grafo de simbolos con edges reales". Esta es la piedra angular del valor del producto.

### S3.T1 - Setup `web-tree-sitter` con grammars TS/JS/Python/Go/Rust/Java

- **Archivos a crear**: `packages/core/src/parser/treeSitter.ts`, `packages/core/__tests__/treeSitter.unit.test.ts`.
- **Deps a anadir**: `web-tree-sitter@^0.25`, scripts para descargar grammars precompiladas (.wasm) a `packages/core/grammars/`.
- **Implementacion**:
  - Loader que inicializa Parser y carga grammar por lang.
  - `parseFile(filePath, lang) -> { ast, captures }`.
  - Determinacion de lang por ext (`.ts -> typescript`, `.tsx -> tsx`, `.py -> python`, etc).
- **Tests**:
  - Parse de fixture TS con 1 funcion exportada: verificar que extrae nodo function_declaration.
  - Parse fixture Python con 1 clase: verificar class_definition.
- **Criterios**:
  - [ ] `pnpm install` descarga grammars sin compilation step.
  - [ ] Funciona en Windows + macOS + Linux (verificar matriz CI).

### S3.T2 - Extractor de simbolos por lenguaje

- **Archivos a crear**: `packages/core/src/parser/symbols/{typescript,python,go,rust,java}.ts`, queries `.scm` adyacentes.
- **Implementacion**:
  - Por lang: query `.scm` que captura definitions (function, class, method, interface, type, const exportado) y references (calls, imports).
  - Output uniforme: `Symbol[] = { name, kind, exported, signature, loc }`.
  - Imports: `Import[] = { source, imported: string[], default?: string }`.
- **Tests**:
  - Por lang, fixture con 3+ simbolos y verificar extraccion completa.
- **Criterios**:
  - [ ] Cobertura de simbolos exportados >= 95% en suite de fixtures.
  - [ ] Imports resueltos a paths relativos cuando posible.

### S3.T3 - Graph builder real

- **Archivos a tocar**: `packages/cli/src/index.ts` (`cmdGraph`), nuevos en `packages/core/src/graph/builder.ts`.
- **Implementacion**:
  - Para cada file `kind=code` en scan: parsear, extraer simbolos + imports.
  - Crear nodos `file:<path>` y `symbol:<path>#<name>`.
  - Crear edges:
    - `defines`: file -> symbol.
    - `imports`: file -> file (resolviendo el modulo).
    - `calls`: symbol -> symbol (cuando call es a un import resuelto).
    - `references`: symbol -> symbol (otros usos no-call).
    - `tests`: file (kind=test) -> file (impl) cuando comparten basename o tiene heuristica clara.
  - Persistir conforme schema, incluyendo `parser`, `stats`, `scanRef`.
- **Tests**:
  - Repo fixture pequeno (5 archivos TS) con grafo esperado en JSON. Comparar exact match.
- **Criterios**:
  - [ ] Grafo no vacio para repo de muestra.
  - [ ] `nodes.symbol` count > 0.
  - [ ] `edges.imports` count > 0.
  - [ ] Schema validation pasa.

### S3.T4 - Cache incremental del grafo

- **Archivos a tocar**: `packages/core/src/graph/builder.ts`, anadir `packages/core/src/cache/graphCache.ts`.
- **Implementacion**:
  - Cache por archivo: `{ fileHash, symbols, outgoingEdges }` en `.contextforge/cache/graph-cache.json`.
  - Si fileHash igual al cache: reusar entries sin re-parse.
  - Si scan no detecto cambios: skip rebuild completo, solo recargar `graph.json` previo.
- **Criterios**:
  - [ ] Cambiar 1 archivo re-parsea solo ese (tiempo log).
  - [ ] Reporte: `[graph] 1234 files: 1 reparsed, 1233 cache-hit`.

---

## Sprint 4 - Context selector con PageRank + budget ✅ COMPLETADO

**Objetivo**: La pieza diferencial. Sin esta, ContextForge no se distingue de un walker con globs.

### S4.T1 - Importar grafo a `graphology`

- **Archivos a crear**: `packages/core/src/selector/graphLoader.ts`.
- **Deps a anadir**: `graphology@^0.26`, `graphology-metrics@^2`.
- **Implementacion**:
  - Cargar `graph.json` a `DirectedGraph` (multigraph para soportar multiples edges entre mismos nodos).
  - Asignar weights por edge type segun DV-09: defines=1.0, imports=0.8, calls=1.0, references=0.6, tests=1.2.
- **Tests**:
  - Cargar grafo fixture y verificar order/size correctos.

### S4.T2 - Personalized PageRank

- **Archivos a crear**: `packages/core/src/selector/pagerank.ts`.
- **Implementacion**:
  - Funcion `personalizedPageRank(graph, seedNodeIds, opts)` con default alpha=0.85, iterations=50, tolerance=1e-6.
  - Personalization vector: seeds=100, vecinos a depth 1 = 10, default = 1.
  - Retorna `Map<nodeId, score>`.
- **Tests**:
  - Grafo de juguete (10 nodos): verificar que seeds tienen score mas alto que nodos no conectados.
  - Determinismo: 2 runs sobre mismo input dan mismo output exacto.

### S4.T3 - BFS depth-bounded + scoring combinado

- **Archivos a crear**: `packages/core/src/selector/scoring.ts`.
- **Implementacion**:
  - BFS desde seeds hasta depth=2 (configurable).
  - Por nodo alcanzado: registrar `bfsDistance`, edge types vistos.
  - `combinedScore = pageRankScore * (1 / (1 + bfsDistance)) * edgeTypeMultiplier`.
- **Tests**:
  - Seeds con 1 vecino directo y 1 a depth 2: verificar orden de scores.

### S4.T4 - Greedy budget pack + degradacion progresiva

- **Archivos a crear**: `packages/core/src/selector/packer.ts`.
- **Implementacion**:
  - Input: scoredNodes ordenados desc + budget + tokenizer.
  - Asignar mode inicial (default `full`).
  - Iterar: sumar tokens. Si excede budget:
    - Degradar el nodo de menor score: `full -> excerpt -> summary`.
    - Si todos en `summary` y aun excede: excluir nodo de menor score (registrar en `excluded[]`).
  - Generar `excerpt` deterministically: por simbolo, signatura + 5 lineas siguientes.
  - Generar `summary` deterministically: solo signaturas exports + path + imports.
- **Tests**:
  - Budget pequeno fuerza degradacion: verificar que nodo de mayor score queda `full` y menor queda `summary` o excluido.

### S4.T5 - Tokenizer adapter (Anthropic + fallback)

- **Archivos a crear**: `packages/core/src/tokenizer/index.ts`, `packages/core/src/tokenizer/anthropic.ts`, `packages/core/src/tokenizer/tiktoken.ts`.
- **Deps a anadir**: `js-tiktoken@^1` (fallback offline). NO instalar SDK Anthropic; usar `fetch` directo a `/v1/messages/count_tokens` cuando `ANTHROPIC_API_KEY` esta seteada.
- **Implementacion**:
  - `countTokens(text, opts: { model?: string }): Promise<number>`.
  - Si `ANTHROPIC_API_KEY` y `--tokenizer=anthropic`: llamar API.
  - Default y fallback: `js-tiktoken` con `o200k_base`.
  - Batch: agrupar archivos en una llamada cuando se use Anthropic (rate limit friendly).
- **Tests**:
  - Mockear fetch para Anthropic, verificar payload.
  - Fallback funciona sin red.

### S4.T6 - Cablear `cmdContext` end-to-end + token ledger

- **Archivos a tocar**: `packages/cli/src/index.ts` (`cmdContext`), nuevos en `packages/core/src/ledger/tokenLedger.ts`.
- **Implementacion**:
  - `forge context "<task>" [--seeds path1,path2] [--budget 12000] [--tokenizer auto|anthropic|tiktoken]`.
  - Pipeline: load graph -> resolve seeds -> pagerank -> bfs -> score -> pack -> emit context-pack.json + token-ledger.json.
  - Ledger calcula baseline (`full_repo_dump` por defecto), packed, savings, costo en 3 escenarios.
- **Tests**:
  - Fixture repo con tarea conocida: pack debe respetar budget y ledger debe reportar savings >= 50%.
- **Criterios**:
  - [ ] `forge context "fix scanner ignore"` produce pack y ledger validos.
  - [ ] `savingsPct >= 80%` en fixture de referencia.
  - [ ] `compressionRatio >= 5` en fixture de referencia.

---

## Sprint 5 - Spec SDD evidence-backed + interop OpenSpec ✅ COMPLETADO

**Objetivo**: Convertir context-pack en spec accionable, opcionalmente en formato OpenSpec.

### S5.T1 - Plantilla SDD inyectable con evidencia del grafo

- **Archivos a tocar**: `.contextforge/templates/spec.sdd.md`, nuevo `packages/core/src/spec/render.ts`.
- **Implementacion**:
  - Render del template con variables: `title`, `task`, `seeds`, `affectedFiles[]` (de context-pack), `affectedSymbols[]`, `acceptanceCriteria[]`, `risks[]`.
  - Cada criterio de aceptacion debe enlazar a archivos/simbolos del context-pack.
- **Tests**:
  - Render con context-pack fixture produce spec con secciones esperadas.

### S5.T2 - `forge spec` con context-pack como evidencia

- **Archivos a tocar**: `packages/cli/src/index.ts` (`cmdSpec`).
- **Implementacion**:
  - Lee `context-pack.json` requerido.
  - Si `--llm` no especificado: emite plantilla con evidencia inyectada (placeholders para problema/diseno).
  - Si `--llm <model>`: futuro (post-MVP), llamada a agente con prompt corto y contexto = pack.
- **Criterios**:
  - [ ] Spec generado referencia archivos del pack.
  - [ ] Sin `--llm` no llama red.

### S5.T3 - Modo `--emit openspec`

- **Archivos a crear**: `packages/core/src/spec/openspec.ts`, `packages/core/__tests__/openspec.unit.test.ts`.
- **Implementacion**:
  - `forge spec "fix-auth-bug" --emit openspec` produce:
    - `openspec/changes/fix-auth-bug/proposal.md`
    - `openspec/changes/fix-auth-bug/design.md`
    - `openspec/changes/fix-auth-bug/tasks.md` (numerada T1, T1.1, T2 conforme convencion OpenSpec).
    - `openspec/changes/fix-auth-bug/specs/<domain>/spec.md` con `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements`.
  - Domain inferido del path mas tocado en context-pack (heuristica: top-level folder bajo `packages/<X>/src/<domain>` o `src/<domain>`).
- **Tests**:
  - Generar para change-id de ejemplo y validar estructura de carpetas + secciones requeridas.
- **Criterios**:
  - [ ] Estructura coincide con docs OpenSpec (ver concepts.md upstream).
  - [ ] Requirements en formato Given/When/Then + RFC 2119 (MUST/SHALL/SHOULD/MAY).

### S5.T4 - Spec con criterios verificables

- **Archivos a tocar**: plantilla y renderer.
- **Implementacion**:
  - Cada criterio debe ser ejecutable: o test (con path), o comando (con expected output), o linter rule.
  - Validador opcional `forge spec --check`: parsea spec y verifica que criterios sean parseables a verifiable assertions.
- **Criterios**:
  - [ ] Spec de ejemplo tiene >= 3 criterios verificables.

---

## Sprint 6 - Implement-plan con guardrails ✅ COMPLETADO

**Objetivo**: Plan que un agente puede ejecutar de forma segura, validable post-edit.

### S6.T1 - `cmdImplement` produce plan conforme schema

- **Archivos a tocar**: `packages/cli/src/index.ts` (`cmdImplement`).
- **Implementacion**:
  - Lee context-pack + spec.
  - Construye `implement-plan.json` con:
    - `guardrails.allowedFiles` = files del context-pack (mode != summary) + globs derivados.
    - `guardrails.forbiddenPaths` = defaults: `**/.env*`, `**/secrets/**`, `**/.git/**`.
    - `guardrails.maxLocDelta` = heuristica: sum(files) \* 50 lineas, capped a 1000.
    - `guardrails.maxFilesChanged` = files.length + 2 (margen para nuevos tests).
    - `guardrails.requiredTests` = paths de tests asociados (edges `tests`).
    - `tasks[]` derivadas de spec.
- **Tests**:
  - Plan generado valida contra schema.
  - allowedFiles no incluye forbiddenPaths.

### S6.T2 - `forge implement --check` (validador post-edit)

- **Archivos a crear**: `packages/core/src/implement/validator.ts`, `packages/cli` con subcommand.
- **Implementacion**:
  - `forge implement --check` corre en repo despues que un agente edito.
  - Compara `git diff` vs guardrails:
    - Archivos modificados deben matchear `allowedFiles` y NO matchear `forbiddenPaths`.
    - LOC delta total <= `maxLocDelta`.
    - Files count <= `maxFilesChanged`.
    - Si `requiredTests` definido: verifica que existen y pasan (`pnpm test <path>`).
    - Si `preserveAPI` definido: parsear simbolos listados, comparar signatura pre/post.
  - Output: `validation` block del schema con `violations[]` y `passed`.
- **Tests**:
  - Diff que excede maxLocDelta -> violation.
  - Diff que toca forbiddenPath -> violation.
  - Diff limpio dentro de guardrails -> passed=true.
- **Criterios**:
  - [ ] Comando exit code 0 cuando passed=true, 3 cuando hay violations.

### S6.T3 - Status transitions

- **Archivos a tocar**: validador.
- **Implementacion**:
  - `plan_only` -> `approved_for_edit`: requiere flag explicito `forge implement --approve` con confirmacion.
  - `approved_for_edit` -> `completed`: solo si `--check` pasa.
  - `rejected`: en cualquier momento, registra reason.
- **Criterios**:
  - [ ] No hay path automatico plan_only -> approved.

### S6.T4 - Doc + ejemplo end-to-end

- **Archivos a crear**: `docs/EXAMPLES/end-to-end-flow.md`.
- **Contenido**:
  - Walkthrough completo: init -> scan -> graph -> context -> spec -> implement -> agente edita -> --check -> completed.
  - Snippet con outputs reales y validacion en cada paso.
- **Criterios**:
  - [ ] Doc reproduce flujo en <2 minutos en repo de muestra.

---

## Sprint 7 - Grafo visual interactivo (COMPLETADO)

**Objetivo**: Visualizacion HTML interactiva del grafo de conocimiento con domain view, summaries y tour guiado.

### S7.T1 - `forge viz` CLI command ✅

- **Archivos tocados**: `packages/cli/src/index.ts`, `packages/cli/src/htmlTemplate.ts`.
- **Implementacion**: `cmdViz()` lee `graph.json` + `context-pack.json` y emite `.contextforge/graph.html`.
- **Criterios**:
  - [x] `pnpm forge viz` escribe `.contextforge/graph.html`.
  - [x] HTML se abre en navegador sin servidor.

### S7.T2 - Domain View con layout topologico ✅

- **Implementacion**:
  - `getDomain(path)` → agrupa por paquete/directorio raiz.
  - `topoSort(domains, edges)` → Kahn's algorithm para layout horizontal.
  - `buildDomainElements()` → posiciones preset en Cytoscape.
  - Toggle entre vista Grafo y vista Dominios con sidebar independiente.
- **Criterios**:
  - [x] Vista dominios muestra paquetes como nodos con dependencias cruzadas.
  - [x] Layout topologico (izquierda a derecha por dependencia).

### S7.T3 - Summaries en lenguaje natural ✅

- **Implementacion**: `generateSummary(node)` genera descripcion desde estructura Cytoscape (edges, tipos, conteos). Sin LLM.
- **Criterios**:
  - [x] Click en nodo muestra resumen legible (define N simbolos, importado por M archivos…).

### S7.T4 - Tour guiado por context-pack ✅

- **Implementacion**: `tourNext()`, `tourPrev()`, `tourStop()`. Auto-pan + zoom + highlight de vecindad.
- **Criterios**:
  - [x] Tour itera sobre archivos del context-pack con indicador de progreso.
  - [x] Nodos del pack resaltados en naranja.

### S7.T5 - Workspace imports conectados ✅

- **Archivos tocados**: `packages/core/src/graph/builder.ts`.
- **Implementacion**: `buildWorkspaceAliases()` lee `packages/*/package.json` y resuelve `@contextforge/core → packages/core/src/index.ts`.
- **Criterios**:
  - [x] Grafo tiene edges cross-package (cli → core).
  - [x] No mas estrellas aisladas por imports de workspace.

### S7.T6 - Filtro code/test en context selector ✅

- **Archivos tocados**: `packages/core/src/selector/index.ts`.
- **Implementacion**: Filter `kind === "code" || kind === "test"` antes del PageRank.
- **Criterios**:
  - [x] Context-pack no incluye archivos config/doc/schema.
  - [x] Pack verificado: 19 code + 11 test = 30 archivos, 11 700 tokens.

---

## Sprint 8 - MCP Server para agentes (COMPLETADO)

**Objetivo**: Servidor MCP que expone el grafo de ContextForge a agentes de IA para queries quirurgicas durante implementacion.

### S8.T1 - Paquete `@contextforge/mcp` ✅

- **Archivos creados**: `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/src/index.ts`.
- **Deps**: `@modelcontextprotocol/sdk@^1.29.0`, `zod@^3.22.0`.
- **Criterios**:
  - [x] `pnpm --filter @contextforge/mcp build` compila sin errores.
  - [x] `node packages/mcp/dist/index.js` arranca el servidor MCP.

### S8.T2 - 5 tools MCP implementados ✅

- **forge_status**: estado de artifacts `.contextforge/*.json` con freshness.
- **forge_context**: PageRank sobre grafo cacheado, devuelve archivos rankeados.
- **forge_neighbors**: BFS desde un archivo, agrupa por imports/importedBy/tests/defines.
- **forge_domain_map**: mapa de dominios con dependencias cruzadas.
- **forge_check**: valida guardrails contra `git diff --name-only HEAD`.
- **Criterios**:
  - [x] `forge_status` responde con estado real de artifacts.
  - [x] `forge_context("tarea")` devuelve lista de archivos rankeados.
  - [x] Resolucion de PROJECT_ROOT via env var o walk-up estatSync.

### S8.T3 - Configuracion opencode.json ✅

- **Archivos creados**: `opencode.json`.
- **Criterios**:
  - [x] OpenCode detecta el servidor MCP al iniciar en este repo.

---

## Sprint 9 - Diátaxis docs scaffolder + Claude skills ✅ COMPLETADO

**Objetivo**: Comando `forge docs` deterministico que genera estructura Diátaxis lista para usar, mas skills concisas para Claude Code.

### S9.T1 - `buildDiataxisScaffold` en core ✅

- **Archivos creados**: `packages/core/src/docs/scaffolder.ts`, `packages/core/__tests__/docsScaffolder.unit.test.ts`.
- **Implementacion**: Factory deterministica que produce 6 folders (tutorials/how-to/reference/explanation/adr/architecture) + INDEX.md + adr/README.md + architecture/module-relationships.md (opcional desde graph).
- **Criterios**:
  - [x] 10 unit tests cubriendo folders, frontmatter, generacion condicional desde graph.
  - [x] Cobertura del modulo: 96.55 % statements / 86.11 % branches.

### S9.T2 - Comando `forge docs` ✅

- **Archivos tocados**: `packages/cli/src/index.ts` (cmdDocs + case en runCommand).
- **Implementacion**: Lee `.contextforge/graph.json` opcionalmente, genera scaffold con plantillas exactas. Flag `--force` para sobrescribir.
- **Criterios**:
  - [x] `pnpm forge docs` crea folders y archivos sin sobrescribir existentes.
  - [x] `--force` sobrescribe.
  - [x] `architecture/module-relationships.md` se genera desde graph (25 dominios + cross-deps).

### S9.T3 - Skills concisas para Claude Code ✅

- **Archivos creados**: `.claude/skills/contextforge-flow.md`, `.claude/skills/contextforge-spec.md`, `.claude/skills/contextforge-docs.md`.
- **Implementacion**: 3 skills <= 45 lineas cada uno con frontmatter `name`/`description`. Token-efficient: cargan solo la guia esencial sin gastar contexto.
- **Criterios**:
  - [x] Cada skill <= 60 lineas (objetivo: 30-40).
  - [x] Cubren: flujo completo, generacion de spec, uso de forge docs.

---

## Sprint 10 - Publicacion en GitHub Packages ✅ COMPLETADO

**Objetivo**: Hacer los paquetes instalables via `npx` y `npm install` desde GitHub Packages.

### S10.T1 - Rename de scope para GitHub Packages ✅

- **Archivos tocados**: 5 package.json + 4 archivos TypeScript + vitest.config.ts.
- **Implementacion**: `@contextforge/*` → `@anai-raia-alex/contextforge-*` (scope debe coincidir con GitHub username).

### S10.T2 - Workflow de publicacion ✅

- **Archivos creados**: `.github/workflows/publish.yml`, `.npmrc`.
- **Implementacion**: Trigger en `v*.*.*` tags. Build + test + publish 3 paquetes (core, cli, mcp) con `GITHUB_TOKEN`.
- **Criterios**:
  - [x] Tag `v0.1.0` creado y empujado.
  - [x] Workflow ejecutable manualmente con `workflow_dispatch`.

---

## Sprint 11 - forge sync + forge impact ✅ COMPLETADO

**Objetivo**: Cerrar el ciclo de mantenimiento con dos comandos deterministas: `forge sync` para delta basado en git + grafo, y `forge impact` para health check de artifacts + skill coverage.

### S11.T1 - `forge sync` reporte incremental

- **Archivos creados**: `packages/core/src/sync/syncReport.ts`, `packages/core/__tests__/syncReport.unit.test.ts`.
- **Archivos tocados**: `packages/cli/src/index.ts` (cmdSync + case en runCommand), `packages/core/src/index.ts` (export).
- **Implementacion**:
  - Pure logic: `buildSyncReport({ changedFiles, graphScanHash, scanFileHash, contextPackPaths, contextPackTask })`.
  - CLI: `git diff --name-only <since> HEAD` (default `HEAD~1`, configurable con `--since`).
  - Mapea archivos -> dominios via `getDomain()` extraido a core.
  - Detecta `graphStale` por hash mismatch y `contextPackAffected` por interseccion de paths.
  - `--rebuild` corre `cmdScan + cmdGraph` despues del reporte.
- **Criterios**:
  - [x] 8 tests unitarios cubren empty input, multi-domain grouping, hash mismatch, pack interseccion, recomendaciones.
  - [x] `pnpm forge sync` imprime archivos cambiados, dominios y recomendaciones.

### S11.T2 - `forge impact` health check

- **Archivos creados**: `packages/core/src/impact/healthCheck.ts`, `packages/core/__tests__/healthCheck.unit.test.ts`.
- **Archivos tocados**: `packages/cli/src/index.ts` (cmdImpact + case en runCommand), `packages/core/src/index.ts` (export), 3 skills en `.claude/skills/*.md` (frontmatter `tags:`).
- **Implementacion**:
  - Pure logic: `buildHealthReport({ artifacts, graphScanHash, scanFileHash, contextPackTokens/Budget, graphDomains, skillTags })`.
  - Artifacts: existencia + ageMinutes + warning si > 60 min en scan/graph/context-pack.
  - Coverage: matching tag <-> dominio (incluye `core` -> `packages/core`, `all-domains` -> universal).
  - Budget: warning si > 90 % del budget.
  - CLI: parsea frontmatter de `.claude/skills/*.md` con regex tolerante (array `[a, b]` o csv).
- **Criterios**:
  - [x] 9 tests unitarios cubren missing artifact, freshness, hash mismatch, budget, coverage, savings, stale.
  - [x] `pnpm forge impact` imprime artifacts + coverage + suggestions.

### S11.T3 - Refactor: `getDomain` en core

- **Archivos creados**: `packages/core/src/graph/domain.ts`.
- **Archivos tocados**: `packages/core/src/index.ts` (export), `packages/mcp/src/handlers.ts` (importa desde core, re-exporta para preservar API).
- **Criterios**:
  - [x] Tests del MCP siguen pasando con la importacion via core.

---

## Sprint 12 - forge skills (auto-domain-skills) ✅ COMPLETADO

**Objetivo**: Auto-generar un skill por dominio en `.claude/skills/ctx-<domain>.md` para que Claude Code lo auto-cargue cuando el dev abre archivos del dominio. Inspirado en aspenkit/aspens pero sin LLM, manteniendo el principio determinismo-first.

### S12.T1 - `buildDomainSkills` en core ✅

- **Archivos creados**: `packages/core/src/skills/skillBuilder.ts`, `packages/core/__tests__/skillBuilder.unit.test.ts`.
- **Archivos tocados**: `packages/core/src/index.ts` (export `buildDomainSkills`, `DomainSkillsOptions`, `DomainSkillsResult`, `DomainSkillFile`).
- **Implementacion**:
  - Pure logic: `buildDomainSkills({ nodes, edges, minFilesPerDomain?, maxFilesShown?, maxTestsShown? })`.
  - Reuso de `getDomain()` desde `packages/core/src/graph/domain.ts`.
  - Cálculo de degree (in + out) en una sola pasada por edges.
  - Agrupación cross-domain `dependsOn` / `usedBy` solo para edges `imports`.
  - `inferPurpose(filePath)` deterministic (camelCase → kebab-case, `index.ts` usa parent dir).
  - `slugify(domain)`: `packages/core` → `packages-core`, `src` → `src`.
  - Dominios con < `minFilesPerDomain` (default 2) → `result.skipped[]`, no se genera archivo.
  - Plantilla heredoc con secciones condicionales (`Depends on` / `Used by` / `Tests in this domain` se omiten si están vacías).
- **Criterios**:
  - [x] ≥ 8 unit tests cubriendo cada Scenario del spec OpenSpec (`auto-domain-skills/specs/core/spec.md`).
  - [x] Cobertura del módulo ≥ 80 %.
  - [x] Determinismo byte-for-byte verificado en test.

### S12.T2 - Comando `forge skills` ✅

- **Archivos tocados**: `packages/cli/src/index.ts` (`cmdSkills` + case en `runCommand` + `printUsage`).
- **Implementacion**:
  - Lee `.contextforge/graph.json` con `readRequiredJson` (error claro si falta).
  - Llama `buildDomainSkills({ nodes, edges })`.
  - Por cada `DomainSkillFile`: si existe y NO hay `--force` → `[skip]`; si no existe o hay `--force` → escribir.
  - Reporta dominios omitidos al final con razón.
- **Criterios**:
  - [x] `pnpm forge skills` genera ≥ 3 skills (`ctx-packages-core.md`, `ctx-packages-cli.md`, `ctx-packages-mcp.md`).
  - [x] Re-ejecutar sin `--force` produce `[skip]` para skills existentes.
  - [x] `--force` sobrescribe.

### S12.T3 - Documentación ✅

- **Archivos tocados**: `README.md` (fila en tabla de comandos, paso 10 en "Uso rápido", sección "Skills por dominio (`forge skills`)") y `docs/IMPLEMENTATION_TASKS.md` (S12 en tabla de estado, Sprint 12 con S12.T1/T2/T3, conteo de tests actualizado).
- **Criterios**:
  - [x] README documenta el comando con ejemplo de frontmatter.
  - [x] `forge --help` (sin args) lista `pnpm forge skills [--force]`.

---

## Backlog post-MVP

| ID  | Item                                           | Esfuerzo | Valor | Estado                                           |
| --- | ---------------------------------------------- | -------- | ----- | ------------------------------------------------ |
| B1  | Tests del MCP server (handlers.unit.test.ts)   | Medio    | Alto  | ✅ Completado — 14 tests, handlers.ts 85.75 %    |
| B2  | `packages/agents/` — vacio                     | Bajo     | Bajo  | ✅ Eliminado (skills viven en `.claude/skills/`) |
| B3  | Adaptador Cursor (`.cursor/rules/`)            | Bajo     | Medio | ✅ Completado                                    |
| B4  | Soporte Spec-Kit (`forge spec --emit speckit`) | Medio    | Bajo  | Pendiente                                        |
| B5  | Reciprocal Rank Fusion (recencia/embeddings)   | Alto     | Bajo  | Post-v0.5                                        |
| B6  | `forge eval` — benchmark savings + quality     | Alto     | Alto  | Pendiente                                        |
| B7  | OpenTelemetry metric collector (opt-in)        | Medio    | Bajo  | Post-v0.5                                        |
| B8  | `forge implement` end-to-end con LLM real      | Alto     | Medio | Post-v0.5                                        |

### Estado del backlog original

| ID  | Item original                         | Estado                  |
| --- | ------------------------------------- | ----------------------- |
| B1  | Adaptador Claude Code (slash command) | Pendiente               |
| B2  | Adaptador Codex                       | Pendiente               |
| B3  | Adaptador Cursor                      | Pendiente               |
| B4  | Soporte Spec-Kit                      | Pendiente               |
| B5  | Reciprocal Rank Fusion                | Pendiente               |
| B6  | Visualizador HTML grafo               | **✅ Completado en S7** |
| B7  | `forge eval` benchmark                | Pendiente               |
| B8  | OpenTelemetry metric collector        | Pendiente               |

---

## Definicion de "done" por sprint

Un sprint se considera done cuando:

1. Todos sus tasks tienen `[x]` en sus criterios.
2. CI verde con la nueva funcionalidad.
3. `CONTEXTFORGE_SOURCE_OF_TRUTH.md` actualizado si hubo decisiones nuevas.
4. Demo manual reproducible de la funcionalidad en repo de muestra.
5. Cobertura de tests para nuevo codigo >= 80%.
