---
name: contextforge-flow
description: Pipeline completo de ContextForge para ahorrar tokens — scan, graph, context, spec, implement, sync, impact
tags: [pipeline, all-domains]
---

# ContextForge — Flujo completo

Convierte cualquier repo en contexto curado para el agente. **Ahorro típico: 90%** vs cargar el repo completo.

## Pipeline (deterministico, sin LLM)

```bash
pnpm forge scan       # Indexa archivos + hashes BLAKE3
pnpm forge graph      # Construye grafo de dependencias (tree-sitter)
pnpm forge context "<tarea>"  # Selecciona archivos relevantes via PageRank
pnpm forge spec <id>  # Genera spec OpenSpec con evidencia del grafo
pnpm forge implement <id>  # Plan con guardrails (allowedFiles, maxLocDelta)
pnpm forge implement --check  # Valida que el agente respetó guardrails
```

## Artefactos producidos

`.contextforge/scan.json` · `graph.json` · `context-pack.json` · `token-ledger.json` · `implement-plan.json`

`openspec/changes/<id>/` con proposal, design, tasks, delta specs

## Cuándo usar cada uno

- **Inicio de proyecto**: `scan + graph` (5-30 s)
- **Cada tarea nueva**: `context "tarea concreta"` → produce pack ≤ 12k tokens
- **Spec accionable**: `spec <change-id>` → OpenSpec format
- **Antes de editar**: `implement <id>` → guardrails
- **Antes de commitear**: `implement --check` → valida diff vs guardrails
- **Mantenimiento**: `sync` (delta desde último commit) y `impact` (health check de artifacts + skills coverage)
