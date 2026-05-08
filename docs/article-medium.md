---
title: "Tu agente IA lee 200 mil tokens cada sesión. Solo necesita 12 mil."
subtitle: "Cómo armé un pipeline determinista que recorta 94 % de tokens y deja a OpenSpec hacer su trabajo bien"
description: "Pipeline open-source que combina grafos de dependencias, PageRank y handoff a OpenSpec para que tu agente IA solo lea los archivos relevantes a la tarea actual. Medido: 17.9× de compresión, ÷28× de costo SDD con prompt caching."
canonical_url: https://github.com/alejandro-cedeno-10/contextforge-cli
cover_image:
tags: [ai, developer-tools, openspec, claude, opencode, cursor, sdd, typescript]
published: false
---

# Tu agente IA lee 200 mil tokens cada sesión. Solo necesita 12 mil.

> El día que abrí la factura de Anthropic y vi 28 dólares en una semana, supe que algo estaba mal. No estaba haciendo más trabajo. Estaba haciendo el mismo trabajo, pero mi agente leía el repo entero **cada vez** que arrancaba una conversación.

## El bug que me costó la cena

Imagínate que cada vez que abres tu IDE, antes de que puedas escribir una línea de código, alguien te recita en voz alta los 128 archivos del proyecto. Aunque solo vas a tocar uno. Aunque ya lo hicieron ayer. Aunque ya lo hicieron en la conversación anterior. Eso es lo que tu agente IA hace por defecto. Solo que en lugar de cansarte los oídos, te cobra **214 600 tokens por sesión**.

Hice la cuenta sobre el repo donde estoy trabajando:

| Acción | Tokens (input) | Costo Claude Sonnet 4.6 |
|---|---:|---:|
| Le pides "fix race en tokenLedger writer" | 217 600 | **$0.65** |
| Lo iteras 3 veces (proposal → review → ajustes) | 652 800 | **$1.96** |
| 10 features en un sprint | 6 528 000 | **$19.60** |

Multiplicalo por tu equipo de 6 personas. Y por el mes. Te llega la factura como un puñetazo cordial.

El problema no es que el agente sea malo. Es que **no sabe qué archivos importan a tu tarea**. Le diste el enunciado en una línea y él, por defecto, asume que necesita el repo entero para no equivocarse. Es el equivalente a abrir el frigorífico para ver qué hay antes de cocinar pasta. Spoiler: la pasta está en la despensa.

Pero hay tres bugs más que descubrí en el camino:

1. **Specs desconectados del código**. Le pides un PRD/spec a tu agente y se inventa archivos, cita módulos que ya no existen, repite cross-references viejas. Como un asesor que nunca abrió el repo.

2. **Skills/rules que no aplican**. Tienes 100 skills configuradas en Claude Code. El agente las ve **todas**. Tu rule de Cursor es `alwaysApply: true` y aplica para todo, hasta para tareas donde no tiene sentido.

3. **Sin validación estructural**. Cada PR tiene un spec con formato distinto. El reviewer se vuelve cuello de botella.

Tres bugs. Tres oportunidades. Vamos a la solución.

---

## La solución en tres actos

Lo que armé se llama **ContextForge**. Es un CLI que **convierte tu repo en un índice consultable** y le da a tu agente exactamente lo que necesita para la tarea actual. Tres capas, todas determinísticas (cero LLM dentro del pipeline), todas auditables.

```
214 600 tokens (todo el repo)  →  11 988 tokens (lo que importa a la tarea)
```

Eso es **94.4 %** menos. Compresión efectiva: **17.9×**. Verificado en este mismo repo, no estimado.

### Acto 1 — Grafos para que el agente solo lea lo que importa

La idea es vieja: si tienes un grafo de dependencias del código, sabes exactamente qué archivos están conectados a qué. Si te piden "tocar `tokenLedger`", PageRank te dice cuáles archivos son **vecinos relevantes** y cuáles son ruido.

Yo lo armo así:

```bash
forge scan      # 1. Indexa con BLAKE3 (incremental, < 30s)
forge graph     # 2. Construye grafo file+symbol con tree-sitter
forge context "fix race en tokenLedger writer"
                # 3. PageRank + BFS + budget de 12k tokens
```

El paso 3 es donde está la magia. El algoritmo:

```
1. resolve_seeds(task)       →  encuentra archivos semilla (keywords del task)
2. personalized_pagerank()   →  ranking (alpha=0.85, 50 iteraciones)
3. bfs_expand(depth=2)       →  captura deps directas + transitivas
4. score_nodes()             →  pagerank × (1/bfs_dist) × edge_multiplier
5. greedy_pack(budget=12000) →  llena hasta 12k tokens (full → excerpt → summary)
```

