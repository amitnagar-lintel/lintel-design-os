import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    // Database tests (incl. API-against-PostgreSQL tests) need PostgreSQL 17 and run separately (`pnpm test:db`, CI `db` job).
    exclude: ["tests/db/**", "apps/*/test/db/**", "**/node_modules/**"],
    environment: "node",
  },
});
