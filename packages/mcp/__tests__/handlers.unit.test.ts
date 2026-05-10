import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createHandlers, getDomain, formatFileList } from "../src/handlers.js";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const GRAPH_FIXTURE = {
  schemaVersion: "0.2.0",
  generatedAt: "2026-01-01T00:00:00Z",
  nodes: [
    {
      id: "file:packages/core/src/index.ts",
      type: "file",
      label: "index.ts",
      path: "packages/core/src/index.ts",
      kind: "code",
      lang: "ts"
    },
    {
      id: "file:packages/cli/src/index.ts",
      type: "file",
      label: "cli.ts",
      path: "packages/cli/src/index.ts",
      kind: "code",
      lang: "ts"
    },
    {
      id: "file:packages/core/__tests__/scanner.unit.test.ts",
      type: "file",
      label: "scanner.test.ts",
      path: "packages/core/__tests__/scanner.unit.test.ts",
      kind: "test",
      lang: "ts"
    }
  ],
  edges: [
    {
      from: "file:packages/cli/src/index.ts",
      to: "file:packages/core/src/index.ts",
      type: "imports",
      weight: 0.8
    }
  ],
  stats: { fileNodes: 3, symbolNodes: 0, edges: 1 }
};

const SCAN_FIXTURE = {
  schemaVersion: "0.2.0",
  hashAlgorithm: "blake3",
  generatedAt: "2026-01-01T00:00:00Z",
  root: ".",
  files: [
    {
      path: "packages/core/src/index.ts",
      hash: "abc123",
      size: 500,
      kind: "code",
      lang: "ts"
    },
    {
      path: "packages/cli/src/index.ts",
      hash: "def456",
      size: 800,
      kind: "code",
      lang: "ts"
    },
    {
      path: "packages/core/__tests__/scanner.unit.test.ts",
      hash: "ghi789",
      size: 300,
      kind: "test",
      lang: "ts"
    }
  ]
};

// ─── workspace helpers ────────────────────────────────────────────────────────

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-mcp-"));
  workspaces.push(dir);
  return dir;
}

async function writeArtifacts(root: string): Promise<void> {
  const cfDir = path.join(root, ".contextforge");
  await mkdir(cfDir, { recursive: true });
  await writeFile(
    path.join(cfDir, "graph.json"),
    JSON.stringify(GRAPH_FIXTURE),
    "utf8"
  );
  await writeFile(
    path.join(cfDir, "scan.json"),
    JSON.stringify(SCAN_FIXTURE),
    "utf8"
  );
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
  );
  workspaces.length = 0;
});

// ─── pure function tests ──────────────────────────────────────────────────────

describe("getDomain", () => {
  it('returns "packages/<pkg>" for paths under packages/', () => {
    expect(getDomain("packages/core/src/index.ts")).toBe("packages/core");
    expect(getDomain("packages/cli/src/index.ts")).toBe("packages/cli");
  });

  it("returns the first segment for paths not under packages/", () => {
    expect(getDomain("src/index.ts")).toBe("src");
  });

  it("returns the filename itself when there is no parent segment", () => {
    expect(getDomain("vitest.config.ts")).toBe("vitest.config.ts");
  });
});

describe("formatFileList", () => {
  const files = [
    { path: "src/a.ts", mode: "full", reason: "seed" },
    { path: "src/b.ts", mode: "excerpt", reason: "neighbor" }
  ];

  it("formats without score by default", () => {
    const out = formatFileList(files);
    expect(out).toBe("- src/a.ts (full, seed)\n- src/b.ts (excerpt, neighbor)");
  });

  it("includes score when includeScore=true and score is present", () => {
    const withScore = [{ ...files[0], score: 0.9123 }, files[1]];
    const out = formatFileList(withScore, true);
    expect(out).toContain("[score=0.9123]");
    expect(out).not.toMatch(/src\/b\.ts.*\[score=/);
  });

  it("returns empty string for an empty array", () => {
    expect(formatFileList([])).toBe("");
  });
});

// ─── filesystem tests ─────────────────────────────────────────────────────────

describe("forgeStatus", () => {
  it("shows checkmarks when artifacts are present", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeStatus } = createHandlers(root);

    const result = await forgeStatus();
    const text = result.content[0].text;

    expect(text).toContain("✅");
    expect(text).toContain("scan.json");
    expect(text).toContain("graph.json");
  });

  it("shows empty boxes when .contextforge dir is absent", async () => {
    const root = await newWorkspace();
    const { forgeStatus } = createHandlers(root);

    const result = await forgeStatus();
    const text = result.content[0].text;

    expect(text).toContain("⬜");
  });
});

