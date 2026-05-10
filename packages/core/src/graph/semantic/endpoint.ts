import { promises as fs } from "node:fs";
import path from "node:path";

import type { ScanFile } from "../../scanner.js";

/**
 * Endpoint detection (deterministic, content-driven).
 *
 * Reads source for files that look likely to expose endpoints:
 *   - basenames `*.controller.ts/js`, `*.router.ts/js`, `*.routes.ts/js`,
 *     `routes.py`, `router.py`, `app.py`, `main.py`
 *   - files inside a `routes/` or `controllers/` segment
 *   - files inside `commands/` (CLI via commander/yargs)
 *
 * Then applies framework-specific regexes. Each regex is anchored enough to
 * avoid catching identifiers in comments most of the time. False positives are
 * acceptable at this layer — Pass 5 emits the endpoint regardless and the
 * caller (`forge_neighbors`, agent prompt) can reason about them.
 *
 * Phase 2 covers backend frameworks. Frontend (Next.js file-based routing)
 * lands in phase 3.
 */

export interface EndpointHit {
  /** posix-normalised file path that declares the endpoint. */
  file: string;
  method: string;
  /** Route path (HTTP) or CLI verb. */
  path: string;
  framework: "nest" | "express" | "fastapi" | "commander" | "yargs";
}

export interface EndpointDetectionResult {
  endpoints: EndpointHit[];
}

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options"
];

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isLikelyEndpointFile(filePosix: string): boolean {
  const base = path.posix.basename(filePosix);
  const segments = filePosix.split("/");
  if (
    /\.(controller|router|routes)\.(ts|js)$/.test(base) ||
    /^(routes|router|app|main)\.py$/.test(base)
  ) {
    return true;
  }
  if (segments.includes("routes") || segments.includes("controllers")) {
    return true;
  }
  if (segments.includes("commands")) return true;
  return false;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#")
  );
}

/**
 * NestJS: `@Controller('users')` on a class plus `@Get('id')` on methods.
 * We track the most recent `@Controller(...)` prefix in source order; method
 * decorators concatenate it with their own path arg.
 *
 * This is intentionally a regex pass, not full AST. A future iteration may
 * upgrade to ts-morph for higher fidelity, but the regex covers the >90%
 * case (single-controller files, literal route strings).
 */
function extractNestEndpoints(content: string, file: string): EndpointHit[] {
  const hits: EndpointHit[] = [];
  let currentPrefix = "";
  const lines = content.split(/\r?\n/);
  const controllerRe = /^\s*@Controller\(\s*(?:['"]([^'"]*)['"])?\s*\)/;
  const methodRe = new RegExp(
    `^\\s*@(${HTTP_METHODS.map((m) => m[0]!.toUpperCase() + m.slice(1)).join("|")})\\(\\s*(?:['"]([^'"]*)['"])?\\s*\\)`
  );

  for (const line of lines) {
    if (isCommentLine(line)) continue;
    const ctrl = controllerRe.exec(line);
    if (ctrl) {
      currentPrefix = (ctrl[1] ?? "").replace(/^\/|\/$/g, "");
      continue;
    }
    const meth = methodRe.exec(line);
    if (meth) {
      const method = meth[1]!.toUpperCase();
      const sub = (meth[2] ?? "").replace(/^\/|\/$/g, "");
      const joined = [currentPrefix, sub].filter(Boolean).join("/");
      const httpPath = "/" + joined;
      hits.push({ file, method, path: httpPath, framework: "nest" });
    }
  }
  return hits;
}

/** Express / Koa-ish: `router.get('/path', ...)` or `app.post('/x', ...)`. */
function extractExpressEndpoints(content: string, file: string): EndpointHit[] {
  const hits: EndpointHit[] = [];
  const reSource = `(?:app|router|api)\\.(${HTTP_METHODS.join(
    "|"
  )})\\(\\s*['"]([^'"]+)['"]`;
  for (const line of content.split(/\r?\n/)) {
    if (isCommentLine(line)) continue;
    // matchAll keeps each line independent; using a single global regex would
    // share lastIndex across lines and silently skip matches.
    for (const m of line.matchAll(new RegExp(reSource, "g"))) {
      hits.push({
        file,
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        framework: "express"
      });
    }
  }
  return hits;
}

/** FastAPI: `@app.get('/x')` or `@router.post('/x')`. */
function extractFastapiEndpoints(content: string, file: string): EndpointHit[] {
  const hits: EndpointHit[] = [];
  const re = new RegExp(
    `^\\s*@(?:app|router)\\.(${HTTP_METHODS.join("|")})\\(\\s*['"]([^'"]+)['"]`
  );
  for (const line of content.split(/\r?\n/)) {
    if (isCommentLine(line)) continue;
    const m = re.exec(line);
    if (m) {
      hits.push({
        file,
        method: m[1]!.toUpperCase(),
        path: m[2]!,
        framework: "fastapi"
      });
    }
  }
  return hits;
}

/** commander/yargs: `.command('verb', ...)` declarations. */
function extractCliEndpoints(content: string, file: string): EndpointHit[] {
  const hits: EndpointHit[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (isCommentLine(line)) continue;
    for (const m of line.matchAll(
      /\.command\(\s*['"]([a-zA-Z][a-zA-Z0-9-_:.]*)/g
    )) {
      hits.push({
        file,
        method: "CLI",
        path: m[1]!,
        framework: "commander"
      });
    }
  }
  return hits;
}

function pickExtractors(
  file: string
): Array<(c: string, f: string) => EndpointHit[]> {
  const ext = path.posix.extname(file);
  if (ext === ".py") return [extractFastapiEndpoints];
  if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx") {
    return [extractNestEndpoints, extractExpressEndpoints, extractCliEndpoints];
  }
  return [];
}

export interface DetectEndpointsOptions {
  root: string;
  files: readonly ScanFile[];
  /**
   * Optional reader override (testability). Receives the absolute file path
   * and returns the file contents.
   */
  readFile?: (absolutePath: string) => Promise<string>;
}

export async function detectEndpoints(
  options: DetectEndpointsOptions
): Promise<EndpointDetectionResult> {
  const reader = options.readFile ?? ((p: string) => fs.readFile(p, "utf8"));
  const seen = new Set<string>();
  const endpoints: EndpointHit[] = [];

  for (const f of options.files) {
    if (f.kind !== "code") continue;
    const filePosix = toPosix(f.path);
    if (!isLikelyEndpointFile(filePosix)) continue;

    const extractors = pickExtractors(filePosix);
    if (extractors.length === 0) continue;

    let content: string;
    try {
      content = await reader(path.join(options.root, f.path));
    } catch {
      continue;
    }

    for (const extract of extractors) {
      for (const hit of extract(content, filePosix)) {
        const key = `${hit.method}:${hit.path}|${hit.file}|${hit.framework}`;
        if (seen.has(key)) continue;
        seen.add(key);
        endpoints.push(hit);
      }
    }
  }

  // Stable, alphabetic order by id key.
  endpoints.sort((a, b) => {
    const aid = `${a.method}:${a.path}|${a.file}|${a.framework}`;
    const bid = `${b.method}:${b.path}|${b.file}|${b.framework}`;
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });

  return { endpoints };
}
