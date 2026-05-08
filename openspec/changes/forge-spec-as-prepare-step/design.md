# Design: forge-spec-as-prepare-step

## Technical approach

### Capa pure-logic — `packages/core/src/spec/specInput.ts`

Función pura, sin I/O, sin red, sin LLM.

```typescript
export interface SpecInputOptions {
  changeId: string;
  task: string;
  contextPack: ContextPack; // resultado de forge context
  graphSummary?: GraphSummary; // opcional: deps cross-domain
  budgetTokens?: number; // default 12000
}

export interface SpecInput {
  schemaVersion: "1.0.0";
  changeId: string;
  task: string;
  domain: string; // inferido de los paths
  affectedFiles: Array<{
    path: string;
    reason: string;
    mode: "full" | "excerpt" | "summary";
    purpose?: string; // del nombre del archivo
  }>;
  crossDomainDeps: {
    dependsOn: Record<string, number>;
    usedBy: Record<string, number>;
  };
  evidence: {
    contextPackRef: string; // ".contextforge/context-pack.json"
    graphRef: string; // ".contextforge/graph.json"
    tokenBudget: number;
    estimatedTokens: number;
  };
  generatedAt: string; // ISO 8601
}

export function buildSpecInput(opts: SpecInputOptions): SpecInput;
```

### Schema — `docs/schemas/spec-input.schema.json`

Draft-2020, strict. Registrado como `"spec-input"` en `validator.ts` y `SCHEMA_VERSIONS.specInput = "1.0.0"` en `versions.ts`.

### Capa render — `packages/core/src/spec/promptRenderer.ts`

```typescript
export interface SpecPromptOptions {
  specInput: SpecInput;
  openSpecInstructions: string; // de `openspec instructions ... --json`
}

export function renderSpecPrompt(opts: SpecPromptOptions): string;
```

Devuelve el cuerpo del `spec-prompt.md` que el dev pega en el agente:

```markdown
# Generar OpenSpec change para: <task>

## 1. Contexto del repo (de ContextForge)

### Tarea

<task>

### Dominio inferido

<domain>

### Archivos afectados

- `path/a/file.ts` (purpose, mode: full)
- ...

### Dependencias cross-domain

- depende de: <domain> (N imports)
- usado por: <domain> (M imports)

## 2. Instrucciones de OpenSpec

<contenido de `openspec instructions proposal --change <id> --json`>

## 3. Restricciones

- Token budget: 12 000
- Allowed files: solo los listados en sección 1
- Formato: ### Requirement: + #### Scenario: + RFC 2119

## 4. Output esperado

Edita los archivos `openspec/changes/<id>/{proposal,design,tasks}.md`
y `openspec/changes/<id>/specs/<domain>/spec.md`.

Cuando termines, ejecuta:
openspec validate <id>
```

### Capa CLI — refactor de `cmdSpec`

```typescript
async function cmdSpec(
  changeId = "change-1",
  args: string[] = []
): Promise<void> {
  const { flags } = parseFlags(args);
  const force = flags["force"] === true;

  // Carga context-pack (requiere forge context previo)
  const pack = await readRequiredJson<ContextPack>(
    outputPath("context-pack.json"),
    'Ejecuta primero: pnpm forge context "<tarea>"'
  );

  const specInput = buildSpecInput({
    changeId,
    task: pack.task,
    contextPack: pack
  });
  validateOrThrow("spec-input", specInput);
  await writeJson(outputPath("spec-input.json"), specInput);
  console.log("Escrito .contextforge/spec-input.json");

  if (isOpenSpecCliAvailable()) {
    return runHandoffMode({ changeId, specInput, force });
  }

  return runFallbackMode({ changeId, specInput, force });
}
```

#### Handoff mode

```typescript
function runHandoffMode({ changeId, specInput, force }): Promise<void> {
  // 1. Crear esqueleto via OpenSpec CLI
  execSync(`openspec new change ${changeId}`, { stdio: "inherit" });

  // 2. Pedir las instrucciones del proposal
  const instructions = execSync(
    `openspec instructions proposal --change ${changeId} --json`,
    { encoding: "utf8" }
  );

  // 3. Renderizar prompt combinado
  const prompt = renderSpecPrompt({
    specInput,
    openSpecInstructions: instructions
  });
  await writeText(outputPath("spec-prompt.md"), prompt);

  console.log(`
Esqueleto creado en openspec/changes/${changeId}/
Input neutral en .contextforge/spec-input.json
Prompt para el agente en .contextforge/spec-prompt.md

Siguientes pasos:
  1. Pega .contextforge/spec-prompt.md en tu agente.
  2. El agente llena los .md del change.
  3. openspec validate ${changeId}
  4. pnpm forge implement ${changeId}
`);
}
```

#### Fallback mode (OpenSpec CLI ausente)

```typescript
function runFallbackMode({ changeId, specInput, force }): Promise<void> {
  // Usa el render interno (refactoreado a formato moderno)
  const result = buildOpenSpec({ changeId, task: specInput.task, ... });
  // Cada spec.md ahora emite ### Requirement: + #### Scenario:
  // ... escribe los archivos como hoy

  console.log(`
Esqueleto creado en openspec/changes/${changeId}/

