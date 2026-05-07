# Design: agent-manifest

## Technical approach

### Capa pure-logic — `packages/core/src/manifest/agentManifest.ts`

Sin I/O, sin red, sin LLM. Recibe artefactos parseados, devuelve el manifiesto.

```typescript
export interface SkillEntry {
  path: string; // ".claude/skills/ctx-packages-core.md"
  name: string; // "ctx-packages-core"
  domains: string[]; // ["packages/core"] (de frontmatter o derivado del slug)
  alwaysApply?: boolean;
}

export interface RuleEntry {
  path: string; // ".cursor/rules/contextforge.mdc"
  description?: string;
  domains: string[]; // de frontmatter "domains:" si existe
  alwaysApply?: boolean; // de frontmatter "alwaysApply:"
}

export interface AgentManifestOptions {
  task: string; // del context-pack
  packedFiles: ReadonlyArray<{ path: string }>; // del context-pack
  skills: ReadonlyArray<SkillEntry>;
  rules: ReadonlyArray<RuleEntry>;
}

export interface AgentManifestResult {
  schemaVersion: string;
  task: string;
  domainsTouched: string[]; // ordenados, deduplicados
  skills: Array<{
    path: string;
    name: string;
    reason: string; // "task touches packages/core" | "alwaysApply"
    matchType: "domain" | "alwaysApply" | "explicit";
  }>;
  rules: Array<{
    path: string;
    reason: string;
    matchType: "domain" | "alwaysApply" | "glob";
    suggestedGlobs?: string[]; // archivos del pack en ese dominio
  }>;
  skipped: {
    skills: Array<{ name: string; reason: string }>;
    rules: Array<{ path: string; reason: string }>;
  };
}

export function buildAgentManifest(
  opts: AgentManifestOptions
): AgentManifestResult;
```

### Algoritmo

1. Calcular `domainsTouched = unique(packedFiles.map(f => getDomain(f.path))).sort()`.
2. Para cada `skill`:
   - Si `skill.alwaysApply === true` → incluir con `matchType: "alwaysApply"`, `reason: "skill marked alwaysApply"`.
   - Si `skill.domains.length > 0` y alguna intersecta con `domainsTouched` → incluir, `matchType: "domain"`, `reason: "task touches <dominio>"`.
   - Si no hay frontmatter `domains` pero el `name` cumple `ctx-<slug>` y `<slug>` deslugificado matchea un dominio → incluir, `matchType: "explicit"`.
   - Si no matchea nada → `skipped.skills.push(...)` con razón.
3. Para cada `rule`:
   - Misma lógica que skills.
   - Adicional: `suggestedGlobs` derivado de los archivos del pack que están en los dominios del rule.
4. Ordenar `skills[]` y `rules[]` por `path` para output reproducible.
5. Validar resultado contra `agent-manifest.schema.json` antes de retornar.

### Schema — `docs/schemas/agent-manifest.schema.json`

```jsonc
{
  "$id": "https://contextforge.dev/schemas/agent-manifest.json",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgentManifest",
  "type": "object",
  "required": [
    "schemaVersion",
    "task",
    "domainsTouched",
    "skills",
    "rules",
    "skipped"
  ],
  "properties": {
    "schemaVersion": { "type": "string", "const": "1.0.0" },
    "task": { "type": "string", "minLength": 1 },
    "domainsTouched": { "type": "array", "items": { "type": "string" } },
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "name", "reason", "matchType"],
        "properties": {
          "path": { "type": "string" },
          "name": { "type": "string" },
          "reason": { "type": "string" },
          "matchType": { "enum": ["domain", "alwaysApply", "explicit"] }
        }
      }
    },
    "rules": {
      /* análogo */
    },
    "skipped": {
      /* análogo */
    }
  }
}
```

Registrar en `packages/core/src/schema/versions.ts` con clave `agentManifest`.

### Capa CLI — `cmdManifest` en `packages/cli/src/index.ts`

Patrón consistente con `cmdSkills`:

1. Leer `.contextforge/context-pack.json` (con `readRequiredJson` y hint a correr `forge context` si falta).
2. Escanear `.claude/skills/*.md` → parsear frontmatter (gray-matter o regex propio mínimo) → `SkillEntry[]`.
3. Escanear `.cursor/rules/*.mdc` → parsear frontmatter → `RuleEntry[]`.
4. Llamar `buildAgentManifest({ task, packedFiles, skills, rules })`.
5. Escribir `.contextforge/agent-manifest.json` (validado).
6. Por defecto correr todos los renderers; con `--agents=claude,cursor` correr solo los listados.

