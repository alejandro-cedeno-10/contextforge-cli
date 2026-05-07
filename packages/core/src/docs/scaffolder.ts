import type { GraphNode, GraphEdge } from "../graph/builder.js";

export interface DiataxisOptions {
  projectName: string;
  date: string;
  graph?: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
}

export interface DiataxisFile {
  path: string;
  content: string;
}

export interface DiataxisResult {
  folders: string[];
  files: DiataxisFile[];
}

const FOLDERS = [
  "docs/tutorials/",
  "docs/how-to/",
  "docs/reference/",
  "docs/explanation/",
  "docs/adr/",
  "docs/architecture/"
];

function getDomain(filePath: string): string {
  const parts = filePath.split("/");
  if (parts[0] === "packages" && parts.length > 1) return `packages/${parts[1]}`;
  return parts[0] ?? "root";
}

function buildIndex(projectName: string, date: string): string {
  return `---
title: "Índice de documentación — ${projectName}"
description: "Punto de entrada Diátaxis. Encuentra docs por intención: aprender, hacer, consultar, entender, decidir, diagramar."
audience: both
type: reference
tags: [index, diataxis, navigation]
updated: ${date}
---

# Documentación — ${projectName}

> Esta documentación sigue el [framework Diátaxis](https://diataxis.fr/): cuatro
> tipos de doc según la intención del lector. Si buscas el **punto de entrada
> agentico** (LLMs), abre [\`AGENTS.md\`](../AGENTS.md) en la raíz.

## 🧭 Cómo navegar

| Tu intención | Carpeta | Ejemplo |
|--------------|---------|---------|
| **Aprender** desde cero, paso a paso | [\`tutorials/\`](./tutorials/) | "Setup del proyecto en local" |
| **Resolver una tarea concreta** | [\`how-to/\`](./how-to/) | "Cómo desplegar a prod" |
| **Consultar** datos exactos | [\`reference/\`](./reference/) | OpenAPI spec, env vars |
| **Entender** el por qué | [\`explanation/\`](./explanation/) | "Por qué hexagonal aquí" |
| **Ver decisiones** arquitectónicas | [\`adr/\`](./adr/) | ADRs en formato MADR |
| **Diagramas** del sistema | [\`architecture/\`](./architecture/) | C4, codemaps |

## 📖 Tutorials (aprender)

Guías paso a paso pensadas para alguien que parte de cero.

_Crea archivos en \`tutorials/\` siguiendo la convención de frontmatter._

## 🛠️ How-to (resolver una tarea)

Recetas enfocadas en una sola tarea, asumiendo conocimiento básico del repo.

_Crea archivos en \`how-to/\`._

## 📚 Reference (consultar)

Información factual de consulta rápida.

_Crea archivos en \`reference/\`._

## 💡 Explanation (entender)

Documentos discursivos que explican el *por qué* del diseño.

_Crea archivos en \`explanation/\`._

## 🧱 ADR (decisiones)

Architecture Decision Records en formato MADR. Ver [\`adr/README.md\`](./adr/README.md)
para la plantilla y proceso.

_Crea ADRs numerados (\`0001-titulo.md\`, \`0002-titulo.md\`)._

## 🗺️ Architecture (diagramas y mapas)

- [\`module-relationships.md\`](./architecture/module-relationships.md) — Grafo de dependencias entre módulos (generado por \`forge docs\`).

## ✍️ Convenciones de docs

Toda doc nueva o migrada debe tener:

1. **Frontmatter YAML** con \`title\`, \`description\`, \`audience\`, \`type\`, \`tags\`, \`updated\`.
2. **Resumen de 3 líneas máx.** después del frontmatter, antes de cualquier h2.
   Permite a un agente decidir si lee el resto sin gastar tokens.
3. **Idioma:** español para docs nuevos. Los docs migrados pueden quedar en su idioma original.
4. **Encabezados:** un solo h1 (el título). Subsecciones con h2/h3.
5. **Enlaces relativos** entre docs (\`./how-to/deploy.md\`), nunca absolutos.

Para nuevos ADRs, usa la plantilla MADR en [\`adr/README.md\`](./adr/README.md).
`;
}

