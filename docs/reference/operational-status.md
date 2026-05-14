# Operational Status

> Reference doc — refreshed every release. States what is verified to work,
> what conditions of use apply, and what residual risks exist. Honest, no
> marketing.

**Last reviewed**: 2026-05-13 (release `v0.4.2`).

---

## What is solid

| Component                                                            | Status | Evidence                                                                         |
| -------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| Deterministic parser (graph)                                         | OK     | `packages/core/src/parser/treeSitter.ts`, `PARSER_VERSION = heuristic-4`         |
| Graph builder + `external-symbol` nodes                              | OK     | `graphTier4.unit.test.ts` (13/13)                                                |
| Schema validation (AJV, 8 schemas)                                   | OK     | `validator.unit.test.ts` covers load + failure paths                             |
| MCP server (13 tools)                                                | OK     | `handlers.unit.test.ts` + CLI full-pipeline integ test                           |
| OpenSpec interop (`forge_spec` → real `openspec new change`)         | OK     | `execSync('openspec new change …')` at `packages/mcp/src/handlers.ts:1654`       |
| Deterministic fallback when `openspec` is missing                    | OK     | Emits `### Requirement` + `#### Scenario` format accepted by `openspec validate` |
| `forge_archive_change` wraps `openspec archive` + rebuild            | OK     | `openspec.unit.test.ts`                                                          |
| `skillLoader` (`.claude/skills` + `.cursor/rules`)                   | OK     | `skillLoader.unit.test.ts`                                                       |
| Husky pre-commit (lint-staged) + pre-push (graph refresh)            | OK     | Smoke tested; pre-commit fires `prettier --write` + `eslint --fix`               |
| Bootstrap from zero (no `.contextforge/`)                            | OK     | `forge_rebuild_graph` creates `scan.json` + `graph.json` + cache                 |
| Orchestration skill installer (`forge init` + `forge install-skill`) | OK     | Writes `.claude/skills/contextforge-openspec.md`; idempotent w/o `--force`       |

Total unit/integration tests: **366/366** passing on Linux CI.

---

## Conditions of use (not bugs)

1. **Node 22 required**. `engines: ">=22.0.0"`. Node 20 runs with a warning
   but is not supported. Use the local toolchain or the Docker image
   (`ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest`).

2. **`openspec` should be on `PATH`** for `forge_spec` to use the official
   CLI. Without it, the deterministic fallback emits a byte-compatible
   format (`openspec validate` still passes), but you lose any custom
   templates configured in your OpenSpec install. Check with `which
openspec` (Linux/macOS) or `where openspec` (Windows).

3. **First graph build costs ~1–3 s** in medium repos: the first
   `forge_rebuild_graph` parses every file. Subsequent runs reuse the
   per-file cache (`.contextforge/graph.cache.json`) keyed by content
   hash, so they finish in microseconds.

4. **Release pipeline runs asynchronously**. After tagging `vX.Y.Z`:
   - `release.yml` creates the GitHub Release.
   - `publish.yml` publishes the three packages to npmjs.com.
   - `docker.yml` builds + pushes the multi-arch MCP image to GHCR.

   Until those workflows close green, `pnpm add` and `docker pull` still
   serve the previous tag. Verify with:

   ```sh
   npm view @anai-raia-alex/contextforge-cli version
   ```

5. **Windows tmpdir occasionally flakes** during local `vitest` runs with
   `EBUSY: rmdir`. It's filesystem contention, not a product bug.
   Re-running the same command passes. CI runs on Linux and is not
   affected.

6. **`.contextforge/graph.cache.json` auto-invalidates** on `PARSER_VERSION`
   bumps. If you check out an older branch, the first graph build will
   re-parse everything once.

---

## End-to-end flow (Claude + MCP + OpenSpec, no shell)

```text
1. openspec installed globally (you already have this).
2. pnpm add -D @anai-raia-alex/contextforge-mcp   (or `docker pull …`)
3. ~/.claude.json → mcpServers contextforge block.
4. Restart Claude Code.

In chat:
You:    "Start a change to refactor the pricing module."
Claude: forge_status            → "no artifacts yet"
        forge_rebuild_graph     → scan + graph + cache
        forge_context           → context-pack for "pricing refactor"
        forge_spec pricing-refactor
                                → execSync('openspec new change pricing-refactor') ← your real openspec
                                → writes graph.subset.json + context.md + agent-manifest.json
        forge_change_subgraph   → reads the frozen subgraph
        [edits files in the subset]
        forge_implement         → guardrail plan
        forge_check             → diff validation
        forge_archive_change    → execSync('openspec archive pricing-refactor') + parent rebuild
```

OpenSpec keeps owning its full lifecycle (proposal / design / tasks / specs
templates, `validate`, `archive`). ContextForge adds exactly three files per
change inside `openspec/changes/<id>/`: `graph.subset.json`, `context.md`,
`agent-manifest.json`. It never renames or rewrites anything OpenSpec owns.

---

## Residual risk

- **Multi-line imports in the parser**: the regex captures only single-line
  `import … from '…'`. Multi-line imports still emit a `file → package`
  edge but skip per-export `external-symbol` nodes. Deliberate scope
  (regex-based parser, not AST). A full tree-sitter pass is on the roadmap.

- **`forge_spec` with a `change_id` that already exists**: `mkdir
-p` does not fail, but `openspec new change` will. The handler surfaces
  stderr; pick a different slug.

- **Stale subgraph between concurrent changes**: if two active changes touch
  the same domain, the subgraph of the one you opened first goes stale
  until the next `forge_archive_change` (which triggers a refresh of all
  active subgraphs). Manual workaround: call `forge_change_subgraph`
  again on the lagging change.

- **`pnpm install` postinstall in non-clone consumers**: the root
  `postinstall` runs `scripts/forge-rebuild.mjs`. Consumers installing
  `@anai-raia-alex/contextforge-*` from npm do not get the root
  `postinstall` (only published `files: ["dist", "README.md"]`). Hooks
  are scoped to repository contributors.

---

## Verdict

With Node 22, `openspec` on `PATH`, and the MCP wired in `~/.claude.json`, you
can drive the full flow through Claude without touching `pnpm forge`.
OpenSpec stays the source of truth. ContextForge layers subgraph + context
map + agent-manifest on top without asking permission. Not perfect (regex
parser has limits; multi-arch Docker hardening landed late in v0.4.1) but
production-grade for the documented use case.

---

## Manual verification checklist

Run these in a fresh clone to confirm the operational status for yourself:

```sh
node --version                                 # >= 22
which openspec                                 # path to openspec CLI
pnpm install                                   # postinstall builds graph
pnpm typecheck                                 # tsc -b --force
pnpm lint                                      # eslint + prettier --check
pnpm test                                      # 366/366 expected
pnpm forge init                                # bootstraps .contextforge + installs skill
ls .claude/skills/contextforge-openspec.md     # skill file present
npm view @anai-raia-alex/contextforge-cli version   # matches the tag you released
```

If any line fails, refer to the matching row in **Conditions of use** or
**Residual risk** above before declaring a regression.
