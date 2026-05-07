import { describe, expect, it } from "vitest";

import { packFiles } from "../src/selector/packer";
import type { ScoredFile } from "../src/selector/packer";

function makeFile(
  filePath: string,
  score: number,
  estimatedFullTokens: number,
  hash = "abc"
): ScoredFile {
  return { filePath, score, kind: "code", estimatedFullTokens, hash };
}

describe("packFiles", () => {
  it("returns empty result for empty candidates", () => {
    const result = packFiles([], 12000);
    expect(result.files).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.estimatedTokens).toBe(0);
  });

  it("keeps all files at full mode when within budget", () => {
    const candidates = [makeFile("a.ts", 0.9, 100), makeFile("b.ts", 0.5, 200)];

    const result = packFiles(candidates, 5000);

    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => f.mode === "full")).toBe(true);
    expect(result.excluded).toHaveLength(0);
    expect(result.estimatedTokens).toBe(300);
  });

  it("downgrades lowest-score files to excerpt when over budget", () => {
    // total full = 1000 + 2000 = 3000, budget = 1200
    // After downgrading low.ts (2000 -> 200): 1000 + 200 = 1200 = budget ✓
    // high.ts should remain "full"
    const candidates = [
      makeFile("high.ts", 0.9, 1000),
      makeFile("low.ts", 0.1, 2000)
    ];

    const result = packFiles(candidates, 1200);

    const high = result.files.find((f) => f.path === "high.ts")!;
    const low = result.files.find((f) => f.path === "low.ts")!;
    expect(high.mode).toBe("full");
    expect(low.mode).not.toBe("full");
  });

  it("excludes files when even summary mode exceeds budget", () => {
    // 10 files × 1000 tokens each, budget = 100 (can fit at most 2 summaries)
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeFile(`file${i}.ts`, (10 - i) * 0.1, 1000)
    );

    const result = packFiles(candidates, 100);

    expect(result.excluded.length).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThanOrEqual(100);
  });

  it("preserves score order: highest-score file is first in output", () => {
    const candidates = [
      makeFile("low.ts", 0.1, 100),
      makeFile("high.ts", 0.9, 100),
      makeFile("mid.ts", 0.5, 100)
    ];

    const result = packFiles(candidates, 5000);

    expect(result.files[0]?.path).toBe("high.ts");
    expect(result.files[1]?.path).toBe("mid.ts");
    expect(result.files[2]?.path).toBe("low.ts");
  });

  it("marks seed files with seed reason", () => {
    const candidates: ScoredFile[] = [
      {
        filePath: "seed.ts",
        score: 0.9,
        kind: "code",
        estimatedFullTokens: 100,
        isSeed: true
      },
      {
        filePath: "other.ts",
        score: 0.5,
        kind: "code",
        estimatedFullTokens: 100
      }
    ];

    const result = packFiles(candidates, 5000);

    expect(result.files.find((f) => f.path === "seed.ts")?.reason).toBe("seed");
  });
});
