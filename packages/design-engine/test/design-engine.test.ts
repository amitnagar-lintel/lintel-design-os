import { describe, expect, it } from "vitest";
import type { DesignObject, DesignVersion, HardwareRequirement, ManufacturerAdapter, ValidationResult } from "@lintel/types";
import { KIT_BASE_STANDARD, KITCHEN_BASE_STANDARD_V1, LINTEL_CATALOG, TEST_FIXTURE_CONSTRUCTION_STANDARD } from "@lintel/catalog-engine";
import { assertProductionEligible, componentId, ProductionGuardError, resolveCabinet, resolveParameters } from "../src/index.js";

const dv: DesignVersion = { designVersionId: "dv_t", designId: "d", projectId: "p", versionNumber: 1, status: "DRAFT" };
const obj = (over: Partial<DesignObject> = {}): DesignObject => ({
  objectId: "o1",
  objectCode: "OBJ-T-001",
  projectId: "p",
  roomId: "r",
  objectType: "BASE_CABINET",
  productId: "KIT_BASE_STANDARD",
  transform: { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
  dimensions: { width: 600, height: 720, depth: 560 },
  parameters: {},
  status: "DRAFT",
  ...over,
});

/** Minimal adapter that always returns a single fixed line; manufacturer-agnostic test double. */
const fakeAdapter: ManufacturerAdapter = {
  manufacturer: "HETTICH",
  dataset: { datasetId: "FAKE", classification: "PRODUCTION", manufacturer: "HETTICH", sourceVersion: "t", authoritative: true },
  resolve: (r: HardwareRequirement) => ({
    requirementId: r.requirementId,
    manufacturer: "HETTICH",
    status: "RESOLVED",
    lines: [],
    candidates: [],
    quantityRuleId: null,
    drillingPatternId: null,
    dataset: { datasetId: "FAKE", classification: "PRODUCTION", manufacturer: "HETTICH", sourceVersion: "t", authoritative: true },
    messages: [],
  }),
};

const codes = (v: ValidationResult): string[] => v.messages.map((m) => m.code);

describe("resolveParameters", () => {
  it("applies defaults and records provenance", () => {
    const r = resolveParameters(KIT_BASE_STANDARD, obj({ parameters: { shelfCount: 2 } }), LINTEL_CATALOG);
    expect(r.parameters.values).toMatchObject({ width: 600, shelfCount: 2, shutterCount: 2, frontType: "OVERLAY", material: "BOARD_BWP_18" });
    expect(r.parameters.provenance.width).toBe("OBJECT");
    expect(r.parameters.provenance.shelfCount).toBe("OBJECT");
    expect(r.parameters.provenance.shutterCount).toBe("DEFAULT");
    expect(r.scope).toMatchObject({ W: 600, T: 18, TB: 6, N_SHELF: 2, FRONT_OVERLAY: true, FRONT_INSET: false, T_CARCASS_MAT: 18, T_BACK_MAT: 6, T_FRONT: 18 });
    expect(r.messages).toEqual([]);
  });
  it("rejects unknown parameters and dimension duplicates", () => {
    const r = resolveParameters(KIT_BASE_STANDARD, obj({ parameters: { colour: "red", width: 900 } }), LINTEL_CATALOG);
    expect(r.messages.map((m) => [m.code, m.severity])).toEqual([
      ["PARAMETER_UNKNOWN", "ERROR"],
      ["PARAMETER_DUPLICATES_DIMENSION", "ERROR"],
    ]);
    expect(r.parameters.values.width).toBe(600);
  });
  it("blocks invalid values and omits them from scope so dependants fail loudly", () => {
    const r = resolveParameters(KIT_BASE_STANDARD, obj({ parameters: { shutterCount: 0, shelfCount: 1.5, frontType: "SLIDING", material: "UNOBTAINIUM" } }), LINTEL_CATALOG);
    expect(r.messages.map((m) => m.code).sort()).toEqual(["MATERIAL_UNKNOWN", "PARAMETER_INVALID_TYPE", "PARAMETER_NOT_ALLOWED", "PARAMETER_OUT_OF_RANGE"]);
    expect(r.messages.every((m) => m.severity === "BLOCKER")).toBe(true);
    expect(r.scope.N_SHUTTER).toBeUndefined();
    expect(r.scope.N_SHELF).toBeUndefined();
    expect(r.scope.FRONT_OVERLAY).toBeUndefined();
    expect(r.scope.T_CARCASS_MAT).toBeUndefined();
  });
});

describe("componentId (PRD §17)", () => {
  const t = (id: string) => KITCHEN_BASE_STANDARD_V1.components.find((c) => c.templateId === id)!;
  it("is deterministic and human-readable", () => {
    expect(componentId("OBJ-KIT-001", t("SIDE_LEFT"), 0, 1)).toBe("OBJ-KIT-001-SL");
    expect(componentId("OBJ-KIT-001", t("SHELF"), 0, 1)).toBe("OBJ-KIT-001-SHF-01");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 0, 2)).toBe("OBJ-KIT-001-SHT-L");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 1, 2)).toBe("OBJ-KIT-001-SHT-R");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 0, 1)).toBe("OBJ-KIT-001-SHT-01");
    expect(componentId("OBJ-KIT-001", t("SHUTTER_OVERLAY"), 2, 3)).toBe("OBJ-KIT-001-SHT-03");
  });
});

