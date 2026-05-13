import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  detectLanguageFromPath,
  parseFile,
  type HeritageRelation,
  type ImportStatement,
  type ParserCapture,
  type ParserLanguage
} from "../parser/treeSitter.js";
import { PARSER_VERSION } from "../parser/treeSitter.js";
import { SCHEMA_VERSIONS } from "../schema/versions.js";
import type { ScanFile, ScanResult } from "../scanner.js";
import {
  emptyCache,
  type FileParseFragment,
  type GraphCache
} from "./cache.js";
import {
  loadTsconfigPaths,
  resolveTsconfigAlias,
  type TsconfigPaths
} from "./tsconfigPaths.js";
import { runSemanticPass } from "./semantic/pass5.js";

export type SemanticNodeType =
  | "domain"
  | "layer"
  | "endpoint"
  | "flow"
  | "step"
  | "concept";

export type StructuralNodeType =
  | "file"
  | "symbol"
  | "folder"
  | "package"
  | "external-symbol";

export type NodeType = StructuralNodeType | SemanticNodeType;

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  path?: string;
  hash?: string;
  kind?: string;
  lang?: string;
  exported?: boolean;
  signature?: string;
  loc?: { startLine: number; endLine: number };
  summary?: string;
  tags?: string[];
  complexity?: "low" | "medium" | "high";
  // Semantic-layer fields (Pass 5, opt-in via --with-semantic). All optional;
  // populated only on nodes whose `type` belongs to SemanticNodeType.
  method?: string;
  framework?: string;
  domain?: string;
  entryFile?: string;
  stepCount?: number;
  order?: number;
  stepFile?: string;
  stepLayer?: string;
  headSymbol?: string;
  modularity?: number;
  files?: number;
  kinds?: Record<string, number>;
}

export type StructuralEdgeType =
  | "defines"
  | "imports"
  | "calls"
  | "references"
  | "tests"
  | "contains"
  | "extends"
  | "implements";

export type SemanticEdgeType =
  | "belongs_to_domain"
  | "in_layer"
  | "exposes_endpoint"
  | "implements_flow"
  | "flow_step"
  | "cross_domain";

export type EdgeType = StructuralEdgeType | SemanticEdgeType;

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  weight?: number;
}

export type ParserEngineLabel =
  | "web-tree-sitter"
  | "tree-sitter-native"
  | "heuristic"
  | "none";

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
    engine: ParserEngineLabel;
  };
  cacheUpdate: GraphCache;
  cacheStats: {
    reused: number;
    reparsed: number;
  };
  /**
   * True when Pass 5 (semantic enrichment) ran. Maps to the
   * `semanticEnabled` field on the persisted graph.json.
   */
  semanticEnabled: boolean;
  semanticStats?: {
    domainCount: number;
    layerCount: number;
    endpointCount: number;
    flowCount: number;
    conceptCount: number;
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
  implements: 0.9,
  // Semantic layer (Pass 5). cross_domain weight is variable: callers should
  // override based on import count between the two domains.
  belongs_to_domain: 1.0,
  in_layer: 0.7,
  exposes_endpoint: 1.2,
  implements_flow: 1.0,
  flow_step: 1.0,
  cross_domain: 0.5
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
  workspaceAliases: Map<string, string>,
  tsconfigPaths: TsconfigPaths | null
): string | null {
  const aliased = workspaceAliases.get(importSource);
  if (aliased) return aliased;

  if (!importSource.startsWith(".")) {
    if (tsconfigPaths) {
      const tsResolved = resolveTsconfigAlias(
        importSource,
        tsconfigPaths,
        allFiles
      );
      if (tsResolved) return tsResolved;
    }
    return null;
  }

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

function isExternalSpecifier(spec: string): boolean {
  // Skip relatives and bare paths that look like file paths.
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  // Strip subpath (e.g. "react/jsx-runtime" → "react").
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*/i.test(spec);
}

function externalPackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.slice(0, 2).join("/");
  }
  return spec.split("/")[0]!;
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

interface ParsedEntry {
  file: ScanFile;
  parsed: FileParseFragment;
  reusedFromCache: boolean;
}

function pLimit<T>(
  concurrency: number,
  tasks: Array<() => Promise<T>>
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  const limit = Math.max(1, concurrency);

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]!();
    }
  }

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  return Promise.all(workers).then(() => results);
}

