---
name: contextforge-skill-optimizer
description: How to read the ContextForge agent-manifest emitted by select_agent_context (skills + rules + hints + instruction)
alwaysApply: true
tags: [meta, manifest, skills]
---

# ContextForge — Skill optimizer

When you see an `agent-manifest` JSON in your context (from MCP tool
`select_agent_context`, file `.contextforge/agent-manifest.json`, or the
file `.claude/agent-manifest.md`) follow this protocol.

## Reading order

1. Read `instruction` first — it's the canonical directive for that turn.
2. For each entry in `skills[]`, the `hint` field (when present) tells you
   when that skill applies. Match against the current sub-task.
3. For each entry in `rules[]`, same — `hint` describes when to apply.
4. Load only the skill files whose hints align with what you're about to do.
5. `skipped[]` was filtered out as not relevant — do not load those files.
6. Prefer `matchType: alwaysApply` and `matchType: explicit` over
   `matchType: domain` when in doubt — those were chosen on stronger signals.

## Token discipline

The manifest is intentionally compact:

- Skipped entries carry no `hint` (you don't need to reason about them).
- The `instruction` is a short directive, not an explanation.
- Domains touched is a comma-separated list, ordered alphabetically.

Don't expand the manifest by reading every skill file. Read only the ones
the manifest tells you to.

## Regeneration

The manifest is regenerated every prompt by the `UserPromptSubmit` hook
(`select_agent_context` MCP tool). Trust the current selection over any
historical context from earlier turns — older selections are stale.

## When the manifest says "no skills matched"

That means PageRank picked files outside the declared skill domains. Proceed
using only the context-pack files and any project-level CLAUDE.md / AGENTS.md
guidance. Do not invent skill-based rules.

## Cross-agent compatibility

The same manifest format is consumed by:

- Claude Code (this skill) — via hook output
- OpenCode — via direct MCP tool call
- Cursor — via static `.cursor/rules/contextforge-active.mdc` (no runtime
  hook; selection happens at `forge context` time)

Schema version: `1.1.0` (`docs/schemas/agent-manifest.schema.json`).
