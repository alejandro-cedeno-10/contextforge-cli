# Proposal: agent-manifest

## Intent

Agregar un mecanismo determinista para **seleccionar por tarea** qué skills y rules debe activar un agente durante una sesión, en lugar de cargar siempre todas. Cierra el gap entre `forge context` (que ya selecciona archivos por tarea vía PageRank) y la capa de instrucciones de agente (`.claude/skills/`, `.cursor/rules/`, OpenCode), que hoy es estática.

Concretamente, en dos capas:

**Capa offline / explícita** (snapshots, CI, pre-commit):

1. Nuevo comando `forge manifest` que produce `.contextforge/agent-manifest.json` (formato neutral validable contra JSON Schema) derivando de un `context-pack.json` existente.
2. Tres renderers determinísticos por agente: Claude Code, Cursor, OpenCode.

**Capa runtime / por sesión** (lo que pidió el usuario explícitamente: selección automática según la tarea, sin pasos manuales):

3. Tool MCP `selectAgentContext({ task })` que recibe el texto de la tarea y devuelve el manifiesto **computado en memoria**, sin tocar disco. Consumible desde OpenCode y desde Claude Code (vía MCP server).
4. Hook `UserPromptSubmit` para Claude Code (config en `.claude/settings.json` plantilla) que captura el prompt, llama al core (CLI o MCP), e inyecta las skills/rules sugeridas como contexto adicional.
5. Para Cursor — limitación documentada: Cursor no expone hooks reactivos al prompt. Se cubre con dos modos: rules `Agent Requested` con `description` por dominio (modelo decide), y rules `Auto Attached` con `globs:` regenerados por `forge manifest` (activación cuando abres un archivo del dominio).

Convención opcional de frontmatter `domains: [...]` en skills y rules para mapeo explícito; fallback al naming `ctx-<slug>` para skills auto-generadas por `forge skills`.

Ningún paso usa LLM ni red. La capa runtime usa el mismo `buildAgentManifest` puro que la capa CLI; cambia solo el wrapping.

## Scope

### In scope

**Core (compartido entre capas)**

- Nuevo módulo `packages/core/src/manifest/agentManifest.ts` con función pura `buildAgentManifest(opts) → AgentManifestResult`.
- Schema `docs/schemas/agent-manifest.schema.json` validable vía `validateOrThrow("agent-manifest", ...)`.
- Lectura opcional de frontmatter `domains: [<dominio>, ...]` en `.claude/skills/*.md` y `.cursor/rules/*.mdc` para mapeo explícito. Si no está, fallback al naming `ctx-<slug>` o a `alwaysApply: true`.
- Tests unitarios `packages/core/__tests__/agentManifest.unit.test.ts` (≥ 10 tests).

**Capa offline / CLI**

- Nuevo comando CLI `forge manifest [--agents=claude,cursor,opencode] [--force]` en `packages/cli/src/index.ts`.
- Renderers determinísticos por agente:
  - **Claude Code**: emite `.claude/agent-manifest.md` (lista de skills sugeridas + razón) y un meta-skill opcional `.claude/skills/ctx-active.md` con frontmatter que lista las skills activas.
  - **Cursor**: emite `.cursor/rules/contextforge-active.mdc` con frontmatter `globs:` derivado de los archivos del context-pack y `description:` con la tarea.
  - **OpenCode**: emite `.contextforge/agent-manifest.json` (mismo neutral); el cliente lee directo o vía MCP.

**Capa runtime / por sesión**

- Tool MCP `selectAgentContext({ task: string })` en `packages/mcp/src/index.ts`. Computa el manifiesto **en memoria** llamando al core; no escribe archivos. Devuelve el JSON validado contra schema.
- Tool MCP `getAgentManifest()` (sin parámetros) — variante que lee `.contextforge/agent-manifest.json` precomputado. Útil cuando ya corriste `forge manifest`.
- Plantilla de hook `UserPromptSubmit` en `docs/integrations/claude-code-hook.md` con un snippet copy-paste para `.claude/settings.json` que dispara `selectAgentContext` y devuelve las skills/rules como `additionalContext`.
- Documentación clara de la limitación de Cursor: explicación en README de los dos modos disponibles (`Agent Requested` por dominio + `Auto Attached` por glob regenerado).
- Documentación: README + IMPLEMENTATION_TASKS.

