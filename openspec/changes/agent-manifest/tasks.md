# Tasks: agent-manifest

## Implementation checklist

### Capa core (pure logic + schema + tests)

- [ ] T1: Crear `packages/core/src/manifest/agentManifest.ts` con `buildAgentManifest`, tipos públicos (`AgentManifestOptions`, `AgentManifestResult`, `SkillEntry`, `RuleEntry`)
- [ ] T1.1: Implementar cálculo de `domainsTouched` reutilizando `getDomain` (`packages/core/src/graph/domain.ts`)
- [ ] T1.2: Implementar matching de skills: `alwaysApply` → `domain` (intersection con `domainsTouched`) → `explicit` (slug `ctx-<domain>`) → skipped
- [ ] T1.3: Implementar matching de rules con misma lógica + cómputo de `suggestedGlobs` desde archivos del pack
- [ ] T1.4: Ordenar `skills[]` y `rules[]` por `path` ascendente para output reproducible
- [ ] T1.5: Validar resultado contra `agent-manifest` schema antes de retornar (usar `validateOrThrow`)

- [ ] T2: Crear `docs/schemas/agent-manifest.schema.json` (Draft-07) con todos los campos del `AgentManifestResult`
- [ ] T2.1: Registrar `agent-manifest` en `packages/core/src/schema/versions.ts` con `SchemaVersionKey`
- [ ] T2.2: Verificar carga vía `preloadSchemas()` y `validate("agent-manifest", obj)`

- [ ] T3: Crear `packages/core/__tests__/agentManifest.unit.test.ts` con ≥ 10 tests
- [ ] T3.1: Test empty pack → `domainsTouched: []`, `skills: []`, `rules: []`
- [ ] T3.2: Test skill con `alwaysApply: true` → incluida como `matchType: "alwaysApply"`
- [ ] T3.3: Test skill con `domains: [packages/core]` y pack que toca ese dominio → `matchType: "domain"`
- [ ] T3.4: Test skill `ctx-packages-cli` sin frontmatter `domains` → `matchType: "explicit"` cuando aplica
- [ ] T3.5: Test skill cuyo dominio no es tocado → en `skipped.skills` con razón `"domain not touched"`
- [ ] T3.6: Test rule cross-domain → `suggestedGlobs` contiene un glob por dominio tocado
- [ ] T3.7: Test determinismo: dos runs idénticos producen manifiestos byte-identical
- [ ] T3.8: Test schema validation: manifiesto producido pasa `validateOrThrow("agent-manifest", ...)`
- [ ] T3.9: Test frontmatter mal formado → skill/rule cae en `skipped` con razón `"frontmatter parse error"` (no rompe el comando)
- [ ] T3.10: Test orden estable de `skills[]` y `rules[]` por `path`

### Renderers (uno por agente)

- [ ] T4: Crear `packages/core/src/manifest/renderers/claude.ts` con `renderClaude(manifest) → { path, content }[]`
- [ ] T4.1: Emitir `.claude/agent-manifest.md` con secciones `# Tarea`, `## Dominios tocados`, `## Skills sugeridas`, `## Skills omitidas`
- [ ] T4.2: Frontmatter del archivo con `name: contextforge-active-task`, `description: <tarea>`
- [ ] T4.3: Test snapshot determinista en `packages/core/__tests__/manifestRenderer.claude.unit.test.ts`

- [ ] T5: Crear `packages/core/src/manifest/renderers/cursor.ts` con `renderCursor(manifest) → { path, content }[]`
- [ ] T5.1: Emitir `.cursor/rules/contextforge-active.mdc` con frontmatter `globs: [<dominio>/**, ...]`, `alwaysApply: false`, `description: <task>`
- [ ] T5.2: Cuerpo lista la tarea, dominios tocados y rules activas
- [ ] T5.3: Test snapshot en `packages/core/__tests__/manifestRenderer.cursor.unit.test.ts`

