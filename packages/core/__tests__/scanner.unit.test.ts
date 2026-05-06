import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "../src/scanner";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-scan-"));
  workspaces.push(dir);
  return dir;
}

describe("scanProject", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("returns sorted files with hashes and kinds", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "b.ts"),
      "export const b = 1;\n",
      "utf8"
    );
    await writeFile(path.join(root, "src", "a.md"), "hello\n", "utf8");

    const result = await scanProject(root);

    expect(result.schemaVersion).toBe("0.1.0");
    expect(result.files.length).toBe(2);
    expect(result.files.map((file) => file.path)).toEqual([
      "src/a.md",
      "src/b.ts"
    ]);
    expect(result.files[0]?.kind).toBe("doc");
    expect(result.files[1]?.kind).toBe("code");
    expect(result.files[1]?.hash.length).toBe(64);
  });

  it("ignores default folders and forgeignore rules", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await mkdir(path.join(root, "src", "generated"), { recursive: true });
    await writeFile(path.join(root, ".forgeignore"), "src/generated\n", "utf8");
    await writeFile(path.join(root, "node_modules", "x.js"), "bad", "utf8");
    await writeFile(path.join(root, "src", "generated", "x.ts"), "bad", "utf8");
    await mkdir(path.join(root, ".contextforge"), { recursive: true });
    await writeFile(
      path.join(root, ".contextforge", "scan.json"),
      "{}",
      "utf8"
    );
    await writeFile(path.join(root, "src", "ok.ts"), "ok", "utf8");

    const result = await scanProject(root);
    const paths = result.files.map((file) => file.path);

    expect(paths).toEqual([".forgeignore", "src/ok.ts"]);
  });
});
