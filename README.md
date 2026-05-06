# ContextForge

ContextForge es un CLI TypeScript para generar:

- grafos estructurales del repositorio
- context packs para agentes
- specs SDD listas para implementar

## Requisitos

- Node.js >= 22
- pnpm >= 10

## Instalacion

```bash
corepack enable
pnpm install
```

## Uso

```bash
pnpm forge init
pnpm forge scan
pnpm forge graph
pnpm forge context
pnpm forge spec
pnpm forge implement
```

## Estructura

- `packages/core`: scanner y logica determinista
- `packages/cli`: comando `forge`
- `packages/agents`: artefactos de agentes
- `packages/integrations`: adaptadores futuros

## Artefactos generados

- `.contextforge/scan.json`
- `.contextforge/graph.json`
- `.contextforge/context-pack.json`
- `.contextforge/spec.sdd.md`

## Desarrollo

```bash
pnpm lint
pnpm test
pnpm build
```

## Licencia

MIT
