import { describe, expect, it } from "vitest";

import { buildHealthReport } from "../src/impact/healthCheck";

const NOW = Date.now();

describe("buildHealthReport", () => {
  it("flags missing artifact with exists=false and a warning", () => {
    const report = buildHealthReport({
      artifacts: [{ name: "scan.json", exists: false }],
      graphDomains: [],
      skillTags: []
    });

    expect(report.artifacts[0]).toMatchObject({
      name: "scan.json",
      exists: false
    });
    expect(report.artifacts[0].warning).toBeDefined();
    expect(report.warnings.some((w) => w.includes("scan.json missing"))).toBe(
      true
    );
  });

  it("computes small ageMinutes for recent mtimeMs", () => {
    const report = buildHealthReport({
      artifacts: [
        {
          name: "scan.json",
          exists: true,
          mtimeMs: NOW - 60_000,
          parsed: { files: [] }
        }
      ],
      graphDomains: [],
      skillTags: []
    });

    expect(report.artifacts[0].exists).toBe(true);
    expect(report.artifacts[0].ageMinutes).toBeGreaterThanOrEqual(1);
    expect(report.artifacts[0].ageMinutes).toBeLessThanOrEqual(2);
    expect(report.artifacts[0].warning).toBeUndefined();
  });

  it("warns when graph scan hash mismatches scan file hash", () => {
    const report = buildHealthReport({
      artifacts: [
        {
          name: "graph.json",
          exists: true,
          mtimeMs: NOW,
          parsed: { nodes: [], edges: [] }
        }
      ],
      graphScanHash: "aaa",
      scanFileHash: "bbb",
      graphDomains: [],
      skillTags: []
    });

    expect(report.warnings.some((w) => w.includes("graph stale"))).toBe(true);
    expect(report.artifacts[0].warning).toContain("hash mismatch");
  });

  it("computes budgetUsedPct ~97% and warns when above 90%", () => {
    const report = buildHealthReport({
      artifacts: [
        {
          name: "context-pack.json",
          exists: true,
          mtimeMs: NOW,
          parsed: { files: [], budget: { estimatedTokens: 11700 } }
        }
      ],
      contextPackTokens: 11700,
      contextPackBudget: 12000,
      graphDomains: [],
      skillTags: []
    });

    expect(report.budgetUsedPct).toBeCloseTo(97.5, 1);
    expect(report.warnings.some((w) => w.includes("context-pack budget"))).toBe(
      true
    );
  });

  it("counts uncovered domains correctly when 1 of 3 has no skill", () => {
    const report = buildHealthReport({
      artifacts: [],
      graphDomains: ["packages/core", "packages/cli", "packages/mcp"],
      skillTags: [["core"], ["cli"]]
    });

    expect(report.coverage.totalSkills).toBe(2);
    expect(report.coverage.coveredDomains).toContain("packages/core");
    expect(report.coverage.coveredDomains).toContain("packages/cli");
    expect(report.coverage.uncoveredDomains).toEqual(["packages/mcp"]);
  });

  it("marks all domains uncovered when skillTags is empty", () => {
    const report = buildHealthReport({
      artifacts: [],
      graphDomains: ["packages/core", "docs"],
      skillTags: []
    });

    expect(report.coverage.uncoveredDomains).toEqual(["packages/core", "docs"]);
    expect(report.coverage.coveredDomains).toEqual([]);
  });

  it("treats 'all-domains' tag as universal coverage", () => {
    const report = buildHealthReport({
      artifacts: [],
      graphDomains: ["packages/core", "packages/cli", "packages/mcp"],
      skillTags: [["all-domains"]]
    });

    expect(report.coverage.uncoveredDomains).toEqual([]);
  });

  it("propagates savingsPct from token-ledger.json artifact", () => {
    const report = buildHealthReport({
      artifacts: [
        {
          name: "token-ledger.json",
          exists: true,
          mtimeMs: NOW,
          parsed: { savings: { savingsPct: 90.3 } }
        }
      ],
      graphDomains: [],
      skillTags: []
    });

    expect(report.savingsPct).toBe(90.3);
    expect(report.artifacts[0].detail).toContain("90.3");
  });

  it("flags stale scan/graph/context-pack older than 60 minutes", () => {
    const report = buildHealthReport({
      artifacts: [
        {
          name: "scan.json",
          exists: true,
          mtimeMs: NOW - 120 * 60_000,
          parsed: { files: [] }
        }
      ],
      graphDomains: [],
      skillTags: []
    });

    expect(report.artifacts[0].warning).toContain("stale");
    expect(report.warnings.some((w) => w.includes("scan.json stale"))).toBe(
      true
    );
  });
});
