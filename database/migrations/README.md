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
| 0012 | error_codes_output_purpose | SQLSTATE class `LD` on every `RAISE`, `design_os.error_code` registry, coded approval problems (`approval_problem_items`); output purposes PRELIMINARY / FOR_REVIEW / FOR_PRODUCTION per snapshot kind (`output_purpose_rule`), only FOR_PRODUCTION can be issued |
| 0013 | idempotency_context | `current_memberships()` (own ACTIVE org ids from `auth.uid()`), `current_org_id()` with the same ACTIVE-organization rule (INACTIVE status added), `idempotency_record` with `UNIQUE (org_id, scope, idempotency_key)`, `claim_idempotency()` / `complete_idempotency()` |
| 0014 | idempotency_scopes | Idempotency scopes for the core design API creates without a natural key (rooms, room revisions, designs, design versions, relationship overrides) |
| 0015 | product_catalog_object_guard | Every design object's exact product version stays a member of its DesignVersion's pinned product catalog version: refused when the pin changes or when catalog membership changes (LD019) |
| 0016 | engine_build_provenance | validation_run.engine_build: the immutable engine build identity (Git commit SHA / build revision) required on every new run; record_validation_run() takes it |
| 0017 | output_provenance | Output model: engineering-only design versions (commercial / manufacturing versions chosen per output); validation-run purposes APPROVAL / OUTPUT_GENERATION; DB-computed dependency content hashes; per-engine snapshot provenance, sources, natural identity; one-to-many sealed drawing files; FOR_REVIEW from SUPERSEDED; issuing a quotation locks its commercial versions |
| 0018 | issue_finalization | Issue records as complete decision records (project, design version, revision, content hash, exact commercial versions / file manifest), derived and verified by `check_issue`; issue requires LOCKED design, current inputs and dependency content, 0 BLOCKERs in output and evidence; LD027 ALREADY_ISSUED; unique quotation revision / drawing number + revision; CLIENT reads issue records of own projects only |
| 0019 | org_onboarding | Internal-user onboarding (M6 G4): `org_invitation` (named person, email, INTERNAL roles, PENDING / ACCEPTED / REVOKED, expiry; one PENDING per org and email); RLS lets an administrator (`org.members.manage`) invite and revoke, and lets the signed-in person whose Supabase Auth email matches create their own INTERNAL `app_user` and exactly the invited memberships (granted by the inviter). Declarative only: no new trigger or PL/pgSQL |
| 0020 | readiness_audit | Readiness and audit read (M6 G7): the API role may read the migration ledger; `audit_chain_status()` (hash-chain verification of the caller's own organization, `audit.read`) and `reference_approval_problems()` (the existing approval preconditions of a reference version of the caller's organization, `reference.read`). Grants and SQL wrappers only |

Rules:

- **Local / CI PostgreSQL 17 only** until the Mumbai cut-over gate (M5 §13) is satisfied. Gate item 9 is the hosted Supabase compatibility
  check: ownership / role model, the `auth.users` REFERENCES grant, SECURITY DEFINER behaviour, RLS behaviour, extensions / functions, and
  migration permissions.
- Never apply these to a hosted Supabase project yet. Never edit schema in a dashboard.
- Hosted environments are migrated only with the production migration runner (`pnpm -s db:migrate`, apps/db-tools, M6 G6), which
  records every migration in `design_os_migrations.applied` and refuses on any drift. See `apps/db-tools/README.md`.
- Test with `DATABASE_URL=postgresql://… pnpm test:db`. This runs up → down → up, the drift check, and the integration tests.
- After an intentional schema change, run `pnpm db:schema:update` and commit `database/schema/design_os.schema.txt`.
