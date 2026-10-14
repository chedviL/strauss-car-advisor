import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    setupFiles: ["tests/setup/env.ts"],
  },
  resolve: {
    alias: {
      "@domain": new URL("./src/domain", import.meta.url).pathname,
      "@server": new URL("./src/server", import.meta.url).pathname,
    },
  },
});
