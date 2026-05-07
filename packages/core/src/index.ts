export { scanProject, type ScanFile, type ScanResult } from "./scanner.js";

export {
  validate,
  validateOrThrow,
  preloadSchemas,
  setSchemaDir,
  getSchemaDir,
  SchemaValidationError,
  type SchemaName,
  type ValidationResult
} from "./schema/validator.js";

export { SCHEMA_VERSIONS, type SchemaVersionKey } from "./schema/versions.js";

export { blake3Hex, blake3HexFromFile } from "./hash.js";

export {
  detectLanguageFromPath,
  parseFile,
  type ParseFileResult,
  type ParserCapture,
  type ImportStatement,
  type ParserEngine,
  type ParserLanguage,
  type ParseFileOptions,
  type FallbackReason
} from "./parser/treeSitter.js";

export {
  buildGraph,
  type BuildGraphResult,
  type GraphNode,
  type GraphEdge,
  type EdgeType
} from "./graph/builder.js";

export {
  selectContext,
  type SelectContextOptions,
  type SelectContextResult,
  type PackedFile,
  type ScoredFile,
  type FileMode,
  type PackResult,
  type PageRankOptions
} from "./selector/index.js";

export { renderSDD, type SDDContext, type SpecFile } from "./spec/render.js";

export {
  buildOpenSpec,
  inferDomain,
  type OpenSpecOptions,
  type OpenSpecResult,
  type OpenSpecFile
} from "./spec/openspec.js";

export {
  validateGuardrails,
  type GuardrailViolation,
  type ValidatorResult,
  type Guardrails
} from "./implement/validator.js";

export {
  buildDiataxisScaffold,
  type DiataxisOptions,
  type DiataxisFile,
  type DiataxisResult
} from "./docs/scaffolder.js";