Tip: Instala OpenSpec CLI para validación oficial:
  npm i -g @fission-ai/openspec
  openspec validate ${changeId}
`);
}
```

### Refactor de `openspec.ts` (formato moderno)

Cambia el render del `spec.md` interno para emitir:

```markdown
## ADDED Requirements

### Requirement: System produces <task> within budget

The system MUST produce the change for `<changeId>` while respecting
the context-pack budget defined in `.contextforge/context-pack.json` and
MUST NOT modify files outside the allowedFiles list.

#### Scenario: change is produced within scope

- **Given** a `.contextforge/context-pack.json` exists for the task `<task>`
- **When** the developer runs `pnpm forge implement <changeId>`
- **Then** the implement-plan lists exactly the context-pack files in
  `guardrails.allowedFiles`

## MODIFIED Requirements

(none)

## REMOVED Requirements

(none)
```

Esto sí valida con `openspec 1.3+`.

### Detección de OpenSpec CLI (portable)

```typescript
function isOpenSpecCliAvailable(): boolean {
  try {
    execSync("openspec --version", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
```

`execSync` resuelve por PATH en Mac/Linux/Windows. `windowsHide: true` evita popup en Windows. Sin shell para evitar issues de encoding.

### `cmdInit` enriquecido

Agrega un step que escribe `.contextforge/agent-context.md`:

```markdown
# Contexto del repo para agentes IA

> Este archivo es **derivado** y se regenera con `forge init` o `forge graph`.
> No editar a mano.

## Artefactos disponibles

- `.contextforge/scan.json` — inventario de archivos con BLAKE3
- `.contextforge/graph.json` — grafo de dependencias (N nodos, M edges)
- `.contextforge/context-pack.json` — selección actual por tarea
- `.contextforge/agent-manifest.json` — skills/rules relevantes a la tarea
- `.contextforge/spec-input.json` — input para OpenSpec
- `.contextforge/spec-prompt.md` — prompt copy-paste para el agente

## Cómo consumir

Antes de leer archivos al azar, **lee primero** `context-pack.json`:
los `files[]` ya son los relevantes a la tarea actual. Si necesitas más
contexto, sigue las edges del grafo desde esos archivos.

## Ahorro verificado

- Sin ContextForge: ~214 600 tokens (full repo dump)
- Con context-pack: ~11 988 tokens (-94.4 %, ratio 17.9×)

## Para crear un nuevo feature/fix con SDD

1. `forge context "<tarea>"`
2. `forge spec <change-id>` → genera `spec-input.json` + `spec-prompt.md`
3. Pega `spec-prompt.md` en este agente
4. El agente llena `openspec/changes/<id>/{proposal,design,tasks,specs}.md`
5. `openspec validate <id>`
6. `forge implement <id>` → plan con guardrails
7. Trabajas; al final `forge implement --check`
```

### Data flow

```
forge scan        → scan.json
forge graph       → graph.json
forge context     → context-pack.json + token-ledger.json + agent-manifest.json
forge spec <id>   →
   ├── .contextforge/spec-input.json (siempre)
   └── ¿openspec CLI?
       ├── SÍ → openspec new change <id> + spec-prompt.md (handoff)
       └── NO → openspec/changes/<id>/{proposal,design,tasks,specs}.md (fallback)
```

## Risks

| Riesgo                                                           | Mitigación                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| OpenSpec CLI cambia el comando `instructions` y rompe el handoff | Cache de la salida en `spec-input.json` (no dependemos del CLI para el contrato) |
| El usuario instala OpenSpec CLI después del scaffold fallback    | El fallback ya emite formato moderno → `openspec validate` pasa sin re-scaffold  |
| `execSync("openspec ...")` falla por shell quoting raro          | Usar `execFileSync` con args como array (sin shell) → portable y seguro          |
| El prompt enriquecido excede el contexto del agente              | El context-pack ya está acotado a 12k; el prompt total no debería pasar 18k      |
| Tests dependen de OpenSpec CLI instalado                         | Mockear `execFileSync` en tests; CI ya tiene OpenSpec global                     |

## Tests

`packages/core/__tests__/specInput.unit.test.ts` (≥ 8):

- Empty pack → `affectedFiles: []`, `domain: "core"`.
- Pack con un dominio → `domain` correcto.
- Pack cross-domain → `crossDomainDeps` correcto.
- `evidence` apunta a paths esperados.
- Schema validation pasa.
- Determinismo: dos runs idénticos → output byte-identical.
- `purpose` inferido por nombre.
- `generatedAt` en formato ISO 8601.

`packages/core/__tests__/promptRenderer.unit.test.ts` (≥ 6):

- Estructura del markdown (headings).
- Lista de archivos correcta.
- Inclusión de `openSpecInstructions`.
- Restricciones presentes (budget, allowedFiles).
- Determinismo.

`packages/core/__tests__/openspec.unit.test.ts` (refactor):

- spec.md emite `### Requirement:` + `#### Scenario:`.
- Validador interno acepta el nuevo formato y rechaza el viejo (bullets).

`packages/cli/__tests__/cli.commands.int.test.ts` (cobertura ambos modos):

- Modo handoff con `openspec` CLI mockeado en PATH.
- Modo fallback sin CLI.
- Output stdout coherente (siguientes pasos correctos).
