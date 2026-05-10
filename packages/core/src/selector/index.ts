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
  /**
   * Free-text task description. When provided AND the graph contains
   * Pass-5 `domain` nodes, files whose domain label matches a task keyword
   * receive a boost (semanticBoost factor) applied after PageRank+BFS.
   * Pure deterministic heuristic — no LLM.
   */
  task?: string;
  /** Multiplier applied to score of files in matched domains. Default 1.5. */
  semanticBoost?: number;
  budget?: number;
  bfsDepth?: number;
  maxCandidates?: number;
}

export interface SelectContextResult extends PackResult {
  pageRankScores: Map<string, number>;
  candidatesTotal: number;
  /** Domain ids ("domain:auth", ...) whose label matched a task keyword. */
  semanticBoostedDomains: string[];
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "fix",
  "bug",
  "add",
  "new",
  "use",
  "this",
  "that",
  "into",
  "out",
  "feature",
  "implement",
  "implementing",
  "remove",
  "update",
  "refactor",
  "test",
  "tests"
]);

function extractKeywords(task: string): string[] {
  return task
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function findMatchedDomainIds(
  task: string,
  nodes: ReadonlyArray<GraphNode>
): Set<string> {
  const keywords = extractKeywords(task);
  if (keywords.length === 0) return new Set();
  const matched = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "domain") continue;
    const slug = n.label.toLowerCase();
    for (const kw of keywords) {
      if (slug === kw || slug.includes(kw) || kw.includes(slug)) {
        matched.add(n.id);
        break;
      }
    }
  }
  return matched;
}

export function selectContext(
  options: SelectContextOptions
): SelectContextResult {
  const {
    nodes,
    edges,
    scanFiles,
    seeds = [],
    task,
    semanticBoost = 1.5,
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

  // ── Semantic boost ─────────────────────────────────────────────────────────
  // When the graph carries Pass-5 `domain` nodes and the caller provided a
  // task description, find files belonging to a matched domain and remember
  // them so we can multiply their score below. Pure heuristic, byte-stable.
  const matchedDomainIds = task
    ? findMatchedDomainIds(task, nodes)
    : new Set<string>();
  const boostedFileIds = new Set<string>();
  if (matchedDomainIds.size > 0) {
    for (const e of edges) {
      if (e.type !== "belongs_to_domain") continue;
      if (matchedDomainIds.has(e.to)) boostedFileIds.add(e.from);
    }
  }

  // Score every file node.
  const scored: ScoredFile[] = fileNodes
    .map((n) => {
      const prScore = prScores.get(n.id) ?? 0;
      // Nodes not reached by BFS get distance = bfsDepth (max penalty).
      const bfsDist = bfsDistances.get(n.id) ?? bfsDepth;
      let score =
        seedNodeIds.length > 0 ? combinedScore(prScore, bfsDist) : prScore;
      if (boostedFileIds.has(n.id)) score *= semanticBoost;

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
    candidatesTotal: fileNodes.length,
    semanticBoostedDomains: [...matchedDomainIds].sort()
  };
}
