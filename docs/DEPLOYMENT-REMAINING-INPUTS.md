# Staging deployment — remaining inputs

Status 2026-09-27, main `8e6d174`. **Staging is not live yet.** Everything that can be prepared without an external account change or credential is prepared. This file lists exactly what is still missing, where each item is entered, and the command that follows. The operational steps themselves are in `docs/PILOT-TOMORROW.md` §4–§6 (the single source of truth).

No secret values appear here. Enter every secret directly into the secret store it belongs to. Never send one in chat, e-mail or a commit.

---

## What was checked on 2026-09-27

| Check | Result |
|---|---|
| Repository deployment configuration | None exists: only CI (`.github/workflows/ci.yml`). There is no Dockerfile or hosting manifest. |
| Lintel Ops hosting platform (`lintel-os-ops`, read only) | Static pages on **GitHub Pages** (`lintel-os` repo) and **Supabase Edge Functions**. There is **no Node server host**. GitHub Pages cannot run the NestJS API and cannot forward `/api`, so the Lintel Ops platform cannot host Design OS as specified. |
| Supabase organization "lintelspace" | Two projects, both Lintel Ops: `lintelspace` (ap-northeast-2, Seoul) and `lintelspace-mumbai` (ap-south-1). **Neither was touched.** |
| Creating the separate project `lintel-design-os-staging` (ap-south-1) | **Refused by Supabase**: "amitnagar-lintel (2 project limit)" — the organization is on the Free plan and already has 2 active projects. |
| Network from the engineering cloud session | HTTPS only. A direct Postgres connection (port 5432) is not possible from there, so migrations run from Amit's Mac (§I3). |
| Local verification of every command in PILOT-TOMORROW §3–§6 | Passed. The guards refuse production / pooler / hosted targets without `--confirm`, and the readiness commands pass against a production-shaped API (see PILOT-TOMORROW "Setup status"). |

---

## I1 — Supabase plan: room for the separate staging project (Amit)

- **Missing.** The organization "lintelspace" is at the Free plan's 2-active-project limit.
- **Where.** https://supabase.com/dashboard/org/wjwpqmywyqrnsjpuylhd/billing
- **Setting.** Upgrade the organization to **Pro**. The M6 plan already assumes Pro: daily backups, PITR for production, and the IPv4 add-on of I3.
- **Alternative.** Pause the older Seoul project `lintelspace` if Lintel Ops no longer uses it (see `lintel-os-ops/migrations/REGION-01_seoul_to_mumbai.md`). That is a Lintel Ops decision; engineering will not pause it.
- **Next action.** Tell engineering "plan upgraded". The project is then created: name `lintel-design-os-staging`, region **ap-south-1 (Mumbai)**, organization lintelspace. That can be done from the engineering session, or by Amit via Dashboard → New project.
- **Set the database password yourself** in the creation form. Store it only in your password manager; it is needed for I3.

## I2 — API hosting platform and account (Amit)

- **Missing.** A host for the NestJS API: Node ≥ 22.12, one long-running instance, HTTPS, environment secrets.
- **Where.** A new account or project on the chosen platform, with the GitHub repository `amitnagar-lintel/lintel-design-os` connected.
- **Setting.** Choose one:

| Option | Region | Fit |
|---|---|---|
| **Fly.io** (recommended) | `bom` (Mumbai), next to Supabase ap-south-1 | Container host; one machine; secrets via `fly secrets set` |
| Render | Singapore | Web service with a build command and a start command; secrets in the dashboard |
| Railway | Southeast Asia | Same model as Render |

- **API build and start** (any platform, from the repository root):
  ```sh
  # build
  corepack enable && pnpm install --frozen-lockfile && pnpm engines:manifest /app/engine-manifest.json
  # start
  pnpm --filter @lintel/api start
  ```
  Set `ENGINE_MANIFEST_PATH=/app/engine-manifest.json` and `BUILD_REVISION=<commit SHA>`. On Render / Railway use their commit variable; on Fly pass the SHA as a build argument. The API listens on `API_PORT` (default 3000).
- **UI host** — must forward `/api/*` to the API (a platform with rewrite / proxy rules; GitHub Pages cannot). Build command:
  ```sh
  pnpm install --frozen-lockfile && pnpm web:build
  ```
  Publish directory: `apps/web/dist`. Proxy rules:

  | Host | Rule |
  |---|---|
  | Netlify | `_redirects` in the publish directory: `/api/*  https://<api host>/api/:splat  200` |
  | Vercel | `vercel.json`: `{"rewrites":[{"source":"/api/:path*","destination":"https://<api host>/api/:path*"}]}` |

  Plus a single-page-app fallback: `/*  /index.html  200` on Netlify. The file is added once the platform is chosen; it is not added blindly.
