# Pilot — what to do tomorrow

For Amit. Status 2026-09-26. Blocker details are in `docs/PILOT-BLOCKERS.md` (B1–B5).

## A. What is ready

| Area | Ready | How to see it |
|---|---|---|
| Database | Migrations 0001–0020; migration runner with the environment guard (never a pooler; `--confirm` for staging / production) | `pnpm -s db:migrate status` (with `MIGRATION_DATABASE_URL`) |
| Organization and people | `db:org init` (first ADMIN); invitations and acceptance through the API | `pnpm -s db:org init …`; UI screen 2 |
| Reference data | Read API; intake CLI with validate → import → submit → approve. The approver must present their own Supabase Auth token; the author can never approve | `pnpm -s db:intake validate --file …` |
| Readiness | `GET /api/v1/ready`, `GET /api/v1/readiness`, audit read, Sentry, rate limits | `pnpm pilot:check` |
| Engines through the API | Resolved model, validation, BOM, BOQ, Pricing, Quotation, drawings (PDF + SVG), issue, signed PDF download | `pnpm pilot:rehearse` |
| UI | Eight screens: Login, Project, Room, Base cabinets, Preview (2D + 3D), Validation, Outputs, Issue | `pnpm pilot:demo`, then http://127.0.0.1:5173 |
| Proof | LOCAL rehearsal: real engines, 0 BLOCKERs, LOCKED design, FOR_PRODUCTION outputs, quotation and 2 drawings issued, PDFs verified by checksum. Every output traced to the same DesignVersion, input hash and exact pins | `.pilot/rehearsal-report.json` after `pnpm pilot:rehearse` |

**What "ready" does not cover.** The real pilot is **not** ready. There is no approved Lintel data (B1), no named approvers (B2) and no hosted Supabase (B3). The LOCAL demo uses synthetic rehearsal data (`LOCAL REHEARSAL ONLY`) that can never reach staging or production.

## B. What to enter tomorrow

**1. Reference values into the 19 intake templates.** Copy `docs/pilot/intake-templates/*.json` to a working folder outside the repository. For each file:
- replace every `null` listed in `docs/pilot/intake-templates/README.md` (the exact list is also in `PILOT-BLOCKERS.md` B1);
- set `"intent": "PRODUCTION_CANDIDATE"`;
- set `sourceRef.documentTitle` and `sourceRef.sourceDate` (YYYY-MM-DD);
- for files 01 and 02, fill `provenance.<VARIABLE>.source` and `.evidenceRef` for every value.

**2. People.** Three names and work emails, assigned to roles as in `PILOT-BLOCKERS.md` B2.

**3. Decisions:**
- B3: approve hosted access (M6-6) and create the staging project;
- B4: storage key, (a) or (b);
- B5: is the browser-printed quotation acceptable?

**4. For the first real project (when B1–B3 are cleared), entered in the UI:**

| Screen | Fields |
|---|---|
| 2 Project | Client name, client code, phone, email; project name, project code, site address |
| 3 Room | Width along wall A, depth, height, wall thickness (mm); survey source |
| 4 Base cabinets | Width of each cabinet, left to right |
| 7 Outputs | Drawing number (A–Z, 0–9, `-`) and revision |
| 8 Issue | Issue reason |

## C. Required reference datasets (all must be APPROVED or LOCKED)

| # | Type | Entity | Author → approver |
|---|---|---|---|
| 01 | construction_standard | LINTEL_CONSTRUCTION_STANDARD | PRODUCTION → DESIGN_HEAD |
| 02 | planning_standard | LINTEL_PLANNING_STANDARD | PRODUCTION → DESIGN_HEAD |
| 03–05 | material | BOARD_BWP_18, BOARD_HDHMR_18, BOARD_BACK_6 | PROCUREMENT → DESIGN_HEAD |
| 06–07 | edge_band | EDGE_ABS_2MM, EDGE_ABS_0_8MM | PROCUREMENT → DESIGN_HEAD |
| 08 | finish | LAMINATE_WHITE | PROCUREMENT → DESIGN_HEAD |
| 09 | edge_band_standard | LINTEL_EDGE_BAND_STANDARD | PRODUCTION → DESIGN_HEAD |
| 10 | hardware_rule_set | HINGE_STANDARD | PROCUREMENT → PRODUCTION |
| 11 | construction_recipe | KITCHEN_BASE_STANDARD_V1 | DESIGN_HEAD → PRODUCTION |
| 12 | product | KIT_BASE_STANDARD | DESIGN_HEAD → PRODUCTION |
| 13 | material_catalog | LINTEL_MATERIAL_CATALOG | PROCUREMENT → DESIGN_HEAD |
| 14 | finish_catalog | LINTEL_FINISH_CATALOG | PROCUREMENT → DESIGN_HEAD |
| 15 | hardware_catalog | LINTEL_HARDWARE_CATALOG | PROCUREMENT → PRODUCTION |
| 16 | product_catalog | LINTEL_PRODUCT_CATALOG | DESIGN_HEAD → PRODUCTION |
| 17 | hettich_dataset | HETTICH_PRODUCTION | PROCUREMENT → PRODUCTION |
| 18 | pricing_standard | LINTEL_PRICING_STANDARD | COSTING → FINANCE |
| 19 | quotation_policy | LINTEL_PRODUCTION_QUOTATION_POLICY | COSTING → FINANCE |

Import them in this order: a file may reference only files above it that are already approved.

## D. Datasets missing or unapproved (today: all of them)

