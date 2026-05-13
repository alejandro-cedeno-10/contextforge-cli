#!/usr/bin/env node
// Refresh ContextForge graph deterministically. Used by:
// - `postinstall` (after `pnpm install`)
// - `.husky/pre-push` (before pushing new code)
// - Manual invocation: `node scripts/forge-rebuild.mjs`
//
// Cross-platform (Windows / macOS / Linux). Silent on success; logs to
// `.contextforge/auto-rebuild.log` so it never floods install/push output.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import path from "node:path";

const root = process.cwd();
const logDir = path.join(root, ".contextforge");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, "auto-rebuild.log");
const logStream = createWriteStream(logPath, { flags: "a" });
const stamp = new Date().toISOString();
logStream.write(`\n=== forge-rebuild @ ${stamp} ===\n`);

const shouldSkip = process.env.CONTEXTFORGE_SKIP_REBUILD === "1";
if (shouldSkip) {
  logStream.write("Skipped via CONTEXTFORGE_SKIP_REBUILD=1\n");
  logStream.end();
  process.exit(0);
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      shell: process.platform === "win32",
      env: { ...process.env, CONTEXTFORGE_SKIP_REBUILD: "1" }
    });
    child.stdout?.on("data", (chunk) => logStream.write(chunk));
    child.stderr?.on("data", (chunk) => logStream.write(chunk));
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (err) => {
      logStream.write(`spawn error: ${err.message}\n`);
      resolve(1);
    });
  });
}

const verbose = process.argv.includes("--verbose");

(async () => {
  const scanCode = await run("pnpm", ["forge", "scan"]);
  if (scanCode !== 0) {
    if (verbose)
      console.error("forge scan failed (see .contextforge/auto-rebuild.log)");
    logStream.end();
    process.exit(0); // never block install/push
  }

  const graphCode = await run("pnpm", ["forge", "graph"]);
  if (graphCode !== 0) {
    if (verbose)
      console.error("forge graph failed (see .contextforge/auto-rebuild.log)");
  }

  logStream.write("done\n");
  logStream.end();
  // Never propagate non-zero — graph refresh is best-effort.
  process.exit(0);
})();
