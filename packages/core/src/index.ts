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
  PARSER_VERSION,
  type ParseFileResult,
  type ParserCapture,
  type ImportStatement,
  type ParserEngine,
  type ParserLanguage,
  type ParseFileOptions,
  type FallbackReason,
  type HeritageRelation,
  type HeritageKind,
  type CallSite
} from "./parser/treeSitter.js";

export {
  buildGraph,
  type BuildGraphResult,
  type GraphNode,
  type GraphEdge,
  type EdgeType,
  type NodeType,
  type StructuralNodeType,
  type SemanticNodeType,
  type StructuralEdgeType,
  type SemanticEdgeType,
  type ParserEngineLabel
} from "./graph/builder.js";

export {
  detectDomains,
  type DomainAssignment,
  type DomainDetectionResult
} from "./graph/semantic/domain.js";

export {
  detectLayers,
  type LayerAssignment,
  type LayerDetectionResult,
  type LayerKind
} from "./graph/semantic/layer.js";

export {
  detectEndpoints,
  type EndpointHit,
  type EndpointDetectionResult,
  type DetectEndpointsOptions
} from "./graph/semantic/endpoint.js";

export {
  detectFlows,
  type Flow,
  type FlowStep,
  type FlowDetectionResult,
  type DetectFlowsOptions
} from "./graph/semantic/flow.js";

export {
  detectConcepts,
  type Concept,
  type ConceptDetectionResult,
  type DetectConceptsOptions
} from "./graph/semantic/concept.js";

export {
  runSemanticPass,
  type RunSemanticPassOptions,
  type RunSemanticPassResult
} from "./graph/semantic/pass5.js";

export {
  loadCache as loadGraphCache,
  saveCache as saveGraphCache,
  emptyCache as emptyGraphCache,
  GRAPH_CACHE_FILE,
  type GraphCache,
  type FileGraphFragment,
  type FileParseFragment
} from "./graph/cache.js";

export {
  exportToDot,
  exportToGraphML,
  type ExportableGraph
} from "./graph/exporters.js";

export {
  loadTsconfigPaths,
  resolveTsconfigAlias,
  type TsconfigPaths,
  type TsconfigPathRule
} from "./graph/tsconfigPaths.js";

export {
  enrichGraphSymbols,
  selectEnrichmentTargets,
  type EnrichmentEntry,
  type EnrichmentOptions,
  type EnrichmentResult
} from "./graph/enrich.js";

export {
  extractChangeSubgraph,
  type SubgraphResult,
  type ExtractSubgraphOptions
} from "./graph/subset.js";

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
  validateOpenSpecFiles,
  type OpenSpecOptions,
  type OpenSpecResult,
  type OpenSpecFile,
  type OpenSpecValidationIssue
} from "./spec/openspec.js";

export {
  buildSpecInput,
  type SpecInput,
  type SpecInputOptions,
  type SpecInputAffectedFile,
  type SpecInputCrossDomain,
  type SpecInputEvidence,
  type SpecInputArchitecture,
  type ContextPackInput,
  type ContextPackFile,
  type GraphInput
} from "./spec/specInput.js";

export {
  renderSpecPrompt,
  type SpecPromptOptions
} from "./spec/promptRenderer.js";

export {
  renderChangeContextMd,
  type RenderChangeContextOptions,
  type ScaffoldedBy
} from "./spec/changeContext.js";

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

export { getDomain } from "./graph/domain.js";

export {
  buildSyncReport,
  type SyncInput,
  type SyncReport
} from "./sync/syncReport.js";

export {
  buildHealthReport,
  type HealthInput,
  type HealthReport,
  type ArtifactStatus,
  type SkillCoverage
} from "./impact/healthCheck.js";

export {
  buildDomainSkills,
  type DomainSkillsOptions,
  type DomainSkillsResult,
  type DomainSkillFile
} from "./skills/skillBuilder.js";

export {
  buildAgentManifest,
  type AgentManifestOptions,
  type AgentManifestResult,
  type ManifestSkill,
  type ManifestRule,
  type MatchType,
  type SkillEntry,
  type RuleEntry
} from "./manifest/agentManifest.js";

export {
  parseFrontmatter,
  loadSkillEntries,
  loadRuleEntries
} from "./manifest/skillLoader.js";

export {
  renderClaude,
  renderCursor,
  renderOpenCode,
  type RenderedFile
} from "./manifest/index.js";
