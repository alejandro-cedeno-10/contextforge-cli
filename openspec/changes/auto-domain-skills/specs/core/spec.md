# Delta Spec: core

## ADDED Requirements

### Requirement: forge skills generates one skill per detected domain

The system MUST expose a `forge skills` CLI subcommand that reads `.contextforge/graph.json` and emits one skill file per domain at `.claude/skills/ctx-<slug>.md`, where `slug = domain.replace(/[/]/g, "-")`.

#### Scenario: graph with multiple domains produces one skill per domain

- **Given** a project with `.contextforge/graph.json` containing files in domains `packages/core`, `packages/cli`, and `packages/mcp`
- **When** the developer runs `pnpm forge skills`
- **Then** the system writes `.claude/skills/ctx-packages-core.md`, `.claude/skills/ctx-packages-cli.md`, and `.claude/skills/ctx-packages-mcp.md`

#### Scenario: missing graph.json produces actionable error

- **Given** a project with no `.contextforge/graph.json`
- **When** the developer runs `pnpm forge skills`
- **Then** the system exits with a clear error message suggesting `pnpm forge graph` as the next step

### Requirement: domains below the file threshold are skipped

The system MUST skip any domain with fewer than `minFilesPerDomain` (default 2) files and report them in `result.skipped[]`.

#### Scenario: tiny domain is omitted

- **Given** a domain with only one file in the graph
- **When** `buildDomainSkills` runs with default `minFilesPerDomain: 2`
- **Then** that domain appears in `result.skipped[]` with a reason and NO file is written

### Requirement: existing skills are preserved unless --force is used

The system MUST NOT overwrite existing skill files unless the `--force` flag is provided.

#### Scenario: rerun without flag skips existing files

- **Given** an existing `.claude/skills/ctx-packages-core.md` file
- **When** the developer runs `pnpm forge skills` without flags
- **Then** the system logs `[skip] .claude/skills/ctx-packages-core.md already exists (use --force to overwrite)` and the file content is unchanged

#### Scenario: force flag overwrites all generated skills

- **Given** existing skill files
- **When** the developer runs `pnpm forge skills --force`
- **Then** the system overwrites every `ctx-<slug>.md` with freshly generated content

### Requirement: cross-domain edges drive Depends on / Used by sections

The system MUST analyze edges of type `imports` to compute `dependsOn` (outgoing cross-domain) and `usedBy` (incoming cross-domain) maps for each domain. Sections with no entries MUST be omitted from the rendered skill.

#### Scenario: domain with cross-domain imports renders both sections

- **Given** the `packages/cli` domain imports from `packages/core` (2 edges)
- **When** `buildDomainSkills` renders the `ctx-packages-cli.md` skill
- **Then** the skill content contains a `## Depends on` section with `packages/core (2 imports)`

#### Scenario: isolated domain renders neither section

- **Given** a domain with no cross-domain edges
- **When** the skill is rendered
- **Then** the skill body contains NO `## Depends on` or `## Used by` headings

### Requirement: skill frontmatter enables Claude Code auto-loading

The system MUST emit a YAML frontmatter for each generated skill containing `name`, `description`, and `tags` fields. The `description` MUST be a single line summarizing the domain so Claude Code's skill matcher can auto-load the right skill based on context.

#### Scenario: frontmatter format is consistent

- **Given** a generated skill for the `packages/core` domain
- **When** the file is written
- **Then** the frontmatter contains `name: ctx-packages-core`, a single-line `description` mentioning N files / M tests, and `tags: [packages/core, domain-skill]`

### Requirement: purpose inference is deterministic and LLM-free

The system MUST infer a human-readable purpose for each file using only string manipulation on the filename — no LLM, no network calls.

#### Scenario: camelCase filename is normalized

- **Given** a file at `packages/cli/src/htmlTemplate.ts`
- **When** `inferPurpose` runs on the path
- **Then** it returns `html-template`

#### Scenario: index.ts uses parent directory name

- **Given** a file at `packages/core/src/selector/index.ts`
- **When** `inferPurpose` runs on the path
- **Then** it returns `selector`

### Requirement: skills are token-efficient

Each generated skill MUST fit within 50 markdown lines and SHOULD stay below 500 estimated tokens.

#### Scenario: typical skill stays under the budget

- **Given** a domain with 8 files, 5 tests, and 2 cross-domain dependencies
- **When** the skill is rendered with default `maxFilesShown: 8`, `maxTestsShown: 5`
- **Then** the resulting markdown body has at most 45 non-empty lines

### Requirement: forge skills runs deterministically

The system MUST produce identical output for identical input (no randomness, no timestamps in skill body content).

#### Scenario: two consecutive runs produce identical files

- **Given** an unchanged `.contextforge/graph.json`
- **When** `pnpm forge skills --force` is executed twice
- **Then** the contents of the generated files are byte-for-byte identical between runs

### Requirement: forge skills makes no network calls

The system MUST NOT make any network call during `forge skills` execution and MUST NOT depend on `openspec` CLI, `git`, or any other external tool to function.

#### Scenario: works offline

- **Given** a machine with network disabled
- **When** the developer runs `pnpm forge skills`
- **Then** the command completes successfully

## MODIFIED Requirements

### Requirement: forge CLI surface includes skills subcommand

The `forge` CLI MUST expose a `skills` subcommand alongside the existing `init`, `scan`, `graph`, `context`, `spec`, `implement`, `viz`, `docs`, `sync`, `impact` subcommands. The `printUsage` output MUST include `pnpm forge skills [--force]`.

#### Scenario: usage help lists the new command

- **Given** the developer runs `pnpm forge` with no arguments
- **When** the CLI prints usage
- **Then** the output contains the line `pnpm forge skills [--force]`

### Requirement: core package exports skills builder

The `@alejandro-cedeno-10/contextforge-core` package MUST export `buildDomainSkills`, `DomainSkillsOptions`, `DomainSkillsResult`, and `DomainSkillFile` from its top-level entry point.

#### Scenario: importing buildDomainSkills works

- **Given** a consumer package depending on `@alejandro-cedeno-10/contextforge-core`
- **When** they `import { buildDomainSkills } from "@alejandro-cedeno-10/contextforge-core"`
- **Then** the import resolves to the function defined in `packages/core/src/skills/skillBuilder.ts`

## REMOVED Requirements

(none)
