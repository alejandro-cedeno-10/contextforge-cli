import type { GraphEdge, GraphNode } from "./builder.js";

export interface ExtractSubgraphOptions {
  focusFiles: readonly string[];
  depth?: number;
}

export interface SubgraphResult {
  focus: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodesTotal: number;
    edgesTotal: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
    depth: number;
  };
}

/**
 * Extract a subgraph centred on `focusFiles`, expanding outward `depth` hops
 * through every edge type (imports, extends, implements, tests, calls,
 * references). The returned subgraph is self-contained and stable — same
 * input produces byte-identical output.
 */
export function extractChangeSubgraph(
  fullGraph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] },
  options: ExtractSubgraphOptions
): SubgraphResult {
  const depth = Math.max(0, options.depth ?? 1);
  const focus = options.focusFiles.map((p) => p.replace(/\\/g, "/"));

  // Index nodes for quick lookup.
  const nodeById = new Map<string, GraphNode>();
  for (const n of fullGraph.nodes) nodeById.set(n.id, n);

  // Seed: file nodes for each focus path + every symbol that lives in those
  // files (defines edges) + every folder that contains them (contains edges).
  const seed = new Set<string>();
  for (const f of focus) seed.add(`file:${f}`);
  for (const node of fullGraph.nodes) {
    if (node.type === "symbol" && node.path && focus.includes(node.path)) {
      seed.add(node.id);
    }
  }

  // BFS expansion.
  const adjacency = new Map<string, Set<string>>();
  for (const e of fullGraph.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
    if (!adjacency.has(e.to)) adjacency.set(e.to, new Set());
    adjacency.get(e.from)!.add(e.to);
    adjacency.get(e.to)!.add(e.from);
  }

  const reachable = new Set(seed);
  let frontier = new Set(seed);
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      const neighbours = adjacency.get(id);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (reachable.has(nb)) continue;
        reachable.add(nb);
        next.add(nb);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  // Pull symbols defined in any reachable file (so the subgraph is useful for
  // the agent reading the change, even without a full +1 hop).
  for (const node of fullGraph.nodes) {
    if (node.type !== "symbol" || !node.path) continue;
    const fileId = `file:${node.path}`;
    if (reachable.has(fileId)) reachable.add(node.id);
  }

  const nodes = fullGraph.nodes.filter((n) => reachable.has(n.id));
  const edges = fullGraph.edges.filter(
    (e) => reachable.has(e.from) && reachable.has(e.to)
  );

  // Stable ordering — keeps output byte-identical run-to-run.
  const sortedNodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const sortedEdges = [...edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  });

  const nodesByType: Record<string, number> = {};
  for (const n of sortedNodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
  }
  const edgesByType: Record<string, number> = {};
  for (const e of sortedEdges) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1;
  }

  return {
    focus: [...focus].sort(),
    nodes: sortedNodes,
    edges: sortedEdges,
    stats: {
      nodesTotal: sortedNodes.length,
      edgesTotal: sortedEdges.length,
      nodesByType,
      edgesByType,
      depth
    }
  };
}
