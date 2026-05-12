import type { AgentManifestResult } from "../agentManifest.js";

export interface RenderedFile {
  path: string;
  content: string;
}

export function renderClaude(manifest: AgentManifestResult): RenderedFile[] {
  const skillLines = manifest.skills
    .map((s) => {
      const hintPart = s.hint ? ` — _${s.hint}_` : "";
      return `- \`${s.name}\` — ${s.reason}${hintPart}`;
    })
    .join("\n");

  const skippedLines = manifest.skipped.skills
    .map((s) => `- \`${s.name}\` — ${s.reason}`)
    .join("\n");

  const domainsLine =
    manifest.domainsTouched.length > 0
      ? manifest.domainsTouched.join(", ")
      : "(ninguno)";

  const content = `---
name: contextforge-active-task
description: ${manifest.task}
---

# Tarea: ${manifest.task}

## Instrucción para el LLM

${manifest.instruction}

## Dominios tocados

${domainsLine}

## Skills sugeridas

${skillLines || "(ninguna)"}

## Skills omitidas

${skippedLines || "(ninguna)"}
`;

  return [{ path: ".claude/agent-manifest.md", content }];
}