describe("resolveCabinet guards", () => {
  const run = (o: DesignObject, adapters: readonly ManufacturerAdapter[] = [fakeAdapter], v: DesignVersion = dv) =>
    resolveCabinet({ designVersion: v, object: o, catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, adapters });

  it("reports a missing product without throwing", () => {
    const r = run(obj({ productId: "WARDROBE" }));
    expect(codes(r.validation)).toContain("CATALOG_REFERENCE_MISSING");
    expect(r.components).toEqual([]);
  });
  it("blocks when the object and design version belong to different projects", () => {
    expect(codes(run(obj(), [fakeAdapter], { ...dv, projectId: "other" }).validation)).toContain("TRACE_PROJECT_MISMATCH");
  });
  it("flags unsupported rotations", () => {
    expect(codes(run(obj({ transform: { x: 0, y: 0, z: 0, rotationX: 10, rotationY: 0, rotationZ: 0 } })).validation)).toContain("TRANSFORM_UNSUPPORTED");
  });
  it("blocks hardware when no adapter exists for the manufacturer", () => {
    const r = run(obj(), []);
    expect(r.hardwareResolutions.every((h) => h.status === "UNRESOLVED")).toBe(true);
    expect(codes(r.validation)).toContain("HARDWARE_ADAPTER_MISSING");
  });
  it("links each shutter to its hardware requirement", () => {
    const r = run(obj());
    const shutters = r.components.filter((c) => c.componentType === "SHUTTER");
    expect(shutters.map((c) => c.hardwareLinks)).toEqual([["OBJ-T-001-SHT-L-HINGE"], ["OBJ-T-001-SHT-R-HINGE"]]);
    expect(r.components.filter((c) => c.componentType !== "SHUTTER").every((c) => c.hardwareLinks.length === 0)).toBe(true);
  });
  it("blocks geometrically impossible dimensions", () => {
    const r = run(obj({ dimensions: { width: 30, height: 720, depth: 560 } }));
    expect(codes(r.validation)).toEqual(expect.arrayContaining(["RULE_VIOLATION", "COMPONENT_DIMENSION_INVALID"]));
  });
  it("always blocks approval for TEST_FIXTURE standards", () => {
    expect(codes(run(obj()).validation)).toContain("CONSTRUCTION_STANDARD_NOT_APPROVED");
  });
});

describe("assertProductionEligible", () => {
  const ok: ValidationResult = { messages: [], counts: { BLOCKER: 0, ERROR: 0, WARNING: 0, INFO: 0 }, canApprove: true };
  const blocked: ValidationResult = { ...ok, counts: { ...ok.counts, BLOCKER: 1 }, canApprove: false };
  it("rejects non-approved design versions", () => {
    for (const status of ["DRAFT", "IN_REVIEW", "CHANGES_REQUIRED", "SUPERSEDED"] as const) {
      expect(() => {
        assertProductionEligible({ ...dv, status }, ok);
      }).toThrow(ProductionGuardError);
    }
  });
  it("rejects approved versions that still have blockers", () => {
    expect(() => {
      assertProductionEligible({ ...dv, status: "APPROVED" }, blocked);
    }).toThrow(/BLOCKER/);
  });
  it("accepts APPROVED / LOCKED versions without blockers", () => {
    expect(() => {
      assertProductionEligible({ ...dv, status: "APPROVED" }, ok);
    }).not.toThrow();
    expect(() => {
      assertProductionEligible({ ...dv, status: "LOCKED" }, ok);
    }).not.toThrow();
  });
});

describe("stableStringify / modelFingerprint", () => {
  it("ignores object key order", async () => {
    const { stableStringify } = await import("../src/index.js");
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 2 } })).toBe(stableStringify({ a: { c: 2, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });
  it("is stable for identical models and changes when the model changes", async () => {
    const { modelFingerprint } = await import("../src/index.js");
    const run = (width: number) =>
      resolveCabinet({ designVersion: dv, object: obj({ dimensions: { width, height: 720, depth: 560 } }), catalog: LINTEL_CATALOG, standard: TEST_FIXTURE_CONSTRUCTION_STANDARD, adapters: [fakeAdapter] });
    expect(modelFingerprint(run(600))).toBe(modelFingerprint(run(600)));
    expect(modelFingerprint(run(600))).not.toBe(modelFingerprint(run(750)));
    expect(modelFingerprint(run(600))).toMatch(/^[0-9a-f]{14}$/);
  });
});
