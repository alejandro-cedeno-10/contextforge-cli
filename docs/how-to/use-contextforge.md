---
title: Cómo usar ContextForge
description: Guía paso a paso para instalar, ejecutar el pipeline y conectar tus agentes (Claude Code, Cursor, OpenCode)
audience: dev
type: how-to
tags: [getting-started, pipeline, agents]
updated: 2026-05-07
---

# Cómo usar ContextForge

Esta guía te lleva desde **cero** hasta tener un agente respondiendo con context-pack y skills/rules seleccionadas automáticamente para la tarea actual.

## 1. Requisitos

| Tool                      | Versión                                     |
| ------------------------- | ------------------------------------------- |
| Node.js                   | ≥ 22                                        |
| pnpm                      | ≥ 10                                        |
| (opcional) `openspec` CLI | última, vía `npm i -g @fission-ai/openspec` |

Verificar:

```bash
node --version    # v22.x.x
pnpm --version    # 10.x.x
```

## 2. Instalación

### Opción A — desde GitHub Packages (recomendado para consumir)

Configurar el registry para tu scope:

```bash
# .npmrc en tu proyecto
@alejandro-cedeno-10:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Instalar:

```bash
pnpm add -D @alejandro-cedeno-10/contextforge-cli
pnpm add -D @alejandro-cedeno-10/contextforge-mcp   # opcional, para MCP en agentes
```

`GITHUB_TOKEN` necesita scope `read:packages`. Crear uno en https://github.com/settings/tokens.

### Opción B — clonar y construir localmente (recomendado para desarrollo)

```bash
git clone https://github.com/alejandro-cedeno-10/contextforge-cli.git
cd contextforge-cli
pnpm install
pnpm typecheck
pnpm build
```

Verificar:

```bash
pnpm forge --help    # debería listar todos los comandos
pnpm test --run      # 202/202 tests pasando
```

## 3. Pipeline end-to-end (uso manual)

Desde cualquier proyecto donde tengas `forge` disponible:

```bash
# (solo la primera vez)
pnpm forge init

# (cada vez que cambien archivos del repo)
pnpm forge scan       # → .contextforge/scan.json
pnpm forge graph      # → .contextforge/graph.json (cache por hash; salta si no cambió)

# (cada nueva tarea / issue / fix)
pnpm forge context "fix race condition in tokenLedger writer"
# → .contextforge/context-pack.json
# → .contextforge/token-ledger.json
# → .contextforge/agent-manifest.json   (auto)
# → .claude/agent-manifest.md
# → .cursor/rules/contextforge-active.mdc
# → .contextforge/manifests/opencode-readme.md

# (solo si llevas SDD con OpenSpec)
pnpm forge spec fix-token-race
pnpm forge implement fix-token-race
```

Después de modificar código:

```bash
pnpm forge implement --check    # valida diff vs guardrails del implement-plan
```

## 4. Activar la selección por tarea en cada agente

El comando clave es `pnpm forge context "<tarea>"` — emite el agent-manifest automáticamente. Lo que cambia es **cómo lo carga cada agente en su sesión**.

### 4.1. Claude Code

**Setup una sola vez**: pegar en `.claude/settings.json`:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "pnpm forge manifest --agents=claude --force 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

Después de eso, cada prompt regenera `.claude/agent-manifest.md` con las skills relevantes. Más detalles: `docs/integrations/claude-code-hook.md`.

### 4.2. OpenCode

`opencode.json` ya está configurado (apunta al MCP server). Cuando arrancas conversación, OpenCode (o cualquier cliente MCP) llama:

```json
{
  "tool": "select_agent_context",
  "input": { "task": "el prompt del usuario" }
}
```

**Sin pasos manuales**. Computa el manifest live en memoria, sin tocar disco.

Detalles: `docs/integrations/opencode-mcp.md`.

### 4.3. Cursor

Cursor no expone hooks reactivos al prompt. Usa la rule `.cursor/rules/contextforge-active.mdc` (Auto Attached) que `forge context` regenera con globs por dominio. Cuando abres un archivo bajo, p.ej. `packages/core/`, la rule se carga automáticamente.

Para refrescar después de cambiar de tarea:

```bash
pnpm forge manifest --agents=cursor --force
```

Detalles: `docs/integrations/cursor-rules.md`.

## 5. Consumir desde código (sin CLI)

```typescript
import {
  buildAgentManifest,
  selectContext,
  scanProject
} from "@alejandro-cedeno-10/contextforge-core";

