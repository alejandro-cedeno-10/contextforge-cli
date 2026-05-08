#!/usr/bin/env node
import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  blake3Hex,
  buildAgentManifest,
  buildDiataxisScaffold,
  buildDomainSkills,
  buildGraph,
  buildHealthReport,
  buildOpenSpec,
  buildSpecInput,
  buildSyncReport,
  enrichGraphSymbols,
  exportToDot,
  exportToGraphML,
  extractChangeSubgraph,
  getDomain,
  loadGraphCache,
  renderClaude,
  renderCursor,
  renderOpenCode,
  renderSDD,
  renderSpecPrompt,
  saveGraphCache,
  selectContext,
  validateGuardrails,
  validateOpenSpecFiles,
  SchemaValidationError,
  SCHEMA_VERSIONS,
  scanProject,
  type GraphEdge,
  type GraphNode,
  type ScanResult,
  type SkillEntry,
  type RuleEntry,
  validateOrThrow
} from "@anai-raia-alex/contextforge-core";

import {
  generateSubsetHtml,
  generateVizHtml,
  type VizNode,
  type VizEdge
} from "./htmlTemplate.js";

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
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        i++;
        continue;
      }
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

  await writeAgentContextMd();
  console.log("ContextForge inicializado.");
  console.log(
    "Generado .contextforge/agent-context.md (consulta esto al abrir sesión con un agente IA)."
  );

  await maybeRunOpenSpecInit();

  console.log("\nIndexando repo...");
  await cmdScan();
  await cmdGraph();

  const projectName = path.basename(process.cwd());
  console.log("\nGenerando skills por dominio...");
  await cmdSkills(["--force"]);

  console.log("\nGenerando context-pack inicial...");
  await cmdContext(projectName + " — initial overview");

  console.log("\nGenerando visualización...");
  await cmdViz();
  console.log(
    "Listo. Abre .contextforge/graph.html para ver el grafo del proyecto."
  );
}

async function maybeRunOpenSpecInit(): Promise<void> {
  if (!isOpenSpecCliAvailable()) {
    console.log(
      "\nTip: instala OpenSpec CLI para activar el modo handoff de `forge spec`:\n" +
        "  npm i -g @fission-ai/openspec\n" +
        "  pnpm forge init   # re-corre para terminar el setup OpenSpec"
    );
    return;
  }

  const detectedTools = detectInstalledAiTools();
  const toolsFlag =
    detectedTools.length > 0 ? detectedTools.join(",") : "claude";

  if (detectedTools.length > 0) {
    console.log(
      `\nHerramientas detectadas: ${detectedTools.join(", ")} → openspec init usará --tools=${toolsFlag}`
    );
  } else {
    console.log(
      "\nNo se detectó ningún AI IDE en PATH. Usando --tools=claude por defecto."
    );
  }

  let openspecExists = false;
  try {
    await fs.access(path.join(process.cwd(), "openspec"));
    openspecExists = true;
  } catch {
    openspecExists = false;
  }

  if (openspecExists) {
    console.log(
      "\nOpenSpec ya está inicializado (./openspec/ existe). Re-corriendo init para sincronizar tools..."
    );
  }

  const result = safeOpenSpecExec([
    "init",
    ".",
    "--tools",
    toolsFlag,
    "--force"
  ]);
  if (result.ok) {
    console.log(
      `\nOpenSpec inicializado (vía \`openspec init . --tools=${toolsFlag} --force\`).`
    );
  } else {
    console.warn(
      `\n[init] openspec init falló (no es bloqueante):\n  ${result.error}\n` +
        `[init] puedes correrlo a mano: openspec init . --tools=${toolsFlag}`
    );
  }
}