function compareNodes(a: GraphNode, b: GraphNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareEdges(a: GraphEdge, b: GraphEdge): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
}

function deriveFolderNodes(filePaths: readonly string[]): {
  folders: GraphNode[];
  containsEdges: GraphEdge[];
} {
  const folderSet = new Set<string>();
  const containsEdges: GraphEdge[] = [];

  for (const filePath of filePaths) {
    const dir = path.posix.dirname(filePath.replace(/\\/g, "/"));
    if (dir === ".") continue;
    let current = dir;
    while (current && current !== "." && current !== "/") {
      folderSet.add(current);
      const parent = path.posix.dirname(current);
      if (parent && parent !== current && parent !== ".") {
        folderSet.add(parent);
      }
      current = parent;
    }
  }

  const folders: GraphNode[] = [];
  for (const folder of folderSet) {
    folders.push({
      id: `folder:${folder}`,
      type: "folder",
      label: path.posix.basename(folder),
      path: folder
    });

    const parent = path.posix.dirname(folder);
    if (
      parent &&
      parent !== folder &&
      parent !== "." &&
      folderSet.has(parent)
    ) {
      containsEdges.push({
        from: `folder:${parent}`,
        to: `folder:${folder}`,
        type: "contains"
      });
    }
  }

  for (const filePath of filePaths) {
    const normalized = filePath.replace(/\\/g, "/");
    const dir = path.posix.dirname(normalized);
    if (dir && dir !== "." && folderSet.has(dir)) {
      containsEdges.push({
        from: `folder:${dir}`,
        to: `file:${normalized}`,
        type: "contains"
      });
    }
  }

  return { folders, containsEdges };
}

