# database/migrations

`design_os` schema migrations (M5 step 3). Plain SQL, forward-only, each with a tested rollback
(`NNNN_name.up.sql` / `NNNN_name.down.sql`).

| # | Migration | Contents |
|---|---|---|
| 0001 | foundation | Roles (`design_os_owner`, `design_os_api`), lifecycle enum, claim helpers, immutability guards, version-envelope installer, versioned-table registry |
| 0002 | tenancy_access | Organizations, users, 10 roles, action permissions (FINANCE-only finance approvals, CLIENT whitelist), memberships, clients, client contacts, projects, project members |
| 0003 | standards | Construction, Planning, EdgeBand, Manufacturing, Pricing and QuotationPolicy standards (each separate); variable registries only, no values |
| 0004 | catalogs | Material, edge band, finish, hardware, appliance, recipe and product versions; per-domain catalog versions with frozen membership |
| 0005 | hettich | Hettich dataset versions, articles and calculation rules (no data) |
| 0006 | rooms_designs | Rooms, survey revisions, designs, design versions with 12 exact pins, objects, overrides, validation runs |
| 0007 | snapshots_files | Six snapshot tables with provenance checks, files, issue records |
| 0008 | approval_transition | Approval requests/decisions and `design_os.transition()` (integrity only) with the lock cascade |
| 0009 | audit | Append-only SHA-256 hash-chained audit log |
| 0010 | rls | Row-level security, default deny, per-family policies |
| 0011 | grants | Least-privilege grants; nothing for anon / authenticated / service_role |

Rules:

- **Local / CI PostgreSQL 17 only** until the Mumbai cut-over gate (M5 §13) is satisfied.
- Never apply these to a hosted Supabase project yet. Never edit schema in a dashboard.
- Test with `DATABASE_URL=postgresql://… pnpm test:db`. This runs up → down → up, the drift check, and the integration tests.
- After an intentional schema change, run `pnpm db:schema:update` and commit `database/schema/design_os.schema.txt`.
