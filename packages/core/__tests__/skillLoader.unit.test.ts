import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadRuleEntries,
  loadSkillEntries,
  parseFrontmatter
} from "../src/manifest/skillLoader";

describe("parseFrontmatter", () => {
  it("returns empty object when there is no frontmatter block", () => {
    expect(parseFrontmatter("just body content\nno frontmatter here")).toEqual(
      {}
    );
  });

  it("parses name, domains, and alwaysApply when all present", () => {
    const content = [
      "---",
      "name: my-skill",
      "domains: [packages/core, packages/cli]",
      "alwaysApply: true",
      "---",
      "body"
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({
      name: "my-skill",
      domains: ["packages/core", "packages/cli"],
      alwaysApply: true
    });
  });

  it("parses partial frontmatter (name only)", () => {
    const content = ["---", "name: solo", "---", "body"].join("\n");
    expect(parseFrontmatter(content)).toEqual({ name: "solo" });
  });

  it("parses alwaysApply:false correctly", () => {
    const content = ["---", "alwaysApply: false", "---"].join("\n");
    expect(parseFrontmatter(content)).toEqual({ alwaysApply: false });
  });

  it("strips quotes from domain entries", () => {
    const content = [
      "---",
      'domains: ["packages/core", \'packages/cli\']',
      "---"
    ].join("\n");
    expect(parseFrontmatter(content).domains).toEqual([
      "packages/core",
      "packages/cli"
    ]);
  });
});

describe("loadSkillEntries", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(tmpdir(), "skillLoader-skills-"));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it("returns empty array when directory does not exist", async () => {
    const missing = path.join(workDir, "missing-subdir");
    expect(await loadSkillEntries(missing)).toEqual([]);
  });

  it("parses .md files and skips non-.md entries", async () => {
    await fs.writeFile(
      path.join(workDir, "a.md"),
      [
        "---",
        "name: skill-a",
        "domains: [packages/core]",
        "alwaysApply: true",
        "---",
        "body"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(workDir, "b.md"),
      "no frontmatter here",
      "utf8"
    );
    await fs.writeFile(path.join(workDir, "ignore.txt"), "skip me", "utf8");

    const result = await loadSkillEntries(workDir);
    const byPath = new Map(result.map((r) => [r.path, r]));

    expect(result).toHaveLength(2);
    expect(byPath.get(".claude/skills/a.md")).toEqual({
      path: ".claude/skills/a.md",
      name: "skill-a",
      domains: ["packages/core"],
      alwaysApply: true
    });
    expect(byPath.get(".claude/skills/b.md")).toEqual({
      path: ".claude/skills/b.md",
      name: "b",
      domains: [],
      alwaysApply: undefined
    });
  });
});

describe("loadRuleEntries", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(tmpdir(), "skillLoader-rules-"));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it("returns empty array when directory does not exist", async () => {
    const missing = path.join(workDir, "missing-subdir");
    expect(await loadRuleEntries(missing)).toEqual([]);
  });

  it("parses .mdc and .md files, skips other extensions", async () => {
    await fs.writeFile(
      path.join(workDir, "rule-a.mdc"),
      [
        "---",
        "domains: [packages/cli]",
        "alwaysApply: false",
        "---",
        "body"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(workDir, "rule-b.md"),
      "no frontmatter",
      "utf8"
    );
    await fs.writeFile(path.join(workDir, "ignore.txt"), "skip", "utf8");

    const result = await loadRuleEntries(workDir);
    const byPath = new Map(result.map((r) => [r.path, r]));

    expect(result).toHaveLength(2);
    expect(byPath.get(".cursor/rules/rule-a.mdc")).toEqual({
      path: ".cursor/rules/rule-a.mdc",
      description: undefined,
      domains: ["packages/cli"],
      alwaysApply: false
    });
    expect(byPath.get(".cursor/rules/rule-b.md")).toEqual({
      path: ".cursor/rules/rule-b.md",
      description: undefined,
      domains: [],
      alwaysApply: undefined
    });
  });
});