```typescript
async function cmdManifest(argv: string[]): Promise<void>;
```

### Renderers (uno por agente, todos puros)

Cada renderer recibe `AgentManifestResult` y devuelve `Array<{ path: string; content: string }>`. La capa CLI hace el `writeText`.

#### `packages/core/src/manifest/renderers/claude.ts`

Emite **un solo archivo** `.claude/agent-manifest.md`:

```markdown
---
name: contextforge-active-task
description: Skills relevantes para la tarea actual — derivado de forge manifest
---

# Tarea: <task>

Dominios tocados: <list>

## Skills sugeridas

- `ctx-packages-core` — task touches packages/core
- `ctx-openspec` — alwaysApply

## Skills omitidas (referencia)

- `ctx-packages-mcp` — domain not touched
```

No reescribe las skills existentes. Es una **señal** que el dev (o un hook `SessionStart` futuro) puede usar.

#### `packages/core/src/manifest/renderers/cursor.ts`

Emite `.cursor/rules/contextforge-active.mdc`:

```markdown
---
description: ContextForge active task — auto-derived from forge manifest
globs:
  - packages/core/**
  - packages/cli/src/index.ts
alwaysApply: false
---

# Active task

<task>

## Domains touched

- packages/core
- packages/cli

## Active rules

- `.cursor/rules/contextforge.mdc` — alwaysApply
```

`globs` se derivan de `packedFiles` agrupados por dominio (un glob por dominio: `<domain>/**`, más rutas exactas para archivos fuera de un paquete). Esto activa el modo **Auto Attached** de Cursor: cuando el dev abre uno de esos archivos, la regla se carga.

#### `packages/core/src/manifest/renderers/opencode.ts`

OpenCode no tiene un sistema de rules propio comparable a Cursor — consume el repo vía MCP. Por eso el renderer emite **dos cosas**:

1. **Copia neutral**: `.contextforge/agent-manifest.json` ya queda escrito por la capa CLI, OpenCode lo puede leer directo.
2. **Tool MCP**: extender `packages/mcp/src/index.ts` registrando `getAgentManifest` que devuelva el JSON parseado al cliente OpenCode. El config `opencode.json` ya apunta al MCP; la nueva tool aparece automáticamente.

```typescript
// en packages/mcp/src/index.ts
server.registerTool({
  name: "getAgentManifest",
  description:
    "Returns the active agent manifest (skills/rules selected for the current task)",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const manifest = await readJson(".contextforge/agent-manifest.json");
    return {
      content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }]
    };
  }
});
```

### Data flow

```
forge scan  →  scan.json
forge graph →  graph.json
forge context "<task>" → context-pack.json + token-ledger.json
forge skills (opcional) → .claude/skills/ctx-*.md

CAPA OFFLINE (snapshots, CI, pre-commit):
                    ┌──────────────────────────────────────────┐
forge manifest →    │  .contextforge/agent-manifest.json       │  (neutral)
                    │  .claude/agent-manifest.md               │  (Claude)
                    │  .cursor/rules/contextforge-active.mdc   │  (Cursor)
                    └──────────────────────────────────────────┘

CAPA RUNTIME (por sesión, según el prompt):
                    ┌──────────────────────────────────────────┐
prompt del dev  →   │  hook UserPromptSubmit (Claude Code)     │
                    │      └→ MCP selectAgentContext({task})   │
                    │            └→ buildAgentManifest()       │  (en memoria)
                    │               └→ inyectado al modelo     │
                    └──────────────────────────────────────────┘

OpenCode (vía MCP directamente):
                    cliente OpenCode
                       └→ MCP selectAgentContext({task})
                            └→ buildAgentManifest()             (en memoria)
```

### Capa runtime — Tool MCP parametrizada

`packages/mcp/src/index.ts` registra **dos** tools relacionadas:

```typescript
// Runtime: computa en memoria, sin tocar disco. Recibe la tarea del cliente.
server.registerTool({
  name: "selectAgentContext",
  description:
    "Computes the agent manifest for a given task (in-memory, no files written). Use at the start of a session or whenever the task changes.",
  inputSchema: {
    type: "object",
    required: ["task"],
    properties: {
      task: { type: "string", minLength: 1 },
      agents: {
        type: "array",
        items: { enum: ["claude", "cursor", "opencode"] },
        default: ["claude", "cursor", "opencode"]
      }
    }
  },
  handler: async ({ task, agents }) => {
    // 1. Carga (cacheado) scan.json + graph.json del disco — son stale-pero-validos
    // 2. Lee skills/rules del disco (parsing de frontmatter)
    // 3. Llama selectContext() para resolver packedFiles según task
    // 4. Llama buildAgentManifest() puro
    // 5. Devuelve JSON válido (no escribe nada)
    return { content: [{ type: "text", text: JSON.stringify(manifest) }] };
  }
});

// Offline: lee el archivo precomputado.
server.registerTool({
  name: "getAgentManifest",
  description:
    "Returns the manifest from .contextforge/agent-manifest.json (precomputed by 'forge manifest').",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    /* lee disco */
  }
});
```

