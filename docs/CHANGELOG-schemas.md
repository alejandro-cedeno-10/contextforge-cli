# Schema Changelog

## v0.3.0 (graph + graph-subset only)

**Additive bump.** No breaking changes — existing `graph.json` and `graph.subset.json` produced by v0.2.0 still validate. Adds the optional **semantic layer** (Pass 5, opt-in via `--with-semantic`).

### graph.json — additive

| Field                | Change                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`      | `"0.2.0"` → `"0.3.0"`                                                                                                                                                                                                              |
| `semanticEnabled`    | New optional boolean. `true` when the graph includes Pass-5 nodes/edges. Absent or `false` means structural-only (back-compat).                                                                                                    |
| `nodes[].id`         | Pattern extended to allow `domain:`, `layer:`, `endpoint:`, `flow:`, `step:`, `concept:` prefixes.                                                                                                                                 |
| `nodes[].type`       | Enum extended with `domain \| layer \| endpoint \| flow \| step \| concept`.                                                                                                                                                       |
| `nodes[]` (semantic) | New optional fields: `method`, `framework`, `domain`, `entryFile`, `stepCount`, `order`, `stepFile`, `stepLayer`, `headSymbol`, `modularity`, `files`, `kinds`. All scoped to semantic node types and ignored on structural nodes. |
| `edges[].type`       | Enum extended with `belongs_to_domain \| in_layer \| exposes_endpoint \| implements_flow \| flow_step \| cross_domain`.                                                                                                            |

### graph-subset.json — additive

| Field           | Change                                          |
| --------------- | ----------------------------------------------- |
| `schemaVersion` | `"1.0.0"` → `"1.1.0"`                           |
| `nodes[].id`    | Pattern extended (same prefixes as graph.json). |
| `nodes[].type`  | Enum extended with the 6 semantic node types.   |
| `edges[].type`  | Enum extended with the 6 semantic edge types.   |

**Migration**: none required. Existing artifacts remain valid. Re-run `forge graph --with-semantic` to opt into the new layer.

---

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
