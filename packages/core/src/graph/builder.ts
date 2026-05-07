import { promises as fs } from "node:fs";
import path from "node:path";

import { detectLanguageFromPath, parseFile } from "../parser/treeSitter.js";
import type { ScanResult } from "../scanner.js";

export interface GraphNode {
  id: string;
  type: "file" | "symbol" | "folder" | "package";
  label: string;
  path?: string;
  hash?: string;
  kind?: string;
  lang?: string;
  exported?: boolean;
  signature?: string;
  loc?: { startLine: number; endLine: number };
}

export type EdgeType =
  | "defines"
  | "imports"
  | "calls"
  | "references"
  | "tests"
  | "contains"
  | "extends"
  | "implements";

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  weight?: number;
}

export interface BuildGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodesTotal: number;
    edgesTotal: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
  };
  parser: {
    engine: "web-tree-sitter" | "tree-sitter-native" | "heuristic" | "none";
  };
}

const EDGE_WEIGHTS: Record<EdgeType, number> = {
  defines: 1.0,
  imports: 0.8,
  calls: 1.0,
  references: 0.6,
  tests: 1.2,
  contains: 0.5,
  extends: 0.9,
  implements: 0.9
};

async function buildWorkspaceAliases(
  root: string,
  allFiles: ReadonlySet<string>
): Promise<Map<string, string>> {
  const aliases = new Map<string, string>();
  try {
    const pkgDir = path.join(root, "packages");
    const entries = await fs.readdir(pkgDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(
          path.join(pkgDir, entry.name, "package.json"),
          "utf8"
        );
        const pkg = JSON.parse(raw) as { name?: string };
        if (!pkg.name) continue;
        for (const candidate of [
          `packages/${entry.name}/src/index.ts`,
          `packages/${entry.name}/src/index.js`,
          `packages/${entry.name}/index.ts`,
          `packages/${entry.name}/index.js`
        ]) {
          if (allFiles.has(candidate)) {
            aliases.set(pkg.name, candidate);
            break;
          }
        }
      } catch {
        // no package.json or not parseable
      }
    }
  } catch {
    // no packages/ directory
  }
  return aliases;
}

function resolveImportPath(
  fromFile: string,
  importSource: string,
  allFiles: ReadonlySet<string>,
  workspaceAliases: Map<string, string>
): string | null {
  // Workspace package alias (e.g. @alejandro-cedeno-10/contextforge-core)
  const aliased = workspaceAliases.get(importSource);
  if (aliased) return aliased;

  if (!importSource.startsWith(".")) return null;

  const fromDir = path.dirname(fromFile);
  const joined = path.join(fromDir, importSource).replace(/\\/g, "/");

  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}/index.ts`,
    `${joined}/index.js`
  ];

  for (const candidate of candidates) {
    const normalized = candidate.replace(/^\/+/, "");
    if (allFiles.has(normalized)) return normalized;
  }

  return null;
}

function inferImplPath(
  testFile: string,
  allFiles: ReadonlySet<string>
): string | null {
  const withoutTest = testFile
    .replace(/\.test\.(ts|tsx|js|jsx)$/, ".$1")
    .replace(/\.spec\.(ts|tsx|js|jsx)$/, ".$1");

  if (withoutTest !== testFile && allFiles.has(withoutTest)) {
    return withoutTest;
  }
  return null;
}

export async function buildGraph(options: {
  root: string;
  scan: ScanResult;
}): Promise<BuildGraphResult> {
  const { root, scan } = options;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const allFilePaths = new Set(scan.files.map((f) => f.path));
  const workspaceAliases = await buildWorkspaceAliases(root, allFilePaths);
  const seenEdges = new Set<string>();

  function addEdge(edge: GraphEdge): void {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ ...edge, weight: edge.weight ?? EDGE_WEIGHTS[edge.type] });
  }

  for (const file of scan.files) {
    const lang = detectLanguageFromPath(file.path);

    const fileNode: GraphNode = {
      id: `file:${file.path}`,
      type: "file",
      label: path.basename(file.path),
      path: file.path,
      hash: file.hash,
      kind: file.kind
    };
    if (lang) fileNode.lang = lang;
    nodes.push(fileNode);

    if (file.kind !== "code" && file.kind !== "test") continue;

    const absolutePath = path.join(root, file.path);
    const parsed = await parseFile(absolutePath);

    if (!parsed.ok) continue;

    for (const capture of parsed.captures) {
      const symbolId = `symbol:${file.path}#${capture.name}`;
      const symbolNode: GraphNode = {
        id: symbolId,
        type: "symbol",
        label: capture.name,
        path: file.path,
        kind: capture.type,
        exported: true,
        loc: { startLine: capture.line, endLine: capture.line }
      };
      if (parsed.language) symbolNode.lang = parsed.language;
      nodes.push(symbolNode);

      addEdge({ from: `file:${file.path}`, to: symbolId, type: "defines" });
    }

    for (const imp of parsed.imports) {
      const resolved = resolveImportPath(file.path, imp.source, allFilePaths, workspaceAliases);
      if (resolved) {
        addEdge({
          from: `file:${file.path}`,
          to: `file:${resolved}`,
          type: "imports"
        });
      }
    }

    if (file.kind === "test") {
      const impl = inferImplPath(file.path, allFilePaths);
      if (impl) {
        addEdge({
          from: `file:${file.path}`,
          to: `file:${impl}`,
          type: "tests"
        });
      }
    }
  }

  const nodesByType: Record<string, number> = {};
  for (const n of nodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
  }
  const edgesByType: Record<string, number> = {};
  for (const e of edges) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1;
  }

  return {
    nodes,
    edges,
    stats: {
      nodesTotal: nodes.length,
      edgesTotal: edges.length,
      nodesByType,
      edgesByType
    },
    parser: { engine: "heuristic" }
  };
}