- [ ] T6: Crear `packages/core/src/manifest/renderers/opencode.ts` con `renderOpenCode(manifest) → { path, content }[]`
- [ ] T6.1: El renderer escribe **solo** referencias documentales (el JSON neutral ya lo emite la capa CLI). Emite `.contextforge/manifests/opencode-readme.md` con instrucciones para el dev (cómo invocar `getAgentManifest` desde OpenCode)
- [ ] T6.2: Test snapshot en `packages/core/__tests__/manifestRenderer.opencode.unit.test.ts`

### MCP tools — capa offline + capa runtime

- [ ] T7: Modificar `packages/mcp/src/index.ts` para registrar tool `getAgentManifest` (offline, lee disco)
- [ ] T7.1: La tool lee `.contextforge/agent-manifest.json`, valida con schema y devuelve el contenido como `text`
- [ ] T7.2: Si el archivo no existe, devolver mensaje claro: `"Run 'forge manifest' first."`
- [ ] T7.3: Test en `packages/mcp/__tests__/getAgentManifest.unit.test.ts` cubriendo: archivo presente, archivo ausente, archivo corrupto

- [ ] T7.4: Registrar tool `selectAgentContext({ task, agents? })` (runtime, en memoria)
- [ ] T7.5: Implementar cache en memoria del MCP server para `scan.json` y `graph.json` parseados (invalidación por mtime)
- [ ] T7.6: Si `scan.json`/`graph.json` no existen, devolver manifiesto degradado con `notes: ["scan/graph missing — run forge scan && forge graph"]` (nunca crashear)
- [ ] T7.7: Test en `packages/mcp/__tests__/selectAgentContext.unit.test.ts`:
  - [ ] task válida + artefactos presentes → manifiesto válido
  - [ ] task vacía → schema rechaza (`minLength: 1`)
  - [ ] artefactos ausentes → manifiesto degradado con `notes`
  - [ ] segunda invocación en la misma sesión → usa cache (verificable por contador de reads del FS)
  - [ ] cache invalidado por mtime cuando el dev re-ejecuta `forge graph`

### Exports

- [ ] T8: Modificar `packages/core/src/index.ts` para exportar `buildAgentManifest`, todos los tipos, y los tres renderers
- [ ] T8.1: Re-exportar desde `packages/core/src/manifest/index.ts` para barrel pattern

### Capa CLI

- [ ] T9: Modificar `packages/cli/src/index.ts`:
  - [ ] T9.1: Importar `buildAgentManifest`, renderers y tipos desde core
  - [ ] T9.2: Implementar parser mínimo de frontmatter YAML (regex propia o gray-matter; preferir regex propia para no añadir dep)
  - [ ] T9.3: Implementar `cmdManifest(argv)`:
    - [ ] Lee `context-pack.json` (con hint a `forge context` si falta)
    - [ ] Escanea `.claude/skills/*.md` y parsea frontmatter
    - [ ] Escanea `.cursor/rules/*.mdc` y parsea frontmatter
    - [ ] Llama `buildAgentManifest` y escribe `.contextforge/agent-manifest.json`
    - [ ] Aplica renderers según flag `--agents=` (default: claude,cursor,opencode)
    - [ ] Si `--force` no está, no sobrescribe `.cursor/rules/contextforge-active.mdc` ni `.claude/agent-manifest.md` existentes (skip + log)
  - [ ] T9.4: Agregar `case "manifest"` en `runCommand`
  - [ ] T9.5: Agregar `pnpm forge manifest [--agents=...] [--force]` en `printUsage`

### CLI wrapper para hooks (capa runtime — Claude Code)

