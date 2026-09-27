# Pilot — what to do tomorrow

For Amit. Status 2026-09-27. Blocker details are in `docs/PILOT-BLOCKERS.md` (B1–B4).

## A. What is ready

| Area | Ready | How to see it |
|---|---|---|
| Database | Migrations 0001–0021; migration runner with the environment guard (never a pooler; `--confirm` for staging / production) | `pnpm -s db:migrate status` (with `MIGRATION_DATABASE_URL`) |
| Organization and people | `db:org init` (first ADMIN); invitations and acceptance through the API | `pnpm -s db:org init …`; UI screen 2 |
| Reference data | Read API; intake CLI with validate → import → submit → approve. The approver must present their own Supabase Auth token; the author can never approve | `pnpm -s db:intake validate --file …` |
| Readiness | `GET /api/v1/ready`, `GET /api/v1/readiness`, audit read, Sentry, rate limits | `pnpm pilot:check` |
| Engines through the API | Resolved model, validation, BOM, BOQ, Pricing, Quotation, drawings (PDF + SVG), issue, signed PDF download | `pnpm pilot:rehearse` |
| **Quotation PDF** | Generated with every quotation, deterministic, sealed into the snapshot's file manifest (the same database check as drawing PDFs), immutable before and after issue. Downloaded on screen 8 | UI screen 8 → QUOTATION row → "Download PDF" |
| UI | Eight screens: Login, Project, Room, Base cabinets, Preview (2D + 3D), Validation, Outputs, Issue | `pnpm pilot:demo`, then http://127.0.0.1:5173 |
| Proof | LOCAL rehearsal: real engines, 0 BLOCKERs, LOCKED design, FOR_PRODUCTION outputs, quotation and 2 drawings issued, **3 PDFs** (2 drawings + quotation) verified by checksum. Every output traced to the same DesignVersion, input hash and exact pins | `.pilot/rehearsal-report.json` after `pnpm pilot:rehearse` |

**What "ready" does not cover.** The real pilot is **not** ready. There is no approved Lintel data (B1), no named approvers (B2) and no hosted Supabase (B3). The LOCAL demo uses synthetic rehearsal data (`LOCAL REHEARSAL ONLY`) that can never reach staging or production.

### The quotation PDF

**When it is made.** It is generated in the same request that generates the quotation (Costing, screen 7). It is built from the sealed quotation and the project and client records.

**What it contains:**
- the client name, code and contact;
- the project name, code and site;
- the room and design version;
- the quotation number `Q-<project code>-R<revision>` and its revision;
- every line: item, quantity, rate excluding tax, tax %, taxable amount;
- the tax groups;
- the totals, from taxable amount to grand total;
- the terms the quotation model holds: currency, tax policy and rates, rounding, discount policy, and the exact quotation policy, rate card and pricing rules versions.

Nothing is recomputed and nothing is added that the model does not hold.

**Integrity:**
- **Deterministic.** The same quotation and records always give the same bytes.
- **Sealed.** It is stored content-addressed, and its SHA-256 is part of the file manifest sealed in the quotation snapshot (migration 0021). The database refuses, at commit, any link that does not match the manifest. Links are insert-only, so the PDF cannot change before or after issue.

**Who can download it.** People who can read cost outputs: Costing, Finance, Design head, Admin. They use screen 8, QUOTATION row, "Download PDF", which fetches a 5-minute signed URL. The checksum is re-verified on every read.

### The Costing → Sales hand-over (kept for the pilot; no permission change)

**Why.** By the existing role grants:
- Sales may **issue** a quotation (`quotation.issue`) but may **not read** cost outputs (`output.read.cost`);
- Costing may read and generate them, but not issue.

The pilot keeps this separation unchanged.

**Steps:**
1. **Costing, screen 7 Outputs.** Generate the FOR_PRODUCTION Quotation. Click **View** on the QUOTATION row and copy the **hand-over code** under the totals. The code carries four values:
   - the snapshot id;
   - the reviewed content hash;
   - the PricingStandard version;
   - the QuotationPolicy version.
