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
  /** Route path (HTTP), CLI verb, or `app/...` UI route. */
  path: string;
  framework:
    | "nest"
    | "express"
    | "fastapi"
    | "commander"
    | "yargs"
    | "next-route"
    | "next-page"
    | "next-pages"
    | "astro";
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
  // Next.js App Router conventions: page/route/layout.* live under app/.
  if (segments.includes("app")) {
    if (/^(page|route)\.(t|j)sx?$/.test(base) || /^route\.(t|j)s$/.test(base)) {
      return true;
    }
  }
  // Next.js Pages Router: pages/ contains UI; pages/api/ contains handlers.
  if (segments.includes("pages")) return true;
  // Astro pages.
  if (base.endsWith(".astro") && segments.includes("pages")) return true;
  return false;
}

/**
 * Convert a Next.js App Router file path to its public URL.
 * Strips any leading `apps/<workspace>/` or `src/` prefix, the trailing
 * `/route.ts` or `/page.tsx`, and Next route-group folders `(group)`.
 *
 * Examples:
 *   app/api/users/route.ts        -> /api/users
 *   app/(marketing)/about/page.tsx -> /about
 *   src/app/page.tsx              -> /
 */
function nextAppRoute(filePosix: string): string {
  const segments = filePosix.split("/");
  const appIdx = segments.indexOf("app");
  if (appIdx === -1) return "/";
  // Drop everything up to and including "app", and the basename.
  const middle = segments.slice(appIdx + 1, -1);
  const filtered = middle.filter((s) => !/^\(.+\)$/.test(s));
  return "/" + filtered.join("/");
}

/**
 * Convert a Next.js Pages Router file path to its public URL.
 *
 * Examples:
 *   pages/index.tsx           -> /
 *   pages/users/[id].tsx      -> /users/[id]
 *   pages/api/users.ts        -> /api/users
 *   pages/api/users/[id].ts   -> /api/users/[id]
 */
function nextPagesRoute(filePosix: string): string {
  const segments = filePosix.split("/");
  const pagesIdx = segments.indexOf("pages");
  if (pagesIdx === -1) return "/";
  const tail = segments.slice(pagesIdx + 1);
  const last = tail[tail.length - 1] ?? "";
  // Strip extension from last segment; remove `index` so it collapses to "/".
  const lastBase = last.replace(/\.(tsx?|jsx?)$/, "");
  if (lastBase === "index") tail[tail.length - 1] = "";
  else tail[tail.length - 1] = lastBase;
  const path = "/" + tail.filter(Boolean).join("/");
  return path === "" ? "/" : path;
}

function astroRoute(filePosix: string): string {
  const segments = filePosix.split("/");
  const pagesIdx = segments.indexOf("pages");
  if (pagesIdx === -1) return "/";
  const tail = segments.slice(pagesIdx + 1);
  const last = tail[tail.length - 1] ?? "";
  const lastBase = last.replace(/\.astro$/, "");
  if (lastBase === "index") tail[tail.length - 1] = "";
  else tail[tail.length - 1] = lastBase;
  const path = "/" + tail.filter(Boolean).join("/");
  return path === "" ? "/" : path;
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

/**
 * Next.js App Router route handlers: `export const GET/POST/...` or
 * `export async function GET/POST/...` inside an `app/**\/route.ts`.
 * The HTTP path comes from the file path, not the file content.
 */
function extractNextRouteEndpoints(
  content: string,
  file: string
): EndpointHit[] {
  const base = path.posix.basename(file);
  if (!/^route\.(t|j)sx?$/.test(base)) return [];
  const route = nextAppRoute(file);
  const hits: EndpointHit[] = [];
  const seen = new Set<string>();
  const re = new RegExp(
    `^\\s*export\\s+(?:async\\s+function|const|function)\\s+(${HTTP_METHODS.map((m) => m.toUpperCase()).join("|")})\\b`
  );
  for (const line of content.split(/\r?\n/)) {
    if (isCommentLine(line)) continue;
    const m = re.exec(line);
    if (m) {
      const method = m[1]!;
      if (seen.has(method)) continue;
      seen.add(method);
      hits.push({ file, method, path: route, framework: "next-route" });
    }
  }
  return hits;
}

/** Next.js App Router pages: `app/**\/page.tsx` -> a UI endpoint. */
function extractNextPageEndpoints(file: string): EndpointHit[] {
  const base = path.posix.basename(file);
  if (!/^page\.(t|j)sx?$/.test(base)) return [];
  return [
    {
      file,
      method: "PAGE",
      path: nextAppRoute(file),
      framework: "next-page"
    }
  ];
}

/** Next.js Pages Router: `pages/**\/*.{tsx,jsx}` and `pages/api/**\/*.{ts,js}`. */
function extractNextPagesEndpoints(file: string): EndpointHit[] {
  const segments = file.split("/");
  const pagesIdx = segments.indexOf("pages");
  if (pagesIdx === -1) return [];
  const tailSegments = segments.slice(pagesIdx + 1);
  if (tailSegments.length === 0) return [];
  const isApi = tailSegments[0] === "api";
  const route = nextPagesRoute(file);
  const base = path.posix.basename(file);
  if (isApi) {
    if (!/\.(t|j)sx?$/.test(base)) return [];
    return [{ file, method: "ANY", path: route, framework: "next-pages" }];
  }
  if (!/\.(t|j)sx?$/.test(base)) return [];
  // _app, _document, _error are Next.js internals, not user-facing pages.
  if (/^_(app|document|error)\.(t|j)sx?$/.test(base)) return [];
  return [{ file, method: "PAGE", path: route, framework: "next-pages" }];
}

/** Astro pages: `src/pages/**\/*.astro`. */
function extractAstroEndpoints(file: string): EndpointHit[] {
  const base = path.posix.basename(file);
  if (!base.endsWith(".astro")) return [];
  return [{ file, method: "PAGE", path: astroRoute(file), framework: "astro" }];
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
  const segments = file.split("/");
  const base = path.posix.basename(file);

  if (ext === ".py") return [extractFastapiEndpoints];

  if (ext === ".astro") return [(_c, f) => extractAstroEndpoints(f)];

  if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx") {
    const extractors: Array<(c: string, f: string) => EndpointHit[]> = [
      extractNestEndpoints,
      extractExpressEndpoints,
      extractCliEndpoints
    ];
    // Next.js App Router file conventions: page.* / route.*. The page
    // extractor only needs the path (no content); the route extractor scans
    // for HTTP-method exports in the body.
    if (segments.includes("app")) {
      if (/^route\.(t|j)sx?$/.test(base)) {
        extractors.push(extractNextRouteEndpoints);
      }
      if (/^page\.(t|j)sx?$/.test(base)) {
        extractors.push((_c, f) => extractNextPageEndpoints(f));
      }
    }
    // Next.js Pages Router: any file under pages/ that's a TS/JS module.
    if (segments.includes("pages")) {
      extractors.push((_c, f) => extractNextPagesEndpoints(f));
    }
    return extractors;
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
