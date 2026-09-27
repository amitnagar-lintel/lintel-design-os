# M7 — minimum pilot UI

Status: implemented for the V1 pilot. The code is in `apps/web`, and `apps/web/README.md` lists the commands.

## 1. Scope

This is exactly the pilot workflow and nothing more.

**The eight screens** run in this order: Login → Project → Room → Base cabinet layout → Preview → Validation → Outputs → Issue.

**What the UI lets people do:**
- **Rooms:** only rectangular kitchens, with no openings.
- **Products:** only `KIT_BASE_STANDARD`, in one run on wall A. There are no wall or tall cabinets.
- **Clients:** there is no client portal. Issued PDFs are downloaded and delivered offline (OD-M6 pilot boundary).
- **Manufacturing:** none — no manufacturing release, CNC, nesting or drilling.

## 2. Architecture

**Stack: Vite + React 19 single-page app.** This deliberately deviates from plan §5.2 (Next.js) for the pilot:
- there is no server rendering, no server code and no second server to deploy or secure;
- it builds to static files, which any static host (or the API host) can serve;
- the dev and preview servers proxy `/api` to the API, so the browser uses one origin.

Moving to Next.js later changes only the shell, not the API contract.

**API access.** The API client is `openapi-fetch`, typed from the generated OpenAPI (`src/api/schema.d.ts`). Every request goes to `/api/v1`, and errors surface as the API's RFC 9457 problem (`code`, title, details).

**No duplicated logic.** An ESLint rule forbids `@lintel/*` (engines, persistence, storage, types), `pg`, `@nestjs/*` and API sources in `apps/web`. The only local helpers are these (tested in `apps/web/test`):
- arranging the user's own cabinets edge to edge along wall A (user input, not construction logic);
- scaling the API's coordinates to SVG;
- formatting paise for display.

**Cabinet dimensions are never typed in.** Height and depth come from the pinned product definition's defaults, and the width hint shows the definition's limits.

**Pins.** A new design version pins, for each engineering type, the organization's newest APPROVED or LOCKED reference version. The reference-data API supplies these. If a type has none, the UI refuses and names the missing types.

**The preview is a drawing only.** The plan, the wall A elevation and the 3D axonometric view draw the resolved model's placements and component boxes exactly as `GET /design-versions/{id}/model` returns them.

## 3. Sign-in and people

**Supabase mode.** People sign in with email and password against Supabase Auth, using the project's publishable key (`VITE_SUPABASE_PUBLISHABLE_KEY`). The access token is sent as a Bearer token, and the API verifies it (issuer, audience, signature, `role`). No secret key is in the browser.

**LOCAL mode (`VITE_APP_ENV=local`).** People paste a token that `pnpm pilot:demo` minted with a per-machine local secret.

**Several people in one tab.** The pilot's roles belong to different people, so the header can switch between signed-in people. Sessions live in `sessionStorage` only.

**The API's grants decide what each role may do:**
- The designer authors and submits.
- The design head approves, and issues drawings.
- Sales creates projects, locks the design and issues quotations.
- Costing generates pricing and the quotation.

**Quotation hand-over.** By the existing grants, Sales may issue a quotation (`quotation.issue`) but cannot read cost outputs (`output.read.cost`). Costing's quotation view therefore shows a hand-over code with four values:
- the snapshot id;
- the content hash;
- the PricingStandard version;
- the QuotationPolicy version.

Sales pastes the code and issues exactly that content. The API checks the hash and the commercial versions.

## 4. Blockers and issue

**When a BLOCKER exists, these are all disabled:**
- submitting, approving and locking;
- the FOR_PRODUCTION purpose;
- issuing.

The API enforces the same rules independently: validation-run evidence, FOR_PRODUCTION purpose rules, and issue preconditions.

**Issued documents:**
- **Drawings.** Issued drawing files download through short-lived signed URLs. They are fetched and saved under the drawing number.
- **Quotation.** Every quotation has a real PDF (migration 0021, `renderQuotationPdf` in `@lintel/pricing-engine`), generated with the quotation snapshot and sealed into its file manifest like drawing files. Cost readers download it from screen 8 through a signed URL (`GET /quotation-snapshots/{id}/files`). Sales issues through the hand-over code and receives the PDF from Costing.

## 5. Verification

- `apps/web/test/geometry.test.ts` covers the helpers.
- `pnpm typecheck` includes `apps/web`, and `pnpm lint` applies the import boundary.
- `pnpm pilot:ui-e2e` drives all 8 screens in Chromium against `pnpm pilot:demo`. Five people take part: Sales, Site engineer, Designer, Design head and Costing. The run goes from project creation to issued quotation and drawings, and downloads a PDF. It was run locally for this checkpoint; CI runs the API-level rehearsal, `apps/api/test/db/pilot-rehearsal.test.ts`.

## 6. Known limits

- Only one run on wall A, with rotation 0. The API supports more, but the pilot scope does not.
- Session handling is minimal: there is no refresh-token rotation, and a Supabase access token (1 h by default) needs a new sign-in after it expires.
