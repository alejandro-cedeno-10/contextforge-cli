import GraphImport from "graphology";
import louvainImport from "graphology-communities-louvain";

import type { DomainAssignment } from "./domain.js";

/**
 * Interop shims. Both packages publish dual CJS/ESM builds; depending on the
 * resolver path, the default export may surface as the namespace itself
 * (`module.exports = ...`) or under `.default`. Same trick used in
 * src/schema/validator.ts for ajv-formats.
 */
type GraphCtor = new (options?: {
  type?: "directed" | "undirected" | "mixed";
  multi?: boolean;
}) => GraphLike;

interface GraphLike {
  size: number;
  addNode(node: string): void;
  addEdge(from: string, to: string): void;
  hasEdge(from: string, to: string): boolean;
}

interface LouvainDetailedResult {
  communities: Record<string, number>;
  modularity: number;
}

interface LouvainFn {
  detailed(
    graph: GraphLike,
    options?: { rng?: () => number; getEdgeWeight?: string | null }
  ): LouvainDetailedResult;
}

const Graph = ((GraphImport as unknown as { default?: GraphCtor }).default ??
  (GraphImport as unknown as GraphCtor)) as GraphCtor;
const louvain = ((louvainImport as unknown as { default?: LouvainFn })
  .default ?? (louvainImport as unknown as LouvainFn)) as LouvainFn;

/**
 * Concept detection — Louvain community detection over the import subgraph
 * of each domain. Conservative defaults so we don't manufacture noise on
 * small domains:
 *
 *   - skip domains with fewer than MIN_DOMAIN_SIZE files (8 by default).
 *   - skip communities with fewer than MIN_COMMUNITY_SIZE nodes (3).
 *   - skip when the partition's modularity is below MIN_MODULARITY (0.3).
 *
 * The community is named after the file with the highest in-degree in the
 * cluster — the "head" file is usually the one others import.
 *
 * Determinism: Louvain is randomised by default; we pin a seed so two runs
 * over the same input produce byte-identical concept ids.
 */

const MIN_DOMAIN_SIZE = 8;
const MIN_COMMUNITY_SIZE = 3;
const MIN_MODULARITY = 0.3;
const SEED = 42;

export interface Concept {
  /** `concept:<domain>/<slug>` */
  id: string;
  domain: string;
  /** Human-friendly label (slug derived from head file name). */
  label: string;
  /** Symbol id of the most-referenced file in the cluster. */
  headSymbol: string;
  modularity: number;
  files: string[];
}

export interface ConceptDetectionResult {
  concepts: Concept[];
}

export interface DetectConceptsOptions {
  domains: readonly DomainAssignment[];
  /** file -> set of files imported by it (resolved relative paths). */
  importedFilesByFile: Map<string, Set<string>>;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.[^./]+$/, "") // strip extension if present
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildDomainSubgraph(
  filesInDomain: ReadonlySet<string>,
  importedFilesByFile: Map<string, Set<string>>
): GraphLike {
  const g = new Graph({ type: "undirected", multi: false });
  for (const f of filesInDomain) g.addNode(f);
  for (const from of filesInDomain) {
    const targets = importedFilesByFile.get(from);
    if (!targets) continue;
    for (const to of targets) {
      if (!filesInDomain.has(to)) continue;
      if (from === to) continue;
      // mergeEdge tolerates the (a,b)/(b,a) duplicate in undirected graphs.
      if (!g.hasEdge(from, to)) g.addEdge(from, to);
    }
  }
  return g;
}

function pickHeadFile(
  cluster: readonly string[],
  importedFilesByFile: Map<string, Set<string>>
): string {
  // Pick the file most-imported by other files in the cluster.
  // Tie-break: lex smallest path, for byte-stability.
  const inDegree = new Map<string, number>();
  for (const c of cluster) inDegree.set(c, 0);
  for (const from of cluster) {
    const targets = importedFilesByFile.get(from);
    if (!targets) continue;
    for (const to of targets) {
      if (inDegree.has(to)) inDegree.set(to, inDegree.get(to)! + 1);
    }
  }
  let bestFile = cluster[0]!;
  let bestScore = inDegree.get(bestFile) ?? 0;
  for (const f of cluster) {
    const s = inDegree.get(f) ?? 0;
    if (s > bestScore || (s === bestScore && f < bestFile)) {
      bestFile = f;
      bestScore = s;
    }
  }
  return bestFile;
}

export function detectConcepts(
  options: DetectConceptsOptions
): ConceptDetectionResult {
  // Group files by domain (only ones we already classified).
  const filesByDomain = new Map<string, Set<string>>();
  for (const a of options.domains) {
    if (!filesByDomain.has(a.domain)) filesByDomain.set(a.domain, new Set());
    filesByDomain.get(a.domain)!.add(a.file);
  }

  const concepts: Concept[] = [];
  // Sorted iteration -> stable concept ordering.
  const domainSlugs = [...filesByDomain.keys()].sort();

  for (const domain of domainSlugs) {
    const files = filesByDomain.get(domain)!;
    if (files.size < MIN_DOMAIN_SIZE) continue;
    const g = buildDomainSubgraph(files, options.importedFilesByFile);
    if (g.size === 0) continue; // no edges -> no community structure

    let partition: Record<string, number>;
    let modularity: number;
    try {
      const result = louvain.detailed(g, {
        rng: seededRng(SEED),
        getEdgeWeight: null
      });
      partition = result.communities;
      modularity = result.modularity ?? 0;
    } catch {
      continue;
    }

    if (modularity < MIN_MODULARITY) continue;

    // Group node -> community.
    const clusters = new Map<number, string[]>();
    for (const [file, comm] of Object.entries(partition)) {
      if (!clusters.has(comm)) clusters.set(comm, []);
      clusters.get(comm)!.push(file);
    }

    // Stable iteration: sort by community id.
    for (const commId of [...clusters.keys()].sort((a, b) => a - b)) {
      const cluster = clusters.get(commId)!.sort();
      if (cluster.length < MIN_COMMUNITY_SIZE) continue;
      const headFile = pickHeadFile(cluster, options.importedFilesByFile);
      const baseName =
        headFile
          .split("/")
          .pop()
          ?.replace(/\.[^./]+$/, "") ?? "concept";
      concepts.push({
        id: `concept:${domain}/${slugify(baseName)}`,
        domain,
        label: baseName,
        headSymbol: `file:${headFile}`,
        modularity: Number(modularity.toFixed(3)),
        files: cluster
      });
    }
  }

  // Final stable ordering by id.
  concepts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { concepts };
}

/**
 * Tiny seedable PRNG (mulberry32). Pinning the seed guarantees Louvain's
 * randomised tie-breaking always picks the same partition for the same
 * input — required for byte-stable graph.json output.
 */
function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return function rng(): number {
    t = (t + 0x6d2b79f5) | 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
