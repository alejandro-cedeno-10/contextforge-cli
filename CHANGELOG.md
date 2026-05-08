# Changelog

All notable changes to ContextForge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.8] — 2026-05-08

### Fixed

- **CI lint pipeline.** Prettier reportaba 14 archivos sin formatear que
  bloqueaban `pnpm lint` en GitHub Actions. Reformateado con
  `prettier --write` (cambios cosméticos: indentación de tablas markdown,
  saltos de línea consistentes en arrays/objetos largos). Sin cambios de
  comportamiento. Re-publica todo lo que iba en v0.3.7.

### Changed — Subgrafo `compact` por defecto (token savings)

- **`graph.subset.json` ahora es ~50% más pequeño por defecto.**
  En el smoke de este repo: 2851 → 1306 nodos, 2258 → 1382 aristas.
  Antes el subgrafo arrastraba TODOS los símbolos (incluidos internos) de
  cada archivo alcanzable 1-hop. Ahora arrastra solo los **símbolos
  exportados de los focus files**; los archivos vecinos entran como nodos
  `file` sin sus símbolos. Si necesitas ver internos de un vecino, usa
  `forge_neighbors` sobre ese archivo en vez de inflar el subgrafo.

- **Flag `--subgraph-full` (opt-in legacy).**
  Restaura el comportamiento de v0.3.7: cada símbolo de cada archivo del
  subgrafo. Útil cuando estás depurando o haciendo análisis estático
  exhaustivo del change.

- **`stats.mode` en `graph.subset.json`** (`"compact"` | `"full"`) para que
  el consumidor sepa qué tan exhaustivo es el subgrafo que está leyendo.

### Added — Skill resumida `contextforge-openspec-change`

- **`.claude/skills/contextforge-openspec-change.md`** — task-oriented,
  concisa. Dice al agente cómo trabajar un change con el subgrafo
  congelado, en qué orden leer el directorio, qué tools MCP llamar y en
  qué orden, y cuándo escalar al grafo global. La idea: léelo una vez al
  inicio de la sesión y deja de explorar el repo a ciegas.

### Changed — Cierra el loop subgrafo↔OpenSpec

- **`graph.subset.{json,html}` se escriben DESPUÉS de `openspec new change`.**
  Antes se escribían antes, así que un scaffold destructivo de OpenSpec
  podía pisarlos. Ahora sobreviven sí o sí.

- **Nuevo `openspec/changes/<id>/context.md`** — mapa human/agent-friendly
  del directorio del change: orden de lectura, paths globales referenciados
  con `../../.contextforge/...`, ejemplos copy-paste de tools MCP. Pone
  por escrito la regla "subgrafo primero, global solo como fallback".

- **MCP descriptions reforzadas** para que el agente prefiera el subgrafo:
  - `forge_change_subgraph` se marca PRIMARY para changes activos.
  - `forge_context` y `forge_neighbors` añaden notas: "call
    forge_change_subgraph FIRST when working on a change".
  - `forge_status` ahora lista todo change con `graph.subset.json` con
    nodes/edges + el comando MCP literal a copiar.

### Added — Subgrafo por OpenSpec change (`forge spec`)

- **`openspec/changes/<id>/graph.subset.json`.**
  `forge spec` ahora extrae un subgrafo limitado al context-pack del change
  (1-hop por aristas `imports`/`extends`/`implements`/`tests`/`calls`/`references`)
  y lo escribe **dentro del directorio del change**, junto a
  `proposal/design/tasks/specs`. El subset es self-contained y byte-estable.

- **`openspec/changes/<id>/graph.subset.html`.**
  Viewer interactivo standalone con los archivos del change resaltados. Reusa
  el motor de `forge viz` (Cytoscape vía CDN, sin servidor). Abrirlo en el
  navegador da revisión visual instantánea: qué tocó este change, sus deps
  directas, símbolos exportados vs internos, paquetes externos. Sustituye al
  dashboard rico de Understand-Anything pero determinista.

- **`design.md` incluye sección "Context graph (subset)".**
  Stats tabulares + referencias al `graph.subset.json` (datos), al
  `graph.subset.html` (visual) y al tool MCP. Las skills y prompts que leen
  `openspec/changes/<id>/` no necesitan saltar a `.contextforge/graph.json`.

- **MCP tool `forge_change_subgraph({ change_id })`.**
  Octavo tool del servidor MCP. Lee el subset y lo devuelve crudo, ideal para
  agentes que arrancan una sesión de implementación con el contexto exacto
  congelado al momento de la autorización del spec.

- **Schema `graph-subset.schema.json`.**
  Nuevo schema JSON registrado en el validator
  (`SCHEMA_VERSIONS.graphSubset = "1.0.0"`). Valida `changeId`, `focus`,
  `stats`, `nodes`, `edges`, `graphRef`.

