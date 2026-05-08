# Tasks: forge-spec-as-prepare-step

## Implementation checklist

### Capa core (pure logic + schemas + tests)

- [ ] T1: Crear `docs/schemas/spec-input.schema.json` (Draft-2020).
- [ ] T1.1: Registrar `"spec-input"` en `packages/core/src/schema/validator.ts` (SchemaName + SCHEMA_FILES).
- [ ] T1.2: Registrar `specInput: "1.0.0"` en `packages/core/src/schema/versions.ts`.

- [ ] T2: Crear `packages/core/src/spec/specInput.ts` con `buildSpecInput(opts) → SpecInput`.
- [ ] T2.1: Inferencia de `domain` reusando heurística de `inferDomain()` existente.
- [ ] T2.2: Inferencia de `purpose` reusando lógica de `skillBuilder` (camelCase → kebab-case).
- [ ] T2.3: `crossDomainDeps` calculado desde `graph.json` si está disponible.
- [ ] T2.4: Validar resultado con `validateOrThrow("spec-input", ...)` antes de retornar.

- [ ] T3: Crear `packages/core/src/spec/promptRenderer.ts` con `renderSpecPrompt(opts) → string`.
- [ ] T3.1: Estructura del markdown con secciones numeradas (1. Contexto, 2. Instrucciones, 3. Restricciones, 4. Output esperado).
- [ ] T3.2: Inyección segura del JSON de OpenSpec instructions (escape de backticks).

- [ ] T4: Refactor `packages/core/src/spec/openspec.ts`:
- [ ] T4.1: `buildOpenSpec()` ahora emite `### Requirement: <título>` + `#### Scenario:` con bloque Given/When/Then.
- [ ] T4.2: `validateOpenSpecFiles()` actualizado para chequear bloques modernos (rechazar bullets viejos).

- [ ] T5: Tests `packages/core/__tests__/specInput.unit.test.ts` (≥ 8 casos).
- [ ] T6: Tests `packages/core/__tests__/promptRenderer.unit.test.ts` (≥ 6 casos).
- [ ] T7: Refactor `packages/core/__tests__/openspec.unit.test.ts` para validar formato moderno.

### Exports

- [ ] T8: Modificar `packages/core/src/index.ts` para exportar `buildSpecInput`, `renderSpecPrompt`, sus tipos, y los tipos refactoreados de `openspec.ts`.

### Capa CLI

- [ ] T9: Modificar `packages/cli/src/index.ts`:
- [ ] T9.1: Importar `buildSpecInput`, `renderSpecPrompt`, tipos.
- [ ] T9.2: Helper `isOpenSpecCliAvailable()` portable (execSync con `windowsHide`).
- [ ] T9.3: Helper `runHandoffMode({ changeId, specInput })`.
- [ ] T9.4: Helper `runFallbackMode({ changeId, specInput })`.
- [ ] T9.5: Refactor `cmdSpec` para emitir `spec-input.json` siempre + delegar al modo correcto.
- [ ] T9.6: Manejo de errores cuando `openspec new change` falla (revertir y caer al fallback).

### CLI integration tests

- [ ] T10: Modificar `packages/cli/__tests__/cli.commands.int.test.ts`:
- [ ] T10.1: Test del modo handoff (mockear `execSync` para simular `openspec` presente).
- [ ] T10.2: Test del modo fallback (mockear `execSync` para simular ausencia).
- [ ] T10.3: Verificar que `spec-input.json` se emite y valida en ambos modos.

### `cmdInit` enriquecido

- [ ] T11: Modificar `cmdInit` para emitir `.contextforge/agent-context.md` con:
- [ ] T11.1: Lista de artefactos disponibles + paths.
- [ ] T11.2: Métricas de ahorro (leídas de `token-ledger.json` si existe; placeholder si no).
- [ ] T11.3: Receta de SDD (forge context → forge spec → openspec validate → forge implement).
- [ ] T11.4: Re-emitir el archivo cada vez que `cmdInit` corre (sobrescribe; es derivado).

### Documentación

- [ ] T12: Crear `docs/explanation/contextforge-and-openspec.md` (Diátaxis explanation).
- [ ] T12.1: Resumen de ahorro con números reales del repo.
- [ ] T12.2: Diagrama de los 3 roles (ContextForge, OpenSpec, agente IA).
- [ ] T12.3: Flujo end-to-end con tokens en cada paso.
- [ ] T12.4: Cómo Claude prompt caching se beneficia del determinismo.

- [ ] T13: Update `README.md`:
- [ ] T13.1: Reemplazar sección "Spec OpenSpec (`forge spec`)" con el nuevo flujo handoff/fallback.
- [ ] T13.2: Link al `docs/explanation/contextforge-and-openspec.md`.
- [ ] T13.3: Ejemplos Bash + PowerShell separados.

- [ ] T14: Update `AGENTS.md`:
- [ ] T14.1: Sección "Para agentes que trabajan en este repo": consultar `.contextforge/agent-context.md` primero.
- [ ] T14.2: Política `forge spec` ahora prepara entrada, no genera spec final.

- [ ] T15: Update `docs/how-to/use-contextforge.md` con el nuevo flujo SDD.
- [ ] T16: Update `docs/IMPLEMENTATION_TASKS.md` agregando S15 (forge-spec-as-prepare-step).

### Release

- [ ] T17: Bump core/cli/mcp a 0.3.0 (breaking change: `forge spec` cambia output).
- [ ] T18: `pnpm typecheck && pnpm build && pnpm test --run && pnpm lint` en verde.
- [ ] T19: `openspec validate forge-spec-as-prepare-step` pasa.
- [ ] T20: Commit con mensaje claro + tag `v0.3.0` + push (dispara workflows publish + docker).

## Validation

- [ ] `forge spec mi-feature` con OpenSpec CLI presente → emite `spec-input.json` + `spec-prompt.md` + ejecuta `openspec new change`.
- [ ] `forge spec mi-feature` sin OpenSpec CLI → emite `spec-input.json` + `openspec/changes/mi-feature/` con formato moderno.
- [ ] `openspec validate mi-feature` pasa para el output del fallback.
- [ ] El `spec-prompt.md` es ≤ 5 KB y tiene los 4 secciones esperadas.
- [ ] Tests: 220+ tests pasando (202 actuales + nuevos).
- [ ] Coverage del módulo `spec/` ≥ 90 %.
- [ ] Image Docker `ghcr.io/alejandro-cedeno-10/contextforge-mcp:v0.3.0` publica multi-arch.
- [ ] npm: `@anai-raia-alex/contextforge-{core,cli,mcp}@0.3.0` publica en npmjs.com.
