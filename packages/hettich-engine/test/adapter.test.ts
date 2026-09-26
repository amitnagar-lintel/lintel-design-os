import { describe, expect, it } from "vitest";
import type { FittingSituation, HardwareRequirement } from "@lintel/types";
import type { HettichFixtureDataset } from "../src/index.js";
import { HETTICH_PRODUCTION_DATASET, HETTICH_TEST_FIXTURE_DATASET, calculateQuantity, createHettichAdapter, findCompatibleArticles, usableData } from "../src/index.js";

const FIXTURE = usableData(HETTICH_TEST_FIXTURE_DATASET);

const situation = (over: Partial<FittingSituation> = {}): FittingSituation => ({
  application: "HINGED_DOOR",
  cabinetType: "BASE_CABINET",
  componentType: "SHUTTER",
  mounting: "FULL_OVERLAY",
  doorWidth: 297,
  doorHeight: 717,
  doorThickness: 18,
  doorMaterialId: "BOARD_HDHMR_18",
  doorWeightKg: null,
  openingAngleRequired: null,
  availableDepth: 560,
  ...over,
});
const requirement = (over: Partial<FittingSituation> = {}): HardwareRequirement => ({
  requirementId: "OBJ-KIT-001-SHT-L-HINGE",
  sourceObjectId: "obj_001",
  sourceComponentId: "OBJ-KIT-001-SHT-L",
  hardwareRuleId: "HINGE_SHUTTER",
  category: "HINGE",
  preferredManufacturer: "HETTICH",
  fittingSituation: situation(over),
});

describe("PRODUCTION dataset (empty until source-verified records exist)", () => {
  it("never invents an article: requirement stays UNRESOLVED with a BLOCKER", () => {
    const r = createHettichAdapter(HETTICH_PRODUCTION_DATASET).resolve(requirement());
    expect(r.status).toBe("UNRESOLVED");
    expect(r.lines).toEqual([]);
    expect(r.messages.map((m) => [m.code, m.severity])).toEqual([["HARDWARE_DATA_UNAVAILABLE", "BLOCKER"]]);
    expect(r.dataset).toEqual({ datasetId: "HETTICH_PRODUCTION", classification: "PRODUCTION", manufacturer: "HETTICH", sourceVersion: "none-loaded", authoritative: true });
  });
});

describe("compatibility engine (test fixture data)", () => {
  it("filters by mounting and ranks by preference, then article number", () => {
    const { compatible, rejected } = findCompatibleArticles(FIXTURE, requirement());
    expect(compatible.map((a) => a.articleNumber)).toEqual(["FIXTURE-HINGE-FO-A", "FIXTURE-HINGE-FO-B"]);
    expect(rejected["FIXTURE-HINGE-IN-A"]).toMatch(/mounting INSET/);
  });
  it("switches article when mounting changes (PRD §43 test D)", () => {
    const { compatible } = findCompatibleArticles(FIXTURE, requirement({ mounting: "INSET" }));
    expect(compatible.map((a) => a.articleNumber)).toEqual(["FIXTURE-HINGE-IN-A"]);
  });
  it("rejects doors outside the thickness range and unmet opening angles", () => {
    expect(findCompatibleArticles(FIXTURE, requirement({ doorThickness: 30 })).compatible).toEqual([]);
    expect(findCompatibleArticles(FIXTURE, requirement({ openingAngleRequired: 170 })).compatible).toEqual([]);
  });
});

describe("quantity from calculation rules (no hard-coded tables)", () => {
  const article = HETTICH_TEST_FIXTURE_DATASET.articles.find((a) => a.articleNumber === "FIXTURE-HINGE-FO-A")!;
  it("uses the first matching band", () => {
    expect(calculateQuantity(FIXTURE, article, situation({ doorHeight: 717 }))).toEqual({ ok: true, quantity: 2, ruleId: "FIXTURE-HINGE-QTY" });
    expect(calculateQuantity(FIXTURE, article, situation({ doorHeight: 1200 }))).toEqual({ ok: true, quantity: 3, ruleId: "FIXTURE-HINGE-QTY" });
  });
  it("fails when the door is outside every band", () => {
    const r = calculateQuantity(FIXTURE, article, situation({ doorHeight: 2400 }));
    expect(r.ok).toBe(false);
  });
  it("fails (does not guess) when a rule needs door weight that is unknown", () => {
    const ds = usableData({
      ...HETTICH_TEST_FIXTURE_DATASET,
      calculationRules: [{ ...HETTICH_TEST_FIXTURE_DATASET.calculationRules[0]!, bands: [{ when: "DOOR_WEIGHT <= 5", quantity: "2" }] }],
    });
    const r = calculateQuantity(ds, article, situation({ doorWeightKg: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/DOOR_WEIGHT/);
    expect(calculateQuantity(ds, article, situation({ doorWeightKg: 4 }))).toEqual({ ok: true, quantity: 2, ruleId: "FIXTURE-HINGE-QTY" });
  });
});

describe("adapter resolution (test fixture data)", () => {
  const adapter = createHettichAdapter(HETTICH_TEST_FIXTURE_DATASET);
  it("resolves hinge + mounting plate with equal quantities, but flags non-authoritative data", () => {
    const r = adapter.resolve(requirement());
    expect(r.status).toBe("RESOLVED");
    expect(r.lines.map((l) => [l.articleNumber, l.category, l.quantity])).toEqual([
      ["FIXTURE-HINGE-FO-A", "HINGE", 2],
      ["FIXTURE-PLATE-A", "MOUNTING_PLATE", 2],
    ]);
    expect(r.candidates).toEqual(["FIXTURE-HINGE-FO-A", "FIXTURE-HINGE-FO-B"]);
    expect(r.drillingPatternId).toBe("FIXTURE-DRILL-CUP");
    expect(r.messages.map((m) => m.code)).toEqual(["HARDWARE_DATA_NOT_AUTHORITATIVE"]);
  });
  it("reports no compatible article as UNRESOLVED", () => {
    const r = adapter.resolve(requirement({ doorThickness: 40 }));
    expect(r.status).toBe("UNRESOLVED");
    expect(r.messages.map((m) => m.code)).toContain("HARDWARE_NO_COMPATIBLE_ARTICLE");
  });
  it("reports a missing required accessory as UNRESOLVED", () => {
    const ds: HettichFixtureDataset = { ...HETTICH_TEST_FIXTURE_DATASET, articles: HETTICH_TEST_FIXTURE_DATASET.articles.filter((a) => a.category !== "MOUNTING_PLATE") };
    const r = createHettichAdapter(ds).resolve(requirement());
    expect(r.status).toBe("UNRESOLVED");
    expect(r.messages.map((m) => m.code)).toContain("HARDWARE_ACCESSORY_MISSING");
  });
  it("is deterministic", () => {
    expect(adapter.resolve(requirement())).toEqual(adapter.resolve(requirement()));
  });
});
