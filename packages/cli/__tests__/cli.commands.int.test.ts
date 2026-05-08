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
      await runCommand("spec");
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
