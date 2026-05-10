import { describe, expect, it } from "vitest";

import { detectDomains } from "../src/graph/semantic/domain.js";
import { detectLayers } from "../src/graph/semantic/layer.js";
import { detectEndpoints } from "../src/graph/semantic/endpoint.js";
import { detectFlows } from "../src/graph/semantic/flow.js";
import { runSemanticPass } from "../src/graph/semantic/pass5.js";
import type { ScanFile } from "../src/scanner.js";

function file(p: string, kind: ScanFile["kind"] = "code"): ScanFile {
  return {
    path: p,
    ext: "." + (p.split(".").pop() ?? "ts"),
    size: 100,
    hash: "0".repeat(64),
    kind
  };
}

describe("detectDomains", () => {
  it("groups files under packages/<name> by package slug", () => {
    const result = detectDomains([
      file("packages/auth/src/login.ts"),
      file("packages/billing/src/invoice.ts"),
      file("packages/billing/src/util.ts")
    ]);
    expect(result.domains).toEqual(["auth", "billing"]);
    const billing = result.assignments.filter((a) => a.domain === "billing");
    expect(billing).toHaveLength(2);
  });

  it("detects NestJS feature folders by *.module.ts", () => {
    const result = detectDomains([
      file("src/users/users.module.ts"),
      file("src/users/users.controller.ts"),
      file("src/users/users.service.ts"),
      file("src/orders/orders.module.ts"),
      file("src/orders/orders.controller.ts")
    ]);
    expect(result.domains.sort()).toEqual(["orders", "users"]);
    expect(
      result.assignments.find((a) => a.file === "src/users/users.controller.ts")
        ?.domain
    ).toBe("users");
  });

  it("collapses files in shared folders to domain:shared", () => {
    const result = detectDomains([
      file("src/shared/util.ts"),
      file("src/common/types.ts"),
      file("src/auth/login.ts")
    ]);
    expect(result.domains).toContain("shared");
    expect(result.domains).toContain("auth");
    expect(
      result.assignments.find((a) => a.file === "src/shared/util.ts")?.domain
    ).toBe("shared");
  });

  it("detects Python apps under apps/<name>/", () => {
    const result = detectDomains([
      file("apps/orders/router.py"),
      file("apps/orders/models.py"),
      file("apps/users/__init__.py")
    ]);
    expect(result.domains.sort()).toEqual(["orders", "users"]);
  });

  it("falls back to first significant folder", () => {
    const result = detectDomains([file("src/billing/foo.ts")]);
    expect(result.domains).toEqual(["billing"]);
  });

  it("ignores non-code/test files", () => {
    const result = detectDomains([
      file("src/auth/login.ts"),
      file("src/auth/README.md", "doc"),
      file("src/auth/config.json", "config")
    ]);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.file).toBe("src/auth/login.ts");
  });
});

describe("detectLayers", () => {
  it("matches backend suffixes", () => {
    const result = detectLayers([
      file("src/users/users.controller.ts"),
      file("src/users/users.service.ts"),
      file("src/users/users.repository.ts"),
      file("src/users/users.module.ts"),
      file("src/users/login.dto.ts"),
      file("src/users/auth.guard.ts")
    ]);
    const layers = result.layers.map((l) => l.layer);
    expect(layers).toContain("controller");
    expect(layers).toContain("service");
    expect(layers).toContain("repository");
    expect(layers).toContain("module");
    expect(layers).toContain("dto");
    expect(layers).toContain("guard");
  });

  it("matches frontend suffixes", () => {
    const result = detectLayers([
      file("src/profile/Profile.component.tsx"),
      file("src/profile/useProfile.hook.ts"),
      file("src/profile/profile.store.ts")
    ]);
    expect(result.layers.map((l) => l.layer).sort()).toEqual([
      "component",
      "hook",
      "store"
    ]);
    for (const l of result.layers) expect(l.kind).toBe("frontend");
  });

  it("skips index/main and test files", () => {
    const result = detectLayers([
      file("src/index.ts"),
      file("src/main.ts"),
      file("src/users/users.controller.test.ts", "test"),
      file("src/users/users.service.spec.ts")
    ]);
    expect(result.assignments).toEqual([]);
  });

  it("falls back to folder segment when basename has no suffix", () => {
    const result = detectLayers([
      file("src/controllers/auth.ts"),
      file("src/services/billing.ts"),
      file("src/repositories/users.ts")
    ]);
    expect(result.layers.map((l) => l.layer).sort()).toEqual([
      "controller",
      "repository",
      "service"
    ]);
  });
});

