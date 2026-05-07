import { describe, expect, it } from "vitest";

import { validateGuardrails } from "../src/implement/validator";
import type { Guardrails } from "../src/implement/validator";

const base: Guardrails = {
  allowedFiles: ["src/auth.ts", "src/token.ts"],
  forbiddenPaths: ["**/.env*", "**/secrets/**", "**/.git/**"],
  maxLocDelta: 100
};

describe("validateGuardrails", () => {
  it("passes when all changes are within guardrails", () => {
    const result = validateGuardrails(["src/auth.ts"], 50, base);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("includes ranAt timestamp", () => {
    const result = validateGuardrails([], 0, base);
    expect(result.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("violation when file matches forbiddenPaths glob", () => {
    const result = validateGuardrails([".env.local"], 5, base);
    const v = result.violations.find((v) => v.rule === "forbiddenPath");
    expect(v).toBeDefined();
    expect(v?.file).toBe(".env.local");
    expect(result.passed).toBe(false);
  });

  it("violation for file inside secrets/ dir", () => {
    const result = validateGuardrails(["config/secrets/key.json"], 5, base);
    expect(result.violations.some((v) => v.rule === "forbiddenPath")).toBe(
      true
    );
  });

  it("violation when file is outside allowedFiles", () => {
    const result = validateGuardrails(["src/other.ts"], 10, base);
    expect(
      result.violations.some((v) => v.rule === "outsideAllowedFiles")
    ).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("no outsideAllowedFiles violation when allowedFiles is empty", () => {
    const result = validateGuardrails(["src/anything.ts"], 10, {
      ...base,
      allowedFiles: []
    });
    expect(
      result.violations.some((v) => v.rule === "outsideAllowedFiles")
    ).toBe(false);
  });

  it("violation when locDelta exceeds maxLocDelta", () => {
    const result = validateGuardrails(["src/auth.ts"], 200, base);
    const v = result.violations.find((v) => v.rule === "maxLocDelta");
    expect(v).toBeDefined();
    expect(result.passed).toBe(false);
  });

  it("passes when locDelta equals maxLocDelta", () => {
    const result = validateGuardrails(["src/auth.ts"], 100, base);
    expect(result.violations.some((v) => v.rule === "maxLocDelta")).toBe(false);
  });

  it("violation when files count exceeds maxFilesChanged", () => {
    const guardrails: Guardrails = {
      ...base,
      allowedFiles: ["a.ts", "b.ts", "c.ts"],
      maxFilesChanged: 2
    };
    const result = validateGuardrails(["a.ts", "b.ts", "c.ts"], 30, guardrails);
    expect(result.violations.some((v) => v.rule === "maxFilesChanged")).toBe(
      true
    );
  });

  it("no maxFilesChanged violation when field is undefined", () => {
    const result = validateGuardrails(
      ["src/auth.ts", "src/token.ts", "src/extra.ts"],
      10,
      { ...base, allowedFiles: ["src/auth.ts", "src/token.ts", "src/extra.ts"] }
    );
    expect(result.violations.some((v) => v.rule === "maxFilesChanged")).toBe(
      false
    );
  });

  it("multiple violations reported together", () => {
    const result = validateGuardrails(["src/other.ts", ".env"], 500, base);
    const rules = result.violations.map((v) => v.rule);
    expect(rules).toContain("outsideAllowedFiles");
    expect(rules).toContain("forbiddenPath");
    expect(rules).toContain("maxLocDelta");
    expect(result.passed).toBe(false);
  });
});
