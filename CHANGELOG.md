# Changelog

All notable changes to ContextForge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
  Un solo `forge init` ejecuta `scan → graph → context → viz` en secuencia.
  Ideal para onboarding en un repo nuevo. Los comandos individuales siguen
  existiendo para uso incremental.

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
