// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** UI, rendering, database clients, HTTP frameworks and cloud SDKs: never imported by packages/* (engines, persistence, storage). */
const INFRASTRUCTURE = {
  group: ["react", "react-dom", "three", "three/*", "@supabase/*", "@nestjs/*", "pg", "pg-*", "postgres", "@aws-sdk/*", "aws-sdk"],
  message: "Domain engines and the persistence/storage packages stay independent of UI, rendering, database clients, HTTP frameworks and cloud SDKs (CLAUDE.md, M5 §0.1). Adapters live in the API app.",
};

/** What the API app may never import: UI / rendering, and (until the storage adapters step) cloud SDKs. */
const API_FORBIDDEN = {
  group: ["react", "react-dom", "three", "three/*", "@supabase/*", "@aws-sdk/*", "aws-sdk"],
  message: "The API never imports UI or rendering code; cloud SDKs only in reviewed infrastructure adapters.",
};
const API_PG = { group: ["pg", "pg-*", "postgres"], message: "Only the API database layer (common/db, infrastructure) uses the PostgreSQL client." };

const ENGINE_PACKAGES = ["types", "rules-engine", "geometry-engine", "catalog-engine", "hettich-engine", "design-engine", "bom-engine", "boq-engine", "pricing-engine", "drawing-engine"];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-restricted-imports": ["error", { patterns: [INFRASTRUCTURE] }],
    },
  },
  {
    // Engines are pure: no persistence, storage, database, HTTP framework or cloud SDK (M5 §0.1, §8).
    files: [`packages/{${ENGINE_PACKAGES.join(",")}}/src/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            INFRASTRUCTURE,
            { group: ["@lintel/persistence", "@lintel/persistence/*", "@lintel/storage", "@lintel/storage/*"], message: "Engines never depend on persistence or storage; the application service calls both (M5 §8)." },
          ],
        },
      ],
    },
  },
  {
    // Database integration tests (M5 step 3) are the only place a database client (pg) may be imported.
    files: ["tests/db/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ ...INFRASTRUCTURE, group: INFRASTRUCTURE.group.filter((g) => g !== "pg") }] }],
    },
  },
  // ---------------------------------------------------------------- API (apps/api): API → application services → persistence / engines / storage → PostgreSQL
  {
    // The API may use NestJS / Fastify; never UI or rendering libraries; cloud SDKs only in later storage adapters; `pg` only in the database layer.
    files: ["apps/api/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [API_FORBIDDEN, API_PG] }],
      // NestJS modules are decorated, intentionally empty classes.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
  {
    // The database layer, repositories and API tests may use the PostgreSQL client.
    files: ["apps/api/src/common/db/**/*.ts", "apps/api/src/infrastructure/**/*.ts", "apps/api/test/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [API_FORBIDDEN] }] },
  },
  {
    // Controllers: HTTP only. They call application services; never repositories, the database, engines, persistence or storage.
    files: ["apps/api/src/modules/**/*.controller.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [API_FORBIDDEN, API_PG, {
        group: ["**/infrastructure/**", "**/common/db/**", "@lintel/persistence", "@lintel/persistence/*", "@lintel/storage", "@lintel/storage/*", "@lintel/*-engine", "@lintel/*-engine/*"],
        message: "Controllers are HTTP only: route, validate, call an application service, map the result. No business calculation, no SQL (M5 Step 4 §1.3).",
      }] }],
    },
  },
  {
    // Repositories run SQL only: no engines, no hashing/provenance, no storage.
    files: ["apps/api/src/infrastructure/persistence/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [API_FORBIDDEN, {
        group: ["@lintel/persistence", "@lintel/persistence/*", "@lintel/storage", "@lintel/storage/*", "@lintel/*-engine", "@lintel/*-engine/*"],
        message: "Repositories contain SQL only; calculations and hashing belong to application services via engines / @lintel/persistence (M5 Step 4 §1.3).",
      }] }],
    },
  },
  // ---------------------------------------------------------------- database operations tool (apps/db-tools): migration runner, org initialisation
  {
    // An operator tool with its own connection (MIGRATION_DATABASE_URL): the PostgreSQL client, nothing else from infrastructure.
    files: ["apps/db-tools/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ ...INFRASTRUCTURE, group: INFRASTRUCTURE.group.filter((g) => g !== "pg") }, {
        group: ["**/apps/api/**", "@lintel/api", "@lintel/*-engine", "@lintel/*-engine/*"],
        message: "The database tool is independent of the API and the engines: it applies SQL and writes governance rows only.",
      }] }],
    },
  },
  {
    // The reference-data intake validates with the engines' own validators and maps with @lintel/persistence (M6 G2).
    files: ["apps/db-tools/src/intake/**/*.ts", "apps/db-tools/test/**/intake*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ ...INFRASTRUCTURE, group: INFRASTRUCTURE.group.filter((g) => g !== "pg") }, {
        group: ["**/apps/api/**", "@lintel/api"],
        message: "The intake tool is independent of the API: it writes through the database's own RLS and transition().",
      }] }],
    },
  },
  {
    // The pilot rehearsal (LOCAL only) re-states the engines' in-code test fixtures as intake files; it reaches the API over HTTP only.
    files: ["apps/db-tools/src/pilot/**/*.ts", "apps/db-tools/test/**/pilot*.ts", "apps/db-tools/test/**/rehearsal*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ ...INFRASTRUCTURE, group: INFRASTRUCTURE.group.filter((g) => g !== "pg") }, {
        group: ["**/apps/api/**", "@lintel/api"],
        message: "The pilot tools are independent of the API: they use its HTTP interface only.",
      }] }],
    },
  },
  // ---------------------------------------------------------------- pilot UI (apps/web): a view over /api/v1
  {
    // The UI talks to the API only: no engines (no duplicated BOM / BOQ / pricing logic), no persistence, no database, no server framework.
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{
        group: ["pg", "pg-*", "postgres", "@nestjs/*", "@lintel/*", "**/apps/api/**", "**/packages/**", "@aws-sdk/*", "aws-sdk"],
        message: "The pilot UI is a view over /api/v1: every calculation comes from the API's engines; it imports no engine, persistence, storage or database code.",
      }] }],
    },
  },
  {
    // Tests may assert presence with `!` after explicit lookups.
    files: ["**/test/**/*.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The browser walkthrough of the pilot UI (plain Node ESM, run by hand against `pnpm pilot:demo`).
    files: ["apps/web/e2e/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false }, globals: { process: "readonly", Buffer: "readonly", console: "readonly", fetch: "readonly" } },
  },
);
