import { execSync as nodeExecSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  blake3Hex,
  buildAgentManifest,
  buildGraph,
  buildOpenSpec,
  buildSpecInput,
  extractChangeSubgraph,
  getDomain,
  GRAPH_CACHE_FILE,
  loadGraphCache,
  loadRuleEntries,
  loadSkillEntries,
  renderChangeContextMd,
  renderSpecPrompt,
  saveGraphCache,
  scanProject,
  selectContext,
  SCHEMA_VERSIONS,
  validateGuardrails,
  validateOpenSpecFiles,
  validateOrThrow,
  type AgentManifestResult,
  type ScanResult,
  type GraphNode,
  type GraphEdge
} from "@anai-raia-alex/contextforge-core";

export { getDomain };

// ─── types ────────────────────────────────────────────────────────────────────

interface GraphArtifact {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Record<string, unknown>;
  generatedAt: string;
  scanRef?: { scanHash?: string };
}

interface ScanArtifact extends ScanResult {}

interface PlanArtifact {
  taskId: string;
  title: string;
  status: string;
  guardrails: {
    allowedFiles: string[];
    forbiddenPaths: string[];
    maxLocDelta: number;
    maxFilesChanged?: number;
  };
  tasks: unknown[];
}

type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

// ─── pure helpers ─────────────────────────────────────────────────────────────

export function formatFileList(
  files: Array<{ path: string; reason: string; mode: string; score?: number }>,
  includeScore = false
): string {
  return files
    .map((f) => {
      const scoreStr =
        includeScore && f.score != null ? ` [score=${f.score.toFixed(4)}]` : "";
      return `- ${f.path} (${f.mode}, ${f.reason})${scoreStr}`;
    })
    .join("\n");
}

// ─── handler factory ──────────────────────────────────────────────────────────

interface HandlerDeps {
  execSync?: typeof nodeExecSync;
}

