# @lintel/db-tools — database operations (M6 G6, G4, G2)

This is an operator tool for the `design_os` database. It is deployed and run on its own, independently of the API service and of Lintel Ops. It has three commands:

- `db:migrate` — the production migration runner (G6).
- `db:org init` — organization initialisation (G4).
- `db:intake` — the reviewed reference-data intake (G2).

## Connections and Supabase keys

**Migration / operator connection.** The tool connects **only** through `MIGRATION_DATABASE_URL`, and it is never read from the command line.
- It is a **direct Postgres connection**: on Supabase, `postgresql://postgres:…@db.<project-ref>.supabase.co:5432/postgres` with TLS (`sslmode=verify-full` and the Supabase CA).
- **Supabase poolers are refused** for every write command (migrations, `org init`, intake): the transaction-mode pooler (port 6543) and the session-mode pooler (`*.pooler.supabase.com`) alike. Schema migrations need one real session.
- If the deploy environment has no IPv6 route to the direct host, enable Supabase's IPv4 add-on for the project; do not fall back to a pooler.

**API runtime connection (separate).** The API's `DATABASE_URL` is a different URL with a different login role (`design_os_api_login`, NOINHERIT, member of `design_os_api`). It may use the Supavisor transaction pooler (every request is one transaction with `SET LOCAL`). It never has DDL rights and is never used by this tool. Neither URL is ever a Lintel Ops variable.

**Supabase API keys (current model).** Supabase issues *publishable* keys (`sb_publishable_…`, formerly the `anon` key) and *secret* keys (`sb_secret_…`, formerly the `service_role` key).
- The Design OS web app may use only a **publishable** key, for Supabase Auth sign-in.
- A **secret** key is never placed in browser or client code, never in the web app, never in the repository, and never given to the Design OS API: the API verifies Supabase-issued JWTs against the project's JWKS and reaches the database only as `design_os_api`.
- This tool needs no Supabase API key at all: it uses the direct Postgres connection only.

Run the commands with `pnpm -s`, so that stdout carries only the tool's output (use `--json` for automation).

## `pnpm -s db:migrate status [--check] [--json]`

A read-only readout of the target. It writes nothing.

| state | meaning |
|---|---|
| `UNINITIALISED` | no ledger yet (`design_os_migrations.applied` does not exist); every migration is pending |
| `PENDING` | the ledger matches the files; later migrations are not yet applied |
| `UP_TO_DATE` | every migration is applied, and the ledger matches the files exactly |
| `DRIFT` | the ledger and the files disagree: `CHECKSUM_MISMATCH`, `NAME_MISMATCH`, `UNKNOWN_APPLIED` or `OUT_OF_ORDER` |

The readout also reports:
- the server version and the connected user;
- the applied and pending migrations;
- any missing prerequisites.

Exit codes:

| Exit | Meaning |
|---|---|
| 0 | OK |
| 2 | drift |
| 3 | migrations are pending (only with `--check`) |

## `pnpm -s db:migrate up --env <local|ci|staging|production> [--confirm <target>] [--to NNNN] [--dry-run] [--lock-timeout 30s] [--json]`

Applies the pending migrations, forward only, exactly as the files are written.

**Where it may run:**
- **Hosted targets need confirmation.** `--env staging` and `--env production` require `--confirm <target>`.
  - For a Supabase database, the target is the project ref, taken from `db.<ref>.supabase.co` or from the pooler user `postgres.<ref>`.
  - For any other server, the target is `host:port/database`.
- **`local` / `ci` never accept a hosted Supabase URL.**

**Refusals before anything is written:**
- any drift;
- a database without the Supabase prerequisites: `auth.users` and `auth.uid()`.

The runner never creates what Supabase provides. The CI stand-ins in `database/bootstrap/` are test-only.