async function writeAgentContextMd(): Promise<void> {
  type Ledger = {
    baseline?: { tokens?: number; filesIncluded?: number };
    packed?: { tokens?: number; filesIncluded?: number };
    savings?: { savingsPct?: number; compressionRatio?: number };
  };
  const ledger = await tryReadJson<Ledger>(outputPath("token-ledger.json"));

  const savingsLine =
    ledger?.savings?.savingsPct != null
      ? `- **Ahorro medido aquí**: ${ledger.savings.savingsPct.toFixed(1)} %  · ratio ${(ledger.savings.compressionRatio ?? 1).toFixed(2)}× ` +
        `(${ledger.baseline?.tokens ?? "?"} → ${ledger.packed?.tokens ?? "?"} tokens · ${ledger.packed?.filesIncluded ?? "?"} archivos)`
      : `- **Ahorro medido aquí**: aún no calculado. Corre \`pnpm forge context "<tarea>"\` para obtener métricas reales.`;

  const body = `# Contexto del repo para agentes IA

> **Archivo derivado.** Se regenera con \`forge init\`. No editar a mano.

## Cómo este repo te entrega contexto

Este proyecto usa **ContextForge + OpenSpec** para que un agente IA solo vea
los archivos relevantes a la tarea actual, en lugar de leer todo el repo.

${savingsLine}

## Artefactos disponibles (orden recomendado de lectura)

1. \`.contextforge/context-pack.json\` — los archivos que importan **para esta tarea**.
2. \`.contextforge/agent-manifest.json\` — skills/rules relevantes a la tarea.
3. \`.contextforge/spec-input.json\` — entrada estructurada para crear specs.
4. \`.contextforge/spec-prompt.md\` — prompt copy-paste para arrancar SDD (handoff).
5. \`.contextforge/graph.json\` — grafo completo de dependencias (referencia).
6. \`.contextforge/scan.json\` — inventario con hashes BLAKE3.
7. \`.contextforge/token-ledger.json\` — métricas auditables del ahorro.
8. \`.contextforge/implement-plan.json\` — guardrails (allowedFiles, maxLocDelta).

## Cómo consumirlos

- **Para responder preguntas o aplicar fixes**: lee primero \`context-pack.json\`.
  Si necesitas más, sigue los \`edges\` del grafo desde esos archivos.
- **NO** leas todo el repo a ciegas. Si crees que falta contexto, pídele al
  dev que corra \`pnpm forge context "tu nueva tarea"\`.
- **Para crear/modificar features con SDD**, sigue la receta de abajo.

## Receta SDD completa (ContextForge ⊕ OpenSpec)

\`\`\`bash
# Setup (una vez)
pnpm forge init                    # crea .contextforge + corre 'openspec init' si está
                                   # → instala instrucciones para tu agente (claude/cursor/opencode)

# Indexado (cuando cambian archivos del repo)
pnpm forge scan
pnpm forge graph                   # cache por hash; salta si no cambió

# Por cada tarea / feature / fix
pnpm forge context "<descripción de la tarea>"
                                   # → context-pack + agent-manifest auto

pnpm forge spec mi-feature-id
                                   # → spec-input.json (siempre)
                                   # con OpenSpec CLI:
                                   #   openspec new change <id> + spec-prompt.md
                                   # sin OpenSpec CLI:
                                   #   scaffold con formato moderno (Requirement+Scenario)

# El agente llena los .md del change (usando spec-prompt.md o el scaffold)

openspec list                      # ver changes activos
openspec show mi-feature-id        # inspeccionar uno
openspec validate mi-feature-id    # validación oficial

pnpm forge implement mi-feature-id # plan con guardrails (allowedFiles del pack)
# ... (trabajas en el código con el agente)
pnpm forge implement --check       # gate pre-commit: diff vs guardrails

# Cuando termines y se mergeó
openspec archive mi-feature-id -y  # mueve a openspec/specs/ y limpia changes/
\`\`\`

## Política para agentes que tocan este repo

- **No reload del repo**: confía en \`context-pack.json\`.
- **No specs a mano**: usa \`forge spec\` y deja que OpenSpec valide.
- **No bullets en spec.md**: cada Requirement debe tener su \`#### Scenario:\` con Given/When/Then.
- **Antes de commit**: \`forge implement --check\` debe pasar.
- **Al cerrar el PR**: \`openspec archive <change-id> -y\` (mueve specs y limpia).

## Comandos clave para agentes en una sesión

| Necesitas... | Corre |
| --- | --- |
| Saber qué archivos importan a la tarea | \`cat .contextforge/context-pack.json\` |
| Saber qué skills/rules aplican | \`cat .contextforge/agent-manifest.json\` |
| Ver el grafo del repo | \`open .contextforge/graph.html\` |
| Ver changes OpenSpec activos | \`openspec list\` |
| Inspeccionar un change | \`openspec show <id>\` |
| Validar antes de commit | \`pnpm forge implement --check\` |
`;

  await writeText(outputPath("agent-context.md"), body);
}

async function cmdScan(): Promise<void> {
  const result = await scanProject(process.cwd());
  validateOrThrow("scan", result);
  await writeJson(outputPath("scan.json"), result);
  console.log("Escrito .contextforge/scan.json");
}

