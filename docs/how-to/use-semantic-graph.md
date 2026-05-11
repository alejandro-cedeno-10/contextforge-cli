---
title: Cómo activar y consumir la capa semántica del grafo
description: Cuándo activar `--with-semantic` (y opcionalmente `--concepts`), qué nuevos nodos y aristas aparecen en `graph.json`, y cómo lo aprovechan `forge context`, `forge spec` y los tools MCP.
audience: dev
type: how-to
tags: [semantic, graph, openspec, mcp]
updated: 2026-05-09
---

# Cómo activar y consumir la capa semántica del grafo

Por defecto `forge graph` solo emite nodos `file/symbol/folder/package` y aristas `imports/calls/defines/...`. Es **estructural**: te dice qué archivo importa qué.

La **capa semántica** (Pass 5, opt-in desde v0.4) etiqueta encima de eso con nodos `domain/layer/endpoint/flow/step` (y opcionalmente `concept`) más sus aristas. Habilita razonamiento sobre **intención**, no solo dependencias.

Esta guía cubre los 5 minutos para activarla y los lugares donde el agente IA empieza a verla automáticamente.

## 1. Activar la capa

```bash
pnpm forge graph --force --with-semantic
```

Salida esperada:

```
Escrito .contextforge/graph.json (cache: 0 reutilizados, 119 reparseados)
[graph] semantic layer: 6 domains, 0 layers, 0 endpoints, 0 flows
```

Tu `graph.json` ahora trae el campo `semanticEnabled: true` y nodos/aristas adicionales.

> **Backwards-compat:** sin el flag, `forge graph` produce un grafo byte-idéntico al de v0.3.x. Toda la capa nueva es opt-in.

### Concepts (opcional, requiere Louvain)

```bash
pnpm forge graph --force --with-semantic --concepts
```

Solo añade `concept` nodes en dominios con ≥8 archivos y clusters de ≥3 con modularidad ≥0.3. En repos pequeños no aparecen — eso es esperado. La detección está seedeada (mulberry32) → output byte-stable run-to-run.

## 2. Qué hay dentro

### Nuevos nodos

| Tipo       | ID                         | Detectado por                                                                                                             |
| ---------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `domain`   | `domain:<slug>`            | packages/, NestJS modules, Django/FastAPI apps, `features/<n>/`, Next.js segments                                         |
| `layer`    | `layer:<name>`             | sufijos (`*.controller.ts`, `*.service.ts`, ...) o segmentos de carpeta (`controllers/`, `services/`, `pages/`, `hooks/`) |
| `endpoint` | `endpoint:<METHOD>:<path>` | NestJS, Express, FastAPI, Next.js App/Pages Router, Astro, commander/yargs                                                |
| `flow`     | `flow:<domain>/<slug>`     | Cadena más larga endpoint → varias capas en el mismo dominio (`controller→service→repository`)                            |
| `step`     | `step:<flow_id>#<order>`   | Cada paso de un flow                                                                                                      |
| `concept`  | `concept:<domain>/<slug>`  | Solo con `--concepts`: comunidades Louvain dentro de un dominio                                                           |

### Nuevas aristas

`belongs_to_domain`, `in_layer`, `exposes_endpoint`, `implements_flow`, `flow_step`, `cross_domain` (con `weight` = nº de imports entre los dos dominios).

### Inspección rápida

```bash
node -e "const g=require('./.contextforge/graph.json'); \
  console.log(g.nodes.filter(n=>n.type==='domain'));"
```

## 3. Quién consume la capa automáticamente

**No tienes que pasarle nada** a los comandos siguientes — detectan `semanticEnabled: true` y la usan.

### `forge context "<task>"`

Si un keyword del task hace match con un domain (literal, prefix o substring), los archivos de ese domain reciben score × 1.5. Ejemplo:

```bash
pnpm forge context "fix billing invoice rounding bug"
# → [context] semantic boost applied to: domain:billing
```

### `forge spec <id>`

El `spec-input.json` adquiere un campo `architecture` con domains/endpoints/flows afectados, y el `spec-prompt.md` renderiza una sección **"Contexto arquitectónico (capa semántica)"**:

```markdown
**Dominios**: `users`

**Endpoints expuestos:**

- `GET /users` [nest] — `src/users/users.controller.ts`

**Flujos detectados:**

- `flow:users/get-users` (users, 2 steps) — GET /users
```

Esto le da a OpenSpec material concreto para escribir mejores `Scenario:` (no más "the controller does X" — ahora "the GET /users endpoint does X").

## 4. MCP tools nuevos

Todos siguen funcionando aunque no tengas la capa — devuelven hints útiles cuando falta.

### `forge_semantic_map(domain?)`

JSON estructurado con domains → files + endpoints + flows.

```json
{
  "domains": [
    {
      "name": "auth",
      "files": ["src/auth/login.controller.ts", "..."],
      "endpoints": [
        {
          "method": "POST",
          "path": "/auth/login",
          "framework": "nest",
          "id": "endpoint:POST:/auth/login"
        }
      ],
      "flows": [
        {
          "id": "flow:auth/post-auth-login",
          "label": "POST /auth/login",
          "entryFile": "...",
          "stepCount": 2
        }
      ]
    }
  ]
}
```

Filtra a un dominio: `forge_semantic_map({ domain: "auth" })`.

### `forge_flow(flow_id)`

Steps ordenados de un flow. Acepta `flow:auth/login` o solo `auth/login`:

