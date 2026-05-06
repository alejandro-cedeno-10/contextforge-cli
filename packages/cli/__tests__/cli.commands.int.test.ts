import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/index";

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-cli-"));
  workspaces.push(dir);
  return dir;
}

describe("forge commands", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("runs full pipeline and creates artifacts", async () => {
    const cwd = await workspace();
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(
      path.join(cwd, "src", "index.ts"),
      "export const n = 1;\n",
      "utf8"
    );

    const originalCwd = process.cwd();
    process.chdir(cwd);

    try {
      await runCommand("init");
      await runCommand("scan");
      await runCommand("graph");
      await runCommand("context");
      await runCommand("spec");
      await runCommand("implement");
    } finally {
      process.chdir(originalCwd);
    }

    const scan = JSON.parse(
      await readFile(path.join(cwd, ".contextforge", "scan.json"), "utf8")
    ) as {
      files: unknown[];
    };
    const graph = JSON.parse(
      await readFile(path.join(cwd, ".contextforge", "graph.json"), "utf8")
    ) as {
      nodes: unknown[];
    };
    const context = JSON.parse(
      await readFile(
        path.join(cwd, ".contextforge", "context-pack.json"),
        "utf8"
      )
    ) as {
      files: unknown[];
    };
    const implement = JSON.parse(
      await readFile(
        path.join(cwd, ".contextforge", "implement-plan.json"),
        "utf8"
      )
    ) as { status: string };

    expect(scan.files.length).toBeGreaterThan(0);
    expect(graph.nodes.length).toBe(scan.files.length);
    expect(context.files.length).toBeGreaterThan(0);
    expect(implement.status).toBe("plan_only");

    const spec = await readFile(
      path.join(cwd, ".contextforge", "spec.sdd.md"),
      "utf8"
    );
    expect(spec).toContain("# Spec SDD");
  });
});
