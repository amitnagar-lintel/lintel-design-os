# Pilot operational guide — the first real Lintel project

**The single operational guide for the V1 pilot.** Status 2026-09-27, main `92c3ca9`. Remaining blockers: `docs/PILOT-BLOCKERS.md` (B1–B4).

**Pilot scope (frozen):**
- a rectangular kitchen with no openings;
- base cabinets only (`KIT_BASE_STANDARD`);
- the chain Project → Room → Design → DesignVersion → Validation → BOM → BOQ → Pricing → Quotation → Drawings → Issue;
- the quotation PDF and drawing PDFs, delivered to the client offline.

**Not in scope:** wall or tall cabinets, irregular rooms, manufacturing / CNC, client portal, advanced CAD.

**Rules that never bend:**
- **No invented values.** No Lintel production value is invented, defaulted or copied from test data. Every value comes from a named source document, and a second person approves it.
- **Every pin approved.** A DesignVersion can be **approved** only when **all 8 engineering datasets it pins are APPROVED or LOCKED** (§2).
- **Separation of duties.** The author of a record can never approve it. Approvals are made with the approver's own Supabase Auth sign-in.

---

## 0. Who provides what

| Who | Provides | Where it is used |
|---|---|---|
| **Amit** | The 3 people and their roles (§3) | §3, B2 |
| **Amit** | Approval of hosted access (gate M6-6) and the ops owner's dated confirmation of gate items 1–8 (M6-5) | §4, B3 |
| **Amit** | The storage credential decision: option (a) or (b) (§5) | §5, B4 |
| **Production team** (PRODUCTION / DESIGN_HEAD) | Construction values, planning values, product limits, edge-band rules, recipe confirmation, with source documents | §1 files 01, 02, 09, 11, 12 |
| **Procurement** (PROCUREMENT) | Board, edge-band and finish properties; Hettich records from official Hettich sources | §1 files 03–08, 10, 13–15, 17 |
| **Costing** (COSTING), approved by **Finance** (FINANCE) | Rates, pricing rules, tax rates, rounding, discount policy | §1 files 18, 19 |
| **Engineering** | Staging and production setup, migrations, deployment, readiness checks | §4–§6 |

---

## 1. Real Lintel reference-data intake

**Templates.** The templates are `docs/pilot/intake-templates/01…19-*.json`. Every value still missing is listed per file in `docs/pilot/intake-templates/README.md` (62 NULL values). Beyond those 62, three items need content the templates cannot list value by value:
- the Hettich records and the hinge quantity rule (17);
- the edge rules for 8 component types (09);
- one per-unit rate per Hettich article (18).

**Preparing one file:**
1. Copy the template to a working folder **outside the repository**.
2. Replace every `null` with the sourced value.
3. Set `"intent": "PRODUCTION_CANDIDATE"`.
4. Set `sourceRef.documentTitle` and `sourceRef.sourceDate` (YYYY-MM-DD).
5. Files 01 and 02 only: fill `provenance.<VARIABLE>.source` and `.evidenceRef` for every value.
6. Validate offline (no database needed) until it prints `ACCEPTED`:
   ```sh
   pnpm -s db:intake validate --file <file>
   ```

**What each file needs:**