export function createHandlers(root: string, deps: HandlerDeps = {}) {
  const execSyncFn = deps.execSync ?? nodeExecSync;

  let _graph: GraphArtifact | null = null;
  let _graphMtime = 0;
  let _scan: ScanArtifact | null = null;
  let _scanMtime = 0;

  function artifactPath(...parts: string[]): string {
    return path.join(root, ".contextforge", ...parts);
  }

  async function loadGraph(): Promise<GraphArtifact> {
    const mtime = await fs
      .stat(artifactPath("graph.json"))
      .then((s) => s.mtimeMs)
      .catch(() => 0);
    if (_graph && mtime === _graphMtime) return _graph;
    const raw = await fs.readFile(artifactPath("graph.json"), "utf8");
    _graph = JSON.parse(raw) as GraphArtifact;
    _graphMtime = mtime;
    return _graph;
  }

  async function loadScan(): Promise<ScanArtifact> {
    const mtime = await fs
      .stat(artifactPath("scan.json"))
      .then((s) => s.mtimeMs)
      .catch(() => 0);
    if (_scan && mtime === _scanMtime) return _scan;
    const raw = await fs.readFile(artifactPath("scan.json"), "utf8");
    _scan = JSON.parse(raw) as ScanArtifact;
    _scanMtime = mtime;
    return _scan;
  }

  async function tryReadPlan(): Promise<PlanArtifact | null> {
    try {
      const raw = await fs.readFile(
        artifactPath("implement-plan.json"),
        "utf8"
      );
      return JSON.parse(raw) as PlanArtifact;
    } catch {
      return null;
    }
  }

  // ── forge_context ────────────────────────────────────────────────────────────

  async function forgeContext({
    task,
    seeds = [],
    budget = 12000,
    include_content = false
  }: {
    task: string;
    seeds?: string[];
    budget?: number;
    include_content?: boolean;
  }): Promise<ToolResult> {
    const [graph, scanData] = await Promise.all([loadGraph(), loadScan()]);

    const result = selectContext({
      nodes: graph.nodes as Parameters<typeof selectContext>[0]["nodes"],
      edges: graph.edges as Parameters<typeof selectContext>[0]["edges"],
      scanFiles: scanData.files,
      seeds,
      task,
      budget
    });

    const sizeByPath = new Map(scanData.files.map((f) => [f.path, f.size]));

    const lines: string[] = [
      `# Context pack for: "${task}"`,
      ``,
      `**${result.files.length} files selected** | estimated ${result.estimatedTokens} tokens | budget ${budget}`,
      ``
    ];

    if (seeds.length) lines.push(`Seeds: ${seeds.join(", ")}`, ``);

    lines.push("## Files\n");
    for (const f of result.files) {
      const estTokens = Math.max(
        20,
        Math.ceil((sizeByPath.get(f.path) ?? 500) / 4)
      );
      lines.push(`### ${f.path}`);
      lines.push(
        `- mode: **${f.mode}** | reason: ${f.reason} | ~${estTokens} tokens`
      );
      if (include_content) {
        try {
          const content = await fs.readFile(path.join(root, f.path), "utf8");
          const preview =
            f.mode === "full"
              ? content
              : f.mode === "excerpt"
                ? content.split("\n").slice(0, 50).join("\n") +
                  "\n// ... (excerpt)"
                : `// Summary: ${f.path} — ${f.reason}`;
          lines.push("```", preview, "```");
        } catch {
          lines.push(`_Could not read file_`);
        }
      }
      lines.push("");
    }

    lines.push(
      `## Token savings`,
      `- This pack: ~${result.estimatedTokens} tokens`,
      `- Full repo baseline: see token-ledger.json`,
      ``
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_neighbors ──────────────────────────────────────────────────────────

  async function forgeNeighbors({
    file_path,
    depth = 1
  }: {
    file_path: string;
    depth?: number;
  }): Promise<ToolResult> {
    const graph = await loadGraph();
    const nodeId = `file:${file_path}`;
    const node = graph.nodes.find((n) => n.id === nodeId);

    if (!node) {
      const similar = graph.nodes
        .filter(
          (n) =>
            n.type === "file" && n.path?.includes(file_path.split("/").pop()!)
        )
        .slice(0, 5)
        .map((n) => n.path);
      return {
        content: [
          {
            type: "text",
            text: `File not found: ${file_path}\n\nSimilar files:\n${similar.map((p) => `- ${p}`).join("\n") || "none"}`
          }
        ]
      };
    }

    const visited = new Set<string>([nodeId]);
    const frontier = new Set<string>([nodeId]);
    const edgeMap: Record<
      string,
      Array<{ to: string; type: string; dir: "out" | "in" }>
    > = {};

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const fid of frontier) {
        const outEdges = graph.edges.filter(
          (e) => e.from === fid && !visited.has(e.to)
        );
        const inEdges = graph.edges.filter(
          (e) => e.to === fid && !visited.has(e.from)
        );
        if (!edgeMap[fid]) edgeMap[fid] = [];
        for (const e of outEdges) {
          edgeMap[fid].push({ to: e.to, type: e.type, dir: "out" });
          nextFrontier.add(e.to);
          visited.add(e.to);
        }
        for (const e of inEdges) {
          if (!edgeMap[e.from]) edgeMap[e.from] = [];
          edgeMap[e.from].push({ to: fid, type: e.type, dir: "out" });
          edgeMap[fid].push({ to: e.from, type: e.type, dir: "in" });
          nextFrontier.add(e.from);
          visited.add(e.from);
        }
      }
      frontier.clear();
      for (const id of nextFrontier) frontier.add(id);
    }

    const getLabel = (id: string) =>
      graph.nodes.find((n) => n.id === id)?.path ?? id.replace("file:", "");

    const sections: Record<string, string[]> = {
      imports: [],
      imported_by: [],
      tests: [],
      tested_by: [],
      defines: [],
      same_domain: [],
      same_layer: [],
      exposes_endpoint: [],
      flows_participating: [],
      other: []
    };

    // Semantic-layer pre-pass: when the file has belongs_to_domain or
    // in_layer edges, collect peer files in the same domain/layer.
    const findNodeById = (id: string): GraphNode | undefined =>
      graph.nodes.find((n) => n.id === id);
    const directDomainIds = new Set<string>();
    const directLayerIds = new Set<string>();
    for (const e of graph.edges) {
      if (e.from !== nodeId) continue;
      if (e.type === "belongs_to_domain") directDomainIds.add(e.to);
      if (e.type === "in_layer") directLayerIds.add(e.to);
    }
    if (directDomainIds.size > 0) {
      for (const e of graph.edges) {
        if (e.type !== "belongs_to_domain") continue;
        if (!directDomainIds.has(e.to)) continue;
        if (e.from === nodeId) continue;
        sections.same_domain!.push(getLabel(e.from));
      }
    }
    if (directLayerIds.size > 0) {
      for (const e of graph.edges) {
        if (e.type !== "in_layer") continue;
        if (!directLayerIds.has(e.to)) continue;
        if (e.from === nodeId) continue;
        sections.same_layer!.push(getLabel(e.from));
      }
    }

    for (const rel of edgeMap[nodeId] ?? []) {
      const label = getLabel(rel.to);
      const targetNode = findNodeById(rel.to);
      if (rel.type === "imports" && rel.dir === "out")
        sections.imports!.push(label);
      else if (rel.type === "imports" && rel.dir === "in")
        sections.imported_by!.push(label);
      else if (rel.type === "tests" && rel.dir === "out")
        sections.tests!.push(label);
      else if (rel.type === "tests" && rel.dir === "in")
        sections.tested_by!.push(label);
      else if (rel.type === "defines") sections.defines!.push(label);
      else if (rel.type === "exposes_endpoint" && targetNode) {
        const m = targetNode.method ?? "?";
        const p = targetNode.path ?? "?";
        const fwk = targetNode.framework ? ` [${targetNode.framework}]` : "";
        sections.exposes_endpoint!.push(`${m} ${p}${fwk}`);
      } else if (rel.type === "implements_flow" && targetNode) {
        sections.flows_participating!.push(
          `${targetNode.label} (${targetNode.id})`
        );
      } else if (rel.type === "belongs_to_domain" || rel.type === "in_layer") {
        // Already handled above; skip to avoid double-listing.
        continue;
      } else sections.other!.push(`[${rel.type}] ${label}`);
    }

    // Dedupe & sort each section for byte-stable output.
    for (const key of Object.keys(sections)) {
      sections[key] = [...new Set(sections[key]!)].sort();
    }

    const lines = [`# Graph neighbors: ${file_path}`, ``];
    lines.push(
      `**Kind**: ${node.kind ?? "unknown"} | **Lang**: ${node.lang ?? "unknown"}`,
      ``
    );

    for (const [key, items] of Object.entries(sections)) {
      if (!items.length) continue;
      lines.push(`## ${key.replace("_", " ")} (${items.length})`);
      lines.push(...items.map((i) => `- ${i}`));
      lines.push("");
    }

    if (Object.values(sections).every((arr) => !arr.length)) {
      lines.push("_No connections found for this file in the visible graph._");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_domain_map ─────────────────────────────────────────────────────────

  async function forgeDomainMap(): Promise<ToolResult> {
    const graph = await loadGraph();

    // If the graph carries Pass-5 `domain` nodes + `belongs_to_domain` edges,
    // use them — they're more accurate than the trivial getDomain() fallback.
    const semanticDomainNodes = graph.nodes.filter((n) => n.type === "domain");
    const useSemantic = semanticDomainNodes.length > 0;

    const domainFiles = new Map<string, string[]>();
    const domainOf = (filePath: string): string => getDomain(filePath);

    if (useSemantic) {
      // Pre-index file path -> domain via belongs_to_domain edges.
      const fileToDomain = new Map<string, string>();
      for (const e of graph.edges) {
        if (e.type !== "belongs_to_domain") continue;
        const filePath = e.from.replace(/^file:/, "");
        const domainSlug = e.to.replace(/^domain:/, "");
        fileToDomain.set(filePath, domainSlug);
      }
      for (const n of graph.nodes) {
        if (n.type !== "file" || !n.path) continue;
        const d = fileToDomain.get(n.path) ?? domainOf(n.path);
        if (!domainFiles.has(d)) domainFiles.set(d, []);
        domainFiles.get(d)!.push(n.path);
      }
    } else {
      for (const n of graph.nodes) {
        if (n.type !== "file" || !n.path) continue;
        const d = domainOf(n.path);
        if (!domainFiles.has(d)) domainFiles.set(d, []);
        domainFiles.get(d)!.push(n.path);
      }
    }

    const domainEdges = new Map<string, { imports: number; tests: number }>();
    if (useSemantic) {
      // Use cross_domain edges (already aggregated by Pass 5).
      for (const e of graph.edges) {
        if (e.type !== "cross_domain") continue;
        const fd = e.from.replace(/^domain:/, "");
        const td = e.to.replace(/^domain:/, "");
        const key = `${fd} → ${td}`;
        domainEdges.set(key, {
          imports: typeof e.weight === "number" ? e.weight : 1,
          tests: 0
        });
      }
    } else {
      for (const e of graph.edges) {
        if (e.type === "defines" || e.type === "contains") continue;
        const fn = graph.nodes.find((n) => n.id === e.from);
        const tn = graph.nodes.find((n) => n.id === e.to);
        if (!fn?.path || !tn?.path) continue;
        const fd = domainOf(fn.path);
        const td = domainOf(tn.path);
        if (fd === td) continue;
        const key = `${fd} → ${td}`;
        const prev = domainEdges.get(key) ?? { imports: 0, tests: 0 };
        if (e.type === "imports") prev.imports++;
        if (e.type === "tests") prev.tests++;
        domainEdges.set(key, prev);
      }
    }

    const lines = [`# Domain map: ${path.basename(root)}`, ``];
    if (useSemantic) {
      lines.push(`_Source: Pass-5 semantic layer (domain nodes)._`, ``);
    }

    for (const [domain, files] of [...domainFiles].sort((a, b) =>
      a[0] < b[0] ? -1 : 1
    )) {
      const byKind = files.reduce(
        (acc, f) => {
          const node = graph.nodes.find((n) => n.path === f);
          const k = node?.kind ?? "unknown";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const kindStr = Object.entries(byKind)
        .map(([k, c]) => `${c} ${k}`)
        .join(", ");
      lines.push(`## ${domain}`);
      lines.push(`${files.length} files (${kindStr})`, ``);
    }

    if (domainEdges.size) {
      lines.push(`## Cross-domain dependencies`, ``);
      for (const [edge, counts] of [...domainEdges].sort((a, b) =>
        a[0] < b[0] ? -1 : 1
      )) {
        const parts = [];
        if (counts.imports) parts.push(`${counts.imports} imports`);
        if (counts.tests) parts.push(`${counts.tests} tests`);
        lines.push(`- **${edge}**: ${parts.join(", ")}`);
      }
    } else {
      lines.push(
        `## Cross-domain dependencies`,
        `_None found — run \`forge graph\` to rebuild._`
      );
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_semantic_map ───────────────────────────────────────────────────────

  async function forgeSemanticMap({
    domain
  }: { domain?: string } = {}): Promise<ToolResult> {
    const graph = await loadGraph();

    const domainNodes = graph.nodes.filter((n) => n.type === "domain");
    if (domainNodes.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "_Graph has no semantic layer. Run `pnpm forge graph --with-semantic` to enable._"
          }
        ]
      };
    }

    const wanted = (n: GraphNode): boolean =>
      !domain || n.label === domain || n.id === `domain:${domain}`;

    // Index supporting nodes for cheap lookup.
    const nodeById = new Map<string, GraphNode>();
    for (const n of graph.nodes) nodeById.set(n.id, n);

    const filesByDomain = new Map<string, string[]>();
    const endpointsByDomain = new Map<string, GraphNode[]>();
    const flowsByDomain = new Map<string, GraphNode[]>();

    for (const e of graph.edges) {
      if (e.type === "belongs_to_domain") {
        const dn = nodeById.get(e.to);
        if (!dn || !wanted(dn)) continue;
        const list = filesByDomain.get(dn.label) ?? [];
        list.push(e.from.replace(/^file:/, ""));
        filesByDomain.set(dn.label, list);
      }
    }

    // For endpoints/flows we use the node's `domain` field (set by Pass 5)
    // because these nodes don't carry a belongs_to_domain edge themselves.
    for (const n of graph.nodes) {
      if (n.type === "endpoint") {
        // Endpoints are linked to files via exposes_endpoint; infer domain
        // from the file's belongs_to_domain edge.
        const fileEdge = graph.edges.find(
          (e) => e.type === "exposes_endpoint" && e.to === n.id
        );
        if (!fileEdge) continue;
        const fileToDomainEdge = graph.edges.find(
          (e) => e.type === "belongs_to_domain" && e.from === fileEdge.from
        );
        if (!fileToDomainEdge) continue;
        const dn = nodeById.get(fileToDomainEdge.to);
        if (!dn || !wanted(dn)) continue;
        const list = endpointsByDomain.get(dn.label) ?? [];
        list.push(n);
        endpointsByDomain.set(dn.label, list);
      }
      if (n.type === "flow") {
        const dlabel = n.domain;
        if (!dlabel) continue;
        if (domain && dlabel !== domain) continue;
        const list = flowsByDomain.get(dlabel) ?? [];
        list.push(n);
        flowsByDomain.set(dlabel, list);
      }
    }

    const targetDomains = domain
      ? domainNodes.filter((d) => d.label === domain)
      : domainNodes;

    if (targetDomains.length === 0) {
      const known = domainNodes.map((d) => d.label).sort();
      return {
        content: [
          {
            type: "text",
            text: `Domain "${domain}" not found. Known: ${known.join(", ") || "(none)"}`
          }
        ]
      };
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      domains: targetDomains
        .map((d) => ({
          name: d.label,
          files: (filesByDomain.get(d.label) ?? []).sort(),
          endpoints: (endpointsByDomain.get(d.label) ?? [])
            .map((e) => ({
              method: e.method,
              path: e.path,
              framework: e.framework,
              id: e.id
            }))
            .sort((a, b) => {
              const ka = `${a.method} ${a.path}`;
              const kb = `${b.method} ${b.path}`;
              return ka < kb ? -1 : ka > kb ? 1 : 0;
            }),
          flows: (flowsByDomain.get(d.label) ?? [])
            .map((f) => ({
              id: f.id,
              label: f.label,
              entryFile: f.entryFile,
              stepCount: f.stepCount
            }))
            .sort((a, b) => (a.id < b.id ? -1 : 1))
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
    };
  }

  // ── forge_flow ───────────────────────────────────────────────────────────────

  async function forgeFlow({
    flow_id
  }: {
    flow_id: string;
  }): Promise<ToolResult> {
    const graph = await loadGraph();
    const flowNode = graph.nodes.find(
      (n) =>
        n.type === "flow" && (n.id === flow_id || n.id === `flow:${flow_id}`)
    );
    if (!flowNode) {
      const known = graph.nodes
        .filter((n) => n.type === "flow")
        .map((n) => n.id)
        .sort();
      return {
        content: [
          {
            type: "text",
            text: `Flow not found: ${flow_id}\n\nKnown flows:\n${
              known.map((id) => `- ${id}`).join("\n") || "(none)"
            }\n\n_Run \`pnpm forge graph --with-semantic\` to populate._`
          }
        ]
      };
    }

    // Collect step nodes connected via flow_step.
    const stepIds = graph.edges
      .filter((e) => e.type === "flow_step" && e.from === flowNode.id)
      .map((e) => e.to);
    const stepNodes = stepIds
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => Boolean(n) && n!.type === "step")
      .sort((a, b) => (a!.order ?? 0) - (b!.order ?? 0));

    const payload = {
      id: flowNode.id,
      label: flowNode.label,
      domain: flowNode.domain ?? null,
      entryFile: flowNode.entryFile ?? null,
      stepCount: flowNode.stepCount ?? stepNodes.length,
      steps: stepNodes.map((n) => ({
        order: n.order,
        file: n.stepFile,
        layer: n.stepLayer
      }))
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
    };
  }

  // ── forge_check ──────────────────────────────────────────────────────────────

  async function forgeCheck(): Promise<ToolResult> {
    const plan = await tryReadPlan();
    if (!plan) {
      return {
        content: [
          {
            type: "text",
            text: "No implement-plan.json found. Run `forge implement` first to generate a plan with guardrails."
          }
        ]
      };
    }

    let changedFiles: string[] = [];
    let locDelta = 0;

    try {
      const namesRaw = execSyncFn("git diff --name-only HEAD", {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }) as string;
      changedFiles = namesRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      const statRaw = execSyncFn("git diff --shortstat HEAD", {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }) as string;
      const m = /(\d+) insertion|(\d+) deletion/g;
      let match: RegExpExecArray | null;
      while ((match = m.exec(statRaw)) !== null) {
        locDelta += parseInt(match[1] ?? match[2] ?? "0", 10);
      }
    } catch {
      // no git or no diff
    }

    const result = validateGuardrails(changedFiles, locDelta, plan.guardrails);

    const lines = [
      `# Guardrail check: ${plan.title}`,
      ``,
      `**Status**: ${result.passed ? "✅ PASSED" : "❌ FAILED"}`,
      `**Changed files**: ${changedFiles.length} | **LOC delta**: ${locDelta}`,
      ``
    ];

    if (result.violations.length) {
      lines.push(`## Violations (${result.violations.length})`, ``);
      for (const v of result.violations) {
        lines.push(`- **[${v.rule}]** ${v.detail}`);
      }
      lines.push(``);
    }

    lines.push(
      `## Guardrails`,
      `- Allowed files: ${plan.guardrails.allowedFiles.length} files`,
      `- Max LOC delta: ${plan.guardrails.maxLocDelta}`,
      ...(plan.guardrails.maxFilesChanged != null
        ? [`- Max files changed: ${plan.guardrails.maxFilesChanged}`]
        : []),
      `- Forbidden paths: ${plan.guardrails.forbiddenPaths.join(", ")}`
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_status ─────────────────────────────────────────────────────────────

  async function forgeStatus(): Promise<ToolResult> {
    const lines = [`# ContextForge status: ${path.basename(root)}`, ``];

    const checks: Array<{ name: string; file: string }> = [
      { name: "scan.json", file: "scan.json" },
      { name: "graph.json", file: "graph.json" },
      { name: "context-pack.json", file: "context-pack.json" },
      { name: "implement-plan.json", file: "implement-plan.json" },
      { name: "token-ledger.json", file: "token-ledger.json" }
    ];

    for (const { name, file } of checks) {
      try {
        const stat = await fs.stat(artifactPath(file));
        const age = Math.round((Date.now() - stat.mtimeMs) / 60000);
        const raw = await fs.readFile(artifactPath(file), "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        let detail = "";
        if (file === "graph.json") {
          const nodes = (parsed.nodes as unknown[]).length;
          const edges = (parsed.edges as unknown[]).length;
          detail = `${nodes} nodes, ${edges} edges`;
        } else if (file === "scan.json") {
          const files = (parsed.files as unknown[]).length;
          detail = `${files} files indexed`;
        } else if (file === "context-pack.json") {
          const pfiles = (parsed.files as unknown[]).length;
          const tokens =
            (parsed.budget as { estimatedTokens?: number }).estimatedTokens ??
            0;
          detail = `${pfiles} files, ~${tokens} tokens`;
        } else if (file === "implement-plan.json") {
          detail = `status: ${parsed.status as string}`;
        } else if (file === "token-ledger.json") {
          const savings = parsed.savings as { savingsPct?: number };
          detail = `${savings.savingsPct ?? 0}% savings vs full repo`;
        }

        lines.push(`✅ **${name}** — ${detail} _(${age}m ago)_`);
      } catch {
        lines.push(`⬜ **${name}** — not found`);
      }
    }

    // Active OpenSpec changes that ship with a frozen subgraph — agents
    // should prefer these over the global graph for change-scoped work.
    try {
      const changesDir = path.join(root, "openspec", "changes");
      const entries = await fs.readdir(changesDir, { withFileTypes: true });
      const withSubgraph: Array<{ id: string; nodes: number; edges: number }> =
        [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subgraphPath = path.join(
          changesDir,
          entry.name,
          "graph.subset.json"
        );
        try {
          const raw = await fs.readFile(subgraphPath, "utf8");
          const parsed = JSON.parse(raw) as {
            stats?: { nodesTotal?: number; edgesTotal?: number };
          };
          withSubgraph.push({
            id: entry.name,
            nodes: parsed.stats?.nodesTotal ?? 0,
            edges: parsed.stats?.edgesTotal ?? 0
          });
        } catch {
          // change without subgraph — skip
        }
      }
      if (withSubgraph.length > 0) {
        lines.push(``, `## OpenSpec changes with frozen subgraph`);
        lines.push(
          `**Prefer \`forge_change_subgraph\` for these — it's cheaper and self-contained.**`
        );
        for (const c of withSubgraph) {
          lines.push(
            `- \`${c.id}\` — ${c.nodes} nodes, ${c.edges} edges → \`forge_change_subgraph({ change_id: "${c.id}" })\``
          );
        }
      }
    } catch {
      // no openspec/changes dir — skip
    }

    lines.push(
      ``,
      `## Quick start`,
      `If artifacts are missing or stale:`,
      `\`\`\``,
      `forge scan`,
      `forge graph`,
      `forge context "your task description"`,
      `forge spec`,
      `forge implement`,
      `\`\`\``
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── getAgentManifest ─────────────────────────────────────────────────────────

  async function getAgentManifest(): Promise<ToolResult> {
    try {
      const raw = await fs.readFile(
        artifactPath("agent-manifest.json"),
        "utf8"
      );
      const manifest = JSON.parse(raw) as AgentManifestResult;
      return {
        content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }]
      };
    } catch {
      return {
        content: [{ type: "text", text: "Run 'forge manifest' first." }]
      };
    }
  }

  // ── selectAgentContext ────────────────────────────────────────────────────────

  async function selectAgentContext({
    task,
    agents: _agents = ["claude", "cursor", "opencode"]
  }: {
    task: string;
    agents?: string[];
  }): Promise<ToolResult> {
    let graph: GraphArtifact;
    let scanData: ScanArtifact;

    try {
      [graph, scanData] = await Promise.all([loadGraph(), loadScan()]);
    } catch {
      const degraded: AgentManifestResult = {
        schemaVersion: "1.1.0",
        task,
        domainsTouched: [],
        instruction:
          "scan/graph artifacts missing — no skill selection performed. Run `forge scan && forge graph` then retry.",
        skills: [],
        rules: [],
        skipped: { skills: [], rules: [] }
      };
      const text = JSON.stringify(
        {
          ...degraded,
          notes: ["scan/graph missing — run forge scan && forge graph"]
        },
        null,
        2
      );
      return { content: [{ type: "text", text }] };
    }

    const selectedFiles = selectContext({
      nodes: graph.nodes as Parameters<typeof selectContext>[0]["nodes"],
      edges: graph.edges as Parameters<typeof selectContext>[0]["edges"],
      scanFiles: scanData.files,
      seeds: [],
      task
    }).files.map((f) => ({ path: f.path }));

    const skillsDir = path.join(root, ".claude", "skills");
    const rulesDir = path.join(root, ".cursor", "rules");

    const skills = await loadSkillEntries(skillsDir);
    const rules = await loadRuleEntries(rulesDir);

    const manifest = buildAgentManifest({
      task,
      packedFiles: selectedFiles,
      skills,
      rules
    });
    return {
      content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }]
    };
  }

  // ── forge_change_manifest ────────────────────────────────────────────────────

  async function forgeChangeManifest({
    change_id,
    task: taskOverride
  }: {
    change_id: string;
    task?: string;
  }): Promise<ToolResult> {
    if (!/^[a-zA-Z0-9._-]+$/.test(change_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid change_id: ${change_id}. Allowed: [a-zA-Z0-9._-]`
          }
        ],
        isError: true
      };
    }

    const changeDir = path.join(root, "openspec", "changes", change_id);
    const subsetPath = path.join(changeDir, "graph.subset.json");

    let subset: { focus?: string[] } | null = null;
    try {
      subset = JSON.parse(await fs.readFile(subsetPath, "utf8")) as {
        focus?: string[];
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `No graph.subset.json found at ${path.relative(root, subsetPath).replace(/\\/g, "/")}. Run forge_spec first to scaffold the change with its frozen subgraph.`
          }
        ],
        isError: true
      };
    }

    const focus = Array.isArray(subset?.focus) ? subset!.focus! : [];
    if (focus.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `graph.subset.json for ${change_id} has empty focus. Re-run forge_spec to regenerate it.`
          }
        ],
        isError: true
      };
    }

    // Reuse the task that originated the change when available — same source
    // forge_spec wrote, lives in .contextforge/spec-input.json.
    let task = taskOverride ?? "";
    if (!task) {
      try {
        const specInputRaw = await fs.readFile(
          artifactPath("spec-input.json"),
          "utf8"
        );
        const parsed = JSON.parse(specInputRaw) as { task?: string };
        task = parsed.task ?? "";
      } catch {
        task = `Change ${change_id}`;
      }
    }

    const skillsDir = path.join(root, ".claude", "skills");
    const rulesDir = path.join(root, ".cursor", "rules");
    const skills = await loadSkillEntries(skillsDir);
    const rules = await loadRuleEntries(rulesDir);

    // packedFiles = the change's focus. buildAgentManifest derives
    // domainsTouched from these paths and keeps only skills/rules whose
    // declared `domains:` intersect — anything else is dropped.
    const manifest = buildAgentManifest({
      task,
      packedFiles: focus.map((p) => ({ path: p })),
      skills,
      rules
    });
    validateOrThrow("agent-manifest", manifest);
    await fs.writeFile(
      path.join(changeDir, "agent-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const lines: string[] = [
      `# forge_change_manifest ${change_id}`,
      ``,
      `✅ openspec/changes/${change_id}/agent-manifest.json`,
      `   domains touched: ${manifest.domainsTouched.join(", ") || "(none)"}`,
      `   skills kept: ${manifest.skills.length}, dropped: ${manifest.skipped.skills.length}`,
      `   rules kept: ${manifest.rules.length}, dropped: ${manifest.skipped.rules.length}`,
      ``,
      `JSON:`,
      "```json",
      JSON.stringify(manifest, null, 2),
      "```"
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  async function forgeChangeSubgraph({
    change_id
  }: {
    change_id: string;
  }): Promise<ToolResult> {
    if (!/^[a-zA-Z0-9._-]+$/.test(change_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid change_id: ${change_id}. Allowed: [a-zA-Z0-9._-]`
          }
        ],
        isError: true
      };
    }
    const subsetPath = path.join(
      root,
      "openspec",
      "changes",
      change_id,
      "graph.subset.json"
    );
    let raw: string;
    try {
      raw = await fs.readFile(subsetPath, "utf8");
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `No subgraph found at ${subsetPath}. Run \`forge spec ${change_id}\` first.`
          }
        ],
        isError: true
      };
    }
    return { content: [{ type: "text", text: raw }] };
  }

  async function forgeChangeContext({
    change_id
  }: {
    change_id: string;
  }): Promise<ToolResult> {
    if (!/^[a-zA-Z0-9._-]+$/.test(change_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid change_id: ${change_id}. Allowed: [a-zA-Z0-9._-]`
          }
        ],
        isError: true
      };
    }
    const contextPath = path.join(
      root,
      "openspec",
      "changes",
      change_id,
      "context.md"
    );
    let raw: string;
    try {
      raw = await fs.readFile(contextPath, "utf8");
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `No context.md found at ${contextPath}. Run \`forge spec ${change_id}\` first.`
          }
        ],
        isError: true
      };
    }
    return { content: [{ type: "text", text: raw }] };
  }

  async function forgeArchiveChange({
    change_id,
    skip_openspec_archive
  }: {
    change_id: string;
    skip_openspec_archive?: boolean;
  }): Promise<ToolResult> {
    if (!/^[a-zA-Z0-9._-]+$/.test(change_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid change_id: ${change_id}. Allowed: [a-zA-Z0-9._-]`
          }
        ],
        isError: true
      };
    }

    const lines: string[] = [`# Archive change: ${change_id}`, ``];

    // 1. openspec archive (best-effort — only if openspec CLI is on PATH and
    //    the caller didn't ask us to skip it).
    if (!skip_openspec_archive) {
      try {
        const out = nodeExecSync(`openspec archive ${change_id} -y`, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
        lines.push(`✅ openspec archive ${change_id} -y`);
        if (out.trim()) {
          lines.push(`   ${out.trim().split("\n").join("\n   ")}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `⚠️ openspec archive failed (continuing with rebuild anyway):`
        );
        lines.push(`   ${msg.split("\n").slice(0, 3).join("\n   ")}`);
      }
    } else {
      lines.push(`⏭️ openspec archive skipped (skip_openspec_archive=true)`);
    }

    // 2. Rebuild parent scan + graph.
    let scan: ScanResult;
    try {
      scan = await scanProject(root);
      validateOrThrow("scan", scan);
      const scanPath = path.join(root, ".contextforge", "scan.json");
      await fs.mkdir(path.dirname(scanPath), { recursive: true });
      await fs.writeFile(
        scanPath,
        `${JSON.stringify(scan, null, 2)}\n`,
        "utf8"
      );
      lines.push(``, `✅ scan: ${scan.files.length} files indexed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(``, `❌ scan failed: ${msg}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: true
      };
    }

    let graphPayload: {
      schemaVersion: string;
      project: { name: string; root: string };
      generatedAt: string;
      scanRef: { path: string; scanHash: string };
      parser: { engine: string };
      stats: Record<string, unknown>;
      nodes: GraphNode[];
      edges: GraphEdge[];
    };
    try {
      const cache = await loadGraphCache(root);
      const graphData = await buildGraph({ root, scan, cache });
      const scanRaw = `${JSON.stringify(scan, null, 2)}\n`;
      graphPayload = {
        schemaVersion: SCHEMA_VERSIONS.graph,
        project: { name: path.basename(root), root: "." },
        generatedAt: new Date().toISOString(),
        scanRef: {
          path: ".contextforge/scan.json",
          scanHash: blake3Hex(scanRaw)
        },
        parser: graphData.parser,
        stats: graphData.stats,
        nodes: graphData.nodes,
        edges: graphData.edges
      };
      validateOrThrow("graph", graphPayload);
      const graphPath = path.join(root, ".contextforge", "graph.json");
      await fs.writeFile(
        graphPath,
        `${JSON.stringify(graphPayload, null, 2)}\n`,
        "utf8"
      );
      await saveGraphCache(root, graphData.cacheUpdate);
      lines.push(
        `✅ graph: ${graphData.stats.nodesTotal} nodes, ${graphData.stats.edgesTotal} edges (cache: ${graphData.cacheStats.reused} reused, ${graphData.cacheStats.reparsed} reparsed)`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`❌ graph rebuild failed: ${msg}`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: true
      };
    }

    // 3. Refresh subgraphs of every remaining active change.
    const changesDir = path.join(root, "openspec", "changes");
    let activeChanges: string[] = [];
    try {
      const all = await fs.readdir(changesDir, { withFileTypes: true });
      activeChanges = all.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      activeChanges = [];
    }

    const refreshed: string[] = [];
    const skipped: string[] = [];
    for (const id of activeChanges) {
      const subsetPath = path.join(changesDir, id, "graph.subset.json");
      let existing: {
        focus?: string[];
        stats?: { mode?: "compact" | "full" };
      } | null = null;
      try {
        existing = JSON.parse(await fs.readFile(subsetPath, "utf8"));
      } catch {
        skipped.push(id);
        continue;
      }
      const focus = existing?.focus ?? [];
      const mode: "compact" | "full" = existing?.stats?.mode ?? "compact";
      if (focus.length === 0) {
        skipped.push(id);
        continue;
      }

      const subset = extractChangeSubgraph(graphPayload, {
        focusFiles: focus,
        depth: 1,
        mode
      });
      const generatedAt = new Date().toISOString();
      const newPayload = {
        schemaVersion: SCHEMA_VERSIONS.graphSubset,
        changeId: id,
        generatedAt,
        graphRef: ".contextforge/graph.json",
        focus: subset.focus,
        stats: subset.stats,
        nodes: subset.nodes,
        edges: subset.edges
      };
      validateOrThrow("graph-subset", newPayload);
      await fs.writeFile(
        subsetPath,
        `${JSON.stringify(newPayload, null, 2)}\n`,
        "utf8"
      );
      refreshed.push(id);
    }

    lines.push(``, `✅ subgraphs refreshed: ${refreshed.length}`);
    for (const id of refreshed) lines.push(`   - ${id}`);
    if (skipped.length > 0) {
      lines.push(
        `   (${skipped.length} skipped — no graph.subset.json: ${skipped.join(", ")})`
      );
    }

    lines.push(
      ``,
      `Cache file: ${path.join(root, GRAPH_CACHE_FILE).replace(/\\/g, "/")}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_rebuild_graph ──────────────────────────────────────────────────────

  async function forgeRebuildGraph({
    with_semantic = false,
    with_concepts = false
  }: {
    with_semantic?: boolean;
    with_concepts?: boolean;
  } = {}): Promise<ToolResult> {
    const lines: string[] = [`# forge_rebuild_graph`, ``];

    // 1. Re-scan from disk (BLAKE3, deterministic).
    let scan: ScanResult;
    try {
      scan = await scanProject(root);
      validateOrThrow("scan", scan);
      const scanPath = artifactPath("scan.json");
      await fs.mkdir(path.dirname(scanPath), { recursive: true });
      await fs.writeFile(
        scanPath,
        `${JSON.stringify(scan, null, 2)}\n`,
        "utf8"
      );
      lines.push(`✅ scan: ${scan.files.length} files indexed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: lines.concat(`❌ scan failed: ${msg}`).join("\n")
          }
        ],
        isError: true
      };
    }

    // 2. Build graph (per-file cache reuses parser fragments when hash unchanged).
    const semanticOn = with_semantic || with_concepts;
    let graphData: Awaited<ReturnType<typeof buildGraph>>;
    try {
      const cache = await loadGraphCache(root);
      graphData = await buildGraph({
        root,
        scan,
        cache,
        withSemantic: semanticOn,
        withConcepts: with_concepts
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: lines.concat(`❌ graph build failed: ${msg}`).join("\n")
          }
        ],
        isError: true
      };
    }

    const scanRaw = `${JSON.stringify(scan, null, 2)}\n`;
    const graphPayload = {
      schemaVersion: SCHEMA_VERSIONS.graph,
      project: { name: path.basename(root), root: "." },
      generatedAt: new Date().toISOString(),
      scanRef: {
        path: ".contextforge/scan.json",
        scanHash: blake3Hex(scanRaw)
      },
      parser: graphData.parser,
      stats: graphData.stats,
      ...(graphData.semanticEnabled ? { semanticEnabled: true } : {}),
      nodes: graphData.nodes,
      edges: graphData.edges
    };

    try {
      validateOrThrow("graph", graphPayload);
      await fs.writeFile(
        artifactPath("graph.json"),
        `${JSON.stringify(graphPayload, null, 2)}\n`,
        "utf8"
      );
      await saveGraphCache(root, graphData.cacheUpdate);
      // Invalidate this handler's in-memory cache so subsequent reads pick
      // up the fresh artefact.
      _graph = null;
      _graphMtime = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: lines.concat(`❌ graph write failed: ${msg}`).join("\n")
          }
        ],
        isError: true
      };
    }

    lines.push(
      `✅ graph: ${graphData.stats.nodesTotal} nodes, ${graphData.stats.edgesTotal} edges (cache: ${graphData.cacheStats.reused} reused, ${graphData.cacheStats.reparsed} reparsed)`
    );
    if (graphData.semanticEnabled && graphData.semanticStats) {
      const s = graphData.semanticStats;
      const conceptsPart =
        s.conceptCount > 0 ? `, ${s.conceptCount} concepts` : "";
      lines.push(
        `✅ semantic: ${s.domainCount} domains, ${s.layerCount} layers, ${s.endpointCount} endpoints, ${s.flowCount} flows${conceptsPart}`
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_implement ──────────────────────────────────────────────────────────

  async function forgeImplement({
    change_id = "stub"
  }: { change_id?: string } = {}): Promise<ToolResult> {
    type PackFile = {
      path: string;
      reason: string;
      mode: string;
      hash?: string;
    };
    type ContextPack = { task?: string; files?: PackFile[] };

    let pack: ContextPack | null = null;
    try {
      pack = JSON.parse(
        await fs.readFile(artifactPath("context-pack.json"), "utf8")
      ) as ContextPack;
    } catch {
      pack = null;
    }
    const packFiles: PackFile[] = pack?.files ?? [];

    // Subset-scoped allowedFiles: when openspec/changes/<id>/graph.subset.json
    // exists, restrict the guardrail to files that are in the change's frozen
    // focus set. This mirrors what the spec said the change would touch and
    // makes forge_check stricter.
    let subsetFocus: Set<string> | null = null;
    try {
      const subsetRaw = await fs.readFile(
        path.join(root, "openspec", "changes", change_id, "graph.subset.json"),
        "utf8"
      );
      const parsed = JSON.parse(subsetRaw) as { focus?: string[] };
      if (Array.isArray(parsed.focus) && parsed.focus.length > 0) {
        subsetFocus = new Set(parsed.focus);
      }
    } catch {
      subsetFocus = null;
    }

    const allowedFiles = packFiles
      .filter((f) => f.mode !== "summary")
      .filter((f) => (subsetFocus ? subsetFocus.has(f.path) : true))
      .map((f) => f.path);

    const fileCount = packFiles.length;
    const maxLocDelta = Math.max(1, Math.min(1000, fileCount * 50));
    const maxFilesChanged = Math.max(1, allowedFiles.length + 2);
    const requiredTests = packFiles
      .filter((f) => f.reason === "test_for")
      .map((f) => f.path);

    const tasks =
      allowedFiles.length > 0
        ? allowedFiles.map((filePath, i) => {
            const pf = packFiles.find((f) => f.path === filePath)!;
            return {
              id: `T${i + 1}`,
              description: `Modificar ${filePath} (${pf.reason})`,
              files: [filePath]
            };
          })
        : [
            {
              id: "T1",
              description:
                "Ejecutar forge_context + forge_spec para derivar tareas concretas.",
              files: [] as string[]
            }
          ];

    const plan = {
      schemaVersion: SCHEMA_VERSIONS.implementPlan,
      taskId: change_id,
      title: pack?.task ?? "Plan pendiente de context-pack y spec",
      generatedAt: new Date().toISOString(),
      status: "plan_only" as const,
      ...(pack
        ? {
            contextPackRef: {
              path: ".contextforge/context-pack.json",
              packHash: blake3Hex(JSON.stringify(pack))
            }
          }
        : {}),
      guardrails: {
        allowedFiles,
        forbiddenPaths: ["**/.env*", "**/secrets/**", "**/.git/**"],
        maxLocDelta,
        maxFilesChanged,
        ...(requiredTests.length > 0 ? { requiredTests } : {}),
        noNewDependencies: true
      },
      tasks
    };

    try {
      validateOrThrow("implement-plan", plan);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text", text: `Plan failed schema validation: ${msg}` }
        ],
        isError: true
      };
    }
    const planPath = artifactPath("implement-plan.json");
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    const lines: string[] = [
      `# forge_implement ${change_id}`,
      ``,
      `✅ implement-plan.json (${tasks.length} task${tasks.length === 1 ? "" : "s"}, allowed ${allowedFiles.length} files, maxLocDelta ${maxLocDelta})`
    ];
    if (subsetFocus) {
      lines.push(
        `   guardrails scoped to graph.subset.json focus (${subsetFocus.size} files)`
      );
    }
    lines.push(
      ``,
      `Next:`,
      `  1. Implement the change.`,
      `  2. Call forge_check before committing to validate the diff against the guardrails.`
    );
    if (!pack) {
      lines.push(
        ``,
        `⚠️ No context-pack.json found — plan is a placeholder. Call forge_context first for a meaningful guardrail set.`
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // ── forge_spec ───────────────────────────────────────────────────────────────

  async function forgeSpec({
    change_id,
    skip_openspec_cli
  }: {
    change_id: string;
    skip_openspec_cli?: boolean;
  }): Promise<ToolResult> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(change_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid change_id "${change_id}". Must be kebab-case ([a-z0-9-]+, starting with [a-z0-9]).`
          }
        ],
        isError: true
      };
    }

    const lines: string[] = [`# forge_spec ${change_id}`, ``];

    // 1. Load context-pack.json — required.
    type PackFile = {
      path: string;
      reason: string;
      mode: "full" | "excerpt" | "summary";
    };
    type ContextPack = {
      task?: string;
      files?: PackFile[];
      budget?: { maxInputTokens?: number; estimatedTokens?: number };
    };
    let pack: ContextPack;
    try {
      pack = JSON.parse(
        await fs.readFile(artifactPath("context-pack.json"), "utf8")
      ) as ContextPack;
    } catch {
      return {
        content: [
          {
            type: "text",
            text: 'Missing .contextforge/context-pack.json. Call `forge_context({ task: "..." })` first.'
          }
        ],
        isError: true
      };
    }
    const task = pack.task ?? "Describe la tarea aqui";
    const affectedFiles: PackFile[] = pack.files ?? [];

    // 2. Load graph (required for subgraph + spec-input architecture block).
    let graph: GraphArtifact;
    try {
      graph = await loadGraph();
    } catch {
      return {
        content: [
          {
            type: "text",
            text: "Missing .contextforge/graph.json. Run forge graph first or call forge_archive_change to rebuild."
          }
        ],
        isError: true
      };
    }

    // 3. Build the change subgraph FIRST. The subset becomes the single
    //    source of truth for everything that lands inside the change dir
    //    (spec-input.architecture, spec-prompt scope block, change-scoped
    //    manifest in commit B). Compact mode keeps token cost down.
    const subset = extractChangeSubgraph(
      { nodes: graph.nodes, edges: graph.edges },
      {
        focusFiles: affectedFiles.map((f) => f.path),
        depth: 1,
        mode: "compact"
      }
    );
    lines.push(
      `✅ subset: ${subset.stats.nodesTotal} nodes, ${subset.stats.edgesTotal} edges (depth=${subset.stats.depth}, mode=${subset.stats.mode})`
    );

    // 4. Build & write spec-input.json — architecture derived from the
    //    subset, NOT the global graph. cross-domain deps still come from
    //    the global graph (it's the only place that knows about edges
    //    leaving the focus set).
    const specInput = buildSpecInput({
      changeId: change_id,
      contextPack: { task, files: affectedFiles, budget: pack.budget },
      graph: { nodes: graph.nodes, edges: graph.edges },
      subgraph: { nodes: subset.nodes, edges: subset.edges }
    });
    validateOrThrow("spec-input", specInput);
    await fs.writeFile(
      artifactPath("spec-input.json"),
      `${JSON.stringify(specInput, null, 2)}\n`,
      "utf8"
    );
    lines.push(
      `✅ spec-input.json (${affectedFiles.length} affected files, scoped to subset)`
    );

    const changeDir = path.join(root, "openspec", "changes", change_id);
    await fs.mkdir(changeDir, { recursive: true });

    // 5. Try the openspec CLI for the official scaffold; fall back to
    //    buildOpenSpec from core when missing or on failure.
    let scaffoldedBy: "openspec" | "fallback" | "mcp" = "mcp";
    if (!skip_openspec_cli) {
      try {
        execSyncFn(`openspec new change ${change_id}`, {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
        scaffoldedBy = "openspec";
        lines.push(`✅ openspec new change ${change_id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `⚠️ openspec CLI unavailable or failed (${msg.split("\n")[0]}); using fallback scaffold.`
        );
        scaffoldedBy = "fallback";
      }
    }
    if (scaffoldedBy !== "openspec") {
      const result = buildOpenSpec({
        changeId: change_id,
        task,
        affectedFiles,
        graphSubset: { stats: subset.stats }
      });
      const issues = validateOpenSpecFiles(result.files);
      if (issues.length > 0) {
        const detail = issues
          .map((i) => `  - [${i.rule}] ${i.file}: ${i.detail}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Fallback scaffold failed validation:\n${detail}`
            }
          ],
          isError: true
        };
      }
      for (const f of result.files) {
        const dest = path.join(root, f.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.content, "utf8");
      }
      lines.push(
        `✅ fallback scaffold (${result.files.length} files in ${result.changeDir}/)`
      );
    }

    // 6. spec-prompt.md — copy-pastable for an agent. Carries the subset
    //    stats so the prompt explicitly tells the agent NOT to call
    //    forge_neighbors / forge_context (they hit the global graph and
    //    duplicate what's already inlined here).
    const promptBody = renderSpecPrompt({
      specInput,
      openSpecInstructions: "",
      subset: {
        nodesTotal: subset.stats.nodesTotal,
        edgesTotal: subset.stats.edgesTotal,
        depth: subset.stats.depth,
        focusFilesCount: subset.focus.length
      }
    });
    await fs.writeFile(artifactPath("spec-prompt.md"), promptBody, "utf8");
    lines.push(`✅ spec-prompt.md (scope-aware)`);

    // 7. graph.subset.json + context.md inside the change dir.
    const generatedAt = new Date().toISOString();
    const subsetPayload = {
      schemaVersion: SCHEMA_VERSIONS.graphSubset,
      changeId: change_id,
      generatedAt,
      graphRef: ".contextforge/graph.json",
      focus: subset.focus,
      stats: subset.stats,
      nodes: subset.nodes,
      edges: subset.edges
    };
    validateOrThrow("graph-subset", subsetPayload);
    await fs.writeFile(
      path.join(changeDir, "graph.subset.json"),
      `${JSON.stringify(subsetPayload, null, 2)}\n`,
      "utf8"
    );
    lines.push(
      `✅ graph.subset.json (${subset.stats.nodesTotal} nodes, ${subset.stats.edgesTotal} edges)`
    );

    const contextMd = renderChangeContextMd({
      changeId: change_id,
      task,
      focus: subset.focus,
      stats: subset.stats,
      scaffoldedBy
    });
    await fs.writeFile(path.join(changeDir, "context.md"), contextMd, "utf8");
    lines.push(`✅ context.md`);

    // 8. Change-scoped agent manifest. Filters skills/rules by the
    //    domains that the subset actually touches — only the relevant
    //    ones get loaded into the agent's prompt.
    try {
      const manifestResult = await forgeChangeManifest({
        change_id,
        task
      });
      if (!manifestResult.isError) {
        lines.push(
          `✅ openspec/changes/${change_id}/agent-manifest.json (skills scoped to subset)`
        );
      } else {
        lines.push(
          `⚠️ change-scoped manifest failed: ${manifestResult.content[0].text.split("\n")[0]}`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`⚠️ change-scoped manifest crashed: ${msg}`);
    }

    lines.push(
      ``,
      `Next:`,
      `  1. Open openspec/changes/${change_id}/proposal.md and fill it in (or paste .contextforge/spec-prompt.md into your agent).`,
      `  2. When the spec is ready: run forge_check before committing.`,
      `  3. Done? call forge_archive_change({ change_id: "${change_id}" }).`
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return {
    forgeContext,
    forgeNeighbors,
    forgeDomainMap,
    forgeSemanticMap,
    forgeFlow,
    forgeCheck,
    forgeStatus,
    forgeSpec,
    forgeImplement,
    forgeRebuildGraph,
    getAgentManifest,
    selectAgentContext,
    forgeChangeSubgraph,
    forgeChangeContext,
    forgeChangeManifest,
    forgeArchiveChange
  };
}
