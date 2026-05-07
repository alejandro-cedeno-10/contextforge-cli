import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanProject } from "../src/scanner";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-cache-"));
  workspaces.push(dir);
  return dir;
}

describe("scan cache", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("writes cache and only changes hash for modified files", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 2;\n");

    const first = await scanProject(root);
    const second = await scanProject(root);

    const firstA = first.files.find((file) => file.path === "src/a.ts")?.hash;
    const secondA = second.files.find((file) => file.path === "src/a.ts")?.hash;
    expect(secondA).toBe(firstA);

    await new Promise((resolve) => setTimeout(resolve, 15));
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 3;\n");

    const third = await scanProject(root);
    const thirdA = third.files.find((file) => file.path === "src/a.ts")?.hash;
    const secondB = second.files.find((file) => file.path === "src/b.ts")?.hash;
    const thirdB = third.files.find((file) => file.path === "src/b.ts")?.hash;

    expect(thirdA).not.toBe(secondA);
    expect(thirdB).toBe(secondB);

    const cachePath = path.join(
      root,
      ".contextforge",
      "cache",
      "scan-cache.json"
    );
    const cacheRaw = await readFile(cachePath, "utf8");
    const cache = JSON.parse(cacheRaw) as {
      files: Record<string, { hash: string; size: number; mtimeMs: number }>;
    };

    expect(cache.files["src/a.ts"]?.hash).toBe(thirdA);
    expect(cache.files["src/b.ts"]?.hash).toBe(thirdB);
    expect(cache.files["src/a.ts"]?.size).toBeGreaterThan(0);
  });
});