Edge multipliers: tests pesan más que imports (`tests=1.2`, `imports=0.8`) porque suelen tener mejor contexto del comportamiento esperado.

¿Resultado en mi repo?

| Sin ContextForge | Con context-pack |
|---|---|
| 214 600 tokens | 11 988 tokens |
| ~$0.64 / sesión | ~$0.036 / sesión |
| 128 archivos enviados | 50 archivos seleccionados |

El agente recibe **50 archivos** específicos en lugar de 128 a ciegas. Y la cuenta de Anthropic respira.

### Acto 2 — SDD que **se apoya en OpenSpec**, no compite con él

Aquí está el cambio mental importante. Cuando empecé, mi `forge spec` generaba el spec completo: proposal, design, tasks, spec.md con sus Requirements. Funcionaba. Hasta que **OpenSpec 1.3** salió con un nuevo formato (`### Requirement: <título>` + `#### Scenario:` + Given/When/Then) y mi formato bullet quedó obsoleto. Tuve que decidir: o me convertía en mantenedor permanente del formato OpenSpec (y cada vez que ellos evolucionan, yo persigo), o cambiaba de estrategia.

Cambié de estrategia. **ContextForge ya no genera el spec final**. Genera la **entrada** para que OpenSpec lo haga bien:

```
       ┌─────────────────────┐    ┌─────────────────────┐    ┌────────────────┐
       │   ContextForge      │    │     OpenSpec        │    │   Agente IA    │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
ROL    │  Selección de       │    │  Estructura +       │    │  Redacción     │
       │  contexto           │    │  validación         │    │                │
       ├─────────────────────┤    ├─────────────────────┤    ├────────────────┤
TÉC.   │  PageRank + BFS +   │    │  Schemas RFC 2119   │    │  LLM           │
       │  budget tokens      │    │  Given/When/Then    │    │                │
       └─────────────────────┘    └─────────────────────┘    └────────────────┘
```

Tres roles separados. Cada uno hace lo suyo. Cero duplicación.

`forge spec` ahora hace dos cosas:

```bash
forge spec mi-feature-id
# 1. Emite .contextforge/spec-input.json (artefacto neutral, validado por JSON Schema)
# 2. Si openspec CLI está en PATH:
#    - corre `openspec new change <id>` (esqueleto oficial)
#    - corre `openspec instructions proposal --change <id> --json`
#    - combina ambas con el spec-input y emite .contextforge/spec-prompt.md
#    El dev pega ese prompt en su agente. Punto.
# 3. Si openspec CLI no está:
#    - emite el scaffold con formato moderno (### Requirement: + #### Scenario:)
#      → cuando el dev instale openspec después, `openspec validate` pasa sin retoque
```

Y la integración no se queda solo en `validate`. Mi `forge` ahora referencia **6 comandos de OpenSpec** en lugares concretos del flujo:

| Comando OpenSpec | Quién lo invoca / dónde |
|---|---|
| `openspec init` | `forge init` lo ejecuta si está y `./openspec/` falta. Idempotente. |
| `openspec new change <id>` | `forge spec` modo handoff |
| `openspec instructions <art> --json` | embebido en `spec-prompt.md` |
| `openspec validate <id>` | step recomendado tras llenar los .md |
| `openspec list` / `show <id>` | inspección durante el SDD |
| `openspec archive <id> -y` | al cerrar el PR |

ContextForge se queda con **PageRank + grafo + selección + manifest**. OpenSpec con **estructura + validación + lifecycle**. Tres roles, cero pisones.

### Acto 3 — Solo cargar las skills/rules que aplican a la tarea

Vuelvo al bug 2 del principio. Si tienes 100 skills configuradas, el agente las ve todas. Eso es ruido cognitivo y tokens desperdiciados.

Mi `forge context` (el comando del Acto 1) ahora emite **automáticamente** un agent-manifest:

```
.contextforge/context-pack.json              ← archivos relevantes
.contextforge/agent-manifest.json            ← NEUTRAL (skills/rules de la tarea)
.claude/agent-manifest.md                    ← renderer Claude Code
.cursor/rules/contextforge-active.mdc        ← renderer Cursor (Auto-Attached)
.contextforge/manifests/opencode-readme.md   ← renderer OpenCode
```

Las reglas de matching (priorizadas):

