# Delta Spec: core

## ADDED Requirements

### Requirement: forge manifest produces a deterministic agent manifest

The system MUST expose a `forge manifest` CLI subcommand that reads `.contextforge/context-pack.json` and emits `.contextforge/agent-manifest.json` describing which skills and rules are relevant to the current task. The manifest MUST validate against `docs/schemas/agent-manifest.schema.json`.

#### Scenario: context-pack present produces a valid manifest

- **Given** a project with `.contextforge/context-pack.json` describing a task that touches files in `packages/core` and `packages/cli`
- **When** the developer runs `pnpm forge manifest`
- **Then** the system writes `.contextforge/agent-manifest.json` whose `domainsTouched` array contains both `packages/core` and `packages/cli` and which validates against the `agent-manifest` schema

#### Scenario: missing context-pack produces actionable error

- **Given** a project with no `.contextforge/context-pack.json`
- **When** the developer runs `pnpm forge manifest`
- **Then** the system exits with a clear error suggesting `pnpm forge context "<task>"` as the next step

### Requirement: skills are matched by alwaysApply, domain, or explicit slug

For each skill discovered in `.claude/skills/*.md`, the system MUST classify the match as:

1. `alwaysApply` — when the skill frontmatter contains `alwaysApply: true`,
2. `domain` — when the skill frontmatter `domains: [...]` intersects `domainsTouched`,
3. `explicit` — when the skill `name` matches the pattern `ctx-<slug>` and the deslugified domain is in `domainsTouched`,

otherwise the skill MUST appear in `skipped.skills[]` with a reason.

#### Scenario: alwaysApply skill is always included

- **Given** a skill with `alwaysApply: true` in its frontmatter
- **When** `buildAgentManifest` runs against any pack
- **Then** the skill appears in `skills[]` with `matchType: "alwaysApply"` and `reason: "skill marked alwaysApply"`

#### Scenario: domain frontmatter takes precedence over slug

- **Given** a skill named `ctx-packages-core` with explicit `domains: [packages/cli]` in its frontmatter
- **When** the pack touches `packages/cli`
- **Then** the skill is included with `matchType: "domain"` and `reason: "task touches packages/cli"`

#### Scenario: ctx-<slug> skill without frontmatter falls back to slug matching

- **Given** an auto-generated skill `.claude/skills/ctx-packages-core.md` with no `domains:` field
- **When** the pack touches `packages/core`
- **Then** the skill is included with `matchType: "explicit"`

#### Scenario: skill with no match is skipped

- **Given** a skill `ctx-packages-mcp` and a pack that touches only `packages/cli`
- **When** `buildAgentManifest` runs
- **Then** the skill appears in `skipped.skills[]` with reason `"domain not touched"` and is NOT in `skills[]`

### Requirement: rules are matched the same way as skills and produce suggested globs

For each rule discovered in `.cursor/rules/*.mdc`, the system MUST apply the same matching algorithm as skills. When a rule matches by `domain`, the system MUST compute a `suggestedGlobs` array containing one glob per touched domain (e.g. `packages/core/**`).

#### Scenario: rule matches multiple touched domains

- **Given** a rule with `domains: [packages/core, packages/cli]` and a pack that touches both domains
- **When** `buildAgentManifest` runs
- **Then** the rule's `suggestedGlobs` contains exactly `["packages/cli/**", "packages/core/**"]` (sorted)

#### Scenario: alwaysApply rule keeps no globs

- **Given** a rule with `alwaysApply: true`
- **When** `buildAgentManifest` runs
- **Then** the rule appears with `matchType: "alwaysApply"` and no `suggestedGlobs` field

### Requirement: Claude Code renderer emits a single manifest skill file

The system MUST provide a renderer that converts an `AgentManifestResult` into the file `.claude/agent-manifest.md`. The file MUST include YAML frontmatter with `name: contextforge-active-task` and `description` set to the task, and a markdown body listing touched domains, suggested skills (with reason), and skipped skills.

#### Scenario: rendered file contains all required sections

- **Given** a manifest with task `"fix race in tokenLedger"`, two suggested skills, and one skipped skill
- **When** `renderClaude(manifest)` runs
- **Then** the output file at `.claude/agent-manifest.md` contains the headings `# Tarea`, `## Dominios tocados`, `## Skills sugeridas`, and `## Skills omitidas`, and frontmatter with `name: contextforge-active-task`

### Requirement: Cursor renderer emits an Auto-Attached rule

The system MUST provide a renderer that converts an `AgentManifestResult` into the file `.cursor/rules/contextforge-active.mdc`. The frontmatter MUST contain `alwaysApply: false`, a `description` line set to the task, and a `globs:` array derived from the touched domains.

#### Scenario: rendered rule has correct globs

- **Given** a manifest where `domainsTouched` is `["packages/core", "packages/cli"]`
- **When** `renderCursor(manifest)` runs
- **Then** the output frontmatter contains `globs:` with exactly `packages/core/**` and `packages/cli/**` and `alwaysApply: false`

