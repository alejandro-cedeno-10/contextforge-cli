---
title: ContextForge + OpenSpec — cómo se complementan y cuánto ahorras
description: Tres roles separados, un mismo flujo. Por qué grafo + selección + delegación a OpenSpec produce specs más precisos y 91 % menos tokens por sesión SDD.
audience: dev
type: explanation
tags: [architecture, openspec, tokens, sdd]
updated: 2026-05-08
---

# ContextForge + OpenSpec — cómo se complementan y cuánto ahorras

## El problema que resolvemos juntos

Hacer **Spec-Driven Development** con un agente IA tiene tres puntos de fricción:

1. **El agente no sabe qué archivos importan**: cuando le pides "implementa la feature X", suele leer todo el repo o pedirte los archivos uno por uno. Caro y lento.
2. **El spec se desconecta del código**: si lo escribes a mano, queda inconsistente con la realidad. Si el agente lo escribe leyendo el repo, se inventa cross-references.
3. **No hay validación estructural del spec**: dos personas escriben specs distintos para el mismo cambio. Reviewers se vuelven el cuello de botella.

ContextForge y OpenSpec juntos atacan los tres puntos, pero **cada uno aporta algo distinto**. No son alternativos, son complementarios.

## Tres roles, una sola pipeline

```
       ┌─────────────────────┐    ┌─────────────────────┐    ┌────────────────┐
       │   ContextForge      │    │     OpenSpec        │    │   Agente IA    │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
ROL    │  Selección de       │    │  Estructura +       │    │  Redacción     │
       │  contexto           │    │  validación         │    │  del contenido │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
TÉC.   │  PageRank + BFS +   │    │  Schemas RFC 2119,  │    │  LLM           │
       │  budget tokens      │    │  Given/When/Then    │    │                │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
INPUT  │  scan.json +        │    │  spec-input.json    │    │  spec-prompt.md│
       │  graph.json + task  │    │                     │    │  + context-pack│
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
OUTPUT │  context-pack +     │    │  proposal/design/   │    │  .md llenos    │
       │  spec-input + prompt│    │  tasks/spec.md      │    │  + commits     │
       └─────────────────────┘    └─────────────────────┘    └────────────────┘
```

**ContextForge** se queda con su valor único: el grafo, el ranking PageRank, la selección por presupuesto. No reinventa specs.

**OpenSpec** se queda con su valor único: el formato canónico (`### Requirement:` + `#### Scenario:`), las instrucciones para cada artefacto, la validación estricta.

**El agente IA** se queda con lo suyo: redactar las secciones de prosa con el contexto correcto.

## El flujo completo, en comandos y tokens

```bash
# 1. Una sola vez por estado del repo
pnpm forge scan         #  →  .contextforge/scan.json    (0 tokens al modelo)
pnpm forge graph        #  →  .contextforge/graph.json   (0 tokens al modelo)

# 2. Por cada nuevo feature/fix
pnpm forge context "fix race condition in tokenLedger"
                        #  →  .contextforge/context-pack.json    (~12 000 tokens al modelo)
                        #  →  .contextforge/agent-manifest.json  (skills/rules relevantes)

pnpm forge spec fix-token-race
                        #  →  .contextforge/spec-input.json      (~800 tokens al modelo)
                        #  ¿openspec CLI?
                        #    SÍ → openspec new change ...        (esqueleto oficial)
                        #         + .contextforge/spec-prompt.md  (~3 200 tokens al modelo)
                        #    NO → openspec/changes/<id>/...       (scaffold ContextForge formato moderno)

# 3. El agente recibe spec-prompt.md y llena los .md
#    (el agente solo "ve" el spec-prompt + el context-pack — no el repo entero)

openspec validate fix-token-race    # 4. OpenSpec valida la estructura
pnpm forge implement fix-token-race # 5. Plan con guardrails (allowedFiles del pack)
# ... (el agente implementa)
pnpm forge implement --check        # 6. Pre-commit gate: diff vs guardrails
```

## El ahorro, medido

Sobre este mismo repo (128 archivos, ~214 600 tokens si dumpas todo):

