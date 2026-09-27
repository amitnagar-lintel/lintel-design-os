# Pilot blockers

Status 2026-09-27, main `ff341a8` (coding freeze active). The pilot workflow is technically complete and every setup procedure is prepared and verified locally (`docs/PILOT-TOMORROW.md`, "Setup status"). The first real Lintel project is blocked **only** by the four items below. Each needs a person, a decision, credentials or business data; none needs development.

Execution steps for every item are in **`docs/PILOT-TOMORROW.md`** (the single operational guide).

---

## B1 — Real approved Lintel reference data

**Blocker.** None of the 19 reference-data files holds approved Lintel values:
- the templates contain 66 NULL values;
- the Hettich records, the edge rules and the hardware rates have no content yet.

**Why it blocks.** A DesignVersion can be approved only when all 8 pinned engineering datasets are APPROVED. Pricing and the quotation need an APPROVED PricingStandard and QuotationPolicy. The engines never invent values.

**Verified.** All 19 templates validate as drafts, and each is refused as a production candidate until every value and its source document are filled. No NULL can reach approval.

**What must be provided.** The values and source documents per file are listed in PILOT-TOMORROW §1:
- the production team: files 01, 02, 09, 11, 12;
- procurement: files 03–08, 10, 13–15, 17;
- costing, approved by finance: files 18, 19.

**Next action.** Fill stage A (01, 02, 11, 12) and validate each file offline.

**Where work resumes.** `pnpm -s db:intake validate --file <file>`. Then import, submit and approve in the order of PILOT-TOMORROW §2, once B2 and B3 are done.

## B2 — Named people and roles

**Blocker.** Nobody is named for the three pilot roles.

**Why it blocks.** The database refuses an approval by the record's author. Every dataset and the design need two different people. Onboarding cannot start without their emails.

**What Amit must provide.** Name and work email of:
- Person 1: ADMIN, DESIGN_HEAD, FINANCE;
- Person 2: PRODUCTION, COSTING, DESIGNER;
- Person 3: PROCUREMENT, SALES, SITE_ENGINEER.

**Next action.** After B3, create their Supabase Auth accounts, then follow PILOT-TOMORROW §3. Its commands are prepared and were verified locally.

**Where work resumes.** PILOT-TOMORROW §3 step 2.

## B3 — Hosted Supabase and staging

**Blocker.** There is no hosted environment. Checked 2026-09-27 (details and exact steps in `docs/DEPLOYMENT-REMAINING-INPUTS.md`):
- **The staging project cannot be created.** Supabase refused `lintel-design-os-staging` (ap-south-1): the "lintelspace" organization is on the Free plan and already has 2 active projects, both Lintel Ops (I1).
- **There is no API host.** Lintel Ops runs on GitHub Pages plus Supabase Edge Functions, which cannot run the NestJS API or forward `/api`. A Node host must be chosen, and deploy access given (I2).
- **The database passwords are not set.** Migrations run from Amit's Mac, because the engineering session can reach HTTPS only. The direct connection is IPv6-only unless the IPv4 add-on is enabled (I3).

**Why it blocks.** Real sign-in (Supabase Auth), authenticated approvals and hosted storage exist only on a hosted project. The LOCAL demo can only ever hold rehearsal data.

**What Amit must provide:**
- the ops owner's dated confirmation of Mumbai gate items 1–8 (M6-5);
- written approval to connect to hosted Supabase (M6-6);
- a separate "Design OS staging" project in Mumbai; send its project ref;
- the staging secret-store entries of PILOT-TOMORROW §4.4: database password (direct connection) and API login password, entered by Amit, never sent in chat.

**Next action.** Clear I1 and I2. Engineering then creates the project and runs checklist PILOT-TOMORROW §4.5–§4.11 on staging, with Amit entering the secrets. Later it repeats the checklist on production (M6-11).

**Where work resumes.** `docs/DEPLOYMENT-REMAINING-INPUTS.md` I1.

## B4 — Storage credential

**Blocker.** Supabase Storage (option (a), the preferred production option) needs Amit's confirmation and a dedicated secret key. That is the only secret key the API holds, and it is used for Storage only.

**Why it blocks.** Issued PDFs on a hosted API need durable storage. Until this is decided, files are stored on the API host's disk (`FILE_STORAGE=local`), which is acceptable for staging only.

**What Amit must provide:**
- confirmation of option (a), or a rejection of it, which means option (b): an S3 signer, about one engineering day;
- for (a): the secret key `design-os-api-storage`, created in the project and entered directly into the API secret store (never in chat, code or the browser).

**Next action.** Engineering creates the private bucket `design-os-outputs`, sets the storage variables, and runs the staging verification (PILOT-TOMORROW §5 steps 1–4).

**Where work resumes.** PILOT-TOMORROW §5 step 1 / DEPLOYMENT-REMAINING-INPUTS I5, after the staging project exists (B3).