/** Cross-platform mock reader: matches by relative-path tail so Windows
 *  backslashes from `path.join` don't break the keys. */
function makeMockReader(
  contents: Record<string, string>
): (abs: string) => Promise<string> {
  return async (abs: string): Promise<string> => {
    const norm = abs.replace(/\\/g, "/");
    for (const key of Object.keys(contents)) {
      if (norm.endsWith(key)) return contents[key]!;
    }
    throw new Error(`mock readFile missing: ${abs}`);
  };
}

describe("detectEndpoints", () => {
  async function run(
    files: ScanFile[],
    contents: Record<string, string>
  ): Promise<ReturnType<typeof detectEndpoints>> {
    return detectEndpoints({
      root: "/repo",
      files,
      readFile: makeMockReader(contents)
    });
  }

  it("extracts NestJS controller endpoints with concatenated prefixes", async () => {
    const result = await run([file("src/users/users.controller.ts")], {
      "src/users/users.controller.ts": `
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne() {}

  @Post()
  create() {}
}
        `
    });
    const ids = result.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(ids).toContain("GET /users/:id");
    expect(ids).toContain("POST /users");
    for (const e of result.endpoints) expect(e.framework).toBe("nest");
  });

  it("extracts Express endpoints from app/router calls", async () => {
    const result = await run([file("src/routes/api.ts")], {
      "src/routes/api.ts": `
router.get('/healthz', handler);
app.post('/api/login', handler);
        `
    });
    const ids = result.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(ids).toContain("GET /healthz");
    expect(ids).toContain("POST /api/login");
  });

  it("extracts FastAPI endpoints from decorators", async () => {
    const result = await run([file("apps/orders/router.py")], {
      "apps/orders/router.py": `
@router.get('/orders')
def list_orders(): ...

@app.post('/login')
def login(): ...
        `
    });
    const ids = result.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(ids).toContain("GET /orders");
    expect(ids).toContain("POST /login");
    for (const e of result.endpoints) expect(e.framework).toBe("fastapi");
  });

  it("extracts commander/yargs CLI commands", async () => {
    const result = await run([file("src/commands/build.ts")], {
      "src/commands/build.ts": `
program.command('build').action(handler);
program.command('release').action(release);
        `
    });
    const ids = result.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(ids).toContain("CLI build");
    expect(ids).toContain("CLI release");
  });

  it("ignores commented-out endpoint declarations", async () => {
    const result = await run([file("src/routes/api.ts")], {
      "src/routes/api.ts": `
// router.get('/disabled', handler);
# @router.get('/old')
router.get('/active', handler);
        `
    });
    expect(result.endpoints.map((e) => e.path)).toEqual(["/active"]);
  });
});

