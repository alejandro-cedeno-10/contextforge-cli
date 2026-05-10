import type { ScanFile } from "../../scanner.js";
import type { GraphEdge, GraphNode } from "../builder.js";
import { detectConcepts, type ConceptDetectionResult } from "./concept.js";
import { detectDomains, type DomainDetectionResult } from "./domain.js";
import {
  detectEndpoints,
  type EndpointDetectionResult,
  type EndpointHit
} from "./endpoint.js";
import { detectFlows, type FlowDetectionResult } from "./flow.js";
import { detectLayers, type LayerDetectionResult } from "./layer.js";

/**
 * Pass 5 — semantic enrichment.
 *
 * Runs after the structural builder (passes 0-4) when `withSemantic` is on.
 * Pure orchestrator: delegates to focused detectors, then materialises the
 * result as graph nodes + edges so the caller can append them to the
 * structural graph.
 *
 * Determinism: sorted outputs end-to-end so byte-stable runs are preserved.
 */

export interface RunSemanticPassOptions {
  root: string;
  scanFiles: readonly ScanFile[];
  /** file -> set of files imported by it (collected during pass 2). */
  importedFilesByFile: Map<string, Set<string>>;
  /** Optional reader override for endpoint extraction (testability). */
  readFile?: (absolutePath: string) => Promise<string>;
  /**
   * Opt-in: also run Louvain community detection per domain to emit
   * `concept` nodes. Off by default — only worth it on larger codebases.
   */
  withConcepts?: boolean;
}

export interface RunSemanticPassResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    domainCount: number;
    layerCount: number;
    endpointCount: number;
    flowCount: number;
    conceptCount: number;
  };
  /** Detector outputs are returned for callers that want to inspect them. */
  raw: {
    domains: DomainDetectionResult;
    layers: LayerDetectionResult;
    endpoints: EndpointDetectionResult;
    flows: FlowDetectionResult;
    concepts: ConceptDetectionResult;
  };
}

function endpointId(ep: EndpointHit): string {
  return `endpoint:${ep.method}:${ep.path}`;
}

