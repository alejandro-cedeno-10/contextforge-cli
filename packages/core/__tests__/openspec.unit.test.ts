import { describe, expect, it } from "vitest";

import {
  buildOpenSpec,
  inferDomain,
  validateOpenSpecFiles
} from "../src/spec/openspec";

describe("inferDomain", () => {
  it("returns core for empty file list", () => {
    expect(inferDomain([])).toBe("core");
  });

  it("infers domain from packages/<pkg>/src/<domain>/...", () => {
    const files = [
      "packages/auth/src/login/handler.ts",
      "packages/auth/src/login/utils.ts"
    ];
    expect(inferDomain(files)).toBe("login");
  });

  it("infers domain from src/<domain>/...", () => {
    expect(inferDomain(["src/scanner/index.ts", "src/scanner/cache.ts"])).toBe(
      "scanner"
    );
  });

  it("picks the domain with the most files", () => {
    const files = ["src/scanner/a.ts", "src/scanner/b.ts", "src/graph/c.ts"];
    expect(inferDomain(files)).toBe("scanner");
  });

  it("falls back to core for unrecognised paths", () => {
    expect(inferDomain(["some/deep/path/file.ts"])).toBe("core");
  });
});

describe("buildOpenSpec", () => {
  const base = {
    changeId: "fix-auth",
    task: "Arreglar autenticacion",
    affectedFiles: [] as Array<{ path: string; reason: string; mode: string }>
  };

  it("produces exactly 4 output files", () => {
    const result = buildOpenSpec(base);
    expect(result.files).toHaveLength(4);
  });

  it("sets changeDir to openspec/changes/<changeId>", () => {
    const result = buildOpenSpec({ ...base, changeId: "my-change" });
    expect(result.changeDir).toBe("openspec/changes/my-change");
  });

  it("all file paths are under changeDir", () => {
    const result = buildOpenSpec({ ...base, changeId: "my-change" });
    expect(
      result.files.every((f) => f.path.startsWith("openspec/changes/my-change"))
    ).toBe(true);
  });

  it("proposal.md contains the task text", () => {
    const result = buildOpenSpec({
      ...base,
      task: "Implementar feature de reset de password"
    });
    const proposal = result.files.find((f) => f.path.endsWith("proposal.md"))!;
    expect(proposal.content).toContain(
      "Implementar feature de reset de password"
    );
  });

  it("tasks.md contains T-items for non-summary files", () => {
    const result = buildOpenSpec({
      ...base,
      affectedFiles: [
        { path: "src/a.ts", reason: "seed", mode: "full" },
        { path: "src/b.ts", reason: "direct_import", mode: "excerpt" },
        { path: "src/c.ts", reason: "transitive_dep", mode: "summary" }
      ]
    });
    const tasks = result.files.find((f) => f.path.endsWith("tasks.md"))!;
    expect(tasks.content).toContain("T1");
    expect(tasks.content).toContain("T2");
    expect(tasks.content).toContain("src/a.ts");
    expect(tasks.content).toContain("src/b.ts");
    // summary file should NOT get a task line
    expect(tasks.content).not.toContain("src/c.ts");
  });

  it("delta spec uses ADDED/MODIFIED/REMOVED sections", () => {
    const result = buildOpenSpec(base);
    const spec = result.files.find((f) => f.path.includes("/specs/"))!;
    expect(spec.content).toContain("## ADDED Requirements");
    expect(spec.content).toContain("## MODIFIED Requirements");
    expect(spec.content).toContain("## REMOVED Requirements");
  });

  it("uses provided domain override", () => {
    const result = buildOpenSpec({ ...base, domain: "payments" });
    expect(result.files.some((f) => f.path.includes("/specs/payments/"))).toBe(
      true
    );
  });

  it("does not reference the obsolete --emit openspec flag", () => {
    const result = buildOpenSpec(base);
    for (const file of result.files) {
      expect(file.content).not.toContain("--emit openspec");
    }
  });
});

describe("validateOpenSpecFiles", () => {
  const validFiles = (changeId = "x") =>
    buildOpenSpec({ changeId, task: "t", affectedFiles: [] }).files;

  it("returns no issues for buildOpenSpec output", () => {
    expect(validateOpenSpecFiles(validFiles())).toEqual([]);
  });

  it("flags missing proposal.md", () => {
    const files = validFiles().filter((f) => !f.path.endsWith("proposal.md"));
    const issues = validateOpenSpecFiles(files);
    expect(issues.some((i) => i.rule === "missing-file")).toBe(true);
  });

  it("flags proposal.md missing ## Intent section", () => {
    const files = validFiles().map((f) =>
      f.path.endsWith("proposal.md")
        ? { ...f, content: "# Proposal\n\nNo Intent section here." }
        : f
    );
    const issues = validateOpenSpecFiles(files);
    expect(
      issues.some(
        (i) => i.rule === "missing-section" && i.detail.includes("## Intent")
      )
    ).toBe(true);
  });

  it("flags missing delta spec under specs/<domain>/", () => {
    const files = validFiles().filter((f) => !f.path.includes("/specs/"));
    const issues = validateOpenSpecFiles(files);
    expect(
      issues.some(
        (i) =>
          i.rule === "missing-file" && i.file.includes("specs/<domain>/spec.md")
      )
    ).toBe(true);
  });

  it("flags delta spec without ADDED/MODIFIED/REMOVED headings", () => {
    const files = validFiles().map((f) =>
      f.path.includes("/specs/")
        ? { ...f, content: "# Delta\nNo proper headings." }
        : f
    );
    const issues = validateOpenSpecFiles(files);
    expect(issues.some((i) => i.rule === "missing-delta-section")).toBe(true);
  });

  it("accepts a delta spec that has ADDED Requirements only", () => {
    const minimal = [
      {
        path: "openspec/changes/x/proposal.md",
        content: "# P\n## Intent\nx\n## Scope\ny"
      },
      {
        path: "openspec/changes/x/design.md",
        content: "# D\n## Technical approach\nz"
      },
      {
        path: "openspec/changes/x/tasks.md",
        content: "# T\n## Implementation checklist\n- [ ] T1"
      },
      {
        path: "openspec/changes/x/specs/core/spec.md",
        content: "# S\n## ADDED Requirements\n- foo MUST bar"
      }
    ];
    expect(validateOpenSpecFiles(minimal)).toEqual([]);
  });
});
