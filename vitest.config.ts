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
    // Supabase Session Pooler מוגבל ל-15 clients. ריצת קבצי בדיקה במקביל
    // (worker לכל קובץ) פותחת מספר pools בו-זמנית וחורגת מהגבול
    // (EMAXCONNSESSION). fork יחיד מסריאל את הקבצים כך ש-pool אחד בלבד חי
    // בכל רגע; בדיקות היחידה הטהורות מהירות, ולכן העלות זניחה.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "@domain": new URL("./src/domain", import.meta.url).pathname,
      "@server": new URL("./src/server", import.meta.url).pathname,
    },
  },
});
