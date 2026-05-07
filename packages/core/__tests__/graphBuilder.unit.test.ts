import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildGraph } from "../src/graph/builder";
import type { ScanResult } from "../src/scanner";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-graph-"));
  workspaces.push(dir);
  return dir;
}

function makeScan(root: string, files: ScanResult["files"]): ScanResult {
  return {
    schemaVersion: "0.2.0",
    root,
    generatedAt: new Date().toISOString(),
    hashAlgorithm: "blake3",
    files
  };
}

describe("buildGraph", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("creates file nodes for every file in scan", async () => {
    const root = await newWorkspace();
    await writeFile(path.join(root, "a.ts"), "export const x = 1;\n");
    await writeFile(path.join(root, "b.ts"), "export const y = 2;\n");

    const scan = makeScan(root, [
      { path: "a.ts", ext: ".ts", size: 20, hash: "aaa", kind: "code" },
      { path: "b.ts", ext: ".ts", size: 20, hash: "bbb", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });

    const fileNodes = result.nodes.filter((n) => n.type === "file");
    expect(fileNodes.length).toBe(2);
    expect(fileNodes.map((n) => n.id)).toContain("file:a.ts");
    expect(fileNodes.map((n) => n.id)).toContain("file:b.ts");
  });

  it("creates symbol nodes and defines edges for exported symbols", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "scanner.ts"),
      "export function scanProject() {}\nexport class Scanner {}\n"
    );

    const scan = makeScan(root, [
      {
        path: "src/scanner.ts",
        ext: ".ts",
        size: 52,
        hash: "ccc",
        kind: "code"
      }
    ]);

    const result = await buildGraph({ root, scan });

    const symbolNodes = result.nodes.filter((n) => n.type === "symbol");
    expect(symbolNodes.length).toBe(2);
    expect(symbolNodes.map((n) => n.label)).toContain("scanProject");
    expect(symbolNodes.map((n) => n.label)).toContain("Scanner");

    const definesEdges = result.edges.filter((e) => e.type === "defines");
    expect(definesEdges.length).toBe(2);
    expect(definesEdges[0]?.from).toBe("file:src/scanner.ts");
  });

  it("creates imports edges for relative imports", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "import { Scanner } from './scanner';\nexport function run() {}\n"
    );
    await writeFile(
      path.join(root, "src", "scanner.ts"),
      "export class Scanner {}\n"
    );

    const scan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 50, hash: "d1", kind: "code" },
      {
        path: "src/scanner.ts",
        ext: ".ts",
        size: 25,
        hash: "d2",
        kind: "code"
      }
    ]);

    const result = await buildGraph({ root, scan });

    const importsEdges = result.edges.filter((e) => e.type === "imports");
    expect(importsEdges.length).toBe(1);
    expect(importsEdges[0]?.from).toBe("file:src/a.ts");
    expect(importsEdges[0]?.to).toBe("file:src/scanner.ts");
  });

  it("creates tests edge from test file to impl file", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "scanner.ts"),
      "export function x() {}\n"
    );
    await writeFile(
      path.join(root, "src", "scanner.test.ts"),
      "import { x } from './scanner';\n"
    );

    const scan = makeScan(root, [
      {
        path: "src/scanner.ts",
        ext: ".ts",
        size: 25,
        hash: "e1",
        kind: "code"
      },
      {
        path: "src/scanner.test.ts",
        ext: ".ts",
        size: 34,
        hash: "e2",
        kind: "test"
      }
    ]);

    const result = await buildGraph({ root, scan });

    const testsEdge = result.edges.find((e) => e.type === "tests");
    expect(testsEdge).toBeDefined();
    expect(testsEdge?.from).toBe("file:src/scanner.test.ts");
    expect(testsEdge?.to).toBe("file:src/scanner.ts");
  });

  it("does not create duplicate edges", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "import { x } from './b';\nimport { y } from './b';\n"
    );
    await writeFile(
      path.join(root, "src", "b.ts"),
      "export const x = 1; export const y = 2;\n"
    );

    const scan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 50, hash: "f1", kind: "code" },
      { path: "src/b.ts", ext: ".ts", size: 40, hash: "f2", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });

    const importsEdges = result.edges.filter(
      (e) => e.type === "imports" && e.from === "file:src/a.ts"
    );
    expect(importsEdges.length).toBe(1);
  });

  it("skips non-code files for symbol/import extraction", async () => {
    const root = await newWorkspace();
    await writeFile(path.join(root, "README.md"), "# Hello\n");
    await writeFile(path.join(root, "package.json"), '{ "name": "test" }\n');

    const scan = makeScan(root, [
      { path: "README.md", ext: ".md", size: 8, hash: "g1", kind: "doc" },
      {
        path: "package.json",
        ext: ".json",
        size: 17,
        hash: "g2",
        kind: "config"
      }
    ]);

    const result = await buildGraph({ root, scan });

    expect(result.nodes.filter((n) => n.type === "symbol").length).toBe(0);
    expect(result.edges.length).toBe(0);
  });

  it("reports correct stats", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "import { B } from './b';\nexport function a() {}\n"
    );
    await writeFile(path.join(root, "src", "b.ts"), "export class B {}\n");

    const scan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 45, hash: "h1", kind: "code" },
      { path: "src/b.ts", ext: ".ts", size: 18, hash: "h2", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });

    expect(result.stats.nodesTotal).toBe(result.nodes.length);
    expect(result.stats.edgesTotal).toBe(result.edges.length);
    expect(result.stats.nodesByType["file"]).toBe(2);
    expect(result.stats.nodesByType["symbol"]).toBeGreaterThan(0);
    expect(result.stats.edgesByType["defines"]).toBeGreaterThan(0);
    expect(result.stats.edgesByType["imports"]).toBe(1);
    expect(result.parser.engine).toBe("heuristic");
  });
});