export async function runSemanticPass(
  options: RunSemanticPassOptions
): Promise<RunSemanticPassResult> {
  const domains = detectDomains(options.scanFiles);
  const layers = detectLayers(options.scanFiles);
  const endpoints = await detectEndpoints({
    root: options.root,
    files: options.scanFiles,
    readFile: options.readFile
  });
  const flows = detectFlows({
    domains: domains.assignments,
    layers: layers.assignments,
    endpoints: endpoints.endpoints,
    importedFilesByFile: options.importedFilesByFile
  });
  const concepts: ConceptDetectionResult = options.withConcepts
    ? detectConcepts({
        domains: domains.assignments,
        importedFilesByFile: options.importedFilesByFile
      })
    : { concepts: [] };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // ── Domain nodes + belongs_to_domain edges ─────────────────────────────────
  const filesPerDomain = new Map<string, Set<string>>();
  const kindsPerDomain = new Map<string, Map<string, number>>();
  for (const a of domains.assignments) {
    if (!filesPerDomain.has(a.domain)) filesPerDomain.set(a.domain, new Set());
    filesPerDomain.get(a.domain)!.add(a.file);
    const fileKind = options.scanFiles.find((f) => f.path === a.file)?.kind;
    if (fileKind) {
      if (!kindsPerDomain.has(a.domain))
        kindsPerDomain.set(a.domain, new Map());
      const map = kindsPerDomain.get(a.domain)!;
      map.set(fileKind, (map.get(fileKind) ?? 0) + 1);
    }
    edges.push({
      from: `file:${a.file}`,
      to: `domain:${a.domain}`,
      type: "belongs_to_domain"
    });
  }
  for (const domainSlug of domains.domains) {
    const fileSet = filesPerDomain.get(domainSlug);
    const kindMap = kindsPerDomain.get(domainSlug);
    const kinds: Record<string, number> = {};
    if (kindMap) {
      for (const k of [...kindMap.keys()].sort())
        kinds[k] = kindMap.get(k) ?? 0;
    }
    nodes.push({
      id: `domain:${domainSlug}`,
      type: "domain",
      label: domainSlug,
      files: fileSet ? fileSet.size : 0,
      kinds
    });
  }

  // ── cross_domain edges (counted by file imports across domains) ────────────
  const domainByFile = new Map<string, string>();
  for (const a of domains.assignments) domainByFile.set(a.file, a.domain);
  const crossCounts = new Map<string, number>();
  for (const [from, targets] of options.importedFilesByFile) {
    const fromDomain = domainByFile.get(from);
    if (!fromDomain) continue;
    for (const to of targets) {
      const toDomain = domainByFile.get(to);
      if (!toDomain || toDomain === fromDomain) continue;
      const key = `${fromDomain}|${toDomain}`;
      crossCounts.set(key, (crossCounts.get(key) ?? 0) + 1);
    }
  }
  const sortedCross = [...crossCounts.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1
  );
  for (const [key, count] of sortedCross) {
    const [from, to] = key.split("|") as [string, string];
    edges.push({
      from: `domain:${from}`,
      to: `domain:${to}`,
      type: "cross_domain",
      weight: count
    });
  }

  // ── Layer nodes + in_layer edges ───────────────────────────────────────────
  for (const a of layers.assignments) {
    edges.push({
      from: `file:${a.file}`,
      to: `layer:${a.layer}`,
      type: "in_layer"
    });
  }
  for (const { layer, kind } of layers.layers) {
    nodes.push({
      id: `layer:${layer}`,
      type: "layer",
      label: layer,
      kind
    });
  }

  // ── Endpoint nodes + exposes_endpoint edges ────────────────────────────────
  const seenEndpointIds = new Set<string>();
  for (const ep of endpoints.endpoints) {
    const id = endpointId(ep);
    if (!seenEndpointIds.has(id)) {
      seenEndpointIds.add(id);
      nodes.push({
        id,
        type: "endpoint",
        label: `${ep.method} ${ep.path}`,
        method: ep.method,
        path: ep.path,
        framework: ep.framework
      });
    }
    edges.push({
      from: `file:${ep.file}`,
      to: id,
      type: "exposes_endpoint"
    });
  }

  // ── Flow + Step nodes + implements_flow + flow_step edges ──────────────────
  for (const flow of flows.flows) {
    nodes.push({
      id: flow.id,
      type: "flow",
      label: flow.label,
      domain: flow.domain,
      entryFile: flow.entryFile,
      stepCount: flow.steps.length
    });
    for (const step of flow.steps) {
      const stepId = `step:${flow.id}#${step.order}`;
      nodes.push({
        id: stepId,
        type: "step",
        label: `${step.order}. ${step.file}`,
        order: step.order,
        stepFile: step.file,
        stepLayer: step.layer
      });
      edges.push({ from: flow.id, to: stepId, type: "flow_step" });
      edges.push({
        from: `file:${step.file}`,
        to: flow.id,
        type: "implements_flow"
      });
    }
  }

  // ── Concept nodes (Louvain) — opt-in ───────────────────────────────────────
  for (const c of concepts.concepts) {
    nodes.push({
      id: c.id,
      type: "concept",
      label: c.label,
      domain: c.domain,
      headSymbol: c.headSymbol,
      modularity: c.modularity
    });
    // Connect each file in the cluster to its concept via implements_flow?
    // No — flow is an ordered use case. For concepts we use belongs_to_domain
    // semantics conceptually but reuse a generic relation: hang the concept
    // off the domain via a `flow_step`-style chain isn't right either.
    // Keep it minimal: emit the node only. Files already belong_to_domain.
    // Consumers walk: domain -> concept (via shared label) when needed.
  }

  return {
    nodes,
    edges,
    stats: {
      domainCount: domains.domains.length,
      layerCount: layers.layers.length,
      endpointCount: endpoints.endpoints.length,
      flowCount: flows.flows.length,
      conceptCount: concepts.concepts.length
    },
    raw: { domains, layers, endpoints, flows, concepts }
  };
}