```json
{
  "id": "flow:auth/post-auth-login",
  "domain": "auth",
  "entryFile": "src/auth/login.controller.ts",
  "stepCount": 2,
  "steps": [
    {
      "order": 1,
      "file": "src/auth/login.controller.ts",
      "layer": "controller"
    },
    { "order": 2, "file": "src/auth/auth.service.ts", "layer": "service" }
  ]
}
```

### Tools mejorados

- **`forge_neighbors`** — ahora muestra `same_domain`, `same_layer`, `exposes_endpoint`, `flows_participating` cuando aplica.
- **`forge_domain_map`** — usa los nodos `domain` reales en vez del fallback `getDomain()` cuando la capa está activa. Marca el origen (`Pass-5 semantic layer`) en el output.

### Subset-first dentro del change

Desde v0.4.1, todo lo que `forge_spec` deja en `openspec/changes/<id>/` se deriva del **subgrafo congelado** del change (no del grafo global). El orden interno de `forge_spec` es:

1. construir el subset (`extractChangeSubgraph` desde los `affectedFiles`)
2. computar `spec-input.architecture` desde ESE subset
3. renderizar `spec-prompt.md` con un bloque "Scope congelado (subset)" que le dice al agente: **no llames `forge_neighbors` ni `forge_context`** — usan el grafo global y duplican lo inlined.
4. invocar `forge_change_manifest` automáticamente para escribir `openspec/changes/<id>/agent-manifest.json` filtrado por los dominios del subset.

Resultado: cuando el agente abre la carpeta del change, todo lo que necesita está ahí — subgrafo, manifest scoped, context.md como mapa. El grafo global queda como fallback ("solo si el subset demuestra ser insuficiente").

### `forge_change_manifest(change_id, task?)`

Devuelve y escribe el `agent-manifest.json` scoped al change. Filtra skills/rules globales por los dominios que `graph.subset.json:focus` realmente toca:

```jsonc
{ "tool": "forge_change_manifest", "arguments": { "change_id": "ship-login" } }
```

`forge_spec` lo dispara automáticamente. Llámalo manualmente cuando refresques el subset (p.ej. después de `forge_archive_change` que cambia el grafo padre).

### `forge_spec(change_id, skip_openspec_cli?)`

Crea un change OpenSpec desde el flujo agéntico — sin shell, sin `pnpm`. Toma el `.contextforge/context-pack.json` actual y escribe:

- `openspec/changes/<change_id>/{proposal.md, design.md, tasks.md, specs/.../spec.md}` (delega al `openspec` CLI si está en PATH; cae al fallback determinista del core si no)
- `openspec/changes/<change_id>/graph.subset.json` (subgrafo congelado del change, validado por schema)
- `openspec/changes/<change_id>/context.md` (mapa de lectura para el agente, idéntico al que produce `forge spec` en CLI)
- `.contextforge/spec-input.json` (con la sección `architecture` cuando la capa semántica está activa)
- `.contextforge/spec-prompt.md` (copy-paste para el agente)

Flujo agéntico canónico (cero `pnpm` en el loop):

```jsonc
// Si el código cambió desde el último graph.json:
{ "tool": "forge_rebuild_graph", "arguments": { "with_semantic": true } }

// Selección + scaffold:
{ "tool": "forge_context", "arguments": { "task": "ship login flow" } }
{ "tool": "forge_spec",    "arguments": { "change_id": "ship-login-flow" } }
{ "tool": "forge_implement", "arguments": { "change_id": "ship-login-flow" } }

// — el agente edita openspec/changes/ship-login-flow/* y src/* —

{ "tool": "forge_check",          "arguments": {} }
{ "tool": "forge_archive_change", "arguments": { "change_id": "ship-login-flow" } }
```

`pnpm forge init` sigue siendo el único bootstrap obligatorio (corre una sola vez al clonar el repo).

Errores comunes:

- _"Missing .contextforge/context-pack.json"_ → llama `forge_context` primero.
- _"Invalid change_id"_ → debe ser kebab-case (`^[a-z0-9][a-z0-9-]*$`).

## 5. Cuándo NO emitir la capa

- Repos donde la convención no aplica (sin `*.controller.ts`, sin `pages/`, sin `apps/<n>/`). El detector emitirá pocos o ningún `layer`/`endpoint`/`flow`. Eso es correcto — no inventa.
- CI / pipelines donde necesitas determinismo absoluto y aún no migraste consumidores. El default sigue siendo OFF.
- Cuando solo quieres rankear archivos por importancia (PageRank+BFS) y no te interesa la intención. El selector funciona igual sin la capa.

## 6. Limitaciones conocidas

- **Detección de endpoints es regex-based**, no AST. Casos extremos (decoradores en macros, rutas dinámicas con templates, helpers que retornan handlers) producen falsos positivos/negativos. Documentado, aceptable.
- **Frontend Vue/Svelte/Solid** no están cubiertos en Fase 3 — solo Next.js + Astro.
- **Concepts (Louvain)** son un experimento. Para repos chicos rara vez aportan; el costo computacional es bajo pero los nombres dependen del head node, que puede no ser representativo en todos los casos.
- **`getDomain()` fallback** sigue trivial cuando no hay convención clara. Carpetas raíz como `.claude/` o archivos de configuración top-level pueden aparecer como dominios espurios.

## 7. Rollback

```bash
pnpm forge graph --force         # sin --with-semantic
```

Reescribe `graph.json` sin la capa semántica. `semanticEnabled` desaparece del root. Todos los consumidores siguen funcionando — solo dejan de mostrar boosts/sections semánticas.
