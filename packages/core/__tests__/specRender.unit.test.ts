import { describe, expect, it } from "vitest";

import { renderSDD } from "../src/spec/render";
import type { SDDContext } from "../src/spec/render";

const base: SDDContext = {
  title: "Fix auth bug",
  task: "Arreglar el bug de autenticacion",
  affectedFiles: []
};

describe("renderSDD", () => {
  it("includes title in heading", () => {
    const out = renderSDD(base);
    expect(out).toContain("# Spec SDD: Fix auth bug");
  });

  it("includes task text", () => {
    const out = renderSDD(base);
    expect(out).toContain("Arreglar el bug de autenticacion");
  });

  it("lists affected files with path, reason and mode", () => {
    const out = renderSDD({
      ...base,
      affectedFiles: [{ path: "src/auth.ts", reason: "seed", mode: "full" }]
    });
    expect(out).toContain("`src/auth.ts`");
    expect(out).toContain("seed");
    expect(out).toContain("full");
  });

  it("shows placeholder when no files provided", () => {
    const out = renderSDD(base);
    expect(out).toContain("(ninguno seleccionado)");
  });

  it("includes default acceptance criteria with pnpm test", () => {
    const out = renderSDD(base);
    expect(out).toContain("Criterios de aceptacion");
    expect(out).toContain("pnpm test");
  });

  it("uses provided acceptance criteria", () => {
    const out = renderSDD({
      ...base,
      acceptanceCriteria: ["Coverage > 80%", "No regressions in CI"]
    });
    expect(out).toContain("Coverage > 80%");
    expect(out).toContain("No regressions in CI");
    // default criteria text should NOT appear
    expect(out).not.toContain("Los cambios pasan todos los tests existentes");
  });

  it("includes seed list when seeds provided", () => {
    const out = renderSDD({ ...base, seeds: ["src/auth.ts", "src/token.ts"] });
    expect(out).toContain("src/auth.ts");
    expect(out).toContain("src/token.ts");
  });

  it("shows placeholder when no seeds provided", () => {
    const out = renderSDD(base);
    expect(out).toContain("(ninguna semilla explicita)");
  });

  it("includes pnpm forge implement --check in plan de pruebas", () => {
    const out = renderSDD(base);
    expect(out).toContain("forge implement --check");
  });
});
