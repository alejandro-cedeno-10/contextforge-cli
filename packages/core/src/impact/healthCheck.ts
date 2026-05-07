export interface ArtifactStatus {
  name: string;
  exists: boolean;
  ageMinutes?: number;
  detail?: string;
  warning?: string;
}

export interface SkillCoverage {
  totalSkills: number;
  coveredDomains: string[];
  uncoveredDomains: string[];
}

export interface HealthInput {
  artifacts: Array<{
    name: string;
    exists: boolean;
    mtimeMs?: number;
    parsed?: Record<string, unknown> | null;
  }>;
  graphScanHash?: string;
  scanFileHash?: string;
  contextPackTokens?: number;
  contextPackBudget?: number;
  graphDomains: string[];
  skillTags: string[][];
}

export interface HealthReport {
  artifacts: ArtifactStatus[];
  coverage: SkillCoverage;
  budgetUsedPct?: number;
  savingsPct?: number;
  warnings: string[];
}

const STALE_ARTIFACTS = new Set([
  "scan.json",
  "graph.json",
  "context-pack.json"
]);

const STALE_THRESHOLD_MIN = 60;

function tagCoversDomain(tag: string, domain: string): boolean {
  const t = tag.trim().toLowerCase();
  const d = domain.toLowerCase();
  if (!t) return false;
  if (t === "all" || t === "all-domains" || t === "*") return true;
  if (t === d) return true;
  if (d.startsWith("packages/") && t === d.slice("packages/".length)) {
    return true;
  }
  if (t.startsWith("packages/") && d === t.slice("packages/".length)) {
    return true;
  }
  return false;
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const now = Date.now();
  const warnings: string[] = [];

  const artifacts: ArtifactStatus[] = input.artifacts.map((a) => {
    if (!a.exists) {
      const warning = `${a.name} missing`;
      warnings.push(warning);
      return { name: a.name, exists: false, warning };
    }

    const ageMinutes =
      typeof a.mtimeMs === "number"
        ? Math.max(0, Math.round((now - a.mtimeMs) / 60000))
        : undefined;

    let detail: string | undefined;
    let warning: string | undefined;

    const parsed = a.parsed ?? null;
    if (parsed) {
      if (a.name === "scan.json" && Array.isArray(parsed.files)) {
        detail = `${(parsed.files as unknown[]).length} files indexed`;
      } else if (
        a.name === "graph.json" &&
        Array.isArray(parsed.nodes) &&
        Array.isArray(parsed.edges)
      ) {
        detail = `${(parsed.nodes as unknown[]).length} nodes, ${(parsed.edges as unknown[]).length} edges`;
      } else if (
        a.name === "context-pack.json" &&
        Array.isArray(parsed.files)
      ) {
        const tokens =
          (parsed.budget as { estimatedTokens?: number } | undefined)
            ?.estimatedTokens ?? 0;
        detail = `${(parsed.files as unknown[]).length} files, ~${tokens} tokens`;
      } else if (a.name === "implement-plan.json") {
        detail = `status: ${String(parsed.status ?? "unknown")}`;
      } else if (a.name === "token-ledger.json") {
        const savings = parsed.savings as { savingsPct?: number } | undefined;
        if (typeof savings?.savingsPct === "number") {
          detail = `savings ${savings.savingsPct}%`;
        }
      }
    }

    if (
      STALE_ARTIFACTS.has(a.name) &&
      typeof ageMinutes === "number" &&
      ageMinutes > STALE_THRESHOLD_MIN
    ) {
      warning = `stale (${ageMinutes}m old)`;
      warnings.push(`${a.name} stale (${ageMinutes}m)`);
    }

    return {
      name: a.name,
      exists: true,
      ...(typeof ageMinutes === "number" ? { ageMinutes } : {}),
      ...(detail ? { detail } : {}),
      ...(warning ? { warning } : {})
    };
  });

  const hasBothHashes =
    typeof input.graphScanHash === "string" &&
    typeof input.scanFileHash === "string";
  if (hasBothHashes && input.graphScanHash !== input.scanFileHash) {
    warnings.push("graph stale vs scan (hash mismatch)");
    const graphStatus = artifacts.find((x) => x.name === "graph.json");
    if (graphStatus) {
      graphStatus.warning = graphStatus.warning
        ? `${graphStatus.warning}; hash mismatch`
        : "hash mismatch with scan";
    }
  }

  let budgetUsedPct: number | undefined;
  if (
    typeof input.contextPackTokens === "number" &&
    typeof input.contextPackBudget === "number" &&
    input.contextPackBudget > 0
  ) {
    budgetUsedPct =
      Math.round(
        (input.contextPackTokens / input.contextPackBudget) * 100 * 10
      ) / 10;
    if (budgetUsedPct > 90) {
      const w = `context-pack budget at ${budgetUsedPct}%`;
      warnings.push(w);
      const ctx = artifacts.find((x) => x.name === "context-pack.json");
      if (ctx) {
        ctx.warning = ctx.warning ? `${ctx.warning}; ${w}` : w;
      }
    }
  }

  const ledger = input.artifacts.find((a) => a.name === "token-ledger.json");
  let savingsPct: number | undefined;
  const ledgerSavings = (
    ledger?.parsed?.savings as { savingsPct?: number } | undefined
  )?.savingsPct;
  if (typeof ledgerSavings === "number") {
    savingsPct = ledgerSavings;
  }

  const domains = Array.from(new Set(input.graphDomains));
  const covered = new Set<string>();
  for (const tags of input.skillTags) {
    for (const domain of domains) {
      if (covered.has(domain)) continue;
      if (tags.some((t) => tagCoversDomain(t, domain))) covered.add(domain);
    }
  }

  const coveredDomains = domains.filter((d) => covered.has(d));
  const uncoveredDomains = domains.filter((d) => !covered.has(d));

  if (uncoveredDomains.length > 0) {
    warnings.push(
      `${uncoveredDomains.length} domain(s) sin skill: ${uncoveredDomains.join(", ")}`
    );
  }

  return {
    artifacts,
    coverage: {
      totalSkills: input.skillTags.length,
      coveredDomains,
      uncoveredDomains
    },
    ...(typeof budgetUsedPct === "number" ? { budgetUsedPct } : {}),
    ...(typeof savingsPct === "number" ? { savingsPct } : {}),
    warnings
  };
}