async function cmdGraph(args: string[] = []): Promise<void> {
  const { flags } = parseFlags(args);
  const force = flags["force"] === true;
  const withCalls = flags["with-calls"] === true;
  const withRefs = flags["with-refs"] === true;
  const enrich = flags["enrich"] === true;
  const exportFormatRaw = flags["export"];
  const exportFormat =
    typeof exportFormatRaw === "string" ? exportFormatRaw.toLowerCase() : null;
  if (exportFormat && exportFormat !== "dot" && exportFormat !== "graphml") {
    throw new Error(
      `--export expects "dot" or "graphml" (got "${exportFormat}")`
    );
  }
  const useStderr = exportFormat !== null;
  const log = useStderr
    ? (msg: string): void => console.error(msg)
    : (msg: string): void => console.log(msg);

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

  if (!force) {
    try {
      const existingGraphRaw = await fs.readFile(
        outputPath("graph.json"),
        "utf8"
      );
      const existingGraph = JSON.parse(existingGraphRaw) as {
        scanRef?: { path?: string; scanHash?: string };
      };
      validateOrThrow("graph", existingGraph);
      if (
        existingGraph.scanRef?.scanHash === scanHash &&
        !enrich &&
        !exportFormat
      ) {
        log("[graph] unchanged scan hash; skipping rebuild");
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
  }

  const root = process.cwd();
  const cache = force ? null : await loadGraphCache(root);
  const graphData = await buildGraph({
    root,
    scan,
    cache,
    withCalls,
    withRefs
  });

  if (enrich) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "--enrich requires ANTHROPIC_API_KEY in the environment."
      );
    }
    log("[graph] enriching symbols via Anthropic API...");
    const enrichment = await enrichGraphSymbols(graphData.nodes, { apiKey });
    let applied = 0;
    for (const node of graphData.nodes) {
      const entry = enrichment.entries[node.id];
      if (!entry) continue;
      node.summary = entry.summary;
      node.tags = entry.tags;
      node.complexity = entry.complexity;
      applied++;
    }
    log(
      `[graph] enriched ${applied}/${enrichment.symbolsProcessed} symbols in ${enrichment.apiCalls} API call(s)`
    );
  }

  const graph = {
    schemaVersion: SCHEMA_VERSIONS.graph,
    project: {
      name: path.basename(root),
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
  await saveGraphCache(root, graphData.cacheUpdate);
  log(
    `Escrito .contextforge/graph.json (cache: ${graphData.cacheStats.reused} reutilizados, ${graphData.cacheStats.reparsed} reparseados)`
  );

  if (exportFormat === "dot") {
    process.stdout.write(
      exportToDot({ nodes: graphData.nodes, edges: graphData.edges })
    );
  } else if (exportFormat === "graphml") {
    process.stdout.write(
      exportToGraphML({ nodes: graphData.nodes, edges: graphData.edges })
    );
  }
}

async function cmdContext(
  task = "Describe la tarea aqui",
  args: string[] = []
): Promise<void> {
  const { flags } = parseFlags(args);
  const skipManifest = flags["no-manifest"] === true;
  const manifestForce = flags["force"] === true;

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

  type GraphFileNode = (typeof graphRaw.nodes)[number];
  type ScanFileEntry = (typeof scanRaw.files)[number];

  const allFileNodes = graphRaw.nodes.filter(
    (n: GraphFileNode) => n.type === "file"
  );
  const baselineTokens = allFileNodes.reduce(
    (sum: number, n: GraphFileNode) => {
      const scan = scanRaw.files.find((f: ScanFileEntry) => f.path === n.path);
      return sum + Math.max(20, Math.ceil((scan?.size ?? 500) / 4));
    },
    0
  );

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
    files: selected.files.map((f: (typeof selected.files)[number]) => ({
      path: f.path,
      reason: f.reason,
      mode: f.mode,
      ...(f.hash ? { hash: f.hash } : {})
    }))
  };

  const byMode = selected.files.reduce(
    (
      counts: { full: number; excerpt: number; summary: number },
      f: (typeof selected.files)[number]
    ) => ({
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

  if (!skipManifest) {
    console.log("");
    await generateAgentManifest({
      task,
      packedFiles: pack.files.map((f: { path: string }) => ({ path: f.path })),
      force: manifestForce
    });
  }
}

function isCliAvailable(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isOpenSpecCliAvailable(): boolean {
  return isCliAvailable("openspec");
}

function detectInstalledAiTools(): string[] {
  const tools: string[] = [];
  if (isCliAvailable("claude")) tools.push("claude");
  if (isCliAvailable("cursor")) tools.push("cursor");
  if (isCliAvailable("opencode")) tools.push("opencode");
  return tools;
}

function safeOpenSpecExec(
  args: string[]
): { ok: true; out: string } | { ok: false; error: string } {
  try {
    const out = execSync(`openspec ${args.join(" ")}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    return { ok: true, out };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: detail };
  }
}

async function loadGraphForSpecInput(): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
} | null> {
  type GraphFile = { nodes?: GraphNode[]; edges?: GraphEdge[] };
  const raw = await tryReadJson<GraphFile>(outputPath("graph.json"));
  if (!raw) return null;
  return { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
}

async function cmdSpec(
  changeId = "change-1",
  args: string[] = []
): Promise<void> {
  const { flags } = parseFlags(args);
  const forceFallback = flags["no-openspec"] === true;

  type PackFile = {
    path: string;
    reason: string;
    mode: "full" | "excerpt" | "summary";
  };
  type ContextPack = {
    task?: string;
    files?: PackFile[];
    budget?: { maxInputTokens?: number; estimatedTokens?: number };
  };

  const pack = await readRequiredJson<ContextPack>(
    outputPath("context-pack.json"),
    'Ejecuta primero: pnpm forge context "<tarea>"'
  );
  const task = pack.task ?? "Describe la tarea aqui";
  const affectedFiles: PackFile[] = pack.files ?? [];

  const graph = await loadGraphForSpecInput();
  const specInput = buildSpecInput({
    changeId,
    contextPack: {
      task,
      files: affectedFiles,
      budget: pack.budget
    },
    graph
  });
  validateOrThrow("spec-input", specInput);
  await writeJson(outputPath("spec-input.json"), specInput);
  console.log("Escrito .contextforge/spec-input.json");

  // Build a self-contained subgraph for the change so the OpenSpec change
  // directory carries its own context (skills/prompts reading
  // openspec/changes/<id>/ don't need to also load .contextforge/graph.json).
  const subset = graph
    ? extractChangeSubgraph(graph, {
        focusFiles: affectedFiles.map((f) => f.path),
        depth: 1
      })
    : null;

  const changeDir = path.join(process.cwd(), "openspec", "changes", changeId);
  await fs.mkdir(changeDir, { recursive: true });

  const cliAvailable = !forceFallback && isOpenSpecCliAvailable();
  let openSpecScaffolded = false;

  if (cliAvailable) {
    const newChange = safeOpenSpecExec(["new", "change", changeId]);
    if (!newChange.ok) {
      console.warn(
        `[spec] openspec new change ${changeId} falló:\n  ${newChange.error}\n` +
          `[spec] cayendo al modo fallback (genero el scaffold yo).`
      );
      await runFallbackScaffold({ changeId, task, affectedFiles, subset });
    } else {
      openSpecScaffolded = true;
      const instructions = safeOpenSpecExec([
        "instructions",
        "proposal",
        "--change",
        changeId,
        "--json"
      ]);
      const promptBody = renderSpecPrompt({
        specInput,
        openSpecInstructions: instructions.ok ? instructions.out : ""
      });
      await writeText(outputPath("spec-prompt.md"), promptBody);
      console.log("Escrito .contextforge/spec-prompt.md");

      console.log(
        `\nEsqueleto creado (openspec new change ${changeId}).\n` +
          `Pega .contextforge/spec-prompt.md en tu agente IA.\n` +
          `Cuando termine:\n` +
          `  openspec validate ${changeId}\n` +
          `  pnpm forge implement ${changeId}`
      );
    }
  } else {
    await runFallbackScaffold({ changeId, task, affectedFiles, subset });
  }

  // Subgraph + context.md are written AFTER OpenSpec's `new change` so that
  // any scaffolding side-effects (directory recreation, file overwrites)
  // can't clobber them. They are the contract that lets agents working on
  // openspec/changes/<id>/ stay self-contained.
  if (subset) {
    const generatedAt = new Date().toISOString();
    const subgraphPayload = {
      schemaVersion: SCHEMA_VERSIONS.graphSubset,
      changeId,
      generatedAt,
      graphRef: ".contextforge/graph.json",
      focus: subset.focus,
      stats: subset.stats,
      nodes: subset.nodes,
      edges: subset.edges
    };
    validateOrThrow("graph-subset", subgraphPayload);
    await writeJson(
      path.join(changeDir, "graph.subset.json"),
      subgraphPayload
    );
    console.log(
      `Escrito openspec/changes/${changeId}/graph.subset.json (${subset.stats.nodesTotal} nodos, ${subset.stats.edgesTotal} aristas)`
    );

    const subsetHtml = generateSubsetHtml({
      changeId,
      generatedAt,
      task,
      nodes: subset.nodes,
      edges: subset.edges,
      stats: subset.stats,
      focus: subset.focus
    });
    await writeText(path.join(changeDir, "graph.subset.html"), subsetHtml);
    console.log(
      `Escrito openspec/changes/${changeId}/graph.subset.html (visualizable en navegador)`
    );

    await writeText(
      path.join(changeDir, "context.md"),
      renderChangeContextMd({
        changeId,
        task,
        focus: subset.focus,
        stats: subset.stats,
        scaffoldedBy: openSpecScaffolded ? "openspec" : "fallback"
      })
    );
    console.log(
      `Escrito openspec/changes/${changeId}/context.md (mapa para agentes)`
    );
  }
}

function renderChangeContextMd(args: {
  changeId: string;
  task: string;
  focus: string[];
  stats: {
    nodesTotal: number;
    edgesTotal: number;
    depth: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
  };
  scaffoldedBy: "openspec" | "fallback";
}): string {
  const { changeId, task, focus, stats, scaffoldedBy } = args;
  const focusList = focus
    .slice(0, 12)
    .map((f) => `- \`${f}\``)
    .join("\n");
  const focusMore =
    focus.length > 12 ? `\n- _… y ${focus.length - 12} más en \`./graph.subset.json:focus\`_` : "";

  return `# Contexto del change \`${changeId}\`

> Mapa rápido para agentes IA y revisores. Generado por \`forge spec\`.
> Scaffold por: **${scaffoldedBy}**.

## Tarea

${task}

## Lectura recomendada (en orden)

| # | Archivo | Para qué |
| - | ------- | -------- |
| 1 | \`./proposal.md\` | Intent, scope, evidencia. Lectura humana. |
| 2 | \`./design.md\` | Decisiones técnicas. Incluye sección "Context graph (subset)". |
| 3 | \`./graph.subset.json\` | **Subgrafo del change** (${stats.nodesTotal} nodos, ${stats.edgesTotal} aristas, depth ${stats.depth}). Self-contained, validado por JSON Schema. |
| 4 | \`./graph.subset.html\` | Misma data, visualizable en navegador (Cytoscape standalone). |
| 5 | \`./tasks.md\` | Checklist de implementación. |
| 6 | \`./specs/<domain>/spec.md\` | Requirement+Scenario formal. \`openspec validate\` lo lee. |

## Artefactos globales referenciados

Solo si necesitas más allá del subgrafo del change:

| Path | Qué es |
| ---- | ------ |
| \`../../.contextforge/graph.json\` | Grafo completo del repo en el momento del spec. \`scanRef\` en el subset apunta a este hash. |
| \`../../.contextforge/context-pack.json\` | Selección PageRank que originó \`focus\`. |
| \`../../.contextforge/agent-manifest.json\` | Skills/rules activas para esta tarea. |
| \`../../.contextforge/implement-plan.json\` | Guardrails (\`allowedFiles\`, \`maxLocDelta\`) — generado por \`forge implement\`. |

## Vía MCP (preferido para agentes)

\`\`\`jsonc
// Lectura programática del subgrafo de este change:
{ "tool": "forge_change_subgraph", "arguments": { "change_id": "${changeId}" } }

// Solo si el subgrafo no responde lo que necesitas:
{ "tool": "forge_neighbors",       "arguments": { "file_path": "<path>" } }
{ "tool": "forge_context",         "arguments": { "task": "<refinamiento>" } }
\`\`\`

## Focus files (semilla del subgrafo)

${focusList}${focusMore}

---

**Política**: empieza siempre por \`./graph.subset.json\` (o el tool MCP). Solo cae a \`.contextforge/graph.json\` global cuando el subgrafo demuestre ser insuficiente para tu pregunta concreta.
`;
}

async function runFallbackScaffold({
  changeId,
  task,
  affectedFiles,
  subset
}: {
  changeId: string;
  task: string;
  affectedFiles: Array<{ path: string; reason: string; mode: string }>;
  subset?: {
    stats: {
      nodesTotal: number;
      edgesTotal: number;
      nodesByType: Record<string, number>;
      edgesByType: Record<string, number>;
      depth: number;
    };
  } | null;
}): Promise<void> {
  const result = buildOpenSpec({
    changeId,
    task,
    affectedFiles,
    graphSubset: subset ?? undefined
  });
  const issues = validateOpenSpecFiles(result.files);
  if (issues.length > 0) {
    const detail = issues
      .map(
        (i: { rule: string; file: string; detail: string }) =>
          `  - [${i.rule}] ${i.file}: ${i.detail}`
      )
      .join("\n");
    throw new Error(
      `OpenSpec scaffold failed conformance check:\n${detail}\n` +
        `This is a bug in @anai-raia-alex/contextforge-core. Please report it.`
    );
  }

  for (const file of result.files) {
    await writeText(path.join(process.cwd(), file.path), file.content);
  }
  console.log(`Escrito ${result.changeDir}/ (proposal, design, tasks, specs)`);
  console.log(
    `\nOpenSpec CLI no detectado.\n` +
      `Tip: instálalo para validación oficial:\n` +
      `  npm i -g @fission-ai/openspec\n` +
      `  openspec validate ${changeId}`
  );
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
      console.log(
        `[skip] ${file.path} ya existe (usa --force para sobrescribir)`
      );
      continue;
    }
    await writeText(fullPath, file.content);
    console.log(`Escrito ${file.path}`);
  }
}

async function cmdSkills(args: string[] = []): Promise<void> {
  const { flags } = parseFlags(args);
  const force = flags["force"] === true;

  const graph = await readRequiredJson<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }>(outputPath("graph.json"), "Ejecuta primero: pnpm forge graph");

  const result = buildDomainSkills({
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? []
  });

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
      console.log(
        `[skip] ${file.path} already exists (use --force to overwrite)`
      );
      continue;
    }
    await writeText(fullPath, file.content);
    console.log(`Escrito ${file.path}`);
  }

  if (result.skipped.length > 0) {
    console.log("");
    console.log(`[skills] ${result.skipped.length} dominios omitidos:`);
    for (const s of result.skipped) {
      console.log(`  ${s.domain} — ${s.reason}`);
    }
  }
}

