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
      stats: { nodesTotal: 1, edgesTotal: 0, nodesByType: {}, edgesByType: {}, depth: 1 },
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
