# Cursor — reglas y selección por tarea

Cursor no expone hooks reactivos al prompt. La selección de rules por tarea se cubre con tres modos combinados.

## Limitación conocida

A diferencia de Claude Code (hook `UserPromptSubmit`) u OpenCode (tool MCP), Cursor no permite ejecutar código arbitrario cuando el usuario escribe un prompt. La activación de rules es siempre declarativa.

## Los tres modos disponibles

### 1. `alwaysApply: true` — regla global

Aplica en toda conversación. Úsala para la regla de integración principal.

```yaml
---
description: ContextForge integration
alwaysApply: true
---
```

**Cuándo usar**: la rule `contextforge.mdc` ya la tiene — instruye a Cursor a usar los artefactos `.contextforge/`.

### 2. `Auto Attached` — activación por archivo abierto

Aplica cuando el dev abre un archivo que matchea los globs del frontmatter. `forge manifest` genera automáticamente `.cursor/rules/contextforge-active.mdc` con los globs de los dominios tocados.

```yaml
---
description: ContextForge active task — auto-derived from forge manifest
globs:
  - packages/core/**
  - packages/cli/**
alwaysApply: false
---
```

**Cuándo usar**: después de correr `pnpm forge context "<tarea>" && pnpm forge manifest --agents=cursor`, el archivo se regenera con los globs correctos. Cuando el dev abre un archivo bajo `packages/core/`, la rule entra automáticamente.

### 3. `Agent Requested` — el modelo decide

El modelo de Cursor lee la `description` de la rule y decide si incluirla según el contexto. Ideal para rules de dominio específico.

```yaml
---
description: Use when working on packages/core domain (selector, graph, scanner)
alwaysApply: false
---
```

**Cuándo usar**: `forge skills` ya genera `.claude/skills/ctx-<domain>.md`. Puedes crear reglas `.cursor/rules/ctx-<domain>.mdc` análogas con `description: "Use when working on <domain>"`. Cursor las activará según el contexto de la conversación.

## Combinación recomendada

| Rule                            | Modo                  | Cuándo activa                       |
| ------------------------------- | --------------------- | ----------------------------------- |
| `contextforge.mdc`              | `alwaysApply: true`   | Siempre                             |
| `contextforge-active.mdc`       | Auto Attached (globs) | Al abrir archivo del dominio actual |
| `ctx-<domain>.mdc` (opcionales) | Agent Requested       | El modelo decide según descripción  |

## Flujo sugerido

```bash
pnpm forge context "fix race in tokenLedger"
pnpm forge manifest --agents=cursor --force
# → .cursor/rules/contextforge-active.mdc regenerado con globs de dominios tocados
```