#### Scenario: empty domains produces empty globs

- **Given** a manifest with `domainsTouched: []`
- **When** `renderCursor(manifest)` runs
- **Then** the rendered file's `globs` array is empty and `alwaysApply: false`

### Requirement: OpenCode is supported via MCP tools plus the neutral JSON

The system MUST expose an MCP tool `getAgentManifest` from the `packages/mcp` server that reads `.contextforge/agent-manifest.json` and returns its parsed contents. The neutral JSON MUST also be readable directly from the filesystem so OpenCode (or any agent) can consume it without MCP.

#### Scenario: tool returns the manifest when present

- **Given** `.contextforge/agent-manifest.json` exists and is valid
- **When** an MCP client calls the `getAgentManifest` tool
- **Then** the response contains the JSON-encoded manifest as text content

#### Scenario: tool reports missing manifest cleanly

- **Given** `.contextforge/agent-manifest.json` does not exist
- **When** an MCP client calls the `getAgentManifest` tool
- **Then** the response contains the message `"Run 'forge manifest' first."` and does NOT throw

### Requirement: selectAgentContext computes the manifest in-memory at runtime

The system MUST expose an MCP tool `selectAgentContext({ task: string, agents?: string[] })` that computes an `AgentManifestResult` for the given task **without writing any file to disk**. This is the per-session entry point: an agent calls it at the start of a conversation (or when the task changes) and uses the returned manifest as context.

#### Scenario: tool returns a valid manifest for a non-empty task

- **Given** `.contextforge/scan.json` and `.contextforge/graph.json` exist and are valid
- **When** an MCP client calls `selectAgentContext({ task: "fix race in tokenLedger" })`
- **Then** the response contains a JSON manifest validating against `agent-manifest` schema
- **And** the filesystem state is unchanged (no file written)

#### Scenario: empty task is rejected by schema

- **Given** any state of the project
- **When** an MCP client calls `selectAgentContext({ task: "" })`
- **Then** the tool rejects the call with a schema validation error mentioning `minLength`

#### Scenario: missing scan/graph produces a degraded manifest

- **Given** `.contextforge/scan.json` does not exist
- **When** an MCP client calls `selectAgentContext({ task: "any task" })`
- **Then** the response contains a manifest with `domainsTouched: []` and a `notes` field including `"scan/graph missing — run forge scan && forge graph"`
- **And** the tool exits successfully (does NOT throw)

### Requirement: MCP server caches scan and graph in memory

To keep `selectAgentContext` latency under 200 ms after the first call, the MCP server MUST cache parsed `scan.json` and `graph.json` in memory and invalidate the cache when the file mtime changes.

#### Scenario: second call within session reuses cache

- **Given** an MCP server that has handled one `selectAgentContext` call already
- **When** a second `selectAgentContext` call arrives with unchanged underlying files
- **Then** the server does NOT re-read `scan.json` or `graph.json` from disk
- **And** the response is identical to the first call (deterministic)

#### Scenario: file mtime change triggers reload

- **Given** an MCP server with cached scan/graph
- **When** the developer regenerates `.contextforge/graph.json` (mtime changes) and a new `selectAgentContext` call arrives
- **Then** the server detects the mtime change, reloads the file, and uses the fresh content

### Requirement: Claude Code runtime hook integrates via UserPromptSubmit

The system MUST provide a CLI wrapper binary `contextforge-hook` (registered in `packages/mcp/package.json` under `bin`) that accepts `--task=<text>` and prints a markdown block to stdout describing the active manifest. The system MUST document a copy-paste hook configuration for `.claude/settings.json` that wires this binary to the `UserPromptSubmit` event.

#### Scenario: wrapper prints markdown for a given task

- **Given** the binary is installed and the project has valid scan/graph artifacts
- **When** the developer runs `contextforge-hook --task="fix race in tokenLedger"`
- **Then** stdout contains the heading `## Sugerencias de skills/rules para esta tarea`
- **And** stdout contains at least one bullet line of the form `- <skill-name> — <reason>`
- **And** the process exits with code 0

#### Scenario: wrapper does not crash when artifacts are missing

- **Given** no `.contextforge/scan.json` exists
- **When** the developer runs `contextforge-hook --task="any task"`
- **Then** stdout contains a visible note `scan/graph missing — run forge scan && forge graph`
- **And** the process exits with code 0 (so the Claude Code hook never aborts the prompt)

#### Scenario: wrapper does not log the prompt

- **Given** the developer runs `contextforge-hook --task="<sensitive prompt content>"`
- **When** the wrapper finishes
- **Then** no file under `.contextforge/` or anywhere else contains the verbatim task text written by the wrapper

### Requirement: documented Cursor strategy covers the runtime gap

Because Cursor does not expose hooks reactive to the user prompt, the system MUST document the available rule modes and a recommended combination so the dev gets the closest equivalent to per-task selection.

#### Scenario: cursor docs list the three runtime modes

