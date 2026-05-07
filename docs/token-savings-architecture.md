# ContextForge — Arquitectura de ahorro de tokens

## ¿Cómo se alinea el init/preparación con el ahorro de tokens?

El init es una inversión única que convierte el repo en un índice consultable.
El ahorro ocurre en tres capas acumulativas.

---

## Capa 1 — Preparación (una vez, sin LLM)

```
forge scan    → indexa archivos + hashes BLAKE3        (0 tokens)
forge graph   → construye grafo de dependencias        (0 tokens)
forge context → selecciona archivos relevantes         (0 tokens)
```

Costo: solo tiempo de CPU (~5–30 s según repo).
Resultado: `.contextforge/` con `scan.json`, `graph.json`, `context-pack.json`.

---

## Capa 2 — Cada sesión del agente (context pack fijo)

| Estrategia          | Tokens por sesión | Costo estimado | Ahorro |
|---------------------|:-----------------:|:--------------:|:------:|
| Sin ContextForge    | ~121 000          | ~$0.36         | —      |
| Con `context-pack`  | ~11 700           | ~$0.035        | 90 %   |
| Con MCP on-demand   | ~2 000–4 000      | ~$0.01         | 97 %   |

El agente carga el pack al inicio de la sesión en lugar del repo completo.

---

## Capa 3 — MCP on-demand (queries quirúrgicas durante implementación)

En lugar de cargar todo el pack al inicio, el agente hace llamadas selectivas:

| Momento                   | Tool MCP                          | Tokens | Para qué                              |
|---------------------------|-----------------------------------|:------:|---------------------------------------|
| Inicio de sesión          | `forge_status`                    | ~400   | "¿qué artifacts tengo ready?"         |
| Entender estructura       | `forge_domain_map`                | ~600   | "¿cómo está organizado el repo?"      |
| Antes de tocar un archivo | `forge_neighbors("auth.ts")`      | ~300   | "¿qué depende de esto?"               |
| Decidir qué implementar   | `forge_context("fix auth bug")`   | ~2 000 | Solo los archivos relevantes          |
| Antes de commitear        | `forge_check`                     | ~200   | Validar guardrails                    |

---

## Flujo completo de una sesión típica

```
Agent startup
  └─ forge_status          (~400 tokens)  → sabe que graph.json está listo

Planning phase
  └─ forge_domain_map      (~600 tokens)  → entiende la estructura del repo
  └─ forge_context(task)   (~2000 tokens) → obtiene los archivos relevantes

Implementation phase
  └─ forge_neighbors(file) (~300 tokens)  → revisa impacto antes de editar

Commit phase
  └─ forge_check           (~200 tokens)  → valida guardrails

Total sesión MCP: ~3 500 tokens  vs  121 000 sin ContextForge  → 97% ahorro
```

---

## Por qué el init no cuesta tokens

`forge scan` y `forge graph` son análisis estáticos puros:

- `scan` usa el sistema de archivos + BLAKE3 para fingerprinting
- `graph` parsea imports con tree-sitter (sin LLM)
- `context` aplica PageRank sobre el grafo (sin LLM)

El LLM solo entra cuando el agente consulta los artifacts ya construidos.
Esto invierte el costo: **paga una vez en CPU, ahorra N veces en tokens**.

---

## Referencias

- `packages/mcp/src/index.ts` — implementación de los 5 tools MCP
- `packages/core/src/selector/index.ts` — PageRank para selección de contexto
- `docs/EXAMPLES/end-to-end-flow.md` — ejemplo completo de sesión
- `.contextforge/token-ledger.json` — registro de ahorro de la última ejecución