const scan = await scanProject(".");
// (graph y selección requieren artefactos previos; para uso programático
// considera correr el CLI o usar el MCP server)
```

El MCP server es el camino programático recomendado:

```bash
node node_modules/@alejandro-cedeno-10/contextforge-mcp/dist/index.js
```

Cualquier cliente MCP-compatible obtiene las 7 tools (`forge_status`, `forge_domain_map`, `forge_neighbors`, `forge_context`, `forge_check`, `select_agent_context`, `get_agent_manifest`).

## 6. Flujo recomendado por tipo de trabajo

### Bug fix puntual

```bash
pnpm forge context "fix <descripción del bug>"
# Abre el agente; el manifest ya está cargado.
# El agente lee context-pack.json para saber qué archivos tocar.
pnpm forge implement --check    # antes de commit
```

### Feature nueva con SDD

```bash
pnpm forge context "implement <feature>"
pnpm forge spec <feature-id>          # genera proposal/design/tasks/spec
# Edita los .md generados si hace falta más detalle.
pnpm forge implement <feature-id>     # plan con guardrails
# Ahora trabajas con el agente; commit por commit:
pnpm forge implement --check          # valida diff vs guardrails
```

### Auditoría de cambios

```bash
pnpm forge sync --since main          # delta vs main
pnpm forge impact                     # health check de artefactos + cobertura
```

## 7. Troubleshooting

| Síntoma                                     | Causa probable                                                           | Fix                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `No se pudo leer .contextforge/graph.json`  | No corriste `forge scan && forge graph`                                  | Ejecuta el pipeline desde el paso 1                                                     |
| `forge manifest` reporta `0 skills activas` | El manifest no encontró matches de dominio                               | Corre `pnpm forge skills --force` para regenerar skills, luego `forge manifest --force` |
| Cursor no carga la rule activa              | `.cursor/rules/contextforge-active.mdc` apunta a archivos que no existen | Regenera con `pnpm forge context "<tarea>" --force`                                     |
| Claude Code hook no se dispara              | `.claude/settings.json` no tiene el bloque `hooks`                       | Revisa el ejemplo de `docs/integrations/claude-code-hook.md`                            |
| MCP server no responde                      | El server no está corriendo o `PROJECT_ROOT` está mal                    | Verifica `opencode.json` o `.claude/settings.json` apunta al `dist/index.js` correcto   |

## 8. ¿Qué hace cada artefacto?

| Archivo                                 | Para quién               | Cuándo regenerar                            |
| --------------------------------------- | ------------------------ | ------------------------------------------- |
| `.contextforge/scan.json`               | Pipeline interno         | Cuando cambian archivos del repo            |
| `.contextforge/graph.json`              | Pipeline + visualización | Cuando cambian deps o estructura            |
| `.contextforge/context-pack.json`       | Agente (todos)           | Cada nueva tarea                            |
| `.contextforge/agent-manifest.json`     | Agente (neutral)         | Cada nueva tarea (auto vía `forge context`) |
| `.claude/agent-manifest.md`             | Claude Code              | Cada nueva tarea                            |
| `.cursor/rules/contextforge-active.mdc` | Cursor                   | Cada nueva tarea                            |
| `.contextforge/token-ledger.json`       | Reporting de ahorro      | Cada nueva tarea                            |
| `.contextforge/implement-plan.json`     | Pre-commit guardrails    | Cada nueva feature/fix                      |
| `openspec/changes/<id>/`                | Equipo + agente para SDD | Cuando inicias una feature/fix con SDD      |

## 9. Próximos pasos

- Lee `docs/EXAMPLES/end-to-end-flow.md` para un walkthrough con outputs reales.
- Lee `docs/token-savings-architecture.md` si te interesa el cálculo de ahorro por capa.
- Si vas a contribuir, mira `CONTRIBUTING.md` y `docs/IMPLEMENTATION_TASKS.md`.
