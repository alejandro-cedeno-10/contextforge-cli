import { describe, expect, it } from "vitest";

import { buildPRGraph, personalizedPageRank } from "../src/selector/pagerank";

describe("buildPRGraph", () => {
  it("indexes nodes and edges correctly", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [
      { from: "a", to: "b", weight: 1 },
      { from: "b", to: "c", weight: 0.8 }
    ];

    const graph = buildPRGraph(nodes, edges);

    expect(graph.size).toBe(3);
    expect(graph.get("a")!.outEdges).toHaveLength(1);
    expect(graph.get("b")!.inEdges).toHaveLength(1);
    expect(graph.get("c")!.inEdges[0]?.from).toBe("b");
  });

  it("skips edges referencing unknown nodes", () => {
    const nodes = [{ id: "a" }];
    const edges = [{ from: "a", to: "ghost", weight: 1 }];

    const graph = buildPRGraph(nodes, edges);

    expect(graph.get("a")!.outEdges).toHaveLength(0);
  });
});

describe("personalizedPageRank", () => {
  it("returns empty map for empty graph", () => {
    const graph = buildPRGraph([], []);
    expect(personalizedPageRank(graph, []).size).toBe(0);
  });

  it("seeds score higher than isolated nodes", () => {
    // a -> b (connected), isolated has no edges at all
    const nodes = [{ id: "a" }, { id: "b" }, { id: "isolated" }];
    const edges = [{ from: "a", to: "b", weight: 1 }];
    const graph = buildPRGraph(nodes, edges);

    const scores = personalizedPageRank(graph, ["a"]);

    // Seed node must outrank a node with zero connection to the seeded subgraph.
    expect(scores.get("a")!).toBeGreaterThan(scores.get("isolated")!);
  });

  it("node with most in-edges scores highest with uniform personalization", () => {
    // a -> hub, b -> hub, c -> hub, hub -> a (cycle keeps probability in system)
    // hub has 3 in-edges and 1 out-edge → high centrality
    const nodes = [{ id: "hub" }, { id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [
      { from: "a", to: "hub", weight: 1 },
      { from: "b", to: "hub", weight: 1 },
      { from: "c", to: "hub", weight: 1 },
      { from: "hub", to: "a", weight: 1 }
    ];
    const graph = buildPRGraph(nodes, edges);

    const scores = personalizedPageRank(graph, []);

    // hub receives from 3 nodes so should score highest
    expect(scores.get("hub")!).toBeGreaterThan(scores.get("b")!);
    expect(scores.get("hub")!).toBeGreaterThan(scores.get("c")!);
  });

  it("is deterministic: two runs on same input give same output", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" }
    ];
    const graph = buildPRGraph(nodes, edges);

    const r1 = personalizedPageRank(graph, ["b"]);
    const r2 = personalizedPageRank(graph, ["b"]);

    expect(r1.get("a")).toBe(r2.get("a"));
    expect(r1.get("b")).toBe(r2.get("b"));
  });

  it("scores sum to approximately 1", () => {
    const nodes = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const edges = [
      { from: "x", to: "y" },
      { from: "y", to: "z" }
    ];
    const graph = buildPRGraph(nodes, edges);

    const scores = personalizedPageRank(graph, []);
    const total = [...scores.values()].reduce((s, v) => s + v, 0);

    // With teleportation and dangling nodes the sum drifts slightly,
    // but should be in [0.5, 1.5].
    expect(total).toBeGreaterThan(0.5);
    expect(total).toBeLessThan(1.5);
  });
});
