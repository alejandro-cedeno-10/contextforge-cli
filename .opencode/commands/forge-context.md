---
description: Selecciona archivos relevantes para una tarea usando ContextForge
mode: all
---

Tarea: $ARGUMENTS

1. Llama el MCP tool `forge_status` para verificar que el grafo está fresco.
2. Llama el MCP tool `forge_context` con task="$ARGUMENTS" y budget=12000.
3. Si el grafo está stale, llama `forge_rebuild_graph` primero.
4. Reporta: archivos seleccionados con su mode (full/excerpt/summary) y tokens estimados.
