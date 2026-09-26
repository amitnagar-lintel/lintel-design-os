/**
 * Lifecycle of imported reference data, only through the existing database workflow (design_os.transition()):
 * SUBMIT by an author, APPROVE by a different, authorised approver who states the exact content hash they reviewed.
 * The database enforces the permissions, separation of duties, the reviewed hash, dependency lifecycles and the
 * completeness / source-verification preconditions; this module adds nothing to them and bypasses none of them.
 */
import type pg from "pg";
import type { IntakeType } from "./spec.js";
import type { TokenVerifier } from "./approver-token.js";
import { InvalidTokenError } from "./approver-token.js";
import type { Actor } from "./importer.js";
import { actAs, resolveActor, TABLES } from "./importer.js";

/** An active internal member of the organization by their authenticated user id (as the owner; read-only lookup). */
async function resolveActorById(client: pg.ClientBase, orgCode: string, userId: string): Promise<Actor | null> {
  await client.query("SET LOCAL ROLE design_os_owner");
  const r = await client.query<{ org_id: string; user_id: string; email: string }>(`SELECT o.id AS org_id, u.id AS user_id, u.email
    FROM design_os.organization o JOIN design_os.org_membership m ON m.org_id = o.id JOIN design_os.app_user u ON u.id = m.user_id
    WHERE o.code = $1 AND o.status = 'ACTIVE' AND u.id = $2 AND u.identity_kind = 'INTERNAL' AND u.status = 'ACTIVE' AND m.status = 'ACTIVE' LIMIT 1`, [orgCode, userId]);
  await client.query("RESET ROLE");
  const row = r.rows[0];
  return row === undefined ? null : { orgId: row.org_id, userId: row.user_id, email: row.email };
}

export interface VersionState {
  readonly type: string;
  readonly entityCode: string;
  readonly versionNumber: number;
  readonly versionId: string;
  readonly status: string;
  readonly contentHash: string;
  readonly createdBy: string;
  readonly submittedBy: string | null;
  readonly approvedBy: string | null;
  readonly effectiveFrom: string | null;
  /** What the database's approval preconditions would refuse today (empty = approvable content). */
  readonly approvalProblems: readonly { readonly code: string; readonly message: string }[];
}

export type LifecycleOutcome =
  | { readonly outcome: "DONE"; readonly action: "SUBMIT" | "APPROVE"; readonly before: VersionState; readonly after: VersionState; readonly actor: string; readonly actorUserId: string; readonly authenticated: boolean; readonly operator: string }
  | { readonly outcome: "REFUSED"; readonly action: "SUBMIT" | "APPROVE"; readonly code: string; readonly message: string; readonly state: VersionState | null };

/** Read one exact version and its approval preconditions (as the owner: read-only). */
export async function versionState(client: pg.ClientBase, orgCode: string, type: IntakeType, entityCode: string, versionNumber: number): Promise<VersionState | null> {
  const t = TABLES[type];
  await client.query("BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL ROLE design_os_owner");
    const r = await client.query<{ id: string; org_id: string; status: string; content_hash: string; created_by: string; submitted_by: string | null; approved_by: string | null; effective_from: string | null }>(
      `SELECT v.id, v.org_id, v.status::text AS status, v.content_hash, v.created_by, v.submitted_by, v.approved_by, to_char(v.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from
       FROM design_os.${t.version} v JOIN design_os.${t.entity} e ON e.id = v.entity_id AND e.org_id = v.org_id JOIN design_os.organization o ON o.id = e.org_id
       WHERE o.code = $1 AND e.code = $2 AND v.version_number = $3`, [orgCode, entityCode, versionNumber]);
    const row = r.rows[0];
    if (row === undefined) return null;
    const problems = await client.query<{ problem_code: string; problem_message: string }>("SELECT problem_code, problem_message FROM design_os.approval_problem_items($1, $2, $3)", [type, row.id, row.org_id]);
    return {
      type, entityCode, versionNumber, versionId: row.id, status: row.status, contentHash: row.content_hash, createdBy: row.created_by, submittedBy: row.submitted_by,
      approvedBy: row.approved_by, effectiveFrom: row.effective_from, approvalProblems: problems.rows.map((p) => ({ code: p.problem_code, message: p.problem_message })),
    };
  } finally {
    await client.query("ROLLBACK");
  }
}

