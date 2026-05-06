import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ScanFile {
  path: string;
  ext: string;
  size: number;
  hash: string;
  kind: "code" | "config" | "doc" | "asset" | "unknown";
}

export interface ScanResult {
  schemaVersion: string;
  root: string;
  generatedAt: string;
  files: ScanFile[];
}

const DEFAULT_IGNORES = [
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".contextforge"
];

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function sha256FromFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function classifyFile(filePath: string): ScanFile["kind"] {
  const ext = path.extname(filePath).toLowerCase();

  if (
    [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"].includes(ext)
  ) {
    return "code";
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
  return ignoreRules.some((rule) => {
    const normalizedRule = normalizePath(rule).replace(/\/+$/, "");
    const isWildcard = normalizedRule.endsWith("*");

    if (isWildcard) {
      const prefix = normalizedRule.slice(0, -1);
      return relativePath.startsWith(prefix);
    }

    return (
      relativePath === normalizedRule ||
      relativePath.startsWith(`${normalizedRule}/`)
    );
  });
}

async function walkDir(
  root: string,
  currentDir: string,
  ignoreRules: string[],
  files: ScanFile[]
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.relative(root, absolutePath));

    if (isIgnored(relativePath, ignoreRules)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(root, absolutePath, ignoreRules, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const content = await fs.readFile(absolutePath);
    files.push({
      path: relativePath,
      ext: path.extname(relativePath).toLowerCase(),
      size: content.byteLength,
      hash: await sha256FromFile(absolutePath),
      kind: classifyFile(relativePath)
    });
  }
}

export async function scanProject(rootDir: string): Promise<ScanResult> {
  const root = path.resolve(rootDir);
  const files: ScanFile[] = [];
  const ignoreRules = await readForgeIgnore(root);

  await walkDir(root, root, ignoreRules, files);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: "0.1.0",
    root: normalizePath(root),
    generatedAt: new Date().toISOString(),
    files
  };
}