function buildAdrReadme(date: string): string {
  return `---
title: "ADR — Plantilla y proceso"
description: "Cómo crear un Architecture Decision Record en este proyecto."
audience: both
type: reference
tags: [adr, madr, conventions]
updated: ${date}
---

# Architecture Decision Records

Cada decisión arquitectónica se documenta como un ADR en formato [MADR](https://adr.github.io/madr/).

## Plantilla

\`\`\`markdown
---
title: "<NÚMERO>. <Título conciso>"
status: proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
---

# <NÚMERO>. <Título>

## Context

¿Qué fuerza esta decisión? ¿Qué restricciones existen?

## Decision

¿Qué decidimos? Una frase clara.

## Consequences

Qué cambia (positivo y negativo) cuando se aplica esta decisión.
\`\`\`

## Convención de nombres

\`<NNNN>-<kebab-case-title>.md\` — ej. \`0001-idempotency-durable-execution.md\`.
`;
}

interface DomainStats {
  files: number;
  byKind: Record<string, number>;
}

interface CrossDomainEdge {
  from: string;
  to: string;
  imports: number;
  tests: number;
}

function aggregateDomains(graph: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}): { domains: Map<string, DomainStats>; cross: CrossDomainEdge[] } {
  const domains = new Map<string, DomainStats>();
  const fileNodes = new Map<string, GraphNode>();

  for (const n of graph.nodes) {
    if (n.type !== "file" || !n.path) continue;
    fileNodes.set(n.id, n);
    const domain = getDomain(n.path);
    let stats = domains.get(domain);
    if (!stats) {
      stats = { files: 0, byKind: {} };
      domains.set(domain, stats);
    }
    stats.files += 1;
    const kind = n.kind ?? "unknown";
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
  }

  const crossKey = new Map<string, CrossDomainEdge>();
  for (const e of graph.edges) {
    if (e.type !== "imports" && e.type !== "tests") continue;
    const fn = fileNodes.get(e.from);
    const tn = fileNodes.get(e.to);
    if (!fn?.path || !tn?.path) continue;
    const fd = getDomain(fn.path);
    const td = getDomain(tn.path);
    if (fd === td) continue;
    const key = `${fd}→${td}`;
    let entry = crossKey.get(key);
    if (!entry) {
      entry = { from: fd, to: td, imports: 0, tests: 0 };
      crossKey.set(key, entry);
    }
    if (e.type === "imports") entry.imports += 1;
    if (e.type === "tests") entry.tests += 1;
  }

  return { domains, cross: [...crossKey.values()] };
}

function buildModuleRelationships(
  date: string,
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
): string {
  const { domains, cross } = aggregateDomains(graph);

  const domainRows = [...domains.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, stats]) => {
      const kindParts = Object.entries(stats.byKind)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, c]) => `${c} ${k}`)
        .join(", ");
      return `| ${domain} | ${stats.files} | ${kindParts} |`;
    })
    .join("\n");

  const domainTable =
    domains.size > 0
      ? `| Dominio | Archivos | Tipos |\n|---------|----------|-------|\n${domainRows}`
      : "_Sin dominios detectados._";

  const crossSection =
    cross.length > 0
      ? `| Origen | Destino | Imports | Tests |\n|--------|---------|---------|-------|\n${cross
          .sort((a, b) =>
            a.from === b.from
              ? a.to.localeCompare(b.to)
              : a.from.localeCompare(b.from)
          )
          .map(
            (c) => `| ${c.from} | ${c.to} | ${c.imports} | ${c.tests} |`
          )
          .join("\n")}`
      : "_Sin dependencias cruzadas detectadas._";

  return `---
title: "Mapa de relaciones entre módulos"
description: "Grafo de dependencias entre dominios del proyecto, generado a partir de .contextforge/graph.json."
audience: both
type: architecture
tags: [architecture, dependencies, modules]
updated: ${date}
---

# Mapa de relaciones entre módulos

Generado automáticamente por \`forge docs\` a partir de \`.contextforge/graph.json\`.

## Dominios

${domainTable}

## Dependencias cruzadas

${crossSection}
`;
}

export function buildDiataxisScaffold(
  options: DiataxisOptions
): DiataxisResult {
  const { projectName, date, graph } = options;

  const files: DiataxisFile[] = [
    { path: "docs/INDEX.md", content: buildIndex(projectName, date) },
    { path: "docs/adr/README.md", content: buildAdrReadme(date) }
  ];

  if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
    files.push({
      path: "docs/architecture/module-relationships.md",
      content: buildModuleRelationships(date, graph)
    });
  }

  return {
    folders: [...FOLDERS],
    files
  };
}