- **Next action.** Tell engineering the chosen platform and give it deploy access (a GitHub integration on the platform, or a deploy token entered as a GitHub Actions secret). Engineering then adds the platform's one deployment file and nothing else.

## I3 — Database passwords and the migration connection (Amit)

- **Missing:**
  - the staging database password, set in I1;
  - a password for the API login role `design_os_api_login`, which Amit generates.
- **Where:**
  - on **Amit's Mac only**, for migrations and org init (`MIGRATION_DATABASE_URL`, the direct connection);
  - in the API host's secret store (`DATABASE_URL`).
- **Direct connection and IPv4.** Supabase's direct host `db.<ref>.supabase.co:5432` is **IPv6-only** unless the **IPv4 add-on** is enabled (Project Settings → Add-ons → IPv4, Pro plan). The migration runner refuses poolers by design.
  - If `nc -vz db.<ref>.supabase.co 5432` fails from the Mac, enable the IPv4 add-on on the staging project.
- **Next action,** on the Mac, in the repository:
  ```sh
  export MIGRATION_DATABASE_URL='postgresql://postgres:<db password>@db.<ref>.supabase.co:5432/postgres'
  pnpm -s db:migrate status                      # read-only: shows prerequisites
  pnpm -s db:migrate up --env staging --confirm <ref> --dry-run
  pnpm -s db:migrate up --env staging --confirm <ref>
  pnpm -s db:migrate status --check              # exit 0 = UP_TO_DATE
  ```
  Then, in Dashboard → SQL Editor, create the API login role (PILOT-TOMORROW §4.6):
  ```sql
  CREATE ROLE design_os_api_login LOGIN NOINHERIT PASSWORD '<api login password>';
  GRANT design_os_api TO design_os_api_login;
  ```
- **Known risk.** Migration 0002 runs `GRANT SELECT, REFERENCES ON auth.users TO design_os_owner`. On hosted Supabase this is gate item 9's first check. If it fails, the runner stops safely: the migration is transactional and the ledger is unchanged. The next step is then recorded as a genuine compatibility issue, not worked around.

## I4 — Supabase Auth settings (Amit or engineering, in the staging dashboard)

| Setting | Where | Value |
|---|---|---|
| Site URL | Authentication → URL Configuration | the staging UI origin (from I2) |
| Redirect URLs | same | the staging UI origin |
| New sign-ups | Authentication → Sign In / Providers → Email | **disable "Allow new users to sign up"**; users are created by the admin (PILOT-TOMORROW §3 step 2) |
| Confirm email | same | on |
| JWT signing keys | Project Settings → JWT Keys | asymmetric signing keys (the default for new projects). The API verifies them through `AUTH_JWKS_URL`; `AUTH_JWT_SECRET` is **not** set on staging |

## I5 — Storage secret key (Amit; B4)

- **Missing.** The dedicated secret key `design-os-api-storage`.
- **Where created.** Project Settings → API Keys → Secret keys → New secret key.
- **Where entered.** The API host's secret store only, as `SUPABASE_STORAGE_KEY`.
- **Bucket** (engineering, after I1): Storage → New bucket `design-os-outputs`:
  - private;
  - file-size limit 20 MB;
  - MIME types `application/pdf`, `image/svg+xml`.
- **Next action.** PILOT-TOMORROW §5 steps 1–4.

## I6 — Approved Lintel reference data (B1) — needed for the browser walkthrough past screen 4

- **Missing.** None of the 19 reference-data files is approved.
- **Why it matters on staging.** Staging never receives the LOCAL rehearsal dataset: the tools refuse any non-local database, and `pilot:check` fails if rehearsal data is found. Without approved data, a staging user can create a project and a kitchen (screens 2–3), but **cannot create a design version**, because a design version pins APPROVED data. Screens 4–8 therefore need the approved stage A + B data (and C for pricing, quotation and issue).
- **Next action.** PILOT-TOMORROW §1–§2: fill, validate, then import / submit / approve on staging.

---

## Environment-variable checklist (staging)

### Browser-safe — UI build only

| Variable | Value | Source |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | I1 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Project Settings → API Keys (publishable) |

The UI calls the API at `/api/v1` on its own origin, so no API URL is baked into the bundle. The proxy rule of I2 forwards `/api`. Verified: a bundle built with secret variables in the environment contains none of them.

