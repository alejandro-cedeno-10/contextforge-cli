# ContextForge - Flujo End-to-End

Tiempo estimado: < 2 minutos en un repo de muestra con cache caliente.

## 1. Inicializar

```bash
pnpm forge init
# Salida: ContextForge inicializado.
# Crea: .contextforge/templates/, .contextforge/structure/
```

## 2. Scan

```bash
pnpm forge scan
# Salida: Escrito .contextforge/scan.json
# Producto: scan.json con lista de archivos, hashes BLAKE3, tamaños y tipos
```

Verificar:

```bash
cat .contextforge/scan.json | jq '{version: .schemaVersion, files: (.files | length), hash: .hashAlgorithm}'
# { "version": "0.2.0", "files": 42, "hash": "blake3" }
```

## 3. Graph

```bash
pnpm forge graph
# Salida: Escrito .contextforge/graph.json
# Si scan.json no cambio: "[graph] unchanged scan hash; skipping rebuild"
```

Verificar:

```bash
cat .contextforge/graph.json | jq '{nodes: (.nodes | length), edges: (.edges | length), scanHash: .scanRef.scanHash}'
# { "nodes": 87, "edges": 134, "scanHash": "a3f4b..." }
```

## 4. Context

```bash
pnpm forge context "fix authentication bug in login flow"
# Salida:
#   Escrito .contextforge/context-pack.json
#   Escrito .contextforge/token-ledger.json
```

Revisar savings:

```bash
cat .contextforge/token-ledger.json | jq '{baseline: .baseline.tokens, packed: .packed.tokens, savings: .savings.savingsPct}'
# { "baseline": 48200, "packed": 9400, "savings": 80.5 }
```

## 5. Spec (modo SDD clasico)

```bash
pnpm forge spec fix-auth-bug
# Salida: Escrito .contextforge/spec.sdd.md
# El spec incluye archivos del context-pack como evidencia
```

Revisar criterios verificables:

```bash
grep "pnpm" .contextforge/spec.sdd.md
# - [ ] Los cambios pasan todos los tests existentes (`pnpm test`)
# - [ ] `forge implement --check` sale con codigo 0
```

## 5b. Spec (modo OpenSpec)

```bash
pnpm forge spec fix-auth-bug --emit openspec
# Salida: Escrito openspec/changes/fix-auth-bug/ (proposal, design, tasks, specs)
# Estructura:
#   openspec/changes/fix-auth-bug/proposal.md
#   openspec/changes/fix-auth-bug/design.md
#   openspec/changes/fix-auth-bug/tasks.md
#   openspec/changes/fix-auth-bug/specs/<domain>/spec.md
```

El `spec.md` usa secciones `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`
con formato Given/When/Then + RFC 2119 (MUST/SHALL/SHOULD/MAY).

## 6. Implement plan

```bash
pnpm forge implement fix-auth-bug
# Salida: Escrito .contextforge/implement-plan.json
# El plan incluye guardrails derivados del context-pack:
#   allowedFiles: archivos con mode full/excerpt
#   forbiddenPaths: **/.env*, **/secrets/**, **/.git/**
#   maxLocDelta: calculado como min(1000, nArchivos * 50)
#   maxFilesChanged: nArchivos + 2
```

Revisar guardrails:

```bash
cat .contextforge/implement-plan.json | jq '.guardrails'
# {
#   "allowedFiles": ["src/auth/login.ts", "src/auth/token.ts"],
#   "forbiddenPaths": ["**/.env*", "**/secrets/**", "**/.git/**"],
#   "maxLocDelta": 100,
#   "maxFilesChanged": 4,
#   "noNewDependencies": true
# }
```

## 7. Agente edita (ejemplo manual)

El agente (OpenCode, Claude Code, Cursor) lee `implement-plan.json` y edita
dentro de `guardrails.allowedFiles`.

## 8. Validar post-edit

```bash
pnpm forge implement --check
# Si pasa: "[check] passed: sin violaciones de guardrails."
# Si falla: "[check] FAILED: violaciones encontradas:" + lista de reglas
# Exit code: 0 si passed, 3 si hay violaciones
```

Violaciones posibles:

| Regla | Causa |
|---|---|
| `forbiddenPath` | Archivo modificado matchea `forbiddenPaths` |
| `outsideAllowedFiles` | Archivo modificado no esta en `allowedFiles` |
| `maxLocDelta` | LOC (added+removed) excede el limite |
| `maxFilesChanged` | Numero de archivos modificados excede el limite |

## 9. Aprobar para edicion (flujo con agente externo)

Si el plan necesita aprobacion humana explicita antes de que el agente edite:

```bash
pnpm forge implement --approve
# Estado cambia de plan_only -> approved_for_edit
# Requiere accion humana explicita (no automatico)
```

## Artefactos generados

| Archivo | Schema | Descripcion |
|---|---|---|
| `.contextforge/scan.json` | `scan.schema.json` | Lista de archivos con hashes BLAKE3 |
| `.contextforge/graph.json` | `graph.schema.json` | Grafo de simbolos y dependencias |
| `.contextforge/context-pack.json` | `context-pack.schema.json` | Archivos seleccionados por PageRank + BFS |
| `.contextforge/token-ledger.json` | `token-ledger.schema.json` | Metricas de ahorro de tokens |
| `.contextforge/spec.sdd.md` | (markdown) | Spec SDD con evidencia del context-pack |
| `.contextforge/implement-plan.json` | `implement-plan.schema.json` | Plan con guardrails + estado |
| `openspec/changes/<id>/` | (OpenSpec) | Estructura OpenSpec con delta specs |

Todos los JSON son validados contra JSON Schema 2020-12 antes de escribirse.
