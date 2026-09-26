# Development

Requirements: Node ≥ 22.12, pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm check          # typecheck + lint + tests (what CI runs)
pnpm typecheck
pnpm lint
pnpm test
pnpm golden:update  # regenerate golden fixtures after an intentional change — review the diff!
```

Conventions: strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), pure functions,
no React / Three.js / database imports in `packages/*` (lint-enforced), tests for every deterministic
calculation, deterministic ids and outputs.
