# Tasks: auto-domain-skills

## Implementation checklist

### Capa core (pure logic + tests)

- [x] T1: Crear `packages/core/src/skills/skillBuilder.ts` con `buildDomainSkills`, tipos y plantilla
- [x] T1.1: Implementar `getDomain` reuse desde `packages/core/src/graph/domain.ts`
- [x] T1.2: Implementar cálculo de degree por nodeId en una sola pasada
- [x] T1.3: Implementar agrupación cross-domain (`dependsOn`, `usedBy`) solo para edge type `imports`
- [x] T1.4: Implementar `inferPurpose(filePath)` deterministic (camelCase → kebab-case → "Title Case", caso especial `index` usa parent dir)
- [x] T1.5: Implementar `slugify(domain)` (`packages/core` → `packages-core`)
- [x] T1.6: Renderizar plantilla con secciones condicionales (omitir si vacío)
- [x] T1.7: Filtrar dominios con `< minFilesPerDomain` y registrarlos en `skipped`

- [x] T2: Crear `packages/core/__tests__/skillBuilder.unit.test.ts` con ≥ 8 tests
- [x] T2.1: Test empty input → empty result
- [x] T2.2: Test dominio con 1 archivo → `skipped` con razón
- [x] T2.3: Test 2+ dominios con 5+ archivos → skills generados con paths correctos
- [x] T2.4: Test cross-domain edges → secciones "Depends on" y "Used by" presentes y correctas
- [x] T2.5: Test `maxFilesShown` limita la lista
- [x] T2.6: Test slug correcto (`packages/core` → `packages-core`, `src` → `src`)
- [x] T2.7: Test frontmatter contiene `name`, `description`, `tags`
- [x] T2.8: Test description menciona N files / M tests / deps cuando aplica

### Exports

- [x] T3: Modificar `packages/core/src/index.ts` para exportar `buildDomainSkills`, `DomainSkillsOptions`, `DomainSkillsResult`, `DomainSkillFile`

### Capa CLI

- [x] T4: Modificar `packages/cli/src/index.ts`:
  - [x] T4.1: Agregar `buildDomainSkills` al import de `@alejandro-cedeno-10/contextforge-core`
  - [x] T4.2: Implementar `cmdSkills(args)` siguiendo patrón de `cmdDocs`
  - [x] T4.3: Agregar `case "skills"` en `runCommand`
  - [x] T4.4: Agregar `pnpm forge skills [--force]` en `printUsage`

### Documentación

- [x] T5: Actualizar `README.md`:
  - [x] T5.1: Agregar fila en tabla de comandos: `forge skills [--force]`
  - [x] T5.2: Agregar paso 10 en "Uso rápido"
  - [x] T5.3: Agregar sección "Skills por dominio (`forge skills`)" después de `forge docs`

- [x] T6: Actualizar `docs/IMPLEMENTATION_TASKS.md`:
  - [x] T6.1: Agregar S12 en la tabla de estado
  - [x] T6.2: Agregar sección Sprint 12 con S12.T1 (skillBuilder), S12.T2 (cmdSkills + tests), S12.T3 (docs)
  - [x] T6.3: Actualizar conteo de tests en el header

## Validation

- [x] `pnpm test --run` pasa con ≥ 162/162 tests
- [x] `pnpm test:coverage` con coverage ≥ 80% en stmts/branches/funcs/lines
- [x] `pnpm lint` sale limpio (Prettier + ESLint)
- [x] `pnpm build` compila core, cli, mcp sin errores
- [x] `forge implement --check` sale con código 0 (cumple guardrails)
- [x] `pnpm forge skills` en este repo genera ≥ 3 skills (`ctx-packages-core.md`, `ctx-packages-cli.md`, `ctx-packages-mcp.md`)
- [x] El skill generado para `packages/core` referencia `scanner`, `graph/builder`, `selector` como key files
- [x] Re-ejecutar sin `--force` produce `[skip]` para skills existentes
- [x] Schema validation en CI verde