2. **Costing sends the code to Sales** by any channel. It is not a secret: it only names the exact quotation.
3. **Sales, screen 8 Issue.** Enter the issue reason, paste the code into **"Hand-over code"**, check the four values shown, and click **Issue quotation**. The API issues exactly that content: it refuses if the hash or the commercial versions differ, and the issue locks the pricing standard and quotation policy versions.
4. **Costing (or Finance / Design head), screen 8 Issue.** The QUOTATION row shows ISSUED. Click **Download PDF** and hand the PDF to Sales for the client. There is no client portal; delivery is offline.

## B. What to enter tomorrow

**1. Reference values into the 19 intake templates, in the order of section C (group A first).** Copy `docs/pilot/intake-templates/*.json` to a working folder outside the repository. For each file:
- replace every `null` listed in `docs/pilot/intake-templates/README.md`;
- set `"intent": "PRODUCTION_CANDIDATE"`;
- set `sourceRef.documentTitle` and `sourceRef.sourceDate` (YYYY-MM-DD);
- for files 01 and 02, fill `provenance.<VARIABLE>.source` and `.evidenceRef` for every value.

**2. People.** Three names and work emails, assigned to roles as in `PILOT-BLOCKERS.md` B2.

**3. Decisions:**
- B3: approve hosted access (M6-6) and create the staging project;
- B4: storage key, (a) or (b).

**4. For the first real project (when B1–B3 are cleared), entered in the UI:**

| Screen | Fields |
|---|---|
| 2 Project | Client name, client code, phone, email; project name, project code, site address |
| 3 Room | Width along wall A, depth, height, wall thickness (mm); survey source |
| 4 Base cabinets | Width of each cabinet, left to right |
| 7 Outputs | Drawing number (A–Z, 0–9, `-`) and revision |
| 8 Issue | Issue reason; for Sales, the hand-over code |

## C. Required reference datasets, by stage

**Common to all 19 files.** Every file must end APPROVED (or LOCKED). Each needs:
- `intent: PRODUCTION_CANDIDATE`;
- `sourceRef.documentTitle` and `sourceRef.sourceDate`;
- a value or confirmation for every field named below.

Author and approver must be different people (roles as in `PILOT-BLOCKERS.md` B2). "Dependencies" means the files that must already be APPROVED before this one can be imported as a production candidate.

**The database rule behind the grouping.** A design version is **approved** only when all 8 datasets it pins are APPROVED or LOCKED:
- construction, planning and edge-band standards;
- material, finish, hardware and product catalogs;
- the Hettich dataset.

So the first design approval needs groups A **and** B. Group A comes first because its values drive the cabinet geometry and every validation check the designer sees. Group B completes the pins and the production BOM. Group C is needed only for pricing, the quotation and its issue.

### Group A — required before the first design approval (geometry and validation)

| Dataset | Template | Fields Lintel must provide | Author → approver | Dependencies | If missing, the pilot is blocked at |
|---|---|---|---|---|---|
| Construction | `01-construction_standard-LINTEL_CONSTRUCTION_STANDARD.json` | 12 values (mm) with source and evidence for each: BACK_GROOVE_DEPTH, BACK_REAR_OFFSET, TOP_RAIL_WIDTH, SHELF_FRONT_SETBACK, SHELF_SIDE_CLEARANCE, OVERLAY_EDGE_GAP, OVERLAY_TOP_GAP, OVERLAY_BOTTOM_GAP, FRONT_BETWEEN_GAP, INSET_GAP, FRONT_FINISHED_FACES, SHUTTER_BACK_GAP | PRODUCTION → DESIGN_HEAD | none | Screen 4 onward. No design version can be created (no approved pin); panel sizes cannot be computed |
| Planning | `02-planning_standard-LINTEL_PLANNING_STANDARD.json` | 6 values (mm) with source and evidence for each: MIN_WALL_CLEARANCE, MIN_CABINET_GAP, MAX_GAP_WITHOUT_FILLER, FILLER_THRESHOLD, MAX_RUN_LENGTH, SERVICE_VOID_REAR | PRODUCTION → DESIGN_HEAD | none | Screen 4 onward. No design version; run, gap and clearance checks cannot run |
| Product limits | `12-product-KIT_BASE_STANDARD.json` | Min and max of width, height, depth, carcass thickness and back thickness; max shelf count; max shutter count (12 values). Confirm defaults W 600, H 720, D 560, T 18, TB 6, 1 shelf, 2 shutters, OVERLAY | DESIGN_HEAD → PRODUCTION | **Recipe `11-construction_recipe-KITCHEN_BASE_STANDARD_V1.json`** (group B) must be approved first | Screen 4. KIT_BASE_STANDARD cannot be offered; cabinet sizes cannot be validated |