**Por qué dos tools**: `selectAgentContext` es para runtime per-prompt; `getAgentManifest` es para cuando un agente quiere consumir un snapshot persistido (ej. CI, dashboards). Comparten 100% del core.

### Capa runtime — Hook Claude Code

Plantilla copy-paste documentada en `docs/integrations/claude-code-hook.md`. El usuario la pega en `.claude/settings.json`:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node packages/mcp/dist/cli-wrapper.js selectAgentContext --task=\"$CLAUDE_USER_PROMPT\""
          }
        ]
      }
    ]
  }
}
```

El hook:

1. Recibe el prompt del usuario en `$CLAUDE_USER_PROMPT` (env var inyectada por Claude Code).
2. Invoca un thin wrapper que llama `buildAgentManifest` con ese task.
3. Imprime a stdout un bloque markdown `## Sugerencias de skills/rules para esta tarea` con las entradas relevantes.
4. Claude Code captura el stdout y lo añade como `additionalContext` al modelo (comportamiento estándar de los hooks `UserPromptSubmit`).

El wrapper `packages/mcp/src/cliWrapper.ts` es un binario CLI que reusa el mismo `buildAgentManifest` — no es código nuevo, solo otra entrada al mismo módulo.

### Capa runtime — OpenCode

OpenCode ya consume el MCP server vía `opencode.json`. Cuando el agente arranca una conversación con una tarea, llama `selectAgentContext({ task })` como primera tool call. La respuesta se incorpora a su contexto.

No requiere config adicional más allá de la entrada MCP que ya existe (`opencode.json`).

### Capa runtime — Cursor (limitación documentada)

Cursor **no expone hooks reactivos al prompt**. Lo runtime que sí ofrece:

| Modo de rule            | Cuándo se activa                          | Aplicabilidad para nosotros         |
| ----------------------- | ----------------------------------------- | ----------------------------------- |
| `alwaysApply: true`     | Siempre                                   | La rule global (`contextforge.mdc`) |
| `Auto Attached` (globs) | Cuando el dev abre un archivo que matchea | Generado por `forge manifest`       |
| `Agent Requested`       | El modelo decide leyendo `description`    | Rules de dominio (nuevas)           |
| `Manual` (@-mention)    | Solo si el dev escribe `@nombre-rule`     | No usado                            |

Estrategia para Cursor:

1. Mantener `.cursor/rules/contextforge.mdc` con `alwaysApply: true` (la regla global ya existe — no se toca).
2. Generar (vía `forge manifest`) `.cursor/rules/ctx-<domain>.mdc` para cada dominio del repo, con frontmatter `description: "Use when working on <domain>"` y modo `Agent Requested`. El modelo de Cursor decide dinámicamente.
3. Mantener `.cursor/rules/contextforge-active.mdc` (Auto Attached con globs) como fallback fuerte: cuando abres un archivo del dominio, la rule entra sí o sí.

Este combo da lo más cercano a "selección por tarea" que Cursor permite. El gap respecto a Claude Code/OpenCode queda explícito en docs.

### Caching del scan/graph en runtime

Para que `selectAgentContext` sea rápido (sub-segundo), el MCP server cachea `scan.json` y `graph.json` parseados en memoria al primer llamado de la sesión. Invalidación: por mtime del archivo. Si el dev corre `forge graph`, la próxima llamada al MCP detecta mtime cambiado y recarga.

Si los artefactos no existen, `selectAgentContext` devuelve un manifiesto degradado con `domainsTouched: []` y `notes: ["scan/graph missing — run forge scan && forge graph"]`. Nunca crashea.

### Convención de frontmatter (retrocompatible)

Skills/rules existentes funcionan sin cambio: caen en `matchType: "explicit"` (por slug `ctx-<domain>`) o en `alwaysApply`. Para mapeo más fino, el dev puede agregar:

```yaml
---
name: my-skill
description: ...
domains: [packages/core, packages/cli]
---
```

