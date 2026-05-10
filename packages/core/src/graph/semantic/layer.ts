import path from "node:path";

import type { ScanFile } from "../../scanner.js";

/**
 * Layer detection — pure heuristic over basenames + path segments.
 *
 * No file content is read. Decisions stem from naming conventions used by
 * NestJS, Express, FastAPI, Django, Next.js, etc.
 *
 * Output: per-file layer assignment (or null when no rule matches).
 * The caller can fan these into `layer:<name>` nodes + `in_layer` edges.
 */

export type LayerKind = "backend" | "frontend" | "shared";

export interface LayerAssignment {
  /** posix-normalised file path. */
  file: string;
  /** Layer slug (also used as `layer:<slug>` node id). */
  layer: string;
  kind: LayerKind;
}

export interface LayerDetectionResult {
  assignments: LayerAssignment[];
  /** Distinct layers discovered, in deterministic order, with their kind. */
  layers: Array<{ layer: string; kind: LayerKind }>;
}

interface LayerRule {
  layer: string;
  kind: LayerKind;
  /** Match `<name>.<layer>.<ext>` basenames. */
  basenameSuffixes?: readonly string[];
  /** Match `<basename>` exactly (used by Next.js conventions). */
  exactBasenames?: readonly string[];
  /** Match a path segment exactly (e.g. `controllers`). */
  folderSegments?: readonly string[];
}

const RULES: readonly LayerRule[] = [
  // Backend
  {
    layer: "controller",
    kind: "backend",
    basenameSuffixes: [".controller.ts", ".controller.js", ".controller.py"],
    folderSegments: ["controllers"]
  },
  {
    layer: "service",
    kind: "backend",
    basenameSuffixes: [".service.ts", ".service.js", ".service.py"],
    folderSegments: ["services"]
  },
  {
    layer: "repository",
    kind: "backend",
    basenameSuffixes: [
      ".repository.ts",
      ".repository.js",
      ".repository.py",
      ".repo.ts",
      ".repo.js"
    ],
    folderSegments: ["repositories", "repos"]
  },
  {
    layer: "use-case",
    kind: "backend",
    basenameSuffixes: [".use-case.ts", ".usecase.ts", ".use_case.py"],
    folderSegments: ["use-cases", "usecases"]
  },
  {
    layer: "model",
    kind: "backend",
    basenameSuffixes: [".model.ts", ".model.js", ".model.py", ".entity.ts"],
    folderSegments: ["models", "entities"]
  },
  {
    layer: "dto",
    kind: "backend",
    basenameSuffixes: [".dto.ts", ".dto.js", ".dto.py"],
    folderSegments: ["dto", "dtos"]
  },
  {
    layer: "guard",
    kind: "backend",
    basenameSuffixes: [".guard.ts", ".guard.js"],
    folderSegments: ["guards"]
  },
  {
    layer: "middleware",
    kind: "backend",
    basenameSuffixes: [".middleware.ts", ".middleware.js", ".middleware.py"],
    folderSegments: ["middleware", "middlewares"]
  },
  {
    layer: "module",
    kind: "backend",
    basenameSuffixes: [".module.ts", ".module.js"]
  },
  // ── Frontend ───────────────────────────────────────────────────────────────
  // Next.js App Router conventions (file-based; basename is exact).
  // route.ts/js -> a `route` layer (a server-side endpoint handler).
  // page.tsx/jsx -> a `page` layer (a UI route).
  // layout/loading/error/template/not-found/default match their own layers.
  {
    layer: "route",
    kind: "frontend",
    exactBasenames: ["route.ts", "route.js"]
  },
  {
    layer: "page",
    kind: "frontend",
    exactBasenames: ["page.tsx", "page.jsx", "page.ts", "page.js"],
    basenameSuffixes: [".page.tsx", ".page.jsx"],
    folderSegments: ["pages"]
  },
  {
    layer: "layout",
    kind: "frontend",
    exactBasenames: ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"]
  },
  {
    layer: "loading",
    kind: "frontend",
    exactBasenames: ["loading.tsx", "loading.jsx"]
  },
  {
    layer: "error",
    kind: "frontend",
    exactBasenames: [
      "error.tsx",
      "error.jsx",
      "global-error.tsx",
      "not-found.tsx"
    ]
  },
  {
    layer: "template",
    kind: "frontend",
    exactBasenames: ["template.tsx", "template.jsx"]
  },
  // Astro (basename = `<name>.astro` lives under src/pages/).
  {
    layer: "page",
    kind: "frontend",
    basenameSuffixes: [".astro"]
  },
  // Generic SPA layers.
  {
    layer: "component",
    kind: "frontend",
    basenameSuffixes: [".component.tsx", ".component.jsx", ".component.ts"],
    folderSegments: ["components"]
  },
  {
    layer: "hook",
    kind: "frontend",
    basenameSuffixes: [".hook.ts", ".hook.tsx"],
    folderSegments: ["hooks"]
  },
  {
    layer: "store",
    kind: "frontend",
    basenameSuffixes: [".store.ts", ".store.tsx"],
    folderSegments: ["stores"]
  },
  {
    layer: "context",
    kind: "frontend",
    basenameSuffixes: [".context.tsx", ".context.ts"],
    folderSegments: ["contexts"]
  },
  {
    layer: "reducer",
    kind: "frontend",
    basenameSuffixes: [".reducer.ts", ".slice.ts"],
    folderSegments: ["reducers", "slices"]
  },
  {
    layer: "api-client",
    kind: "frontend",
    basenameSuffixes: [".client.ts", ".api.ts"],
    folderSegments: ["api-clients"]
  },
  // Next.js middleware (root-level file).
  {
    layer: "middleware",
    kind: "frontend",
    exactBasenames: ["middleware.ts", "middleware.js"]
  },
  // Shared
  {
    layer: "util",
    kind: "shared",
    basenameSuffixes: [".util.ts", ".util.js", ".util.py", ".helper.ts"],
    folderSegments: ["utils", "helpers"]
  },
  {
    layer: "schema",
    kind: "shared",
    basenameSuffixes: [".schema.ts", ".schema.js", ".schema.py", ".schema.json"]
  },
  {
    layer: "types",
    kind: "shared",
    basenameSuffixes: [".types.ts", ".type.ts", ".d.ts"]
  }
];

