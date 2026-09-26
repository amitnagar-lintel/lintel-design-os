# Pilot tooling and the LOCAL technical rehearsal

Status: implemented (M6 STEP 5 and STEP 6). The commands run from the repository root.

## 1. Commands

| Command | Where | What it does |
|---|---|---|
| `pnpm pilot:check [--org <CODE>] [--confirm <ref>] [--json]` | any environment, **read-only** | Classifies the environment and checks everything the pilot needs. Exit 0 = READY; 4 = not ready or refused. |
| `pnpm pilot:demo [--reset] [--rehearse] [--no-web]` | **LOCAL only** | Sets up and runs the local demo (steps below) until Ctrl-C. |
| `pnpm pilot:rehearse` | **LOCAL only** | Same as `pilot:demo --reset --rehearse --no-web`, then exits. |
| `pnpm pilot:templates` | offline | Regenerates `docs/pilot/intake-templates/`: the production intake files, with NULL where a value is still missing. |

**What `pilot:check` checks:**
- the environment classification;
- the database connection and the migration ledger;
- the organization and its ADMIN;
- every required reference type (at least one APPROVED or LOCKED version);
- rehearsal-data isolation;
- `GET /api/v1/ready`, plus `GET /api/v1/readiness` when `PILOT_ACCESS_TOKEN` is given (the local demo's ADMIN token is used automatically);
- the UI, and UI → API connectivity through the UI's `/api` proxy.

**What `pilot:demo` does:**
1. Creates the disposable database `lintel_rehearsal` and applies all migrations.
2. Starts the API and the UI.
3. Onboards one person per role through the API.
4. Loads and approves the rehearsal dataset through the intake CLI.
5. Writes one access token per person to `.pilot/tokens/<ROLE>.txt`.

| Variable | Default | Meaning |
|---|---|---|
| `PILOT_ENV` | `LOCAL` | `LOCAL`, `STAGING` or `PRODUCTION` |
| `PILOT_POSTGRES_URL` | `postgresql://postgres@127.0.0.1:5432/postgres` | Local admin connection. Loopback only; used by demo and rehearse |
| `MIGRATION_DATABASE_URL` | LOCAL: the demo database | The direct connection of the checked environment |
| `PILOT_API_URL`, `PILOT_WEB_URL` | `http://127.0.0.1:3000`, `http://127.0.0.1:5173` | The API and the UI |
| `PILOT_ACCESS_TOKEN` | LOCAL: `.pilot/tokens/ADMIN.txt` | An ADMIN / DESIGN_HEAD / FINANCE access token for `/readiness` |

## 2. Never production by accident

- **Unset `PILOT_ENV` means LOCAL.** LOCAL refuses any database, API or UI URL that is not on this machine.
- **STAGING and PRODUCTION need `--confirm <project ref>`**, which must match the database, exactly like the migration runner. They also need a direct (non-pooler) connection and non-loopback API / UI URLs.
- **`pilot:demo` and `pilot:rehearse` run only on a loopback database named `lintel_rehearsal*`** (`assertRehearsalDatabase`).
- **Outside LOCAL, `pilot:check` fails BLOCKING** if the rehearsal organization or any rehearsal-marked reference version exists.
- **A test keeps the rehearsal marker** inside `apps/db-tools/src/pilot`, tests and docs.

## 3. The rehearsal dataset: synthetic, LOCAL only

TEST_FIXTURE data can never be stored: the database CHECKs, the persistence mappers and the intake validator all refuse it. The rehearsal therefore uses the repository's in-code engine objects, re-stated as 19 intake files under the marker `LOCAL REHEARSAL ONLY`:
- the KIT_BASE_STANDARD recipe and product;
- the catalog materials, edge bands and finish;
- the values of the TEST_FIXTURE construction, planning, edge-band, Hettich, pricing and quotation fixtures.

A few values the repository leaves NULL are filled with obvious rehearsal placeholders:
- material sheet size, grain and density;
- edge-band width;
- product parameter limits;
- Hettich source URLs of the form `https://www.hettich.com/local-rehearsal-synthetic-not-a-hettich-record`.

**These are not Lintel, Hettich or supplier values.** They exist only so the real intake, approval workflow, engines and API can be proven end-to-end. The rehearsal organization is `LOCAL-REHEARSAL`.

## 4. What the rehearsal proves (`pnpm pilot:rehearse`, and the DB test `apps/api/test/db/pilot-rehearsal.test.ts`)

**1. Onboarding.** Organization init, then the ADMIN invites 8 more people, who accept through the API.

**2. Reference data.** 19 intake files go through import → submit (author) → approve, by a different person whose access token is verified. For example: PRODUCTION authors and DESIGN_HEAD approves; COSTING authors and FINANCE approves.

**3. The pilot workflow**, all through the API with the real engines:
1. SALES creates the client and the project.
2. The SITE_ENGINEER records the rectangular kitchen survey: 4200 × 3200 × 3000, 150 mm walls, no openings.
3. The DESIGNER creates the design and a DesignVersion pinned to the APPROVED data.
4. The DESIGNER adds three KIT_BASE_STANDARD cabinets (600 / 750 / 600) as one run on wall A.
5. The resolved model shows **0 BLOCKERs**.
6. The APPROVAL validation run shows **0 BLOCKERs**.
7. The DESIGNER submits, the DESIGN_HEAD approves (with the reviewed hash), and SALES locks.
8. FOR_PRODUCTION outputs are generated: BOM, BOQ, Pricing, Quotation, the wall A internal elevation and the room panel schedule.
9. SALES issues the quotation; the DESIGN_HEAD issues both drawings.
10. The PDFs are downloaded through signed URLs, and their SHA-256 matches the stored checksum.

**4. Consistency.** The run fails unless all of these hold:
- every output names the same DesignVersion;
- every output was made from the LOCKED version, with the same content hash and the same engineering input hash;
- every output uses the exact pins, the same engineering dependency content hashes, and OUTPUT_GENERATION evidence with 0 BLOCKERs;
- every output resolved the same room as the resolved-model preview;
- the quotation uses the exact PricingStandard and QuotationPolicy versions;
- no output has BLOCKERs;
- the quotation and the drawings qualify for issue.

**Outputs.** The report is written to `.pilot/rehearsal-report.json` and the PDFs to `.pilot/rehearsal-pdfs/`. `.pilot/` is git-ignored.

## 5. What it does not prove

- **Lintel's real values.** Every production value is still NULL / unapproved; see `docs/PILOT-BLOCKERS.md`.
- **Hosted Supabase:** Auth sign-in, Storage and the pooler. Locally, Supabase Auth sign-up is stood in by the CI `auth.users` stub, and tokens are minted with a per-machine secret in `.pilot/local-secrets.json`.
