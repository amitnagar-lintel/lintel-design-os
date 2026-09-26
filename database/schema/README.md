# database/schema

`design_os.schema.txt` is a deterministic snapshot of the migrated `design_os` schema, built from the system catalogs by
`tests/db/support/schema-snapshot.ts`. It lists columns, constraints, indexes, triggers, functions, policies and grants.
The drift test fails if the migrations and this file disagree. Regenerate it only with `pnpm db:schema:update`.
