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

export interface SpecInput {
  schemaVersion: "1.0.0";
  changeId: string;
  task: string;
  domain: string;
  affectedFiles: SpecInputAffectedFile[];
  crossDomainDeps: SpecInputCrossDomain;
  evidence: SpecInputEvidence;
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
    generatedAt: opts.generatedAt ?? new Date().toISOString()
  };
}
