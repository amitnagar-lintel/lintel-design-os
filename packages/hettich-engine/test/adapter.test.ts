import { describe, expect, it } from "vitest";
import type { FittingSituation, HardwareRequirement } from "@lintel/types";
import type { HettichDataset } from "../src/index.js";
import { HETTICH_OFFICIAL_DATASET, HETTICH_TEST_FIXTURE_DATASET, calculateQuantity, createHettichAdapter, findCompatibleArticles } from "../src/index.js";

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

describe("official dataset slot (empty in M1)", () => {
  it("never invents an article: requirement stays UNRESOLVED with a BLOCKER", () => {
    const r = createHettichAdapter(HETTICH_OFFICIAL_DATASET).resolve(requirement());
    expect(r.status).toBe("UNRESOLVED");
    expect(r.lines).toEqual([]);
    expect(r.messages.map((m) => [m.code, m.severity])).toEqual([["HARDWARE_DATA_UNAVAILABLE", "BLOCKER"]]);
    expect(r.dataset).toEqual({ datasetId: "HETTICH_OFFICIAL", manufacturer: "HETTICH", sourceVersion: "none-loaded", authoritative: true });
  });
});

describe("compatibility engine (test fixture data)", () => {
  it("filters by mounting and ranks by preference, then article number", () => {
    const { compatible, rejected } = findCompatibleArticles(HETTICH_TEST_FIXTURE_DATASET, requirement());
    expect(compatible.map((a) => a.articleNumber)).toEqual(["FIXTURE-HINGE-FO-A", "FIXTURE-HINGE-FO-B"]);
    expect(rejected["FIXTURE-HINGE-IN-A"]).toMatch(/mounting INSET/);
  });
  it("switches article when mounting changes (PRD §43 test D)", () => {
    const { compatible } = findCompatibleArticles(HETTICH_TEST_FIXTURE_DATASET, requirement({ mounting: "INSET" }));
    expect(compatible.map((a) => a.articleNumber)).toEqual(["FIXTURE-HINGE-IN-A"]);
  });
  it("rejects doors outside the thickness range and unmet opening angles", () => {
    expect(findCompatibleArticles(HETTICH_TEST_FIXTURE_DATASET, requirement({ doorThickness: 30 })).compatible).toEqual([]);
    expect(findCompatibleArticles(HETTICH_TEST_FIXTURE_DATASET, requirement({ openingAngleRequired: 170 })).compatible).toEqual([]);
  });
});

describe("quantity from calculation rules (no hard-coded tables)", () => {
  const article = HETTICH_TEST_FIXTURE_DATASET.articles.find((a) => a.articleNumber === "FIXTURE-HINGE-FO-A")!;
  it("uses the first matching band", () => {
    expect(calculateQuantity(HETTICH_TEST_FIXTURE_DATASET, article, situation({ doorHeight: 717 }))).toEqual({ ok: true, quantity: 2, ruleId: "FIXTURE-HINGE-QTY" });
    expect(calculateQuantity(HETTICH_TEST_FIXTURE_DATASET, article, situation({ doorHeight: 1200 }))).toEqual({ ok: true, quantity: 3, ruleId: "FIXTURE-HINGE-QTY" });
  });
  it("fails when the door is outside every band", () => {
    const r = calculateQuantity(HETTICH_TEST_FIXTURE_DATASET, article, situation({ doorHeight: 2400 }));
    expect(r.ok).toBe(false);
  });
  it("fails (does not guess) when a rule needs door weight that is unknown", () => {
    const ds: HettichDataset = {
      ...HETTICH_TEST_FIXTURE_DATASET,
      calculationRules: [{ ...HETTICH_TEST_FIXTURE_DATASET.calculationRules[0]!, bands: [{ when: "DOOR_WEIGHT <= 5", quantity: "2" }] }],
    };
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
    const ds: HettichDataset = { ...HETTICH_TEST_FIXTURE_DATASET, articles: HETTICH_TEST_FIXTURE_DATASET.articles.filter((a) => a.category !== "MOUNTING_PLATE") };
    const r = createHettichAdapter(ds).resolve(requirement());
    expect(r.status).toBe("UNRESOLVED");
    expect(r.messages.map((m) => m.code)).toContain("HARDWARE_ACCESSORY_MISSING");
  });
  it("is deterministic", () => {
    expect(adapter.resolve(requirement())).toEqual(adapter.resolve(requirement()));
  });
});
