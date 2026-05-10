import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  getSchemaDir,
  preloadSchemas,
  SchemaValidationError,
  setSchemaDir,
  validate,
  validateOrThrow,
  type SchemaName
} from "../src/schema/validator";
import { SCHEMA_VERSIONS } from "../src/schema/versions";

const NOW = "2026-05-06T10:00:00Z";
const schemaDirs: string[] = [];
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultSchemasDir = path.resolve(here, "../../../docs/schemas");

function snapshotSchemaDir(): string {
  return getSchemaDir();
}

async function tempSchemaDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "contextforge-schemas-"));
  schemaDirs.push(dir);
  return dir;
}

const validFixtures: Record<SchemaName, unknown> = {
  scan: {
    schemaVersion: SCHEMA_VERSIONS.scan,
    root: "/repo",
    generatedAt: NOW,
    hashAlgorithm: "blake3",
    files: [
      {
        path: "src/a.ts",
        ext: ".ts",
        size: 12,
        hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        kind: "code"
      }
    ]
  },
  graph: {
    schemaVersion: SCHEMA_VERSIONS.graph,
    project: { name: "demo", root: "." },
    generatedAt: NOW,
    nodes: [
      { id: "file:src/a.ts", type: "file", label: "a.ts", path: "src/a.ts" },
      {
        id: "symbol:src/a.ts#foo",
        type: "symbol",
        label: "foo",
        path: "src/a.ts",
        kind: "function"
      }
    ],
    edges: [
      { from: "file:src/a.ts", to: "symbol:src/a.ts#foo", type: "defines" }
    ]
  },
  "graph-subset": {
    schemaVersion: SCHEMA_VERSIONS.graphSubset,
    changeId: "demo-change",
    generatedAt: NOW,
    graphRef: ".contextforge/graph.json",
    focus: ["src/a.ts"],
    stats: { nodesTotal: 1, edgesTotal: 0, depth: 1 },
    nodes: [{ id: "file:src/a.ts", type: "file", label: "a.ts" }],
    edges: []
  },
  "context-pack": {
    schemaVersion: SCHEMA_VERSIONS.contextPack,
    task: "fix scanner ignore",
    generatedAt: NOW,
    budget: { maxInputTokens: 12000, estimatedTokens: 1200 },
    files: [
      {
        path: "src/a.ts",
        reason: "seed",
        mode: "full"
      }
    ]
  },
  "implement-plan": {
    schemaVersion: SCHEMA_VERSIONS.implementPlan,
    taskId: "fix-scanner-ignore",
    status: "plan_only",
    guardrails: {
      allowedFiles: ["packages/core/src/**"],
      forbiddenPaths: ["**/.env*"],
      maxLocDelta: 200
    },
    tasks: [
      {
        id: "T1",
        description: "Refine ignore matcher",
        files: ["packages/core/src/scanner.ts"]
      }
    ]
  },
  "token-ledger": {
    schemaVersion: SCHEMA_VERSIONS.tokenLedger,
    runId: "01HXZP9NY8K7M3CV2QWRTYBN5K",
    timestamp: NOW,
    tokenizer: { name: "js-tiktoken", model: "o200k_base" },
    baseline: {
      strategy: "full_repo_dump",
      tokens: 480000,
      filesIncluded: 1234
    },
    packed: { tokens: 41000, filesIncluded: 47 },
    savings: {
      absoluteTokens: 439000,
      savingsPct: 91.45,
      compressionRatio: 11.7
    }
  }
};

