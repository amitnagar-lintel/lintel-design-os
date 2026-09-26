# Pilot blockers — human-only dependencies

Status 2026-09-26. The pilot runs end-to-end **technically**, on LOCAL rehearsal data only (`pnpm pilot:rehearse`, and the UI through `pnpm pilot:demo`). The real pilot, with real Lintel data and a real client, is blocked **only** by the items below. Each needs a person, a decision or business data; none needs more engineering to start.

Every blocker is laid out the same way: **Blocker · Why it blocks · What Amit must provide · Next action · Where work resumes.**

---

## B1 — Lintel production reference data does not exist yet (every value NULL / DRAFT)

**Blocker.** None of the 19 reference-data files the pilot needs holds approved Lintel values:
- the generated templates `docs/pilot/intake-templates/01…19` contain **62 values flagged NULL**;
- items 17 and 09 need content the templates cannot list value by value (below).

**Why it blocks.** Each of these refuses without APPROVED / LOCKED reference data:
- a DesignVersion must pin APPROVED / LOCKED engineering data;
- a FOR_PRODUCTION output needs 0 BLOCKERs;
- pricing and quotation need an APPROVED PricingStandard and QuotationPolicy.

The engines refuse to invent values, so with NULL data every output is BLOCKED or UNAVAILABLE.

**What Amit must provide.** Each value must come with its **source document** (title, date) and an **evidence reference**:

| File | Values |
|---|---|
| 01 Construction standard | BACK_GROOVE_DEPTH, BACK_REAR_OFFSET, TOP_RAIL_WIDTH, SHELF_FRONT_SETBACK, SHELF_SIDE_CLEARANCE, OVERLAY_EDGE_GAP, OVERLAY_TOP_GAP, OVERLAY_BOTTOM_GAP, FRONT_BETWEEN_GAP, INSET_GAP, FRONT_FINISHED_FACES, SHUTTER_BACK_GAP (mm) |
| 02 Planning standard | MIN_WALL_CLEARANCE, MIN_CABINET_GAP, MAX_GAP_WITHOUT_FILLER, FILLER_THRESHOLD, MAX_RUN_LENGTH, SERVICE_VOID_REAR (mm) |
| 03–05 Boards | BWP 18: density. HDHMR 18: sheet size, grain, density. Back 6 mm: substrate, sheet size, grain, density |
| 06–07 Edge bands | Width of the 2 mm and 0.8 mm ABS bands |
| 08 Finish | Confirm LAMINATE_WHITE, 1 mm |
| 09 Edge-band standard | For rule set CARCASS_STANDARD, which edges (FRONT / BACK / TOP / BOTTOM / LEFT / RIGHT) of each component get which band: SIDE_LEFT, SIDE_RIGHT, BOTTOM, TOP_SUPPORT_FRONT, TOP_SUPPORT_BACK, BACK, SHELF, SHUTTER. Write `{}` for "no banding" |
| 10–11, 13–16 | Confirm the hinge rule set, the KITCHEN_BASE_STANDARD_V1 recipe and the four catalog member lists as they are |
| 12 Product KIT_BASE_STANDARD | Min and max of width, height, depth, carcass thickness and back thickness; max shelf count; max shutter count |
| 17 Hettich dataset | One complete record per article actually used, from official Hettich sources: the full-overlay hinge, the inset hinge (if inset fronts are offered) and the mounting plate. Each record needs:<br>• article number, family, category, description, application and mounting;<br>• door-thickness range and opening angle;<br>• compatible articles;<br>• drilling pattern and holes, with source;<br>• installation guide, adjustment ranges and dimensions;<br>• accessories, CAD reference (hettich.com URL), source URL and date;<br>• licence (OFFICIAL_PUBLIC or AUTHORISED), verifiedBy, verifiedAt, preference rank.<br>Plus one hinge **quantity rule**: door-height bands → hinge count, with its source. Template fields: `docs/catalog/production-data/04-hardware-standards.md` |
| 18 Pricing standard | Rates (INR, paise) per m² for BOARD_BWP_18, BOARD_HDHMR_18, BOARD_BACK_6 and LAMINATE_WHITE; per metre for EDGE_ABS_2MM and EDGE_ABS_0_8MM; **per unit for every Hettich article in 17**, keyed `HETTICH:<article>`. Pricing rules: manufacturing-cost formula, wastage % (board, edge band, finish), overhead %, margin basis (MARKUP_ON_COST or MARGIN_ON_PRICE), margin %, GST % |
| 19 Quotation policy | Tax rates (code → %); the tax rate for product category KITCHEN_BASE; tax policy (PER_LINE or PER_RATE_GROUP); rounding of tax and of the grand total (mode + increment in paise); discount policy (NONE unless decided) |

**Next action.**
1. Fill a copy of each template and set `intent` to `PRODUCTION_CANDIDATE`.
2. Fill `sourceRef.documentTitle` and `sourceRef.sourceDate`.
3. Run `pnpm -s db:intake validate --file <file>` until it prints `ACCEPTED`.
4. Import, submit and approve each file in number order (commands in `docs/PILOT-TOMORROW.md` §E).

**Where work resumes.** `pnpm -s db:intake validate`, then `pnpm pilot:check --org <LINTEL CODE>`. The `data.*` checks turn PASS one by one.

---

## B2 — Named people per role (approval separation)

**Blocker.** Nobody is named yet for the author and approver roles. The database refuses an approval by the author of the record.

**Why it blocks.** Every reference-data file needs two different people: an author (import + submit) and an approver. The design needs a designer to submit and a design head to approve.

**What Amit must provide.** A name and work email for each role. **Minimum is 3 different people**, assigned like this:

| Person | Roles |
|---|---|
| Person 1 | ADMIN, DESIGN_HEAD, FINANCE |
| Person 2 | PRODUCTION, COSTING, DESIGNER |
| Person 3 | PROCUREMENT, SALES, SITE_ENGINEER |

The author → approver pairs this satisfies:

| Records | Author → approver |
|---|---|
| Construction, planning and edge-band standards | PRODUCTION (P2) → DESIGN_HEAD (P1) |
| Pricing standard, quotation policy | COSTING (P2) → FINANCE (P1) |
| Materials, edge bands, finishes, material and finish catalogs | PROCUREMENT (P3) → DESIGN_HEAD (P1) |
| Hinge rule set, hardware catalog, Hettich dataset | PROCUREMENT (P3) → PRODUCTION (P2) |
| Recipe, product, product catalog | DESIGN_HEAD (P1) → PRODUCTION (P2) |
| Design | DESIGNER (P2) submits → DESIGN_HEAD (P1) approves |

In the pilot workflow itself:
- P3 creates the project, surveys the room and issues the quotation.
- P2 generates pricing and the quotation.
- P1 issues the drawings.

**Next action.** Send the list. Each person then creates a Supabase Auth account on the pilot project (see B3).

**Where work resumes.**
- `pnpm -s db:org init` for the first ADMIN;
- invitations: `POST /api/v1/org/invitations` (the ADMIN's token), or the UI Project screen once signed in.

---

## B3 — Hosted Supabase: gates M6-5, M6-6, M6-7 (and M6-8, M6-11 for production)

**Blocker.** There is no approved connection to a hosted Supabase project:
- the staging project is not created;
- ops gate items 1–8 are not confirmed;
- production is not migrated.

**Why it blocks.** Real sign-in needs Supabase Auth: the database reads a person's email from `auth.users`, and the API verifies their token with the project's JWKS. Approvals of real data must be made by real, authenticated people. The LOCAL demo mints its own tokens, so it can only ever hold rehearsal data.

**What Amit must provide:**
1. **M6-5.** The ops owner's dated confirmation of Mumbai gate items 1–8 (plan §1.1).
2. **M6-6.** Explicit approval to connect to hosted Supabase, and creation of a **separate** Design OS staging project in Mumbai (OD-M6-2). Send its project ref.
3. **Staging API settings, in the host's secret store** (never in the repository or chat):
   - the direct Postgres connection string (`db.<ref>.supabase.co:5432`) for `MIGRATION_DATABASE_URL`;
   - the API's login role connection for `DATABASE_URL`;
   - `AUTH_ISSUER` = `https://<ref>.supabase.co/auth/v1`;
   - `AUTH_JWKS_URL` = `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`.
4. **The UI build:** the project URL and **publishable** key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
5. **After staging passes (M6-7, M6-8):** the same for the production project, plus PITR enabled and a restore drill (M6-11).

**Next action.** Approve M6-6 and create the staging project. Engineering then runs, on staging:
1. `pnpm -s db:migrate up --env staging --confirm <ref>`;
2. gate item 9 (plan §1.2);
3. `PILOT_ENV=STAGING pnpm pilot:check --confirm <ref> --org <CODE>`.

**Where work resumes.** `pnpm -s db:migrate status`, with `MIGRATION_DATABASE_URL` set to the staging direct connection.

---

## B4 — Supabase Storage credential decision (CP5)

**Blocker.** Supabase Storage needs a server-side secret key (`sb_secret_…`) in the API. Its S3 keys would instead need a SigV4 signer. The M6 plan said "no secret key in the API".

**Why it blocks.** Hosted file storage cannot be switched on without that key: issued PDFs on the hosted API. Until then, the API stores files on its own disk (`FILE_STORAGE=local`).

**What Amit must provide.** Choose one (details in `docs/architecture/M6-CP5-SUPABASE-STORAGE.md`):
- **(a)** Allow one secret key in the API, used for Storage only, kept in the host secret store and rotated after the pilot.
- **(b)** Require S3 keys with a SigV4 signer. This is about one more engineering day.

**Next action.**
- **(a):** create the private bucket `design-os-outputs` on staging and put the key in the staging secret store.
- **(b):** ask engineering for the signer.

**Where work resumes.** On staging, with `FILE_STORAGE=supabase`: generate a drawing, then `GET /api/v1/files/{id}/url` (CP5 doc, "What remains", steps 1–3).

---

## B5 — Quotation document format

**Blocker.** No backend quotation PDF renderer exists. The UI prints the issued quotation from its stored snapshot: lines, tax groups and totals as stored.

**Why it blocks.** Only if the client must receive a Lintel-branded quotation PDF produced by the system. Drawings are real PDF files and are not affected.

**What Amit must provide.** Say whether the browser-printed quotation (saved as PDF from the print dialog) is acceptable for the pilot. If it is not, provide the required quotation layout: letterhead, terms, bank details, validity.

**Next action.** If the print is acceptable, nothing. Otherwise, a quotation PDF renderer is a new engineering task.

**Where work resumes.** UI, screen 8 "Issue", then "Print quotation".

---

## Not blockers (already done or deliberately out of scope)

- **Done:**
  - migrations 0001–0020 and the migration runner;
  - organization onboarding;
  - the reference-data read API and the intake CLI (with authenticated approvers);
  - readiness and audit, Sentry, rate limits;
  - the resolved-model preview;
  - the Supabase Storage adapter;
  - `pilot:check`, `pilot:demo`, `pilot:rehearse`, `pilot:templates`;
  - the eight-screen UI;
  - the LOCAL end-to-end rehearsal with real engines and 0 BLOCKERs.
- **Out of pilot scope:**
  - client portal (issued PDFs are delivered offline);
  - wall and tall cabinets, openings;
  - manufacturing, CNC, nesting and drilling release.
