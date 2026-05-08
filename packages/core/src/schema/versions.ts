/**
 * Versiones canonicas de los schemas v0.2.
 * Bumpear major rompe compatibilidad; minor anade campos opcionales.
 * Cambios documentados en docs/CHANGELOG-schemas.md.
 */
export const SCHEMA_VERSIONS = {
  scan: "0.2.0",
  graph: "0.2.0",
  contextPack: "0.2.0",
  implementPlan: "0.2.0",
  tokenLedger: "0.2.0",
  agentManifest: "1.0.0",
  specInput: "1.0.0",
  graphSubset: "1.0.0"
} as const;

export type SchemaVersionKey = keyof typeof SCHEMA_VERSIONS;
