export interface PREdge {
  to: string;
  weight: number;
}

export interface PRNode {
  id: string;
  outEdges: PREdge[];
  inEdges: Array<{ from: string; weight: number }>;
}

export type PRGraph = Map<string, PRNode>;

export function buildPRGraph(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ from: string; to: string; weight?: number }>
): PRGraph {
  const graph: PRGraph = new Map();

  for (const node of nodes) {
    graph.set(node.id, { id: node.id, outEdges: [], inEdges: [] });
  }

  for (const edge of edges) {
    const fromNode = graph.get(edge.from);
    const toNode = graph.get(edge.to);
    if (!fromNode || !toNode) continue;
    const weight = edge.weight ?? 1.0;
    fromNode.outEdges.push({ to: edge.to, weight });
    toNode.inEdges.push({ from: edge.from, weight });
  }

  return graph;
}

export interface PageRankOptions {
  alpha?: number;
  iterations?: number;
  tolerance?: number;
}

export function personalizedPageRank(
  graph: PRGraph,
  seeds: ReadonlyArray<string>,
  opts: PageRankOptions = {}
): Map<string, number> {
  const { alpha = 0.85, iterations = 50, tolerance = 1e-6 } = opts;
  const nodeIds = [...graph.keys()];
  const N = nodeIds.length;

  if (N === 0) return new Map();

  // Build personalization vector.
  const personalization = new Map<string, number>();
  const seedSet = new Set(seeds.filter((s) => graph.has(s)));

  if (seedSet.size > 0) {
    const seedWeight = 1 / seedSet.size;
    for (const id of nodeIds) {
      personalization.set(id, seedSet.has(id) ? seedWeight : 0);
    }
  } else {
    const uniform = 1 / N;
    for (const id of nodeIds) {
      personalization.set(id, uniform);
    }
  }

  // Initialize scores uniformly.
  let scores = new Map<string, number>();
  for (const id of nodeIds) {
    scores.set(id, 1 / N);
  }

  // Dangling nodes: nodes with no out-edges whose probability would leak.
  const danglingIds = nodeIds.filter(
    (id) => graph.get(id)!.outEdges.length === 0
  );

  // Power iteration.
  for (let iter = 0; iter < iterations; iter++) {
    // Redistribute dangling-node probability uniformly (standard fix).
    const danglingMass =
      danglingIds.reduce((s, id) => s + (scores.get(id) ?? 0), 0) / N;

    const next = new Map<string, number>();
    let diff = 0;

    for (const id of nodeIds) {
      const node = graph.get(id)!;
      let rankSum = danglingMass;

      for (const { from, weight } of node.inEdges) {
        const fromNode = graph.get(from)!;
        const outWeightTotal = fromNode.outEdges.reduce(
          (s, e) => s + e.weight,
          0
        );
        if (outWeightTotal > 0) {
          rankSum += ((scores.get(from) ?? 0) * weight) / outWeightTotal;
        }
      }

      const newScore =
        (1 - alpha) * (personalization.get(id) ?? 0) + alpha * rankSum;
      next.set(id, newScore);
      diff += Math.abs(newScore - (scores.get(id) ?? 0));
    }

    scores = next;
    if (diff < tolerance) break;
  }

  return scores;
}