function parseFrontmatterFields(content: string): {
  name?: string;
  domains?: string[];
  alwaysApply?: boolean;
} {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const block = match[1];
  const result: { name?: string; domains?: string[]; alwaysApply?: boolean } =
    {};
  const nameLine = /^name:\s*(.+)$/m.exec(block);
  if (nameLine) result.name = nameLine[1].trim();
  const alwaysLine = /^alwaysApply:\s*(true|false)$/m.exec(block);
  if (alwaysLine) result.alwaysApply = alwaysLine[1] === "true";
  const domainsLine = /^domains:\s*\[([^\]]*)\]$/m.exec(block);
  if (domainsLine) {
    result.domains = domainsLine[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return result;
}

async function loadSkillsFromDir(dir: string): Promise<SkillEntry[]> {
  const result: SkillEntry[] = [];
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const fullPath = path.join(dir, entry);
      const relPath = `.claude/skills/${entry}`;
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const fm = parseFrontmatterFields(content);
        result.push({
          path: relPath,
          name: fm.name ?? entry.replace(".md", ""),
          domains: fm.domains ?? [],
          alwaysApply: fm.alwaysApply
        });
      } catch {
        result.push({
          path: relPath,
          name: entry.replace(".md", ""),
          domains: []
        });
      }
    }
  } catch {
    // dir doesn't exist
  }
  return result;
}

