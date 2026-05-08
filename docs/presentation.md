---
marp: true
theme: default
paginate: true
backgroundColor: #fff
size: 16:9
title: ContextForge — 94 % menos tokens, contexto al milímetro
description: Pipeline determinista que combina grafos, PageRank y handoff a OpenSpec para que tu agente IA solo lea lo relevante.
author: Alejandro Cedeño
style: |
  section {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 28px;
    padding: 60px 80px;
  }
  h1 {
    color: #0a0a0a;
    font-size: 56px;
    font-weight: 800;
    line-height: 1.1;
  }
  h2 {
    color: #0a0a0a;
    font-size: 40px;
    font-weight: 700;
  }
  h3 {
    color: #2563eb;
    font-size: 32px;
  }
  strong {
    color: #2563eb;
  }
  code {
    background: #f3f4f6;
    color: #be185d;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
  }
  pre code {
    background: #0f172a;
    color: #e2e8f0;
    padding: 16px;
    border-radius: 8px;
    display: block;
    font-size: 0.7em;
    line-height: 1.5;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
  }
  th, td {
    padding: 8px 12px;
    border-bottom: 1px solid #e5e7eb;
  }
  th {
    background: #f9fafb;
    font-weight: 600;
    text-align: left;
  }
  .lead {
    font-size: 36px;
    color: #475569;
  }
  .big-number {
    font-size: 120px;
    font-weight: 900;
    color: #2563eb;
    line-height: 1;
  }
  .small {
    font-size: 0.7em;
    color: #64748b;
  }
  footer {
    color: #94a3b8;
    font-size: 0.6em;
  }
footer: ContextForge · github.com/alejandro-cedeno-10/contextforge-cli
---

<!-- _class: lead -->
<!-- _paginate: false -->

# ContextForge

## 94 % menos tokens.<br>Contexto al milímetro.

<br>

> Pipeline determinista que convierte cualquier repo en un índice consultable por agentes IA.

<br>

`@anai-raia-alex/contextforge-cli@0.3.3`
_Alejandro Cedeño · MIT_

---

# El bug que me costó la cena

<br>

Cada sesión de tu agente IA empieza así:

<br>

<div style="font-family: monospace; font-size: 1.2em; color: #475569;">
"Antes de que escribas una línea de código,<br>
voy a leer los <b>128 archivos</b> del repo, por si acaso."
</div>

<br>

Aunque solo vas a tocar uno. Aunque ya lo hicieron ayer.

---

# La cuenta del error, en dólares

<br>

| Acción                                      | Tokens (input) | Costo Sonnet 4.6 |
| ------------------------------------------- | -------------: | ---------------: |
| 1 sesión `fix race en tokenLedger`          |        217 600 |        **$0.65** |
| 3 iteraciones (proposal → review → ajustes) |        652 800 |        **$1.96** |
| 10 features en un sprint                    |      6 528 000 |       **$19.60** |
| × 6 personas del equipo, × 1 mes            |           ~78M |        **~$235** |

<br>

Y la calidad **baja** con el ruido. El agente se distrae.

---

# Tres bugs que descubrí

<br>

1. **Contexto disperso** — el agente no sabe qué archivos importan.
2. **Specs desconectados** — escribe sobre arena, inventa cross-references.
3. **Skills/rules irrelevantes** — 100 skills configuradas, todas activas siempre.

<br>

Tres bugs. Tres oportunidades. Vamos a la solución.

---

<!-- _class: lead -->

## La solución en tres actos

<br>

```
214 600 tokens (todo el repo)  →  11 988 tokens
```

<br>

<div class="big-number">94 %</div>

**menos tokens. 17.9× compresión. Verificado, no estimado.**

---

# Acto 1 — Grafos para ahorrar tokens

<br>

```bash
forge scan      # 1. Indexa con BLAKE3 (incremental)
forge graph     # 2. Grafo file+symbol con tree-sitter
forge context "fix race en tokenLedger writer"
                # 3. PageRank + BFS + budget de 12k tokens
```

<br>

```
1. resolve_seeds(task)        → archivos semilla
2. personalized_pagerank()    → ranking (alpha=0.85, 50 iter)
3. bfs_expand(depth=2)        → captura deps + transitivas
4. score_nodes()              → pagerank × (1/bfs) × edge_mult
5. greedy_pack(budget=12000)  → llena (full → excerpt → summary)
```

<div class="small">Edge multipliers: tests=1.2 · imports=0.8 · references=0.6</div>

---

# El número clave

<br>

|                | Sin ContextForge |     Con context-pack |
| -------------- | ---------------: | -------------------: |
| Tokens         |          214 600 |           **11 988** |
| Costo / sesión |            $0.64 |           **$0.036** |
| Archivos       |     128 enviados | **50 seleccionados** |

<br>

<div class="big-number">17.9×</div>

**Compresión efectiva.** El agente no lee 78 archivos que no le importan.

---

# Acto 2 — SDD apoyando a OpenSpec

<br>

> Cambio mental clave (v0.3+): `forge spec` ya **no genera** el spec.<br>
> Genera la **entrada** para que OpenSpec lo haga bien.

<br>

```
ContextForge       OpenSpec               Agente IA
────────────       ──────────             ─────────
Selección de  →    Estructura +     →     Redacción
contexto           validación
PageRank + BFS     RFC 2119 +             LLM
+ budget           Given/When/Then
```

<br>

**Tres roles. Cero duplicación. Si OpenSpec evoluciona, no nos pisamos.**

---

# El pipeline SDD completo

<br>

