# Proposal: auto-domain-skills

## Intent

Agregar el comando `forge skills` que auto-genera un skill por dominio del grafo de dependencias en `.claude/skills/ctx-<domain>.md`. Cada skill describe el dominio (archivos clave por conectividad, dependencias cross-domain, tests) con suficiente metadata en el frontmatter (`description`, `tags`) para que Claude Code lo auto-cargue cuando el dev trabaja en archivos de ese dominio.

Inspirado en [aspenkit/aspens](https://github.com/aspenkit/aspens), pero **sin LLM** — manteniendo el principio determinismo-first del proyecto.

## Scope

### In scope

- Nuevo módulo `packages/core/src/skills/skillBuilder.ts` con función pura `buildDomainSkills(opts) → DomainSkillsResult`
- Nuevo comando CLI `forge skills [--force]` en `packages/cli/src/index.ts`
- Tests unitarios en `packages/core/__tests__/skillBuilder.unit.test.ts` (≥ 8 tests)
- Plantilla determinista para skills generados (~30-45 líneas cada uno)
- Inferencia de "purpose" por nombre de archivo (deterministic, sin LLM)
- Slug de dominio: `packages/core` → `packages-core`, `src` → `src`
- Filtro: dominios con < 2 archivos se omiten (registrados en `skipped`)
- Orden de archivos por **degree** (in/out edges totales) descendente
- Cross-domain deps: `dependsOn` (imports salientes) + `usedBy` (imports entrantes)
- Por defecto NO sobrescribe skills existentes; flag `--force` lo permite
- Documentación: README + IMPLEMENTATION_TASKS

### Out of scope

- Generación de skills con LLM (rompe determinismo-first — decisión explícita del usuario)
- Modificar los 3 skills task-oriented existentes (`contextforge-flow.md`, `contextforge-spec.md`, `contextforge-docs.md`) — coexisten
- Hooks post-commit que regeneren skills automáticamente
- Sub-domains (lo dejamos al `getDomain()` actual: top-level package o root dir)

## Why

**Problema**: los devs trabajando en repos grandes pierden tokens cargando contexto irrelevante. Las skills task-oriented actuales son útiles pero genéricas. Falta una capa de skills **scoped por feature** que se carguen automáticamente según el archivo en que el dev está.

**Beneficio**:

- Cada `.claude/skills/ctx-<domain>.md` describe 1 feature/paquete
- Claude Code matchea por `description` y `tags` y lo auto-carga cuando aplica
- Token cost por skill: ~30-45 líneas (~300-500 tokens)
- El dev no necesita curar manualmente — `forge skills` los genera del grafo real

**Alineación con principios**:

- ✅ Determinista: deriva de `.contextforge/graph.json` (sin LLM)
- ✅ Token-efficient: cada skill cabe en < 500 tokens
- ✅ Portable: artefactos en `.claude/skills/` que cualquier agente compatible puede consumir
- ✅ Cierra el gap con Aspens sin sacrificar nuestro principio

## Evidence (context-pack)

41 archivos rankeados por PageRank, 11 438 tokens, 93.56 % ahorro vs full repo.

Archivos clave para implementación:

- `packages/core/src/index.ts` — punto de export de core (agregar nuevos exports aquí)
- `packages/core/src/graph/builder.ts` — define `GraphNode`, `GraphEdge` (tipos de input)
- `packages/core/src/graph/domain.ts` — `getDomain(filePath)` ya existe, reutilizar
- `packages/core/src/docs/scaffolder.ts` — referencia de patrón pure-logic similar
- `packages/cli/src/index.ts` — agregar `cmdSkills` siguiendo patrón de `cmdDocs`
- `packages/core/__tests__/docsScaffolder.unit.test.ts` — referencia de patrón de test

## Alternatives considered

1. **LLM-driven domain discovery (Aspens-style)** — descartado por el usuario: rompe determinismo
2. **Extender `forge docs --skills`** — descartado: scope mixto (humans vs agents) es confuso
3. **Generación automática durante `forge graph`** — descartado: implícito = sorpresa, mejor explícito
