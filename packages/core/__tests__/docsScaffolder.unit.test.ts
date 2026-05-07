import { describe, expect, it } from "vitest";

import { buildDiataxisScaffold } from "../src/docs/scaffolder";
import type { GraphEdge, GraphNode } from "../src/graph/builder";

const baseOpts = {
  projectName: "demo-project",
  date: "2026-05-07"
};

describe("buildDiataxisScaffold", () => {
  it("returns the 6 expected Diataxis folders", () => {
    const result = buildDiataxisScaffold({ ...baseOpts });
    expect(result.folders).toEqual([
      "docs/tutorials/",
      "docs/how-to/",
      "docs/reference/",
      "docs/explanation/",
      "docs/adr/",
      "docs/architecture/"
    ]);
  });

  it("emits INDEX.md with the project name in the H1", () => {
    const result = buildDiataxisScaffold({ ...baseOpts });
    const index = result.files.find((f) => f.path === "docs/INDEX.md");
    expect(index).toBeDefined();
    expect(index!.content).toContain("# Documentación — demo-project");
  });

  it("INDEX.md frontmatter contains the provided date and Diataxis metadata", () => {
    const result = buildDiataxisScaffold({ ...baseOpts });
    const index = result.files.find((f) => f.path === "docs/INDEX.md")!;
    expect(index.content).toMatch(/^---\n/);
    expect(index.content).toContain("updated: 2026-05-07");
    expect(index.content).toContain("audience: both");
    expect(index.content).toContain("type: reference");
    expect(index.content).toContain("tags: [index, diataxis, navigation]");
  });

  it("always emits adr/README.md with MADR template metadata", () => {
    const result = buildDiataxisScaffold({ ...baseOpts });
    const adr = result.files.find((f) => f.path === "docs/adr/README.md");
    expect(adr).toBeDefined();
    expect(adr!.content).toContain("Architecture Decision Records");
    expect(adr!.content).toContain("audience: both");
    expect(adr!.content).toContain("type: reference");
    expect(adr!.content).toContain("[adr, madr, conventions]");
  });

  it("does NOT emit module-relationships.md when graph is null", () => {
    const result = buildDiataxisScaffold({ ...baseOpts, graph: null });
    const archFile = result.files.find((f) =>
      f.path.endsWith("module-relationships.md")
    );
    expect(archFile).toBeUndefined();
  });

  it("does NOT emit module-relationships.md when graph option is omitted", () => {
    const result = buildDiataxisScaffold({ ...baseOpts });
    expect(result.files).toHaveLength(2);
  });

  it("emits module-relationships.md when graph is provided", () => {
    const graph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        {
          id: "file:packages/core/src/a.ts",
          type: "file",
          label: "a.ts",
          path: "packages/core/src/a.ts",
          kind: "code"
        },
        {
          id: "file:packages/cli/src/index.ts",
          type: "file",
          label: "index.ts",
          path: "packages/cli/src/index.ts",
          kind: "code"
        }
      ],
      edges: [
        {
          from: "file:packages/cli/src/index.ts",
          to: "file:packages/core/src/a.ts",
          type: "imports"
        }
      ]
    };

    const result = buildDiataxisScaffold({ ...baseOpts, graph });
    const arch = result.files.find((f) =>
      f.path.endsWith("module-relationships.md")
    );
    expect(arch).toBeDefined();
    expect(arch!.content).toContain("packages/core");
    expect(arch!.content).toContain("packages/cli");
    expect(arch!.content).toContain("## Dependencias cruzadas");
    expect(arch!.content).toContain("| packages/cli | packages/core | 1 | 0 |");
  });

  it("aggregates per-domain file counts and kinds (code vs test)", () => {
    const graph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        {
          id: "file:packages/core/src/a.ts",
          type: "file",
          label: "a.ts",
          path: "packages/core/src/a.ts",
          kind: "code"
        },
        {
          id: "file:packages/core/src/b.ts",
          type: "file",
          label: "b.ts",
          path: "packages/core/src/b.ts",
          kind: "code"
        },
        {
          id: "file:packages/core/__tests__/a.test.ts",
          type: "file",
          label: "a.test.ts",
          path: "packages/core/__tests__/a.test.ts",
          kind: "test"
        }
      ],
      edges: []
    };

    const result = buildDiataxisScaffold({ ...baseOpts, graph });
    const arch = result.files.find((f) =>
      f.path.endsWith("module-relationships.md")
    )!;
    expect(arch.content).toMatch(
      /\| packages\/core \| 3 \|.*2 code.*1 test.*\|/
    );
    expect(arch.content).toContain("_Sin dependencias cruzadas detectadas._");
  });

  it("module-relationships frontmatter has architecture type metadata", () => {
    const graph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [],
      edges: []
    };
    const result = buildDiataxisScaffold({ ...baseOpts, graph });
    const arch = result.files.find((f) =>
      f.path.endsWith("module-relationships.md")
    )!;
    expect(arch.content).toContain("type: architecture");
    expect(arch.content).toContain("audience: both");
    expect(arch.content).toContain("updated: 2026-05-07");
  });

  it("ignores symbol nodes when aggregating domains", () => {
    const graph: { nodes: GraphNode[]; edges: GraphEdge[] } = {
      nodes: [
        {
          id: "file:packages/core/src/a.ts",
          type: "file",
          label: "a.ts",
          path: "packages/core/src/a.ts",
          kind: "code"
        },
        {
          id: "symbol:packages/core/src/a.ts#foo",
          type: "symbol",
          label: "foo",
          path: "packages/core/src/a.ts"
        }
      ],
      edges: [
        {
          from: "file:packages/core/src/a.ts",
          to: "symbol:packages/core/src/a.ts#foo",
          type: "defines"
        }
      ]
    };
    const result = buildDiataxisScaffold({ ...baseOpts, graph });
    const arch = result.files.find((f) =>
      f.path.endsWith("module-relationships.md")
    )!;
    expect(arch.content).toContain("| packages/core | 1 |");
    expect(arch.content).toContain("_Sin dependencias cruzadas detectadas._");
  });
});
