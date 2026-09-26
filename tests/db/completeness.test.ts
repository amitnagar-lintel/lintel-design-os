/**
 * Structurally empty or unverified production reference versions can never become APPROVED.
 * Rules are domain-specific (see design_os.approval_problems in 0008), not a generic row count.
 */
import { describe, expect, it } from "vitest";
import type { Tx } from "./support/db.js";
import { attempt, one, tx } from "./support/db.js";
import type { World } from "./support/world.js";
import {
  approve,
  catalogVersion,
  createWorld,
  dependencies,
  designVersion,
  edgeBandItem,
  edgeBandStandard,
  hashOf,
  hettichDataset,
  insertManufacturingPin,
  manufacturingStandard,
  pricingStandard,
  quotationPolicy,
  statusOf,
  transition,
  validationRun,
  AUTHOR,
} from "./support/world.js";

/** SUBMIT as the author, then try APPROVE as the approver; returns the refusal message (or null when approved). */
async function tryApprove(c: Tx, w: World, subject: string, id: string): Promise<string | null> {
  const roles = AUTHOR[subject];
  if (roles === undefined) throw new Error(subject);
  await transition(c, w, roles[0], subject, id, "SUBMIT");
  const err = await attempt(c, async () => transition(c, w, roles[1], subject, id, "APPROVE", "approve", await hashOf(c, subject, id)));
  return err?.message ?? null;
}

describe("EdgeBandStandard", () => {
  it("an empty EdgeBandStandard (the production draft: a rule set with no rules) cannot be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await edgeBandStandard(c, w);
      const msg = await tryApprove(c, w, "edge_band_standard", id);
      expect(msg).toContain("EdgeBandStandard has no edge rules");
      expect(msg).toContain("edge rule set CARCASS_STANDARD has no edge rules");
      expect(await statusOf(c, "edge_band_standard", id)).toBe("IN_REVIEW");
    });
  });
  it("rules that reference an edge band without an APPROVED version cannot be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      await edgeBandItem(c, w);
      const id = await edgeBandStandard(c, w, { complete: true });
      expect(await tryApprove(c, w, "edge_band_standard", id)).toMatch(/edge band EDGE_[A-Z0-9_]+ has no APPROVED or LOCKED version/);
    });
  });
  it("with at least one rule and approved edge bands it can be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const band = await edgeBandItem(c, w);
      await approve(c, w, "edge_band", band.versionId);
      const id = await edgeBandStandard(c, w, { complete: true });
      expect(await tryApprove(c, w, "edge_band_standard", id)).toBeNull();
    });
  });
});

describe("Hettich dataset", () => {
  it("an empty dataset (no articles) cannot be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await hettichDataset(c, w);
      expect(await tryApprove(c, w, "hettich_dataset", id)).toContain("Hettich dataset has no articles");
    });
  });
  it.each([
    [{ url: "https://example.com/not-hettich" }, "Hettich record DBTEST-REC-1 is not source-verified"],
    [{ licence: "UNKNOWN" as const }, "Hettich record DBTEST-REC-1 licence is UNKNOWN"],
    [{ articleNumber: "FIXTURE-HINGE-1" }, "Hettich record DBTEST-REC-1 is a fixture article"],
    [{ withRule: false }, "Hettich hinge family DBTEST_FAMILY has no calculation rule"],
  ])("unverified state blocks approval: %o", async (over, message) => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await hettichDataset(c, w, { complete: true, hettich: over });
      expect(await tryApprove(c, w, "hettich_dataset", id)).toContain(message);
    });
  });
  it("a dataset whose records are in the required source-verification state can be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await hettichDataset(c, w, { complete: true });
      expect(await tryApprove(c, w, "hettich_dataset", id)).toBeNull();
    });
  });
});

describe("ManufacturingStandard", () => {
  it("cannot be approved until its variable/value model is defined (registry is empty; no codes are invented)", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      expect((await one<{ n: number }>(c, "SELECT count(*)::int AS n FROM design_os.manufacturing_variable")).n).toBe(0);
      const id = await manufacturingStandard(c, w);
      expect(await tryApprove(c, w, "manufacturing_standard", id)).toContain("ManufacturingStandard has no defined variable model yet");
    });
  });
  it("is use-blocked: a design version pinning it cannot be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const deps = await dependencies(c, w);
      const d = await designVersion(c, w, deps, { withRun: false });
      const mfg = await insertManufacturingPin(c, w, d.designVersionId);
      await validationRun(c, w, d.designVersionId, d.inputHash, 0);
      await transition(c, w, "DESIGNER", "design", d.designVersionId, "SUBMIT");
      const err = await attempt(c, async () => transition(c, w, "DESIGN_HEAD", "design", d.designVersionId, "APPROVE", "x", await hashOf(c, "design", d.designVersionId)));
      expect(err?.message).toContain(`manufacturingStandardVersionId ${mfg} is DRAFT`);
    });
  });
});

describe("PricingStandard and QuotationPolicy stay unapprovable while production values are absent", () => {
  it("the production PricingStandard draft (NULL rules and rates) cannot be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const msg = await tryApprove(c, w, "pricing_standard", await pricingStandard(c, w));
      expect(msg).toContain("pricing rules contain NULL / UNVERIFIED values");
      expect(msg).toContain("rate BOARD_M2 BOARD_BWP_18 is NULL / UNVERIFIED");
    });
  });
  it("the production QuotationPolicy draft (no tax rates, NULL fields) cannot be approved", async () => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const msg = await tryApprove(c, w, "quotation_policy", await quotationPolicy(c, w));
      expect(msg).toContain("quotation policy contains NULL / UNVERIFIED fields");
      expect(msg).toContain("quotation policy has no tax rates");
    });
  });
});

describe("catalog versions", () => {
  it.each(["material", "finish", "hardware", "appliance", "product"])("an empty %s catalog version cannot be approved", async (domain) => {
    await tx(async (c) => {
      const w = await createWorld(c);
      const id = await catalogVersion(c, w, domain, []);
      expect(await tryApprove(c, w, `${domain}_catalog`, id)).toContain(`${domain}_catalog version has no items`);
    });
  });
});
