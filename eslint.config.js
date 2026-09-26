// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** UI, rendering, database clients, HTTP frameworks and cloud SDKs: never imported by packages/* (engines, persistence, storage). */
const INFRASTRUCTURE = {
  group: ["react", "react-dom", "three", "three/*", "@supabase/*", "@nestjs/*", "pg", "pg-*", "postgres", "@aws-sdk/*", "aws-sdk"],
  message: "Domain engines and the persistence/storage packages stay independent of UI, rendering, database clients, HTTP frameworks and cloud SDKs (CLAUDE.md, M5 §0.1). Adapters live in the API app.",
};

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
  {
    // Tests may assert presence with `!` after explicit lookups.
    files: ["**/test/**/*.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
