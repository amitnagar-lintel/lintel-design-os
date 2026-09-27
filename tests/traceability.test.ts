/** PRD §17 / §45: every output traces back to the same DesignVersion. */
import { describe, expect, it } from "vitest";
import { fixtureSlice, productionSlice, DESIGN_VERSION } from "./support/scenario.js";

describe.each([
  ["test-fixture", fixtureSlice],
  ["production", productionSlice],
])("traceability (%s)", (_, slice) => {
  const { resolved, bom, boq } = slice();
  const componentIds = new Set(resolved.components.map((c) => c.componentId));
  const requirementIds = new Set(resolved.hardwareRequirements.map((r) => r.requirementId));

  it("stamps the same DesignVersion and versions on every artifact", () => {
    for (const t of [resolved.trace, bom.trace, boq.trace]) {
      expect(t.designVersionId).toBe(DESIGN_VERSION.designVersionId);
      expect(t).toEqual(resolved.trace);
    }
    expect(resolved.trace.catalogVersion).toBe("2026.09.30-m5");
    expect(resolved.trace.product).toEqual({ id: "KIT_BASE_STANDARD", version: "1.0.0", status: "DRAFT" });
  });
  it("links components to the source object", () => {
    for (const c of resolved.components) expect(c.sourceObjectId).toBe("obj_001");
  });
  it("links every BOM item to existing components / requirements", () => {
    for (const item of bom.items) {
      for (const id of item.sourceComponentIds) expect(componentIds.has(id)).toBe(true);
      if (item.kind === "HARDWARE") for (const id of item.sourceRequirementIds) expect(requirementIds.has(id)).toBe(true);
    }
    const panelSources = bom.items.filter((i) => i.kind === "PANEL").flatMap((i) => i.sourceComponentIds);
    expect(panelSources.sort()).toEqual([...componentIds].sort());
  });
  it("links hardware requirements to their components", () => {
    for (const r of resolved.hardwareRequirements) {
      expect(componentIds.has(r.sourceComponentId)).toBe(true);
      expect(resolved.components.find((c) => c.componentId === r.sourceComponentId)?.hardwareLinks).toContain(r.requirementId);
    }
  });
  it("links the BOQ to the BOM without merging them", () => {
    expect(boq.items.every((i) => i.linkedBomId === bom.bomId)).toBe(true);
    expect(boq.boqId).not.toBe(bom.bomId);
  });
});