export interface LifecycleOptions {
  readonly orgCode: string;
  readonly type: IntakeType;
  readonly entityCode: string;
  readonly versionNumber: number;
  /**
   * Who performs the transition. SUBMIT: the draft author named by the operator (`--as`), as for import. APPROVE: only
   * an AUTHENTICATED approver (their own Supabase Auth access token, verified); an operator-named email never approves.
   */
  readonly actor: { readonly kind: "named"; readonly email: string } | { readonly kind: "authenticated"; readonly token: string; readonly verify: TokenVerifier };
  readonly operator: string;
  readonly reason: string;
  /** APPROVE only: the exact content hash the approver reviewed. */
  readonly expectedContentHash?: string;
}

function sqlstate(e: unknown): string {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : "";
}

/**
 * SUBMIT or APPROVE one version through design_os.transition(). SUBMIT runs as the named draft author and is refused
 * while the approval preconditions report problems (an incomplete dataset is never put up for approval). APPROVE runs
 * only as the user whose Supabase Auth access token verifies, with that user's own membership; the database still
 * enforces the approve action, approver ≠ submitter and the reviewed content hash.
 */
export async function transitionVersion(client: pg.ClientBase, action: "SUBMIT" | "APPROVE", o: LifecycleOptions): Promise<LifecycleOutcome> {
  const refuse = (code: string, message: string, state: VersionState | null): LifecycleOutcome => ({ outcome: "REFUSED", action, code, message, state });
  const before = await versionState(client, o.orgCode, o.type, o.entityCode, o.versionNumber);
  if (before === null) return refuse("NOT_FOUND", `${o.type} ${o.entityCode} version ${String(o.versionNumber)} does not exist in ${o.orgCode}`, null);
  if (action === "SUBMIT" && before.approvalProblems.length > 0) return refuse("INCOMPLETE_PRODUCTION_DATA", "the version is not complete; resolve every approval problem first", before);
  if (action === "APPROVE" && o.actor.kind !== "authenticated") return refuse("AUTHENTICATED_APPROVER_REQUIRED", "APPROVE needs the approver's own authenticated identity (Supabase Auth access token); an operator-named email never approves", before);
  if (action === "APPROVE" && o.expectedContentHash === undefined) return refuse("CONTENT_HASH_REQUIRED", "APPROVE needs --expected-content-hash (the exact content the approver reviewed)", before);
  let authenticatedUserId: string | null = null;
  if (o.actor.kind === "authenticated") {
    try {
      authenticatedUserId = (await o.actor.verify(o.actor.token)).userId;
    } catch (e) {
      if (e instanceof InvalidTokenError) return refuse("APPROVER_NOT_AUTHENTICATED", e.message, before);
      throw e;
    }
  }

  await client.query("BEGIN");
  let actor: Actor | null;
  try {
    await client.query("SELECT set_config('design_os.reason', $1, true), set_config('design_os.request_id', $2, true)",
      [`${o.reason} (reference-data intake ${action} by operator ${o.operator})`, `intake:${action}:${before.versionId}`]);
    actor = authenticatedUserId !== null ? await resolveActorById(client, o.orgCode, authenticatedUserId) : o.actor.kind === "named" ? await resolveActor(client, o.orgCode, o.actor.email) : null;
    if (actor === null) {
      await client.query("ROLLBACK");
      const who = authenticatedUserId !== null ? `authenticated user ${authenticatedUserId}` : o.actor.kind === "named" ? o.actor.email : "?";
      return refuse("ACTOR_NOT_MEMBER", `${who} is not an active internal member of ${o.orgCode}`, before);
    }
    await actAs(client, actor);
    await client.query("SELECT design_os.transition($1, $2, $3, $4, $5)", [o.type, before.versionId, action, o.reason, action === "APPROVE" ? o.expectedContentHash ?? null : null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    const code = sqlstate(e);
    if (code.startsWith("LD")) return refuse(code, e instanceof Error ? e.message : String(e), before);
    throw e;
  }
  const after = await versionState(client, o.orgCode, o.type, o.entityCode, o.versionNumber);
  if (after === null) throw new Error("version disappeared after the transition");
  return { outcome: "DONE", action, before, after, actor: actor.email, actorUserId: actor.userId, authenticated: authenticatedUserId !== null, operator: o.operator };
}
