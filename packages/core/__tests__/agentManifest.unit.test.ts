import { describe, expect, it } from "vitest";

import {
  buildAgentManifest,
  type AgentManifestOptions,
  type RuleEntry,
  type SkillEntry
} from "../src/manifest/agentManifest";

function skill(
  name: string,
  domains: string[] = [],
  alwaysApply?: boolean
): SkillEntry {
  return { path: `.claude/skills/${name}.md`, name, domains, alwaysApply };
}

function rule(
  path: string,
  domains: string[] = [],
  alwaysApply?: boolean
): RuleEntry {
  return { path, domains, alwaysApply };
}

describe("buildAgentManifest", () => {
  it("returns empty lists when pack is empty", () => {
    const result = buildAgentManifest({
      task: "fix something",
      packedFiles: [],
      skills: [],
      rules: []
    });
    expect(result.domainsTouched).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.rules).toEqual([]);
    expect(result.skipped.skills).toEqual([]);
    expect(result.skipped.rules).toEqual([]);
  });

  it("computes domainsTouched from packedFiles, sorted and deduped", () => {
    const result = buildAgentManifest({
      task: "fix something",
      packedFiles: [
        { path: "packages/core/src/a.ts" },
        { path: "packages/core/src/b.ts" },
        { path: "packages/cli/src/index.ts" }
      ],
      skills: [],
      rules: []
    });
    expect(result.domainsTouched).toEqual(["packages/cli", "packages/core"]);
  });

  it("includes skill with alwaysApply:true regardless of domains touched", () => {
    const result = buildAgentManifest({
      task: "any task",
      packedFiles: [],
      skills: [skill("ctx-packages-core", [], true)],
      rules: []
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].matchType).toBe("alwaysApply");
    expect(result.skills[0].reason).toBe("skill marked alwaysApply");
  });

  it("includes skill by domain frontmatter intersection (matchType: domain)", () => {
    const result = buildAgentManifest({
      task: "fix core",
      packedFiles: [{ path: "packages/core/src/a.ts" }],
      skills: [skill("my-skill", ["packages/core"])],
      rules: []
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].matchType).toBe("domain");
    expect(result.skills[0].reason).toBe("task touches packages/core");
  });

  it("includes ctx-<slug> skill by name inference when no domains frontmatter (matchType: explicit)", () => {
    const result = buildAgentManifest({
      task: "fix core",
      packedFiles: [{ path: "packages/core/src/a.ts" }],
      skills: [skill("ctx-packages-core", [])],
      rules: []
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].matchType).toBe("explicit");
  });

  it("skips skill whose domain is not touched", () => {
    const result = buildAgentManifest({
      task: "fix cli",
      packedFiles: [{ path: "packages/cli/src/index.ts" }],
      skills: [skill("ctx-packages-mcp", [])],
      rules: []
    });
    expect(result.skills).toHaveLength(0);
    expect(result.skipped.skills).toHaveLength(1);
    expect(result.skipped.skills[0].name).toBe("ctx-packages-mcp");
    expect(result.skipped.skills[0].reason).toBe("domain not touched");
  });

  it("skill domain frontmatter takes precedence over slug when domains: [] uses alwaysApply", () => {
    const result = buildAgentManifest({
      task: "fix cli",
      packedFiles: [{ path: "packages/cli/src/index.ts" }],
      skills: [skill("ctx-packages-core", ["packages/cli"])],
      rules: []
    });
    expect(result.skills[0].matchType).toBe("domain");
    expect(result.skills[0].reason).toBe("task touches packages/cli");
  });

  it("rule with domain match produces suggestedGlobs", () => {
    const result = buildAgentManifest({
      task: "fix core",
      packedFiles: [
        { path: "packages/core/src/a.ts" },
        { path: "packages/cli/src/x.ts" }
      ],
      skills: [],
      rules: [rule(".cursor/rules/my.mdc", ["packages/core", "packages/cli"])]
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].suggestedGlobs).toEqual([
      "packages/cli/**",
      "packages/core/**"
    ]);
  });

  it("alwaysApply rule has no suggestedGlobs", () => {
    const result = buildAgentManifest({
      task: "any",
      packedFiles: [],
      skills: [],
      rules: [rule(".cursor/rules/global.mdc", [], true)]
    });
    expect(result.rules[0].matchType).toBe("alwaysApply");
    expect(result.rules[0].suggestedGlobs).toBeUndefined();
  });

  it("skills[] and rules[] are sorted by path for determinism", () => {
    const opts: AgentManifestOptions = {
      task: "task",
      packedFiles: [{ path: "packages/core/a.ts" }],
      skills: [
        skill("ctx-packages-core", ["packages/core"]),
        skill("ctx-aaa", [], true),
        skill("ctx-zzz", [], true)
      ],
      rules: []
    };
    const r1 = buildAgentManifest(opts);
    const r2 = buildAgentManifest(opts);
    const paths1 = r1.skills.map((s) => s.path);
    const paths2 = r2.skills.map((s) => s.path);
    expect(paths1).toEqual(paths2);
    expect(paths1).toEqual([...paths1].sort());
  });

  it("two identical runs produce identical output (determinism)", () => {
    const opts: AgentManifestOptions = {
      task: "fix race in tokenLedger",
      packedFiles: [
        { path: "packages/core/src/sync/syncReport.ts" },
        { path: "packages/cli/src/index.ts" }
      ],
      skills: [
        skill("ctx-packages-core", ["packages/core"]),
        skill("ctx-packages-cli", [], false),
        skill("ctx-packages-mcp", [])
      ],
      rules: [
        rule(".cursor/rules/contextforge.mdc", [], true),
        rule(".cursor/rules/ctx-packages-core.mdc", ["packages/core"])
      ]
    };
    const r1 = buildAgentManifest(opts);
    const r2 = buildAgentManifest(opts);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("schemaVersion is always 1.0.0", () => {
    const result = buildAgentManifest({
      task: "t",
      packedFiles: [],
      skills: [],
      rules: []
    });
    expect(result.schemaVersion).toBe("1.0.0");
  });
});