- [ ] T9.6: Crear `packages/mcp/src/cliWrapper.ts` (binario CLI thin que reusa `buildAgentManifest`)
- [ ] T9.7: Aceptar flag `--task=<texto>` y opcional `--format=markdown|json` (default markdown)
- [ ] T9.8: En modo markdown, imprimir a stdout un bloque `## Sugerencias de skills/rules para esta tarea` con bullets `- <name> — <reason>` para skills/rules activas
- [ ] T9.9: Exit 0 incluso si scan/graph faltan (degradado, imprimir nota visible al modelo)
- [ ] T9.10: Registrar el binario en `packages/mcp/package.json` (`bin: { "contextforge-hook": "dist/cliWrapper.js" }`)
- [ ] T9.11: Test en `packages/mcp/__tests__/cliWrapper.unit.test.ts`

### Plantilla de hook + docs por agente

- [ ] T9.12: Crear `docs/integrations/claude-code-hook.md` con snippet copy-paste para `.claude/settings.json` configurando `UserPromptSubmit`
- [ ] T9.13: Documentar la limitación de Cursor en `docs/integrations/cursor-rules.md` con los tres modos (`alwaysApply` / `Auto Attached` / `Agent Requested`) y cuándo usar cada uno
- [ ] T9.14: Documentar el flujo runtime en OpenCode en `docs/integrations/opencode-mcp.md` mostrando un ejemplo de tool call `selectAgentContext`

### Permissions / .gitignore

- [ ] T10: Actualizar `.gitignore` para incluir `.claude/agent-manifest.md` y `.cursor/rules/contextforge-active.mdc` y `.contextforge/manifests/` (son derivados)

### Documentación

- [ ] T11: Actualizar `README.md`:
  - [ ] T11.1: Agregar fila en tabla de comandos: `forge manifest [--agents=...] [--force]`
  - [ ] T11.2: Agregar paso 11 en "Uso rápido" (después de `forge skills`)
  - [ ] T11.3: Agregar sección "Manifest por tarea (`forge manifest`)" explicando los tres renderers
  - [ ] T11.4: Actualizar tabla "Integración con agentes" mencionando el manifiesto

- [ ] T12: Actualizar `docs/IMPLEMENTATION_TASKS.md`:
  - [ ] T12.1: Agregar S13 en la tabla de estado
  - [ ] T12.2: Agregar sección Sprint 13 con las tasks T1–T11
  - [ ] T12.3: Actualizar conteo de tests en el header

## Validation

- [ ] `pnpm test --run` pasa con todos los tests existentes + los nuevos (≥ 175 esperado)
- [ ] `pnpm test:coverage` mantiene threshold global ≥ 80%; módulo `manifest/` ≥ 90%
- [ ] `pnpm lint` sale limpio
- [ ] `pnpm build` compila core, cli, mcp sin errores
- [ ] `pnpm forge manifest` en este repo (después de `forge context "<task>"`) genera:
  - `.contextforge/agent-manifest.json` válido contra schema
  - `.claude/agent-manifest.md` con dominios tocados correctos
  - `.cursor/rules/contextforge-active.mdc` con `globs` apuntando a los dominios reales
- [ ] `forge manifest --agents=cursor` genera **solo** el archivo Cursor, no el resto
- [ ] Re-ejecutar sin `--force` produce `[skip]` para los archivos por-agente existentes
- [ ] La tool MCP `getAgentManifest` responde con el JSON parseado cuando se invoca desde un cliente MCP de prueba
- [ ] La tool MCP `selectAgentContext({ task: "fix race in tokenLedger" })` devuelve un manifiesto válido **sin escribir nada en disco** y el resultado contiene los dominios esperados
- [ ] El binario `contextforge-hook --task="fix race"` imprime markdown a stdout con bullets de skills sugeridas
- [ ] Plantilla del hook en `docs/integrations/claude-code-hook.md` se puede pegar tal cual en `.claude/settings.json` y el hook dispara correctamente con `$CLAUDE_USER_PROMPT`
- [ ] `forge implement --check` pasa (cumple guardrails: archivos permitidos, max LOC delta)
- [ ] `openspec validate agent-manifest` pasa
- [ ] Schema validation en CI verde
