---
title: "ContextForge — pitch para LinkedIn / charla técnica"
description: "Resumen ejecutivo del proyecto. Determinismo + capa semántica + 15 MCP tools que cierran el loop agéntico sin pnpm."
audience: dev
type: explanation
tags: [linkedin, pitch, marketing, summary]
updated: 2026-05-10
---

# ContextForge

> CLI determinista (Node 22+, TS, monorepo pnpm) que convierte cualquier repo en un **índice consultable por agentes IA**, sin meter LLM en el pipeline.

## El problema que resuelve

Cada sesión con un agente IA empieza cargando "todo el repo" o leyendo a ciegas. Y los specs escritos a mano se desactualizan; los escritos por el agente inventan referencias.

## Cómo lo resuelve — 4 capas determinísticas

### 1. Grafos para ahorrar tokens

`forge scan` (BLAKE3 incremental) → `forge graph` (file/symbol/folder/package con tree-sitter heurístico, cache por archivo) → `forge context "<tarea>"` que aplica **Personalized PageRank + BFS depth=2 + greedy budget pack** (full → excerpt → summary).

Resultado en este propio repo: **214 600 → 11 988 tokens** por sesión = **17.9× compresión, 94.4 % de ahorro**.

### 2. Capa semántica opt-in (Pass 5, v0.4+)

`forge graph --with-semantic` añade **6 tipos de nodos nuevos** (`domain`, `layer`, `endpoint`, `flow`, `step`, `concept`) y **6 aristas** (`belongs_to_domain`, `in_layer`, `exposes_endpoint`, `implements_flow`, `flow_step`, `cross_domain`). Detección 100 % heurística, sin LLM:

- **Backend**: NestJS, Express, FastAPI, commander/yargs.
- **Frontend**: Next.js (App Router + Pages Router), Astro, Vue/Nuxt.
- **Concepts opcionales**: Louvain con seed fijo (byte-stable) para sub-dominios densos.

El agente lee `"domain": "auth"`, `"layer": "controller"`, `"flow": "login-with-password"` directo del JSON, en vez de inferirlo del path.

### 3. SDD apoyando a OpenSpec, no compitiendo con él

Tres roles separados:

- **ContextForge** = selección de contexto (PageRank + budget) + capa semántica
- **OpenSpec** = estructura + validación (RFC 2119, Given/When/Then)
- **Agente IA** = redacción

`forge spec <id>` no escribe el spec final: emite `spec-input.json` (con `architecture` derivado del Pass 5) + `spec-prompt.md` con el contexto correcto, y luego delega a `openspec new change` si el CLI está en PATH (handoff), o produce el mismo formato moderno como fallback.

**Subgrafo congelado** (`graph.subset.json`) commiteado dentro del change → trazabilidad auditable de qué grafo justificó cada spec.

### 4. Solo cargar las skills/rules que aplican

`agent-manifest.json` neutral + renderers por agente (Claude Code, Cursor, OpenCode). Ninguna skill irrelevante entra al contexto.

## El multiplicador escondido — prompt caching

Como el output es **byte-estable** (nodos/edges ordenados, sin `generatedAt` cambiando, Louvain con seed fijo), Claude cachea el prompt entre iteraciones SDD: **descuento del 90 %**.

3 iteraciones de un feature: **$1.96 → $0.07 = ÷28× costo**.

## Loop agéntico cerrado — 15 MCP tools, cero `pnpm` en el loop

Después de `pnpm forge init` (bootstrap, una sola vez), el flujo agéntico vive 100 % en MCP:

```jsonc
{ "tool": "forge_rebuild_graph", "arguments": { "with_semantic": true } } // si código drifteó
{ "tool": "forge_context", "arguments": { "task": "ship login flow" } }
{ "tool": "forge_spec", "arguments": { "change_id": "ship-login" } }
{ "tool": "forge_implement", "arguments": { "change_id": "ship-login" } }
// agente edita
{ "tool": "forge_check", "arguments": {} }
{ "tool": "forge_archive_change", "arguments": { "change_id": "ship-login" } }
```

Más herramientas de navegación: `forge_neighbors`, `forge_domain_map`, `forge_semantic_map(domain?)`, `forge_flow(flow_id)`, `forge_change_subgraph`, `forge_change_context`, `forge_status`, `get_agent_manifest`, `select_agent_context`.

## Diferenciador vs Aider / Repomix / Continue / Cursor / Cody

**Determinismo end-to-end + JSON Schema validado + cache reusable entre agentes + interop OpenSpec + capa semántica heurística + loop agéntico 100 % MCP** — todo en una sola herramienta.

## Distribución

- npm público: `@anai-raia-alex/contextforge-{core,cli,mcp}`
- Docker multi-arch: `ghcr.io/alejandro-cedeno-10/contextforge-mcp`
- 333/333 tests verdes · 0 LLM en pipeline · 0 breaking changes en v0.3 → v0.4

## Los 5 mensajes memorables (para charla)

1. **94 % menos tokens por sesión** — verificado con `token-ledger.json`, no estimado.
2. **÷28× costo SDD con prompt caching** — gracias al output determinista byte-a-byte.
3. **No reemplaza OpenSpec, lo apoya.**
4. **El agente solo carga lo de tu tarea actual** — y ahora también razona sobre dominios/flujos, no solo archivos.
5. **Loop agéntico sin shell** — después del bootstrap, todo vive en MCP. Cero `pnpm` en el día a día.
