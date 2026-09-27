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
