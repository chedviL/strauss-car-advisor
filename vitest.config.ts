import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    setupFiles: ["tests/setup/env.ts"],
    // בדיקות אינטגרציה מול Postgres דרך pooler - latency רשת; timeout נדיב.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@domain": new URL("./src/domain", import.meta.url).pathname,
      "@server": new URL("./src/server", import.meta.url).pathname,
    },
  },
});
