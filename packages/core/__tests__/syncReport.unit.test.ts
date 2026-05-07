import { describe, expect, it } from "vitest";

import { buildSyncReport } from "../src/sync/syncReport";

describe("buildSyncReport", () => {
  it("returns empty report when no files changed", () => {
    const report = buildSyncReport({ changedFiles: [] });

    expect(report.changedFiles).toEqual([]);
    expect(report.affectedDomains.size).toBe(0);
    expect(report.graphStale).toBe(false);
    expect(report.contextPackAffected).toBe(false);
    expect(report.recommendations.some((r) => r.includes("Sin cambios"))).toBe(
      true
    );
  });

  it("groups changed files into 2 domains by getDomain", () => {
    const report = buildSyncReport({
      changedFiles: [
        "packages/core/src/scanner.ts",
        "packages/core/src/index.ts",
        "packages/cli/src/index.ts"
      ]
    });

    expect(report.affectedDomains.size).toBe(2);
    expect(report.affectedDomains.get("packages/core")).toBe(2);
    expect(report.affectedDomains.get("packages/cli")).toBe(1);
  });

  it("flags graphStale when graph hash differs from scan hash", () => {
    const report = buildSyncReport({
      changedFiles: ["packages/core/src/scanner.ts"],
      graphScanHash: "aaa",
      scanFileHash: "bbb"
    });

    expect(report.graphStale).toBe(true);
    expect(report.recommendations.some((r) => r.includes("forge scan"))).toBe(
      true
    );
  });

  it("does not flag graphStale when only one hash is provided", () => {
    const report = buildSyncReport({
      changedFiles: [],
      scanFileHash: "abc"
    });

    expect(report.graphStale).toBe(false);
  });

  it("flags contextPackAffected when a changed file is in the pack", () => {
    const report = buildSyncReport({
      changedFiles: ["packages/core/src/scanner.ts", "README.md"],
      contextPackPaths: ["packages/core/src/scanner.ts"],
      contextPackTask: "fix scanner"
    });

    expect(report.contextPackAffected).toBe(true);
    expect(
      report.recommendations.some(
        (r) => r.includes("forge context") && r.includes("fix scanner")
      )
    ).toBe(true);
  });

  it("infers domain for files outside packages/", () => {
    const report = buildSyncReport({
      changedFiles: ["docs/INDEX.md", "README.md", "src/util.ts"]
    });

    expect(report.affectedDomains.get("docs")).toBe(1);
    expect(report.affectedDomains.get("README.md")).toBe(1);
    expect(report.affectedDomains.get("src")).toBe(1);
  });

  it("recommends no rebuild when artifacts are coherent and changes exist", () => {
    const report = buildSyncReport({
      changedFiles: ["packages/core/src/scanner.ts"],
      graphScanHash: "abc",
      scanFileHash: "abc",
      contextPackPaths: ["packages/cli/src/index.ts"]
    });

    expect(report.graphStale).toBe(false);
    expect(report.contextPackAffected).toBe(false);
    expect(report.recommendations.some((r) => r.includes("coherentes"))).toBe(
      true
    );
  });

  it("uses default task hint when contextPackTask is missing", () => {
    const report = buildSyncReport({
      changedFiles: ["packages/core/src/scanner.ts"],
      contextPackPaths: ["packages/core/src/scanner.ts"]
    });

    expect(
      report.recommendations.some((r) => r.includes("descripcion de la tarea"))
    ).toBe(true);
  });
});
