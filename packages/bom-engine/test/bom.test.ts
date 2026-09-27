import { describe, expect, it } from "vitest";
import type { ResolvedCabinet } from "@lintel/types";
import { generateBom } from "../src/index.js";

/** Minimal resolved cabinet with no components, used to test completeness rules in isolation. */
const base = (messages: ResolvedCabinet["validation"]["messages"]): ResolvedCabinet =>
  ({
    trace: { designVersionId: "dv", objectId: "o" },
    components: [],
    appliances: [],
    hardwareRequirements: [],
    hardwareResolutions: [],
    validation: { messages, counts: { BLOCKER: messages.length, ERROR: 0, WARNING: 0, INFO: 0 }, canApprove: messages.length === 0 },
  }) as unknown as ResolvedCabinet;

describe("BOM completeness", () => {
  it("is complete when nothing was omitted", () => {
    expect(generateBom(base([])).incomplete).toBe(false);
  });
  it("is incomplete when any expected component was omitted, whatever the reason", () => {
    for (const code of ["COMPONENT_NOT_GENERATED", "COMPONENT_MATERIAL_UNRESOLVED", "COMPONENT_DIMENSION_INVALID"]) {
      expect(generateBom(base([{ code, severity: "BLOCKER", message: "x", componentId: "OBJ-1-SL" }])).incomplete, code).toBe(true);
    }
  });
});

describe("APPLIANCE line (Design Studio Slice 5 steps 3 and 5: oven/hob appliance references)", () => {
  it("emits one APPLIANCE line per resolved appliance reference, never rolled into any board/edge/hardware total", () => {
    const resolved: ResolvedCabinet = {
      ...base([]),
      appliances: [{ parameterKey: "hob", applianceId: "HOB_REFERENCE_60CM", manufacturer: null, model: null }],
    };
    const bom = generateBom(resolved);
    const items = bom.items.filter((i) => i.kind === "APPLIANCE");
    expect(items).toEqual([{
      kind: "APPLIANCE", bomItemId: "BOM:o:APPLIANCE:hob", description: "HOB_REFERENCE_60CM",
      quantity: 1, unit: "NOS", sourceComponentIds: [], applianceId: "HOB_REFERENCE_60CM", manufacturer: null, model: null,
    }]);
    expect(bom.incomplete).toBe(false);
  });

  it("includes manufacturer and model in the description when known", () => {
    const resolved: ResolvedCabinet = {
      ...base([]),
      appliances: [{ parameterKey: "oven", applianceId: "OVEN_REFERENCE_60CM", manufacturer: "ACME", model: "X1" }],
    };
    const bom = generateBom(resolved);
    expect(bom.items.filter((i) => i.kind === "APPLIANCE")).toEqual([{
      kind: "APPLIANCE", bomItemId: "BOM:o:APPLIANCE:oven", description: "OVEN_REFERENCE_60CM, ACME X1",
      quantity: 1, unit: "NOS", sourceComponentIds: [], applianceId: "OVEN_REFERENCE_60CM", manufacturer: "ACME", model: "X1",
    }]);
  });
});
