import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SchemaValidationError } from "@anai-raia-alex/contextforge-core";

const workspaces: string[] = [];
const here = path.dirname(fileURLToPath(import.meta.url));

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-cli-"));
  workspaces.push(dir);
  return dir;
}

async function inWorkspace<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}

async function loadCliModule(): Promise<typeof import("../src/index")> {
  return import("../src/index");
}

async function runCliEntry(
  cwd: string,
  command: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cliPath = path.resolve(here, "../src/index.ts");
  const tsxBin = path.resolve(
    here,
    "../../../node_modules/.bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx"
  );

  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn(tsxBin, [cliPath, command], {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
            shell: true
          })
        : spawn(tsxBin, [cliPath, command], {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"]
          });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("forge commands", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("runs full pipeline and creates schema-valid artifacts", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "src", "index.ts"),
      "export const n = 1;\n",
      "utf8"
    );

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await runCommand("init");
      await runCommand("scan");
      await runCommand("graph");
      await runCommand("context");
      // Force fallback mode in tests so we can assert the on-disk shape
      // without depending on whether the openspec CLI is installed on the
      // runner. The handoff path is covered by separate tests.
      await runCommand("spec", ["change-1", "--no-openspec"]);
      await runCommand("implement");
    });

    const scan = JSON.parse(
      await readFile(path.join(cwd, ".contextforge", "scan.json"), "utf8")
    ) as { schemaVersion: string; hashAlgorithm: string; files: unknown[] };
    const graph = JSON.parse(
      await readFile(path.join(cwd, ".contextforge", "graph.json"), "utf8")
    ) as {
      schemaVersion: string;
      nodes: Array<{ type: string }>;
      generatedAt: string;
      scanRef: { path: string; scanHash: string };
    };
    const context = JSON.parse(
      await readFile(
        path.join(cwd, ".contextforge", "context-pack.json"),
        "utf8"
      )
    ) as {
      schemaVersion: string;
      files: unknown[];
      generatedAt: string;
      budget: { estimatedTokens: number };
    };
    const ledger = JSON.parse(
      await readFile(
        path.join(cwd, ".contextforge", "token-ledger.json"),
        "utf8"
      )
    ) as {
      schemaVersion: string;
      tokenizer: { name: string };
      baseline: { tokens: number; filesIncluded: number };
      packed: { tokens: number; filesIncluded: number };
      savings: { savingsPct: number };
    };
    const implement = JSON.parse(
      await readFile(
        path.join(cwd, ".contextforge", "implement-plan.json"),
        "utf8"
      )
    ) as {
      schemaVersion: string;
      status: string;
      taskId: string;
      guardrails: { allowedFiles: string[]; maxLocDelta: number };
      tasks: Array<{ id: string }>;
    };

    expect(scan.schemaVersion).toBe("0.2.0");
    expect(scan.hashAlgorithm).toBe("blake3");
    expect(scan.files.length).toBeGreaterThan(0);

    expect(graph.schemaVersion).toBe("0.2.0");
    const fileNodes = graph.nodes.filter((n) => n.type === "file");
    expect(fileNodes.length).toBe(scan.files.length);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(scan.files.length);
    expect(graph.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(graph.scanRef.path).toBe(".contextforge/scan.json");
    expect(graph.scanRef.scanHash).toMatch(/^[0-9a-f]{64}$/);

    expect(context.schemaVersion).toBe("0.2.0");
    expect(context.files.length).toBeGreaterThan(0);
    expect(context.budget.estimatedTokens).toBeGreaterThan(0);

    expect(ledger.schemaVersion).toBe("0.2.0");
    expect(ledger.tokenizer.name).toBe("approximation");
    expect(ledger.baseline.filesIncluded).toBeGreaterThanOrEqual(
      ledger.packed.filesIncluded
    );
    expect(ledger.baseline.tokens).toBeGreaterThan(0);
    expect(ledger.savings.savingsPct).toBeLessThanOrEqual(100);

    expect(implement.status).toBe("plan_only");
    expect(implement.taskId).toBe("stub");
    expect(implement.guardrails.maxLocDelta).toBeGreaterThanOrEqual(1);
    expect(implement.tasks.length).toBeGreaterThanOrEqual(1);

    const proposal = await readFile(
      path.join(cwd, "openspec", "changes", "change-1", "proposal.md"),
      "utf8"
    );
    expect(proposal).toContain("## Intent");

    // T9-D — assert the change directory carries its self-contained subgraph
    // artefacts written AFTER the scaffold (openspec/changes/<id>/).
    const subgraphPath = path.join(
      cwd,
      "openspec",
      "changes",
      "change-1",
      "graph.subset.json"
    );
    const subgraph = JSON.parse(await readFile(subgraphPath, "utf8")) as {
      schemaVersion: string;
      changeId: string;
      graphRef: string;
      focus: string[];
      stats: { mode: "compact" | "full"; nodesTotal: number };
      nodes: Array<{ id: string }>;
      edges: unknown[];
    };
    expect(subgraph.schemaVersion).toBe("1.0.0");
    expect(subgraph.changeId).toBe("change-1");
    expect(subgraph.graphRef).toBe(".contextforge/graph.json");
    expect(subgraph.stats.mode).toBe("compact");
    expect(subgraph.focus.length).toBeGreaterThan(0);

    const subgraphHtml = await readFile(
      path.join(cwd, "openspec", "changes", "change-1", "graph.subset.html"),
      "utf8"
    );
    expect(subgraphHtml).toContain("<!DOCTYPE html>");
    expect(subgraphHtml).toContain("Change: change-1");

    const contextMd = await readFile(
      path.join(cwd, "openspec", "changes", "change-1", "context.md"),
      "utf8"
    );
    expect(contextMd).toContain("Contexto del change `change-1`");
    expect(contextMd).toContain("graph.subset.json");
    expect(contextMd).toContain("forge_change_subgraph");
  });

  it("forge spec --refresh-subgraph rewrites only the subgraph artefacts", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "src", "index.ts"),
      "export const n = 1;\n",
      "utf8"
    );

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await runCommand("scan");
      await runCommand("graph");
      await runCommand("context");
      await runCommand("spec", ["change-1", "--no-openspec"]);
    });

    const proposalPath = path.join(
      cwd,
      "openspec",
      "changes",
      "change-1",
      "proposal.md"
    );
    const subgraphPath = path.join(
      cwd,
      "openspec",
      "changes",
      "change-1",
      "graph.subset.json"
    );

    const proposalBefore = await readFile(proposalPath, "utf8");
    const subgraphBefore = JSON.parse(await readFile(subgraphPath, "utf8")) as {
      generatedAt: string;
    };

    // tiny delay so generatedAt timestamps can differ
    await new Promise((r) => setTimeout(r, 5));

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await runCommand("spec", ["change-1", "--refresh-subgraph"]);
    });

    const proposalAfter = await readFile(proposalPath, "utf8");
    const subgraphAfter = JSON.parse(await readFile(subgraphPath, "utf8")) as {
      generatedAt: string;
    };

    // proposal.md untouched, subgraph regenerated.
    expect(proposalAfter).toBe(proposalBefore);
    expect(subgraphAfter.generatedAt).not.toBe(subgraphBefore.generatedAt);

    const contextMd = await readFile(
      path.join(cwd, "openspec", "changes", "change-1", "context.md"),
      "utf8"
    );
    expect(contextMd).toContain("Scaffold por: **refresh**");
  });

  it("graph fails with SchemaValidationError when scan.json is invalid", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, ".contextforge"), { recursive: true });
    // Write an obviously invalid scan.json: missing required `files`, wrong shape.
    await writeFile(
      path.join(cwd, ".contextforge", "scan.json"),
      JSON.stringify({ schemaVersion: "0.2.0", root: cwd }),
      "utf8"
    );

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await expect(runCommand("graph")).rejects.toBeInstanceOf(
        SchemaValidationError
      );
    });
  });

  it("context fails with SchemaValidationError when graph.json is invalid", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, ".contextforge"), { recursive: true });
    await writeFile(
      path.join(cwd, ".contextforge", "graph.json"),
      JSON.stringify({
        schemaVersion: "0.2.0",
        // Missing project, generatedAt, nodes, edges.
        whatever: true
      }),
      "utf8"
    );

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await expect(runCommand("context")).rejects.toBeInstanceOf(
        SchemaValidationError
      );
    });
  });

  it("scan fails cleanly when the scanner returns an invalid payload", async () => {
    const cwd = await workspace();

    vi.resetModules();
    vi.doMock("@anai-raia-alex/contextforge-core", async () => {
      const actual = await vi.importActual<
        typeof import("@anai-raia-alex/contextforge-core")
      >("@anai-raia-alex/contextforge-core");

      return {
        ...actual,
        scanProject: vi.fn(async () => ({ schemaVersion: "0.2.0" }))
      };
    });

    try {
      await inWorkspace(cwd, async () => {
        const { runCommand } = await loadCliModule();
        await expect(runCommand("scan")).rejects.toMatchObject({
          name: "SchemaValidationError",
          schemaName: "scan"
        });
      });
    } finally {
      vi.doUnmock("@anai-raia-alex/contextforge-core");
      vi.resetModules();
    }
  });

  it("direct CLI exits with code 2 on schema validation failure", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, ".contextforge"), { recursive: true });
    await writeFile(
      path.join(cwd, ".contextforge", "scan.json"),
      JSON.stringify({ schemaVersion: "0.2.0", root: cwd }),
      "utf8"
    );

    const result = await runCliEntry(cwd, "graph");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("[forge] schema validation failed");
  });

  it("graph skips rebuild when scan hash is unchanged", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "index.ts"), "export const x = 1;\n");

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await runCommand("scan");
      await runCommand("graph");
    });

    const firstGraph = JSON.parse(
      await readFile(path.join(cwd, ".contextforge", "graph.json"), "utf8")
    ) as { generatedAt: string; scanRef: { scanHash: string } };

    await new Promise((resolve) => setTimeout(resolve, 20));

    await inWorkspace(cwd, async () => {
      const { runCommand } = await loadCliModule();
      await runCommand("graph");
    });

    const secondGraph = JSON.parse(
      await readFile(path.join(cwd, ".contextforge", "graph.json"), "utf8")
    ) as { generatedAt: string; scanRef: { scanHash: string } };

    expect(secondGraph.scanRef.scanHash).toBe(firstGraph.scanRef.scanHash);
    expect(secondGraph.generatedAt).toBe(firstGraph.generatedAt);
  });
});