**How each migration is applied:**
- Each migration runs in its own transaction, together with its ledger row (version, name, SHA-256 of the up file).
- A failing migration rolls back completely. Earlier migrations stay committed. The runner reports the version, the SQLSTATE and the message.
- Every transaction first takes a transaction-scoped advisory lock and re-reads the ledger. Concurrent runners therefore apply each migration exactly once.
- `lock_timeout` defaults to 30 s, so a migration never waits forever on a busy table.

Exit codes:

| Exit | Meaning |
|---|---|
| 0 | applied, or nothing to do |
| 1 | a migration failed (rolled back) |
| 2 | drift (nothing applied) |
| 4 | refused (guard or prerequisites) |
| 64 | usage |

**Rollback.** Rollback is **not** a runner command. The `*.down.sql` files are proven in CI and are only for emergencies, after a fresh `pg_dump`. Production data is corrected forward, through an approved successor (M5 §14).

## `pnpm -s db:org init --env <env> [--confirm <target>] --code <CODE> --name <name> --admin-email <email> --admin-name <name> --operator <who> [--json]`

This is the one operation that needs no existing member. It does two things:

1. Creates the organization. Its role → action grants are seeded from the default grants by the existing 0002 trigger.
2. Creates a **PENDING invitation** for its first ADMIN.

**How it runs:**
- It runs as `design_os_owner` in one transaction.
- It is audited with the reason `organization initialised by operator <who>`.
- It runs only on a database whose migrations are `UP_TO_DATE`.

**Idempotent.** Running it again reports the current state:

| Outcome | When |
|---|---|
| `INVITATION_PENDING` | an ADMIN invitation is still open |
| `ALREADY_INITIALISED` | an ADMIN is active |
| `REFUSED` | the name conflicts, or an open ADMIN invitation exists for another email |

If the organization exists but has no active ADMIN, the command writes a new ADMIN invitation, and any expired one is closed first.

**What happens next.** The named person signs in through Supabase Auth with that email, with a verified email address. They then accept with `POST /api/v1/me/invitations/{id}/accept`. Everyone after them is invited by an ADMIN through the API (`POST /api/v1/org/invitations`).

## `pnpm -s db:intake …` — reviewed reference-data intake (G2)

One intake file = one new DRAFT version of one entity. The file names its type, classification (`PRODUCTION`; `TEST_FIXTURE` is refused), intent, entity code, version number, change reason, source and source reference, and carries the existing domain object as `data` (e.g. a `ConstructionStandard`). See `docs/architecture/M6-CP2-REFERENCE-DATA.md` for the format and every check.

| Command | What it does | Exit |
|---|---|---|
| `validate --file f.json [--json]` | Offline report: schema, TEST_FIXTURE, identity, lifecycle, provenance, completeness (UNVERIFIED items), duplicates | 0 accepted · 5 refused |
| `import --file f.json --env <env> [--confirm <target>] --org <CODE> --as <author email> --operator <who> [--dry-run] [--json]` | Writes the DRAFT version as the named author through RLS (audited). Same file again → `UNCHANGED`; `--dry-run` → `WOULD_CREATE`, nothing written | 0 · 4 refused · 5 invalid |
| `status --org <CODE> --type <t> --entity <CODE> --version <n> [--json]` | Read-only: lifecycle, content hash, the database's approval problems | 0 |
| `submit --env … --org … --type … --entity … --version … --as <author email> --operator … --reason …` | SUBMIT through `design_os.transition()`; refused while the version is incomplete | 0 · 4 |
| `approve … --as <approver email> --expected-content-hash <sha256:…>` | APPROVE through `design_os.transition()`: the database enforces the approve action, approver ≠ submitter and the reviewed hash | 0 · 4 |

The tool never marks anything APPROVED itself and never writes as the owner: imports run as the named author under row-level security, and lifecycle changes go only through `transition()`.

## Not yet

Hosted Supabase is **not** connected in M6 checkpoint 1. The gate item 9 compatibility check runs on the separate staging project (OD-M6-2), and only after the reviewer approves hosted access (M6 gate M6-6).