describe("forgeContext", () => {
  it("returns ranked file list with context pack header", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeContext } = createHandlers(root);

    const result = await forgeContext({ task: "fix bug" });
    const text = result.content[0].text;

    expect(text).toContain("# Context pack for:");
    // at least one file line
    expect(text).toMatch(/###\s+\S+/);
  });
});

describe("forgeNeighbors", () => {
  it("returns neighbors section when file is found", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeNeighbors } = createHandlers(root);

    const result = await forgeNeighbors({
      file_path: "packages/cli/src/index.ts"
    });
    const text = result.content[0].text;

    expect(text).toContain("Graph neighbors:");
    expect(text).toContain("imports");
  });

  it("returns not-found message for unknown file", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeNeighbors } = createHandlers(root);

    const result = await forgeNeighbors({ file_path: "nonexistent/file.ts" });
    const text = result.content[0].text;

    expect(text).toContain("File not found:");
  });
});

describe("forgeDomainMap", () => {
  it("groups files by domain", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeDomainMap } = createHandlers(root);

    const result = await forgeDomainMap();
    const text = result.content[0].text;

    expect(text).toContain("packages/core");
    expect(text).toContain("packages/cli");
  });
});

describe("forgeCheck", () => {
  it("returns no-plan message when implement-plan.json is absent", async () => {
    const root = await newWorkspace();
    const { forgeCheck } = createHandlers(root);

    const result = await forgeCheck();
    const text = result.content[0].text;

    expect(text).toContain("No implement-plan.json found");
  });

  it("returns PASSED when plan exists and execSync returns no changed files", async () => {
    const root = await newWorkspace();
    const cfDir = path.join(root, ".contextforge");
    await mkdir(cfDir, { recursive: true });

    const plan = {
      taskId: "t1",
      title: "Test plan",
      status: "pending",
      guardrails: {
        allowedFiles: ["src/a.ts"],
        forbiddenPaths: [],
        maxLocDelta: 200
      },
      tasks: []
    };
    await writeFile(
      path.join(cfDir, "implement-plan.json"),
      JSON.stringify(plan),
      "utf8"
    );

    const mockExecSync = () => "";
    const { forgeCheck } = createHandlers(root, {
      execSync: mockExecSync as never
    });

    const result = await forgeCheck();
    expect(result.content[0].text).toContain("PASSED");
  });

  it("shows maxFilesChanged guardrail when present in plan", async () => {
    const root = await newWorkspace();
    const cfDir = path.join(root, ".contextforge");
    await mkdir(cfDir, { recursive: true });

    const plan = {
      taskId: "t2",
      title: "Plan with maxFilesChanged",
      status: "pending",
      guardrails: {
        allowedFiles: ["src/a.ts"],
        forbiddenPaths: [],
        maxLocDelta: 100,
        maxFilesChanged: 3
      },
      tasks: []
    };
    await writeFile(
      path.join(cfDir, "implement-plan.json"),
      JSON.stringify(plan),
      "utf8"
    );

    const mockExecSync = () => "";
    const { forgeCheck } = createHandlers(root, {
      execSync: mockExecSync as never
    });

    const result = await forgeCheck();
    expect(result.content[0].text).toContain("Max files changed: 3");
  });
});

describe("forgeStatus — artifact detail formatting", () => {
  it("formats context-pack, implement-plan, and token-ledger details when present", async () => {
    const root = await newWorkspace();
    const cfDir = path.join(root, ".contextforge");
    await mkdir(cfDir, { recursive: true });

    await writeFile(
      path.join(cfDir, "graph.json"),
      JSON.stringify({ nodes: [], edges: [] }),
      "utf8"
    );
    await writeFile(
      path.join(cfDir, "scan.json"),
      JSON.stringify({ files: [] }),
      "utf8"
    );
    await writeFile(
      path.join(cfDir, "context-pack.json"),
      JSON.stringify({ files: [{}, {}], budget: { estimatedTokens: 5000 } }),
      "utf8"
    );
    await writeFile(
      path.join(cfDir, "implement-plan.json"),
      JSON.stringify({ status: "plan_only" }),
      "utf8"
    );
    await writeFile(
      path.join(cfDir, "token-ledger.json"),
      JSON.stringify({ savings: { savingsPct: 88.5 } }),
      "utf8"
    );

    const { forgeStatus } = createHandlers(root);
    const result = await forgeStatus();
    const text = result.content[0].text;

    expect(text).toContain("2 files");
    expect(text).toContain("5000 tokens");
    expect(text).toContain("plan_only");
    expect(text).toContain("88.5%");
  });
});

