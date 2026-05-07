import type { PRGraph } from "./pagerank.js";

export function bfsExpand(
  graph: PRGraph,
  seedIds: ReadonlyArray<string>,
  maxDepth = 2
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: Array<[string, number]> = seedIds
    .filter((id) => graph.has(id))
    .map((id) => [id, 0]);

  while (queue.length > 0) {
    const [nodeId, depth] = queue.shift()!;
    if (distances.has(nodeId)) continue;
    distances.set(nodeId, depth);

    if (depth < maxDepth) {
      const node = graph.get(nodeId);
      if (!node) continue;
      for (const { to } of node.outEdges) {
        if (!distances.has(to)) {
          queue.push([to, depth + 1]);
        }
      }
    }
  }

  return distances;
}

export function combinedScore(
  prScore: number,
  bfsDistance: number,
  edgeTypeMultiplier = 1.0
): number {
  return prScore * (1 / (1 + bfsDistance)) * edgeTypeMultiplier;
}
