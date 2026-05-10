/**
 * Renders the `context.md` map that lives inside an OpenSpec change
 * directory. It is the single document that tells an agent (or a human
 * reviewer) what to read first and in what order — the entry point for
 * everything else in the change.
 *
 * Pure function so it can be reused from the CLI and the MCP server
 * without duplicating templating.
 */

export type ScaffoldedBy = "openspec" | "fallback" | "refresh" | "mcp";

export interface RenderChangeContextOptions {
  changeId: string;
  task: string;
  focus: string[];
  stats: {
    nodesTotal: number;
    edgesTotal: number;
    depth: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
  };
  scaffoldedBy: ScaffoldedBy;
}

export function renderChangeContextMd(
  options: RenderChangeContextOptions
): string {
  const { changeId, task, focus, stats, scaffoldedBy } = options;
  const focusList = focus
    .slice(0, 12)
    .map((f) => `- \`${f}\``)
    .join("\n");
  const focusMore =
    focus.length > 12
      ? `\n- _… y ${focus.length - 12} más en \`./graph.subset.json:focus\`_`
      : "";

  return `# Contexto del change \`${changeId}\`

> Mapa rápido para agentes IA y revisores. Generado por \`forge spec\`.
> Scaffold por: **${scaffoldedBy}**.

## Tarea

${task}

## Lectura recomendada (en orden)

| # | Archivo | Para qué |
| - | ------- | -------- |
| 1 | \`./proposal.md\` | Intent, scope, evidencia. Lectura humana. |
| 2 | \`./design.md\` | Decisiones técnicas. Incluye sección "Context graph (subset)". |
| 3 | \`./graph.subset.json\` | **Subgrafo del change** (${stats.nodesTotal} nodos, ${stats.edgesTotal} aristas, depth ${stats.depth}). Self-contained, validado por JSON Schema. |
| 4 | \`./graph.subset.html\` | Misma data, visualizable en navegador (Cytoscape standalone). |
| 5 | \`./tasks.md\` | Checklist de implementación. |
| 6 | \`./specs/<domain>/spec.md\` | Requirement+Scenario formal. \`openspec validate\` lo lee. |

## Artefactos globales referenciados

Solo si necesitas más allá del subgrafo del change:

| Path | Qué es |
| ---- | ------ |
| \`../../.contextforge/graph.json\` | Grafo completo del repo en el momento del spec. \`scanRef\` en el subset apunta a este hash. |
| \`../../.contextforge/context-pack.json\` | Selección PageRank que originó \`focus\`. |
| \`../../.contextforge/agent-manifest.json\` | Skills/rules activas para esta tarea. |
| \`../../.contextforge/implement-plan.json\` | Guardrails (\`allowedFiles\`, \`maxLocDelta\`) — generado por \`forge implement\`. |

## Vía MCP (preferido para agentes)

\`\`\`jsonc
// Lectura programática del subgrafo de este change:
{ "tool": "forge_change_subgraph", "arguments": { "change_id": "${changeId}" } }

// Solo si el subgrafo no responde lo que necesitas:
{ "tool": "forge_neighbors",       "arguments": { "file_path": "<path>" } }
{ "tool": "forge_context",         "arguments": { "task": "<refinamiento>" } }
\`\`\`

## Focus files (semilla del subgrafo)

${focusList}${focusMore}

---

**Política**: empieza siempre por \`./graph.subset.json\` (o el tool MCP). Solo cae a \`.contextforge/graph.json\` global cuando el subgrafo demuestre ser insuficiente para tu pregunta concreta.
`;
}
