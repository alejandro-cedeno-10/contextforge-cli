---
title: Capa semántica del grafo — diseño
description: Pass 5 determinista que enriquece graph.json con nodos de intención (domain/layer/endpoint/flow/step/concept). Cero LLM. Subset y MCP heredan sin cambios. Habilita razonamiento de dominio en agentes que consumen OpenSpec.
audience: dev
type: architecture
tags: [graph, semantic, design, openspec, plan]
updated: 2026-05-09
status: proposal
---

# Capa semántica del grafo — diseño

## 1. Resumen ejecutivo

Hoy `graph.json` tiene 4 tipos de nodos (`file/symbol/folder/package`) y 8 aristas (`imports/calls/defines/...`). Es **estructural**: te dice qué archivo importa qué.

Esta propuesta agrega una **capa semántica determinista** (sin LLM) con **6 tipos de nodos nuevos** (`domain/layer/endpoint/flow/step/concept`) y **6 aristas nuevas** (`belongs_to_domain/in_layer/exposes_endpoint/implements_flow/flow_step/cross_domain`). Se integra como un **Pass 5 opt-in** en el builder existente — no rompe el grafo técnico, lo etiqueta encima.

**Resultado para el agente que consume `graph.subset.json` vía OpenSpec**: en lugar de inferir intención leyendo paths y código, lee directo `"domain": "auth"`, `"layer": "controller"`, `"flow": "login-with-password"`. Ahorra tokens de razonamiento y reduce errores de categorización.

**Compatibilidad**: el flag `--with-semantic` (default off en el sprint inicial, default on cuando madure) preserva byte-stability del grafo técnico para quien no lo active.

## 2. Modelo de datos

### 2.1 Nodos nuevos

| Tipo       | ID pattern                 | Propiedades extra                                                                      | Detectado por           |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| `domain`   | `domain:<slug>`            | `files: number`, `kinds: Record<string,number>`                                        | Heurística #3           |
| `layer`    | `layer:<name>`             | `name`, `kind: "backend"\|"frontend"\|"shared"`                                        | Heurística #2           |
| `endpoint` | `endpoint:<METHOD>:<path>` | `method`, `path`, `framework: "nest"\|"express"\|"fastapi"\|"next-route"\|"next-page"` | Heurística #1           |
| `flow`     | `flow:<domain>/<slug>`     | `domain`, `entryFile`, `stepCount`                                                     | Heurística #4           |
| `step`     | `step:<flow_id>#<order>`   | `order: number`, `file`, `layer`                                                       | Heurística #4           |
| `concept`  | `concept:<domain>/<slug>`  | `domain`, `headSymbol`, `modularity: number`                                           | Heurística #5 (Louvain) |

### 2.2 Aristas nuevas

| Tipo                | From → To           | Semántica                                        | Peso default |
| ------------------- | ------------------- | ------------------------------------------------ | ------------ |
| `belongs_to_domain` | `file` → `domain`   | El archivo pertenece a este dominio              | 1.0          |
| `in_layer`          | `file` → `layer`    | El archivo cumple este rol arquitectónico        | 0.7          |
| `exposes_endpoint`  | `file` → `endpoint` | El archivo declara este endpoint HTTP/CLI        | 1.2          |
| `implements_flow`   | `file` → `flow`     | El archivo participa en este caso de uso         | 1.0          |
| `flow_step`         | `flow` → `step`     | El flow tiene este paso ordenado                 | 1.0          |
| `cross_domain`      | `domain` → `domain` | Hay imports entre dominios (con count en weight) | variable     |

### 2.3 Ejemplo concreto (este repo)

```json
{
  "id": "domain:graph-pipeline",
  "type": "domain",
  "label": "graph-pipeline",
  "files": 7,
  "kinds": { "code": 6, "test": 1 }
}
{
  "id": "layer:builder",
  "type": "layer",
  "label": "builder",
  "kind": "shared"
}
{
  "id": "endpoint:CLI:forge-graph",
  "type": "endpoint",
  "label": "forge graph",
  "method": "CLI",
  "path": "forge graph",
  "framework": "commander"
}
{
  "id": "flow:graph-pipeline/build-from-scan",
  "type": "flow",
  "label": "build graph from scan",
  "domain": "graph-pipeline",
  "entryFile": "packages/cli/src/commands/graph.ts",
  "stepCount": 4
}
```

Aristas que conectan lo anterior con el grafo técnico ya existente:

