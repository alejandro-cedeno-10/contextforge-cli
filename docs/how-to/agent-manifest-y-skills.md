---
title: "Cómo funciona el manifest por herramienta y la activación selectiva de skills"
description: "Explica cómo forge context detecta qué skills/rules activar por tarea y qué archivos escribe para Claude Code, Cursor y OpenCode."
audience: dev
type: how-to
tags: [manifest, skills, claude-code, cursor, opencode, token-savings]
updated: 2026-05-08
---

# Cómo funciona el manifest por herramienta y la activación selectiva de skills

Cuando corrés `forge context "<descripción de la tarea>"`, el CLI no solo selecciona
archivos — también decide **qué skills y rules activar en cada herramienta**, basándose
en los dominios que toca esa tarea. Es automático: no configurás nada por tarea.

## El flujo de una sola línea

```bash
forge context "fix race condition en tokenLedger writer"
```

Internamente ocurre en este orden:

1. **PageRank + BFS** sobre `graph.json` → selecciona los archivos más relevantes
   (respetando el budget de tokens, 12 k por defecto).
2. **Detección de dominios** → extrae los dominios que tocan esos archivos
   (ej. `packages/core`, `packages/cli`).
3. **Filtrado de skills** → activa solo las skills cuyo dominio coincide con los
   dominios tocados.
4. **Render por herramienta** → escribe un archivo distinto para cada agente.

## Artefactos escritos

| Archivo | Para quién | Contenido |
|---|---|---|
| `.contextforge/context-pack.json` | todos los agentes | archivos seleccionados + razón + tokens |
| `.contextforge/token-ledger.json` | reporting | baseline vs packed, % ahorro, ratio |
| `.contextforge/agent-manifest.json` | neutro (todas las tools) | JSON con skills activas, razones, dominios |
| `.claude/agent-manifest.md` | Claude Code | Markdown con lista de skills + razón de activación |
| `.cursor/rules/contextforge-active.mdc` | Cursor | Frontmatter + globs de dominio + reglas activas |
| `.contextforge/manifests/opencode-readme.md` | OpenCode | Markdown con template MCP (`selectAgentContext`) |

Un solo `forge context` escribe los seis. Si solo querés regenerar los manifests
sin recomputar el pack:

```bash
forge manifest --agents=claude,cursor,opencode --force
```

## Cuándo se activa una skill

Una skill en `.claude/skills/` se incluye en el manifest activo si se cumple
alguna de estas tres condiciones:

| Condición | Ejemplo |
|---|---|
| Su `domain:` en frontmatter matchea un dominio tocado por la tarea | `domain: packages/core` y la tarea toca core |
| Tiene `alwaysApply: true` en frontmatter | skills de convenciones globales |
| Su nombre sigue la convención `ctx-<dominio-slug>` | `ctx-packages-cli.md` |

Si ninguna condición aplica, la skill **no se carga** — el agente no la ve, y no
gasta tokens en ella.

## Verificar el ahorro real

El token-ledger registra los números de cada ejecución:

```powershell
Get-Content .contextforge/token-ledger.json | ConvertFrom-Json |
  Select-Object -ExpandProperty savings
```

Ejemplo real de este repo (128 archivos):

```
absoluteTokens : 202618
savingsPct     : 94.41
compressionRatio : 17.9
```

El agente recibe ~12 k tokens en lugar de ~215 k. En el segundo turno de la misma
tarea, el context-pack ya está en caché (prompt caching) — el costo adicional es
mínimo.

## Cómo carga el manifest cada herramienta

### Claude Code

Claude Code lee `.claude/agent-manifest.md` automáticamente al inicio de la sesión
(está en la carpeta `.claude/`, que Claude Code escanea por defecto).

Para regenerarlo en **cada prompt** (opcional, recomendado si cambiás de tarea
frecuentemente), agregá este hook en `.claude/settings.json`:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "forge manifest --agents=claude --force 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

### Cursor

Cursor carga `.cursor/rules/contextforge-active.mdc` como una **Auto Attached rule**
cuando abrís un archivo bajo los globs definidos (ej. `packages/core/**`).

No hay hooks reactivos en Cursor, así que refrescás el manifest manualmente al
cambiar de tarea:

```bash
forge manifest --agents=cursor --force
```

### OpenCode

OpenCode usa el **MCP server** directamente — no lee archivos de disco. La tool
`select_agent_context` computa el manifest en memoria al recibir el prompt:

```json
{
  "tool": "select_agent_context",
  "input": { "task": "descripción de la tarea" }
}
```

Sin pasos manuales: OpenCode llama la tool al arrancar la conversación.

## Flujo completo para una feature nueva

```bash
# 1. Indexar (solo cuando cambian archivos)
forge scan
forge graph

# 2. Activar contexto para la tarea
forge context "implementar retry logic en saga orchestrator"
# → escribe los 6 artefactos arriba listados
# → tu Claude Code, Cursor y OpenCode leen solo las skills del feature

# 3. (opcional) Ver el grafo con los nodos del pack resaltados
forge viz
start .contextforge/graph.html

# 4. Si llevás SDD formal
forge spec retry-logic
forge implement retry-logic

# 5. Gate pre-commit
forge implement --check
```

## Ver qué skills quedaron activas

```bash
# JSON completo
cat .contextforge/agent-manifest.json

# Solo los nombres de skills activas (PowerShell)
Get-Content .contextforge/agent-manifest.json | ConvertFrom-Json |
  Select-Object -ExpandProperty activeSkills |
  ForEach-Object { $_.name }
```

## Génerar el scaffold de docs de tu proyecto

`forge docs` crea la **estructura Diataxis** en `docs/` con carpetas y tres archivos
semilla. No genera contenido de tu proyecto — es un andamio:

```bash
forge docs          # crea estructura (skip si ya existe)
forge docs --force  # sobreescribe los archivos semilla
```

Archivos que crea:

| Archivo | Descripción |
|---|---|
| `docs/INDEX.md` | Índice de navegación con las convenciones del proyecto |
| `docs/adr/README.md` | Plantilla MADR para Architecture Decision Records |
| `docs/architecture/module-relationships.md` | Tabla de dominios y dependencias cruzadas (del graph.json) |

Las carpetas `tutorials/`, `how-to/`, `reference/`, `explanation/` quedan vacías:
el contenido lo escribís vos (o con el agente usando el context-pack de la tarea).

Para agregar skills personalizadas por dominio (usadas por el manifest):

```bash
forge skills          # genera .claude/skills/ basado en dominios del grafo
forge skills --force  # sobreescribe las existentes
```