const SKIP_BASENAMES = new Set([
  "service-worker.ts",
  "service-worker.js",
  "index.ts",
  "index.js",
  "main.ts",
  "main.js"
]);

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function isTestPath(p: string): boolean {
  const base = path.posix.basename(p);
  return /\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(base);
}

function matchRule(filePosix: string): LayerRule | null {
  const base = path.posix.basename(filePosix);
  if (SKIP_BASENAMES.has(base)) return null;
  if (isTestPath(filePosix)) return null;
  const segments = filePosix.split("/");

  for (const rule of RULES) {
    if (rule.exactBasenames) {
      for (const exact of rule.exactBasenames) {
        if (base === exact) return rule;
      }
    }
    if (rule.basenameSuffixes) {
      for (const suffix of rule.basenameSuffixes) {
        if (base.endsWith(suffix)) return rule;
      }
    }
    if (rule.folderSegments) {
      for (const seg of rule.folderSegments) {
        if (segments.includes(seg)) return rule;
      }
    }
  }
  return null;
}

export function detectLayers(files: readonly ScanFile[]): LayerDetectionResult {
  const assignments: LayerAssignment[] = [];
  const distinct = new Map<string, LayerKind>();

  for (const f of files) {
    if (f.kind !== "code") continue;
    const filePosix = toPosix(f.path);
    const rule = matchRule(filePosix);
    if (!rule) continue;
    assignments.push({ file: f.path, layer: rule.layer, kind: rule.kind });
    if (!distinct.has(rule.layer)) distinct.set(rule.layer, rule.kind);
  }

  const layers = [...distinct.entries()]
    .map(([layer, kind]) => ({ layer, kind }))
    .sort((a, b) => (a.layer < b.layer ? -1 : 1));

  return { assignments, layers };
}