| # | File | Type (`--type`) | Entity (`--entity`) | Values to provide | Author → approver | Stage |
|---|---|---|---|---|---|---|
| 01 | `01-construction_standard-LINTEL_CONSTRUCTION_STANDARD.json` | construction_standard | LINTEL_CONSTRUCTION_STANDARD | 12 mm values: BACK_GROOVE_DEPTH, BACK_REAR_OFFSET, TOP_RAIL_WIDTH, SHELF_FRONT_SETBACK, SHELF_SIDE_CLEARANCE, OVERLAY_EDGE_GAP, OVERLAY_TOP_GAP, OVERLAY_BOTTOM_GAP, FRONT_BETWEEN_GAP, INSET_GAP, FRONT_FINISHED_FACES, SHUTTER_BACK_GAP; each with source + evidence | PRODUCTION → DESIGN_HEAD | A |
| 02 | `02-planning_standard-LINTEL_PLANNING_STANDARD.json` | planning_standard | LINTEL_PLANNING_STANDARD | 6 mm values: MIN_WALL_CLEARANCE, MIN_CABINET_GAP, MAX_GAP_WITHOUT_FILLER, FILLER_THRESHOLD, MAX_RUN_LENGTH, SERVICE_VOID_REAR; each with source + evidence | PRODUCTION → DESIGN_HEAD | A |
| 03 | `03-material-BOARD_BWP_18.json` | material | BOARD_BWP_18 | density | PROCUREMENT → DESIGN_HEAD | B |
| 04 | `04-material-BOARD_HDHMR_18.json` | material | BOARD_HDHMR_18 | sheet size, grain, density | PROCUREMENT → DESIGN_HEAD | B |
| 05 | `05-material-BOARD_BACK_6.json` | material | BOARD_BACK_6 | substrate, sheet size, grain, density | PROCUREMENT → DESIGN_HEAD | B |
| 06 | `06-edge_band-EDGE_ABS_2MM.json` | edge_band | EDGE_ABS_2MM | width | PROCUREMENT → DESIGN_HEAD | B |
| 07 | `07-edge_band-EDGE_ABS_0_8MM.json` | edge_band | EDGE_ABS_0_8MM | width | PROCUREMENT → DESIGN_HEAD | B |
| 08 | `08-finish-LAMINATE_WHITE.json` | finish | LAMINATE_WHITE | confirm (1 mm) + source | PROCUREMENT → DESIGN_HEAD | B |
| 09 | `09-edge_band_standard-LINTEL_EDGE_BAND_STANDARD.json` | edge_band_standard | LINTEL_EDGE_BAND_STANDARD | Rule set CARCASS_STANDARD: for SIDE_LEFT, SIDE_RIGHT, BOTTOM, TOP_SUPPORT_FRONT, TOP_SUPPORT_BACK, BACK, SHELF and SHUTTER, which edges (FRONT / BACK / TOP / BOTTOM / LEFT / RIGHT) get which band; `{}` = none | PRODUCTION → DESIGN_HEAD | B |
| 10 | `10-hardware_rule_set-HINGE_STANDARD.json` | hardware_rule_set | HINGE_STANDARD | confirm + source | PROCUREMENT → PRODUCTION | B |
| 11 | `11-construction_recipe-KITCHEN_BASE_STANDARD_V1.json` | construction_recipe | KITCHEN_BASE_STANDARD_V1 | confirm + source | DESIGN_HEAD → PRODUCTION | A (needed by 12) |
| 12 | `12-product-KIT_BASE_STANDARD.json` | product | KIT_BASE_STANDARD | min / max of width, height, depth, carcass thickness, back thickness; max shelf count; max shutter count; confirm defaults | DESIGN_HEAD → PRODUCTION | A |
| 13 | `13-material_catalog-LINTEL_MATERIAL_CATALOG.json` | material_catalog | LINTEL_MATERIAL_CATALOG | confirm members | PROCUREMENT → DESIGN_HEAD | B |
| 14 | `14-finish_catalog-LINTEL_FINISH_CATALOG.json` | finish_catalog | LINTEL_FINISH_CATALOG | confirm members | PROCUREMENT → DESIGN_HEAD | B |
| 15 | `15-hardware_catalog-LINTEL_HARDWARE_CATALOG.json` | hardware_catalog | LINTEL_HARDWARE_CATALOG | confirm members | PROCUREMENT → PRODUCTION | B |
| 16 | `16-product_catalog-LINTEL_PRODUCT_CATALOG.json` | product_catalog | LINTEL_PRODUCT_CATALOG | confirm members | DESIGN_HEAD → PRODUCTION | B |
| 17 | `17-hettich_dataset-HETTICH_PRODUCTION.json` | hettich_dataset | HETTICH_PRODUCTION | One complete record per article used, from official Hettich sources (hettich.com URLs, licence OFFICIAL_PUBLIC or AUTHORISED): the full-overlay hinge, the inset hinge (if inset fronts are offered) and the mounting plate. Plus the hinge quantity rule (door-height bands → count). Field list: `docs/catalog/production-data/04-hardware-standards.md` | PROCUREMENT → PRODUCTION | B |
| 18 | `18-pricing_standard-LINTEL_PRICING_STANDARD.json` | pricing_standard | LINTEL_PRICING_STANDARD | Rates in paise: per m² for the 3 boards and LAMINATE_WHITE; per metre for the 2 edge bands; per unit `HETTICH:<article>` for each article in 17. Rules: manufacturing-cost formula, wastage % (board / edge band / finish), overhead %, margin basis, margin %, GST % | COSTING → FINANCE | C |
| 19 | `19-quotation_policy-LINTEL_PRODUCTION_QUOTATION_POLICY.json` | quotation_policy | LINTEL_PRODUCTION_QUOTATION_POLICY | tax rates (code → %); tax rate for KITCHEN_BASE; tax policy; rounding of tax and grand total (mode + increment in paise); discount policy | COSTING → FINANCE | C |

