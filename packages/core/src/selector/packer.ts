export type FileMode = "full" | "excerpt" | "summary";

export type InclusionReason =
  | "seed"
  | "direct_import"
  | "transitive_dep"
  | "manual";

export interface ScoredFile {
  filePath: string;
  score: number;
  kind: string;
  estimatedFullTokens: number;
  hash?: string;
  isSeed?: boolean;
}

export interface PackedFile {
  path: string;
  reason: InclusionReason;
  mode: FileMode;
  hash?: string;
}

export interface PackResult {
  files: PackedFile[];
  excluded: string[];
  estimatedTokens: number;
}

const EXCERPT_TOKENS = 200;
const SUMMARY_TOKENS = 50;

function inferReason(f: ScoredFile, rank: number): InclusionReason {
  if (f.isSeed) return "seed";
  if (rank === 0) return "direct_import";
  return "transitive_dep";
}

export function packFiles(
  candidates: ScoredFile[],
  budget: number
): PackResult {
  if (candidates.length === 0) {
    return { files: [], excluded: [], estimatedTokens: 0 };
  }

  // Highest score first.
  const sorted = [...candidates].sort((a, b) => b.score - a.score);

  const modes = new Map<string, FileMode>(
    sorted.map((c) => [c.filePath, "full"])
  );

  let total = sorted.reduce((s, c) => s + c.estimatedFullTokens, 0);

  // Pass 1: full → excerpt (cheapest files first = lowest score = last in sorted).
  for (let i = sorted.length - 1; i >= 0 && total > budget; i--) {
    const c = sorted[i]!;
    if (modes.get(c.filePath) === "full") {
      total -= c.estimatedFullTokens - EXCERPT_TOKENS;
      modes.set(c.filePath, "excerpt");
    }
  }

  if (total <= budget) return buildResult(sorted, modes, total);

  // Pass 2: excerpt → summary.
  for (let i = sorted.length - 1; i >= 0 && total > budget; i--) {
    const c = sorted[i]!;
    if (modes.get(c.filePath) === "excerpt") {
      total -= EXCERPT_TOKENS - SUMMARY_TOKENS;
      modes.set(c.filePath, "summary");
    }
  }

  if (total <= budget) return buildResult(sorted, modes, total);

  // Pass 3: exclude lowest-score files.
  const excluded: string[] = [];
  for (let i = sorted.length - 1; i >= 0 && total > budget; i--) {
    const c = sorted[i]!;
    total -= SUMMARY_TOKENS;
    modes.delete(c.filePath);
    excluded.push(c.filePath);
  }

  return {
    files: sorted
      .filter((c) => modes.has(c.filePath))
      .map((c, idx) => ({
        path: c.filePath,
        reason: inferReason(c, idx),
        mode: modes.get(c.filePath)!,
        hash: c.hash
      })),
    excluded,
    estimatedTokens: Math.max(0, total)
  };
}

function buildResult(
  sorted: ScoredFile[],
  modes: Map<string, FileMode>,
  total: number
): PackResult {
  return {
    files: sorted.map((c, idx) => ({
      path: c.filePath,
      reason: inferReason(c, idx),
      mode: modes.get(c.filePath) ?? "summary",
      hash: c.hash
    })),
    excluded: [],
    estimatedTokens: total
  };
}