### Group B — required before production output (and, by the rule above, before the first design approval)

| Dataset | Template | Fields Lintel must provide | Author → approver | Dependencies | If missing, the pilot is blocked at |
|---|---|---|---|---|---|
| Materials | `03-material-BOARD_BWP_18.json`, `04-material-BOARD_HDHMR_18.json`, `05-material-BOARD_BACK_6.json`; catalog `13-material_catalog-LINTEL_MATERIAL_CATALOG.json` | BWP 18: density. HDHMR 18: sheet size, grain, density. Back 6 mm: substrate, sheet size, grain, density. The catalog lists the 3 boards and 2 edge bands (confirm) | PROCUREMENT → DESIGN_HEAD | Catalog 13 needs 03–07 approved | Design approval (pin missing); BOM material lines; component material BLOCKERs |
| Finishes | `08-finish-LAMINATE_WHITE.json`; catalog `14-finish_catalog-LINTEL_FINISH_CATALOG.json` | Confirm LAMINATE_WHITE (1 mm) and its source; catalog lists it (confirm) | PROCUREMENT → DESIGN_HEAD | Catalog 14 needs 08 | Design approval (pin missing); finish on shutters |
| Edge band | `06-edge_band-EDGE_ABS_2MM.json`, `07-edge_band-EDGE_ABS_0_8MM.json`; standard `09-edge_band_standard-LINTEL_EDGE_BAND_STANDARD.json` | Width of each band. For the standard, rule set CARCASS_STANDARD: which edges (FRONT / BACK / TOP / BOTTOM / LEFT / RIGHT) of SIDE_LEFT, SIDE_RIGHT, BOTTOM, TOP_SUPPORT_FRONT, TOP_SUPPORT_BACK, BACK, SHELF and SHUTTER get which band; `{}` = none | PROCUREMENT → DESIGN_HEAD (bands); PRODUCTION → DESIGN_HEAD (standard) | Standard 09 needs 06–07 | Design approval (pin missing); EDGE_RULES_UNDEFINED BLOCKERs; edge-band lengths in the BOM |
| Hardware | `10-hardware_rule_set-HINGE_STANDARD.json`; catalog `15-hardware_catalog-LINTEL_HARDWARE_CATALOG.json` | Confirm the hinge rule (shutters → hinged door; OVERLAY → full overlay, INSET → inset) and the catalog | PROCUREMENT → PRODUCTION | Catalog 15 needs 10 | Design approval (pin missing); hinge requirements of shutters cannot be derived |
| Product / Recipes | `11-construction_recipe-KITCHEN_BASE_STANDARD_V1.json`; catalog `16-product_catalog-LINTEL_PRODUCT_CATALOG.json` | Confirm the recipe (components, formulas, 6 rules) as it is; catalog lists KIT_BASE_STANDARD v1 | DESIGN_HEAD → PRODUCTION | 12 needs 11; catalog 16 needs 12 | Product limits (group A) cannot be approved; design approval (pin missing) |
| Hettich | `17-hettich_dataset-HETTICH_PRODUCTION.json` | One complete record per article used, from official Hettich sources: full-overlay hinge, inset hinge (if inset is offered), mounting plate. Each record needs:<br>• article number, family, description, application and mounting;<br>• door-thickness range and opening angle;<br>• compatible articles;<br>• drilling pattern and holes, with source;<br>• installation guide, adjustment ranges and dimensions;<br>• accessories, CAD reference (hettich.com), source URL and date;<br>• licence, verifiedBy, verifiedAt, preference rank.<br>Plus the hinge quantity rule (door-height bands → count) with source | PROCUREMENT → PRODUCTION | none | Design approval (pin missing); every hinge UNRESOLVED; FOR_PRODUCTION BOM refused as incomplete |

### Group C — required before commercial issue

