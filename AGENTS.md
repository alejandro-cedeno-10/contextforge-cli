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
- `forge spec` must produce an actionable SDD spec.
- `forge implement` defaults to plan-only unless explicitly allowed to edit.

## Output policy

- JSON outputs: no prose outside schema.
- Markdown specs: concise, testable, implementation-oriented.
