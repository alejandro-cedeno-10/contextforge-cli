import { getDomain } from "../graph/domain.js";

export interface SkillEntry {
  path: string;
  name: string;
  domains: string[];
  alwaysApply?: boolean;
}

export interface RuleEntry {
  path: string;
  description?: string;
  domains: string[];
  alwaysApply?: boolean;
}

export interface AgentManifestOptions {
  task: string;
  packedFiles: ReadonlyArray<{ path: string }>;
  skills: ReadonlyArray<SkillEntry>;
  rules: ReadonlyArray<RuleEntry>;
}

export type MatchType = "domain" | "alwaysApply" | "explicit";

export interface ManifestSkill {
  path: string;
  name: string;
  reason: string;
  matchType: MatchType;
}

export interface ManifestRule {
  path: string;
  reason: string;
  matchType: MatchType;
  suggestedGlobs?: string[];
}

export interface AgentManifestResult {
  schemaVersion: string;
  task: string;
  domainsTouched: string[];
  skills: ManifestSkill[];
  rules: ManifestRule[];
  skipped: {
    skills: Array<{ name: string; reason: string }>;
    rules: Array<{ path: string; reason: string }>;
  };
}

const SCHEMA_VERSION = "1.0.0";

function deslugify(slug: string): string {
  return slug.replace(/-/g, "/");
}

function domainFromSkillName(name: string): string | null {
  // New canonical prefix:  contextforge-domain-<slug>
  // Legacy prefix kept for backward compatibility with skills authored
  // before v0.3.9. Drop the legacy branch one minor version later.
  const match =
    /^contextforge-domain-(.+)$/.exec(name) ?? /^ctx-(.+)$/.exec(name);
  if (!match) return null;
  return deslugify(match[1]);
}

function matchEntry(
  domains: string[],
  alwaysApply: boolean | undefined,
  domainsTouched: Set<string>,
  nameForSlug: string | null
): { match: true; matchType: MatchType; reason: string } | { match: false } {
  if (alwaysApply) {
    return {
      match: true,
      matchType: "alwaysApply",
      reason: "skill marked alwaysApply"
    };
  }
  if (domains.length > 0) {
    const hit = domains.find((d) => domainsTouched.has(d));
    if (hit) {
      return {
        match: true,
        matchType: "domain",
        reason: `task touches ${hit}`
      };
    }
    return { match: false };
  }
  if (nameForSlug) {
    const inferred = domainFromSkillName(nameForSlug);
    if (inferred && domainsTouched.has(inferred)) {
      return {
        match: true,
        matchType: "explicit",
        reason: `task touches ${inferred}`
      };
    }
  }
  return { match: false };
}

export function buildAgentManifest(
  opts: AgentManifestOptions
): AgentManifestResult {
  const domainSet = new Set<string>();
  for (const f of opts.packedFiles) {
    domainSet.add(getDomain(f.path));
  }
  const domainsTouched = [...domainSet].sort();
  const domainsTouchedSet = new Set(domainsTouched);

  const skills: ManifestSkill[] = [];
  const skippedSkills: Array<{ name: string; reason: string }> = [];

  for (const skill of [...opts.skills].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    const res = matchEntry(
      skill.domains,
      skill.alwaysApply,
      domainsTouchedSet,
      skill.name
    );
    if (res.match) {
      skills.push({
        path: skill.path,
        name: skill.name,
        reason: res.reason,
        matchType: res.matchType
      });
    } else {
      skippedSkills.push({ name: skill.name, reason: "domain not touched" });
    }
  }

  const rules: ManifestRule[] = [];
  const skippedRules: Array<{ path: string; reason: string }> = [];

  for (const rule of [...opts.rules].sort((a, b) =>
    a.path.localeCompare(b.path)
  )) {
    const res = matchEntry(
      rule.domains,
      rule.alwaysApply,
      domainsTouchedSet,
      null
    );
    if (res.match) {
      const entry: ManifestRule = {
        path: rule.path,
        reason: res.reason,
        matchType: res.matchType
      };
      if (res.matchType === "domain" && rule.domains.length > 0) {
        const globs = rule.domains
          .filter((d) => domainsTouchedSet.has(d))
          .map((d) => `${d}/**`)
          .sort();
        if (globs.length > 0) entry.suggestedGlobs = globs;
      }
      rules.push(entry);
    } else {
      skippedRules.push({ path: rule.path, reason: "domain not touched" });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    task: opts.task,
    domainsTouched,
    skills,
    rules,
    skipped: { skills: skippedSkills, rules: skippedRules }
  };
}
