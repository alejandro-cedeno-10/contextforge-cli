import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@anai-raia-alex/contextforge-core/schema/validator": path.resolve(
        here,
        "packages/core/src/schema/validator.ts"
      ),
      "@anai-raia-alex/contextforge-core/schema/versions": path.resolve(
        here,
        "packages/core/src/schema/versions.ts"
      ),
      "@anai-raia-alex/contextforge-core/graph/builder": path.resolve(
        here,
        "packages/core/src/graph/builder.ts"
      ),
      "@anai-raia-alex/contextforge-core": path.resolve(
        here,
        "packages/core/src/index.ts"
      )
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/core/src/**/*.ts",
        "packages/cli/src/**/*.ts",
        "packages/mcp/src/**/*.ts"
      ],
      exclude: [
        "packages/**/__tests__/**",
        "packages/mcp/src/index.ts",
        "packages/cli/src/index.ts",
        "packages/cli/src/htmlTemplate.ts"
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    }
  }
});
