# syntax=docker/dockerfile:1.7

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

WORKDIR /workspace

# Manifest layer for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/

# Install everything (incl. dev deps for tsc); ignore lockfile drift since we
# may build off a tag where the lockfile was last regenerated locally.
RUN pnpm install --no-frozen-lockfile

# Source layer
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/mcp/tsconfig.json packages/mcp/
COPY packages/mcp/src packages/mcp/src
COPY docs/schemas docs/schemas

# Build core then mcp (cli is not needed in this image)
RUN pnpm --filter @alejandro-cedeno-10/contextforge-core build \
 && pnpm --filter @alejandro-cedeno-10/contextforge-mcp build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Tini for proper PID 1 signal handling (MCP runs over stdio)
RUN apk add --no-cache tini

WORKDIR /app

# Copy compiled output preserving the schema-resolution path (`docs/schemas`
# is resolved relative to packages/core/dist/schema/validator.js).
COPY --from=builder /workspace/docs/schemas /app/docs/schemas
COPY --from=builder /workspace/packages/core/package.json /app/packages/core/package.json
COPY --from=builder /workspace/packages/core/dist /app/packages/core/dist
COPY --from=builder /workspace/packages/mcp/package.json /app/packages/mcp/package.json
COPY --from=builder /workspace/packages/mcp/dist /app/packages/mcp/dist

# Workspace metadata so pnpm can install prod deps
COPY --from=builder /workspace/package.json /app/package.json
COPY --from=builder /workspace/pnpm-lock.yaml /app/pnpm-lock.yaml
COPY --from=builder /workspace/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=builder /workspace/packages/cli/package.json /app/packages/cli/package.json

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate \
 && pnpm install --prod --no-frozen-lockfile --filter @alejandro-cedeno-10/contextforge-mcp... \
 && pnpm store prune

# Runtime config: default to /project as the working repo (mount with -v)
ENV PROJECT_ROOT=/project
WORKDIR /project
VOLUME ["/project"]

# Container labels — surfaced in GHCR UI
LABEL org.opencontainers.image.source="https://github.com/alejandro-cedeno-10/contextforge-cli"
LABEL org.opencontainers.image.description="ContextForge MCP server — exposes graph intelligence + agent-manifest tools to AI agents over stdio"
LABEL org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--", "node", "/app/packages/mcp/dist/index.js"]