async function loadRulesFromDir(dir: string): Promise<RuleEntry[]> {
  const result: RuleEntry[] = [];
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".mdc") && !entry.endsWith(".md")) continue;
      const fullPath = path.join(dir, entry);
      const relPath = `.cursor/rules/${entry}`;
      try {
        const content = await fs.readFile(fullPath, "utf8");
        const fm = parseFrontmatterFields(content);
        result.push({
          path: relPath,
          domains: fm.domains ?? [],
          alwaysApply: fm.alwaysApply
        });
      } catch {
        result.push({ path: relPath, domains: [] });
      }
    }
  } catch {
    // dir doesn't exist
  }
  return result;
}

interface GenerateManifestOptions {
  task: string;
  packedFiles: { path: string }[];
  agents?: string[];
  force?: boolean;
}

async function generateAgentManifest(
  options: GenerateManifestOptions
): Promise<void> {
  const agents = options.agents ?? ["claude", "cursor", "opencode"];
  const force = options.force ?? false;

  const skillsDir = path.join(process.cwd(), ".claude", "skills");
  const rulesDir = path.join(process.cwd(), ".cursor", "rules");
  const [skills, rules] = await Promise.all([
    loadSkillsFromDir(skillsDir),
    loadRulesFromDir(rulesDir)
  ]);

  const manifest = buildAgentManifest({
    task: options.task,
    packedFiles: options.packedFiles,
    skills,
    rules
  });
  validateOrThrow("agent-manifest", manifest);

  await writeJson(outputPath("agent-manifest.json"), manifest);
  console.log("Escrito .contextforge/agent-manifest.json");

  const allFiles: Array<{ path: string; content: string }> = [];
  if (agents.includes("claude")) allFiles.push(...renderClaude(manifest));
  if (agents.includes("cursor")) allFiles.push(...renderCursor(manifest));
  if (agents.includes("opencode")) allFiles.push(...renderOpenCode(manifest));

  for (const file of allFiles) {
    const fullPath = path.join(process.cwd(), file.path);
    let exists = false;
    try {
      await fs.access(fullPath);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !force) {
      console.log(
        `[skip] ${file.path} already exists (use --force to overwrite)`
      );
      continue;
    }
    await writeText(fullPath, file.content);
    console.log(`Escrito ${file.path}`);
  }

  console.log(
    `[manifest] ${manifest.skills.length} skills activas, ${manifest.skipped.skills.length} omitidas · dominios: ${manifest.domainsTouched.join(", ") || "(ninguno)"}`
  );
}

