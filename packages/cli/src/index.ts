#!/usr/bin/env node
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  blake3Hex,
  buildDiataxisScaffold,
  buildGraph,
  buildOpenSpec,
  renderSDD,
  selectContext,
  validateGuardrails,
  SchemaValidationError,
  SCHEMA_VERSIONS,
  scanProject,
  type GraphEdge,
  type GraphNode,
  type ScanResult,
  validateOrThrow
} from "@alejandro-cedeno-10/contextforge-core";

import { generateVizHtml, type VizNode, type VizEdge } from "./htmlTemplate.js";

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, "utf8");
}

function outputPath(...parts: string[]): string {
  return path.join(process.cwd(), ".contextforge", ...parts);
}

async function readRequiredJson<T>(filePath: string, hint: string): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`No se pudo leer ${filePath}. ${hint}`);
  }
}

async function tryReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string | true>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { positional, flags };
}

async function cmdInit(): Promise<void> {
  await ensureDir(outputPath("templates"));
  await ensureDir(outputPath("structure"));
  await ensureDir("packages/core/src");
  await ensureDir("packages/cli/src");
  console.log("ContextForge inicializado.");
}

async function cmdScan(): Promise<void> {
  const result = await scanProject(process.cwd());
  validateOrThrow("scan", result);
  await writeJson(outputPath("scan.json"), result);
  console.log("Escrito .contextforge/scan.json");
}

async function cmdGraph(): Promise<void> {
  const scanPath = outputPath("scan.json");
  let scanRaw: string;
  try {
    scanRaw = await fs.readFile(scanPath, "utf8");
  } catch {
    throw new Error(
      `No se pudo leer ${scanPath}. Ejecuta primero: pnpm forge scan`
    );
  }
  const scan = JSON.parse(scanRaw) as ScanResult;

  validateOrThrow("scan", scan);
  const scanHash = blake3Hex(scanRaw);

  try {
    const existingGraphRaw = await fs.readFile(
      outputPath("graph.json"),
      "utf8"
    );
    const existingGraph = JSON.parse(existingGraphRaw) as {
      scanRef?: { path?: string; scanHash?: string };
    };
    validateOrThrow("graph", existingGraph);
    if (existingGraph.scanRef?.scanHash === scanHash) {
      console.log("[graph] unchanged scan hash; skipping rebuild");
      return;
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      // Missing previous graph: continue and rebuild.
    } else if (
      error instanceof SyntaxError ||
      error instanceof SchemaValidationError
    ) {
      // Invalid previous graph: continue and rebuild.
    } else {
      throw error;
    }
  }

  const graphData = await buildGraph({ root: process.cwd(), scan });

  const graph = {
    schemaVersion: SCHEMA_VERSIONS.graph,
    project: {
      name: path.basename(process.cwd()),
      root: "."
    },
    generatedAt: new Date().toISOString(),
    scanRef: {
      path: ".contextforge/scan.json",
      scanHash
    },
    parser: graphData.parser,
    stats: graphData.stats,
    nodes: graphData.nodes,
    edges: graphData.edges
  };

  validateOrThrow("graph", graph);
  await writeJson(outputPath("graph.json"), graph);
  console.log("Escrito .contextforge/graph.json");
}

async function cmdContext(task = "Describe la tarea aqui"): Promise<void> {
  const graphRaw = await readRequiredJson<{
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      path?: string;
      hash?: string;
      kind?: string;
      lang?: string;
    }>;
    edges: Array<{ from: string; to: string; type: string; weight?: number }>;
  }>(outputPath("graph.json"), "Ejecuta primero: pnpm forge graph");

  validateOrThrow("graph", graphRaw);

  const scanRaw = await readRequiredJson<ScanResult>(
    outputPath("scan.json"),
    "Ejecuta primero: pnpm forge scan"
  );

  const BUDGET = 12000;

  const selected = selectContext({
    nodes: graphRaw.nodes as Parameters<typeof selectContext>[0]["nodes"],
    edges: graphRaw.edges as Parameters<typeof selectContext>[0]["edges"],
    scanFiles: scanRaw.files,
    budget: BUDGET
  });

  const allFileNodes = graphRaw.nodes.filter((n) => n.type === "file");
  const baselineTokens = allFileNodes.reduce((sum, n) => {
    const scan = scanRaw.files.find((f) => f.path === n.path);
    return sum + Math.max(20, Math.ceil((scan?.size ?? 500) / 4));
  }, 0);

  const packedTokens = selected.estimatedTokens;
  const absoluteTokens = baselineTokens - packedTokens;
  const savingsPct =
    baselineTokens === 0
      ? 0
      : Number(((absoluteTokens / baselineTokens) * 100).toFixed(2));
  const compressionRatio =
    packedTokens === 0 ? 0 : Number((baselineTokens / packedTokens).toFixed(2));

  const generatedAt = new Date().toISOString();

  const pack = {
    schemaVersion: SCHEMA_VERSIONS.contextPack,
    task,
    generatedAt,
    budget: {
      maxInputTokens: BUDGET,
      estimatedTokens: packedTokens
    },
    files: selected.files.map((f) => ({
      path: f.path,
      reason: f.reason,
      mode: f.mode,
      ...(f.hash ? { hash: f.hash } : {})
    }))
  };

  const byMode = selected.files.reduce(
    (counts, f) => ({
      ...counts,
      [f.mode]: (counts[f.mode as keyof typeof counts] ?? 0) + 1
    }),
    { full: 0, excerpt: 0, summary: 0 }
  );

  const ledger = {
    schemaVersion: SCHEMA_VERSIONS.tokenLedger,
    runId: `context-${Date.now()}`,
    timestamp: generatedAt,
    repo: {
      path: ".",
      filesTotal: allFileNodes.length
    },
    task: { description: task },
    tokenizer: {
      name: "approximation" as const,
      model: "char-count-div4"
    },
    baseline: {
      strategy: "full_repo_dump" as const,
      tokens: baselineTokens,
      filesIncluded: allFileNodes.length
    },
    packed: {
      tokens: packedTokens,
      filesIncluded: selected.files.length,
      byMode
    },
    savings: {
      absoluteTokens,
      savingsPct,
      compressionRatio
    },
    notes: [
      `Ranked ${selected.candidatesTotal} file nodes via Personalized PageRank.`,
      "Token estimation: char-count / 4 approximation."
    ]
  };

  validateOrThrow("context-pack", pack);
  validateOrThrow("token-ledger", ledger);
  await writeJson(outputPath("context-pack.json"), pack);
  await writeJson(outputPath("token-ledger.json"), ledger);
  console.log("Escrito .contextforge/context-pack.json");
  console.log("Escrito .contextforge/token-ledger.json");
}

