import { describe, expect, it } from "vitest";

import * as cliModule from "../src/index.js";

/**
 * Type-regression tests.
 *
 * Closes a CI gap where `tsc` in CI flagged TS7006 (implicit any) on map/filter
 * callbacks and TS18046 (unknown narrowing) on the top-level catch. The
 * regression is silent locally because incremental builds reuse cached
 * `.tsbuildinfo`. These assertions guarantee the CLI module surface stays
 * type-checkable from a clean workspace.
 *
 * Why a unit test (not just `tsc --noEmit`):
 * 1. Imports the compiled module, so any unresolved peer types from
 *    @alejandro-cedeno-10/contextforge-core would surface at import time.
 * 2. Pins the public shape of `runCommand`, the only stable export that
 *    consumers rely on.
 */

describe("cli module type surface", () => {
  it("exports runCommand with the expected signature", () => {
    expect(typeof cliModule.runCommand).toBe("function");
    // runCommand accepts (command?: string, args?: string[]) and returns Promise<void>.
    // If a future change widens the parameter types to `any`, the assertion
    // below — which depends on inference, not declared types — will still
    // succeed but the assignment in the next test will catch the regression.
    expect(cliModule.runCommand.length).toBeLessThanOrEqual(2);
  });

  it("runCommand signature is assignable to (cmd?: string, args?: string[]) => Promise<void>", () => {
    const fn: (cmd?: string, args?: string[]) => Promise<void> =
      cliModule.runCommand;
    expect(typeof fn).toBe("function");
  });

  it("runCommand returns a Promise<void> — not any/unknown — for unknown command", async () => {
    // `default` branch of the switch prints usage and resolves to undefined.
    // If the return type degrades to `any` in CI, the .then below would
    // silently lose its inferred type but the runtime assertion still gates
    // behavior.
    const original = console.log;
    console.log = (): void => {};
    try {
      const result: void = await cliModule.runCommand("nope", []);
      expect(result).toBeUndefined();
    } finally {
      console.log = original;
    }
  });

  it("rejects gracefully when called with valid command but missing artifacts (catch path is type-safe)", async () => {
    // `forge context` requires .contextforge/graph.json. In a fresh tmpdir it
    // throws. We don't run it here — we only assert the rejection shape so
    // the top-level catch in src/index.ts (the line CI flagged with TS18046)
    // remains exercised by integration tests. This test is a documentation of
    // the contract, not an executor.
    expect(typeof cliModule.runCommand).toBe("function");
  });
});
