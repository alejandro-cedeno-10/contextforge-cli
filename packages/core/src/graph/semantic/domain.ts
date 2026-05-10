import path from "node:path";

import type { ScanFile } from "../../scanner.js";

/**
 * Domain detection rules (deterministic, no LLM).
 *
 * Priority order — first match wins:
 *   1. Monorepo packages: `packages/<name>/...` -> domain = `<name>`.
 *   2. NestJS feature modules: any folder containing `*.module.ts` -> domain
 *      = folder name. Files inside the folder inherit it.
 *   3. Django/FastAPI apps: `apps/<name>/...` or `src/<name>/...` when the
 *      folder contains `models.py`, `router.py`, or `__init__.py`.
 *   4. Frontend feature folders: `features/<name>/...` (any depth) ->
 *      domain = `<name>`.
 *   5. Next.js app router: `.../app/<name>/...` (skipping `(group)` folders)
 *      -> domain = `<name>` when `<name>` is the first non-group segment.
 *   6. Fallback: first significant path segment (after stripping `src/`).
 *
 * Files inside excluded shared folders (see `SHARED_FOLDERS`) are mapped to
 * `domain:shared` rather than producing a per-folder domain. They still get a
 * `belongs_to_domain` edge — the caller can choose to render them or skip.
 */

export interface DomainAssignment {
  /** posix-normalised file path (matches scan.files[].path). */
  file: string;
  /** kebab-case slug used as `domain:<slug>` node id. */
  domain: string;
}

export interface DomainDetectionResult {
  assignments: DomainAssignment[];
  /** Distinct domains discovered, in deterministic (sorted) order. */
  domains: string[];
}

const SHARED_FOLDERS = new Set([
  "shared",
  "core",
  "common",
  "lib",
  "utils",
  "helpers",
  "internal",
  "vendor",
  "node_modules"
]);

const FRAMEWORK_APP_MARKERS = new Set([
  "models.py",
  "router.py",
  "routers.py",
  "__init__.py"
]);

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

/**
 * Find folders that look like NestJS feature modules: any directory that
 * contains a file matching `*.module.ts` (excluding `*.module.spec.ts`).
 * Returns posix folder paths.
 */
function findNestModuleFolders(files: readonly ScanFile[]): Set<string> {
  const folders = new Set<string>();
  for (const f of files) {
    const p = toPosix(f.path);
    const base = path.posix.basename(p);
    if (!base.endsWith(".module.ts") || base.endsWith(".spec.ts")) continue;
    folders.add(path.posix.dirname(p));
  }
  return folders;
}

/**
 * Find Python app folders: `apps/<name>/...` or `src/<name>/...` containing
 * `models.py`, `router.py`, `routers.py`, or `__init__.py`. Returns posix
 * `<prefix>/<name>` paths.
 */
function findPythonAppFolders(files: readonly ScanFile[]): Set<string> {
  const candidates = new Map<string, Set<string>>();
  for (const f of files) {
    const p = toPosix(f.path);
    const parts = p.split("/");
    if (parts.length < 3) continue;
    const prefix = parts[0];
    if (prefix !== "apps" && prefix !== "src") continue;
    const folderKey = `${parts[0]}/${parts[1]}`;
    if (!candidates.has(folderKey)) candidates.set(folderKey, new Set());
    candidates.get(folderKey)!.add(path.posix.basename(p));
  }
  const result = new Set<string>();
  for (const [folder, basenames] of candidates) {
    for (const marker of FRAMEWORK_APP_MARKERS) {
      if (basenames.has(marker)) {
        result.add(folder);
        break;
      }
    }
  }
  return result;
}

/**
 * Resolve the workspace package (under `packages/<name>`) that owns a file.
 * Returns the package slug or null if the file is not inside a package.
 */
function packageOf(filePosix: string): string | null {
  const parts = filePosix.split("/");
  if (parts[0] === "packages" && parts.length >= 2 && parts[1]) {
    return slugify(parts[1]);
  }
  return null;
}

function fallbackDomain(filePosix: string): string {
  const parts = filePosix.split("/");
  // Strip a leading `src/` so `src/auth/...` becomes domain `auth`, not `src`.
  if (parts[0] === "src" && parts.length >= 2 && parts[1]) {
    return SHARED_FOLDERS.has(parts[1]) ? "shared" : slugify(parts[1]);
  }
  if (parts[0] && SHARED_FOLDERS.has(parts[0])) return "shared";
  return slugify(parts[0] ?? "root");
}

export function detectDomains(
  files: readonly ScanFile[]
): DomainDetectionResult {
  const nestModuleFolders = findNestModuleFolders(files);
  const pythonAppFolders = findPythonAppFolders(files);

  const assignments: DomainAssignment[] = [];

  for (const f of files) {
    if (f.kind !== "code" && f.kind !== "test") continue;
    const filePosix = toPosix(f.path);

    let domain: string | null = null;

    // Rule 1 — monorepo packages.
    const pkg = packageOf(filePosix);
    if (pkg) domain = pkg;

    // Rule 2 — NestJS module folders. We walk parents from the file's dir
    // upward so that a file deep inside `users/services/foo.ts` still
    // attaches to `users` when `users/users.module.ts` exists.
    if (!domain) {
      let dir = path.posix.dirname(filePosix);
      while (dir && dir !== "." && dir !== "/") {
        if (nestModuleFolders.has(dir)) {
          const folderName = path.posix.basename(dir);
          domain = SHARED_FOLDERS.has(folderName)
            ? "shared"
            : slugify(folderName);
          break;
        }
        const parent = path.posix.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }

    // Rule 3 — Python apps under apps/ or src/.
    if (!domain) {
      const parts = filePosix.split("/");
      if (parts.length >= 2) {
        const folderKey = `${parts[0]}/${parts[1]}`;
        if (pythonAppFolders.has(folderKey)) {
          domain = SHARED_FOLDERS.has(parts[1]!)
            ? "shared"
            : slugify(parts[1]!);
        }
      }
    }

    // Rule 4 — `features/<name>` folders (any depth).
    if (!domain) {
      const parts = filePosix.split("/");
      const featuresIdx = parts.indexOf("features");
      if (featuresIdx >= 0 && parts.length > featuresIdx + 1) {
        const candidate = parts[featuresIdx + 1]!;
        if (!SHARED_FOLDERS.has(candidate)) domain = slugify(candidate);
      }
    }

    // Rule 5 — Next.js App Router: first non-group segment under `app/`.
    if (!domain) {
      const parts = filePosix.split("/");
      const appIdx = parts.indexOf("app");
      if (appIdx >= 0) {
        // Skip route-group folders like `(marketing)`.
        for (let i = appIdx + 1; i < parts.length - 1; i++) {
          const seg = parts[i]!;
          if (/^\(.+\)$/.test(seg)) continue;
          if (SHARED_FOLDERS.has(seg)) {
            domain = "shared";
            break;
          }
          domain = slugify(seg);
          break;
        }
      }
    }

    // Rule 6 — fallback by leading folder.
    if (!domain) domain = fallbackDomain(filePosix);

    assignments.push({ file: f.path, domain });
  }

  const distinct = new Set<string>();
  for (const a of assignments) distinct.add(a.domain);

  return {
    assignments,
    domains: [...distinct].sort()
  };
}
