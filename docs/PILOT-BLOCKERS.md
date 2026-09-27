# Pilot blockers

Status 2026-09-27, main `92c3ca9`. The pilot workflow is technically complete: the LOCAL rehearsal passes end to end with the real engines, and the UI, drawing PDFs and quotation PDF all work. The first real Lintel project is blocked **only** by the four items below. Each needs a person, a decision or business data; none needs more feature work.

Execution steps for every item are in **`docs/PILOT-TOMORROW.md`** (the single operational guide).

---

## B1 — Real approved Lintel reference data

**Blocker.** None of the 19 reference-data files holds approved Lintel values:
- the templates contain 62 NULL values;
- the Hettich records, the edge rules and the hardware rates have no content yet.

**Why it blocks.** A DesignVersion can be approved only when all 8 pinned engineering datasets are APPROVED. Pricing and the quotation need an APPROVED PricingStandard and QuotationPolicy. The engines never invent values.

**What must be provided.** The values and source documents per file are listed in PILOT-TOMORROW §1:
- the production team: files 01, 02, 09, 11, 12;
- procurement: files 03–08, 10, 13–15, 17;
- costing, approved by finance: files 18, 19.

**Next action.** Fill stage A (01, 02, 11, 12) first and validate each file offline.

**Where work resumes.** `pnpm -s db:intake validate --file <file>`. Then import, submit and approve in the order of PILOT-TOMORROW §2, and run `pnpm pilot:check` after each stage.

## B2 — Named people and roles

**Blocker.** Nobody is named for the author and approver roles.

**Why it blocks.** The database refuses an approval by the record's author. Every dataset and the design need two different people.

**What Amit must provide.** Name and work email of 3 people, with the roles in PILOT-TOMORROW §3:
- Person 1: ADMIN, DESIGN_HEAD, FINANCE;
- Person 2: PRODUCTION, COSTING, DESIGNER;
- Person 3: PROCUREMENT, SALES, SITE_ENGINEER.

**Next action.** Create their Supabase Auth accounts, then run `db:org init` for Person 1.

**Where work resumes.** PILOT-TOMORROW §3.

## B3 — Hosted Supabase and staging

**Blocker.** There is no approved hosted environment:
- ops gate items 1–8 are not confirmed (M6-5);
- hosted access is not approved (M6-6);
- the separate staging project does not exist;
- gate item 9 has not been run (M6-7);
- production is not set up (M6-11).

**Why it blocks.** Real sign-in (Supabase Auth) and authenticated approvals exist only on a hosted project. The LOCAL demo can only ever hold rehearsal data.

**What Amit must provide:**
- the ops owner's dated confirmation of items 1–8;
- approval of M6-6;
- the staging project and its settings, in the secret store.

**Next action.** Engineering runs PILOT-TOMORROW §4 on staging, then on production.

**Where work resumes.** `pnpm -s db:migrate up --env staging --confirm <staging ref>`.

## B4 — Storage credential

**Blocker.** Hosted file storage needs a decision:
- **(a)** one Supabase secret key in the API, for Storage only; or
- **(b)** S3 access keys with a SigV4 signer, about one engineering day.

**Why it blocks.** Issued PDFs on a hosted API need durable storage. Until this is decided, files are stored on the API host's disk (`FILE_STORAGE=local`).

**What Amit must provide.** The choice, (a) or (b).

**Next action.**
- **(a):** create the private bucket `design-os-outputs` and set the four storage variables.
- **(b):** request the signer.

**Where work resumes.** PILOT-TOMORROW §5.