- **All 19 files** are missing as approved data in every hosted environment; no hosted environment exists yet (B3).
- **62 values are NULL** (listed per file in `docs/pilot/intake-templates/README.md`):
  - 12 construction values;
  - 6 planning values;
  - 8 board properties;
  - 2 edge-band widths;
  - 12 product limits;
  - 14 pricing values;
  - 6 quotation-policy values;
  - 1 empty edge-band rule set;
  - 1 empty Hettich dataset.
- **Beyond those 62, these need content:**
  - every Hettich record (17): full-overlay hinge, inset hinge if used, mounting plate, and the hinge quantity rule;
  - the edge-band rules for all 8 component types (09);
  - a per-unit rate `HETTICH:<article>` for each Hettich article (18).
- **Files with nothing NULL still need** the source document named and the approver's approval: 08, 10, 11, 13–16.

## E. Exact commands and screens

**LOCAL (your machine: Node ≥ 22.12, pnpm 10, PostgreSQL 17 on localhost).**

Set up once:
```sh
git pull && pnpm install
export PILOT_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres   # your local admin connection
```

The automated end-to-end rehearsal (about 1 minute):
```sh
pnpm pilot:rehearse
```
It prints `rehearsal PASSED …`, and writes `.pilot/rehearsal-report.json` and `.pilot/rehearsal-pdfs/*.pdf`.

The demo, which runs until Ctrl-C:
```sh
pnpm pilot:demo --reset
```
Then:
1. Open http://127.0.0.1:5173.
2. On screen 1, paste `.pilot/tokens/SALES.txt`, then `SITE_ENGINEER`, `DESIGNER`, `DESIGN_HEAD` and `COSTING`.
3. Switch between people with the selector at the top right.
4. Follow screens 2 → 8 in order (the walkthrough is in the list below).

In a second terminal while the demo runs:
```sh
pnpm pilot:check      # must print READY (LOCAL)
```

Optional, with Chromium installed: the browser walkthrough of all eight screens.
```sh
pnpm pilot:ui-e2e
```

**Screen walkthrough (demo):**
1. **Project:** Sales creates the client and project, then adds Designer, Site engineer, Design head and Costing to the team.
2. **Room:** the Site engineer enters the kitchen.
3. **Base cabinets:** the Designer creates the design and a version, then adds cabinets and uses "Arrange run".
4. **Preview.**
5. **Validation:** the Designer runs the APPROVAL validation and submits. The Design head approves. Sales locks.
6. **Outputs:** the Designer generates FOR_PRODUCTION BOM, BOQ and both drawings. Costing generates Pricing and the Quotation, then clicks "View" on the quotation and copies the hand-over code.
7. **Issue:** Sales pastes the hand-over code and issues the quotation. The Design head issues the drawings and downloads the PDFs.

**Reference-data intake (staging, after B3).**

Settings come from the staging secret store. Never paste secrets into the repository or chat.
```sh
export MIGRATION_DATABASE_URL='<staging direct connection>'
export AUTH_ISSUER=https://<ref>.supabase.co/auth/v1
export AUTH_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
```

For each file, in C-order:
```sh
pnpm -s db:intake validate --file 01-construction_standard-LINTEL_CONSTRUCTION_STANDARD.json
pnpm -s db:intake import  --file 01-….json --env staging --confirm <ref> --org <CODE> --as <author email> --operator <your name>
pnpm -s db:intake submit  --env staging --confirm <ref> --org <CODE> --type construction_standard --entity LINTEL_CONSTRUCTION_STANDARD --version 1 --as <author email> --operator <your name> --reason "<why>"
pnpm -s db:intake status  --org <CODE> --type construction_standard --entity LINTEL_CONSTRUCTION_STANDARD --version 1    # note the content hash
```

The approver signs in to Supabase Auth, saves their access token to a file, and runs:
```sh
pnpm -s db:intake approve --env staging --confirm <ref> --org <CODE> --type construction_standard --entity LINTEL_CONSTRUCTION_STANDARD --version 1 --access-token-file <file> --operator <your name> --reason "<why>" --expected-content-hash <sha256:… from status>
```

Check the environment:
```sh
PILOT_ENV=STAGING PILOT_API_URL=<staging API> PILOT_WEB_URL=<staging UI> pnpm pilot:check --confirm <ref> --org <CODE>
```

## F. Blockers that need your approval or business data

| # | You must | Blocks |
|---|---|---|
| B1 | Provide and approve the 19 reference-data files: 62 NULL values, plus the Hettich records, edge rules and hardware rates, each with its source | Every real output |
| B2 | Name 3 people and assign their roles as in B2 | Every approval |
| B3 | Confirm ops items 1–8 (M6-5), approve hosted access (M6-6), create the separate staging project, provide its settings through the secret store | Real sign-in and any hosted run |
| B4 | Choose the Storage credential: (a) secret key for Storage only, or (b) S3 keys + SigV4 | Hosted PDF storage |
| B5 | Accept the browser-printed quotation, or specify a quotation PDF layout | A system-made quotation PDF |

## First three actions tomorrow

1. **About 30 minutes.** Run `pnpm pilot:rehearse`, then `pnpm pilot:demo --reset`, and walk screens 1 → 8 with the rehearsal tokens.
2. **Decide B2–B5:**
   - send the 3 names and emails;
   - approve M6-6 and create the staging project;
   - choose storage (a) or (b);
   - accept or reject the printed quotation.
3. **With the production team,** fill templates 01 (construction), 02 (planning) and 12 (product limits) with sourced values. Run `pnpm -s db:intake validate --file <file>` until each prints `ACCEPTED`.
