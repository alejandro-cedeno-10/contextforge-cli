import type { DomainAssignment } from "./domain.js";
import type { EndpointHit } from "./endpoint.js";
import type { LayerAssignment } from "./layer.js";

/**
 * Flow detection.
 *
 * A "flow" is a deterministic chain of imports starting from a file that
 * exposes an endpoint, walking forward through files in the same domain that
 * cross at least two distinct layers (e.g. controller -> service -> repository
 * for backend, page -> hook -> store for frontend).
 *
 * No LLM. No content reads. Walks the import graph passed in by the builder.
 *
 * Trade-offs:
 *   - Depth limited to MAX_DEPTH to prevent fan-out.
 *   - Steps must stay inside the same domain (avoids spurious cross-domain
 *     flows through shared utilities).
 *   - Each endpoint produces at most one flow (the longest valid chain). If
 *     several chains tie, the lexicographically smallest path wins for
 *     byte-stability.
 */

const MAX_DEPTH = 4;

export interface FlowStep {
  order: number;
  file: string;
  layer: string;
}

export interface Flow {
  /** `flow:<domain>/<slug>` */
  id: string;
  domain: string;
  /** Human-friendly label (entry endpoint + verb hint). */
  label: string;
  entryFile: string;
  steps: FlowStep[];
}

export interface FlowDetectionResult {
  flows: Flow[];
}

export interface DetectFlowsOptions {
  domains: readonly DomainAssignment[];
  layers: readonly LayerAssignment[];
  endpoints: readonly EndpointHit[];
  /** file -> set of files imported by it (resolved relative paths). */
  importedFilesByFile: Map<string, Set<string>>;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildLookup<T extends { file: string }>(
  list: readonly T[]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of list) map.set(item.file, item);
  return map;
}

function pathSlugFromEndpoint(ep: EndpointHit): string {
  // Remove HTTP path params like `:id` and slashes; collapse to kebab.
  const base = ep.path.replace(/[:{}*]/g, "").replace(/^\/+|\/+$/g, "");
  const verbHint = ep.method === "CLI" ? "cli" : ep.method.toLowerCase();
  return slugify(`${verbHint}-${base || "root"}`);
}

/**
 * BFS-style longest-chain search. Returns the deepest reachable chain (up to
 * MAX_DEPTH) where every hop changes layer. Ties broken alphabetically.
 */
function longestLayerChain(
  startFile: string,
  options: {
    domain: string;
    layerByFile: Map<string, LayerAssignment>;
    domainByFile: Map<string, string>;
    importedFilesByFile: Map<string, Set<string>>;
  }
): FlowStep[] {
  const startLayer = options.layerByFile.get(startFile);
  if (!startLayer) return [];

  // DFS keeping the best (longest, then lex-smallest) chain found.
  let best: FlowStep[] = [
    { order: 1, file: startFile, layer: startLayer.layer }
  ];

  const visit = (
    chain: FlowStep[],
    visited: Set<string>,
    depth: number
  ): void => {
    if (depth >= MAX_DEPTH) return;
    const last = chain[chain.length - 1]!;
    const neighbours = options.importedFilesByFile.get(last.file);
    if (!neighbours || neighbours.size === 0) return;

    // Sorted for byte-stable traversal.
    const sortedNb = [...neighbours].sort();
    for (const nb of sortedNb) {
      if (visited.has(nb)) continue;
      const nbDomain = options.domainByFile.get(nb);
      if (nbDomain !== options.domain) continue;
      const nbLayer = options.layerByFile.get(nb);
      if (!nbLayer) continue;
      if (nbLayer.layer === last.layer) continue;

      const nextChain: FlowStep[] = [
        ...chain,
        { order: chain.length + 1, file: nb, layer: nbLayer.layer }
      ];
      const nextVisited = new Set(visited);
      nextVisited.add(nb);

      // Track best.
      if (
        nextChain.length > best.length ||
        (nextChain.length === best.length && lexLess(nextChain, best))
      ) {
        best = nextChain;
      }

      visit(nextChain, nextVisited, depth + 1);
    }
  };

  visit(best, new Set([startFile]), 0);
  return best;
}

function lexLess(a: readonly FlowStep[], b: readonly FlowStep[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i]!.file < b[i]!.file) return true;
    if (a[i]!.file > b[i]!.file) return false;
  }
  return a.length < b.length;
}

export function detectFlows(options: DetectFlowsOptions): FlowDetectionResult {
  const domainByFile = new Map<string, string>();
  for (const a of options.domains) domainByFile.set(a.file, a.domain);

  const layerByFile = buildLookup(options.layers);

  const flows: Flow[] = [];
  const seenIds = new Set<string>();

  for (const ep of options.endpoints) {
    const domain = domainByFile.get(ep.file);
    if (!domain) continue;

    const chain = longestLayerChain(ep.file, {
      domain,
      layerByFile,
      domainByFile,
      importedFilesByFile: options.importedFilesByFile
    });

    // A valid flow needs at least 2 distinct layers (entry + 1 hop).
    if (chain.length < 2) continue;

    const slug = pathSlugFromEndpoint(ep);
    const baseId = `flow:${domain}/${slug}`;
    let id = baseId;
    let suffix = 1;
    while (seenIds.has(id)) {
      suffix++;
      id = `${baseId}-${suffix}`;
    }
    seenIds.add(id);

    flows.push({
      id,
      domain,
      label: `${ep.method} ${ep.path}`,
      entryFile: ep.file,
      steps: chain
    });
  }

  // Stable order by id.
  flows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { flows };
}