`buildDomainSkills` ya emite `tags: [<domain>, domain-skill]` — extenderemos para emitir también `domains: [<domain>]` y dejar `tags` para descubrimiento humano.

### Coexistencia

| Artefacto                               | Origen           | Cuándo se regenera                      |
| --------------------------------------- | ---------------- | --------------------------------------- |
| `.claude/skills/ctx-*.md`               | `forge skills`   | Cambio en grafo (manual)                |
| `.cursor/rules/contextforge.mdc`        | curado manual    | Nunca (commit)                          |
| `.contextforge/agent-manifest.json`     | `forge manifest` | Cada `forge context` + `forge manifest` |
| `.claude/agent-manifest.md`             | renderer claude  | Idem                                    |
| `.cursor/rules/contextforge-active.mdc` | renderer cursor  | Idem                                    |
| MCP tool `getAgentManifest`             | servidor MCP     | Lee live el JSON                        |

Los archivos `*-active.*` y `agent-manifest.*` van al `.gitignore` (son derivados, como `.contextforge/`).

## Risks

| Riesgo                                                                              | Mitigación                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Frontmatter `domains:` no estándar entre agentes                                    | Convención propia de ContextForge; fallback a slug `ctx-<domain>` para auto-generadas       |
| Sobrescribir un `.cursor/rules/contextforge-active.mdc` editado a mano              | Naming `*-active.*` es reservado para output del manifiesto; documentado en README          |
| Renderer Cursor emite globs incorrectos cuando la tarea cruza múltiples paquetes    | Limitar a glob por dominio + rutas exactas; tests de varios casos cross-domain              |
| OpenCode requiere que el MCP server esté corriendo para consumir `getAgentManifest` | El JSON neutral en `.contextforge/` también es leíble directo del FS, redundancia adrede    |
| Frontmatter parseado mal puede romper `forge manifest`                              | Tolerancia: si no parsea, skill/rule cae en `skipped` con razón `"frontmatter parse error"` |
| Manifiesto desactualizado vs context-pack                                           | El comando valida `context-pack.json` mtime ≥ `agent-manifest.json` y avisa si hay desfase  |
| Hook `UserPromptSubmit` añade latencia al primer prompt                             | Cache en memoria del MCP server (scan/graph parseados); target P50 < 200 ms                 |
| `selectAgentContext` MCP llamada con `task` muy corta o vacía                       | Validar `minLength: 1` en schema; si todo es ruido, devolver manifiesto degradado con notes |
| Dev mete prompt sensible al hook (env leak)                                         | El hook NO loguea el prompt; solo lo pasa al core en memoria. Documentar en README          |
| Cursor cambia su modelo de rules en futuras versiones                               | Capa de renderers aislada; basta tocar `renderers/cursor.ts` sin tocar el core              |

## Tests

`packages/core/__tests__/agentManifest.unit.test.ts` con ≥ 10 tests. Coverage del módulo ≥ 90%, global ≥ 80%.

Casos cubiertos:

- Empty pack → manifiesto con listas vacías y `domainsTouched: []`.
- Una sola skill `alwaysApply: true` → incluida con `matchType: "alwaysApply"`.
- Skill con `domains: [packages/core]` y pack que toca `packages/core` → incluida con `matchType: "domain"`.
- Skill `ctx-packages-core` sin frontmatter `domains` y pack que toca `packages/core` → `matchType: "explicit"`.
- Skill cuyo dominio no es tocado → en `skipped.skills` con razón clara.
- Rule con `domains` y pack cross-domain → `suggestedGlobs` cubre todos los dominios.
- Determinismo: dos runs con mismo input → manifiesto byte-identical.
- Schema validation: manifiesto producido cumple `agent-manifest.schema.json`.
- Renderer Claude → markdown contiene secciones `# Tarea`, `## Skills sugeridas`, `## Skills omitidas`.
- Renderer Cursor → frontmatter contiene `globs:` derivados, `alwaysApply: false`.
- Renderer OpenCode → JSON neutral idéntico al `.contextforge/agent-manifest.json` escrito en disco.

Tests adicionales en `packages/mcp/__tests__/`:

- `getAgentManifest.unit.test.ts` — archivo presente, ausente, corrupto.
- `selectAgentContext.unit.test.ts` — task válida + scan/graph presentes, task válida + artefactos ausentes (manifiesto degradado), task vacía (rechazo del schema), cache hit en segunda invocación dentro de la misma sesión.
- `cliWrapper.unit.test.ts` — wrapper imprime markdown a stdout cuando se invoca con `--task=`, exit 0 incluso con artefactos ausentes.
