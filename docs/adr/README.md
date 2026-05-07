---
title: "ADR — Plantilla y proceso"
description: "Cómo crear un Architecture Decision Record en este proyecto."
audience: both
type: reference
tags: [adr, madr, conventions]
updated: 2026-05-07
---

# Architecture Decision Records

Cada decisión arquitectónica se documenta como un ADR en formato [MADR](https://adr.github.io/madr/).

## Plantilla

```markdown
---
title: "<NÚMERO>. <Título conciso>"
status: proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
---

# <NÚMERO>. <Título>

## Context

¿Qué fuerza esta decisión? ¿Qué restricciones existen?

## Decision

¿Qué decidimos? Una frase clara.

## Consequences

Qué cambia (positivo y negativo) cuando se aplica esta decisión.
```

## Convención de nombres

`<NNNN>-<kebab-case-title>.md` — ej. `0001-idempotency-durable-execution.md`.
