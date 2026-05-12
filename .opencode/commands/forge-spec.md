---
description: Genera una spec SDD usando ContextForge MCP tools
mode: all
---

Flujo para crear una spec SDD para la tarea: $ARGUMENTS

1. Llama el MCP tool `forge_context` con task="$ARGUMENTS" para obtener los archivos relevantes (budget 12000 tokens).
2. Llama el MCP tool `forge_spec` con change_id=<slug-kebab-case> derivado de "$ARGUMENTS".
3. Llena `openspec/changes/<id>/proposal.md` con: motivación, alcance, criterios de aceptación.
4. Llena `openspec/changes/<id>/specs/<dominio>/spec.md` con Requirements y Scenarios (Given/When/Then).
5. Llama `forge_implement` con el mismo change_id para generar los guardrails.
6. Reporta: change_id creado, archivos en scope, próximo paso.
