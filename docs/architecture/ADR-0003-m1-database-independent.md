# ADR-0003 — M1 is database-independent

Status: **Accepted** (2026-09-26)

## Context
The ops Supabase project is mid-migration (Seoul `cxgxmqspvpuizvwfbnjq` → Mumbai
`hjinbezdjrrqfvceauof`, not yet cut over).

## Decision
No Design OS schema is added to either Supabase project yet and no separate project is created.
All M1 engines are pure TypeScript operating on in-memory, versioned data (`CatalogSnapshot`,
`ConstructionStandard`, manufacturer datasets). `database/` is intentionally empty.
The canonical-database decision is made after the Mumbai cut-over is verified, before the database phase.

## Consequences
Persistence will be an adapter over the engine types; engines never import a database client
(enforced by ESLint `no-restricted-imports`).
