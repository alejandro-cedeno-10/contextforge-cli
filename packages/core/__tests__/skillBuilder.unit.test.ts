import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphNode } from "../src/graph/builder";
import {
  buildDomainSkills,
  inferPurpose,
  slugify
} from "../src/skills/skillBuilder";

function fileNode(p: string, kind: "code" | "test" = "code"): GraphNode {
  return {
    id: `file:${p}`,
    type: "file",
    label: p.split("/").pop() ?? p,
    path: p,
    kind
  };
}

function importsEdge(from: string, to: string): GraphEdge {
  return { from: `file:${from}`, to: `file:${to}`, type: "imports" };
}

describe("buildDomainSkills", () => {
  it("returns empty result for empty input (Scenario: works offline / determinism baseline)", () => {
    const result = buildDomainSkills({ nodes: [], edges: [] });
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("skips a domain with only one file and reports it in skipped[] (Scenario: tiny domain is omitted)", () => {
    const result = buildDomainSkills({
      nodes: [fileNode("src/lonely.ts")],
      edges: []
    });
    expect(result.files).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].domain).toBe("src");
    expect(result.skipped[0].reason).toMatch(/only 1 file/);
  });

  it("emits one skill per domain at .claude/skills/contextforge-domain-<slug>.md (Scenario: graph with multiple domains produces one skill per domain)", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/a.ts"),
      fileNode("packages/core/src/b.ts"),
      fileNode("packages/cli/src/main.ts"),
      fileNode("packages/cli/src/sub.ts"),
      fileNode("packages/mcp/src/index.ts"),
      fileNode("packages/mcp/src/handlers.ts")
    ];
    const result = buildDomainSkills({ nodes, edges: [] });

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(
      ".claude/skills/contextforge-domain-packages-core.md"
    );
    expect(paths).toContain(
      ".claude/skills/contextforge-domain-packages-cli.md"
    );
    expect(paths).toContain(
      ".claude/skills/contextforge-domain-packages-mcp.md"
    );
  });

  it("renders Depends on / Used by sections from cross-domain imports edges (Scenario: domain with cross-domain imports renders both sections)", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/a.ts"),
      fileNode("packages/core/src/b.ts"),
      fileNode("packages/cli/src/main.ts"),
      fileNode("packages/cli/src/sub.ts")
    ];
    const edges: GraphEdge[] = [
      importsEdge("packages/cli/src/main.ts", "packages/core/src/a.ts"),
      importsEdge("packages/cli/src/sub.ts", "packages/core/src/a.ts")
    ];
    const result = buildDomainSkills({ nodes, edges });
    const cli = result.files.find((f) =>
      f.path.endsWith("contextforge-domain-packages-cli.md")
    )!;
    expect(cli.content).toContain("## Depends on");
    expect(cli.content).toContain("`packages/core` (2 imports)");

    const core = result.files.find((f) =>
      f.path.endsWith("contextforge-domain-packages-core.md")
    )!;
    expect(core.content).toContain("## Used by");
    expect(core.content).toContain("`packages/cli` (2 imports)");
  });

  it("omits Depends on / Used by sections when domain is isolated (Scenario: isolated domain renders neither section)", () => {
    const nodes: GraphNode[] = [
      fileNode("src/a.ts"),
      fileNode("src/b.ts"),
      fileNode("src/c.ts")
    ];
    const result = buildDomainSkills({ nodes, edges: [] });
    expect(result.files).toHaveLength(1);
    const skill = result.files[0];
    expect(skill.content).not.toContain("## Depends on");
    expect(skill.content).not.toContain("## Used by");
  });

  it("limits Key files via maxFilesShown (Scenario: typical skill stays under the budget)", () => {
    const nodes: GraphNode[] = Array.from({ length: 10 }, (_, i) =>
      fileNode(`packages/core/src/file${i}.ts`)
    );
    const result = buildDomainSkills({
      nodes,
      edges: [],
      maxFilesShown: 3
    });
    const skill = result.files[0];
    const matches = skill.content.match(
      /- `packages\/core\/src\/file\d+\.ts`/g
    );
    expect(matches).not.toBeNull();
    expect(matches!).toHaveLength(3);

    // Ensure the rendered skill stays under the 50-line budget.
    const lines = skill.content.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(50);
  });

  it("produces correct slug for packages/core and src (Scenario: graph with multiple domains produces one skill per domain — slugging)", () => {
    expect(slugify("packages/core")).toBe("packages-core");
    expect(slugify("src")).toBe("src");

    const nodes: GraphNode[] = [
      fileNode("packages/core/src/a.ts"),
      fileNode("packages/core/src/b.ts"),
      fileNode("src/x.ts"),
      fileNode("src/y.ts")
    ];
    const result = buildDomainSkills({ nodes, edges: [] });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain(
      ".claude/skills/contextforge-domain-packages-core.md"
    );
    expect(paths).toContain(".claude/skills/contextforge-domain-src.md");
  });

  it("includes name, description, and tags in the frontmatter (Scenario: frontmatter format is consistent)", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/a.ts"),
      fileNode("packages/core/src/b.ts"),
      fileNode("packages/core/__tests__/a.test.ts", "test")
    ];
    const result = buildDomainSkills({ nodes, edges: [] });
    const skill = result.files.find((f) =>
      f.path.endsWith("contextforge-domain-packages-core.md")
    )!;
    expect(skill.content).toMatch(/^---\n/);
    expect(skill.content).toContain("name: contextforge-domain-packages-core");
    expect(skill.content).toContain(
      "description: Domain context for packages/core — 2 files, 1 tests"
    );
    expect(skill.content).toContain("tags: [packages/core, domain-skill]");
  });

  it("description mentions deps when there are cross-domain edges (Scenario: frontmatter format is consistent — dependency clause)", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/a.ts"),
      fileNode("packages/core/src/b.ts"),
      fileNode("packages/cli/src/main.ts"),
      fileNode("packages/cli/src/sub.ts")
    ];
    const edges: GraphEdge[] = [
      importsEdge("packages/cli/src/main.ts", "packages/core/src/a.ts")
    ];
    const result = buildDomainSkills({ nodes, edges });
    const cli = result.files.find((f) =>
      f.path.endsWith("contextforge-domain-packages-cli.md")
    )!;
    expect(cli.content).toMatch(/description:.*depends on 1/);
    const core = result.files.find((f) =>
      f.path.endsWith("contextforge-domain-packages-core.md")
    )!;
    expect(core.content).toMatch(/description:.*used by 1/);
  });

  it("inferPurpose normalizes camelCase filenames to kebab-case (Scenario: camelCase filename is normalized)", () => {
    expect(inferPurpose("packages/cli/src/htmlTemplate.ts")).toBe(
      "html-template"
    );
    expect(inferPurpose("foo/barBazQux.ts")).toBe("bar-baz-qux");
  });

  it("inferPurpose uses parent directory name for index files (Scenario: index.ts uses parent directory name)", () => {
    expect(inferPurpose("packages/core/src/selector/index.ts")).toBe(
      "selector"
    );
    expect(inferPurpose("packages/core/src/skills/index.ts")).toBe("skills");
  });

  it("produces byte-for-byte identical output for identical input (Scenario: two consecutive runs produce identical files)", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/a.ts"),
      fileNode("packages/core/src/b.ts"),
      fileNode("packages/cli/src/main.ts"),
      fileNode("packages/cli/src/sub.ts")
    ];
    const edges: GraphEdge[] = [
      importsEdge("packages/cli/src/main.ts", "packages/core/src/a.ts")
    ];
    const a = buildDomainSkills({ nodes, edges });
    const b = buildDomainSkills({ nodes, edges });
    expect(a.files.map((f) => f.content)).toEqual(
      b.files.map((f) => f.content)
    );
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
  });

  it("orders Key files by node degree descending (Scenario: deterministic ordering for skill body)", () => {
    const nodes: GraphNode[] = [
      fileNode("packages/core/src/low.ts"),
      fileNode("packages/core/src/hub.ts"),
      fileNode("packages/core/src/leaf.ts"),
      fileNode("packages/cli/src/a.ts"),
      fileNode("packages/cli/src/b.ts")
    ];
    const edges: GraphEdge[] = [
      importsEdge("packages/core/src/low.ts", "packages/core/src/hub.ts"),
      importsEdge("packages/core/src/leaf.ts", "packages/core/src/hub.ts"),
      importsEdge("packages/cli/src/a.ts", "packages/core/src/hub.ts")
    ];
    const result = buildDomainSkills({ nodes, edges });
    const core = result.files.find((f) =>
      f.path.endsWith("contextforge-domain-packages-core.md")
    )!;
    const keySection = core.content.split("## Key files\n\n")[1] ?? "";
    const lines = keySection.split("\n").filter((l) => l.startsWith("- "));
    // hub.ts has the highest degree (3 edges).
    expect(lines[0]).toContain("hub.ts");
  });

  it("does NOT make any network call (Scenario: works offline)", () => {
    // buildDomainSkills is pure: no fetch, no fs, no exec. Verify no globals are touched.
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response("");
    }) as typeof fetch;
    try {
      const result = buildDomainSkills({
        nodes: [
          fileNode("packages/core/src/a.ts"),
          fileNode("packages/core/src/b.ts")
        ],
        edges: []
      });
      expect(result.files).toHaveLength(1);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
