import { promises as fs } from "node:fs";
import path from "node:path";

export interface TsconfigPathRule {
  pattern: string;
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  targets: string[];
}

export interface TsconfigPaths {
  baseUrl: string;
  rules: TsconfigPathRule[];
}

function stripJsonComments(input: string): string {
  // Minimal JSONC stripping: line comments, block comments, trailing commas.
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < input.length) {
    const ch = input[i]!;
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      const end = input.indexOf("\n", i);
      i = end === -1 ? input.length : end;
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function buildRule(pattern: string, targets: string[]): TsconfigPathRule {
  const star = pattern.indexOf("*");
  if (star === -1) {
    return {
      pattern,
      prefix: pattern,
      suffix: "",
      hasWildcard: false,
      targets
    };
  }
  return {
    pattern,
    prefix: pattern.slice(0, star),
    suffix: pattern.slice(star + 1),
    hasWildcard: true,
    targets
  };
}

export async function loadTsconfigPaths(
  root: string
): Promise<TsconfigPaths | null> {
  const tsconfigPath = path.join(root, "tsconfig.json");
  let raw: string;
  try {
    raw = await fs.readFile(tsconfigPath, "utf8");
  } catch {
    return null;
  }
  let parsed: {
    compilerOptions?: {
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
  };
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
  const compilerOptions = parsed.compilerOptions ?? {};
  const baseUrl = compilerOptions.baseUrl ?? ".";
  const rawPaths = compilerOptions.paths ?? {};
  const rules: TsconfigPathRule[] = [];
  for (const [pattern, targets] of Object.entries(rawPaths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    rules.push(buildRule(pattern, targets));
  }
  return { baseUrl, rules };
}

function joinForAllFiles(
  base: string,
  rest: string,
  allFiles: ReadonlySet<string>
): string | null {
  const joined = path
    .posix.join(base.replace(/\\/g, "/"), rest.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");

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
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

export function resolveTsconfigAlias(
  importSource: string,
  config: TsconfigPaths,
  allFiles: ReadonlySet<string>
): string | null {
  for (const rule of config.rules) {
    if (rule.hasWildcard) {
      if (
        importSource.startsWith(rule.prefix) &&
        importSource.endsWith(rule.suffix)
      ) {
        const captured = importSource.slice(
          rule.prefix.length,
          importSource.length - rule.suffix.length
        );
        for (const target of rule.targets) {
          const filled = target.replace("*", captured);
          const resolved = joinForAllFiles(config.baseUrl, filled, allFiles);
          if (resolved) return resolved;
        }
      }
    } else if (importSource === rule.pattern) {
      for (const target of rule.targets) {
        const resolved = joinForAllFiles(config.baseUrl, target, allFiles);
        if (resolved) return resolved;
      }
    }
  }
  return null;
}
