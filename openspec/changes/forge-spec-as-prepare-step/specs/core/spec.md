# Delta Spec: core

## ADDED Requirements

### Requirement: forge spec emits a deterministic spec-input artifact

The system MUST emit `.contextforge/spec-input.json` validated against the `spec-input` JSON Schema every time `forge spec` runs, regardless of whether OpenSpec CLI is installed. The artifact MUST include the change-id, task, inferred domain, affected files (from the context-pack), cross-domain dependencies (from the graph) and evidence references.

#### Scenario: spec-input is emitted with valid schema

- **Given** a valid `.contextforge/context-pack.json` exists
- **When** the developer runs `pnpm forge spec mi-feature`
- **Then** the system writes `.contextforge/spec-input.json` whose content validates against `docs/schemas/spec-input.schema.json`
- **And** the file contains `changeId: "mi-feature"`, `task` from the context-pack, and a non-empty `affectedFiles[]`

#### Scenario: missing context-pack fails with actionable error

- **Given** no `.contextforge/context-pack.json` exists
- **When** the developer runs `pnpm forge spec mi-feature`
- **Then** the system exits with a clear error suggesting `pnpm forge context "<tarea>"` as the next step

### Requirement: forge spec hands off to OpenSpec CLI when available

When the `openspec` CLI is available on `PATH`, the system MUST delegate change scaffolding to it via `openspec new change <id>`, then call `openspec instructions proposal --change <id> --json` to obtain the canonical instructions, and emit a combined `spec-prompt.md` for the developer to paste into an AI agent.

#### Scenario: OpenSpec CLI present triggers handoff mode

- **Given** `openspec --version` resolves successfully
- **When** the developer runs `pnpm forge spec mi-feature`
- **Then** the system calls `openspec new change mi-feature` (creating the directory skeleton)
- **And** emits `.contextforge/spec-prompt.md` containing the OpenSpec instructions plus the spec-input as inline context
- **And** prints next-step guidance referencing `openspec validate mi-feature`

#### Scenario: OpenSpec CLI handoff failure is recoverable

- **Given** the `openspec` binary is in PATH but `openspec new change` fails (e.g. permission error)
- **When** the developer runs `pnpm forge spec mi-feature`
- **Then** the system reports the failure with stderr captured
- **And** falls back to emit the change scaffold from ContextForge with the modern Requirement+Scenario format
- **And** exits with code 0 if the fallback succeeds

### Requirement: forge spec falls back to internal scaffold when OpenSpec CLI is absent

When `openspec --version` fails, the system MUST emit `openspec/changes/<id>/{proposal.md, design.md, tasks.md, specs/<domain>/spec.md}` itself, with the spec.md formatted using `### Requirement:` plus `#### Scenario:` blocks (Given/When/Then) so that the output validates against `openspec validate` once the CLI is later installed.

#### Scenario: fallback emits validatable spec.md

- **Given** the `openspec` binary is NOT in PATH
- **When** the developer runs `pnpm forge spec mi-feature`
- **Then** the system writes `openspec/changes/mi-feature/specs/<domain>/spec.md`
- **And** the file contains at least one `### Requirement: <title>` block with at least one `#### Scenario: <name>` and Given/When/Then bullets

#### Scenario: fallback output validates with later-installed OpenSpec CLI

- **Given** the developer runs `pnpm forge spec mi-feature` without OpenSpec CLI installed
- **And** later installs `openspec` globally
- **When** the developer runs `openspec validate mi-feature`
- **Then** the validation succeeds without manual edits to the spec.md

### Requirement: spec.md no longer uses bullet-style requirements

The internal renderer MUST NOT emit the legacy bullet format like `- The system MUST ...` for requirements. Each requirement MUST be a `### Requirement: <title>` block followed by an RFC 2119 description and at least one `#### Scenario:` block.

#### Scenario: bullet format is rejected by the internal validator