- **+11 tests** entre `graphSubset.unit.test.ts`, `handlers.unit.test.ts` y
  el nuevo `subsetHtml.unit.test.ts`. Suite total: **260/260** (26 archivos).

### Why

Sin esto, el spec capturaba un momento del repo pero el grafo (la prueba de
ese momento) vivía fuera del change y mutaba libremente. Si alguien
refactorizaba el grafo seis meses después, no se podía reproducir cómo se
veía cuando el spec fue aprobado. El subset cierra la trazabilidad.

---

## [0.3.7] — 2026-05-08

### Added — Phase A · B · C (capa estructural)

- **`forge graph` — flag `--force`.**
  Ignora el cache global por hash del scan y el cache por archivo. Reconstruye
  desde cero. Útil al editar el parser o para depurar.

- **`forge graph` — flag `--with-calls`.**
  Detección opt-in de aristas `calls` con regex (heurística, ruido aceptado).
  El default queda determinista y limpio; los `calls` solo aparecen cuando se
  pide explícitamente.

- **`forge graph` — cache por archivo.**
  Nuevo `.contextforge/graph.cache.json` con fragments parseados por archivo
  (key = hash BLAKE3 del archivo). Las aristas cross-file (`imports`,
  `extends`, `implements`, `calls`) se recomputan siempre. Invalidación
  automática cuando el `parserVersion` o el `schemaVersion` del grafo bumpea.

- **Aristas `extends` / `implements`.**
  Se emiten cuando el parent se resuelve en el mismo archivo o en uno
  importado. TS, JS, JSX, TSX, Java, Python.

- **Nodos `folder` y aristas `contains`.**
  Sintéticos, derivados del path. Permiten navegación jerárquica en el HTML
  viewer (toggle `+ Carpetas`).

- **`exported` real por símbolo.**
  Antes hardcodeado a `true`. Ahora viene del análisis: detecta `export` /
  `pub` / mayúscula inicial (Go) / `_` (Python).

- **`parser.engine` real.**
  Reporta `"heuristic"` cuando hubo archivos parseados, `"none"` cuando no
  hubo nada code/test parseable. Antes era constante.

- **HTML viewer — folders + símbolos internos.**
  Estilo dedicado para nodos `folder` (cuadrado tenue) y para símbolos
  `exported:false` (dashed con opacidad reducida). Toggle "+ Carpetas" en la
  barra de filtros (off por defecto). Leyenda extendida con conteo.

### Added — Tier 4 (resolución, exports, LLM opt-in)

- **`forge graph` — flag `--with-refs`.**
  Aristas `references` opt-in (PascalCase, fuera de imports/definiciones).
  Resolución igual que `calls`: símbolo local primero, luego vía `imports`.

- **`forge graph` — flag `--export=<dot|graphml>`.**
  Imprime el grafo a stdout en formato Graphviz DOT o GraphML para Gephi.
  Combinable con `--force`/`--with-*`. Logs pasan a stderr en modo export.

- **Resolución por `tsconfig.paths`.**
  Lee `tsconfig.json` (con soporte JSONC: comentarios y trailing commas) y
  resuelve alias como `@/foo`, `~lib/util`, etc. usando `compilerOptions.paths`
  - `baseUrl`.

- **Nodos `package` para imports externos.**
  Cada import que no resuelve a workspace ni a path relativo emite un nodo
  `type=package` único (ej. `react`, `node:fs`, `@scope/lib`) y una arista
  `imports`. Permite ver las deps externas reales desde el grafo.

- **`forge graph --enrich` (opt-in).**
  Capa LLM **opt-in** (única excepción al default determinista). Llama la
  Anthropic API directamente con `fetch` (sin SDK) y agrega `summary`,
  `tags[1-3]`, `complexity` a símbolos exportados (clases/interfaces/funciones).
  Selecciona hasta 100 símbolos priorizando arquitectura. Requiere
  `ANTHROPIC_API_KEY`. Usa prompt caching para amortizar instrucciones
  repetidas entre batches.

- **Schema graph.json — campos opcionales `summary` / `tags` / `complexity`.**
  Aditivo, backward-compatible. Solo aparecen cuando se corrió `--enrich`.

### Performance

- **Parsing paralelo en `forge graph`.**
  El bucle secuencial `for…await parseFile` se reemplazó por `pLimit` interno
  con concurrencia `min(cpus, 8)`. Solo aplica a archivos no cacheados.

- **Output byte-estable run a run.**
  Nodos y aristas se ordenan al final por `id` y `(from, to, type)`. Dos
  corridas del mismo scan producen JSON byte-idéntico (excluyendo
  `generatedAt`), lo que mantiene el prompt cache de Claude válido entre
  iteraciones del SDD.

