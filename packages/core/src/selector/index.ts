import type { GraphEdge, GraphNode } from "../graph/builder.js";
import type { ScanFile } from "../scanner.js";
import { bfsExpand, combinedScore } from "./scoring.js";
import { buildPRGraph, personalizedPageRank } from "./pagerank.js";
import { packFiles } from "./packer.js";
import type { PackResult, ScoredFile } from "./packer.js";

export type { PackResult, PackedFile, ScoredFile, FileMode } from "./packer.js";
export type { PageRankOptions } from "./pagerank.js";

export interface SelectContextOptions {
  nodes: GraphNode[];
  edges: GraphEdge[];
  scanFiles: ScanFile[];
  seeds?: string[];
  budget?: number;
  bfsDepth?: number;
  maxCandidates?: number;
}

export interface SelectContextResult extends PackResult {
  pageRankScores: Map<string, number>;
  candidatesTotal: number;
}

export function selectContext(
  options: SelectContextOptions
): SelectContextResult {
  const {
    nodes,
    edges,
    scanFiles,
    seeds = [],
    budget = 12000,
    bfsDepth = 2,
    maxCandidates = 50
  } = options;

  // Index scan sizes for token estimation.
  const sizeByPath = new Map<string, number>(
    scanFiles.map((f) => [f.path, f.size])
  );

  // Work only on code/test file nodes (excludes config, doc, schema, asset).
  const fileNodes = nodes.filter(
    (n) =>
      n.type === "file" && n.path && (n.kind === "code" || n.kind === "test")
  );
  const fileNodeIds = new Set(fileNodes.map((n) => n.id));

  // File-to-file edges only (imports + tests carry the graph structure).
  const fileEdges = edges.filter(
    (e) => fileNodeIds.has(e.from) && fileNodeIds.has(e.to)
  );

  const prGraph = buildPRGraph(fileNodes, fileEdges);

  // Resolve seed paths to node IDs.
  const seedNodeIds = seeds
    .map((p) => `file:${p}`)
    .filter((id) => prGraph.has(id));

  // PageRank: personalized if seeds given, uniform otherwise.
  const prScores = personalizedPageRank(prGraph, seedNodeIds);

  // BFS expansion from seeds (or full graph if no seeds).
  const bfsSeeds =
    seedNodeIds.length > 0 ? seedNodeIds : fileNodes.map((n) => n.id);
  const bfsDistances = bfsExpand(prGraph, bfsSeeds, bfsDepth);

  const seedSet = new Set(seedNodeIds);

  // Score every file node.
  const scored: ScoredFile[] = fileNodes
    .map((n) => {
      const prScore = prScores.get(n.id) ?? 0;
      // Nodes not reached by BFS get distance = bfsDepth (max penalty).
      const bfsDist = bfsDistances.get(n.id) ?? bfsDepth;
      const score =
        seedNodeIds.length > 0 ? combinedScore(prScore, bfsDist) : prScore;

      const sizeBytes = sizeByPath.get(n.path!) ?? 500;
      const estimatedFullTokens = Math.max(20, Math.ceil(sizeBytes / 4));

      return {
        filePath: n.path!,
        score,
        kind: n.kind ?? "code",
        estimatedFullTokens,
        hash: n.hash,
        isSeed: seedSet.has(n.id)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  const packResult = packFiles(scored, budget);

  return {
    ...packResult,
    pageRankScores: prScores,
    candidatesTotal: fileNodes.length
  };
}
