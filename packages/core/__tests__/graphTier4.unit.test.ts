import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildGraph } from "../src/graph/builder";
import {
  enrichGraphSymbols,
  selectEnrichmentTargets
} from "../src/graph/enrich";
import { exportToDot, exportToGraphML } from "../src/graph/exporters";
import {
  loadTsconfigPaths,
  resolveTsconfigAlias
} from "../src/graph/tsconfigPaths";
import type { ScanResult } from "../src/scanner";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-tier4-"));
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

describe("Tier 4 — references opt-in", () => {
  afterEach(async () => {
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("does not emit references edges by default", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "model.ts"),
      "export class User {}\n"
    );
    await writeFile(
      path.join(root, "src", "service.ts"),
      "import { User } from './model';\nexport const u: User = {} as User;\n"
    );

    const scan = makeScan(root, [
      { path: "src/model.ts", ext: ".ts", size: 25, hash: "r1", kind: "code" },
      {
        path: "src/service.ts",
        ext: ".ts",
        size: 60,
        hash: "r2",
        kind: "code"
      }
    ]);

    const result = await buildGraph({ root, scan });
    expect(result.edges.filter((e) => e.type === "references")).toHaveLength(0);
  });

  it("emits references edges across imports when withRefs is on", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "model.ts"),
      "export class User {}\n"
    );
    await writeFile(
      path.join(root, "src", "service.ts"),
      "import { User } from './model';\nexport const u: User = {} as User;\n"
    );

    const scan = makeScan(root, [
      { path: "src/model.ts", ext: ".ts", size: 25, hash: "s1", kind: "code" },
      {
        path: "src/service.ts",
        ext: ".ts",
        size: 60,
        hash: "s2",
        kind: "code"
      }
    ]);

    const result = await buildGraph({ root, scan, withRefs: true });
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        from: "file:src/service.ts",
        to: "symbol:src/model.ts#User",
        type: "references"
      })
    );
  });
});

describe("Tier 4 — exporters", () => {
  it("renders DOT with quoted ids and per-type styling", () => {
    const dot = exportToDot({
      nodes: [
        { id: "file:a.ts", type: "file", label: "a.ts" },
        {
          id: "symbol:a.ts#Foo",
          type: "symbol",
          label: "Foo",
          path: "a.ts",
          exported: true
        },
        {
          id: "symbol:a.ts#bar",
          type: "symbol",
          label: "bar",
          path: "a.ts",
          exported: false
        }
      ],
      edges: [
        {
          from: "file:a.ts",
          to: "symbol:a.ts#Foo",
          type: "defines",
          weight: 1
        }
      ]
    });
    expect(dot).toContain("digraph ContextForge");
    expect(dot).toContain('"file:a.ts"');
    expect(dot).toContain('"file:a.ts" -> "symbol:a.ts#Foo"');
    expect(dot).toContain('label="defines"');
  });

  it("renders GraphML with type and exported keys", () => {
    const xml = exportToGraphML({
      nodes: [
        {
          id: "symbol:a.ts#Foo",
          type: "symbol",
          label: "Foo",
          path: "a.ts",
          kind: "class_declaration",
          lang: "typescript",
          exported: true
        }
      ],
      edges: [
        {
          from: "file:a.ts",
          to: "symbol:a.ts#Foo",
          type: "defines",
          weight: 1
        }
      ]
    });
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<graphml");
    expect(xml).toContain('source="file:a.ts" target="symbol:a.ts#Foo"');
    expect(xml).toContain('<data key="d_exported">true</data>');
  });

  it("escapes XML special chars", () => {
    const xml = exportToGraphML({
      nodes: [{ id: "n<1>", type: "file", label: 'a&b"c' }],
      edges: []
    });
    expect(xml).toContain("n&lt;1&gt;");
    expect(xml).toContain("a&amp;b&quot;c");
  });
});

