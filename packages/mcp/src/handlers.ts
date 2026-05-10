import { execSync as nodeExecSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  blake3Hex,
  buildAgentManifest,
  buildGraph,
  extractChangeSubgraph,
  getDomain,
  GRAPH_CACHE_FILE,
  loadGraphCache,
  saveGraphCache,
  scanProject,
  selectContext,
  SCHEMA_VERSIONS,
  validateGuardrails,
  validateOrThrow,
  type AgentManifestResult,
  type ScanResult,
  type GraphNode,
  type GraphEdge
} from "@anai-raia-alex/contextforge-core";

export { getDomain };

// ─── frontmatter helpers (shared) ─────────────────────────────────────────────

interface FrontmatterFields {
  name?: string;
  domains?: string[];
  alwaysApply?: boolean;
}

function parseFrontmatter(content: string): FrontmatterFields {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const block = match[1];
  const fields: FrontmatterFields = {};

  const nameLine = /^name:\s*(.+)$/m.exec(block);
  if (nameLine) fields.name = nameLine[1].trim();

  const alwaysLine = /^alwaysApply:\s*(true|false)$/m.exec(block);
  if (alwaysLine) fields.alwaysApply = alwaysLine[1] === "true";

  const domainsLine = /^domains:\s*\[([^\]]*)\]$/m.exec(block);
  if (domainsLine) {
    fields.domains = domainsLine[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return fields;
}

async function loadSkillEntries(dir: string): Promise<
  Array<{
    path: string;
    name: string;
    domains: string[];
    alwaysApply?: boolean;
  }>
> {
  try {
    const entries = await fs.readdir(dir);
    const result = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const fullPath = path.join(dir, entry);
      const relPath = `.claude/skills/${entry}`;
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const fm = parseFrontmatter(content);
        result.push({
          path: relPath,
          name: fm.name ?? entry.replace(".md", ""),
          domains: fm.domains ?? [],
          alwaysApply: fm.alwaysApply
        });
      } catch {
        result.push({
          path: relPath,
          name: entry.replace(".md", ""),
          domains: []
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

async function loadRuleEntries(dir: string): Promise<
  Array<{
    path: string;
    description?: string;
    domains: string[];
    alwaysApply?: boolean;
  }>
> {
  try {
    const entries = await fs.readdir(dir);
    const result = [];
    for (const entry of entries) {
      if (!entry.endsWith(".mdc") && !entry.endsWith(".md")) continue;
      const fullPath = path.join(dir, entry);
      const relPath = `.cursor/rules/${entry}`;
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const fm = parseFrontmatter(content);
        result.push({
          path: relPath,
          description: undefined,
          domains: fm.domains ?? [],
          alwaysApply: fm.alwaysApply
        });
      } catch {
        result.push({ path: relPath, domains: [] });
      }
    }
    return result;
  } catch {
    return [];
  }
}

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
      other: []
    };

    for (const rel of edgeMap[nodeId] ?? []) {
      const label = getLabel(rel.to);
      if (rel.type === "imports" && rel.dir === "out")
        sections.imports!.push(label);
      else if (rel.type === "imports" && rel.dir === "in")
        sections.imported_by!.push(label);
      else if (rel.type === "tests" && rel.dir === "out")
        sections.tests!.push(label);
      else if (rel.type === "tests" && rel.dir === "in")
        sections.tested_by!.push(label);
      else if (rel.type === "defines") sections.defines!.push(label);
      else sections.other!.push(`[${rel.type}] ${label}`);
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
        schemaVersion: "1.0.0",
        task,
        domainsTouched: [],
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
      seeds: []
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

  return {
    forgeContext,
    forgeNeighbors,
    forgeDomainMap,
    forgeCheck,
    forgeStatus,
    getAgentManifest,
    selectAgentContext,
    forgeChangeSubgraph,
    forgeChangeContext,
    forgeArchiveChange
  };
}