async function cmdSpec(changeId = "change-1"): Promise<void> {
  type PackFile = { path: string; reason: string; mode: string };
  type ContextPack = { task?: string; files?: PackFile[] };
  const pack = await tryReadJson<ContextPack>(outputPath("context-pack.json"));
  const task = pack?.task ?? "Describe la tarea aqui";
  const affectedFiles: PackFile[] = pack?.files ?? [];

  const result = buildOpenSpec({ changeId, task, affectedFiles });
  for (const file of result.files) {
    await writeText(path.join(process.cwd(), file.path), file.content);
  }
  console.log(`Escrito ${result.changeDir}/ (proposal, design, tasks, specs)`);
}

async function cmdImplement(
  changeId = "stub",
  args: string[] = []
): Promise<void> {
  const { flags } = parseFlags(args);

  if (flags["check"]) {
    await cmdImplementCheck();
    return;
  }

  if (flags["approve"]) {
    await cmdImplementApprove();
    return;
  }

  type PackFile = { path: string; reason: string; mode: string; hash?: string };
  type ContextPack = { task?: string; files?: PackFile[] };
  const pack = await tryReadJson<ContextPack>(outputPath("context-pack.json"));
  const packFiles: PackFile[] = pack?.files ?? [];

  const allowedFiles = packFiles
    .filter((f) => f.mode !== "summary")
    .map((f) => f.path);

  const fileCount = packFiles.length;
  const maxLocDelta = Math.max(1, Math.min(1000, fileCount * 50));
  const maxFilesChanged = Math.max(1, allowedFiles.length + 2);

  const requiredTests = packFiles
    .filter((f) => f.reason === "test_for")
    .map((f) => f.path);

  const tasks =
    allowedFiles.length > 0
      ? allowedFiles.map((filePath, i) => {
          const pf = packFiles.find((f) => f.path === filePath)!;
          return {
            id: `T${i + 1}`,
            description: `Modificar ${filePath} (${pf.reason})`,
            files: [filePath]
          };
        })
      : [
          {
            id: "T1",
            description:
              "Ejecutar forge context + forge spec para derivar tareas concretas.",
            files: [] as string[]
          }
        ];

  const generatedAt = new Date().toISOString();

  const plan = {
    schemaVersion: SCHEMA_VERSIONS.implementPlan,
    taskId: changeId,
    title: pack?.task ?? "Plan pendiente de context-pack y spec",
    generatedAt,
    status: "plan_only" as const,
    ...(pack
      ? {
          contextPackRef: {
            path: ".contextforge/context-pack.json",
            packHash: blake3Hex(JSON.stringify(pack))
          }
        }
      : {}),
    guardrails: {
      allowedFiles,
      forbiddenPaths: ["**/.env*", "**/secrets/**", "**/.git/**"],
      maxLocDelta,
      maxFilesChanged,
      ...(requiredTests.length > 0 ? { requiredTests } : {}),
      noNewDependencies: true
    },
    tasks
  };

  validateOrThrow("implement-plan", plan);
  await writeJson(outputPath("implement-plan.json"), plan);
  console.log("Escrito .contextforge/implement-plan.json");
}

