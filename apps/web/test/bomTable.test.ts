import { describe, expect, it } from "vitest";
import { bomTableRows } from "../src/bomTable.js";

const objectCodes = ["BC-001", "BC-002"];

describe("bomTableRows (P2: readable BOM — presentation only)", () => {
  it("maps each BOM item kind to a readable row, attributing components to their owning cabinet by id prefix", () => {
    const payload = {
      items: [
        { kind: "PANEL", bomItemId: "1", description: "Left side panel", quantity: 1, unit: "NOS", sourceComponentIds: ["BC-001-CARCASS-L"], materialId: "BOARD_BWP_18", componentType: "SIDE", width: 560, height: 720, thickness: 18, grainDirection: "NONE" },
        { kind: "EDGE_BAND", bomItemId: "2", description: "Front edge, side panel", quantity: 1.44, unit: "M", sourceComponentIds: ["BC-001-CARCASS-L"], edgeBandId: "EB_PVC_1MM" },
        { kind: "FINISH", bomItemId: "3", description: "Shutter finish", quantity: 0.5, unit: "M2", sourceComponentIds: ["BC-002-SHUTTER"], finishId: "LAM_WHITE" },
        { kind: "HARDWARE", bomItemId: "4", description: "Hinge", quantity: 2, unit: "NOS", sourceComponentIds: ["BC-001-CARCASS-L"], status: "RESOLVED", manufacturer: "Hettich", articleNumber: "HD-9104", category: "HINGE", sourceRequirementIds: [], sourceVersion: "v1" },
        { kind: "HARDWARE", bomItemId: "5", description: "Unresolved runner", quantity: 1, unit: "NOS", sourceComponentIds: ["BC-002-SHUTTER"], status: "UNRESOLVED", manufacturer: "", articleNumber: null, category: "RUNNER", sourceRequirementIds: [], sourceVersion: null },
        { kind: "APPLIANCE", bomItemId: "6", description: "60cm hob", quantity: 1, unit: "NOS", sourceComponentIds: [], applianceId: "HOB_REFERENCE_60CM", manufacturer: "Elica", model: "H-60" },
      ],
    };
    expect(bomTableRows(payload, objectCodes)).toEqual([
      { cabinet: "BC-001", component: "Left side panel", qty: "1 NOS", material: "BOARD_BWP_18", finish: "—", hardware: "—" },
      { cabinet: "BC-001", component: "Front edge, side panel", qty: "1.44 M", material: "EB_PVC_1MM", finish: "—", hardware: "—" },
      { cabinet: "BC-002", component: "Shutter finish", qty: "0.5 M2", material: "—", finish: "LAM_WHITE", hardware: "—" },
      { cabinet: "BC-001", component: "Hinge", qty: "2 NOS", material: "—", finish: "—", hardware: "Hettich HD-9104" },
      { cabinet: "BC-002", component: "Unresolved runner", qty: "1 NOS", material: "—", finish: "—", hardware: "Unresolved (UNRESOLVED)" },
      { cabinet: "—", component: "60cm hob", qty: "1 NOS", material: "—", finish: "—", hardware: "Elica H-60" },
    ]);
  });
  it("is tolerant of a missing/malformed payload — no items, not an object, or non-item entries", () => {
    expect(bomTableRows({}, objectCodes)).toEqual([]);
    expect(bomTableRows({ items: "not an array" }, objectCodes)).toEqual([]);
    expect(bomTableRows({ items: [null, 42, { no: "kind field" }] }, objectCodes)).toEqual([]);
  });
});
