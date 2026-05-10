---
title: "Índice de documentación — contextforge-cli"
description: "Punto de entrada Diátaxis. Encuentra docs por intención: aprender, hacer, consultar, entender, decidir, diagramar."
audience: both
type: reference
tags: [index, diataxis, navigation]
updated: 2026-05-07
---

# Documentación — contextforge-cli

> Esta documentación sigue el [framework Diátaxis](https://diataxis.fr/): cuatro
> tipos de doc según la intención del lector. Si buscas el **punto de entrada
> agentico** (LLMs), abre [`AGENTS.md`](../AGENTS.md) en la raíz.

## 🧭 Cómo navegar

| Tu intención                         | Carpeta                            | Ejemplo                       |
| ------------------------------------ | ---------------------------------- | ----------------------------- |
| **Aprender** desde cero, paso a paso | [`tutorials/`](./tutorials/)       | "Setup del proyecto en local" |
| **Resolver una tarea concreta**      | [`how-to/`](./how-to/)             | "Cómo desplegar a prod"       |
| **Consultar** datos exactos          | [`reference/`](./reference/)       | OpenAPI spec, env vars        |
| **Entender** el por qué              | [`explanation/`](./explanation/)   | "Por qué hexagonal aquí"      |
| **Ver decisiones** arquitectónicas   | [`adr/`](./adr/)                   | ADRs en formato MADR          |
| **Diagramas** del sistema            | [`architecture/`](./architecture/) | C4, codemaps                  |

## 📖 Tutorials (aprender)

Guías paso a paso pensadas para alguien que parte de cero.

_Crea archivos en `tutorials/` siguiendo la convención de frontmatter._

## 🛠️ How-to (resolver una tarea)

Recetas enfocadas en una sola tarea, asumiendo conocimiento básico del repo.

- [`use-contextforge.md`](./how-to/use-contextforge.md) — Pipeline completo: instalar, escanear, generar context-pack y conectar agentes.
- [`agent-manifest-y-skills.md`](./how-to/agent-manifest-y-skills.md) — Cómo el manifest activa skills/rules selectivamente por tarea en Claude Code, Cursor y OpenCode.
- [`use-semantic-graph.md`](./how-to/use-semantic-graph.md) — Activar `--with-semantic` (y opcionalmente `--concepts`), qué nodos aparecen, y cómo `forge context` / `forge spec` / MCP los consumen.

## 📚 Reference (consultar)

Información factual de consulta rápida.

_Crea archivos en `reference/`._

## 💡 Explanation (entender)

Documentos discursivos que explican el _por qué_ del diseño.

- [`contextforge-and-openspec.md`](./explanation/contextforge-and-openspec.md) — Tres roles separados (ContextForge, OpenSpec, agente) y cuánto ahorras combinándolos.
- [`contextforge-vs-understand-anything.md`](./explanation/contextforge-vs-understand-anything.md) — Review senior comparativa: por qué son complementarios y no sustitutos.

## 🧱 ADR (decisiones)

Architecture Decision Records en formato MADR. Ver [`adr/README.md`](./adr/README.md)
para la plantilla y proceso.

_Crea ADRs numerados (`0001-titulo.md`, `0002-titulo.md`)._

## 🗺️ Architecture (diagramas y mapas)

- [`module-relationships.md`](./architecture/module-relationships.md) — Grafo de dependencias entre módulos (generado por `forge docs`).
- [`semantic-graph-layer.md`](./architecture/semantic-graph-layer.md) — Diseño Pass 5 determinista que enriquece graph.json con capa semántica (domain/layer/endpoint/flow/step/concept).

## ✍️ Convenciones de docs

Toda doc nueva o migrada debe tener:

1. **Frontmatter YAML** con `title`, `description`, `audience`, `type`, `tags`, `updated`.
2. **Resumen de 3 líneas máx.** después del frontmatter, antes de cualquier h2.
   Permite a un agente decidir si lee el resto sin gastar tokens.
3. **Idioma:** español para docs nuevos. Los docs migrados pueden quedar en su idioma original.
4. **Encabezados:** un solo h1 (el título). Subsecciones con h2/h3.
5. **Enlaces relativos** entre docs (`./how-to/deploy.md`), nunca absolutos.

Para nuevos ADRs, usa la plantilla MADR en [`adr/README.md`](./adr/README.md).
