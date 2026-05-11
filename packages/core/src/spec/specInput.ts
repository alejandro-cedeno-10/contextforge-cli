import { getDomain } from "../graph/domain.js";
import type { GraphEdge, GraphNode } from "../graph/builder.js";

export interface ContextPackFile {
  path: string;
  reason: string;
  mode: "full" | "excerpt" | "summary";
  hash?: string;
}

export interface ContextPackInput {
  task: string;
  files: ReadonlyArray<ContextPackFile>;
  budget?: { maxInputTokens?: number; estimatedTokens?: number };
}

export interface GraphInput {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
}

export interface SpecInputOptions {
  changeId: string;
  contextPack: ContextPackInput;
  graph?: GraphInput | null;
  /**
   * Pre-computed change subgraph (focus + 1 hop). When provided, the
   * `architecture` block is derived from THIS subset rather than from
   * `graph`. This is the subset-first path used by `forge_spec`: the
   * subset is the single source of truth for everything that ends up
   * inside `openspec/changes/<id>/`. Falling back to `graph` keeps
   * backwards compatibility with callers that only have the global graph.
   */
  subgraph?: GraphInput | null;
  contextPackRef?: string;
  graphRef?: string;
  generatedAt?: string;
}

export interface SpecInputAffectedFile {
  path: string;
  reason: string;
  mode: "full" | "excerpt" | "summary";
  purpose?: string;
}

export interface SpecInputCrossDomain {
  dependsOn: Record<string, number>;
  usedBy: Record<string, number>;
}

export interface SpecInputEvidence {
  contextPackRef: string;
  graphRef: string;
  tokenBudget: number;
  estimatedTokens: number;
}

/**
 * Pass-5 architectural context. All fields are optional so a graph
 * without semantic enrichment still produces a valid SpecInput.
 */
export interface SpecInputArchitecture {
  domains: string[];
  endpoints: Array<{
    method: string;
    path: string;
    framework?: string;
    file?: string;
  }>;
  flows: Array<{
    id: string;
    label: string;
    domain: string;
    stepCount: number;
  }>;
}

export interface SpecInput {
  schemaVersion: "1.0.0";
  changeId: string;
  task: string;
  domain: string;
  affectedFiles: SpecInputAffectedFile[];
  crossDomainDeps: SpecInputCrossDomain;
  evidence: SpecInputEvidence;
  /**
   * Present only when the graph carries Pass-5 nodes for files in the
   * context-pack. Helps the agent / OpenSpec scenarios reason about
   * intent rather than just file paths.
   */
  architecture?: SpecInputArchitecture;
  generatedAt: string;
}

const VALID_CHANGE_ID = /^[a-z0-9][a-z0-9-]*$/;