### Out of scope

- Generación o reescritura del cuerpo de skills/rules existentes — el manifiesto solo selecciona/etiqueta, no edita contenido.
- Hook que regenere el `context-pack.json` por sesión (la capa runtime usa la **tarea del prompt** sin pasar por PageRank; si el dev quiere ranking de archivos, sigue corriendo `forge context` aparte).
- Selección de **modelos** por tarea (es otra dimensión; pertenece a un change separado tipo `per-stage-models`).
- Soporte para Codex u otros agentes más allá de los tres listados — leen el JSON neutral si lo necesitan.
- Modificar el cliente de Cursor para soportar hooks reactivos al prompt (es limitación del producto, no nuestra; la cubrimos con los modos disponibles).

## Why

**Problema (planteado por Kevin y Andrés en discusión)**:

- Hoy un dev puede tener 100 skills y 30 rules. Claude Code y Cursor solo cargan todas las descriptions; el cuerpo se carga progresivamente, pero no hay un artefacto que diga **"para este fix, estas son las que importan"**.
- `forge skills` genera una skill por dominio (estática, una vez). `.cursor/rules/contextforge.mdc` tiene `alwaysApply: true` (siempre activa, no condicional).
- El context-pack ya elige archivos por tarea — extender esa misma decisión a skills/rules es trivial y cierra el loop.

**Beneficio**:

- Un solo artefacto neutral (`.contextforge/agent-manifest.json`) consumible por cualquier agente.
- Cada renderer es ≤ 60 líneas: derivación pura desde el manifiesto.
- Tokens ahorrados en sesiones donde el agente carga skills automáticamente: si la tarea solo toca `packages/core`, las skills `ctx-packages-cli`, `ctx-packages-mcp`, `ctx-openspec` no entran en juego.
- Auditable: el manifiesto incluye `reason` por skill/rule activada.

**Alineación con principios** (`AGENTS.md`):

- ✅ Determinista: deriva de `.contextforge/context-pack.json` + frontmatter de skills/rules. Sin LLM, sin red.
- ✅ Token-efficient: el manifiesto en sí cabe en < 200 tokens; los renderers son thin.
- ✅ Portable: JSON neutral validado por schema; cada agente tiene su renderer aislado.
- ✅ No reload: solo lee artefactos ya producidos por el pipeline.

## Evidence (context-pack)

Revisión sobre el repo actual (Sprint 12 cerrado):

- `packages/core/src/selector/index.ts:26` ya produce un `SelectContextResult` con `files[]` — punto de entrada natural para derivar dominios.
- `packages/core/src/graph/domain.ts:1` expone `getDomain(filePath)` — reutilizable directo.
- `packages/core/src/skills/skillBuilder.ts:60` define el slug `ctx-<domain>` que queremos matchear en reverso.
- `.cursor/rules/contextforge.mdc:1-4` tiene frontmatter mínimo (`description`, `alwaysApply`); extensión a `domains: []` es retrocompatible.
- `packages/mcp/` ya expone tools MCP que OpenCode consume (vía `opencode.json`); agregar `getAgentManifest` es una herramienta más en el mismo registro.

## Alternatives considered

1. **Resolver activación solo en runtime del agente (no emitir manifiesto)** — descartado: distintos agentes tienen distintos mecanismos de filtrado y el cómputo se duplicaría. Un manifiesto neutral + renderers thin es más mantenible.
2. **Extender `forge context` para que emita el manifiesto siempre** — descartado por separación de responsabilidades; lo dejamos como subcomando explícito (`forge manifest`) que también puede pipelinearse al final de `forge context` con un flag opcional `--with-manifest` (no en este scope).
3. **Codegen de los `.mdc`/`.md` reescribiendo cuerpos completos** — descartado: pisaría trabajo manual del dev. Solo emitimos archivos `*-active.*` o `agent-manifest.*` cuyo nombre es del manifiesto, nunca tocamos las skills/rules curadas.
4. **Inferir dominios de skills/rules con heurísticas sobre el cuerpo del archivo** — descartado: ambiguo y rompe principio explícito > implícito. Solo leemos frontmatter o naming convencional.
