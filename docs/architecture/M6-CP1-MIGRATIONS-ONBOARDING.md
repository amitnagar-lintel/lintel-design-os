# M6 checkpoint 1 — production migration runner (G6) and organization onboarding (G4)

Status: implemented for review (gate M6-1). The plan is `M6-V1-GO-LIVE-READINESS-PLAN.md` §9.1.

**Not in this checkpoint:**
- G1, G2, G3, G5, G7;
- UI;
- hosted Supabase;
- production data;
- manufacturing;
- client portal.

## 1. G6 — production migration runner (`apps/db-tools`)

**What it is:**
- **Its own workspace package and deployable tool.** It has its own connection variable (`MIGRATION_DATABASE_URL`) and is independent of the API service and of Lintel Ops (OD-M6-1).
- **The existing tracking mechanism, unchanged.** The ledger is `design_os_migrations.applied (version, name, checksum = SHA-256 of the up file, applied_at)`, as before.
- **The migrations are unchanged.** Every existing file is applied byte for byte. The test suite's own migrator now delegates to this runner, so all 330 database tests run on a schema the runner built. The schema snapshot is identical, and the migration up → down → up and drift tests pass.

**Behaviour:**

| Requirement | How |
|---|---|
| Works against hosted Supabase / Postgres | Plain `pg` over the connection URL (TLS through `sslmode`). It needs no superuser. It checks the Supabase prerequisites (`auth.users`, `auth.uid()`, the right to create the two roles before 0001). The lock is transaction-scoped, so it works through a pooler |
| Detects already-applied migrations | Reads the ledger under the lock before every migration; applies only what follows the last applied version |
| Fails closed on drift | `CHECKSUM_MISMATCH`, `NAME_MISMATCH`, `UNKNOWN_APPLIED` and `OUT_OF_ORDER` stop the runner before it writes anything. The check repeats before every migration |
| Forward execution | `up [--to NNNN] [--dry-run]`; one transaction per migration together with its ledger row. A failure rolls back that migration only, and is reported |
| Readout for automation | `status [--check] [--json]` and `up --json` |
| Wrong-target protection | `--env`; staging and production require `--confirm <project-ref>`; `local` / `ci` refuse a Supabase URL |
| No business logic | The runner executes files and writes ledger rows only |

**Exit codes:** 0 OK, 1 failed, 2 drift, 3 pending (`status --check`), 4 refused, 64 usage.

## 2. G4 — organization and user onboarding

### 2.1 Model (migration 0019, declarative only: table, constraints, RLS policies, grants; no trigger, no PL/pgSQL)