1. `alwaysApply: true` → siempre incluida.
2. `domains: [...]` (frontmatter) ∩ dominios tocados → match domain.
3. `ctx-<slug>` (nombre auto-generado por `forge skills`) → match explicit (retrocompatible).
4. nada matchea → skipped (con razón).

Y la activación es distinta por agente:

| Agente | Cómo se carga | Setup |
|---|---|---|
| Claude Code | Hook `UserPromptSubmit` regenera el manifest en cada prompt | Pegar snippet en `.claude/settings.json` |
| OpenCode | El agente llama tool MCP `select_agent_context({task})` al inicio. **Live, sin disco** | `opencode.json` ya configurado |
| Cursor | Rule Auto-Attached con `globs:` por dominio. Se activa al abrir un archivo del dominio | Sin setup |

---

## Demo práctico: del 0 al "spec validado" en 4 minutos

Voy a hacerlo con un caso real de mi repo: arreglar un bug de race condition en `tokenLedger`. Tú puedes seguirme con cualquier repo TypeScript, Python o Go.

### Paso 0 — Instalar (30 segundos)

```bash
# El CLI (público en npmjs.com, sin token)
pnpm add -g @anai-raia-alex/contextforge-cli

# OpenSpec CLI para activar el modo handoff
npm i -g @fission-ai/openspec
```

Si prefieres no instalar Node, hay imagen Docker multi-arch para el MCP server:

```bash
docker pull ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest
```

### Paso 1 — Setup del repo (10 segundos)

```bash
cd mi-repo
forge init
```

Sale algo así:

```
ContextForge inicializado.
Generado .contextforge/agent-context.md (consulta esto al abrir sesión con un agente IA).

OpenSpec inicializado (vía `openspec init . --tools=claude,cursor,opencode --force`).
```

Eso me hace **dos cosas que no me esperaba al principio**:

- Crea `.contextforge/agent-context.md` — un archivo derivado que cualquier agente IA puede leer al iniciar sesión y entiende el repo: artefactos disponibles, cómo consumirlos, receta SDD completa, tabla de comandos por intención.
- Si `openspec` CLI está en PATH y `./openspec/` no existe, ejecuta `openspec init . --tools=claude,cursor,opencode --force` y deja las **instrucciones canónicas de OpenSpec** instaladas en `.claude/`, `.cursor/rules/`, etc. Idempotente: si ya hay `openspec/`, no toca nada.

### Paso 2 — Indexar el repo (20 segundos la primera vez)

```bash
forge scan && forge graph
```

Genera `.contextforge/scan.json` (inventario con hashes BLAKE3) y `.contextforge/graph.json` (368 nodos, 267 edges). La segunda corrida cachea por hash y termina en < 5 segundos si nada cambió.

### Paso 3 — Pedir contexto para la tarea (5 segundos)

```bash
forge context "fix race condition in tokenLedger writer"
```

Sale:

```
Escrito .contextforge/context-pack.json
Escrito .contextforge/token-ledger.json

Escrito .contextforge/agent-manifest.json
Escrito .claude/agent-manifest.md
Escrito .cursor/rules/contextforge-active.mdc
Escrito .contextforge/manifests/opencode-readme.md
[manifest] 3 skills activas, 5 omitidas · dominios: packages/core
```

50 archivos seleccionados. 11 988 tokens. **94.4 % menos** que el dump completo.

### Paso 4 — Generar el spec (8 segundos)

```bash
forge spec fix-token-race
```

Con OpenSpec CLI presente, sale:

```
Escrito .contextforge/spec-input.json
Created openspec/changes/fix-token-race/...
Escrito .contextforge/spec-prompt.md

Esqueleto creado (openspec new change fix-token-race).
Pega .contextforge/spec-prompt.md en tu agente IA.
Cuando termine:
  openspec validate fix-token-race
  pnpm forge implement fix-token-race
```

Ahora abres tu agente (Claude Code, Cursor, OpenCode) y le pegas `.contextforge/spec-prompt.md`. Ese archivo tiene **4 secciones**:

```
1. Contexto del repo (de ContextForge)
   - Tarea, dominio inferido, archivos afectados (con purpose, mode, reason)
   - Dependencias cross-domain (del grafo)
   - Evidencia (paths trazables)

2. Instrucciones canónicas de OpenSpec
   - Lo que devuelve `openspec instructions proposal --change <id> --json`

3. Restricciones para tu salida
   - Token budget, allowed files, formato moderno (### Requirement: + #### Scenario:)

4. Output esperado
   - Editar openspec/changes/<id>/{proposal,design,tasks,specs}.md
   - Cuando termines: openspec validate <id>
```

