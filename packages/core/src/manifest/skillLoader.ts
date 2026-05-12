import { promises as fs } from "node:fs";
import path from "node:path";

import type { RuleEntry, SkillEntry } from "./agentManifest.js";

// ─── frontmatter helpers (shared) ─────────────────────────────────────────────

interface FrontmatterFields {
  name?: string;
  domains?: string[];
  alwaysApply?: boolean;
}

export function parseFrontmatter(content: string): FrontmatterFields {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const block = match[1];
  const fields: FrontmatterFields = {};

  const nameLine = /^name:\s*(.+)$/m.exec(block);
  if (nameLine) fields.name = nameLine[1].trim();

  const alwaysLine = /^alwaysApply:\s*(true|false)$/m.exec(block);
  if (alwaysLine) fields.alwaysApply = alwaysLine[1] === "true";

  const domainsLine = /^domains:\s*\[([^\]]*)\]$/m.exec(block);
  if (domainsLine) {
    fields.domains = domainsLine[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  return fields;
}

export async function loadSkillEntries(dir: string): Promise<SkillEntry[]> {
  try {
    const entries = await fs.readdir(dir);
    const result: SkillEntry[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const fullPath = path.join(dir, entry);
      const relPath = `.claude/skills/${entry}`;
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const fm = parseFrontmatter(content);
        result.push({
          path: relPath,
          name: fm.name ?? entry.replace(".md", ""),
          domains: fm.domains ?? [],
          alwaysApply: fm.alwaysApply
        });
      } catch {
        result.push({
          path: relPath,
          name: entry.replace(".md", ""),
          domains: []
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export async function loadRuleEntries(dir: string): Promise<RuleEntry[]> {
  try {
    const entries = await fs.readdir(dir);
    const result: RuleEntry[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".mdc") && !entry.endsWith(".md")) continue;
      const fullPath = path.join(dir, entry);
      const relPath = `.cursor/rules/${entry}`;
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const fm = parseFrontmatter(content);
        result.push({
          path: relPath,
          description: undefined,
          domains: fm.domains ?? [],
          alwaysApply: fm.alwaysApply
        });
      } catch {
        result.push({ path: relPath, domains: [] });
      }
    }
    return result;
  } catch {
    return [];
  }
}