```bash
forge context "<tarea>"          # context-pack + agent-manifest

forge spec mi-feature-id         # spec-input + handoff/fallback
                                 # → con openspec CLI: openspec new change + spec-prompt.md
                                 # → sin openspec CLI: scaffold con formato moderno

openspec list                    # ver changes activos
openspec validate mi-feature-id  # validación oficial

forge implement mi-feature-id    # plan con guardrails (allowedFiles del pack)
# (trabajas con el agente)
forge implement --check          # gate pre-commit

openspec archive mi-feature-id -y  # al cerrar el PR
```

---

# 6 comandos de OpenSpec, integrados

<br>

| Comando OpenSpec                     | Quién lo invoca / dónde      |
| ------------------------------------ | ---------------------------- |
| `openspec init`                      | `forge init` (idempotente)   |
| `openspec new change <id>`           | `forge spec` modo handoff    |
| `openspec instructions <art> --json` | embebido en `spec-prompt.md` |
| `openspec validate <id>`             | tras llenar los .md          |
| `openspec list` / `show`             | inspección durante el SDD    |
| `openspec archive <id> -y`           | al cerrar el PR              |

<br>

ContextForge: **PageRank + grafo + selección + manifest**.<br>
OpenSpec: **estructura + validación + lifecycle**.

---

# Acto 3 — Solo skills/rules de la tarea

<br>

`forge context` ya emite **5 artefactos**:

```
.contextforge/context-pack.json              ← archivos relevantes
.contextforge/agent-manifest.json            ← NEUTRAL
.claude/agent-manifest.md                    ← renderer Claude Code
.cursor/rules/contextforge-active.mdc        ← renderer Cursor
.contextforge/manifests/opencode-readme.md   ← renderer OpenCode
```

**Reglas de matching**:

1. `alwaysApply: true` → siempre incluida
2. `domains: [..]` ∩ dominios tocados → match domain
3. `ctx-<slug>` (auto-generado) → match explicit
4. nada matchea → skipped

---

# Activación por agente — sin pasos manuales

<br>

| Agente          | Cómo se carga                                                                          | Setup                                       |
| --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Claude Code** | Hook `UserPromptSubmit` regenera el manifest en cada prompt                            | Pegar snippet en `.claude/settings.json`    |
| **OpenCode**    | El agente llama tool MCP `select_agent_context({task})` al inicio. **Live, sin disco** | `opencode.json` ya configurado              |
| **Cursor**      | Rule Auto-Attached con `globs:` por dominio                                            | Sin setup; `forge context` regenera la rule |

<br>

**Sin lock-in.** Los `.contextforge/*.json` son JSON neutrales. Otra herramienta los puede consumir igual.

---

<!-- _class: lead -->

## Demo en vivo

<br>

```bash
forge init                        # corre openspec init si está
forge scan && forge graph
forge context "fix race en tokenLedger"
forge spec fix-token-race         # spec-input + spec-prompt.md
# → pegar spec-prompt.md en el agente
openspec validate fix-token-race
forge implement fix-token-race
forge implement --check
openspec archive fix-token-race -y
```

<br>

<div class="small">Tiempo total del pipeline (sin la parte humana del agente): &lt; 90 segundos.</div>

---

# El multiplicador escondido — prompt caching

<br>

Claude descuenta **90 %** del precio de tokens cacheados.

ContextForge produce output **determinista byte-a-byte**:

- Mismo `forge context` con misma tarea + repo → mismo `context-pack.json`
- Mismo `forge spec` → mismo `spec-prompt.md`

<br>

| 3 iteraciones de un feature |     Costo |
| --------------------------- | --------: |
| Sin ContextForge            |     $1.96 |
| Con ContextForge + caching  | **$0.07** |

<div class="big-number" style="font-size: 80px; margin-top: 20px;">÷28×</div>

---

# Métricas reales (este repo, hoy)

<br>

| Métrica           | Valor                                        |
| ----------------- | -------------------------------------------- |
| Tests             | **221 / 221** verde (22 archivos)            |
| Coverage          | ≥ 80 % global · `manifest/` y `spec/` ≥ 95 % |
| Token savings     | **94.4 %** vs baseline                       |
| Compresión        | **17.9×** sesión · **÷28×** SDD con caching  |
| Archivos del repo | 128                                          |
| Archivos en pack  | 50                                           |
| Tokens del pack   | 11 988                                       |
| Grafo             | 368 nodos, 267 edges                         |
| Comandos `forge`  | 13                                           |
| Tools MCP         | 7                                            |

---

# Distribución (todos públicos)

<br>

| Canal                         | Identificador                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------ |
| **npmjs.com** (sin token)     | `@anai-raia-alex/contextforge-cli@0.3.3` (también `-core` y `-mcp`)            |
| **GitHub Container Registry** | `ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest` (multi-arch amd64+arm64) |
| **Repo público**              | `github.com/alejandro-cedeno-10/contextforge-cli`                              |

<br>

```bash
# Empieza en 30 segundos
pnpm add -g @anai-raia-alex/contextforge-cli
npm i -g @fission-ai/openspec
forge init
```

---

<!-- _class: lead -->

## Los 5 puntos memorables

<br>

1. **94 % menos tokens** — verificado.
2. **÷28× costo SDD** — con prompt caching.
3. **Apoyamos a OpenSpec, no competimos**. Tres roles, cero duplicación.
4. **Skills/rules de TU tarea actual**, no las 100 viejas.
5. **Sin lock-in**. JSON neutrales para cualquier agente.

---

<!-- _class: lead -->

# Gracias

<br>

**Repo**: github.com/alejandro-cedeno-10/contextforge-cli

**npm**: `@anai-raia-alex/contextforge-cli`

**Docker**: `ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest`

<br>

_Probadlo en un sprint. Avísenme los números._
_Las métricas reales son lo único que vende esto al CTO._
