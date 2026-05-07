# Schema Changelog

## v0.2.0 (current)

**Breaking changes from v0.1.0.** All artifacts now carry `schemaVersion: "0.2.0"`.

### scan.json — breaking changes

| Field           | Change                                                                               |
| --------------- | ------------------------------------------------------------------------------------ |
| `schemaVersion` | `"0.1.0"` → `"0.2.0"`                                                                |
| `hashAlgorithm` | **New required field.** Enum: `"blake3" \| "sha256"`. All new scans emit `"blake3"`. |
| `root`          | **New required field.** Absolute path of the scanned directory.                      |
| `generatedAt`   | **New required field.** ISO-8601 timestamp.                                          |
| `files[].ext`   | **New required field.** Lowercased file extension (e.g. `".ts"`).                    |
| `files[].size`  | **New required field.** File size in bytes.                                          |
| `files[].kind`  | Extended enum: added `"schema"` and `"test"` values.                                 |

**Migration**: re-run `forge scan`. BLAKE3 hashes are not compatible with SHA-256 caches.

### graph.json — breaking changes

| Field           | Change                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `"0.1.0"` → `"0.2.0"`                                                                                                                                      |
| `project`       | **New required field.** `{ name: string; root: string }`.                                                                                                  |
| `generatedAt`   | **New required field.** ISO-8601 timestamp.                                                                                                                |
| `nodes[].id`    | Pattern enforced: `^(file\|symbol\|folder\|package):.+`.                                                                                                   |
| `nodes[].type`  | Extended enum: `file \| symbol \| folder \| package`.                                                                                                      |
| `edges`         | **New required field.** Array (may be empty). Edge `type` enum: `defines \| imports \| calls \| references \| tests \| contains \| extends \| implements`. |
| `scanRef`       | New optional field. `{ path, scanHash }` — BLAKE3 hash of `scan.json` for incremental rebuild detection.                                                   |
| `parser`        | New optional field. `{ engine, engineVersion?, grammars? }`.                                                                                               |
| `stats`         | New optional field. `{ nodesTotal, edgesTotal, nodesByType, edgesByType }`.                                                                                |

**Migration**: re-run `forge graph`.

### context-pack.json — breaking changes

| Field            | Change                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`  | `"0.1.0"` → `"0.2.0"`                                                                                                  |
| `generatedAt`    | **New required field.** ISO-8601 timestamp.                                                                            |
| `budget`         | **New required field.** `{ maxInputTokens, estimatedTokens }`.                                                         |
| `files[].mode`   | **New required field.** Enum: `full \| excerpt \| summary`.                                                            |
| `files[].reason` | Extended enum: `seed \| direct_import \| transitive_dep \| test_for \| referenced_symbol \| called_by_seed \| manual`. |

**Migration**: re-run `forge context`.

### implement-plan.json — breaking changes

| Field           | Change                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| `schemaVersion` | `"0.1.0"` → `"0.2.0"`                                                                    |
| `taskId`        | **New required field.**                                                                  |
| `title`         | **New required field.**                                                                  |
| `status`        | **New required field.** Enum: `plan_only \| approved_for_edit \| rejected \| completed`. |
| `guardrails`    | **New required field.** `{ allowedFiles[], forbiddenPaths[], maxLocDelta }`.             |
| `tasks[].id`    | Pattern enforced: `^T[0-9]+(\.[0-9]+)*$`.                                                |
| `tasks[].files` | **New required field.**                                                                  |

**Migration**: re-run `forge implement`.

### token-ledger.json — new artifact

Produced alongside `context-pack.json` by `forge context`. Key fields: `runId`, `tokenizer`, `baseline`, `packed`, `savings`.

---

## v0.1.0 (deprecated)

Initial draft schemas embedded directly in CLI command implementations. No JSON Schema validation enforced.
