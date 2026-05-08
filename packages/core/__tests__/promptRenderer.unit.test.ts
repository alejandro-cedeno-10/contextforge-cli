import { describe, expect, it } from "vitest";

import { renderSpecPrompt } from "../src/spec/promptRenderer";
import type { SpecInput } from "../src/spec/specInput";

const sample: SpecInput = {
  schemaVersion: "1.0.0",
  changeId: "fix-token-race",
  task: "fix race in tokenLedger writer",
  domain: "packages/core",
  affectedFiles: [
    {
      path: "packages/core/src/sync/syncReport.ts",
      reason: "ranked",
      mode: "full",
      purpose: "sync-report"
    },
    {
      path: "packages/core/src/scanner.ts",
      reason: "test_for",
      mode: "excerpt",
      purpose: "scanner"
    }
  ],
  crossDomainDeps: {
    dependsOn: {},
    usedBy: { "packages/cli": 2 }
  },
  evidence: {
    contextPackRef: ".contextforge/context-pack.json",
    graphRef: ".contextforge/graph.json",
    tokenBudget: 12000,
    estimatedTokens: 11988
  },
  generatedAt: "2026-05-08T00:00:00.000Z"
};

describe("renderSpecPrompt", () => {
  it("contains all 4 numbered sections", () => {
    const md = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: "Some canonical instructions."
    });
    expect(md).toMatch(/^## 1\. Contexto del repo/m);
    expect(md).toMatch(/^## 2\. Instrucciones canónicas de OpenSpec/m);
    expect(md).toMatch(/^## 3\. Restricciones para tu salida/m);
    expect(md).toMatch(/^## 4\. Output esperado/m);
  });

  it("lists affected files with purpose and mode", () => {
    const md = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: ""
    });
    expect(md).toContain("packages/core/src/sync/syncReport.ts");
    expect(md).toContain("sync-report");
    expect(md).toContain("(full, ranked)");
  });

  it("renders cross-domain deps when present", () => {
    const md = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: ""
    });
    expect(md).toContain("Usado por:");
    expect(md).toContain("packages/cli");
  });

  it("includes evidence references and token budget", () => {
    const md = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: ""
    });
    expect(md).toContain(".contextforge/context-pack.json");
    expect(md).toContain(".contextforge/graph.json");
    expect(md).toContain("12000");
    expect(md).toContain("11988");
  });

  it("escapes triple backticks inside instructions to avoid breaking code fences", () => {
    const md = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: "Use ```bash blocks``` like this"
    });
    // Find the instructions code block (opens after section header, before "## 3.").
    const start = md.indexOf("## 2. Instrucciones");
    const end = md.indexOf("## 3. Restricciones");
    const section2 = md.slice(start, end);
    // Inside section 2, raw ``` (3 backticks) outside the outer fence would
    // prematurely close it. Count "```" occurrences and ensure exactly two
    // (the outer fence open and close). Anything else means the escape failed.
    const fences = (section2.match(/```/g) ?? []).length;
    expect(fences).toBe(2);
  });

  it("handles empty instructions with a clear placeholder", () => {
    const md = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: ""
    });
    expect(md).toContain("OpenSpec CLI no disponible");
  });

  it("is deterministic for identical input", () => {
    const a = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: "x"
    });
    const b = renderSpecPrompt({
      specInput: sample,
      openSpecInstructions: "x"
    });
    expect(a).toBe(b);
  });
});
