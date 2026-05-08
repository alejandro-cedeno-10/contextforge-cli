import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "../src/graph/builder";
import { validateOrThrow } from "../src/schema/validator";
import { buildSpecInput } from "../src/spec/specInput";

const FIXED_AT = "2026-05-08T00:00:00.000Z";

function pack(
  task: string,
  files: Array<{
    path: string;
    reason?: string;
    mode?: "full" | "excerpt" | "summary";
  }>
) {
  return {
    task,
    files: files.map((f) => ({
      path: f.path,
      reason: f.reason ?? "ranked",
      mode: f.mode ?? ("full" as const)
    })),
    budget: { maxInputTokens: 12000, estimatedTokens: 8765 }
  };
}

function fileNode(p: string): GraphNode {
  return {
    id: `file:${p}`,
    type: "file",
    label: p.split("/").pop() ?? p,
    path: p,
    kind: "code"
  };
}

function importsEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, type: "imports" };
}

describe("buildSpecInput", () => {
  it("emits a schema-valid SpecInput for a simple pack", () => {
    const result = buildSpecInput({
      changeId: "fix-something",
      contextPack: pack("fix something simple", [
        { path: "packages/core/src/scanner.ts" }
      ]),
      generatedAt: FIXED_AT
    });
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.changeId).toBe("fix-something");
    expect(result.task).toBe("fix something simple");
    expect(result.affectedFiles).toHaveLength(1);
    expect(result.evidence.estimatedTokens).toBe(8765);
    expect(result.generatedAt).toBe(FIXED_AT);
    expect(() => validateOrThrow("spec-input", result)).not.toThrow();
  });

  it("rejects an invalid changeId", () => {
    expect(() =>
      buildSpecInput({
        changeId: "Invalid_Id With Spaces",
        contextPack: pack("t", []),
        generatedAt: FIXED_AT
      })
    ).toThrow(/changeId/);
  });

  it("infers the dominant domain from packed files", () => {
    const result = buildSpecInput({
      changeId: "feat-core",
      contextPack: pack("feat core", [
        { path: "packages/core/src/a.ts" },
        { path: "packages/core/src/b.ts" },
        { path: "packages/cli/src/x.ts" }
      ]),
      generatedAt: FIXED_AT
    });
    expect(result.domain).toBe("packages/core");
  });

  it("infers purpose from camelCase filenames", () => {
    const result = buildSpecInput({
      changeId: "demo",
      contextPack: pack("demo", [{ path: "packages/cli/src/htmlTemplate.ts" }]),
      generatedAt: FIXED_AT
    });
    expect(result.affectedFiles[0].purpose).toBe("html-template");
  });

  it("uses parent directory as purpose for index.ts", () => {
    const result = buildSpecInput({
      changeId: "demo",
      contextPack: pack("demo", [
        { path: "packages/core/src/selector/index.ts" }
      ]),
      generatedAt: FIXED_AT
    });
    expect(result.affectedFiles[0].purpose).toBe("selector");
  });

  it("computes crossDomainDeps from the graph", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/scanner.ts"),
      fileNode("packages/cli/src/index.ts"),
      fileNode("packages/mcp/src/index.ts")
    ];
    const edges: GraphEdge[] = [
      importsEdge("packages/cli/src/index.ts", "packages/core/src/scanner.ts"),
      importsEdge("packages/mcp/src/index.ts", "packages/core/src/scanner.ts")
    ];
    const result = buildSpecInput({
      changeId: "feat-core",
      contextPack: pack("touch core only", [
        { path: "packages/core/src/scanner.ts" }
      ]),
      graph: { nodes, edges },
      generatedAt: FIXED_AT
    });
    expect(result.crossDomainDeps.usedBy).toEqual({
      "packages/cli": 1,
      "packages/mcp": 1
    });
    expect(result.crossDomainDeps.dependsOn).toEqual({});
  });

  it("emits affectedFiles sorted by path for determinism", () => {
    const result = buildSpecInput({
      changeId: "demo",
      contextPack: pack("demo", [
        { path: "packages/cli/src/z.ts" },
        { path: "packages/cli/src/a.ts" },
        { path: "packages/cli/src/m.ts" }
      ]),
      generatedAt: FIXED_AT
    });
    expect(result.affectedFiles.map((f) => f.path)).toEqual([
      "packages/cli/src/a.ts",
      "packages/cli/src/m.ts",
      "packages/cli/src/z.ts"
    ]);
  });

  it("two identical inputs produce byte-identical output", () => {
    const inputs = {
      changeId: "demo",
      contextPack: pack("demo", [{ path: "packages/core/src/scanner.ts" }]),
      generatedAt: FIXED_AT
    };
    const a = buildSpecInput(inputs);
    const b = buildSpecInput(inputs);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("evidence references default to the canonical paths", () => {
    const result = buildSpecInput({
      changeId: "demo",
      contextPack: pack("demo", [{ path: "packages/core/src/a.ts" }]),
      generatedAt: FIXED_AT
    });
    expect(result.evidence.contextPackRef).toBe(
      ".contextforge/context-pack.json"
    );
    expect(result.evidence.graphRef).toBe(".contextforge/graph.json");
    expect(result.evidence.tokenBudget).toBe(12000);
  });
});