describe("forgeNeighbors — no similar files found", () => {
  it('shows "none" when file is not found and no similar names exist', async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeNeighbors } = createHandlers(root);

    const result = await forgeNeighbors({
      file_path: "zzz/completely-unique-xyz.ts"
    });
    const text = result.content[0].text;

    expect(text).toContain("File not found:");
    expect(text).toContain("none");
  });
});

describe("forgeChangeSubgraph", () => {
  it("returns the subgraph JSON when the change directory has one", async () => {
    const root = await newWorkspace();
    const changeDir = path.join(root, "openspec", "changes", "test-change");
    await mkdir(changeDir, { recursive: true });
    const subgraph = {
      schemaVersion: "1.0.0",
      changeId: "test-change",
      generatedAt: "2026-05-08T00:00:00Z",
      graphRef: ".contextforge/graph.json",
      focus: ["src/a.ts"],
      stats: {
        nodesTotal: 1,
        edgesTotal: 0,
        nodesByType: {},
        edgesByType: {},
        depth: 1
      },
      nodes: [
        { id: "file:src/a.ts", type: "file", label: "a.ts", path: "src/a.ts" }
      ],
      edges: []
    };
    await writeFile(
      path.join(changeDir, "graph.subset.json"),
      JSON.stringify(subgraph),
      "utf8"
    );

    const { forgeChangeSubgraph } = createHandlers(root);
    const result = await forgeChangeSubgraph({ change_id: "test-change" });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.changeId).toBe("test-change");
    expect(parsed.focus).toEqual(["src/a.ts"]);
  });

  it("returns an error when the change directory has no subgraph", async () => {
    const root = await newWorkspace();
    const { forgeChangeSubgraph } = createHandlers(root);
    const result = await forgeChangeSubgraph({ change_id: "missing" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No subgraph found");
  });

  it("rejects unsafe change_id values", async () => {
    const root = await newWorkspace();
    const { forgeChangeSubgraph } = createHandlers(root);
    const result = await forgeChangeSubgraph({ change_id: "../etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid change_id");
  });
});

describe("forgeChangeContext", () => {
  it("returns the context.md when present in a change directory", async () => {
    const root = await newWorkspace();
    const changeDir = path.join(root, "openspec", "changes", "demo-change");
    await mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, "context.md"),
      "# Contexto del change `demo-change`\n\nReading order...\n",
      "utf8"
    );

    const { forgeChangeContext } = createHandlers(root);
    const result = await forgeChangeContext({ change_id: "demo-change" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Contexto del change");
  });

  it("returns an error when context.md is missing", async () => {
    const root = await newWorkspace();
    const { forgeChangeContext } = createHandlers(root);
    const result = await forgeChangeContext({ change_id: "missing" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No context.md found");
  });

  it("rejects unsafe change_id", async () => {
    const root = await newWorkspace();
    const { forgeChangeContext } = createHandlers(root);
    const result = await forgeChangeContext({ change_id: "../etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid change_id");
  });
});

describe("forgeArchiveChange", () => {
  it("rejects unsafe change_id", async () => {
    const root = await newWorkspace();
    const { forgeArchiveChange } = createHandlers(root);
    const result = await forgeArchiveChange({ change_id: "../etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid change_id");
  });

  it("rebuilds parent graph and refreshes existing subgraphs (skip_openspec_archive=true)", async () => {
    const root = await newWorkspace();
    // Seed a tiny project: one source file.
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "export const x = 1;\n",
      "utf8"
    );
    // Seed an active change with an existing subgraph (focus on src/a.ts).
    const changeDir = path.join(root, "openspec", "changes", "demo");
    await mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, "graph.subset.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        changeId: "demo",
        generatedAt: "2026-01-01T00:00:00Z",
        graphRef: ".contextforge/graph.json",
        focus: ["src/a.ts"],
        stats: {
          nodesTotal: 0,
          edgesTotal: 0,
          nodesByType: {},
          edgesByType: {},
          depth: 1,
          mode: "compact"
        },
        nodes: [],
        edges: []
      }),
      "utf8"
    );

    const { forgeArchiveChange } = createHandlers(root);
    const result = await forgeArchiveChange({
      change_id: "demo",
      skip_openspec_archive: true
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("openspec archive skipped");
    expect(text).toMatch(/scan: \d+ files indexed/);
    expect(text).toMatch(/graph: \d+ nodes/);
    expect(text).toContain("subgraphs refreshed: 1");
    expect(text).toContain("- demo");

    // Subgraph file should now be a non-empty real subgraph.
    const subset = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(changeDir, "graph.subset.json"), "utf8")
    ) as { stats: { nodesTotal: number }; nodes: unknown[] };
    expect(subset.nodes.length).toBeGreaterThan(0);
    expect(subset.stats.nodesTotal).toBe(subset.nodes.length);
  });
});

describe("forgeStatus — change subgraph awareness", () => {
  it("lists OpenSpec changes that ship a frozen subgraph", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root); // creates basic .contextforge artifacts
    const changeDir = path.join(root, "openspec", "changes", "demo-change");
    await mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, "graph.subset.json"),
      JSON.stringify({
        stats: { nodesTotal: 42, edgesTotal: 17 }
      })
    );
    // Another directory without subgraph — should not be listed.
    await mkdir(path.join(root, "openspec", "changes", "no-subgraph"), {
      recursive: true
    });

    const { forgeStatus } = createHandlers(root);
    const result = await forgeStatus();
    const text = result.content[0].text;

    expect(text).toContain("OpenSpec changes with frozen subgraph");
    expect(text).toContain("demo-change");
    expect(text).toContain("42 nodes");
    expect(text).toContain(
      'forge_change_subgraph({ change_id: "demo-change" })'
    );
    expect(text).not.toContain("no-subgraph");
  });
});