function inferPurpose(filePath: string): string {
  const parts = filePath.split("/");
  const last = parts[parts.length - 1] ?? filePath;
  const stem = last.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/i, "");
  const base =
    stem === "index" && parts.length >= 2 ? parts[parts.length - 2] : stem;
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function inferTopDomain(filePaths: ReadonlyArray<string>): string {
  if (filePaths.length === 0) return "core";
  const counts = new Map<string, number>();
  for (const p of filePaths) {
    const d = getDomain(p);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = "core";
  let max = 0;
  for (const [d, c] of counts) {
    if (c > max) {
      max = c;
      best = d;
    }
  }
  return best;
}

function computeArchitecture(
  graph: GraphInput | null | undefined,
  affectedFilePaths: ReadonlySet<string>
): SpecInputArchitecture | undefined {
  if (!graph) return undefined;
  // Walk semantic edges anchored on affected files.
  const affectedFileIds = new Set(
    [...affectedFilePaths].map((p) => `file:${p}`)
  );

  const domainIds = new Set<string>();
  const endpointIds = new Set<string>();
  const flowIds = new Set<string>();

  for (const e of graph.edges) {
    if (!affectedFileIds.has(e.from)) continue;
    switch (e.type) {
      case "belongs_to_domain":
        domainIds.add(e.to);
        break;
      case "exposes_endpoint":
        endpointIds.add(e.to);
        break;
      case "implements_flow":
        flowIds.add(e.to);
        break;
      default:
        break;
    }
  }

  if (domainIds.size === 0 && endpointIds.size === 0 && flowIds.size === 0) {
    return undefined;
  }

  // Map ids -> labels by indexing semantic nodes in the graph.
  const nodesById = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodesById.set(n.id, n);

  // For endpoints we also need the originating file so the prompt can cite
  // it. Reverse-lookup via the same edge set we just walked.
  const fileByEndpointId = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.type !== "exposes_endpoint") continue;
    if (!endpointIds.has(e.to)) continue;
    if (!fileByEndpointId.has(e.to) && affectedFileIds.has(e.from)) {
      fileByEndpointId.set(e.to, e.from.replace(/^file:/, ""));
    }
  }

  const domains = [...domainIds]
    .map((id) => nodesById.get(id)?.label)
    .filter((s): s is string => typeof s === "string")
    .sort();

  const endpoints = [...endpointIds]
    .map((id) => {
      const node = nodesById.get(id);
      if (!node) return null;
      const out: SpecInputArchitecture["endpoints"][number] = {
        method: node.method ?? "?",
        path: node.path ?? "?"
      };
      if (node.framework) out.framework = node.framework;
      const file = fileByEndpointId.get(id);
      if (file) out.file = file;
      return out;
    })
    .filter((e): e is SpecInputArchitecture["endpoints"][number] => e !== null)
    .sort((a, b) => {
      const ka = `${a.method} ${a.path}`;
      const kb = `${b.method} ${b.path}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  const flows = [...flowIds]
    .map((id) => {
      const node = nodesById.get(id);
      if (!node) return null;
      return {
        id,
        label: node.label,
        domain: node.domain ?? "?",
        stepCount: node.stepCount ?? 0
      };
    })
    .filter((f): f is SpecInputArchitecture["flows"][number] => f !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { domains, endpoints, flows };
}

function computeCrossDomainDeps(
  graph: GraphInput | null | undefined,
  inDomain: string
): SpecInputCrossDomain {
  const result: SpecInputCrossDomain = { dependsOn: {}, usedBy: {} };
  if (!graph) return result;

  const fileNodesById = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.type === "file" && n.path) fileNodesById.set(n.id, n);
  }

  for (const e of graph.edges) {
    if (e.type !== "imports") continue;
    const from = fileNodesById.get(e.from);
    const to = fileNodesById.get(e.to);
    if (!from?.path || !to?.path) continue;
    const fromDomain = getDomain(from.path);
    const toDomain = getDomain(to.path);
    if (fromDomain === toDomain) continue;
    if (fromDomain === inDomain && toDomain !== inDomain) {
      result.dependsOn[toDomain] = (result.dependsOn[toDomain] ?? 0) + 1;
    } else if (toDomain === inDomain && fromDomain !== inDomain) {
      result.usedBy[fromDomain] = (result.usedBy[fromDomain] ?? 0) + 1;
    }
  }
  return result;
}

export function buildSpecInput(opts: SpecInputOptions): SpecInput {
  if (!VALID_CHANGE_ID.test(opts.changeId)) {
    throw new Error(
      `Invalid changeId "${opts.changeId}": must be kebab-case ([a-z0-9-]+, starting with [a-z0-9])`
    );
  }

  const filesArray = [...opts.contextPack.files];
  const affected: SpecInputAffectedFile[] = filesArray
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => ({
      path: f.path,
      reason: f.reason,
      mode: f.mode,
      purpose: inferPurpose(f.path)
    }));

  const domain = inferTopDomain(affected.map((f) => f.path));
  const crossDomainDeps = computeCrossDomainDeps(opts.graph ?? null, domain);
  const tokenBudget = opts.contextPack.budget?.maxInputTokens ?? 12000;
  const estimatedTokens = opts.contextPack.budget?.estimatedTokens ?? 0;
  // Subset-first: when a pre-computed subgraph is passed, derive the
  // architecture block from it. Otherwise fall back to filtering the
  // global graph (legacy path, byte-equivalent for files in scope).
  const architectureSource = opts.subgraph ?? opts.graph ?? null;
  const architecture = computeArchitecture(
    architectureSource,
    new Set(affected.map((f) => f.path))
  );

  return {
    schemaVersion: "1.0.0",
    changeId: opts.changeId,
    task: opts.contextPack.task,
    domain,
    affectedFiles: affected,
    crossDomainDeps,
    evidence: {
      contextPackRef: opts.contextPackRef ?? ".contextforge/context-pack.json",
      graphRef: opts.graphRef ?? ".contextforge/graph.json",
      tokenBudget,
      estimatedTokens
    },
    ...(architecture ? { architecture } : {}),
    generatedAt: opts.generatedAt ?? new Date().toISOString()
  };
}
