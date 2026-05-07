import { promises as fs } from "node:fs";
import path from "node:path";

import {
  isCacheHit,
  loadScanCache,
  saveScanCache,
  upsertCacheEntry
} from "./cache/scanCache.js";
import { blake3HexFromFile } from "./hash.js";
import { SCHEMA_VERSIONS } from "./schema/versions.js";

export interface ScanFile {
  path: string;
  ext: string;
  size: number;
  hash: string;
  kind: "code" | "config" | "doc" | "asset" | "test" | "schema" | "unknown";
}

export interface ScanResult {
  schemaVersion: string;
  root: string;
  generatedAt: string;
  hashAlgorithm: "blake3" | "sha256";
  files: ScanFile[];
}

const DEFAULT_IGNORES = [
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".contextforge",
  ".opencode"
];

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function classifyFile(filePath: string): ScanFile["kind"] {
  const ext = path.extname(filePath).toLowerCase();

  if (filePath.includes(".test.") || filePath.includes(".spec.")) {
    return "test" as ScanFile["kind"];
  }
  if (
    [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"].includes(ext)
  ) {
    return "code";
  }
  if ([".schema.json"].some((suffix) => filePath.endsWith(suffix))) {
    return "schema" as ScanFile["kind"];
  }
  if ([".json", ".yaml", ".yml", ".toml", ".env", ".ini"].includes(ext)) {
    return "config";
  }
  if ([".md", ".mdx", ".txt", ".rst"].includes(ext)) {
    return "doc";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".pdf"].includes(ext)) {
    return "asset";
  }

  return "unknown";
}

async function readForgeIgnore(root: string): Promise<string[]> {
  const ignorePath = path.join(root, ".forgeignore");

  try {
    const content = await fs.readFile(ignorePath, "utf8");
    const rules = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    return [...DEFAULT_IGNORES, ...rules];
  } catch {
    return DEFAULT_IGNORES;
  }
}

function isIgnored(relativePath: string, ignoreRules: string[]): boolean {
  const segments = relativePath.split("/");
  return ignoreRules.some((rule) => {
    const normalizedRule = normalizePath(rule).replace(/\/+$/, "");
    const isWildcard = normalizedRule.endsWith("*");

    if (isWildcard) {
      const prefix = normalizedRule.slice(0, -1);
      return relativePath.startsWith(prefix);
    }

    // Exact match or direct prefix (root-level rule)
    if (
      relativePath === normalizedRule ||
      relativePath.startsWith(`${normalizedRule}/`)
    ) {
      return true;
    }

    // Any path segment matches the rule (e.g. node_modules inside .opencode/)
    if (!normalizedRule.includes("/")) {
      return segments.includes(normalizedRule);
    }

    return false;
  });
}

async function walkDir(
  root: string,
  currentDir: string,
  ignoreRules: string[],
  files: ScanFile[],
  cache: Awaited<ReturnType<typeof loadScanCache>>,
  seenPaths: Set<string>
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.relative(root, absolutePath));

    if (isIgnored(relativePath, ignoreRules)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(root, absolutePath, ignoreRules, files, cache, seenPaths);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    const cached = cache.files[relativePath];
    seenPaths.add(relativePath);

    if (isCacheHit(cached, stat)) {
      files.push({
        path: relativePath,
        ext: cached.ext,
        size: cached.size,
        hash: cached.hash,
        kind: cached.kind
      });
      continue;
    }

    const kind = classifyFile(relativePath);
    const ext = path.extname(relativePath).toLowerCase();
    const hash = await blake3HexFromFile(absolutePath);

    files.push({
      path: relativePath,
      ext,
      size: stat.size,
      hash,
      kind
    });

    upsertCacheEntry(cache, relativePath, {
      hash,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      kind,
      ext
    });
  }
}

export async function scanProject(rootDir: string): Promise<ScanResult> {
  const root = path.resolve(rootDir);
  const files: ScanFile[] = [];
  const ignoreRules = await readForgeIgnore(root);
  const cache = await loadScanCache(root);
  const seenPaths = new Set<string>();

  await walkDir(root, root, ignoreRules, files, cache, seenPaths);
  for (const cachedPath of Object.keys(cache.files)) {
    if (!seenPaths.has(cachedPath)) {
      delete cache.files[cachedPath];
    }
  }
  await saveScanCache(root, cache);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: SCHEMA_VERSIONS.scan,
    root: normalizePath(root),
    generatedAt: new Date().toISOString(),
    hashAlgorithm: "blake3",
    files
  };
}