| Dataset | Template | Fields Lintel must provide | Author → approver | Dependencies | If missing, the pilot is blocked at |
|---|---|---|---|---|---|
| Pricing Standard | `18-pricing_standard-LINTEL_PRICING_STANDARD.json` | Rates in paise: per m² for BOARD_BWP_18, BOARD_HDHMR_18, BOARD_BACK_6 and LAMINATE_WHITE; per metre for EDGE_ABS_2MM and EDGE_ABS_0_8MM; per unit for every Hettich article in 17, keyed `HETTICH:<article>`. Rules: manufacturing-cost formula; wastage % (board, edge band, finish); overhead %; margin basis (MARKUP_ON_COST or MARGIN_ON_PRICE); margin %; GST % | COSTING → FINANCE | Article numbers from 17 (for the hardware rates) | Screen 7 Pricing and Quotation: UNAVAILABLE / no approved PricingStandard; nothing to issue |
| Quotation Policy | `19-quotation_policy-LINTEL_PRODUCTION_QUOTATION_POLICY.json` | Tax rates (code → %); the tax rate for category KITCHEN_BASE; tax policy (PER_LINE or PER_RATE_GROUP); rounding of tax and of the grand total (mode + increment in paise); discount policy (NONE unless decided) | COSTING → FINANCE | none | Screen 7 Quotation and screen 8 quotation issue; no quotation PDF |

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
  - every Hettich record and the quantity rule (17);
  - the edge rules for 8 component types (09);
  - a per-unit rate `HETTICH:<article>` per Hettich article (18).
- **Files with nothing NULL still need** a named source document and the approver's approval: 08, 10, 11, 13–16.

## E. Exact commands and screens

**LOCAL (your machine: Node ≥ 22.12, pnpm 10, PostgreSQL 17 on localhost).**

Set up once:
```sh
git pull && pnpm install
export PILOT_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/postgres   # your local admin connection
```

The automated rehearsal:
```sh
pnpm pilot:rehearse
```
It prints `rehearsal PASSED …`, and writes `.pilot/rehearsal-report.json` and `.pilot/rehearsal-pdfs/*.pdf` (2 drawings + the quotation).

The demo, which runs until Ctrl-C:
```sh
pnpm pilot:demo --reset
```
Then open http://127.0.0.1:5173. On screen 1, paste `.pilot/tokens/SALES.txt`, then `SITE_ENGINEER`, `DESIGNER`, `DESIGN_HEAD` and `COSTING`.

In a second terminal while the demo runs:
```sh
pnpm pilot:check       # must print READY (LOCAL)
pnpm pilot:ui-e2e      # optional: browser walkthrough of all 8 screens (needs Chromium)
```

**Reference-data intake (staging or production, after B3).**

Settings come from the secret store. Never paste secrets into the repository or chat.
```sh
export MIGRATION_DATABASE_URL='<direct connection>'
export AUTH_ISSUER=https://<ref>.supabase.co/auth/v1
export AUTH_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
```

For each file, in C-order (A, then B, then C; inside a group, dependencies first):
```sh
pnpm -s db:intake validate --file <file>
pnpm -s db:intake import  --file <file> --env <staging|production> --confirm <ref> --org <CODE> --as <author email> --operator <your name>
pnpm -s db:intake submit  --env <env> --confirm <ref> --org <CODE> --type <type> --entity <ENTITY> --version 1 --as <author email> --operator <your name> --reason "<why>"
pnpm -s db:intake status  --org <CODE> --type <type> --entity <ENTITY> --version 1      # note the content hash
```

The approver signs in to Supabase Auth, saves their access token to a file, and runs:
```sh
pnpm -s db:intake approve --env <env> --confirm <ref> --org <CODE> --type <type> --entity <ENTITY> --version 1 --access-token-file <file> --operator <your name> --reason "<why>" --expected-content-hash <sha256:… from status>
```

## F. Blockers that need your approval or business data

| # | You must | Blocks |
|---|---|---|
| B1 | Provide and approve the 19 reference-data files (section C): 62 NULL values, plus the Hettich records, edge rules and hardware rates, each with its source | Every real output |
| B2 | Name 3 people and assign their roles as in B2 | Every approval |
| B3 | Confirm ops items 1–8 (M6-5), approve hosted access (M6-6), create the separate staging project, provide its settings through the secret store | Real sign-in and any hosted run |
| B4 | Choose the Storage credential: (a) secret key for Storage only, or (b) S3 keys + SigV4 | Hosted PDF storage |

