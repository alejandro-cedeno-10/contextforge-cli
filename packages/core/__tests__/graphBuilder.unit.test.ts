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

  it("emits extends edges when a class extends another in the same file", async () => {
    const root = await newWorkspace();
    await writeFile(
      path.join(root, "a.ts"),
      "export class Base {}\nexport class Child extends Base {}\n"
    );

    const scan = makeScan(root, [
      { path: "a.ts", ext: ".ts", size: 60, hash: "i1", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });

    const extendsEdges = result.edges.filter((e) => e.type === "extends");
    expect(extendsEdges).toHaveLength(1);
    expect(extendsEdges[0]?.from).toBe("symbol:a.ts#Child");
    expect(extendsEdges[0]?.to).toBe("symbol:a.ts#Base");
  });

  it("emits implements edges across an imported file", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "iface.ts"),
      "export interface Greet { hello(): string; }\n"
    );
    await writeFile(
      path.join(root, "src", "impl.ts"),
      "import { Greet } from './iface';\nexport class Hi implements Greet {}\n"
    );

    const scan = makeScan(root, [
      { path: "src/iface.ts", ext: ".ts", size: 50, hash: "j1", kind: "code" },
      { path: "src/impl.ts", ext: ".ts", size: 80, hash: "j2", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });

    const implementsEdges = result.edges.filter((e) => e.type === "implements");
    expect(implementsEdges).toHaveLength(1);
    expect(implementsEdges[0]?.from).toBe("symbol:src/impl.ts#Hi");
    expect(implementsEdges[0]?.to).toBe("symbol:src/iface.ts#Greet");
  });

  it("marks unexported symbols with exported:false", async () => {
    const root = await newWorkspace();
    await writeFile(
      path.join(root, "a.ts"),
      "function privateOne() {}\nexport function publicOne() {}\n"
    );

    const scan = makeScan(root, [
      { path: "a.ts", ext: ".ts", size: 60, hash: "k1", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });

    const priv = result.nodes.find((n) => n.label === "privateOne");
    const pub = result.nodes.find((n) => n.label === "publicOne");
    expect(priv?.exported).toBe(false);
    expect(pub?.exported).toBe(true);
  });

  it("emits folder nodes and contains edges from path structure", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src", "deep"), { recursive: true });
    await writeFile(
      path.join(root, "src", "deep", "x.ts"),
      "export const x = 1;\n"
    );

    const scan = makeScan(root, [
      {
        path: "src/deep/x.ts",
        ext: ".ts",
        size: 20,
        hash: "l1",
        kind: "code"
      }
    ]);

    const result = await buildGraph({ root, scan });

    const folderNodes = result.nodes.filter((n) => n.type === "folder");
    expect(folderNodes.map((n) => n.id).sort()).toEqual([
      "folder:src",
      "folder:src/deep"
    ]);

    const containsEdges = result.edges.filter((e) => e.type === "contains");
    expect(containsEdges).toContainEqual(
      expect.objectContaining({
        from: "folder:src",
        to: "folder:src/deep",
        type: "contains"
      })
    );
    expect(containsEdges).toContainEqual(
      expect.objectContaining({
        from: "folder:src/deep",
        to: "file:src/deep/x.ts",
        type: "contains"
      })
    );
  });

  it("does not emit calls edges by default", async () => {
    const root = await newWorkspace();
    await writeFile(
      path.join(root, "a.ts"),
      "export function helper() {}\nexport function caller() { helper(); }\n"
    );

    const scan = makeScan(root, [
      { path: "a.ts", ext: ".ts", size: 80, hash: "n1", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });
    expect(result.edges.filter((e) => e.type === "calls")).toHaveLength(0);
  });

  it("emits calls edges within the same file when withCalls is on", async () => {
    const root = await newWorkspace();
    await writeFile(
      path.join(root, "a.ts"),
      "export function helper() {}\nexport function caller() { helper(); }\n"
    );

    const scan = makeScan(root, [
      { path: "a.ts", ext: ".ts", size: 80, hash: "o1", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan, withCalls: true });
    const callsEdges = result.edges.filter((e) => e.type === "calls");
    expect(callsEdges).toContainEqual(
      expect.objectContaining({
        from: "file:a.ts",
        to: "symbol:a.ts#helper",
        type: "calls"
      })
    );
  });

  it("emits calls edges across imports when withCalls is on", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "util.ts"),
      "export function compute() {}\n"
    );
    await writeFile(
      path.join(root, "src", "main.ts"),
      "import { compute } from './util';\nexport function run() { compute(); }\n"
    );

    const scan = makeScan(root, [
      { path: "src/util.ts", ext: ".ts", size: 30, hash: "p1", kind: "code" },
      { path: "src/main.ts", ext: ".ts", size: 80, hash: "p2", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan, withCalls: true });
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        from: "file:src/main.ts",
        to: "symbol:src/util.ts#compute",
        type: "calls"
      })
    );
  });

  it("reports parser.engine === 'none' when no code files are parsed", async () => {
    const root = await newWorkspace();
    await writeFile(path.join(root, "README.md"), "# hi\n");

    const scan = makeScan(root, [
      { path: "README.md", ext: ".md", size: 5, hash: "m1", kind: "doc" }
    ]);

    const result = await buildGraph({ root, scan });

    expect(result.parser.engine).toBe("none");
  });
});