- **Given** the developer reads `docs/integrations/cursor-rules.md`
- **When** they look for guidance on per-task selection
- **Then** the document explains `alwaysApply`, `Auto Attached` (with globs regenerated by `forge manifest`), and `Agent Requested` (with `description` per domain), and recommends combining all three

### Requirement: OpenCode runtime call uses selectAgentContext

The system MUST document, with a concrete example, that an OpenCode-driven agent calls `selectAgentContext({ task })` as its first MCP tool call when starting a conversation, and uses the response as context for the rest of the session.

#### Scenario: opencode docs include a tool-call example

- **Given** the developer reads `docs/integrations/opencode-mcp.md`
- **When** they look for the per-session usage pattern
- **Then** the document contains an example of `selectAgentContext` being called with a `task` field and the resulting JSON being summarized for the conversation

### Requirement: forge manifest is deterministic and offline

`forge manifest` MUST produce identical output for identical input (no timestamps in body content, no random ordering) and MUST NOT make any network call.

#### Scenario: two consecutive runs produce identical files

- **Given** an unchanged `.contextforge/context-pack.json`, identical skills/rules on disk
- **When** `pnpm forge manifest --force` is executed twice
- **Then** the contents of `.contextforge/agent-manifest.json`, `.claude/agent-manifest.md`, and `.cursor/rules/contextforge-active.mdc` are byte-for-byte identical between runs

#### Scenario: works offline

- **Given** a machine with network disabled
- **When** the developer runs `pnpm forge manifest`
- **Then** the command completes successfully

### Requirement: existing per-agent manifest files are preserved unless --force is used

The system MUST NOT overwrite `.claude/agent-manifest.md` or `.cursor/rules/contextforge-active.mdc` unless the `--force` flag is provided. The neutral `.contextforge/agent-manifest.json` is always overwritten because it is the source of truth.

#### Scenario: rerun without flag skips per-agent files

- **Given** an existing `.cursor/rules/contextforge-active.mdc` file
- **When** the developer runs `pnpm forge manifest` without `--force`
- **Then** the system logs `[skip] .cursor/rules/contextforge-active.mdc already exists (use --force to overwrite)` and the file content is unchanged
- **And** `.contextforge/agent-manifest.json` IS regenerated regardless

### Requirement: --agents flag selects renderers

The system MUST accept a `--agents=<list>` flag listing which renderers to run. Valid values are `claude`, `cursor`, `opencode`. The default when omitted is all three.

#### Scenario: only one renderer runs

- **Given** the developer runs `pnpm forge manifest --agents=cursor`
- **When** the command finishes
- **Then** only `.cursor/rules/contextforge-active.mdc` is written by a renderer (the neutral JSON is still emitted)
- **And** `.claude/agent-manifest.md` is NOT created

### Requirement: malformed frontmatter does not crash the command

The system MUST tolerate skills/rules with malformed YAML frontmatter by classifying them in `skipped` with reason `"frontmatter parse error"`, never aborting the command.

#### Scenario: corrupt skill is reported in skipped

- **Given** a skill file with broken YAML between the `---` delimiters
- **When** `pnpm forge manifest` runs
- **Then** the command exits 0 and the manifest's `skipped.skills[]` contains an entry with reason `"frontmatter parse error"`

## MODIFIED Requirements

### Requirement: forge CLI surface includes manifest subcommand

The `forge` CLI MUST expose a `manifest` subcommand alongside the existing `init`, `scan`, `graph`, `context`, `spec`, `implement`, `viz`, `docs`, `skills`, `sync`, `impact` subcommands. The `printUsage` output MUST include `pnpm forge manifest [--agents=claude,cursor,opencode] [--force]`.

#### Scenario: usage help lists the new command

- **Given** the developer runs `pnpm forge` with no arguments
- **When** the CLI prints usage
- **Then** the output contains the line `pnpm forge manifest [--agents=...] [--force]`

### Requirement: core package exports manifest builder and renderers

The `@alejandro-cedeno-10/contextforge-core` package MUST export `buildAgentManifest`, `renderClaude`, `renderCursor`, `renderOpenCode`, and the related types from its top-level entry point.

#### Scenario: importing the manifest API works

- **Given** a consumer package depending on `@alejandro-cedeno-10/contextforge-core`
- **When** they `import { buildAgentManifest, renderCursor } from "@alejandro-cedeno-10/contextforge-core"`
- **Then** both imports resolve to the implementations in `packages/core/src/manifest/`

### Requirement: forge skills emits a domains frontmatter field

To enable explicit matching by `agent-manifest`, `forge skills` MUST emit `domains: [<domain>]` in the frontmatter of every generated `ctx-<slug>.md` file, in addition to the existing `tags`.

#### Scenario: generated skill includes domains frontmatter

- **Given** the `packages/core` domain
- **When** `pnpm forge skills --force` runs
- **Then** `.claude/skills/ctx-packages-core.md` contains a frontmatter line `domains: [packages/core]`

## REMOVED Requirements

(none)
