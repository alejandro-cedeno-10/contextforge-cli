import { promises as fs } from "node:fs";
import path from "node:path";

export interface ScanCacheEntry {
  hash: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  kind: "code" | "config" | "doc" | "asset" | "test" | "schema" | "unknown";
  ext: string;
}

export interface ScanCacheShape {
  files: Record<string, ScanCacheEntry>;
}

function createEmptyCache(): ScanCacheShape {
  return { files: {} };
}

function cacheFilePath(root: string): string {
  return path.join(root, ".contextforge", "cache", "scan-cache.json");
}

export async function loadScanCache(root: string): Promise<ScanCacheShape> {
  const filePath = cacheFilePath(root);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as ScanCacheShape;
    if (!parsed.files || typeof parsed.files !== "object") {
      return createEmptyCache();
    }
    return { files: { ...parsed.files } };
  } catch {
    return createEmptyCache();
  }
}

export async function saveScanCache(
  root: string,
  cache: ScanCacheShape
): Promise<void> {
  const filePath = cacheFilePath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function isCacheHit(
  entry: ScanCacheEntry | undefined,
  stat: { size: number; mtimeMs: number; ctimeMs: number }
): boolean {
  if (!entry) {
    return false;
  }

  return (
    entry.size === stat.size &&
    entry.mtimeMs === stat.mtimeMs &&
    entry.ctimeMs === stat.ctimeMs
  );
}

export function upsertCacheEntry(
  cache: ScanCacheShape,
  relativePath: string,
  entry: ScanCacheEntry
): void {
  cache.files[relativePath] = entry;
}