**`design_os.org_invitation` columns:**
- org;
- normalized email;
- display name (the name on approvals, title blocks and the audit trail);
- `roles` (1–9 distinct INTERNAL roles; CLIENT is refused by constraint);
- status PENDING / ACCEPTED / REVOKED, with state columns kept coherent by a constraint;
- `invited_by` (NULL only for the operator's first-ADMIN invitation);
- 14-day expiry.

At most one PENDING invitation per org and email.

**Row-level security:**

| Who | May |
|---|---|
| An administrator (`org.members.manage`) of the **selected** organization | Invite (as themselves), list, read and revoke that organization's invitations |
| The signed-in person whose **Supabase Auth email** (`auth.users`, via `current_auth_email()`) matches a PENDING, unexpired invitation | See that invitation. Insert their **own** `app_user` row (INTERNAL, ACTIVE, that email, the administrator-given name). Insert, or re-activate, exactly the invited role memberships in that organization, recorded as `granted_by` = the inviter. Mark the invitation ACCEPTED |
| Anyone else | Nothing |

**Grants:** `app_user` stays read-only for the API except this self-provisioning insert of `(id, email, display_name, identity_kind)`. Invitations are insert + state-column update only; they are never deleted.

**Unchanged:**
- the 10 roles and the role → action grants;
- `current_org_id()` / `current_memberships()`;
- the membership identity guard (a CLIENT identity can never hold an internal role, LD018);
- the audit hash chain (every insert and update above is audited, with actor and reason);
- all existing policies.

### 2.2 Flows

1. **Organization initialisation:** `pnpm -s db:org init` (operator, `design_os_owner`, audited). It creates the organization and a PENDING ADMIN invitation, and is idempotent.
2. **Invite:** `POST /api/v1/org/invitations` `{ email, displayName, roles[] }` (`org.members.manage`). If a PENDING invitation for the same email has expired, it is closed first (audited).
3. **Accept, on first sign-in:**
   - `GET /api/v1/me/invitations` lists the invitations, then `POST /api/v1/me/invitations/{id}/accept` accepts one. No organization context is involved.
   - Both routes require `email_verified` in the access token. That email and the Supabase Auth record must both equal the invited address.
   - One transaction provisions the identity, the invited memberships and the acceptance.
   - Accepting again returns the same result.
4. **Select the organization:** `X-Org` accepts only the person's own ACTIVE memberships. This is unchanged: a user can never select or impersonate an organization they do not belong to.
5. **Manage roles:** `POST /api/v1/org/members/{userId}/roles` and `…/roles/revoke`. Both require `org.members.manage` and a reason.
   - They apply to existing members only; new people join only through an invitation.
   - The last active ADMIN cannot be removed (409 `LAST_ADMIN`).
6. **Named people:** `GET /api/v1/org/members` and `…/members/{userId}` list the display names, emails, current roles and membership history. Any internal member can read them, bounded by RLS.

### 2.3 Endpoints added (`/api/v1`)

| Method & path | Access | Result |
|---|---|---|
| `POST /org/invitations` | `org.members.manage` | 201 invitation · 409 `DUPLICATE_RESOURCE` · 400 |
| `GET /org/invitations?status=&limit=&cursor=` | `org.members.manage` | 200 page |
| `GET /org/invitations/{invitationId}` | `org.members.manage` | 200 · 404 |
| `POST /org/invitations/{invitationId}/revoke` | `org.members.manage` | 200 · 410 `INVITATION_INVALID` · 404 |
| `GET /org/members` | internal member | 200 |
| `GET /org/members/{userId}` | internal member | 200 · 404 |
| `POST /org/members/{userId}/roles` | `org.members.manage` | 200 · 409 `DUPLICATE_RESOURCE` / `MEMBERSHIP_RULE_VIOLATION` · 404 |
| `POST /org/members/{userId}/roles/revoke` | `org.members.manage` | 200 · 409 `LAST_ADMIN` · 404 |
| `GET /me/invitations` | authenticated, no org, verified email | 200 · 403 `EMAIL_NOT_VERIFIED` |
| `POST /me/invitations/{invitationId}/accept` | authenticated, no org, verified email | 200 · 403 · 404 · 409 · 410 |

There are two new problem codes: `EMAIL_NOT_VERIFIED` (403) and `LAST_ADMIN` (409). The OpenAPI document gains 9 paths and 10 schemas; no existing path changed.

### 2.4 Named submitter / approver

- Every person has a distinct identity with an administrator-given name.
- Separation of duties is still enforced by the database (`transition()`, LD004): the submitter can never approve their own submission, even when they hold both DESIGNER and DESIGN_HEAD.
- The API test onboards two people, and proves that one submits and the other approves. The version records `submitted_by` ≠ `approved_by`.

### 2.5 Clients (compatible with the later portal, not built)

- CLIENT identities are **never** invited here: the invitation roles exclude CLIENT, and the existing guard refuses an internal role for a CLIENT identity.
- The existing client-contact path is unchanged: `client_contact` INVITED → ACTIVE, `project_member` CLIENT, and `client_can_read_file`. The client portal will add its own acceptance for contacts.

## 3. Remaining risks / notes

- **Hosted behaviour not yet verified** (gate M6-7, on staging only). Checks still to run on staging:
  - whether the migration user may `GRANT SELECT, REFERENCES ON auth.users` (0002) and create roles;
  - that `auth.users.email` is the verified sign-in email for the enabled providers;
  - that the pooler URL form is recognised by the `--confirm` guard.
- **Email is the invitation key.** A person whose Supabase Auth email changes after the invitation must be re-invited. Email ownership relies on Supabase Auth's email confirmation, and the API additionally requires `email_verified`.
- **Invitations are not emailed by Design OS.** V1 relies on the administrator telling the person to sign in, or on the Supabase Auth invite email sent by ops. The API never holds the `service_role` key.
- **The last-ADMIN rule is an application rule** (serialized with row locks), not a database constraint. An operator can re-issue an ADMIN invitation with `db:org init` if an organization ever loses its last ADMIN.
- **The member list is not paginated.** It is sized for V1 organizations (tens of people).
