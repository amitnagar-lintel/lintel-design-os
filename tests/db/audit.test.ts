/** Append-only SHA-256 audit chain (requirement F). */
import { describe, expect, it } from "vitest";
import { actAs, attempt, one, tx } from "./support/db.js";
import { constructionStandard, createWorld, transition } from "./support/world.js";

describe("audit log", () => {
  it("records who, what, when, why, with only changed columns for updates, and the chain verifies", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await constructionStandard(c, w);
      await transition(c, w, "PRODUCTION", "construction_standard", id, "SUBMIT", "ready for review");
      await actAs(c, null);
      const entry = await one<{ actor_user_id: string; action: string; reason: string; old_value: Record<string, unknown>; new_value: Record<string, unknown> }>(c,
        "SELECT actor_user_id, action, reason, old_value, new_value FROM design_os.audit_log WHERE table_name = 'construction_standard_version' AND action = 'UPDATE' AND row_id = $1", [id]);
      expect(entry).toMatchObject({ actor_user_id: w.users.PRODUCTION, action: "UPDATE", reason: "ready for review" });
      expect(Object.keys(entry.new_value).sort()).toEqual(["row_version", "status", "submitted_at", "submitted_by"]);
      expect(entry.old_value).toMatchObject({ status: "DRAFT", submitted_by: null });
      const v = await one<{ ok: boolean; checked: number; first_bad_id: number | null }>(c, "SELECT * FROM design_os.verify_audit_chain($1)", [w.org]);
      expect(v.ok).toBe(true);
      expect(v.checked).toBeGreaterThan(20);
      expect(v.first_bad_id).toBeNull();
    });
  });
  it("has no update, delete or truncate path (not even for the migration superuser)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await constructionStandard(c, w);
      await actAs(c, null);
      expect((await attempt(c, () => c.query("UPDATE design_os.audit_log SET reason = 'rewritten' WHERE org_id = $1", [w.org])))?.message).toContain("insert-only");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.audit_log WHERE org_id = $1", [w.org])))?.message).toContain("insert-only");
      expect((await attempt(c, () => c.query("TRUNCATE design_os.audit_log")))?.message).toContain("TRUNCATE is not allowed");
      await actAs(c, w.actor("ADMIN"), { apiRole: true });
      expect((await attempt(c, () => c.query("INSERT INTO design_os.audit_log (occurred_at, action, table_name, row_hash) VALUES (now(), 'INSERT', 'x', 'sha256:' || repeat('0', 64))")))?.message).toContain("permission denied");
      expect((await attempt(c, () => c.query("DELETE FROM design_os.audit_log")))?.message).toContain("permission denied");
    });
  });
  it("detects tampering that bypasses the triggers", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await constructionStandard(c, w);
      await actAs(c, null);
      const target = (await one<{ id: number }>(c, "SELECT min(id)::int AS id FROM design_os.audit_log WHERE org_id = $1", [w.org])).id;
      await c.query("ALTER TABLE design_os.audit_log DISABLE TRIGGER forbid_mutation");
      await c.query("UPDATE design_os.audit_log SET reason = 'tampered' WHERE id = $1", [target]);
      await c.query("ALTER TABLE design_os.audit_log ENABLE TRIGGER forbid_mutation");
      const v = await one<{ ok: boolean; first_bad_id: number }>(c, "SELECT * FROM design_os.verify_audit_chain($1)", [w.org]);
      expect(v).toMatchObject({ ok: false, first_bad_id: target });
    });
  });
  it("each organization has its own chain", async () => {
    await tx(async (c) => {
      const a = await createWorld(c);
      const b = await createWorld(c);
      await constructionStandard(c, a);
      await constructionStandard(c, b);
      await actAs(c, null);
      for (const org of [a.org, b.org]) expect((await one<{ ok: boolean }>(c, "SELECT ok FROM design_os.verify_audit_chain($1)", [org])).ok).toBe(true);
      const first = await one<{ prev_hash: string | null }>(c, "SELECT prev_hash FROM design_os.audit_log WHERE org_id = $1 ORDER BY id LIMIT 1", [b.org]);
      expect(first.prev_hash).toBeNull();
    });
  });
});