```json
{ "from": "file:packages/core/src/graph/builder.ts", "to": "domain:graph-pipeline", "type": "belongs_to_domain" }
{ "from": "file:packages/core/src/graph/builder.ts", "to": "layer:builder", "type": "in_layer" }
{ "from": "file:packages/cli/src/commands/graph.ts", "to": "endpoint:CLI:forge-graph", "type": "exposes_endpoint" }
{ "from": "file:packages/cli/src/commands/graph.ts", "to": "flow:graph-pipeline/build-from-scan", "type": "implements_flow" }
{ "from": "flow:graph-pipeline/build-from-scan", "to": "step:flow:graph-pipeline/build-from-scan#1", "type": "flow_step" }
```

## 3. Heurísticas de detección (deterministas)

Basadas en investigación de Code Property Graphs (Joern), Stack Graphs, dependency-cruiser, Nx tags. Ordenadas por ratio impacto/esfuerzo.

### 3.1 H1 — Endpoint por convención

**Detecta**: `endpoint`

**Reglas por framework**:

| Framework               | Detección                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NestJS**              | ts-morph: clases con `@Controller('prefix')` + métodos con `@Get/@Post/@Put/@Delete/@Patch('subpath')`. Endpoint = `<METHOD>:<prefix><subpath>`. |
| **Express**             | Regex `(app\|router)\.(get\|post\|put\|delete\|patch)\(['"]([^'"]+)`.                                                                            |
| **FastAPI**             | Regex `@(app\|router)\.(get\|post\|put\|delete\|patch)\(['"]([^'"]+)`.                                                                           |
| **Next.js App Router**  | Glob `app/**/route.{ts,js}` + AST detect `export const GET\|POST\|...`. Path = ruta filesystem normalizada.                                      |
| **Next.js Pages**       | Glob `app/**/page.{tsx,jsx}` + `pages/**/*.{tsx,jsx}`.                                                                                           |
| **CLI commander/yargs** | Regex `\.command\(['"]([^'"]+)` en archivos `commands/**/*.ts`.                                                                                  |

**Falsos positivos esperados**: decoradores comentados, helpers que retornan handlers, rutas con templates dinámicos. Mitigación: verificar que la línea no esté dentro de un bloque de comentario; ignorar rutas con interpolación de variables.

### 3.2 H2 — Layer por sufijo/path

**Detecta**: `layer`

**Backend**: regex sobre basename → `\.(controller|service|repository|repo|model|dto|guard|pipe|middleware|module|use[-_]?case)\.(ts|js|py)$`. También segmento de carpeta: `controllers/|services/|repositories/|use-cases/`.

**Frontend**: `\.(component|hook|store|page|route|layout|context|reducer|action)\.(tsx?|jsx?)$` + carpetas `components/|hooks/|stores/|pages/|routes/`.

**Shared**: `\.(util|helper|schema|types?|constants)\.(ts|js|py)$`.

**Falsos positivos**: archivos `index.ts` que reexportan capas mixtas (skip), `service-worker.ts` (excluir explícitamente), `*.test.ts` (ya es kind=test, skip).

### 3.3 H3 — Domain por convención de proyecto

**Detecta**: `domain`

**Orden de prioridad** (primer match gana):

1. **Nx tags** (si existe `nx.json` o `project.json`): leer `tags: ["scope:payments"]` → domain = `payments`.
2. **Monorepo packages** (pnpm/turbo): cada paquete bajo `packages/<name>` con `package.json` → domain = `<name>`.
3. **NestJS feature modules**: cualquier carpeta que contenga un `*.module.ts` → domain = nombre de carpeta.
4. **Django/FastAPI apps**: carpetas bajo `apps/<name>/` o `src/<name>/` con `models.py` o `router.py` → domain = `<name>`.
5. **Next.js feature folders**: `app/(group)/` o `src/features/<name>/` → domain = `<name>` o `group`.
6. **Fallback**: primera carpeta significativa después de `src/`.

**Allowlist de exclusión** (no son dominios, son shared): `shared`, `core`, `common`, `lib`, `utils`, `helpers`, `internal`. Estos archivos quedan sin `belongs_to_domain` (o con `domain:shared`).

### 3.4 H4 — Flow por cadena transitiva

**Detecta**: `flow` + `step`s

**Algoritmo**:

1. Por cada `endpoint` (de H1), tomar el archivo que lo expone como **paso 1**.
2. Sobre el subgrafo `imports` filtrado por `domain == X`, hacer BFS de longitud 2-4.
3. Si la cadena cruza ≥2 layers distintas (ej: `controller → service → repository` en backend, o `page → hook → store` en frontend), es un flow válido.
4. Cada nodo de la cadena = `step` con `order` ascendente.
5. Nombrar el flow por el endpoint + verbo dominante: `login-with-password`, `create-invoice`, `fetch-user-list`.

**Frontend variant**: en lugar de `controller→service→repo`, buscar `page→hook→store/api-client`.

