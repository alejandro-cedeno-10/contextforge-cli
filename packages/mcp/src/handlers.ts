import { execSync as nodeExecSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  selectContext,
  validateGuardrails,
  type ScanResult,
  type GraphNode,
  type GraphEdge
} from "@alejandro-cedeno-10/contextforge-core";

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

type ToolResult = { content: [{ type: "text"; text: string }] };

// ─── pure helpers ─────────────────────────────────────────────────────────────

export function getDomain(filePath: string): string {
  const parts = filePath.split("/");
  if (parts[0] === "packages" && parts.length > 1) return `packages/${parts[1]}`;
  return parts[0] ?? "root";
}

export function formatFileList(
  files: Array<{ path: string; reason: string; mode: string; score?: number }>,
  includeScore = false
): string {
  return files
    .map((f) => {
      const scoreStr = includeScore && f.score != null ? ` [score=${f.score.toFixed(4)}]` : "";
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
  let _scan: ScanArtifact | null = null;

  function artifactPath(...parts: string[]): string {
    return path.join(root, ".contextforge", ...parts);
  }

  async function loadGraph(): Promise<GraphArtifact> {
    if (_graph) return _graph;
    const raw = await fs.readFile(artifactPath("graph.json"), "utf8");
    _graph = JSON.parse(raw) as GraphArtifact;
    return _graph;
  }

  async function loadScan(): Promise<ScanArtifact> {
    if (_scan) return _scan;
    const raw = await fs.readFile(artifactPath("scan.json"), "utf8");
    _scan = JSON.parse(raw) as ScanArtifact;
    return _scan;
  }

  async function tryReadPlan(): Promise<PlanArtifact | null> {
    try {
      const raw = await fs.readFile(artifactPath("implement-plan.json"), "utf8");
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
      const estTokens = Math.max(20, Math.ceil((sizeByPath.get(f.path) ?? 500) / 4));
      lines.push(`### ${f.path}`);
      lines.push(`- mode: **${f.mode}** | reason: ${f.reason} | ~${estTokens} tokens`);
      if (include_content) {
        try {
          const content = await fs.readFile(path.join(root, f.path), "utf8");
          const preview =
            f.mode === "full"
              ? content
              : f.mode === "excerpt"
                ? content.split("\n").slice(0, 50).join("\n") + "\n// ... (excerpt)"
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
        .filter((n) => n.type === "file" && n.path?.includes(file_path.split("/").pop()!))
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
    const edgeMap: Record<string, Array<{ to: string; type: string; dir: "out" | "in" }>> = {};

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const fid of frontier) {
        const outEdges = graph.edges.filter((e) => e.from === fid && !visited.has(e.to));
        const inEdges = graph.edges.filter((e) => e.to === fid && !visited.has(e.from));
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
      other: []
    };

    for (const rel of edgeMap[nodeId] ?? []) {
      const label = getLabel(rel.to);
      if (rel.type === "imports" && rel.dir === "out") sections.imports!.push(label);
      else if (rel.type === "imports" && rel.dir === "in") sections.imported_by!.push(label);
      else if (rel.type === "tests" && rel.dir === "out") sections.tests!.push(label);
      else if (rel.type === "tests" && rel.dir === "in") sections.tested_by!.push(label);
      else if (rel.type === "defines") sections.defines!.push(label);
      else sections.other!.push(`[${rel.type}] ${label}`);
    }

    const lines = [`# Graph neighbors: ${file_path}`, ``];
    lines.push(`**Kind**: ${node.kind ?? "unknown"} | **Lang**: ${node.lang ?? "unknown"}`, ``);

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

    const domainFiles = new Map<string, string[]>();

    for (const n of graph.nodes) {
      if (n.type !== "file" || !n.path) continue;
      const domain = getDomain(n.path);
      if (!domainFiles.has(domain)) domainFiles.set(domain, []);
      domainFiles.get(domain)!.push(n.path);
    }

    const domainEdges = new Map<string, { imports: number; tests: number }>();
    for (const e of graph.edges) {
      if (e.type === "defines" || e.type === "contains") continue;
      const fn = graph.nodes.find((n) => n.id === e.from);
      const tn = graph.nodes.find((n) => n.id === e.to);
      if (!fn?.path || !tn?.path) continue;
      const fd = getDomain(fn.path);
      const td = getDomain(tn.path);
      if (fd === td) continue;
      const key = `${fd} → ${td}`;
      const prev = domainEdges.get(key) ?? { imports: 0, tests: 0 };
      if (e.type === "imports") prev.imports++;
      if (e.type === "tests") prev.tests++;
      domainEdges.set(key, prev);
    }

    const lines = [`# Domain map: ${path.basename(root)}`, ``];

    for (const [domain, files] of domainFiles) {
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
      for (const [edge, counts] of domainEdges) {
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
          const tokens = (parsed.budget as { estimatedTokens?: number }).estimatedTokens ?? 0;
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

  return { forgeContext, forgeNeighbors, forgeDomainMap, forgeCheck, forgeStatus };
}