**Stages:**
- **A** — the values that drive geometry and every validation check.
- **B** — completes the pinned catalogs and Hettich, and makes the production BOM possible.
- **C** — needed only for pricing, the quotation and quotation issue.

**The first design approval needs A and B.**

**Commands for one file.** Run these from the repository root, against the target environment (§4 / §6), after the organization and people exist (§3). The author must be an active member holding the author role:
```sh
export MIGRATION_DATABASE_URL='<direct connection, from the secret store>'
export AUTH_ISSUER=https://<ref>.supabase.co/auth/v1
export AUTH_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
ENV=production; REF=<project ref>; ORG=LINTEL

# 1. the author imports and submits
pnpm -s db:intake import --file <file> --env $ENV --confirm $REF --org $ORG --as <author email> --operator "<your name>"
pnpm -s db:intake submit --env $ENV --confirm $REF --org $ORG --type <type> --entity <ENTITY> --version 1 --as <author email> --operator "<your name>" --reason "<source document, why>"

# 2. read the content hash the approver will approve
pnpm -s db:intake status --org $ORG --type <type> --entity <ENTITY> --version 1

# 3. the approver (a different person) signs in and saves their own access token (valid about 1 hour)
curl -s -X POST "https://$REF.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <publishable key>" -H "content-type: application/json" \
  -d '{"email":"<approver email>","password":"<their password>"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).access_token))' > approver.token

# 4. the approver approves exactly the reviewed content
pnpm -s db:intake approve --env $ENV --confirm $REF --org $ORG --type <type> --entity <ENTITY> --version 1 \
  --access-token-file approver.token --operator "<your name>" --reason "<why>" --expected-content-hash <sha256:… from step 2>
rm approver.token
```

If an approval is refused, `db:intake status` lists the database's exact reason under `PROBLEM`, for example a dependency that is not yet approved.

---

## 2. Approval sequence of the 8 engineering datasets

A DesignVersion pins exactly these 8. **Each must be APPROVED before the design can be approved.** Approve the members first; a catalog can be approved only after every member it lists.

| Order | Engineering dataset (pinned) | Approve first (members / dependencies) | Stage |
|---|---|---|---|
| 1 | Construction standard (01) | none | A |
| 2 | Planning standard (02) | none | A |
| 3 | Product catalog (16) | recipe 11 → product 12 | A (11, 12) + B (16) |
| 4 | Material catalog (13) | boards 03, 04, 05; edge bands 06, 07 | B |
| 5 | Edge-band standard (09) | edge bands 06, 07 | B |
| 6 | Finish catalog (14) | finish 08 | B |
| 7 | Hardware catalog (15) | hinge rule set 10 | B |
| 8 | Hettich dataset (17) | none | B |

**The full import order:**

01 → 02 → 11 → 12 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 13 → 14 → 15 → 16 → 17 → 18 → 19.

**Check after each stage:** `pnpm pilot:check` (§6). Each `data.<type>` line turns PASS.

