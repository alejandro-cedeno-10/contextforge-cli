import type { GraphEdge, GraphNode } from "./builder.js";

export type SubgraphMode = "compact" | "full";

export interface ExtractSubgraphOptions {
  focusFiles: readonly string[];
  depth?: number;
  mode?: SubgraphMode;
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
    mode: SubgraphMode;
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
  const mode: SubgraphMode = options.mode ?? "compact";
  const focus = options.focusFiles.map((p) => p.replace(/\\/g, "/"));
  const focusSet = new Set(focus);

  // Seed: file nodes for each focus path. Symbols are added below in
  // mode-specific ways — this is the single biggest knob for token cost.
  const seed = new Set<string>();
  for (const f of focus) seed.add(`file:${f}`);

  // In `full` mode we seed every symbol whose file is in the focus set so
  // BFS can ride defines/extends/calls edges out of those symbols.
  // In `compact` mode we postpone symbol selection until after BFS so the
  // expansion only follows file-level edges (imports, contains, tests).
  if (mode === "full") {
    for (const node of fullGraph.nodes) {
      if (node.type === "symbol" && node.path && focusSet.has(node.path)) {
        seed.add(node.id);
      }
    }
  }

  // Adjacency list (undirected) — symmetric BFS gives the agent the same
  // view whether they're walking imports forward or backward.
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

  // Symbol attach policy.
  // - compact (default): only EXPORTED symbols, only from FOCUS files. The
  //   subgraph stays small enough for prompt context — agents working on
  //   the change need to know "what does this file export" not "every
  //   internal helper across every neighbour".
  // - full: every symbol whose file is in the reachable set (legacy v0.3.7
  //   behaviour, opt-in via --subgraph-full).
  for (const node of fullGraph.nodes) {
    if (node.type !== "symbol" || !node.path) continue;
    if (mode === "compact") {
      if (focusSet.has(node.path) && node.exported === true) {
        reachable.add(node.id);
      }
    } else {
      const fileId = `file:${node.path}`;
      if (reachable.has(fileId)) reachable.add(node.id);
    }
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
      depth,
      mode
    }
  };
}