**Falsos positivos**: utilities reusados que generan flows fantasma. **Mitigación**: exigir que el step 1 sea un endpoint extraído por H1 (no cualquier file). Limitar profundidad a 4 hops.

### 3.5 H5 — Concept por community detection

**Detecta**: `concept` (sub-dominios densos)

**Algoritmo**: dentro de cada `domain` con ≥8 archivos, ejecutar `graphology-communities-louvain` sobre el subgrafo `imports`. Conservar comunidades con ≥3 nodos y modularidad ≥0.3. Nombrar el concept por el símbolo más referenciado del cluster.

**Cuándo activarlo**: opt-in adicional `--with-semantic --concepts` por costo computacional. Para repos pequeños (<2k archivos) Louvain es suficiente; Leiden queda como mejora futura si se ven comunidades partidas.

**Falsos positivos**: clusters artificiales en dominios pequeños (skip si <8 nodos), nombres pobres si no hay head node claro.

## 4. Integración con tools existentes

| Tool                                         | Cómo aprovecha la capa semántica                                                                                                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`forge graph --with-semantic`**            | Activa Pass 5 nuevo. Sin el flag, output idéntico al actual (byte-stable).                                                                                                                                                               |
| **`forge context "<task>"`**                 | El selector usa keywords del task para hacer match con `domain.label` o `endpoint.path`. Si hay match, los archivos `belongs_to_domain` reciben boost (multiplicador 1.5×) en la combinación PageRank+BFS.                               |
| **`forge spec <id>`**                        | El `spec-input.json` agrega `affectedDomains[]`, `affectedEndpoints[]`, `affectedFlows[]`. El render del prompt incluye una sección "Architectural context" con esos elementos para que OpenSpec genere `Scenario:` mejor estructurados. |
| **`forge_neighbors(file)`** (MCP)            | Agrega secciones nuevas: `same_domain`, `same_layer`, `flows_participating`.                                                                                                                                                             |
| **`forge_domain_map()`** (MCP)               | Reemplaza `getDomain()` trivial por consulta a nodos `domain` reales. Output mucho más informativo.                                                                                                                                      |
| **`graph.subset.json`** (OpenSpec change)    | El BFS ya es symmetric — si un file focus tiene arista `belongs_to_domain → domain:X`, el nodo `domain:X` entra al subset. Cero código nuevo en `subset.ts`.                                                                             |
| **MCP nuevo: `forge_semantic_map(domain?)`** | Expone domain → endpoints → flows como JSON consultable por agentes (alternativa estructurada al markdown de `forge_domain_map`).                                                                                                        |
| **MCP nuevo: `forge_flow(flow_id)`**         | Devuelve los steps ordenados de un flow + archivos por step. Útil para "explícame el flujo de login".                                                                                                                                    |

## 5. Cambios al schema (backwards-compat)

`docs/schemas/graph.schema.json`:

1. **`$defs.node.id.pattern`**: extender de `^(file|symbol|folder|package):.+` a `^(file|symbol|folder|package|domain|layer|endpoint|flow|step|concept):.+`.
2. **`$defs.node.type.enum`**: agregar los 6 nuevos.
3. **`$defs.node.properties`**: agregar `method`, `path`, `framework`, `domain`, `entryFile`, `stepCount`, `order`, `headSymbol`, `modularity`, `kinds`, `files`. Todas opcionales.
4. **`$defs.edge.type.enum`**: agregar las 6 aristas nuevas.
5. **`graph.semanticEnabled: boolean`** en root (default false). Permite a consumidores saber si el grafo tiene la capa.

**Schema graph-subset.schema.json**: hereda automáticamente porque referencia `node`/`edge` definitions desde el schema base.

**Migración**: existing graph.json (sin capa semántica) sigue validando sin cambios. `graph.semanticEnabled` ausente o false = no garantías sobre nodos semánticos.

## 6. Plan de implementación por fases

### Fase 1 — Schema + tipos (PR pequeño)

- Extender `graph.schema.json` y `graph-subset.schema.json` con backwards-compat.
- Extender tipos TS en `packages/core/src/graph/builder.ts` (`GraphNode`, `EdgeType`).
- Bumpear `SCHEMA_VERSIONS.graph` minor (0.X.0 → 0.(X+1).0).
- Tests: validar que `graph.json` actual sigue pasando schema; que un fixture con nodos semánticos también valida.

### Fase 2 — Detector backend (sin frontend aún)

- Crear `packages/core/src/graph/semantic/` con módulos:
  - `domain-detector.ts` (H3, prioridad 1-4)
  - `layer-detector.ts` (H2, sufijos backend)
  - `endpoint-detector.ts` (H1, NestJS + Express + FastAPI + commander)
  - `flow-detector.ts` (H4)
  - `pass5.ts` (orquesta los anteriores)
