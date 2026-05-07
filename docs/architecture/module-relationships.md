---
title: "Mapa de relaciones entre módulos"
description: "Grafo de dependencias entre dominios del proyecto, generado a partir de .contextforge/graph.json."
audience: both
type: architecture
tags: [architecture, dependencies, modules]
updated: 2026-05-07
---

# Mapa de relaciones entre módulos

Generado automáticamente por `forge docs` a partir de `.contextforge/graph.json`.

## Dominios

| Dominio | Archivos | Tipos |
|---------|----------|-------|
| .agents | 3 | 3 doc |
| .claude | 1 | 1 config |
| .forgeignore | 1 | 1 unknown |
| .github | 5 | 4 config, 1 doc |
| .gitignore | 1 | 1 unknown |
| .prettierignore | 1 | 1 unknown |
| .prettierrc.json | 1 | 1 config |
| AGENTS.md | 1 | 1 doc |
| CLAUDE.md | 1 | 1 doc |
| CONTEXTFORGE_SOURCE_OF_TRUTH.md | 1 | 1 doc |
| CONTRIBUTING.md | 1 | 1 doc |
| deep-research-report.md | 1 | 1 doc |
| docs | 8 | 3 doc, 5 schema |
| eslint.config.js | 1 | 1 code |
| LICENSE | 1 | 1 unknown |
| package.json | 1 | 1 config |
| packages/agents | 1 | 1 config |
| packages/cli | 6 | 2 code, 2 config, 1 test, 1 unknown |
| packages/core | 28 | 15 code, 2 config, 10 test, 1 unknown |
| packages/integrations | 1 | 1 config |
| pnpm-lock.yaml | 1 | 1 config |
| pnpm-workspace.yaml | 1 | 1 config |
| README.md | 1 | 1 doc |
| tsconfig.json | 1 | 1 config |
| vitest.config.ts | 1 | 1 code |

## Dependencias cruzadas

| Origen | Destino | Imports | Tests |
|--------|---------|---------|-------|
| packages/cli | packages/core | 2 | 0 |