async function cmdManifest(args: string[] = []): Promise<void> {
  const { flags } = parseFlags(args);
  const force = flags["force"] === true;
  const agentsRaw =
    typeof flags["agents"] === "string"
      ? flags["agents"]
      : "claude,cursor,opencode";
  const agents = agentsRaw.split(",").map((a) => a.trim());

  type PackFile = { path: string };
  type ContextPackMin = { task?: string; files?: PackFile[] };
  const pack = await readRequiredJson<ContextPackMin>(
    outputPath("context-pack.json"),
    'Ejecuta primero: pnpm forge context "<tarea>"'
  );

  await generateAgentManifest({
    task: pack.task ?? "tarea sin descripcion",
    packedFiles: (pack.files ?? []).map((f: PackFile) => ({ path: f.path })),
    agents,
    force
  });
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

async function gitChangedFiles(since: string): Promise<string[]> {
  try {
    const raw = execSync(`git diff --name-only ${since} HEAD`, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function cmdSync(args: string[] = []): Promise<void> {
  const { flags } = parseFlags(args);
  const since =
    typeof flags["since"] === "string" ? (flags["since"] as string) : "HEAD~1";
  const rebuild = flags["rebuild"] === true;

  const changedFiles = await gitChangedFiles(since);

  type GraphFile = {
    nodes: GraphNode[];
    edges: GraphEdge[];
    scanRef?: { scanHash?: string };
  };
  type PackFile = { path: string; reason?: string; mode?: string };
  type ContextPack = { task?: string; files?: PackFile[] };

  const graph = await tryReadJson<GraphFile>(outputPath("graph.json"));
  const pack = await tryReadJson<ContextPack>(outputPath("context-pack.json"));

  let scanFileHash: string | undefined;
  try {
    const scanRaw = await fs.readFile(outputPath("scan.json"), "utf8");
    scanFileHash = blake3Hex(scanRaw);
  } catch {
    scanFileHash = undefined;
  }

  const report = buildSyncReport({
    changedFiles,
    graphScanHash: graph?.scanRef?.scanHash,
    scanFileHash,
    contextPackPaths: pack?.files?.map((f) => f.path) ?? [],
    contextPackTask: pack?.task
  });

  console.log(
    `[sync] ${report.changedFiles.length} archivos cambiados desde ${since}`
  );
  for (const file of report.changedFiles) {
    console.log(`  ${file}`);
  }

  console.log("");
  console.log(`[sync] ${report.affectedDomains.size} dominios afectados:`);
  for (const [domain, count] of report.affectedDomains) {
    console.log(`  ${domain} (${count} archivo${count === 1 ? "" : "s"})`);
  }

  console.log("");
  if (report.graphStale) {
    console.log("[sync] graph.json hash: STALE → rebuild recomendado");
  } else if (typeof scanFileHash === "string" && graph) {
    console.log("[sync] graph.json hash: matches → no rebuild needed");
  } else {
    console.log("[sync] graph.json hash: no comparable (artifacts faltan)");
  }

  if (report.contextPackAffected) {
    console.log(
      "[sync] context-pack toca archivos cambiados → potencialmente stale"
    );
  }

  if (report.recommendations.length > 0) {
    console.log("");
    console.log("[sync] Recomendaciones:");
    for (const rec of report.recommendations) {
      console.log(`  - ${rec}`);
    }
  }

  if (rebuild) {
    console.log("");
    console.log("[sync] --rebuild: ejecutando scan + graph...");
    await cmdScan();
    await cmdGraph();
  }
}

async function readSkillTags(): Promise<string[][]> {
  const skillsDir = path.join(process.cwd(), ".claude", "skills");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return [];
  }

  const tagsPerSkill: string[][] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(path.join(skillsDir, entry), "utf8");
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) {
        tagsPerSkill.push([]);
        continue;
      }
      const block = fmMatch[1];
      const tagLine = block.match(/^tags:\s*(.+)$/m);
      if (!tagLine) {
        tagsPerSkill.push([]);
        continue;
      }
      const value = tagLine[1].trim();
      let tags: string[] = [];
      if (value.startsWith("[") && value.endsWith("]")) {
        tags = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        tags = value
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      tagsPerSkill.push(tags);
    } catch {
      tagsPerSkill.push([]);
    }
  }
  return tagsPerSkill;
}

async function cmdImpact(): Promise<void> {
  const checks: Array<{ name: string }> = [
    { name: "scan.json" },
    { name: "graph.json" },
    { name: "context-pack.json" },
    { name: "implement-plan.json" },
    { name: "token-ledger.json" }
  ];

  const artifacts: Array<{
    name: string;
    exists: boolean;
    mtimeMs?: number;
    parsed?: Record<string, unknown> | null;
  }> = [];

  for (const c of checks) {
    const filePath = outputPath(c.name);
    try {
      const stat = await fs.stat(filePath);
      const parsed = await tryReadJson<Record<string, unknown>>(filePath);
      artifacts.push({
        name: c.name,
        exists: true,
        mtimeMs: stat.mtimeMs,
        parsed
      });
    } catch {
      artifacts.push({ name: c.name, exists: false });
    }
  }

  const graphArtifact = artifacts.find((a) => a.name === "graph.json");
  const graphParsed = graphArtifact?.parsed as
    | { nodes?: GraphNode[]; scanRef?: { scanHash?: string } }
    | undefined;
  const graphScanHash = graphParsed?.scanRef?.scanHash;

  let scanFileHash: string | undefined;
  if (artifacts.find((a) => a.name === "scan.json")?.exists) {
    try {
      const scanRaw = await fs.readFile(outputPath("scan.json"), "utf8");
      scanFileHash = blake3Hex(scanRaw);
    } catch {
      scanFileHash = undefined;
    }
  }

  const graphDomains = new Set<string>();
  for (const node of graphParsed?.nodes ?? []) {
    if (node.type !== "file" || !node.path) continue;
    graphDomains.add(getDomain(node.path));
  }

  const skillTags = await readSkillTags();

  const ctxArtifact = artifacts.find((a) => a.name === "context-pack.json");
  const ctxParsed = ctxArtifact?.parsed as
    | { budget?: { maxInputTokens?: number; estimatedTokens?: number } }
    | undefined;
  const contextPackTokens = ctxParsed?.budget?.estimatedTokens;
  const contextPackBudget = ctxParsed?.budget?.maxInputTokens;

  const report = buildHealthReport({
    artifacts,
    graphScanHash,
    scanFileHash,
    contextPackTokens,
    contextPackBudget,
    graphDomains: Array.from(graphDomains),
    skillTags
  });

  console.log(`[impact] Health check de ContextForge`);
  console.log("");
  console.log("Artifacts (.contextforge/):");
  for (const a of report.artifacts) {
    if (!a.exists) {
      console.log(`  [missing] ${a.name}`);
      continue;
    }
    const ageStr =
      typeof a.ageMinutes === "number" ? ` _(${a.ageMinutes}m ago)_` : "";
    const detailStr = a.detail ? ` — ${a.detail}` : "";
    const warnStr = a.warning ? `  WARN: ${a.warning}` : "";
    console.log(`  [ok] ${a.name}${detailStr}${ageStr}${warnStr}`);
  }

  if (typeof report.budgetUsedPct === "number") {
    console.log("");
    console.log(`[impact] context-pack budget: ${report.budgetUsedPct}%`);
  }
  if (typeof report.savingsPct === "number") {
    console.log(`[impact] token savings: ${report.savingsPct}%`);
  }

  console.log("");
  console.log(
    `Skills coverage (.claude/skills/): ${report.coverage.totalSkills} skills · ${report.coverage.coveredDomains.length} dominios cubiertos · ${report.coverage.uncoveredDomains.length} sin skill`
  );
  if (report.coverage.uncoveredDomains.length > 0) {
    console.log(`  Uncovered: ${report.coverage.uncoveredDomains.join(", ")}`);
  }

  if (report.warnings.length > 0) {
    console.log("");
    console.log("Suggestions:");
    for (const w of report.warnings) {
      console.log(`  - ${w}`);
    }
  }
}

function printUsage(): void {
  console.log(`Uso:
  pnpm forge init
  pnpm forge scan
  pnpm forge graph [--force] [--with-calls] [--with-refs] [--enrich] [--export=<dot|graphml>]
  pnpm forge context [task] [--no-manifest] [--force]
  pnpm forge spec [change-id]
  pnpm forge implement [change-id]
  pnpm forge implement --check
  pnpm forge implement --approve
  pnpm forge docs [--force]
  pnpm forge skills [--force]
  pnpm forge manifest [--agents=claude,cursor,opencode] [--force]
  pnpm forge viz
  pnpm forge sync [--since HEAD~1] [--rebuild]
  pnpm forge impact`);
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
      await cmdGraph(args);
      break;
    case "context":
      await cmdContext(args[0], args.slice(1));
      break;
    case "spec":
      await cmdSpec(args[0], args.slice(1));
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
    case "skills":
      await cmdSkills(args);
      break;
    case "manifest":
      await cmdManifest(args);
      break;
    case "sync":
      await cmdSync(args.slice(0));
      break;
    case "impact":
      await cmdImpact();
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
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[forge] schema validation failed: ${msg}`);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  });
}