| Escenario                                                      | Tokens al modelo | Costo (Claude Sonnet 4.6, $3/M) |
| -------------------------------------------------------------- | ---------------: | ------------------------------: |
| **Sin ContextForge** — agente lee el repo entero               |          217 600 |                           $0.65 |
| **Con ContextForge** — solo context-pack + spec-input + prompt |           18 988 |                          $0.057 |
| **Diferencia**                                                 |        **−91 %** |                      **−$0.59** |

Esto es **por iteración**. Un feature normal pasa por **3 iteraciones de SDD** (proposal → review → design → review → tasks/spec → review):

| Iteraciones         | Sin CF | Con CF | Ahorro absoluto |
| ------------------- | -----: | -----: | --------------: |
| 1                   |  $0.65 | $0.057 |           $0.59 |
| 3                   |  $1.96 |  $0.17 |           $1.79 |
| 10 (proyecto largo) |  $6.50 |  $0.57 |           $5.93 |

## El multiplicador escondido — prompt caching

Claude descuenta **90 % del precio** de tokens cacheados. ContextForge mete un boost adicional aquí porque su output **es determinista**:

- `forge context` con la misma tarea + repo sin cambios → mismo `context-pack.json` byte-a-byte.
- `forge spec` con el mismo input → mismo `spec-prompt.md`.

Eso significa que entre las iteraciones 2 y 3, el agente **cachea** el prompt entero. Solo paga full por el delta del task. Estimación realista con caching activo:

| Iteraciones   | Sin CF (sin caching estable) | Con CF (caching activo) |   Ahorro |
| ------------- | ---------------------------: | ----------------------: | -------: |
| 3 iteraciones |                        $1.96 |                   $0.07 | **÷28×** |

## Los beneficios cualitativos (no medibles en tokens, igual de importantes)

- **Specs más precisos**. El agente no se inventa cross-references; solo ve archivos del dominio relevante.
- **Trazabilidad auditable**. Cada path en `design.md` viene del `context-pack.json` — diff-able, revisable, auditable.
- **Guardrails automáticos**. `forge implement` deriva `allowedFiles[]` del pack → `--check` bloquea archivos fuera de scope **antes** del commit.
- **Equipo consistente**. Todos arrancan SDD con el mismo `context-pack.json` para el mismo task. No más "yo le di al agente otro contexto que tú".
- **Onboarding rápido**. Un dev nuevo lee el `spec-prompt.md` y entiende el dominio sin recorrer el monorepo.
- **Sin lock-in**. Los `.contextforge/*.json` son neutrales. Si mañana sale otra herramienta SDD, los puede consumir igual.

## Por qué es robusto cuando OpenSpec no está instalado

`forge spec` siempre emite `.contextforge/spec-input.json` — ese es el contrato neutral. Después:

- **Modo handoff** (CLI presente): delega a `openspec new change` y emite `spec-prompt.md` con instrucciones canónicas.
- **Modo fallback** (CLI ausente): emite el scaffold con el **mismo formato moderno** (`### Requirement:` + `#### Scenario:`). Cuando el dev instale OpenSpec después, `openspec validate` pasa sin retoque.

Forzar fallback en CI o tests: `pnpm forge spec mi-id --no-openspec`.

## Detalles de portabilidad

`forge spec` corre en Mac, Linux y Windows sin cambios:

- La detección de OpenSpec CLI usa `execSync("openspec --version", { stdio: "ignore", windowsHide: true })`. Node resuelve el binario por PATH en los tres SOs.
- En Windows el binario instalado es `openspec.cmd`; en Mac/Linux es `openspec`. No hace falta diferenciar — Node lo abstrae.
- Los snippets de hooks en `docs/integrations/*.md` tienen bloques separados Bash/Zsh y PowerShell.

## Apéndice — qué archivos consultar en cada situación

| Vas a...                                  | Lee primero                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| Empezar SDD nuevo                         | `.contextforge/spec-prompt.md`                                  |
| Entender la estructura del repo           | `.contextforge/agent-context.md`                                |
| Saber qué archivos importan a tu tarea    | `.contextforge/context-pack.json`                               |
| Saber qué skills/rules aplican a tu tarea | `.contextforge/agent-manifest.json`                             |
| Validar guardrails antes de commit        | `.contextforge/implement-plan.json` + `forge implement --check` |
| Auditar el ahorro real                    | `.contextforge/token-ledger.json`                               |
| Ver el grafo completo del repo            | `.contextforge/graph.json` o `.contextforge/graph.html`         |
