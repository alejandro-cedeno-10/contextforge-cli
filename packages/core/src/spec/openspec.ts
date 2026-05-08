export interface OpenSpecFile {
  path: string;
  content: string;
}

export interface OpenSpecOptions {
  changeId: string;
  task: string;
  affectedFiles: Array<{ path: string; reason: string; mode: string }>;
  domain?: string;
  graphSubset?: {
    stats: {
      nodesTotal: number;
      edgesTotal: number;
      nodesByType: Record<string, number>;
      edgesByType: Record<string, number>;
      depth: number;
      mode?: "compact" | "full";
    };
  };
}

export interface OpenSpecResult {
  changeDir: string;
  files: OpenSpecFile[];
}

export function inferDomain(filePaths: string[]): string {
  if (filePaths.length === 0) return "core";

  const pkgSrc = /^packages\/[^/]+\/src\/([^/]+)/;
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

function formatTypeCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) =>
    a[0] < b[0] ? -1 : 1
  );
  if (entries.length === 0) return "(ninguno)";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function titleCase(value: string): string {
  if (!value) return value;
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function buildOpenSpec(opts: OpenSpecOptions): OpenSpecResult {
  const { changeId, task, affectedFiles, graphSubset } = opts;
  const domain = opts.domain ?? inferDomain(affectedFiles.map((f) => f.path));
  const changeDir = `openspec/changes/${changeId}`;

  const fileList =
    affectedFiles.length > 0
      ? affectedFiles
          .map((f) => `  - \`${f.path}\` (${f.reason}, mode: ${f.mode})`)
          .join("\n")
      : "  - (ninguno)";

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

  const subsetSection = graphSubset
    ? `
## Context graph (subset)

Subgrafo congelado al momento de crear este change, derivado del context-pack
y expandido ${graphSubset.stats.depth}-hop por aristas (\`imports\`,
\`extends\`, \`implements\`, \`tests\`, \`calls\`, \`references\`).
Modo: \`${graphSubset.stats.mode ?? "compact"}\` ${graphSubset.stats.mode === "full" ? "(--subgraph-full)" : "(default — solo símbolos exportados de focus files)"}.

| Artefacto | Para qué |
| --------- | -------- |
| \`./graph.subset.json\` | Datos planos · validados por JSON Schema · diff-friendly en review |
| \`./graph.subset.html\` | Viewer interactivo standalone · abre en cualquier navegador · tour por archivos del change |
| MCP \`forge_change_subgraph({ changeId: "${changeId}" })\` | Lectura programática para agentes |

| Métrica | Valor |
| ------- | ----- |
| Nodos   | ${graphSubset.stats.nodesTotal} |
| Aristas | ${graphSubset.stats.edgesTotal} |
| Por tipo (nodos) | ${formatTypeCounts(graphSubset.stats.nodesByType)} |
| Por tipo (aristas) | ${formatTypeCounts(graphSubset.stats.edgesByType)} |

Las skills/prompts del agente que lean \`openspec/changes/${changeId}/\`
tienen acceso al subgrafo sin necesidad de reabrir \`.contextforge/graph.json\`.
`
    : "";

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
4. \`forge spec\` → esta estructura (formato OpenSpec moderno) + \`graph.subset.json\` adyacente
5. \`forge implement\` → \`.contextforge/implement-plan.json\`
${subsetSection}
## Risks

- Cambios fuera de scope pueden introducir regresiones
- Exceder \`maxLocDelta\` requiere re-aprobación
`;

  const tasks = `# Tasks: ${changeId}

## Implementation checklist

${taskList}

## Validation

- [ ] \`pnpm test\` pasa sin errores
- [ ] \`forge implement --check\` sale con código 0
- [ ] \`openspec validate ${changeId}\` pasa
- [ ] Schema validation en CI verde
`;

  const reqTitle = `Implement ${titleCase(changeId)}`;
  const deltaSpec = `# Delta Spec: ${domain}

## ADDED Requirements

### Requirement: ${reqTitle}

The system MUST implement the change \`${changeId}\` in scope of the context-pack at \`.contextforge/context-pack.json\`. All modifications MUST stay within \`guardrails.allowedFiles\` from the implement-plan, MUST NOT exceed \`guardrails.maxLocDelta\`, and MUST be covered by tests.

#### Scenario: change is implemented within scope

- **Given** a valid \`.contextforge/context-pack.json\` for the task "${task.replace(/"/g, '\\"')}"
- **When** the developer runs \`pnpm forge implement ${changeId}\` and modifies the listed files
- **Then** \`pnpm forge implement --check\` exits with code 0
- **And** the modified file set is a subset of \`guardrails.allowedFiles\`
- **And** the LOC delta is within \`guardrails.maxLocDelta\`

#### Scenario: scope violation is rejected

- **Given** the developer modifies a file outside \`guardrails.allowedFiles\`
- **When** \`pnpm forge implement --check\` runs
- **Then** the command exits non-zero with an explicit \`forbidden-path\` or \`disallowed-file\` violation

## MODIFIED Requirements

(none)

## REMOVED Requirements

(none)
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

export interface OpenSpecValidationIssue {
  file: string;
  rule: string;
  detail: string;
}

const OPENSPEC_REQUIRED_SECTIONS: Record<string, string[]> = {
  "proposal.md": ["## Intent", "## Scope"],
  "design.md": ["## Technical approach"],
  "tasks.md": ["## Implementation checklist"]
};

const OPENSPEC_DELTA_HEADINGS = [
  "## ADDED Requirements",
  "## MODIFIED Requirements",
  "## REMOVED Requirements"
];

const REQUIREMENT_BLOCK_RE = /^### Requirement:\s+\S/m;
const SCENARIO_BLOCK_RE = /^#### Scenario:\s+\S/m;
const LEGACY_BULLET_RE = /^\s*-\s+The system (MUST|SHALL|SHOULD|MAY)/m;

export function validateOpenSpecFiles(
  files: ReadonlyArray<OpenSpecFile>
): OpenSpecValidationIssue[] {
  const issues: OpenSpecValidationIssue[] = [];
  const byBasename = new Map<string, OpenSpecFile>();
  let deltaSpec: OpenSpecFile | undefined;

  for (const file of files) {
    const basename = file.path.split("/").pop() ?? "";
    if (file.path.includes("/specs/") && basename === "spec.md") {
      deltaSpec = file;
    } else {
      byBasename.set(basename, file);
    }
  }

  for (const [name, requiredSections] of Object.entries(
    OPENSPEC_REQUIRED_SECTIONS
  )) {
    const file = byBasename.get(name);
    if (!file) {
      issues.push({
        file: name,
        rule: "missing-file",
        detail: `OpenSpec change must include ${name}`
      });
      continue;
    }
    for (const section of requiredSections) {
      if (!file.content.includes(section)) {
        issues.push({
          file: file.path,
          rule: "missing-section",
          detail: `${name} must contain "${section}"`
        });
      }
    }
  }

  if (!deltaSpec) {
    issues.push({
      file: "specs/<domain>/spec.md",
      rule: "missing-file",
      detail: "OpenSpec change must include a delta spec under specs/<domain>/"
    });
    return issues;
  }

  const hasAnyDeltaHeading = OPENSPEC_DELTA_HEADINGS.some((h) =>
    deltaSpec!.content.includes(h)
  );
  if (!hasAnyDeltaHeading) {
    issues.push({
      file: deltaSpec.path,
      rule: "missing-delta-section",
      detail: `Delta spec must contain at least one of: ${OPENSPEC_DELTA_HEADINGS.join(", ")}`
    });
  }

  if (!REQUIREMENT_BLOCK_RE.test(deltaSpec.content)) {
    issues.push({
      file: deltaSpec.path,
      rule: "requirement-block-missing",
      detail:
        'Delta spec must contain at least one "### Requirement: <title>" block (legacy bullet format is no longer accepted by openspec validate)'
    });
  } else if (!SCENARIO_BLOCK_RE.test(deltaSpec.content)) {
    issues.push({
      file: deltaSpec.path,
      rule: "scenario-block-missing",
      detail:
        'Each Requirement must contain at least one "#### Scenario: <name>" block with Given/When/Then bullets'
    });
  }

  if (
    LEGACY_BULLET_RE.test(deltaSpec.content) &&
    !REQUIREMENT_BLOCK_RE.test(deltaSpec.content)
  ) {
    issues.push({
      file: deltaSpec.path,
      rule: "legacy-bullet-format",
      detail:
        "Delta spec uses legacy bullet-style requirements; rewrite as ### Requirement: + #### Scenario: blocks"
    });
  }

  return issues;
}
