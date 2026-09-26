import { defineConfig } from "vitest/config";

/** Database integration tests (M5 steps 3–4, incl. the API against PostgreSQL): LOCAL / CI PostgreSQL 17 only, via DATABASE_URL. */
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts", "apps/api/test/db/**/*.test.ts", "apps/db-tools/test/db/**/*.test.ts"],
    globalSetup: ["tests/db/support/global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