El agente **no abre el repo**. Solo lee este prompt + el context-pack si necesita más detalle. Eso es **18 988 tokens** en lugar de 217 600. Y como el output es determinista, Claude/OpenCode cachean el prompt entre iteraciones (caching descuenta el 90 % del costo de los tokens repetidos).

### Paso 5 — Validar y arrancar la implementación

```bash
openspec validate fix-token-race    # check estructural oficial
forge implement fix-token-race       # plan con guardrails derivados del pack
```

`forge implement` genera `implement-plan.json` con:

- `allowedFiles[]` ← exactamente los archivos del pack (50 archivos)
- `forbiddenPaths[]` — nunca tocar
- `maxLocDelta` — derivado del tamaño del pack
- `maxFilesChanged` — `allowedFiles.length + 2`

### Paso 6 — Trabajar y validar antes del commit

Después de que el agente (o tú) modifica código:

```bash
forge implement --check
```

Si te saliste del scope, te dice exactamente qué archivo no estaba permitido y cuántas líneas excediste. Si todo está dentro del pack, exit 0 y haces commit.

### Paso 7 — Cerrar el ciclo

```bash
openspec archive fix-token-race -y
```

Mueve el spec a `openspec/specs/` y limpia `openspec/changes/`. Listo.

---

## Las cifras, sin redondear

Sobre este repo (128 archivos), por cada iteración SDD:

```
Sin ContextForge   →  217 600 tokens  =  $0.65
Con ContextForge   →   18 988 tokens  =  $0.057   (-91 %)
```

Pero un feature normal pasa por **3 iteraciones** (proposal → review → ajustes). Y aquí entra el multiplicador escondido: **prompt caching**.

Claude descuenta 90 % del precio de tokens cacheados. ContextForge mete un boost porque su output **es determinista byte-a-byte**: mismo `forge context` con misma tarea + repo igual → mismo `context-pack.json`. Mismo `forge spec` → mismo `spec-prompt.md`. Eso significa que **entre iteraciones 2, 3 y N, el agente cachea todo el prompt**. Solo paga full por el delta.

| 3 iteraciones de un feature | Costo |
|---|---:|
| Sin ContextForge | $1.96 |
| Con ContextForge + caching | **$0.07** (÷28×) |

10 features de tamaño medio en un sprint:

| Setup | Costo input tokens |
|---|---:|
| Sin ContextForge | ~$20 |
| Con ContextForge + caching | ~$0.70 |

Sin lock-in: los `.contextforge/*.json` son JSON validados por schema. Si mañana sale otra herramienta SDD o IDE, los puede consumir igual.

---

## ¿Por qué te debería importar?

Si trabajas con cualquiera de estos:

- **Claude Code, Cursor, OpenCode, Codex** y pagas tokens por uso.
- Equipos que quieren **specs ejecutables** (SDD real, no PRD muertos).
- Repos grandes (100+ archivos) donde el agente "se pierde".
- CI con presupuesto y necesitas auditabilidad de qué archivos lee el agente.

ContextForge te da:

1. **94 % menos tokens por sesión** — verificado, no estimado.
2. **÷28× costo SDD con prompt caching** — porque el output es determinista.
3. **No competimos con OpenSpec** — apoyamos a OpenSpec en lo suyo. Tres roles separados.
4. **Skills/rules de tu tarea actual, no las 100 viejas**.
5. **Sin lock-in**. Los JSON son neutrales.

---

## Empieza ahora

Repo: https://github.com/alejandro-cedeno-10/contextforge-cli (MIT, abierto a issues/PRs).

```bash
# 1. Instalar
pnpm add -g @anai-raia-alex/contextforge-cli
npm i -g @fission-ai/openspec

# 2. En cualquier repo
cd tu-proyecto
forge init
forge scan && forge graph
forge context "tu tarea aquí"

# 3. Trabaja con tu agente. La cuenta de Anthropic ya respira.
```

Si tu equipo lo prueba en un sprint y lo medís, **avísame los números** — abro un PR al README con tu caso. Las métricas son lo único que importa cuando vendes esto al CTO.

---

*¿Te sirvió este artículo? Dale clap, compártelo, y dime en los comentarios cuántos tokens ahorraste tú. Lo que me dejen acá termina puliendo el roadmap del proyecto.*

*Repo: [contextforge-cli](https://github.com/alejandro-cedeno-10/contextforge-cli) · npm: [@anai-raia-alex/contextforge-cli](https://www.npmjs.com/package/@anai-raia-alex/contextforge-cli) · Docker: `ghcr.io/alejandro-cedeno-10/contextforge-mcp:latest`*
