import type { GraphEdge, GraphNode } from "../graph/builder.js";
import { getDomain } from "../graph/domain.js";

export interface DomainSkillsOptions {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
  minFilesPerDomain?: number;
  maxFilesShown?: number;
  maxTestsShown?: number;
}

export interface DomainSkillFile {
  path: string;
  domain: string;
  content: string;
}

export interface DomainSkillsResult {
  files: DomainSkillFile[];
  skipped: Array<{ domain: string; reason: string }>;
}

interface FileEntry {
  node: GraphNode;
  degree: number;
}

const DEFAULT_MIN_FILES_PER_DOMAIN = 2;
const DEFAULT_MAX_FILES_SHOWN = 8;
const DEFAULT_MAX_TESTS_SHOWN = 5;

export function slugify(domain: string): string {
  return domain.replace(/\//g, "-");
}

export function inferPurpose(filePath: string): string {
  const parts = filePath.split("/");
  const last = parts[parts.length - 1] ?? filePath;
  const stem = last.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java)$/i, "");

  let base: string;
  if (stem === "index" && parts.length >= 2) {
    base = parts[parts.length - 2];
  } else {
    base = stem;
  }

  return camelToKebab(base);
}

function camelToKebab(value: string): string {
  if (!value) return value;
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function buildDomainSkills(
  opts: DomainSkillsOptions
): DomainSkillsResult {
  const minFilesPerDomain =
    opts.minFilesPerDomain ?? DEFAULT_MIN_FILES_PER_DOMAIN;
  const maxFilesShown = opts.maxFilesShown ?? DEFAULT_MAX_FILES_SHOWN;
  const maxTestsShown = opts.maxTestsShown ?? DEFAULT_MAX_TESTS_SHOWN;

  // Calculate degree (in + out) per node id, single edge pass.
  const degree = new Map<string, number>();
  for (const e of opts.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // Group file nodes by domain.
  const fileNodesById = new Map<string, GraphNode>();
  const byDomain = new Map<string, FileEntry[]>();
  for (const node of opts.nodes) {
    if (node.type !== "file" || !node.path) continue;
    fileNodesById.set(node.id, node);
    const domain = getDomain(node.path);
    let bucket = byDomain.get(domain);
    if (!bucket) {
      bucket = [];
      byDomain.set(domain, bucket);
    }
    bucket.push({ node, degree: degree.get(node.id) ?? 0 });
  }

  // Cross-domain edge stats per domain.
  type CrossMap = Map<string, Map<string, number>>;
  const dependsOn: CrossMap = new Map();
  const usedBy: CrossMap = new Map();
  for (const e of opts.edges) {
    if (e.type !== "imports") continue;
    const fromNode = fileNodesById.get(e.from);
    const toNode = fileNodesById.get(e.to);
    if (!fromNode?.path || !toNode?.path) continue;
    const fromDomain = getDomain(fromNode.path);
    const toDomain = getDomain(toNode.path);
    if (fromDomain === toDomain) continue;
    bumpCross(dependsOn, fromDomain, toDomain);
    bumpCross(usedBy, toDomain, fromDomain);
  }

  const result: DomainSkillsResult = { files: [], skipped: [] };

  const sortedDomains = [...byDomain.keys()].sort((a, b) => a.localeCompare(b));
  for (const domain of sortedDomains) {
    const entries = byDomain.get(domain) ?? [];
    if (entries.length < minFilesPerDomain) {
      result.skipped.push({
        domain,
        reason: `only ${entries.length} file${entries.length === 1 ? "" : "s"} (< ${minFilesPerDomain})`
      });
      continue;
    }

    const sortedEntries = [...entries].sort((a, b) => {
      if (b.degree !== a.degree) return b.degree - a.degree;
      const ap = a.node.path ?? "";
      const bp = b.node.path ?? "";
      return ap.localeCompare(bp);
    });

    const codeEntries = sortedEntries.filter((e) => e.node.kind !== "test");
    const testEntries = sortedEntries.filter((e) => e.node.kind === "test");

    const dependsMap = dependsOn.get(domain) ?? new Map<string, number>();
    const usedByMap = usedBy.get(domain) ?? new Map<string, number>();

    const content = renderSkill({
      domain,
      codeEntries,
      testEntries,
      dependsMap,
      usedByMap,
      maxFilesShown,
      maxTestsShown
    });

    result.files.push({
      path: `.claude/skills/contextforge-domain-${slugify(domain)}.md`,
      domain,
      content
    });
  }

  return result;
}

function bumpCross(
  map: Map<string, Map<string, number>>,
  domain: string,
  other: string
): void {
  let inner = map.get(domain);
  if (!inner) {
    inner = new Map();
    map.set(domain, inner);
  }
  inner.set(other, (inner.get(other) ?? 0) + 1);
}

interface RenderArgs {
  domain: string;
  codeEntries: FileEntry[];
  testEntries: FileEntry[];
  dependsMap: Map<string, number>;
  usedByMap: Map<string, number>;
  maxFilesShown: number;
  maxTestsShown: number;
}

function renderSkill(args: RenderArgs): string {
  const {
    domain,
    codeEntries,
    testEntries,
    dependsMap,
    usedByMap,
    maxFilesShown,
    maxTestsShown
  } = args;

  const slug = slugify(domain);
  const codeCount = codeEntries.length;
  const testCount = testEntries.length;
  const crossLinks = dependsMap.size + usedByMap.size;

  const dependsClauseParts: string[] = [];
  if (dependsMap.size > 0) {
    dependsClauseParts.push(`depends on ${dependsMap.size}`);
  }
  if (usedByMap.size > 0) {
    dependsClauseParts.push(`used by ${usedByMap.size}`);
  }
  const dependencyClause =
    dependsClauseParts.length > 0 ? `, ${dependsClauseParts.join(", ")}` : "";

  const description = `Domain context for ${domain} — ${codeCount} files, ${testCount} tests${dependencyClause}`;

  const keyFiles = codeEntries
    .slice(0, maxFilesShown)
    .map((e) => `- \`${e.node.path}\` — ${inferPurpose(e.node.path ?? "")}`)
    .join("\n");

  const dependsLines =
    dependsMap.size > 0
      ? [...dependsMap.entries()]
          .sort(sortCrossEntries)
          .map(([d, n]) => `- \`${d}\` (${n} import${n === 1 ? "" : "s"})`)
          .join("\n")
      : "";

  const usedByLines =
    usedByMap.size > 0
      ? [...usedByMap.entries()]
          .sort(sortCrossEntries)
          .map(([d, n]) => `- \`${d}\` (${n} import${n === 1 ? "" : "s"})`)
          .join("\n")
      : "";

  const testLines =
    testEntries.length > 0
      ? testEntries
          .slice(0, maxTestsShown)
          .map((e) => `- \`${e.node.path}\``)
          .join("\n")
      : "";

  const sections: string[] = [];
  sections.push(`---
name: contextforge-domain-${slug}
description: ${description}
tags: [${domain}, domain-skill]
---`);
  sections.push(`# ${domain}`);
  sections.push(
    `${codeCount} code files · ${testCount} tests · ${crossLinks} cross-domain links`
  );
  sections.push(`## Key files\n\n${keyFiles}`);

  if (dependsLines) {
    sections.push(`## Depends on\n\n${dependsLines}`);
  }
  if (usedByLines) {
    sections.push(`## Used by\n\n${usedByLines}`);
  }
  if (testLines) {
    sections.push(`## Tests in this domain\n\n${testLines}`);
  }

  sections.push(`## Quick commands

- \`forge context "<task in ${domain}>"\` — pack focused on this domain
- \`forge spec <change-id>\` — OpenSpec scaffold (will infer domain automatically)`);

  sections.push(
    `_Auto-generated by \`forge skills\`. Run \`forge skills --force\` to regenerate._`
  );

  return `${sections.join("\n\n")}\n`;
}

function sortCrossEntries(a: [string, number], b: [string, number]): number {
  if (b[1] !== a[1]) return b[1] - a[1];
  return a[0].localeCompare(b[0]);
}