### Roadmap restante

- **Tree-sitter WASM real** sigue como roadmap futuro. Hoy el parser es
  heurístico (regex). Migrar a `web-tree-sitter` con grammars descargables
  permitiría detectar más casos (closures, decorators, JSX, generics complejos)
  sin tocar la API pública del builder. Es trabajo dedicado, no incluido aquí.

### Tests

- **+28 tests** entre `graphBuilder`, `graphCache` y `graphTier4`.
  Suite total: **248/248** (24 archivos).

---

## [0.3.6] — 2026-05-08

### Added

- **`forge init` — detección automática de AI IDEs instalados.**
  `openspec init` ahora recibe solo los tools que están en PATH
  (`claude`, `cursor`, `opencode`). Si ninguno se detecta, usa `claude`
  como fallback. Muestra en consola qué herramientas encontró.

### Changed

- **`forge init` — siempre regenera skills (`--force`) y re-corre `openspec init`.**
  Antes saltaba `openspec init` si `./openspec/` ya existía; ahora lo vuelve a
  correr con `--force` para sincronizar los tools detectados.
  Las skills se sobreescriben en cada `forge init` para reflejar el grafo actual.

---

## [0.3.5] — 2026-05-08

### Added

- **`forge viz` — nodos compuestos por dominio (`Agrupar`).**
  Nuevo botón "Agrupar" en la vista de grafo. Activa agrupación jerárquica:
  dominio → sub-carpeta → archivos. Cada caja es colapsable/expandible con
  un click; al colapsar muestra el conteo de archivos internos.
  El estilo usa bordes sólidos para dominios y punteados para sub-carpetas.

- **`forge viz` — árbol de archivos en vista Dominios.**
  La barra lateral de la vista Dominios ahora muestra un árbol expandible:
  dominio → sub-carpetas → archivos (★ si está en el context-pack).

- **`forge init` — pipeline completo automático.**
  Un solo `forge init` ejecuta `scan → graph → skills → context → viz` en
  secuencia. Incluye generación de skills por dominio, por lo que el manifest
  queda con skills activas desde el primer run. Los comandos individuales
  siguen existiendo para uso incremental.

- **`docs/how-to/agent-manifest-y-skills.md`** — nueva guía que explica la
  activación selectiva de skills por tarea, los archivos escritos por
  herramienta (Claude Code / Cursor / OpenCode) y el cálculo de ahorro de
  tokens.

### Fixed

- **`forge viz` — página en blanco en todos los repos** (`v0.3.4`).
  Los handlers `onclick` de `edgeList` y `buildDomainSidebar` quedaban rotos
  porque el template literal de `htmlTemplate.ts` colapsaba `\'` → `'`,
  generando un SyntaxError al cargar el script. Reemplazados por atributos
  `data-*` + listener delegado en `DOMContentLoaded`.

---

## [0.3.4] — 2026-05-08

### Fixed

- **`forge viz` — página en blanco** (bug de escaping en template literal).
  Ver nota en v0.3.5.

---

## [0.3.3] — 2026-05-07

### Fixed

- Docker build: `COPY packages/core/scripts` faltaba en el Dockerfile, lo
  que impedía que `copy-schemas.mjs` corriera durante el build de la imagen.

---

## [0.3.2] — 2026-05-07

### Added

- `forge init` ejecuta `openspec init . --tools=claude,cursor,opencode --force`
  si el CLI de OpenSpec está en PATH.
- README publicable con badges, instalación y flujo completo.

---

## [0.3.1] — 2026-05-06

### Added

- JSON Schemas para todos los artefactos (`scan`, `graph`, `context-pack`,
  `token-ledger`, `implement-plan`, `agent-manifest`) distribuidos dentro
  de `@anai-raia-alex/contextforge-core`.

---

## [0.3.0] — 2026-05-05

### Changed (breaking)

- `forge spec` ya no duplica la lógica de OpenSpec. Prepara `spec-input.json`
  y delega en `openspec new change` si el CLI está en PATH. Sin él, emite el
  scaffold moderno (`### Requirement:` + `#### Scenario:`) que pasa
  `openspec validate`.

---

## [0.2.x] — 2026-04-xx

- Publicación inicial en npmjs.com bajo el scope `@anai-raia-alex`.
- MCP server en GHCR (`ghcr.io/alejandro-cedeno-10/contextforge-mcp`).
- `forge context` con PageRank + BFS + token-ledger.
- `forge viz` (primera versión, grafo plano).
- `forge skills`, `forge manifest`, `forge implement`, `forge sync`,
  `forge impact`.