// ─── semantic-layer handlers ──────────────────────────────────────────────────

const SEMANTIC_GRAPH_FIXTURE = {
  schemaVersion: "0.3.0",
  generatedAt: "2026-01-01T00:00:00Z",
  semanticEnabled: true,
  nodes: [
    {
      id: "file:src/auth/auth.controller.ts",
      type: "file",
      label: "auth.controller.ts",
      path: "src/auth/auth.controller.ts",
      kind: "code",
      lang: "ts"
    },
    {
      id: "file:src/auth/auth.service.ts",
      type: "file",
      label: "auth.service.ts",
      path: "src/auth/auth.service.ts",
      kind: "code",
      lang: "ts"
    },
    {
      id: "file:src/billing/invoice.service.ts",
      type: "file",
      label: "invoice.service.ts",
      path: "src/billing/invoice.service.ts",
      kind: "code",
      lang: "ts"
    },
    { id: "domain:auth", type: "domain", label: "auth", files: 2 },
    { id: "domain:billing", type: "domain", label: "billing", files: 1 },
    {
      id: "layer:controller",
      type: "layer",
      label: "controller",
      kind: "backend"
    },
    { id: "layer:service", type: "layer", label: "service", kind: "backend" },
    {
      id: "endpoint:POST:/auth/login",
      type: "endpoint",
      label: "POST /auth/login",
      method: "POST",
      path: "/auth/login",
      framework: "nest"
    },
    {
      id: "flow:auth/post-auth-login",
      type: "flow",
      label: "POST /auth/login",
      domain: "auth",
      entryFile: "src/auth/auth.controller.ts",
      stepCount: 2
    },
    {
      id: "step:flow:auth/post-auth-login#1",
      type: "step",
      label: "1. src/auth/auth.controller.ts",
      order: 1,
      stepFile: "src/auth/auth.controller.ts",
      stepLayer: "controller"
    },
    {
      id: "step:flow:auth/post-auth-login#2",
      type: "step",
      label: "2. src/auth/auth.service.ts",
      order: 2,
      stepFile: "src/auth/auth.service.ts",
      stepLayer: "service"
    }
  ],
  edges: [
    {
      from: "file:src/auth/auth.controller.ts",
      to: "domain:auth",
      type: "belongs_to_domain"
    },
    {
      from: "file:src/auth/auth.service.ts",
      to: "domain:auth",
      type: "belongs_to_domain"
    },
    {
      from: "file:src/billing/invoice.service.ts",
      to: "domain:billing",
      type: "belongs_to_domain"
    },
    {
      from: "file:src/auth/auth.controller.ts",
      to: "layer:controller",
      type: "in_layer"
    },
    {
      from: "file:src/auth/auth.service.ts",
      to: "layer:service",
      type: "in_layer"
    },
    {
      from: "file:src/auth/auth.controller.ts",
      to: "endpoint:POST:/auth/login",
      type: "exposes_endpoint"
    },
    {
      from: "file:src/auth/auth.controller.ts",
      to: "flow:auth/post-auth-login",
      type: "implements_flow"
    },
    {
      from: "file:src/auth/auth.service.ts",
      to: "flow:auth/post-auth-login",
      type: "implements_flow"
    },
    {
      from: "flow:auth/post-auth-login",
      to: "step:flow:auth/post-auth-login#1",
      type: "flow_step"
    },
    {
      from: "flow:auth/post-auth-login",
      to: "step:flow:auth/post-auth-login#2",
      type: "flow_step"
    },
    {
      from: "domain:auth",
      to: "domain:billing",
      type: "cross_domain",
      weight: 2
    }
  ]
};