async function cmdImplementCheck(): Promise<void> {
  type PlanGuardrails = {
    allowedFiles: string[];
    forbiddenPaths: string[];
    maxLocDelta: number;
    maxFilesChanged?: number;
  };
  type Plan = {
    schemaVersion: string;
    taskId: string;
    status: string;
    guardrails: PlanGuardrails;
    tasks: unknown[];
    validation?: unknown;
    [k: string]: unknown;
  };

  const plan = await readRequiredJson<Plan>(
    outputPath("implement-plan.json"),
    "Ejecuta primero: pnpm forge implement"
  );

  let changedFiles: string[] = [];
  let locDelta = 0;

  try {
    const namesRaw = execSync("git diff --name-only HEAD", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    changedFiles = namesRaw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const statRaw = execSync("git diff --shortstat HEAD", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const m = /(\d+) insertion|(\d+) deletion/g;
    let match: RegExpExecArray | null;
    while ((match = m.exec(statRaw)) !== null) {
      locDelta += parseInt(match[1] ?? match[2] ?? "0", 10);
    }
  } catch {
    console.log("[check] git no disponible; validando sin diff.");
  }

  const validation = validateGuardrails(
    changedFiles,
    locDelta,
    plan.guardrails
  );

  const updated = {
    ...plan,
    validation: {
      ranAt: validation.ranAt,
      violations: validation.violations,
      passed: validation.passed
    }
  };

  validateOrThrow("implement-plan", updated);
  await writeJson(outputPath("implement-plan.json"), updated);

  if (validation.passed) {
    console.log("[check] passed: sin violaciones de guardrails.");
  } else {
    console.error("[check] FAILED: violaciones encontradas:");
    for (const v of validation.violations) {
      console.error(`  [${v.rule}] ${v.detail}`);
    }
    process.exit(3);
  }
}

async function cmdImplementApprove(): Promise<void> {
  type Plan = {
    status: string;
    [k: string]: unknown;
  };

  const plan = await readRequiredJson<Plan>(
    outputPath("implement-plan.json"),
    "Ejecuta primero: pnpm forge implement"
  );

  if (plan.status !== "plan_only") {
    throw new Error(
      `Estado actual es '${plan.status}'. Solo se puede aprobar desde 'plan_only'.`
    );
  }

  const updated = { ...plan, status: "approved_for_edit" };
  validateOrThrow("implement-plan", updated);
  await writeJson(outputPath("implement-plan.json"), updated);
  console.log("Estado actualizado a: approved_for_edit");
}

async function cmdDocs(args: string[] = []): Promise<void> {
  const { flags } = parseFlags(args);
  const force = flags["force"] === true;

  const graph = await tryReadJson<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }>(outputPath("graph.json"));

  const result = buildDiataxisScaffold({
    projectName: path.basename(process.cwd()),
    date: new Date().toISOString().slice(0, 10),
    graph
  });

  for (const folder of result.folders) {
    await ensureDir(path.join(process.cwd(), folder));
  }

  for (const file of result.files) {
    const fullPath = path.join(process.cwd(), file.path);
    let exists = false;
    try {
      await fs.access(fullPath);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !force) {
      console.log(`[skip] ${file.path} ya existe (usa --force para sobrescribir)`);
      continue;
    }
    await writeText(fullPath, file.content);
    console.log(`Escrito ${file.path}`);
  }
}

async function cmdViz(): Promise<void> {
  type GraphFile = {
    nodes: VizNode[];
    edges: VizEdge[];
    stats?: Record<string, unknown>;
  };
  type PackFile = { path: string; reason: string; mode: string };
  type ContextPack = { task?: string; files?: PackFile[] };

  const graphRaw = await readRequiredJson<GraphFile>(
    outputPath("graph.json"),
    "Ejecuta primero: pnpm forge graph"
  );
  const pack = await tryReadJson<ContextPack>(outputPath("context-pack.json"));

  const html = generateVizHtml({
    projectName: path.basename(process.cwd()),
    generatedAt: new Date().toISOString(),
    nodes: graphRaw.nodes ?? [],
    edges: graphRaw.edges ?? [],
    stats: graphRaw.stats ?? {},
    packFiles: pack?.files ?? [],
    task: pack?.task
  });

  const outPath = outputPath("graph.html");
  await writeText(outPath, html);
  console.log(`Escrito .contextforge/graph.html`);
  console.log(`Abre en navegador: ${outPath}`);
}

function printUsage(): void {
  console.log(`Uso:
  pnpm forge init
  pnpm forge scan
  pnpm forge graph
  pnpm forge context [task]
  pnpm forge spec [change-id]
  pnpm forge implement [change-id]
  pnpm forge implement --check
  pnpm forge implement --approve
  pnpm forge docs [--force]
  pnpm forge viz`);
}

export async function runCommand(
  command?: string,
  args: string[] = []
): Promise<void> {
  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "scan":
      await cmdScan();
      break;
    case "graph":
      await cmdGraph();
      break;
    case "context":
      await cmdContext(args[0]);
      break;
    case "spec":
      await cmdSpec(args[0]);
      break;
    case "implement":
      await cmdImplement(args[0], args.slice(1));
      break;
    case "viz":
      await cmdViz();
      break;
    case "docs":
      await cmdDocs(args);
      break;
    default:
      printUsage();
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCommand(process.argv[2], process.argv.slice(3)).catch((error: unknown) => {
    if (error instanceof SchemaValidationError) {
      console.error(`[forge] schema validation failed: ${error.message}`);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  });
}
