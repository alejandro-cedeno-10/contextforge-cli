# Proposal: forge-spec-as-prepare-step

## Intent

Re-arquitecturar `forge spec` para que **prepare la entrada** que OpenSpec CLI consume, en lugar de duplicar la generación del spec completo. ContextForge se queda con su valor único (selección de contexto + grafo + evidencia) y delega a OpenSpec lo suyo (estructura, templates, validación). Cuando OpenSpec CLI no está instalado, mantiene un modo **fallback** que produce specs en formato moderno (`### Requirement` + `#### Scenario`) que sí pasan `openspec validate` cuando el dev instale el CLI después.

## Scope

### In scope

**Capa core (compartida entre handoff y fallback)**

- Nuevo módulo `packages/core/src/spec/specInput.ts` con función pura `buildSpecInput(opts) → SpecInput`.
- Schema `docs/schemas/spec-input.schema.json` (Draft-2020) validable con `validateOrThrow("spec-input", ...)`.
- Registrar `spec-input` en `packages/core/src/schema/{validator.ts,versions.ts}`.

**Modo handoff (default cuando OpenSpec CLI está en PATH)**

- Nuevo módulo `packages/core/src/spec/promptRenderer.ts` con `renderSpecPrompt(specInput, openSpecInstructions) → string`.
- `cmdSpec` detecta `openspec` CLI vía `execSync("openspec --version")` (portable Mac/Linux/Windows).
- Si está, ejecuta `openspec new change <id>` (delega esqueleto), luego `openspec instructions proposal --change <id> --json` y lo combina con el `spec-input.json` para emitir `.contextforge/spec-prompt.md`.
- Imprime al stdout los siguientes pasos sin ejecutarlos (el dev pega el prompt en su agente).

**Modo fallback (OpenSpec CLI ausente)**

- Refactor de `packages/core/src/spec/openspec.ts` para emitir `### Requirement: <título>` + `#### Scenario: <nombre>` con bloque Given/When/Then. Reemplaza el formato bullet actual que **no valida con OpenSpec 1.3+**.
- Mantiene proposal/design/tasks/spec.md generados por ContextForge.
- Validación interna `validateOpenSpecFiles()` actualizada para chequear el formato moderno.

**Compatibilidad de plataforma**

- `execSync("openspec --version", { stdio: "ignore" })` ya es portable a Mac/Linux/Windows porque Node lo resuelve vía PATH.
- Documentación con bloques separados Bash/Zsh y PowerShell para los snippets de hooks.

**Tests**

- `packages/core/__tests__/specInput.unit.test.ts` (≥ 8 tests).
- `packages/core/__tests__/promptRenderer.unit.test.ts` (≥ 6 tests).
- Refactor de `packages/core/__tests__/openspec.unit.test.ts` para validar el formato moderno.
- Test de integración `packages/cli/__tests__/cli.commands.int.test.ts` que cubre **ambos modos** (mockeando la presencia de `openspec` CLI).

**Documentación**

- Nuevo `docs/explanation/contextforge-and-openspec.md` con:
  - Resumen de ahorro de tokens (números reales medidos).
  - Cómo ContextForge y OpenSpec se complementan (3 roles: contexto / estructura / redacción).
  - Flujo end-to-end con tokens en cada paso.
  - Caching de Claude que se beneficia del determinismo.
- Update `README.md` con sección "Integración con OpenSpec" reescrita.
- `forge init` enriquecido: genera `.contextforge/agent-context.md` con paths del grafo + resumen de ahorro + cómo el agente debe consumir el repo.

### Out of scope

- Migrar specs existentes (`agent-manifest`, `auto-domain-skills`) — ya están en formato moderno y validan.
- Soportar versiones antiguas de OpenSpec CLI (< 1.3) — el nuevo formato es lo correcto, el legacy bullet-style queda fuera.
- Implementar un wrapper completo del CLI de OpenSpec — solo invocamos los comandos que necesitamos (`new change`, `instructions`).
- Cambios en `forge implement` o `forge implement --check` (siguen igual).

## Why

**Problema concreto descubierto en auditoría**:

`forge spec demo-traceability` genera hoy `spec.md` con bullets:

```markdown
## ADDED Requirements

- The system MUST produce ...
- Changes MUST NOT touch ...
```

Pero `openspec validate demo-traceability` lo rechaza:

```
✗ [ERROR] core/spec.md: Delta sections were found, but no requirement
  entries parsed. Ensure each section includes at least one
  "### Requirement:" block.
```

OpenSpec 1.3+ exige el formato Requirement/Scenario estructurado. Los bullets ya no validan. Los specs reales del repo (`agent-manifest`, `auto-domain-skills`) **se enriquecieron a mano** después del scaffold — eso es fricción y confunde al usuario.

**Impacto del re-architectura**:

1. Eliminamos el riesgo permanente de quedar atrás con OpenSpec — no duplicamos su lógica.
2. ContextForge enfoca su valor: **PageRank + grafo + selección por presupuesto**. No reinventa specs.
3. El handoff vía `spec-input.json` + `spec-prompt.md` es **cacheable** (determinista) → Claude/OpenCode reusan el cache entre iteraciones de SDD, ahorro adicional de ~90 % en iteraciones repetidas.
4. El fallback resuelve el bug actual y deja el repo listo para usuarios sin OpenSpec CLI instalado.

**Alineación con principios** (`AGENTS.md`):

- ✅ Determinista: `buildSpecInput` y `renderSpecPrompt` son funciones puras sin LLM ni red.
- ✅ Token-efficient: el `spec-prompt.md` reemplaza al "lee todo el repo" — el agente solo ve el pack.
- ✅ Portable: `spec-input.json` es un contrato neutro consumible por cualquier herramienta.
- ✅ No reload: reusa `context-pack.json` y `graph.json` ya producidos.

## Evidence (context-pack)

Archivos clave para la implementación (derivados del context-pack actual):

- `packages/core/src/spec/openspec.ts` — refactor del renderer interno.
- `packages/core/src/spec/render.ts` — referencia de patrón pure-render.
- `packages/cli/src/index.ts:cmdSpec` — punto de cambio principal.
- `packages/core/src/schema/{validator,versions}.ts` — registrar nuevo schema.
- `packages/core/__tests__/openspec.unit.test.ts` — tests a actualizar.
- `packages/cli/__tests__/cli.commands.int.test.ts` — integración con CLI mockeado.

## Alternatives considered

1. **Mantener todo el render interno y solo arreglar el formato**: descartado — duplicamos lógica que OpenSpec ya tiene, vamos a quedar atrás cada vez que evolucione (1.3 ya rompió con bullets, 1.4 puede romper con otra cosa).
2. **Eliminar `forge spec` entero y solo emitir `context-pack.json`**: descartado — perdemos la conveniencia del comando único + el handoff opinionado al agente. El `spec-input.json` + `spec-prompt.md` es el "azúcar" que aporta ContextForge.
3. **Auto-instalar OpenSpec CLI desde `forge init`**: descartado — instala dependencias por la espalda; mejor detectar y dar instrucciones claras.
4. **Generar el spec final directamente en JSON sin .md**: descartado — `.md` con frontmatter es el contrato OpenSpec, mantenerlo facilita revisiones humanas (PR diff legible).
