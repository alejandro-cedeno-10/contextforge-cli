---
name: contextforge-docs
description: Scaffold de documentación Diátaxis (tutorials/how-to/reference/explanation/adr/architecture)
tags: [diataxis, docs]
---

# ContextForge — Docs Diátaxis

`forge docs` genera estructura Diátaxis lista para usar:

```bash
pnpm forge docs            # Crea folders + INDEX.md (no sobrescribe)
pnpm forge docs --force    # Sobrescribe archivos existentes
```

## Estructura generada

```
docs/
  INDEX.md                          # Punto de entrada con tabla de navegación
  tutorials/                        # Aprender paso a paso
  how-to/                           # Recetas para tareas concretas
  reference/                        # Datos exactos (OpenAPI, env vars)
  explanation/                      # Por qué del diseño
  adr/README.md                     # Plantilla MADR para decisiones
  architecture/module-relationships.md  # Grafo de dependencias (auto desde .contextforge/graph.json)
```

## Convenciones

Cada doc nuevo debe tener frontmatter YAML:

```yaml
---
title: "Título"
description: "Una línea — el agente decide si leer el resto"
audience: both | dev | ops
type: tutorial | how-to | reference | explanation | architecture
tags: [tag1, tag2]
updated: YYYY-MM-DD
---
```

Resumen de 3 líneas máx. después del frontmatter — permite skip sin gastar tokens.

## Sin LLM

Plantillas deterministas. `architecture/module-relationships.md` se deriva de `.contextforge/graph.json` (sin LLM).