describe("detectFlows", () => {
  it("emits a flow that crosses controller -> service -> repository", () => {
    const imports = new Map<string, Set<string>>();
    imports.set(
      "src/users/users.controller.ts",
      new Set(["src/users/users.service.ts"])
    );
    imports.set(
      "src/users/users.service.ts",
      new Set(["src/users/users.repository.ts"])
    );

    const result = detectFlows({
      domains: [
        { file: "src/users/users.controller.ts", domain: "users" },
        { file: "src/users/users.service.ts", domain: "users" },
        { file: "src/users/users.repository.ts", domain: "users" }
      ],
      layers: [
        {
          file: "src/users/users.controller.ts",
          layer: "controller",
          kind: "backend"
        },
        {
          file: "src/users/users.service.ts",
          layer: "service",
          kind: "backend"
        },
        {
          file: "src/users/users.repository.ts",
          layer: "repository",
          kind: "backend"
        }
      ],
      endpoints: [
        {
          file: "src/users/users.controller.ts",
          method: "GET",
          path: "/users",
          framework: "nest"
        }
      ],
      importedFilesByFile: imports
    });

    expect(result.flows).toHaveLength(1);
    const flow = result.flows[0]!;
    expect(flow.steps).toHaveLength(3);
    expect(flow.steps.map((s) => s.layer)).toEqual([
      "controller",
      "service",
      "repository"
    ]);
    expect(flow.id).toMatch(/^flow:users\//);
  });

  it("skips flows that don't change layer", () => {
    const imports = new Map<string, Set<string>>();
    imports.set(
      "src/a/foo.controller.ts",
      new Set(["src/a/bar.controller.ts"])
    );

    const result = detectFlows({
      domains: [
        { file: "src/a/foo.controller.ts", domain: "a" },
        { file: "src/a/bar.controller.ts", domain: "a" }
      ],
      layers: [
        {
          file: "src/a/foo.controller.ts",
          layer: "controller",
          kind: "backend"
        },
        {
          file: "src/a/bar.controller.ts",
          layer: "controller",
          kind: "backend"
        }
      ],
      endpoints: [
        {
          file: "src/a/foo.controller.ts",
          method: "GET",
          path: "/x",
          framework: "express"
        }
      ],
      importedFilesByFile: imports
    });

    expect(result.flows).toHaveLength(0);
  });

  it("does not cross domain boundaries", () => {
    const imports = new Map<string, Set<string>>();
    imports.set("src/a/a.controller.ts", new Set(["src/b/b.service.ts"]));

    const result = detectFlows({
      domains: [
        { file: "src/a/a.controller.ts", domain: "a" },
        { file: "src/b/b.service.ts", domain: "b" }
      ],
      layers: [
        { file: "src/a/a.controller.ts", layer: "controller", kind: "backend" },
        { file: "src/b/b.service.ts", layer: "service", kind: "backend" }
      ],
      endpoints: [
        {
          file: "src/a/a.controller.ts",
          method: "GET",
          path: "/a",
          framework: "express"
        }
      ],
      importedFilesByFile: imports
    });
    expect(result.flows).toHaveLength(0);
  });
});

describe("runSemanticPass — orchestration", () => {
  it("emits domain/layer/endpoint/flow nodes and edges", async () => {
    const files: ScanFile[] = [
      file("src/users/users.module.ts"),
      file("src/users/users.controller.ts"),
      file("src/users/users.service.ts"),
      file("src/users/users.repository.ts")
    ];
    const imports = new Map<string, Set<string>>();
    imports.set(
      "src/users/users.controller.ts",
      new Set(["src/users/users.service.ts"])
    );
    imports.set(
      "src/users/users.service.ts",
      new Set(["src/users/users.repository.ts"])
    );

    const contents: Record<string, string> = {
      "src/users/users.controller.ts": `
@Controller('users')
export class UsersController {
  @Get()
  list() {}
}
      `
    };

    const result = await runSemanticPass({
      root: "/repo",
      scanFiles: files,
      importedFilesByFile: imports,
      readFile: makeMockReader(contents)
    });

    const types = new Set(result.nodes.map((n) => n.type));
    expect(types.has("domain")).toBe(true);
    expect(types.has("layer")).toBe(true);
    expect(types.has("endpoint")).toBe(true);
    expect(types.has("flow")).toBe(true);
    expect(types.has("step")).toBe(true);

    const edgeTypes = new Set(result.edges.map((e) => e.type));
    expect(edgeTypes.has("belongs_to_domain")).toBe(true);
    expect(edgeTypes.has("in_layer")).toBe(true);
    expect(edgeTypes.has("exposes_endpoint")).toBe(true);
    expect(edgeTypes.has("implements_flow")).toBe(true);
    expect(edgeTypes.has("flow_step")).toBe(true);

    expect(result.stats.domainCount).toBe(1);
    expect(result.stats.endpointCount).toBeGreaterThanOrEqual(1);
    expect(result.stats.flowCount).toBe(1);
  });

  it("emits cross_domain edges when imports cross domains", async () => {
    const files: ScanFile[] = [
      file("packages/auth/src/login.ts"),
      file("packages/billing/src/invoice.ts")
    ];
    const imports = new Map<string, Set<string>>();
    imports.set(
      "packages/auth/src/login.ts",
      new Set(["packages/billing/src/invoice.ts"])
    );

    const result = await runSemanticPass({
      root: "/repo",
      scanFiles: files,
      importedFilesByFile: imports,
      readFile: async () => ""
    });

    const cross = result.edges.filter((e) => e.type === "cross_domain");
    expect(cross).toHaveLength(1);
    expect(cross[0]!.from).toBe("domain:auth");
    expect(cross[0]!.to).toBe("domain:billing");
    expect(cross[0]!.weight).toBe(1);
  });
});
