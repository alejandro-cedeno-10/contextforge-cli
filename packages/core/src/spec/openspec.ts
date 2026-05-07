export interface OpenSpecFile {
  path: string;
  content: string;
}

export interface OpenSpecOptions {
  changeId: string;
  task: string;
  affectedFiles: Array<{ path: string; reason: string; mode: string }>;
  domain?: string;
}

export interface OpenSpecResult {
  changeDir: string;
  files: OpenSpecFile[];
}

export function inferDomain(filePaths: string[]): string {
  if (filePaths.length === 0) return "core";

  // packages/<pkg>/src/<domain>/... → domain
  const pkgSrc = /^packages\/[^/]+\/src\/([^/]+)/;
  // src/<domain>/... → domain
  const srcTop = /^src\/([^/]+)/;

  const counts = new Map<string, number>();
  for (const p of filePaths) {
    const normalized = p.replace(/\\/g, "/");
    const m = pkgSrc.exec(normalized) ?? srcTop.exec(normalized);
    const domain = m?.[1] ?? "core";
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  let best = "core";
  let max = 0;
  for (const [d, c] of counts) {
    if (c > max) {
      max = c;
      best = d;
    }
  }
  return best;
}

export function buildOpenSpec(opts: OpenSpecOptions): OpenSpecResult {
  const { changeId, task, affectedFiles } = opts;
  const domain = opts.domain ?? inferDomain(affectedFiles.map((f) => f.path));
  const changeDir = `openspec/changes/${changeId}`;

  const fileList =
    affectedFiles.length > 0
      ? affectedFiles
          .map((f) => `  - \`${f.path}\` (${f.reason}, mode: ${f.mode})`)
          .join("\n")
      : "  - (ninguno)";

  // Tasks only for non-summary files (summary = reference only)
  const nonSummary = affectedFiles.filter((f) => f.mode !== "summary");
  const taskList =
    nonSummary.length > 0
      ? nonSummary
          .map(
            (f, i) => `- [ ] T${i + 1}: Modificar \`${f.path}\` (${f.reason})`
          )
          .join("\n")
      : "- [ ] T1: Revisar context-pack y definir tareas concretas";

  const proposal = `# Proposal: ${changeId}

## Intent
${task}

## Scope

### In scope
- Archivos del context-pack con mode \`full\` o \`excerpt\`

### Out of scope
- Archivos con mode \`summary\` (solo referencia)
- Archivos fuera de \`guardrails.allowedFiles\`

## Why
Cambio requerido para: ${task}

## Evidence (context-pack)
${fileList}

## Alternatives considered
- No implementar: no resuelve la tarea
`;

  const design = `# Design: ${changeId}

## Technical approach

### Archivos afectados
${fileList}

### Cambios requeridos
- Seguir \`guardrails\` del \`implement-plan.json\`
- Modificar solo archivos en \`allowedFiles\`

## Data flow
1. \`forge scan\` → \`.contextforge/scan.json\`
2. \`forge graph\` → \`.contextforge/graph.json\`
3. \`forge context\` → \`.contextforge/context-pack.json\`
4. \`forge spec --emit openspec\` → esta estructura
5. \`forge implement\` → \`.contextforge/implement-plan.json\`

## Risks
- Cambios fuera de scope pueden introducir regresiones
- Exceder \`maxLocDelta\` requiere re-aprobacion
`;

  const tasks = `# Tasks: ${changeId}

## Implementation checklist

${taskList}

## Validation
- [ ] \`pnpm test\` pasa sin errores
- [ ] \`forge implement --check\` sale con codigo 0
- [ ] Schema validation en CI verde
`;

  const deltaSpec = `# Delta Spec: ${domain}

## ADDED Requirements

- The system MUST produce \`${changeId}\` changes within context-pack budget.
- Changes MUST NOT touch files outside \`guardrails.allowedFiles\`.
- All modified files SHOULD have associated test coverage.

## MODIFIED Requirements

- (ninguno por ahora)

## REMOVED Requirements

- (ninguno por ahora)
`;

  return {
    changeDir,
    files: [
      { path: `${changeDir}/proposal.md`, content: proposal },
      { path: `${changeDir}/design.md`, content: design },
      { path: `${changeDir}/tasks.md`, content: tasks },
      { path: `${changeDir}/specs/${domain}/spec.md`, content: deltaSpec }
    ]
  };
}