describe("validate (positive cases)", () => {
  for (const name of Object.keys(validFixtures) as SchemaName[]) {
    it(`accepts a valid ${name} payload`, () => {
      const result = validate(name, validFixtures[name]);
      expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
      expect(result.errors).toEqual([]);
    });
  }

  it("accepts a graph payload enriched with the semantic layer (Pass 5)", () => {
    const enriched = {
      schemaVersion: SCHEMA_VERSIONS.graph,
      project: { name: "demo", root: "." },
      generatedAt: NOW,
      semanticEnabled: true,
      nodes: [
        {
          id: "file:src/auth/login.controller.ts",
          type: "file",
          label: "login.controller.ts",
          path: "src/auth/login.controller.ts"
        },
        {
          id: "domain:auth",
          type: "domain",
          label: "auth",
          files: 5,
          kinds: { code: 4, test: 1 }
        },
        {
          id: "layer:controller",
          type: "layer",
          label: "controller",
          kind: "backend"
        },
        {
          id: "endpoint:POST:/api/auth/login",
          type: "endpoint",
          label: "POST /api/auth/login",
          method: "POST",
          path: "/api/auth/login",
          framework: "nest"
        },
        {
          id: "flow:auth/login-with-password",
          type: "flow",
          label: "login with password",
          domain: "auth",
          entryFile: "src/auth/login.controller.ts",
          stepCount: 3
        },
        {
          id: "step:flow:auth/login-with-password#1",
          type: "step",
          label: "login.controller.ts",
          order: 1,
          stepFile: "src/auth/login.controller.ts",
          stepLayer: "controller"
        },
        {
          id: "concept:auth/jwt-handling",
          type: "concept",
          label: "jwt-handling",
          domain: "auth",
          headSymbol: "symbol:src/auth/jwt.service.ts#JwtService",
          modularity: 0.42
        }
      ],
      edges: [
        {
          from: "file:src/auth/login.controller.ts",
          to: "domain:auth",
          type: "belongs_to_domain"
        },
        {
          from: "file:src/auth/login.controller.ts",
          to: "layer:controller",
          type: "in_layer"
        },
        {
          from: "file:src/auth/login.controller.ts",
          to: "endpoint:POST:/api/auth/login",
          type: "exposes_endpoint"
        },
        {
          from: "file:src/auth/login.controller.ts",
          to: "flow:auth/login-with-password",
          type: "implements_flow"
        },
        {
          from: "flow:auth/login-with-password",
          to: "step:flow:auth/login-with-password#1",
          type: "flow_step"
        },
        {
          from: "domain:auth",
          to: "domain:billing",
          type: "cross_domain",
          weight: 3
        }
      ]
    };
    const result = validate("graph", enriched);
    expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a graph-subset payload that carries semantic-layer nodes", () => {
    const enrichedSubset = {
      schemaVersion: SCHEMA_VERSIONS.graphSubset,
      changeId: "auth-refactor",
      generatedAt: NOW,
      graphRef: ".contextforge/graph.json",
      focus: ["src/auth/login.controller.ts"],
      stats: { nodesTotal: 3, edgesTotal: 2, depth: 1 },
      nodes: [
        {
          id: "file:src/auth/login.controller.ts",
          type: "file",
          label: "login.controller.ts"
        },
        { id: "domain:auth", type: "domain", label: "auth" },
        { id: "layer:controller", type: "layer", label: "controller" }
      ],
      edges: [
        {
          from: "file:src/auth/login.controller.ts",
          to: "domain:auth",
          type: "belongs_to_domain"
        },
        {
          from: "file:src/auth/login.controller.ts",
          to: "layer:controller",
          type: "in_layer"
        }
      ]
    };
    const result = validate("graph-subset", enrichedSubset);
    expect(result.valid, JSON.stringify(result.errors, null, 2)).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a graph node with an invalid semantic id prefix", () => {
    const broken = JSON.parse(JSON.stringify(validFixtures.graph)) as {
      nodes: Array<Record<string, unknown>>;
    };
    broken.nodes.push({
      id: "fictional:something",
      type: "domain",
      label: "x"
    });
    const result = validate("graph", broken);
    expect(result.valid).toBe(false);
  });
});