export async function buildGraph(options: {
  root: string;
  scan: ScanResult;
  cache?: GraphCache | null;
  concurrency?: number;
  withCalls?: boolean;
  withRefs?: boolean;
  /**
   * Pass 5 — opt-in semantic enrichment. When true, appends
   * domain/layer/endpoint/flow/step nodes + edges. Default false to keep
   * structural output byte-stable for callers that haven't migrated.
   */
  withSemantic?: boolean;
  /**
   * Within Pass 5 — also run Louvain community detection per domain to
   * emit `concept` nodes. Requires `withSemantic: true`. Default false
   * because it adds work and only pays off on larger codebases.
   */
  withConcepts?: boolean;
  /** Reader override for endpoint extraction in tests. */
  semanticReadFile?: (absolutePath: string) => Promise<string>;
}): Promise<BuildGraphResult> {
  const { root, scan, cache } = options;
  const withCalls = options.withCalls ?? false;
  const withRefs = options.withRefs ?? false;
  const withSemantic = options.withSemantic ?? false;
  const withConcepts = options.withConcepts ?? false;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const allFilePaths = new Set(scan.files.map((f) => f.path));
  const workspaceAliases = await buildWorkspaceAliases(root, allFilePaths);
  const tsconfigPaths = await loadTsconfigPaths(root);
  const seenEdges = new Set<string>();
  const seenPackages = new Set<string>();
  const seenExternalSymbols = new Set<string>();

  function addEdge(edge: GraphEdge): void {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ ...edge, weight: edge.weight ?? EDGE_WEIGHTS[edge.type] });
  }

  // Pass 0: emit file nodes for every scanned file (deterministic, cheap).
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
  }

  // Pass 1: parse (or reuse from cache) all code/test files.
  const parseTargets = scan.files.filter(
    (f) => f.kind === "code" || f.kind === "test"
  );
  const concurrency = options.concurrency ?? Math.min(os.cpus().length || 4, 8);

  let reusedCount = 0;
  let reparsedCount = 0;

  const tasks: Array<() => Promise<ParsedEntry | null>> = parseTargets.map(
    (file) => async (): Promise<ParsedEntry | null> => {
      const cached = cache?.entries[file.path];
      if (cached && cached.hash === file.hash) {
        reusedCount++;
        return { file, parsed: cached.fragment, reusedFromCache: true };
      }

      const absolutePath = path.join(root, file.path);
      const parsed = await parseFile(absolutePath);
      if (!parsed.ok) return null;
      reparsedCount++;
      const fragment: FileParseFragment = {
        language: parsed.language,
        captures: parsed.captures,
        imports: parsed.imports,
        heritage: parsed.heritage,
        calls: parsed.calls,
        references: parsed.references
      };
      return { file, parsed: fragment, reusedFromCache: false };
    }
  );

  const taskResults = await pLimit(concurrency, tasks);
  const parsedEntries: ParsedEntry[] = taskResults.filter(
    (entry): entry is ParsedEntry => entry !== null
  );
  const parsedCount = parsedEntries.length;

  // Per-file resolved import map: file -> set of imported file paths.
  const importedFilesByFile = new Map<string, Set<string>>();

  // Pass 2: symbols + defines + imports + tests.
  for (const { file, parsed } of parsedEntries) {
    for (const capture of parsed.captures) {
      const symbolId = `symbol:${file.path}#${capture.name}`;
      const symbolNode: GraphNode = {
        id: symbolId,
        type: "symbol",
        label: capture.name,
        path: file.path,
        kind: capture.type,
        exported: capture.exported,
        loc: { startLine: capture.line, endLine: capture.line }
      };
      if (parsed.language) symbolNode.lang = parsed.language;
      nodes.push(symbolNode);

      addEdge({ from: `file:${file.path}`, to: symbolId, type: "defines" });
    }

    const importedSet = new Set<string>();
    for (const imp of parsed.imports) {
      const resolved = resolveImportPath(
        file.path,
        imp.source,
        allFilePaths,
        workspaceAliases,
        tsconfigPaths
      );
      if (resolved) {
        importedSet.add(resolved);
        addEdge({
          from: `file:${file.path}`,
          to: `file:${resolved}`,
          type: "imports"
        });
      } else if (isExternalSpecifier(imp.source)) {
        const pkgName = externalPackageName(imp.source);
        const pkgId = `package:${pkgName}`;
        if (!seenPackages.has(pkgName)) {
          seenPackages.add(pkgName);
          nodes.push({
            id: pkgId,
            type: "package",
            label: pkgName,
            kind: "external"
          });
        }
        addEdge({
          from: `file:${file.path}`,
          to: pkgId,
          type: "imports"
        });

        // Surface named/default specifiers as external-symbol nodes so the
        // LLM can see *which* exports of the library are actually used.
        // Namespace imports (`* as ns`) are intentionally skipped — they
        // already collapse to the whole package.
        for (const spec of imp.specifiers ?? []) {
          if (spec.kind === "namespace") continue;
          const exportedName =
            spec.kind === "default" ? "default" : (spec.imported ?? spec.name);
          const symbolId = `external-symbol:${pkgName}#${exportedName}`;
          if (!seenExternalSymbols.has(symbolId)) {
            seenExternalSymbols.add(symbolId);
            nodes.push({
              id: symbolId,
              type: "external-symbol",
              label: exportedName,
              kind: spec.kind,
              path: pkgName
            });
          }
          addEdge({
            from: `file:${file.path}`,
            to: symbolId,
            type: "imports"
          });
        }
      }
    }
    importedFilesByFile.set(file.path, importedSet);

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

  // Pass 3: heritage (extends/implements). Resolve parent within own file or
  // via an imported file that exposes a matching symbol.
  const symbolsByFile = new Map<string, Set<string>>();
  for (const { file, parsed } of parsedEntries) {
    symbolsByFile.set(file.path, new Set(parsed.captures.map((c) => c.name)));
  }

  for (const { file, parsed } of parsedEntries) {
    for (const heritage of parsed.heritage) {
      const fromId = `symbol:${file.path}#${heritage.childName}`;
      let resolvedTarget: string | null = null;

      const ownSymbols = symbolsByFile.get(file.path);
      if (ownSymbols?.has(heritage.parentName)) {
        resolvedTarget = `symbol:${file.path}#${heritage.parentName}`;
      } else {
        const importedSet = importedFilesByFile.get(file.path);
        if (importedSet) {
          for (const importedFile of importedSet) {
            const importedSymbols = symbolsByFile.get(importedFile);
            if (importedSymbols?.has(heritage.parentName)) {
              resolvedTarget = `symbol:${importedFile}#${heritage.parentName}`;
              break;
            }
          }
        }
      }

      if (resolvedTarget) {
        addEdge({ from: fromId, to: resolvedTarget, type: heritage.kind });
      }
    }
  }

  // Pass 3.5 (opt-in): calls. Resolve identifiers used as `name(` first to a
  // local symbol, then to a symbol exposed by an imported file. Quality is
  // best-effort because the parser is regex-based — see --with-calls flag.
  if (withCalls) {
    for (const { file, parsed } of parsedEntries) {
      const ownSymbols = symbolsByFile.get(file.path);
      const importedSet = importedFilesByFile.get(file.path);
      for (const call of parsed.calls) {
        let resolvedTarget: string | null = null;
        if (ownSymbols?.has(call.name)) {
          resolvedTarget = `symbol:${file.path}#${call.name}`;
        } else if (importedSet) {
          for (const importedFile of importedSet) {
            const importedSymbols = symbolsByFile.get(importedFile);
            if (importedSymbols?.has(call.name)) {
              resolvedTarget = `symbol:${importedFile}#${call.name}`;
              break;
            }
          }
        }
        if (resolvedTarget) {
          addEdge({
            from: `file:${file.path}`,
            to: resolvedTarget,
            type: "calls"
          });
        }
      }
    }
  }

  // Pass 3.6 (opt-in): references. PascalCase identifiers used outside of
  // imports/definitions that resolve to a known symbol. Skip names already
  // covered by `calls`/`extends`/`implements` from this file to avoid noise.
  if (withRefs) {
    for (const { file, parsed } of parsedEntries) {
      const ownSymbols = symbolsByFile.get(file.path);
      const importedSet = importedFilesByFile.get(file.path);
      const handledNames = new Set<string>();
      for (const c of parsed.calls) handledNames.add(c.name);
      for (const h of parsed.heritage) handledNames.add(h.parentName);

      for (const ref of parsed.references) {
        if (handledNames.has(ref.name)) continue;
        let resolvedTarget: string | null = null;
        if (ownSymbols?.has(ref.name)) {
          resolvedTarget = `symbol:${file.path}#${ref.name}`;
        } else if (importedSet) {
          for (const importedFile of importedSet) {
            const importedSymbols = symbolsByFile.get(importedFile);
            if (importedSymbols?.has(ref.name)) {
              resolvedTarget = `symbol:${importedFile}#${ref.name}`;
              break;
            }
          }
        }
        if (resolvedTarget) {
          addEdge({
            from: `file:${file.path}`,
            to: resolvedTarget,
            type: "references"
          });
        }
      }
    }
  }

  // Pass 4: folder nodes + contains edges (synthetic, derived from paths).
  const { folders, containsEdges } = deriveFolderNodes(
    scan.files.map((f) => f.path)
  );
  for (const folder of folders) nodes.push(folder);
  for (const edge of containsEdges) addEdge(edge);

  // Pass 5 (opt-in): semantic enrichment. Adds domain/layer/endpoint/flow/step
  // nodes plus their connecting edges. Reuses importedFilesByFile for flow
  // detection so we don't re-walk imports.
  let semanticStats: BuildGraphResult["semanticStats"];
  if (withSemantic) {
    const semantic = await runSemanticPass({
      root,
      scanFiles: scan.files,
      importedFilesByFile,
      readFile: options.semanticReadFile,
      withConcepts
    });
    for (const node of semantic.nodes) nodes.push(node);
    for (const edge of semantic.edges) addEdge(edge);
    semanticStats = semantic.stats;
  }

  // Stable ordering — guarantees byte-identical output across runs even
  // though parsing happened in parallel.
  nodes.sort(compareNodes);
  edges.sort(compareEdges);

  const nodesByType: Record<string, number> = {};
  for (const n of nodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
  }
  const edgesByType: Record<string, number> = {};
  for (const e of edges) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1;
  }

  // Build the cache snapshot for this run from every parsed entry (reused
  // entries roundtrip unchanged; reparsed entries write fresh fragments).
  const cacheUpdate: GraphCache = emptyCache();
  for (const entry of parsedEntries) {
    cacheUpdate.entries[entry.file.path] = {
      hash: entry.file.hash,
      fragment: entry.parsed
    };
  }
  cacheUpdate.schemaVersion = SCHEMA_VERSIONS.graph;
  cacheUpdate.parserVersion = PARSER_VERSION;

  return {
    nodes,
    edges,
    stats: {
      nodesTotal: nodes.length,
      edgesTotal: edges.length,
      nodesByType,
      edgesByType
    },
    parser: { engine: parsedCount > 0 ? "heuristic" : "none" },
    cacheUpdate,
    cacheStats: {
      reused: reusedCount,
      reparsed: reparsedCount
    },
    semanticEnabled: withSemantic,
    ...(semanticStats ? { semanticStats } : {})
  };
}