---

## 3. Organization and user setup

**1. People (Amit decides; B2).** Three different people, so that no author ever approves their own record:

| Person | Roles |
|---|---|
| Person 1 | ADMIN, DESIGN_HEAD, FINANCE |
| Person 2 | PRODUCTION, COSTING, DESIGNER |
| Person 3 | PROCUREMENT, SALES, SITE_ENGINEER |

These roles satisfy every author → approver pair in §1:

| Records | Author → approver |
|---|---|
| Standards | P2 → P1 |
| Materials, finishes, material and finish catalogs | P3 → P1 |
| Hardware, Hettich | P3 → P2 |
| Recipe, product, product catalog | P1 → P2 |
| Pricing, quotation policy | P2 → P1 |
| Design | P2 submits → P1 approves |

**2. Supabase Auth accounts.** In the Supabase dashboard of the environment, open **Authentication → Users** and create or invite each person with their work email. Each person confirms their email and sets a password.

**3. The organization and first ADMIN.** Run once per environment:
```sh
pnpm -s db:org init --env production --confirm $REF --code LINTEL --name "Lintel" \
  --admin-email <Person 1 email> --admin-name "<Person 1 name>" --operator "<your name>"
```

**4. Accepting invitations:**
1. Person 1 signs in to the pilot UI. Screen 2 then works for them; the ADMIN invitation is accepted through the API, `POST /api/v1/me/invitations/{id}/accept`.
2. Person 1 invites Persons 2 and 3 with their roles: `POST /api/v1/org/invitations` with `{email, displayName, roles[]}`.
3. Each person signs in and accepts.

**5. Check:** `pnpm pilot:check --org LINTEL` shows `data.organization PASS` (1 active ADMIN).

---

## 4. Hosted Supabase staging setup (after B3: gates M6-5 and M6-6)

**1. Create the project.** A **separate** Supabase project for Design OS staging, in the Mumbai region. It is not a branch of the Lintel Ops project.

**2. Secret store** (never in the repository, image, logs or chat):

