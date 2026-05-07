import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

import type { ErrorObject, ValidateFunction } from "ajv";

/**
 * Interop shim: ajv-formats is published as CJS with `module.exports = fn`,
 * but TypeScript with NodeNext + esModuleInterop surfaces the import as a
 * namespace, not as the callable function. We extract `.default` (or fall back
 * to the namespace itself) and assert the call signature.
 */
type AddFormatsFn = (ajv: Ajv2020) => Ajv2020;
const addFormats = ((addFormatsImport as unknown as { default?: AddFormatsFn })
  .default ?? (addFormatsImport as unknown as AddFormatsFn)) as AddFormatsFn;

export type SchemaName =
  | "scan"
  | "graph"
  | "context-pack"
  | "implement-plan"
  | "token-ledger"
  | "agent-manifest";

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

export class SchemaValidationError extends Error {
  public readonly schemaName: SchemaName;
  public readonly errors: ErrorObject[];

  constructor(schemaName: SchemaName, errors: ErrorObject[]) {
    const detail = errors
      .map(
        (e) => `  - ${e.instancePath || "(root)"}: ${e.message ?? "invalid"}`
      )
      .join("\n");
    super(
      `Schema validation failed for "${schemaName}" (${errors.length} error(s)):\n${detail}`
    );
    this.name = "SchemaValidationError";
    this.schemaName = schemaName;
    this.errors = errors;
  }
}

const SCHEMA_FILES: Readonly<Record<SchemaName, string>> = {
  scan: "scan.schema.json",
  graph: "graph.schema.json",
  "context-pack": "context-pack.schema.json",
  "implement-plan": "implement-plan.schema.json",
  "token-ledger": "token-ledger.schema.json",
  "agent-manifest": "agent-manifest.schema.json"
};

function defaultSchemaDir(): string {
  // Resolves at runtime regardless of src/ vs dist/ layout:
  // packages/core/{src|dist}/schema/validator.{ts|js} -> ../../../../docs/schemas
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..", "docs", "schemas");
}

let cachedValidators: Map<SchemaName, ValidateFunction> | null = null;
let currentSchemaDir = defaultSchemaDir();

/**
 * Override the directory schemas are loaded from. Resets the cache.
 * Useful for tests or for consumers that ship their own copies of the schemas.
 */
export function setSchemaDir(dir: string): void {
  currentSchemaDir = path.resolve(dir);
  cachedValidators = null;
}

export function getSchemaDir(): string {
  return currentSchemaDir;
}

function loadValidators(): Map<SchemaName, ValidateFunction> {
  if (cachedValidators) {
    return cachedValidators;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const map = new Map<SchemaName, ValidateFunction>();
  for (const name of Object.keys(SCHEMA_FILES) as SchemaName[]) {
    const filePath = path.join(currentSchemaDir, SCHEMA_FILES[name]);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load schema "${name}" from ${filePath}: ${cause}`
      );
    }
    let schema: unknown;
    try {
      schema = JSON.parse(raw);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Schema "${name}" at ${filePath} is not valid JSON: ${cause}`
      );
    }
    map.set(name, ajv.compile(schema as object));
  }

  cachedValidators = map;
  return map;
}

export function validate(name: SchemaName, payload: unknown): ValidationResult {
  const validator = loadValidators().get(name);
  if (!validator) {
    throw new Error(`Unknown schema: ${name}`);
  }
  const valid = validator(payload) as boolean;
  return {
    valid,
    errors: valid ? [] : (validator.errors ?? [])
  };
}

export function validateOrThrow(name: SchemaName, payload: unknown): void {
  const result = validate(name, payload);
  if (!result.valid) {
    throw new SchemaValidationError(name, result.errors);
  }
}

/**
 * Eagerly load and compile all schemas. Useful at process startup
 * to fail fast if any schema file is missing or invalid.
 */
export function preloadSchemas(): void {
  loadValidators();
}