afterEach(async () => {
  setSchemaDir(defaultSchemasDir);
  await Promise.all(
    schemaDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("validate (negative cases)", () => {
  it("rejects scan with missing required field", () => {
    const broken = { ...(validFixtures.scan as Record<string, unknown>) };
    delete broken.files;
    const result = validate("scan", broken);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.message?.includes("files"))).toBe(true);
  });

  it("rejects scan with wrong type for size", () => {
    const broken = JSON.parse(JSON.stringify(validFixtures.scan)) as {
      files: Array<Record<string, unknown>>;
    };
    broken.files[0]!.size = "not-a-number";
    const result = validate("scan", broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.instancePath.includes("/size"))).toBe(
      true
    );
  });

  it("rejects graph with disallowed edge type", () => {
    const broken = JSON.parse(JSON.stringify(validFixtures.graph)) as {
      edges: Array<Record<string, unknown>>;
    };
    broken.edges[0]!.type = "fictional_edge";
    const result = validate("graph", broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.instancePath.includes("/type"))).toBe(
      true
    );
  });

  it("rejects context-pack with mode outside enum", () => {
    const broken = JSON.parse(
      JSON.stringify(validFixtures["context-pack"])
    ) as {
      files: Array<Record<string, unknown>>;
    };
    broken.files[0]!.mode = "verbatim";
    const result = validate("context-pack", broken);
    expect(result.valid).toBe(false);
  });

  it("rejects implement-plan with unknown status", () => {
    const broken = JSON.parse(
      JSON.stringify(validFixtures["implement-plan"])
    ) as Record<string, unknown>;
    broken.status = "in_progress";
    const result = validate("implement-plan", broken);
    expect(result.valid).toBe(false);
  });

  it("rejects token-ledger with negative tokens", () => {
    const broken = JSON.parse(
      JSON.stringify(validFixtures["token-ledger"])
    ) as {
      packed: Record<string, unknown>;
    };
    broken.packed.tokens = -1;
    const result = validate("token-ledger", broken);
    expect(result.valid).toBe(false);
  });
});

describe("validateOrThrow", () => {
  it("returns void on valid payload", () => {
    expect(() => validateOrThrow("scan", validFixtures.scan)).not.toThrow();
  });

  it("throws SchemaValidationError on invalid payload", () => {
    let caught: unknown;
    try {
      validateOrThrow("scan", { wrong: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SchemaValidationError);
    const err = caught as SchemaValidationError;
    expect(err.schemaName).toBe("scan");
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.message).toContain("scan");
  });

  it("throws on unknown schema name", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validate("nonexistent" as any, {})
    ).toThrow(/Unknown schema/);
  });
});

describe("schema loader helpers", () => {
  it("round-trips a custom schema directory", () => {
    const original = snapshotSchemaDir();
    const custom = path.join(original, "nested", "schemas");

    setSchemaDir(custom);

    expect(getSchemaDir()).toBe(path.resolve(custom));
  });

  it("preloads schemas from the default docs directory", () => {
    expect(() => preloadSchemas()).not.toThrow();
  });

  it("throws a clear error when a schema file is missing", async () => {
    const dir = await tempSchemaDir();
    const sourceDir = defaultSchemasDir;

    for (const fileName of [
      "scan.schema.json",
      "graph.schema.json",
      "context-pack.schema.json",
      "implement-plan.schema.json"
    ]) {
      await writeFile(
        path.join(dir, fileName),
        await readFile(path.join(sourceDir, fileName), "utf8"),
        "utf8"
      );
    }

    setSchemaDir(dir);

    expect(() => preloadSchemas()).toThrow(
      /Failed to load schema "token-ledger"/
    );
  });

  it("throws a clear error when a schema file contains invalid JSON", async () => {
    const dir = await tempSchemaDir();
    const sourceDir = defaultSchemasDir;

    for (const fileName of [
      "scan.schema.json",
      "graph.schema.json",
      "context-pack.schema.json",
      "implement-plan.schema.json",
      "token-ledger.schema.json"
    ]) {
      await writeFile(
        path.join(dir, fileName),
        await readFile(path.join(sourceDir, fileName), "utf8"),
        "utf8"
      );
    }

    await mkdir(path.join(dir, "nested"), { recursive: true });
    await writeFile(path.join(dir, "graph.schema.json"), "{not-json}", "utf8");

    setSchemaDir(dir);

    expect(() => preloadSchemas()).toThrow(
      /Schema "graph" .* is not valid JSON/
    );
  });
});