| Variable | Value |
|---|---|
| `MIGRATION_DATABASE_URL` | Direct connection `postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres`. Deploy job only; **never a pooler** |
| `DATABASE_URL` | API runtime: login role `design_os_api_login` (NOINHERIT, member of `design_os_api`, no DDL), pooler allowed |
| `AUTH_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
| `AUTH_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `CURSOR_SECRET` | 32+ random characters, per environment |
| `BUILD_REVISION` | the deployed commit SHA (the API refuses to start without it) |
| `ENGINE_MANIFEST_PATH` | the file written at build time by `pnpm engines:manifest <path>` |
| `CORS_ORIGINS` | the UI origin |
| `TRUST_PROXY_HOPS` | the number of proxies in front of the API |
| `RATE_LIMIT_*` | every limit, set explicitly |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging` | the staging Sentry project |
| Storage | per §5 |

**3. Migrations and gate item 9.** Engineering runs:
```sh
pg_dump --schema=design_os "$MIGRATION_DATABASE_URL" > before-migrate.sql      # kept 30 days
pnpm -s db:migrate up --env staging --confirm <staging ref>
pnpm -s db:migrate status --check
```
Then gate item 9 (plan §1.2): roles, `auth.users` grants, SECURITY DEFINER behaviour, RLS. Create `design_os_api_login` and grant it `design_os_api`.

**4. Deploy.**
- **API:** `pnpm --filter @lintel/api start`, with the variables above.
- **UI:** built with the **publishable** key only:
  ```sh
  VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_…> pnpm web:build
  ```
- **Hosting:** serve `apps/web/dist` so that `/api/*` on the UI origin is forwarded to the API. The UI calls `/api/v1` on its own origin.

**5. Staging rehearsal.**
1. Create a staging-only test organization.
2. Walk the §7 workflow with staging test users.
3. Run `PILOT_ENV=STAGING pnpm pilot:check --confirm <staging ref> --org <TEST ORG>`.

The LOCAL rehearsal data (`pilot:demo` / `pilot:rehearse`) is **never** loaded into staging; the tools refuse any non-local database.

**Production (M6-11).** Same steps on the production project, plus:
- PITR enabled, and a restore drill passed before the first issue;
- `pg_dump` before every migration.

---

## 5. Storage credential setup (after B4)

Until B4 is decided, the API stores files on its own persistent disk:
- `FILE_STORAGE=local`;
- `FILE_STORAGE_ROOT=<persistent path>`;
- `FILE_URL_SECRET` (32+ characters);
- `FILE_URL_BASE=<public API origin>`.

This is acceptable for staging. For production, the disk must be persistent and backed up.

**Option (a): Supabase Storage with one secret key, used for Storage only.**
1. On the project, create the **private** bucket `design-os-outputs`:
   - not public;
   - file-size limit 20 MB;
   - allowed MIME types `application/pdf` and `image/svg+xml`.
2. Put these in the API's secret store:
   - `FILE_STORAGE=supabase`;
   - `SUPABASE_URL=https://<ref>.supabase.co`;
   - `SUPABASE_STORAGE_BUCKET=design-os-outputs`;
   - `SUPABASE_STORAGE_KEY=<sb_secret_…>`.

   This key is never given to the UI or any browser. Rotate it after the pilot.
3. Verify:
   - generate a drawing and a quotation;
   - confirm the objects appear in the bucket;
   - download both PDFs from screen 8;
   - re-generate and confirm the request is idempotent (reused).
4. Configure the nightly bucket copy. Issued files are not covered by database PITR.

**Option (b): S3 access keys with a SigV4 signer.** This needs about one engineering day before hosted storage can be used. Until then, run with `FILE_STORAGE=local`.

---

## 6. Production readiness check

Run all four; each must pass before the first real project:
```sh
# 1. migrations exactly up to date (exit 0)
MIGRATION_DATABASE_URL='<prod direct>' pnpm -s db:migrate status --check

# 2. API up and consistent (HTTP 200, "ready")
curl -s https://<api origin>/api/v1/ready

# 3. the full pilot gate (prints READY (PRODUCTION); exit 0)
PILOT_ENV=PRODUCTION MIGRATION_DATABASE_URL='<prod direct>' PILOT_API_URL=https://<api origin> PILOT_WEB_URL=https://<ui origin> \
PILOT_ACCESS_TOKEN="$(cat admin.token)" pnpm pilot:check --confirm <prod ref> --org LINTEL
```

`pilot:check` requires, as **BLOCKING**:
- the database connection and migrations up to date;
- the organization with an ADMIN;
- every required dataset APPROVED or LOCKED: the 8 engineering pins plus the pricing standard and quotation policy;
- no rehearsal data in the environment;
- `/ready` and `/readiness` READY;
- the UI reachable, and UI → API connectivity.

`PILOT_ACCESS_TOKEN` is an ADMIN, DESIGN_HEAD or FINANCE access token, obtained like `approver.token` in §1.

**Check 4: a dry run with a test project in the LINTEL organization.** Steps 1–5 of §7, up to "0 BLOCKER" on screen 6. This is the real proof that the approved Lintel data resolves the reference cabinet with 0 BLOCKERs. Do not approve or issue it; delete nothing, and name it "Readiness check".

---

## 7. First-project workflow (pilot UI)

Sign in on the pilot UI with Supabase Auth. People switch with the selector at the top right.

| Step | Screen | Who | Action |
|---|---|---|---|
| 1 | 2 Project | P3 (SALES) | Create the client (name, code, phone, email) and the project (name, code, site address). Add P2 as DESIGNER and COSTING, and P1 as DESIGN_HEAD, to the project team |
| 2 | 3 Room | P3 (SITE_ENGINEER) | Enter the surveyed kitchen: width along wall A, depth, height, wall thickness (mm), survey source. Open it |
| 3 | 4 Base cabinets | P2 (DESIGNER) | Create the design, then "Create version (pinned to approved data)". Add KIT_BASE_STANDARD cabinets left to right with their widths; "Arrange run" |
| 4 | 5 Preview | P2 | Check the plan, the wall A elevation and the 3D view |
| 5 | 6 Validation | P2 | "Run APPROVAL validation": it must show 0 BLOCKER. Then "Submit" |
| 6 | 6 Validation | P1 (DESIGN_HEAD) | "Approve" (approves exactly the reviewed content) |
| 7 | 6 Validation | P3 (SALES) | "Lock for issue" |
| 8 | 7 Outputs | P2 (DESIGNER) | Purpose FOR_PRODUCTION; drawing number (e.g. the project code) and revision A. Generate BOM, BOQ, "Drawing: wall A elevation", "Drawing: panel schedule" |
| 9 | 7 Outputs | P2 (COSTING) | Purpose FOR_PRODUCTION; generate Pricing and Quotation (the quotation PDF is generated and sealed with it). "View" the quotation and copy the **hand-over code** |
| 10 | 8 Issue | P3 (SALES) | Enter the reason, paste the hand-over code, check the four values, then "Issue quotation" |
| 11 | 8 Issue | P1 (DESIGN_HEAD) | Enter the reason and issue both drawings |
| 12 | 8 Issue | P1 (or P2) | "Download PDF" for each drawing and for the quotation |
| 13 | offline | P3 | Send the PDFs to the client (no client portal) |

**Why the hand-over code.** By the existing grants, Sales may issue a quotation but may not read cost outputs. Costing reads and generates them but may not issue. The code carries four values:
- the quotation snapshot id;
- its reviewed content hash;
- the PricingStandard version;
- the QuotationPolicy version.

Sales issues exactly that content; the API refuses any mismatch. The code is not a secret.

**The quotation PDF contains:**
- client, project, site, room and design version;
- quotation number `Q-<project code>-R<revision>`;
- every line: quantity, rate excluding tax, tax %, taxable amount;
- tax groups and totals;
- the terms the quotation policy holds.

**Integrity:**
- **Deterministic:** the same inputs give the same bytes.
- **Sealed:** it is sealed into the quotation snapshot's file manifest with the same database check as drawing PDFs, and is immutable before and after issue.
- **Downloaded** through 5-minute signed URLs, with the checksum verified on every read.

**If something is refused.** The UI shows the API's problem code and message. The common ones:

| Code | Meaning |
|---|---|
| `VALIDATION_BLOCKERS` | The design has BLOCKERs; screen 6 lists them |
| `DEPENDENCY_NOT_APPROVED` | A pinned dataset is not approved (§2) |
| `SEPARATION_OF_DUTIES` | The same person tried to author and approve |
| `ISSUE_PRECONDITIONS_FAILED` | The version is not LOCKED, or the output is not FOR_PRODUCTION |

---

## 8. Practise locally first (rehearsal data only)

On any machine with Node ≥ 22.12, pnpm 10 and PostgreSQL 17:
```sh
pnpm install
export PILOT_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres
pnpm pilot:rehearse         # automated end-to-end: prints "rehearsal PASSED"; PDFs in .pilot/rehearsal-pdfs/
pnpm pilot:demo --reset     # API + UI at http://127.0.0.1:5173; paste tokens from .pilot/tokens/<ROLE>.txt
pnpm pilot:check            # in a second terminal: READY (LOCAL)
```

The rehearsal data is synthetic (`LOCAL REHEARSAL ONLY`), exists only on this machine, and can never be loaded into staging or production.

---

## First three actions

1. **Amit — decisions:**
   - name Persons 1–3 (§3, B2);
   - obtain the ops confirmation of items 1–8 and approve M6-6 (§4, B3);
   - choose storage (a) or (b) (§5, B4).
2. **Production team — stage A data:**
   - fill templates 01, 02, 11 and 12 with sourced values;
   - run `pnpm -s db:intake validate --file <file>` until each prints `ACCEPTED`.
3. **Engineering — after M6-6:**
   - create the staging project;
   - run §4 steps 2–5;
   - `pilot:check` on staging.
