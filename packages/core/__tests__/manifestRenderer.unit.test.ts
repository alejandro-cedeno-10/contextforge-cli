import { describe, expect, it } from "vitest";

import type { AgentManifestResult } from "../src/manifest/agentManifest";
import { renderClaude } from "../src/manifest/renderers/claude";
import { renderCursor } from "../src/manifest/renderers/cursor";
import { renderOpenCode } from "../src/manifest/renderers/opencode";

const sampleManifest: AgentManifestResult = {
  schemaVersion: "1.1.0",
  task: "fix race in tokenLedger",
  domainsTouched: ["packages/cli", "packages/core"],
  instruction:
    "Load ONLY the entries listed in `skills[]` and `rules[]`. Domains touched: packages/cli, packages/core.",
  skills: [
    {
      path: ".claude/skills/ctx-packages-core.md",
      name: "ctx-packages-core",
      reason: "task touches packages/core",
      matchType: "domain",
      hint: "Use when editing scanner or graph"
    },
    {
      path: ".claude/skills/global.md",
      name: "global",
      reason: "skill marked alwaysApply",
      matchType: "alwaysApply"
    }
  ],
  rules: [
    {
      path: ".cursor/rules/contextforge.mdc",
      reason: "skill marked alwaysApply",
      matchType: "alwaysApply",
      hint: "General forge conventions"
    }
  ],
  skipped: {
    skills: [{ name: "ctx-packages-mcp", reason: "domain not touched" }],
    rules: []
  }
};

const emptyManifest: AgentManifestResult = {
  schemaVersion: "1.1.0",
  task: "empty task",
  domainsTouched: [],
  instruction:
    "No skills or rules matched this task. Proceed using the context-pack only.",
  skills: [],
  rules: [],
  skipped: { skills: [], rules: [] }
};

describe("renderClaude", () => {
  it("emits .claude/agent-manifest.md", () => {
    const files = renderClaude(sampleManifest);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(".claude/agent-manifest.md");
  });

  it("frontmatter contains name: contextforge-active-task", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("name: contextforge-active-task");
  });

  it("frontmatter description matches task", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("description: fix race in tokenLedger");
  });

  it("contains required headings", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("# Tarea:");
    expect(content).toContain("## Instrucción para el LLM");
    expect(content).toContain("## Dominios tocados");
    expect(content).toContain("## Skills sugeridas");
    expect(content).toContain("## Skills omitidas");
  });

  it("renders skill hint inline when present", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("Use when editing scanner or graph");
  });

  it("renders instruction text", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("Load ONLY the entries");
  });

  it("lists suggested skills with reason", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("ctx-packages-core");
    expect(content).toContain("task touches packages/core");
  });

  it("lists skipped skills", () => {
    const { content } = renderClaude(sampleManifest)[0];
    expect(content).toContain("ctx-packages-mcp");
    expect(content).toContain("domain not touched");
  });

  it("handles empty manifest gracefully", () => {
    const { content } = renderClaude(emptyManifest)[0];
    expect(content).toContain("(ninguno)");
  });

  it("is deterministic", () => {
    expect(renderClaude(sampleManifest)[0].content).toBe(
      renderClaude(sampleManifest)[0].content
    );
  });
});

describe("renderCursor", () => {
  it("emits .cursor/rules/contextforge-active.mdc", () => {
    const files = renderCursor(sampleManifest);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(".cursor/rules/contextforge-active.mdc");
  });

  it("frontmatter has alwaysApply: false", () => {
    const { content } = renderCursor(sampleManifest)[0];
    expect(content).toContain("alwaysApply: false");
  });

  it("globs contain one entry per domainsTouched", () => {
    const { content } = renderCursor(sampleManifest)[0];
    expect(content).toContain("packages/cli/**");
    expect(content).toContain("packages/core/**");
  });

  it("renders rule hint inline when present", () => {
    const { content } = renderCursor(sampleManifest)[0];
    expect(content).toContain("General forge conventions");
  });

  it("renders instruction section", () => {
    const { content } = renderCursor(sampleManifest)[0];
    expect(content).toContain("## Instruction");
  });

  it("empty domainsTouched produces empty globs section", () => {
    const { content } = renderCursor(emptyManifest)[0];
    expect(content).toContain("alwaysApply: false");
    expect(content).not.toContain("/**");
  });

  it("is deterministic", () => {
    expect(renderCursor(sampleManifest)[0].content).toBe(
      renderCursor(sampleManifest)[0].content
    );
  });
});

describe("renderOpenCode", () => {
  it("emits .contextforge/manifests/opencode-readme.md", () => {
    const files = renderOpenCode(sampleManifest);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(".contextforge/manifests/opencode-readme.md");
  });

  it("contains the task text", () => {
    const { content } = renderOpenCode(sampleManifest)[0];
    expect(content).toContain("fix race in tokenLedger");
  });

  it("contains selectAgentContext tool call example", () => {
    const { content } = renderOpenCode(sampleManifest)[0];
    expect(content).toContain("selectAgentContext");
  });

  it("lists suggested skills", () => {
    const { content } = renderOpenCode(sampleManifest)[0];
    expect(content).toContain("ctx-packages-core");
  });

  it("renders skill hint inline when present", () => {
    const { content } = renderOpenCode(sampleManifest)[0];
    expect(content).toContain("Use when editing scanner or graph");
  });

  it("renders instruction section", () => {
    const { content } = renderOpenCode(sampleManifest)[0];
    expect(content).toContain("## Instruction");
  });

  it("is deterministic", () => {
    expect(renderOpenCode(sampleManifest)[0].content).toBe(
      renderOpenCode(sampleManifest)[0].content
    );
  });
});
