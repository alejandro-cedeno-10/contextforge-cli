#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..", "..", "docs", "schemas");
const dst = path.resolve(here, "..", "dist", "schemas");

let srcStat;
try {
  srcStat = statSync(src);
} catch (err) {
  console.error(`[copy-schemas] source dir missing: ${src}`);
  process.exit(1);
}
if (!srcStat.isDirectory()) {
  console.error(`[copy-schemas] not a directory: ${src}`);
  process.exit(1);
}

mkdirSync(dst, { recursive: true });

let copied = 0;
for (const entry of readdirSync(src)) {
  if (!entry.endsWith(".schema.json")) continue;
  copyFileSync(path.join(src, entry), path.join(dst, entry));
  copied += 1;
}

console.log(`[copy-schemas] copied ${copied} file(s) → ${dst}`);