### Server-only — API host secret store

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://design_os_api_login.<ref>:<api login password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` (session pooler; I3) |
| `DB_POOL_MAX` | 5 |
| `API_PORT` | the platform's port (default 3000) |
| `AUTH_ISSUER` | `https://<ref>.supabase.co/auth/v1` |
| `AUTH_AUDIENCE` | `authenticated` |
| `AUTH_JWKS_URL` | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `CURSOR_SECRET` | 32+ random characters (`openssl rand -hex 32`) |
| `CORS_ORIGINS` | the staging UI origin |
| `BUILD_REVISION` | the deployed commit SHA |
| `ENGINE_MANIFEST_PATH` | `/app/engine-manifest.json` (written at build) |
| `FILE_STORAGE` | `supabase` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_STORAGE_BUCKET` | `design-os-outputs` |
| `SUPABASE_STORAGE_KEY` | the I5 secret key |
| `FILE_URL_SECRET` | 32+ random characters (required by the configuration check even with Supabase Storage) |
| `FILE_URL_BASE` | the public API origin (same reason) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT=staging` | optional: the staging Sentry project |
| `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_READ_MAX`, `RATE_LIMIT_WRITE_MAX`, `RATE_LIMIT_SENSITIVE_MAX` | set explicitly; start with 60 / 600 / 600 / 120 / 20 |
| `TRUST_PROXY_HOPS` | 1 behind the platform's load balancer |

### Operator-only — Amit's Mac, never on the API host

| Variable | Value |
|---|---|
| `MIGRATION_DATABASE_URL` | the direct connection of I3 |
| `AUTH_ISSUER`, `AUTH_JWKS_URL` | as above (for `db:intake approve`) |

---

## After I1–I5: deploy and verify (engineering, with Amit present for the secret entries)

1. **Migrations and API login role:** I3.
2. **Auth settings:** I4.
3. **Storage bucket:** I5.
4. **Deploy the API** (I2) and run `curl https://<api>/api/v1/ready`. It must return 200 with database, migrations and engineManifest all `pass`.
5. **Deploy the UI** with its `/api` proxy (I2) and run `curl https://<ui>/api/v1/ready`. It must return the same 200.
6. **Organization:**
   - create the 3 Supabase Auth users (Dashboard → Authentication → Users → Add user);
   - run `pnpm -s db:org init --env staging --confirm <ref> --code STAGING-TEST …` from the Mac;
   - onboard the users as in PILOT-TOMORROW §3.
7. **Reference-data API check** (the list may still be empty):
   ```sh
   curl -H "authorization: Bearer $(cat admin.token)" https://<ui>/api/v1/reference-data
   ```
8. **Readiness:**
   ```sh
   PILOT_ENV=STAGING MIGRATION_DATABASE_URL=… PILOT_API_URL=https://<api> PILOT_WEB_URL=https://<ui> \
   PILOT_ACCESS_TOKEN="$(cat admin.token)" pnpm pilot:check --confirm <ref> --org STAGING-TEST
   ```
   Before B1 data exists, only the `data.*` checks may fail.
9. **Browser walkthrough.** Open https://<ui> on the Mac and sign in with a staging user:
   - screens 2–3 work at once;
   - screens 4–8 (design, validation, BOM, BOQ, pricing, quotation, drawings, issue, PDF downloads, including signed Supabase Storage URLs) work once the I6 data is approved.

**The staging URL** is the UI origin from I2. It exists after step 5.

---

## Production checklist (not started; do not deploy until every item is ticked)

- [ ] Staging steps 1–9 all passed, with evidence recorded, including a full screens 2–8 walkthrough with approved data.
- [ ] **Human approvals:**
  - M6-5 ops confirmation;
  - M6-6 hosted access;
  - M6-7 gate item 9 evidence;
  - M6-8 staging service live;
  - M6-10 production data approved by the named approvers;
  - M6-11 production environment.
- [ ] **Production Supabase project:** separate from staging and from Lintel Ops, ap-south-1, Pro plan, IPv4 add-on if needed.
- [ ] **PITR** enabled on the production project.
- [ ] **Restore drill** passed: restore to a timestamp into a separate project, check the rows before and after, record the recovery time.
- [ ] **Production secrets:** a fresh set of every server-only variable above, never reused from staging. A separate storage secret key. Separate Sentry project.
- [ ] **Production domain:** UI origin and API origin with HTTPS. Auth Site URL / redirect URLs set to the production UI origin.
- [ ] **Final readiness:** PILOT-TOMORROW §6 checks 1–4 all pass, including `pilot:check` printing `READY (PRODUCTION)`.
- [ ] **Rollback procedure recorded:**
  - **Application:** redeploy the previous commit SHA on the API and UI hosts.
  - **Database:** migrations are forward-only in production. Before each `db:migrate up`, take `pg_dump --schema=design_os` (kept 30 days). A failed migration leaves the ledger unchanged (transactional). For data loss, use PITR restore to the last good timestamp.
  - **Storage:** issued files are never deleted; restore missing objects from the nightly bucket copy.
