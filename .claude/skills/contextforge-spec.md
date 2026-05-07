---
name: contextforge-spec
description: Generar spec OpenSpec a partir del grafo de dependencias del proyecto
tags: [openspec, packages/core]
---

# ContextForge — Spec OpenSpec desde grafo

`forge spec <change-id>` lee `.contextforge/context-pack.json` y emite directamente en formato **OpenSpec**:

```
openspec/changes/<change-id>/
  proposal.md   # Intent, Scope, Context
  design.md     # Decisiones técnicas con archivos del grafo
  tasks.md      # T1, T1.1, T2... numeradas
  specs/<domain>/spec.md  # ADDED / MODIFIED / REMOVED Requirements
```

## Pre-requisitos

`forge context "<tarea>"` debe haberse ejecutado primero — `spec` toma el `task` y los `affectedFiles` del context-pack.

## Formato de Requirements

Given/When/Then + RFC 2119:

```markdown
### Given <precondición>, when <acción>, then <resultado>.

The system MUST <comportamiento esperado>.
```

## Dominio inferido

`spec` infiere el `<domain>` del path más tocado en el context-pack:

- `packages/<pkg>/src/<domain>/...` → `<domain>`
- `src/<domain>/...` → `<domain>`
- Default: `core`

## Sin LLM

Spec se genera deterministicamente del context-pack. Cero tokens consumidos.
