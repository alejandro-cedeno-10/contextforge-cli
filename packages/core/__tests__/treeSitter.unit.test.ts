import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectLanguageFromPath,
  parseFile,
  type ParserEngine,
  type ParserLanguage
} from "../src/parser/treeSitter";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-parser-"));
  workspaces.push(dir);
  return dir;
}

describe("detectLanguageFromPath", () => {
  it("maps known extensions deterministically", () => {
    expect(detectLanguageFromPath("a.ts")).toBe("typescript");
    expect(detectLanguageFromPath("a.tsx")).toBe("tsx");
    expect(detectLanguageFromPath("a.js")).toBe("javascript");
    expect(detectLanguageFromPath("a.jsx")).toBe("jsx");
    expect(detectLanguageFromPath("a.py")).toBe("python");
    expect(detectLanguageFromPath("a.go")).toBe("go");
    expect(detectLanguageFromPath("a.rs")).toBe("rust");
    expect(detectLanguageFromPath("A.JAVA")).toBe("java");
    expect(detectLanguageFromPath("component.test.ts")).toBe("typescript");
  });

  it("returns null for unsupported file names", () => {
    expect(detectLanguageFromPath("README")).toBeNull();
    expect(detectLanguageFromPath("file.unknown")).toBeNull();
  });
});

describe("parseFile", () => {
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(
      workspaces.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    workspaces.length = 0;
  });

  it("uses deterministic heuristic captures when no engine is provided", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "index.ts");
    await writeFile(filePath, "export function buildGraph() { return 1; }\n");

    const result = await parseFile(filePath);

    expect(result.ok).toBe(true);
    expect(result.language).toBe("typescript");
    expect(result.ast).toMatchObject({ engine: "heuristic" });
    expect(result.captures).toEqual([
      { type: "function_declaration", name: "buildGraph", line: 1 }
    ]);
  });

  it("extracts multiple symbol types in heuristic mode", async () => {
    const root = await newWorkspace();
    const filePath = path.join(root, "module.ts");
    await writeFile(
      filePath,
      [
        "export class Scanner {}",
        "export interface ScanOptions {}",
        "export type ScanKind = string;",
        "export const DEFAULT_DEPTH = 3;",
        "export enum Status { OK }",
        "export function scan() {}"
      ].join("\n")
    );

    const result = await parseFile(filePath);

    expect(result.ok).toBe(true);
    const names = result.captures.map((c) => c.name);
    expect(names).toContain("Scanner");
    expect(names).toContain("ScanOptions");
    expect(names).toContain("ScanKind");
    expect(names).toContain("DEFAULT_DEPTH");
    expect(names).toContain("Status");
    expect(names).toContain("scan");
  });

  it("extracts python class captures in heuristic mode", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "agent.py");
    await writeFile(filePath, "class Agent:\n    pass\n");

    const result = await parseFile(filePath);

    expect(result.ok).toBe(true);
    expect(result.language).toBe("python");
    expect(result.captures).toEqual([
      { type: "class_definition", name: "Agent", line: 1 }
    ]);
  });

  it("extracts single-line TypeScript imports", async () => {
    const root = await newWorkspace();
    const filePath = path.join(root, "a.ts");
    await writeFile(
      filePath,
      [
        "import { foo } from './b';",
        "import type { Bar } from './c';",
        "import './side-effect';",
        "export function doWork() {}"
      ].join("\n")
    );

    const result = await parseFile(filePath);

    expect(result.ok).toBe(true);
    expect(result.imports.map((i) => i.source)).toEqual([
      "./b",
      "./c",
      "./side-effect"
    ]);
  });

  it("extracts multi-line TypeScript imports", async () => {
    const root = await newWorkspace();
    const filePath = path.join(root, "a.ts");
    await writeFile(
      filePath,
      [
        "import {",
        "  foo,",
        "  bar",
        "} from './utils';",
        "export const x = 1;"
      ].join("\n")
    );

    const result = await parseFile(filePath);

    expect(result.ok).toBe(true);
    expect(result.imports.some((i) => i.source === "./utils")).toBe(true);
  });

  it("returns empty imports for unsupported language", async () => {
    const root = await newWorkspace();
    const filePath = path.join(root, "README");
    await writeFile(filePath, "hello\n");

    const result = await parseFile(filePath);

    expect(result.ok).toBe(false);
    expect(result.imports).toEqual([]);
  });

  it("returns graceful fallback for unsupported language", async () => {
    const root = await newWorkspace();
    const filePath = path.join(root, "README");
    await writeFile(filePath, "hello\n");

    const result = await parseFile(filePath);

    expect(result.ok).toBe(false);
    expect(result.language).toBeNull();
    expect(result.fallbackReason).toBe("unsupported_language");
  });

  it("returns graceful fallback when grammar is unavailable", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "index.ts");
    await writeFile(filePath, "export function x() {}\n");

    const failingEngine: ParserEngine = {
      async loadGrammar(): Promise<void> {
        throw new Error("missing grammar");
      },
      async parse(): Promise<Record<string, unknown>> {
        return { shouldNotReach: true };
      },
      capture(): [] {
        return [];
      }
    };

    const result = await parseFile(filePath, { engine: failingEngine });

    expect(result.ok).toBe(false);
    expect(result.language).toBe("typescript");
    expect(result.fallbackReason).toBe("grammar_unavailable");
    expect(result.imports).toEqual([]);
  });

  it("returns ast and captures from provided engine", async () => {
    const root = await newWorkspace();
    await mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "worker.py");
    await writeFile(filePath, "class Worker:\n    pass\n");

    const engine: ParserEngine = {
      async loadGrammar(language: ParserLanguage): Promise<void> {
        expect(language).toBe("python");
      },
      async parse(source: string): Promise<Record<string, unknown>> {
        return { type: "fake-ast", length: source.length };
      },
      capture(): Array<{ type: string; name: string; line: number }> {
        return [{ type: "class_definition", name: "Worker", line: 1 }];
      }
    };

    const result = await parseFile(filePath, { engine });

    expect(result.ok).toBe(true);
    expect(result.language).toBe("python");
    expect(result.ast).toMatchObject({ type: "fake-ast" });
    expect(result.captures).toEqual([
      { type: "class_definition", name: "Worker", line: 1 }
    ]);
    expect(result.imports).toEqual([]);
  });
});
