import type { SpecInput } from "./specInput.js";

export interface SpecPromptOptions {
  specInput: SpecInput;
  /**
   * Raw output of `openspec instructions <artifact> --change <id> --json`,
   * or a free-form markdown blob when running in fallback. Empty string is OK.
   */
  openSpecInstructions: string;
}

function escapeFencedBlock(content: string): string {
  return content.replace(/```/g, "``​`");
}

function renderAffectedFiles(specInput: SpecInput): string {
  if (specInput.affectedFiles.length === 0) return "  - (ninguno)";
  return specInput.affectedFiles
    .map(
      (f) =>
        `  - \`${f.path}\` — ${f.purpose ?? "n/a"} (${f.mode}, ${f.reason})`
    )
    .join("\n");
}

function renderArchitecture(specInput: SpecInput): string | null {
  const arch = specInput.architecture;
  if (!arch) return null;
  if (
    arch.domains.length === 0 &&
    arch.endpoints.length === 0 &&
    arch.flows.length === 0
  ) {
    return null;
  }
  const lines: string[] = [];
  if (arch.domains.length > 0) {
    lines.push(
      `**Dominios**: ${arch.domains.map((d) => `\`${d}\``).join(", ")}`
    );
  }
  if (arch.endpoints.length > 0) {
    lines.push("", "**Endpoints expuestos:**");
    for (const ep of arch.endpoints) {
      const fwk = ep.framework ? ` [${ep.framework}]` : "";
      const src = ep.file ? ` — \`${ep.file}\`` : "";
      lines.push(`  - \`${ep.method} ${ep.path}\`${fwk}${src}`);
    }
  }
  if (arch.flows.length > 0) {
    lines.push("", "**Flujos detectados:**");
    for (const f of arch.flows) {
      lines.push(
        `  - \`${f.id}\` (${f.domain}, ${f.stepCount} step${
          f.stepCount === 1 ? "" : "s"
        }) — ${f.label}`
      );
    }
  }
  return lines.join("\n");
}

function renderCrossDeps(specInput: SpecInput): string {
  const lines: string[] = [];
  const dep = specInput.crossDomainDeps.dependsOn;
  const used = specInput.crossDomainDeps.usedBy;

  const depKeys = Object.keys(dep);
  const usedKeys = Object.keys(used);
  if (depKeys.length === 0 && usedKeys.length === 0) {
    return "  - (sin dependencias cross-domain)";
  }

  if (depKeys.length > 0) {
    lines.push("  **Depende de:**");
    for (const k of depKeys.sort()) {
      lines.push(`  - \`${k}\` (${dep[k]} import${dep[k] === 1 ? "" : "s"})`);
    }
  }
  if (usedKeys.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("  **Usado por:**");
    for (const k of usedKeys.sort()) {
      lines.push(`  - \`${k}\` (${used[k]} import${used[k] === 1 ? "" : "s"})`);
    }
  }
  return lines.join("\n");
}

export function renderSpecPrompt(opts: SpecPromptOptions): string {
  const s = opts.specInput;
  const escapedInstructions =
    opts.openSpecInstructions.trim().length > 0
      ? escapeFencedBlock(opts.openSpecInstructions.trim())
      : "_(OpenSpec CLI no disponible — usa la estructura por defecto del fallback)_";

  return `# Generar OpenSpec change: \`${s.changeId}\`

> Este prompt fue generado por **\`forge spec\`** combinando el grafo del repo
> (vía ContextForge) con las instrucciones canónicas de OpenSpec. Pégalo en
> tu agente IA (Claude Code, OpenCode, Cursor) y deja que llene los \`.md\`.
>
> Generado: ${s.generatedAt}

---

## 1. Contexto del repo (de ContextForge)

### Tarea

${s.task}

### Dominio inferido

\`${s.domain}\`

### Archivos afectados (del context-pack)

${renderAffectedFiles(s)}

### Dependencias cross-domain

${renderCrossDeps(s)}
${
  renderArchitecture(s)
    ? `\n### Contexto arquitectónico (capa semántica)\n\n${renderArchitecture(s)}\n`
    : ""
}
### Evidencia (paths trazables)

- Context-pack: \`${s.evidence.contextPackRef}\`
- Grafo: \`${s.evidence.graphRef}\`
- Token budget: ${s.evidence.tokenBudget}
- Tokens estimados del pack: ${s.evidence.estimatedTokens}

---

## 2. Instrucciones canónicas de OpenSpec

\`\`\`
${escapedInstructions}
\`\`\`

---

## 3. Restricciones para tu salida

- **Allowed files**: solo los listados en sección 1. No tocar archivos fuera de esa lista.
- **Token budget**: ${s.evidence.tokenBudget} tokens. No expandir más allá.
- **Formato del spec.md**: cada requirement DEBE ser \`### Requirement: <título>\` + \`#### Scenario: <nombre>\` con bullets **Given**/**When**/**Then**. NO uses bullets sueltos al estilo \`- The system MUST ...\` — OpenSpec 1.3+ los rechaza.
- **RFC 2119**: usa MUST / SHALL / SHOULD / MAY apropiadamente.

---

## 4. Output esperado

Edita los archivos del directorio \`openspec/changes/${s.changeId}/\`:

- \`proposal.md\` — Intent, Scope, Why, Alternatives.
- \`design.md\` — Technical approach + Risks + Tests, citando archivos de la sección 1.
- \`tasks.md\` — T1, T1.1, T2... checklist accionable.
- \`specs/${s.domain}/spec.md\` — Delta spec con \`## ADDED Requirements\`, cada uno con su \`### Requirement:\` + \`#### Scenario:\`.

Cuando termines, ejecuta:

\`\`\`bash
openspec validate ${s.changeId}
pnpm forge implement ${s.changeId}
\`\`\`
`;
}
