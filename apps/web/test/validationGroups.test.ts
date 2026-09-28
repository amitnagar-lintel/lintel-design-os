import { describe, expect, it } from "vitest";
import { classifyValidationCode } from "../src/validationGroups.js";

describe("classifyValidationCode (P1-4: validation signal cleanup)", () => {
  it("classifies the post-P0 benchmark's exact reference/data-health noise as REFERENCE_DATA, never weakened away", () => {
    expect(classifyValidationCode("STANDARD_UNKNOWN_VARIABLE")).toBe("REFERENCE_DATA");
    expect(classifyValidationCode("CONSTRUCTION_VARIABLE_UNDEFINED")).toBe("REFERENCE_DATA");
  });
  it("classifies genuine design/placement problems as DESIGN", () => {
    for (const code of ["OBJECT_COLLISION", "OBJECT_THROUGH_WALL", "OBJECT_BELOW_FLOOR", "OBJECT_ABOVE_CEILING", "WALL_CLEARANCE_BELOW_MINIMUM", "RUN_TOO_LONG", "GAP_BELOW_MINIMUM", "GAP_UNFILLABLE", "FILLER_REQUIRED", "CABINET_GAP_NOT_TOUCHING", "SERVICE_VOID_BELOW_MINIMUM", "APPLIANCE_UNKNOWN", "APPLIANCE_INSTALLATION_UNVERIFIED"]) {
      expect(classifyValidationCode(code)).toBe("DESIGN");
    }
  });
  it("defaults an unrecognised code to DESIGN — never silently hidden as reference-data noise", () => {
    expect(classifyValidationCode("SOME_FUTURE_CODE_NOT_YET_CLASSIFIED")).toBe("DESIGN");
  });
});
