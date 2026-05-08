# ContextForge Agent Rules

## Mission

Build and maintain a token-efficient CLI that generates:

- structural graphs
- context packs
- SDD specs
- implementation plans

## Defaults

- Prefer deterministic analysis over LLM inference.
- Never reload the full repository if a graph or context pack already exists.
- Validate all machine-readable outputs against JSON Schema.
- Keep prompts short, explicit, and task-scoped.
- Prefer minimal diffs and minimal file touches.

## Repo conventions

- Runtime: Node.js >= 22
- Package manager: pnpm
- Monorepo packages live under `packages/`
- Generated artifacts live under `.contextforge/`

## Command policy

- `forge scan` must not call any LLM.
- `forge graph` should stay deterministic by default.
- `forge context` may summarize only when budget requires it.
- `forge spec` **prepares the input** for OpenSpec — it does not duplicate
  OpenSpec's logic. With `openspec` CLI in PATH it delegates scaffolding to
  `openspec new change`. Without it, the fallback emits the same modern
  format (`### Requirement:` + `#### Scenario:`) so `openspec validate`
  passes once the CLI is installed.
- `forge implement` defaults to plan-only unless explicitly allowed to edit.

## For agents working in this repo

Before reading files, read `.contextforge/agent-context.md` first — it lists
all available artifacts (graph, context-pack, spec-input, manifest) plus the
SDD recipe. Do not re-scan the repo if `.contextforge/context-pack.json`
already exists for the current task.

The deeper rationale (3 roles, token-savings math, prompt caching multiplier)
lives in [`docs/explanation/contextforge-and-openspec.md`](docs/explanation/contextforge-and-openspec.md).

## Output policy

- JSON outputs: no prose outside schema.
- Markdown specs: concise, testable, implementation-oriented. Each
  Requirement MUST have at least one `#### Scenario:` with Given/When/Then.