- **Given** a custom `spec.md` content that uses `- The system MUST ...` bullets without `### Requirement:` headings
- **When** `validateOpenSpecFiles()` runs on it
- **Then** it returns at least one issue with rule `requirement-block-missing`

### Requirement: forge spec is portable across Mac, Linux and Windows

The system MUST detect the OpenSpec CLI using `execSync("openspec --version")` with `stdio: "ignore"` and `windowsHide: true`, resolving the binary via PATH. The detection MUST NOT rely on shell features specific to one OS.

#### Scenario: detection works on Windows

- **Given** the developer is on Windows with `openspec.cmd` in PATH
- **When** `isOpenSpecCliAvailable()` runs
- **Then** it returns `true` without spawning a popup window

#### Scenario: detection works on Mac/Linux

- **Given** the developer is on macOS or Linux with `openspec` in PATH
- **When** `isOpenSpecCliAvailable()` runs
- **Then** it returns `true`

### Requirement: spec-input artifact carries traceable evidence

The `spec-input.json` MUST include an `evidence` object with absolute references to the artifacts that produced it (`contextPackRef`, `graphRef`, `tokenBudget`, `estimatedTokens`).

#### Scenario: evidence references are present

- **Given** `forge spec` is invoked with a valid context-pack
- **When** the resulting `spec-input.json` is read
- **Then** `evidence.contextPackRef === ".contextforge/context-pack.json"`
- **And** `evidence.graphRef === ".contextforge/graph.json"`
- **And** `evidence.tokenBudget` is a positive integer
- **And** `evidence.estimatedTokens` matches the context-pack's `budget.estimatedTokens`

### Requirement: forge init writes a derived agent-context.md

The system MUST emit `.contextforge/agent-context.md` during `forge init` listing all available artifact paths, the SDD recipe (forge context → forge spec → openspec validate → forge implement), and the measured token-savings summary if `token-ledger.json` exists.

#### Scenario: agent-context.md is written on init

- **Given** the developer runs `pnpm forge init` in a fresh project
- **When** init completes
- **Then** `.contextforge/agent-context.md` exists with sections "Artefactos disponibles", "Cómo consumir", and "Para crear un nuevo feature/fix con SDD"

#### Scenario: re-running init refreshes the file

- **Given** an existing `.contextforge/agent-context.md` from a previous init
- **When** the developer runs `pnpm forge init` again
- **Then** the file is overwritten with current content (it is a derived artifact, not user content)

## MODIFIED Requirements

### Requirement: forge CLI surface emits spec-input alongside spec

The `forge spec` subcommand MUST always emit `.contextforge/spec-input.json` regardless of mode (handoff or fallback). The `printUsage` output MUST reflect that `forge spec` now produces a spec-input + delegates to OpenSpec when available.

#### Scenario: usage help mentions spec-input

- **Given** the developer runs `pnpm forge` with no arguments
- **When** the CLI prints usage
- **Then** the help output contains a hint that `forge spec` produces `spec-input.json` plus `spec-prompt.md` (handoff) or the change scaffold (fallback)

### Requirement: core package exports spec-input builder and prompt renderer

The `@anai-raia-alex/contextforge-core` package MUST export `buildSpecInput`, `renderSpecPrompt`, and the related types from its top-level entry point.

#### Scenario: importing buildSpecInput works

- **Given** a consumer package depending on `@anai-raia-alex/contextforge-core`
- **When** they `import { buildSpecInput, renderSpecPrompt } from "@anai-raia-alex/contextforge-core"`
- **Then** both imports resolve to the implementations in `packages/core/src/spec/`

## REMOVED Requirements

### Requirement: forge spec emits bullet-style requirements

**Reason**: OpenSpec 1.3+ rejects bullet-style requirement lists. The internal renderer is migrated to `### Requirement:` plus `#### Scenario:` blocks.

The legacy bullet output (`- The system MUST ...`) is no longer produced by `buildOpenSpec()`. Existing specs in the repo (`agent-manifest`, `auto-domain-skills`) already use the modern format.
