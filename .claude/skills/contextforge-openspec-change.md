---
name: contextforge-openspec-change
description: Cómo trabajar un OpenSpec change con el subgrafo congelado de ContextForge — para ahorrar tokens
tags: [openspec, change, subgraph, mcp, token-savings]
---

# ContextForge ⊕ OpenSpec change — flow corto

> Skill task-oriented. Léeme **una vez** al iniciar trabajo en un change. No vuelvas a explorar el repo a ciegas.

## Cuándo aplica

Trabajas (review o implementación) en `openspec/changes/<id>/`. Hay un `graph.subset.json` allí.

## Regla de oro

```
graph.subset.json   →   .contextforge/graph.json   →   leer el repo
   (cheap)              (medium)                       (expensive, último recurso)
```

**Empieza siempre por el subgrafo del change.** Solo escala si el subgrafo no responde tu pregunta concreta.

## Lectura del directorio del change (orden)

1. `./context.md` — mapa rápido (este orden + paths globales).
2. `./proposal.md` — qué se propone, por qué.
3. `./design.md` — sección **"Context graph (subset)"** te dice qué tan grande es el subgrafo y en qué modo.
4. `./graph.subset.json` — datos del subgrafo (focus files, exported symbols, packages, deps).
5. `./graph.subset.html` — solo si quieres revisión visual (Cytoscape standalone).
6. `./tasks.md` — checklist de implementación.
7. `./specs/<domain>/spec.md` — Requirement+Scenario formal.

## Vía MCP (preferido — un solo call)

```jsonc
// 1. Estado: ¿hay change activo con subgrafo?
{ "tool": "forge_status" }
// Lista los changes con graph.subset.json + comando MCP listo para copiar.

// 2. Leer el subgrafo congelado del change:
{ "tool": "forge_change_subgraph", "arguments": { "change_id": "<id>" } }
// Trae TODO lo del scope del change (focus files, exported symbols, packages, deps).
// Esto reemplaza forge_context cuando hay change activo.

// 3. Solo si el subgrafo no responde — escalar a vecinos puntuales:
{ "tool": "forge_neighbors", "arguments": { "file_path": "<path-en-focus>" } }
// O al grafo global:
{ "tool": "forge_context", "arguments": { "task": "<refinamiento concreto>" } }
```

## Subgrafo: dos modos

| Modo | Default | Qué incluye | Cuándo |
| ---- | :-----: | ----------- | ------ |
| `compact` | ✅ | Focus files + sus **símbolos exportados** + 1-hop file neighbours (sin sus símbolos) + folders + packages | Caso normal · ahorro real de tokens |
| `full`    |    | Todo lo anterior + **cada símbolo** (incl. internos) de cada archivo alcanzable | Solo si el agente lo pide explícitamente vía `--subgraph-full` |

Si necesitas ver internos de un archivo del subgrafo, usa `forge_neighbors` sobre ese archivo en vez de regenerar `--subgraph-full`.

## Implementación: política

- **Modificas solo archivos en `focus`** (= context-pack al momento del spec). Sale fuera → `forge implement --check` te lo bloquea.
- Si necesitas tocar algo fuera, escala el spec, no el commit.
- Para validar antes de commit:
  ```bash
  pnpm forge implement --check
  ```

## Anti-patrón

🚫 Cargar el repo entero al prompt.
🚫 Leer `.contextforge/graph.json` global cuando ya hay `graph.subset.json` del change.
🚫 Llamar `forge_context` repetidamente cuando ya tienes el subgrafo congelado.
🚫 Asumir que el subgrafo cambió: es **byte-estable** entre runs del mismo `forge spec`.

## Si no existe `graph.subset.json`

Significa que el change se creó antes de v0.3.7 o sin `forge spec`. Re-corre:

```bash
pnpm forge context "<la tarea del change>"
pnpm forge spec <id>     # (re)genera proposal/design/tasks/specs + subgrafo
```
