#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanProject } from "@contextforge/core";

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

async function cmdInit(): Promise<void> {
  await ensureDir(outputPath("templates"));
  await ensureDir(outputPath("structure"));
  await ensureDir("packages/core/src");
  await ensureDir("packages/cli/src");
  console.log("ContextForge inicializado.");
}

async function cmdScan(): Promise<void> {
  const result = await scanProject(process.cwd());
  await writeJson(outputPath("scan.json"), result);
  console.log("Escrito .contextforge/scan.json");
}

async function cmdGraph(): Promise<void> {
  const scan = await readRequiredJson<{
    files: Array<{ path: string; hash: string; kind: string }>;
  }>(outputPath("scan.json"), "Ejecuta primero: pnpm forge scan");

  const graph = {
    schemaVersion: "0.1.0",
    project: {
      name: path.basename(process.cwd()),
      root: "."
    },
    nodes: scan.files.map((file) => ({
      id: `file:${file.path}`,
      type: "file",
      label: file.path.split("/").pop() ?? file.path,
      path: file.path,
      hash: file.hash,
      kind: file.kind
    })),
    edges: [] as Array<{ from: string; to: string; type: string }>
  };

  await writeJson(outputPath("graph.json"), graph);
  console.log("Escrito .contextforge/graph.json");
}

async function cmdContext(): Promise<void> {
  const graph = await readRequiredJson<{
    nodes: Array<{ path: string; id: string; hash?: string }>;
  }>(outputPath("graph.json"), "Ejecuta primero: pnpm forge graph");

  const pack = {
    schemaVersion: "0.1.0",
    task: "Describe la tarea aquí",
    budget: {
      maxInputTokens: 12000,
      estimatedTokens: 0
    },
    files: graph.nodes.slice(0, 12).map((node) => ({
      path: node.path,
      reason: "selected_by_default",
      mode: "summary",
      hash: node.hash
    }))
  };

  await writeJson(outputPath("context-pack.json"), pack);
  console.log("Escrito .contextforge/context-pack.json");
}

async function cmdSpec(): Promise<void> {
  const spec = `# Spec SDD

## Titulo
Cambiar este titulo.

## Problema
Describir el problema.

## Alcance
- En alcance:
- Fuera de alcance:

## Contexto tecnico
- Artefactos base:
  - .contextforge/scan.json
  - .contextforge/graph.json
  - .contextforge/context-pack.json

## Criterios de aceptacion
- [ ] Criterio 1
- [ ] Criterio 2

## Riesgos
- Riesgo 1

## Plan de pruebas
- Caso 1

## Tareas
- [ ] Tarea 1
- [ ] Tarea 2
`;

  await writeText(outputPath("spec.sdd.md"), spec);
  console.log("Escrito .contextforge/spec.sdd.md");
}

async function cmdImplement(): Promise<void> {
  const report = {
    schemaVersion: "0.1.0",
    status: "plan_only",
    nextStep:
      "Delegar la spec a Codex/OpenCode/Claude con el context-pack y validar salida contra schema."
  };

  await writeJson(outputPath("implement-plan.json"), report);
  console.log("Escrito .contextforge/implement-plan.json");
}

function printUsage(): void {
  console.log(`Uso:
  pnpm forge init
  pnpm forge scan
  pnpm forge graph
  pnpm forge context
  pnpm forge spec
  pnpm forge implement`);
}

export async function runCommand(command?: string): Promise<void> {
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
      await cmdContext();
      break;
    case "spec":
      await cmdSpec();
      break;
    case "implement":
      await cmdImplement();
      break;
    default:
      printUsage();
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCommand(process.argv[2]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