- Modificar `builder.ts` para llamar Pass 5 si `withSemantic === true`.
- Comando: `forge graph --with-semantic`.
- Tests: fixtures de mini-repos NestJS/Express/FastAPI.

### Fase 3 — Detector frontend

- Extender detectores de Fase 2:
  - `endpoint-detector.ts`: añadir Next.js route/page.
  - `layer-detector.ts`: añadir hook/store/component/page.
  - `flow-detector.ts`: añadir variant `page→hook→store`.
  - `domain-detector.ts`: añadir Next.js feature folders.
- Tests: fixtures Next.js App Router.

### Fase 4 — Integración con `forge context` y `forge spec`

- `selector/index.ts`: detectar match task ↔ domain/endpoint, aplicar boost.
- `spec/specInput.ts` y `promptRenderer.ts`: añadir secciones de contexto arquitectónico.
- Tests: verificar que un task con keyword "login" prioriza `domain:auth`.

### Fase 5 — MCP tools nuevos

- `forge_semantic_map(domain?)` en `mcp/handlers.ts`.
- `forge_flow(flow_id)` idem.
- Mejorar `forge_domain_map` y `forge_neighbors` para usar la capa.
- Tests: handlers unitarios + integration.

### Fase 6 — Concepts (Louvain) — opcional

- Solo si Fases 1-5 entregan valor claro. Añadir `--concepts` flag.
- Dependencia nueva: `graphology-communities-louvain`.
- Tests: comunidades en repo de prueba con clusters conocidos.

### Fase 7 — Documentación + change OpenSpec

- Doc en `docs/how-to/use-semantic-graph.md`.
- Crear change OpenSpec real (`forge spec semantic-graph-layer`) para validar que el handoff funciona.

## 7. Tests y cobertura

El repo exige ≥80% global y ≥95% en `manifest/` y `spec/`. La capa semántica requiere:

- **Unitarios** por detector (H1-H5), con fixtures mínimos por framework.
- **Integration**: `buildGraph({ withSemantic: true })` sobre repo fixture multi-framework.
- **Snapshot**: `graph.json` enriquecido byte-stable run-to-run (mismo output entre corridas).
- **Schema**: validar fixtures contra `graph.schema.json`.
- **MCP**: handler tests que devuelven JSON correcto.

Objetivo: ≥85% en `packages/core/src/graph/semantic/`, ≥90% en handlers MCP nuevos.

## 8. Riesgos y trade-offs

| Riesgo                                                     | Mitigación                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Heurísticas frágiles si el repo no sigue convenciones      | Default off (`--with-semantic` opt-in al inicio); allowlists por framework configurables vía `.contextforge/semantic.config.json`. |
| Falsos positivos saturan el grafo                          | Logs de debug por detector + comando `forge semantic --explain` que reporta qué detectó y por qué.                                 |
| Aumento de tamaño de `graph.json`                          | Capa semántica añade ~5-15% nodos/aristas (estimado). Aceptable; sigue lejos del peso de symbols.                                  |
| Concept detection (Louvain) es no-determinista por defecto | Fijar seed en la implementación; tests verifican byte-stability.                                                                   |
| Detección frontend más débil que backend                   | Aceptado en Fase 3; se mejora en iteraciones posteriores. Documentar limitaciones.                                                 |

## 9. Lo que NO hace esta propuesta

- No genera prosa ni explicaciones (eso lo hace el agente con el contexto).
- No reemplaza `forge_domain_map` actual (lo mejora consumiendo nodos `domain` reales).
- No requiere LLM en ningún detector. `--enrich` (LLM existente) sigue funcionando aparte para summary/tags/complexity.
- No detecta dominios "de negocio puro" (ej: "esta función calcula el ROI"). Para eso haría falta LLM o anotaciones manuales — fuera de scope.
- No es un dashboard visual estilo Understand-Anything. `forge viz` puede colorear por domain/layer en una iteración futura, pero no es parte de esta propuesta.

## 10. Decisión pendiente

Una decisión queda en manos del usuario antes de codear:

**¿`--with-semantic` activado por default desde la primera versión, o opt-in hasta que madure?**

- **Opt-in (recomendado por seguridad)**: cero riesgo de romper consumidores actuales. Devs lo activan cuando quieren probarlo. Default on en una versión 0.4.0+ una vez validado.
- **Default on**: máximo valor inmediato, pero requiere cobertura de tests muy amplia para evitar regresiones en cualquier proyecto.

Recomendación: **opt-in en Fase 1-5, default on al cerrar Fase 7**.
