import { defineConfig } from "vitest/config";

/** Database integration tests (M5 step 3): LOCAL / CI PostgreSQL 17 only, via DATABASE_URL. */
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/support/global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