async function writeSemanticArtifacts(root: string): Promise<void> {
  const cfDir = path.join(root, ".contextforge");
  await mkdir(cfDir, { recursive: true });
  await writeFile(
    path.join(cfDir, "graph.json"),
    JSON.stringify(SEMANTIC_GRAPH_FIXTURE),
    "utf8"
  );
  await writeFile(
    path.join(cfDir, "scan.json"),
    JSON.stringify({
      schemaVersion: "0.2.0",
      hashAlgorithm: "blake3",
      generatedAt: "2026-01-01T00:00:00Z",
      root: ".",
      files: [
        {
          path: "src/auth/auth.controller.ts",
          hash: "a",
          size: 200,
          kind: "code",
          lang: "ts"
        },
        {
          path: "src/auth/auth.service.ts",
          hash: "b",
          size: 200,
          kind: "code",
          lang: "ts"
        },
        {
          path: "src/billing/invoice.service.ts",
          hash: "c",
          size: 200,
          kind: "code",
          lang: "ts"
        }
      ]
    }),
    "utf8"
  );
}

describe("forgeSemanticMap", () => {
  it("returns a JSON map of domains -> files/endpoints/flows", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeSemanticMap } = createHandlers(root);

    const result = await forgeSemanticMap({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.domains.map((d: { name: string }) => d.name)).toEqual([
      "auth",
      "billing"
    ]);
    const auth = parsed.domains.find(
      (d: { name: string }) => d.name === "auth"
    );
    expect(auth.files).toContain("src/auth/auth.controller.ts");
    expect(auth.endpoints).toEqual([
      {
        method: "POST",
        path: "/auth/login",
        framework: "nest",
        id: "endpoint:POST:/auth/login"
      }
    ]);
    expect(auth.flows[0].id).toBe("flow:auth/post-auth-login");
  });

  it("filters to a single domain when domain arg is given", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeSemanticMap } = createHandlers(root);

    const result = await forgeSemanticMap({ domain: "billing" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.domains).toHaveLength(1);
    expect(parsed.domains[0].name).toBe("billing");
  });

  it("returns a hint when the graph has no semantic layer", async () => {
    const root = await newWorkspace();
    await writeArtifacts(root);
    const { forgeSemanticMap } = createHandlers(root);

    const result = await forgeSemanticMap({});
    expect(result.content[0].text).toContain("--with-semantic");
  });

  it("reports unknown domain with a list of known ones", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeSemanticMap } = createHandlers(root);

    const result = await forgeSemanticMap({ domain: "missing" });
    expect(result.content[0].text).toContain('Domain "missing" not found');
    expect(result.content[0].text).toContain("auth");
  });
});

describe("forgeFlow", () => {
  it("returns ordered steps for a known flow", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeFlow } = createHandlers(root);

    const result = await forgeFlow({
      flow_id: "flow:auth/post-auth-login"
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("flow:auth/post-auth-login");
    expect(parsed.steps.map((s: { layer: string }) => s.layer)).toEqual([
      "controller",
      "service"
    ]);
    expect(parsed.steps[0].order).toBe(1);
  });

  it("accepts a short id without the 'flow:' prefix", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeFlow } = createHandlers(root);

    const result = await forgeFlow({ flow_id: "auth/post-auth-login" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("flow:auth/post-auth-login");
  });

  it("lists known flows when the id is missing", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeFlow } = createHandlers(root);

    const result = await forgeFlow({ flow_id: "flow:does/not-exist" });
    expect(result.content[0].text).toContain("Flow not found");
    expect(result.content[0].text).toContain("flow:auth/post-auth-login");
  });
});