The quotation document (former B5) is resolved: a real, sealed quotation PDF now exists.

## G. The first real pilot — exact sequence

**Stage 1. Decisions (Amit)**
1. Send the 3 people and their roles (B2).
2. Choose storage (a) or (b) (B4).
3. Get the ops owner's dated confirmation of gate items 1–8 (M6-5).
4. Approve hosted access (M6-6).

**Stage 2. Staging (engineering, after M6-6)**
1. Create the separate Design OS staging project (Mumbai). Put its settings in the staging secret store.
2. `pnpm -s db:migrate up --env staging --confirm <staging ref>`.
3. Run gate item 9 (M6-7) and deploy the API and UI to staging (M6-8).
4. Run the LOCAL rehearsal flow on staging with a staging-only test organization.
5. `PILOT_ENV=STAGING pnpm pilot:check --confirm <staging ref> --org <TEST ORG>`.

**Stage 3. Production (engineering + Amit, M6-11)**
1. `pnpm -s db:migrate up --env production --confirm <prod ref>`.
2. Enable PITR and pass the restore drill.
3. Deploy the API and UI.

**Stage 4. Organization and people (production)**
1. `pnpm -s db:org init --env production --confirm <prod ref> --code LINTEL --name "Lintel" --admin-email <Person 1 email> --admin-name "<Person 1>" --operator <you>`.
2. Person 1 signs in on the pilot UI (Supabase Auth). They accept the ADMIN invitation, then invite Persons 2 and 3 with their roles (B2).
3. Persons 2 and 3 sign in and accept.

**Stage 5. Reference data, in section C order (production, commands in E)**
1. **Group A:** 01, 02, then recipe 11, then 12.
2. **Group B:** 03–08, 09, 10, 13, 14, 15, 16, 17.
3. **Group C:** 18, 19.

After each group, run `PILOT_ENV=PRODUCTION pnpm pilot:check --confirm <prod ref> --org LINTEL`. Its `data.*` lines turn PASS. After group C it must print `READY (PRODUCTION)`.

**Stage 6. The first project (pilot UI, production)**
1. **Screen 2.** Person 3 (SALES) creates the client and project, and adds Person 2 (DESIGNER, COSTING) and Person 1 (DESIGN_HEAD) to the project team.
2. **Screen 3.** Person 3 (SITE_ENGINEER) enters the surveyed kitchen: width along wall A, depth, height, wall thickness, survey source.
3. **Screen 4.** Person 2 (DESIGNER) creates the design and version, adds the KIT_BASE_STANDARD cabinets left to right, and clicks "Arrange run".
4. **Screen 5.** Check the plan, the elevation and the 3D view.
5. **Screen 6.**
   - Person 2 runs the APPROVAL validation. It must show 0 BLOCKER. Person 2 then submits.
   - Person 1 (DESIGN_HEAD) approves.
   - Person 3 (SALES) locks for issue.
6. **Screen 7.** Choose purpose FOR_PRODUCTION.
   - Person 2 (DESIGNER) generates the BOM, the BOQ and both drawings: the wall A elevation and the panel schedule, with a drawing number and revision A.
   - Person 2 (COSTING) generates Pricing and the Quotation. They click View on the quotation and copy the hand-over code.
7. **Screen 8.**
   - Person 3 (SALES) pastes the hand-over code, enters the reason and clicks "Issue quotation".
   - Person 1 (DESIGN_HEAD) issues both drawings.
   - Person 1 (or Person 2) downloads the drawing PDFs and the quotation PDF.

**Stage 7. Delivery (offline).** Send the downloaded PDFs to the client. There is no client portal.

## First three actions tomorrow

1. **About 30 minutes.** Run `pnpm pilot:rehearse`, then `pnpm pilot:demo --reset`. Walk screens 1 → 8 with the rehearsal tokens, including the hand-over and the quotation PDF download.
2. **Stage 1 decisions:**
   - send the 3 names and emails;
   - choose storage (a) or (b);
   - request the ops confirmation of items 1–8;
   - approve M6-6.
3. **With the production team,** fill group A: templates 01 (construction), 02 (planning), 11 (recipe, confirm) and 12 (product limits), with sourced values. Run `pnpm -s db:intake validate --file <file>` until each prints `ACCEPTED`.
