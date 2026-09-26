/**
 * Organization initialisation (M6 G4): the one operation that needs no existing member. It creates an organization
 * (its role → action grants are seeded by the existing 0002 trigger from the default grants) and a PENDING invitation
 * for its first ADMIN. Nothing else: the first ADMIN accepts through the API like everyone else, and every later
 * person is invited by an ADMIN through the API.
 *
 * Idempotent: the same code, name and admin email again change nothing and report the current state. A different
 * name for an existing code is refused. Runs as design_os_owner (like the migrations), in one audited transaction,
 * and only on a database whose migrations are exactly up to date.
 */
import type pg from "pg";
import type { Migration } from "./migrations.js";
import { status } from "./runner.js";
import { RefusedError } from "./target.js";

export interface OrgInitInput {
  readonly code: string;
  readonly name: string;
  readonly adminEmail: string;
  readonly adminName: string;
}

export type OrgInitResult =
  | { readonly outcome: "CREATED" | "INVITATION_CREATED" | "INVITATION_PENDING" | "ALREADY_INITIALISED"; readonly orgId: string; readonly invitationId: string | null }
  | { readonly outcome: "REFUSED"; readonly reason: string };

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

export function validateOrgInit(i: OrgInitInput): OrgInitInput {
  const code = i.code.trim();
  const name = i.name.trim();
  const adminEmail = i.adminEmail.trim().toLowerCase();
  const adminName = i.adminName.trim();
  if (!CODE.test(code)) throw new RefusedError("USAGE", "--code: 1-64 characters: letters, digits, _ . -");
  if (name === "" || name.length > 200) throw new RefusedError("USAGE", "--name: 1-200 characters");
  if (!EMAIL.test(adminEmail) || adminEmail.length > 320) throw new RefusedError("USAGE", "--admin-email: an email address");
  if (adminName === "" || adminName.length > 200) throw new RefusedError("USAGE", "--admin-name: 1-200 characters");
  return { code, name, adminEmail, adminName };
}

export async function orgInit(client: pg.ClientBase, migrations: readonly Migration[], raw: OrgInitInput, operator: string): Promise<OrgInitResult> {
  const input = validateOrgInit(raw);
  const s = await status(client, migrations);
  if (s.state !== "UP_TO_DATE") return { outcome: "REFUSED", reason: `migrations are ${s.state}; run db:migrate first` };

  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('design_os.reason', $1, true), set_config('design_os.request_id', $2, true)",
      [`organization initialised by operator ${operator}`, `org-init:${input.code}`]);
    await client.query("SET LOCAL ROLE design_os_owner");
    // Serialize concurrent initialisations of the same code.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('design_os.org_init:' || $1, 0))", [input.code]);

    let outcome: "CREATED" | "INVITATION_CREATED" | "INVITATION_PENDING" | "ALREADY_INITIALISED" = "CREATED";
    const existing = (await client.query<{ id: string; name: string }>("SELECT id, name FROM design_os.organization WHERE code = $1", [input.code])).rows[0];
    let orgId: string;
    if (existing === undefined) {
      orgId = (await client.query<{ id: string }>("INSERT INTO design_os.organization (code, name) VALUES ($1, $2) RETURNING id", [input.code, input.name])).rows[0]?.id ?? "";
    } else {
      if (existing.name !== input.name) {
        await client.query("ROLLBACK");
        return { outcome: "REFUSED", reason: `organization ${input.code} exists with the name "${existing.name}"` };
      }
      orgId = existing.id;
      const admins = await client.query("SELECT 1 FROM design_os.org_membership WHERE org_id = $1 AND role = 'ADMIN' AND status = 'ACTIVE'", [orgId]);
      if ((admins.rowCount ?? 0) > 0) {
        await client.query("COMMIT");
        return { outcome: "ALREADY_INITIALISED", orgId, invitationId: null };
      }
      outcome = "INVITATION_CREATED";
    }

    const pending = (await client.query<{ id: string; email: string; open: boolean }>(
      "SELECT id, email, expires_at > now() AS open FROM design_os.org_invitation WHERE org_id = $1 AND status = 'PENDING' AND 'ADMIN' = ANY (roles)", [orgId])).rows;
    const open = pending.find((p) => p.open);
    if (open !== undefined) {
      await client.query("COMMIT");
      if (open.email !== input.adminEmail) return { outcome: "REFUSED", reason: `a PENDING ADMIN invitation for another email (${open.email}) exists` };
      return { outcome: "INVITATION_PENDING", orgId, invitationId: open.id };
    }
    // Expired ADMIN invitations are closed before a new one is written (one PENDING invitation per email).
    for (const p of pending) await client.query("UPDATE design_os.org_invitation SET status = 'REVOKED', revoked_at = now() WHERE id = $1", [p.id]);
    const invitationId = (await client.query<{ id: string }>(
      "INSERT INTO design_os.org_invitation (org_id, email, display_name, roles) VALUES ($1, $2, $3, '{ADMIN}') RETURNING id", [orgId, input.adminEmail, input.adminName])).rows[0]?.id ?? null;
    await client.query("COMMIT");
    return { outcome, orgId, invitationId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
