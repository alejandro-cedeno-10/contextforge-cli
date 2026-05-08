import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildGraph } from "../src/graph/builder";
import { GRAPH_CACHE_FILE, loadCache, saveCache } from "../src/graph/cache";
import { PARSER_VERSION } from "../src/parser/treeSitter";
import { SCHEMA_VERSIONS } from "../src/schema/versions";
import type { ScanResult } from "../src/scanner";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-cache-"));
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

describe("graph cache", () => {
  afterEach(async () => {
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("returns null when cache file is missing", async () => {
    const root = await newWorkspace();
    const cache = await loadCache(root);
    expect(cache).toBeNull();
  });

  it("roundtrips through saveCache / loadCache", async () => {
    const root = await newWorkspace();
    await saveCache(root, {
      schemaVersion: SCHEMA_VERSIONS.graph,
      parserVersion: PARSER_VERSION,
      entries: {
        "a.ts": {
          hash: "h1",
          fragment: {
            language: "typescript",
            captures: [
              {
                type: "function_declaration",
                name: "foo",
                line: 1,
                exported: true
              }
            ],
            imports: [],
            heritage: []
          }
        }
      }
    });

    const cache = await loadCache(root);
    expect(cache?.entries["a.ts"]?.hash).toBe("h1");
    expect(cache?.entries["a.ts"]?.fragment.captures).toHaveLength(1);
  });

  it("rejects cache from an incompatible parser version", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, ".contextforge"), { recursive: true });
    await writeFile(
      path.join(root, GRAPH_CACHE_FILE),
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.graph,
        parserVersion: "ancient-0",
        entries: {}
      })
    );

    const cache = await loadCache(root);
    expect(cache).toBeNull();
  });

  it("reuses cached fragments when file hash is unchanged", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "export function foo() {}\n"
    );

    const scan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 30, hash: "h-stable", kind: "code" }
    ]);

    const first = await buildGraph({ root, scan });
    expect(first.cacheStats.reparsed).toBe(1);
    expect(first.cacheStats.reused).toBe(0);

    const second = await buildGraph({ root, scan, cache: first.cacheUpdate });
    expect(second.cacheStats.reparsed).toBe(0);
    expect(second.cacheStats.reused).toBe(1);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });

  it("only reparses files whose hash changed", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "export function foo() {}\n"
    );
    await writeFile(
      path.join(root, "src", "b.ts"),
      "export function bar() {}\n"
    );

    const initialScan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 30, hash: "ha-1", kind: "code" },
      { path: "src/b.ts", ext: ".ts", size: 30, hash: "hb-1", kind: "code" }
    ]);

    const first = await buildGraph({ root, scan: initialScan });
    expect(first.cacheStats.reparsed).toBe(2);

    const updatedScan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 30, hash: "ha-1", kind: "code" },
      { path: "src/b.ts", ext: ".ts", size: 30, hash: "hb-2", kind: "code" }
    ]);

    const second = await buildGraph({
      root,
      scan: updatedScan,
      cache: first.cacheUpdate
    });
    expect(second.cacheStats.reused).toBe(1);
    expect(second.cacheStats.reparsed).toBe(1);
  });

  it("produces byte-identical output across runs (stable order)", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src", "deep"), { recursive: true });
    await writeFile(
      path.join(root, "src", "a.ts"),
      "import { B } from './deep/b';\nexport class A extends B {}\n"
    );
    await writeFile(
      path.join(root, "src", "deep", "b.ts"),
      "export class B {}\n"
    );

    const scan = makeScan(root, [
      { path: "src/a.ts", ext: ".ts", size: 60, hash: "s1", kind: "code" },
      {
        path: "src/deep/b.ts",
        ext: ".ts",
        size: 20,
        hash: "s2",
        kind: "code"
      }
    ]);

    const first = await buildGraph({ root, scan });
    const second = await buildGraph({ root, scan });
    expect(JSON.stringify(second.nodes)).toBe(JSON.stringify(first.nodes));
    expect(JSON.stringify(second.edges)).toBe(JSON.stringify(first.edges));
  });
});
