import { describe, expect, it } from "vitest";

import { buildPRGraph } from "../src/selector/pagerank";
import { bfsExpand, combinedScore } from "../src/selector/scoring";

describe("bfsExpand", () => {
  it("returns empty map for empty seeds", () => {
    const graph = buildPRGraph(
      [{ id: "a" }, { id: "b" }],
      [{ from: "a", to: "b", weight: 1 }]
    );
    expect(bfsExpand(graph, []).size).toBe(0);
  });

  it("seeds that are not in graph are silently skipped", () => {
    const graph = buildPRGraph([{ id: "a" }], []);
    const result = bfsExpand(graph, ["ghost"]);
    expect(result.size).toBe(0);
  });

  it("seed itself has distance 0", () => {
    const graph = buildPRGraph(
      [{ id: "a" }, { id: "b" }],
      [{ from: "a", to: "b", weight: 1 }]
    );
    const result = bfsExpand(graph, ["a"]);
    expect(result.get("a")).toBe(0);
  });

  it("direct neighbor has distance 1", () => {
    const graph = buildPRGraph(
      [{ id: "a" }, { id: "b" }],
      [{ from: "a", to: "b", weight: 1 }]
    );
    const result = bfsExpand(graph, ["a"], 2);
    expect(result.get("b")).toBe(1);
  });

  it("transitive neighbor has distance 2", () => {
    const graph = buildPRGraph(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { from: "a", to: "b", weight: 1 },
        { from: "b", to: "c", weight: 1 }
      ]
    );
    const result = bfsExpand(graph, ["a"], 2);
    expect(result.get("c")).toBe(2);
  });

  it("respects maxDepth: nodes beyond depth are not returned", () => {
    const graph = buildPRGraph(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { from: "a", to: "b", weight: 1 },
        { from: "b", to: "c", weight: 1 }
      ]
    );
    const result = bfsExpand(graph, ["a"], 1);
    expect(result.has("c")).toBe(false);
    expect(result.has("b")).toBe(true);
  });

  it("does not visit the same node twice (cycle safety)", () => {
    const graph = buildPRGraph(
      [{ id: "a" }, { id: "b" }],
      [
        { from: "a", to: "b", weight: 1 },
        { from: "b", to: "a", weight: 1 }
      ]
    );
    const result = bfsExpand(graph, ["a"], 3);
    expect(result.get("a")).toBe(0);
    expect(result.get("b")).toBe(1);
    expect(result.size).toBe(2);
  });
});

describe("combinedScore", () => {
  it("seed node (distance 0) returns full pagerank score", () => {
    expect(combinedScore(0.8, 0)).toBeCloseTo(0.8);
  });

  it("distance 1 halves the score", () => {
    expect(combinedScore(1.0, 1)).toBeCloseTo(0.5);
  });

  it("distance 2 reduces to one third", () => {
    expect(combinedScore(1.0, 2)).toBeCloseTo(1 / 3);
  });

  it("edge type multiplier scales the result", () => {
    const base = combinedScore(1.0, 0, 1.0);
    const boosted = combinedScore(1.0, 0, 1.2);
    expect(boosted).toBeCloseTo(base * 1.2);
  });

  it("zero pagerank score gives zero combined score", () => {
    expect(combinedScore(0, 0, 1.5)).toBe(0);
  });
});