describe("forgeNeighbors — semantic sections", () => {
  it("renders same_domain, exposes_endpoint and flows_participating", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeNeighbors } = createHandlers(root);

    const result = await forgeNeighbors({
      file_path: "src/auth/auth.controller.ts"
    });
    const text = result.content[0].text;
    expect(text).toContain("same domain");
    expect(text).toContain("src/auth/auth.service.ts");
    expect(text).toContain("exposes endpoint");
    expect(text).toContain("POST /auth/login");
    expect(text).toContain("flows participating");
  });
});

describe("forgeSpec", () => {
  async function writeSpecArtifacts(root: string): Promise<void> {
    const cfDir = path.join(root, ".contextforge");
    await mkdir(cfDir, { recursive: true });
    await writeFile(
      path.join(cfDir, "graph.json"),
      JSON.stringify({
        schemaVersion: "0.3.0",
        project: { name: "demo", root: "." },
        generatedAt: "2026-01-01T00:00:00Z",
        nodes: [
          {
            id: "file:src/auth/login.ts",
            type: "file",
            label: "login.ts",
            path: "src/auth/login.ts",
            kind: "code"
          }
        ],
        edges: []
      }),
      "utf8"
    );
    await writeFile(
      path.join(cfDir, "context-pack.json"),
      JSON.stringify({
        task: "ship login flow",
        files: [{ path: "src/auth/login.ts", reason: "seed", mode: "full" }],
        budget: { maxInputTokens: 12000, estimatedTokens: 1500 }
      }),
      "utf8"
    );
  }

  it("rejects non-kebab change ids", async () => {
    const root = await newWorkspace();
    const { forgeSpec } = createHandlers(root);
    const result = await forgeSpec({ change_id: "Bad_Id With Spaces" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("kebab-case");
  });

  it("returns a clear error when context-pack.json is missing", async () => {
    const root = await newWorkspace();
    const { forgeSpec } = createHandlers(root);
    const result = await forgeSpec({ change_id: "ship-login" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("forge_context");
  });

  it("scaffolds the change end-to-end (fallback path) and writes all artefacts", async () => {
    const root = await newWorkspace();
    await writeSpecArtifacts(root);
    const { forgeSpec } = createHandlers(root);

    const result = await forgeSpec({
      change_id: "ship-login",
      skip_openspec_cli: true
    });
    expect(result.isError).toBeFalsy();

    const cfDir = path.join(root, ".contextforge");
    const changeDir = path.join(root, "openspec", "changes", "ship-login");

    // Spec input
    const specInput = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(cfDir, "spec-input.json"), "utf8")
    );
    expect(specInput.changeId).toBe("ship-login");
    expect(specInput.task).toBe("ship login flow");

    // Spec prompt
    const promptBody = await (
      await import("node:fs/promises")
    ).readFile(path.join(cfDir, "spec-prompt.md"), "utf8");
    expect(promptBody).toContain("ship-login");

    // Subgraph
    const subset = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(changeDir, "graph.subset.json"), "utf8")
    );
    expect(subset.changeId).toBe("ship-login");
    expect(subset.focus).toEqual(["src/auth/login.ts"]);

    // context.md
    const contextMd = await (
      await import("node:fs/promises")
    ).readFile(path.join(changeDir, "context.md"), "utf8");
    expect(contextMd).toContain("Contexto del change");
    expect(contextMd).toContain("ship-login");

    // Fallback scaffold files (proposal, design, tasks, specs/.../spec.md)
    const proposal = await (
      await import("node:fs/promises")
    ).readFile(path.join(changeDir, "proposal.md"), "utf8");
    expect(proposal).toContain("Intent");
  });
});

describe("forgeDomainMap — semantic source", () => {
  it("uses semantic-layer domain nodes when available", async () => {
    const root = await newWorkspace();
    await writeSemanticArtifacts(root);
    const { forgeDomainMap } = createHandlers(root);

    const result = await forgeDomainMap();
    const text = result.content[0].text;
    expect(text).toContain("Pass-5 semantic layer");
    expect(text).toContain("## auth");
    expect(text).toContain("## billing");
    expect(text).toContain("auth → billing");
  });
});
