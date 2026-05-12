#!/usr/bin/env node
// ContextForge guardrail gate — runs before every `git commit`.
// Exit 2 = block commit + inject violations as feedback to the agent.
// Exit 0 = allow commit.
//
// Cross-platform (Windows / macOS / Linux). Invoked by Claude Code via
// `node .claude/hooks/forge-pre-commit.mjs`.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const planPath = path.join(process.cwd(), ".contextforge", "implement-plan.json");
if (!existsSync(planPath)) {
  process.exit(0);
}

const result = spawnSync("pnpm", ["forge", "implement", "--check"], {
  stdio: "inherit",
  // `pnpm` resolves to a .cmd shim on Windows; `shell: true` lets node find it.
  shell: process.platform === "win32"
});

if (result.status === 0) {
  process.exit(0);
}

console.error("");
console.error("=== ContextForge guardrail check FAILED ===");
console.error("Fix violations before committing. Run: pnpm forge implement --check");
process.exit(2);
