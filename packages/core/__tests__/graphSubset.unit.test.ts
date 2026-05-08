import { describe, expect, it } from "vitest";

import { extractChangeSubgraph } from "../src/graph/subset";
import type { GraphEdge, GraphNode } from "../src/graph/builder";

const NODES: GraphNode[] = [
  { id: "file:src/a.ts", type: "file", label: "a.ts", path: "src/a.ts" },
  { id: "file:src/b.ts", type: "file", label: "b.ts", path: "src/b.ts" },
  { id: "file:src/c.ts", type: "file", label: "c.ts", path: "src/c.ts" },
  { id: "file:src/d.ts", type: "file", label: "d.ts", path: "src/d.ts" },
  {
    id: "symbol:src/a.ts#Foo",
    type: "symbol",
    label: "Foo",
    path: "src/a.ts",
    exported: true
  },
  {
    id: "symbol:src/b.ts#Bar",
    type: "symbol",
    label: "Bar",
    path: "src/b.ts",
    exported: true
  },
  {
    id: "symbol:src/c.ts#Baz",
    type: "symbol",
    label: "Baz",
    path: "src/c.ts",
    exported: true
  }
];

const EDGES: GraphEdge[] = [
  { from: "file:src/a.ts", to: "symbol:src/a.ts#Foo", type: "defines" },
  { from: "file:src/b.ts", to: "symbol:src/b.ts#Bar", type: "defines" },
  { from: "file:src/c.ts", to: "symbol:src/c.ts#Baz", type: "defines" },
  { from: "file:src/a.ts", to: "file:src/b.ts", type: "imports" },
  { from: "file:src/b.ts", to: "file:src/c.ts", type: "imports" },
  { from: "file:src/c.ts", to: "file:src/d.ts", type: "imports" }
];

describe("extractChangeSubgraph", () => {
  it("returns the focus file plus 1-hop neighbours by default", () => {
    const result = extractChangeSubgraph(
      { nodes: NODES, edges: EDGES },
      { focusFiles: ["src/a.ts"] }
    );
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toContain("file:src/a.ts");
    expect(ids).toContain("file:src/b.ts");
    expect(ids).toContain("symbol:src/a.ts#Foo");
    // 1-hop neighbour b → its symbol comes along too.
    expect(ids).toContain("symbol:src/b.ts#Bar");
    // c is 2 hops away — should not appear.
    expect(ids).not.toContain("file:src/c.ts");
    expect(ids).not.toContain("symbol:src/c.ts#Baz");
  });

  it("respects depth=2", () => {
    const result = extractChangeSubgraph(
      { nodes: NODES, edges: EDGES },
      { focusFiles: ["src/a.ts"], depth: 2 }
    );
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("file:src/c.ts");
    expect(ids).not.toContain("file:src/d.ts");
  });

  it("includes only edges between reachable nodes", () => {
    const result = extractChangeSubgraph(
      { nodes: NODES, edges: EDGES },
      { focusFiles: ["src/a.ts"] }
    );
    for (const e of result.edges) {
      const fromKept = result.nodes.some((n) => n.id === e.from);
      const toKept = result.nodes.some((n) => n.id === e.to);
      expect(fromKept && toKept).toBe(true);
    }
  });

  it("orders nodes/edges deterministically", () => {
    const a = extractChangeSubgraph(
      { nodes: NODES, edges: EDGES },
      { focusFiles: ["src/a.ts"] }
    );
    const b = extractChangeSubgraph(
      { nodes: [...NODES].reverse(), edges: [...EDGES].reverse() },
      { focusFiles: ["src/a.ts"] }
    );
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(JSON.stringify(a.edges)).toBe(JSON.stringify(b.edges));
  });

  it("populates stats with depth and per-type counts", () => {
    const result = extractChangeSubgraph(
      { nodes: NODES, edges: EDGES },
      { focusFiles: ["src/a.ts"] }
    );
    expect(result.stats.depth).toBe(1);
    expect(result.stats.nodesTotal).toBe(result.nodes.length);
    expect(result.stats.edgesTotal).toBe(result.edges.length);
    expect(result.stats.nodesByType["file"]).toBeGreaterThan(0);
    expect(result.stats.edgesByType["imports"]).toBeGreaterThan(0);
  });

  it("returns an empty subgraph when focus has no matching files", () => {
    const result = extractChangeSubgraph(
      { nodes: NODES, edges: EDGES },
      { focusFiles: ["does/not/exist.ts"] }
    );
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.focus).toEqual(["does/not/exist.ts"]);
  });
});