describe("Tier 4 — tsconfig paths", () => {
  afterEach(async () => {
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("returns null when tsconfig.json is missing", async () => {
    const root = await newWorkspace();
    const config = await loadTsconfigPaths(root);
    expect(config).toBeNull();
  });

  it("parses paths with wildcards and resolves to real files", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["src/*"] }
        }
      })
    );
    await writeFile(path.join(root, "src", "util.ts"), "export const x = 1;\n");

    const config = await loadTsconfigPaths(root);
    expect(config).not.toBeNull();

    const allFiles = new Set(["src/util.ts"]);
    const resolved = resolveTsconfigAlias("@/util", config!, allFiles);
    expect(resolved).toBe("src/util.ts");
  });

  it("handles JSONC (comments and trailing commas)", async () => {
    const root = await newWorkspace();
    await writeFile(
      path.join(root, "tsconfig.json"),
      `{
        // root config
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@util": ["src/util/index.ts"], /* singular */
          },
        },
      }`
    );

    const config = await loadTsconfigPaths(root);
    expect(config).not.toBeNull();
    expect(config!.rules).toHaveLength(1);
    expect(config!.rules[0]?.pattern).toBe("@util");
  });
});

describe("Tier 4 — package nodes for external imports", () => {
  afterEach(async () => {
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("emits a package node for each unique external import", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "main.ts"),
      "import path from 'node:path';\nimport { z } from 'zod';\nimport zod2 from 'zod';\nexport const x = 1;\n"
    );

    const scan = makeScan(root, [
      { path: "src/main.ts", ext: ".ts", size: 80, hash: "p1", kind: "code" }
    ]);

    const result = await buildGraph({ root, scan });
    const packageNodes = result.nodes.filter((n) => n.type === "package");
    const labels = packageNodes.map((n) => n.label).sort();
    expect(labels).toEqual(["node:path", "zod"]);

    const importsToZod = result.edges.filter(
      (e) => e.type === "imports" && e.to === "package:zod"
    );
    expect(importsToZod).toHaveLength(1);
  });
});

describe("Tier 4 — enrichment selection", () => {
  it("selects exported function/class symbols up to maxSymbols", () => {
    const targets = selectEnrichmentTargets(
      [
        { id: "file:a.ts", type: "file", label: "a.ts" },
        {
          id: "symbol:a.ts#One",
          type: "symbol",
          label: "One",
          kind: "class_declaration",
          exported: true
        },
        {
          id: "symbol:a.ts#two",
          type: "symbol",
          label: "two",
          kind: "function_declaration",
          exported: false
        },
        {
          id: "symbol:a.ts#Three",
          type: "symbol",
          label: "Three",
          kind: "function_declaration",
          exported: true
        }
      ],
      10
    );
    expect(targets.map((n) => n.label)).toEqual(["One", "Three"]);
  });

  it("respects maxSymbols cap", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `symbol:a.ts#F${i}`,
      type: "symbol" as const,
      label: `F${i}`,
      kind: "function_declaration",
      exported: true
    }));
    expect(selectEnrichmentTargets(nodes, 5)).toHaveLength(5);
  });
});

describe("Tier 4 — enrichGraphSymbols (mocked fetch)", () => {
  it("calls Anthropic API once per batch and merges entries", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                entries: [
                  {
                    id: "symbol:a.ts#Foo",
                    summary: "Does foo",
                    tags: ["util"],
                    complexity: "low"
                  }
                ]
              })
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await enrichGraphSymbols(
      [
        {
          id: "symbol:a.ts#Foo",
          type: "symbol",
          label: "Foo",
          kind: "class_declaration",
          exported: true
        }
      ],
      { apiKey: "sk-test", fetchImpl: fakeFetch }
    );
    expect(result.apiCalls).toBe(1);
    expect(result.entries["symbol:a.ts#Foo"]).toEqual({
      summary: "Does foo",
      tags: ["util"],
      complexity: "low"
    });
    expect(calls[0]?.url).toContain("api.anthropic.com");
  });

  it("throws when apiKey is missing", async () => {
    await expect(enrichGraphSymbols([], { apiKey: "" })).rejects.toThrow(
      /ANTHROPIC_API_KEY/
    );
  });
});
