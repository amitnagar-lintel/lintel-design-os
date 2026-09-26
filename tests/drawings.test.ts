/** M3 execution drawings: Front Elevation + Panel Schedule (PRD §33–34). TEST_FIXTURE data only. */
import { describe, expect, it } from "vitest";
import type { ResolvedCabinet } from "@lintel/types";
import { checkDrawingStaleness, renderPdf, renderSvg, ROWS_PER_SHEET, verifyDrawing } from "@lintel/drawing-engine";
import { DESIGN_VERSION, fixtureSlice, productionSlice, referenceObject } from "./support/scenario.js";
import { created, elevation, schedule } from "./support/drawing.js";

const texts = (d: ReturnType<typeof created>, sheet = 0): string[] => (d.sheets[sheet]?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));

describe("PRD §34 title block and traceability", () => {
  const d = created(elevation(fixtureSlice().resolved));
  it("carries every §34 field plus fingerprint and classification", () => {
    expect(d.titleBlock).toEqual({
      projectId: "project_001",
      projectCode: "LSA-BLR-2026-0001",
      room: "Kitchen",
      drawingNumber: "KIT-EL-001",
      drawingTitle: "FRONT ELEVATION - OBJ-KIT-001",
      revision: "A",
      date: "2026-09-26",
      designer: "TEST DESIGNER",
      checker: "UNASSIGNED",
      scale: "1:5",
      approvalStatus: "PRELIMINARY",
      sourceDesignVersionId: "dv_001",
      sourceDesignVersionStatus: "DRAFT",
      modelFingerprint: d.modelFingerprint,
      dataClassification: "TEST_FIXTURE",
    });
    expect(texts(d)).toEqual(expect.arrayContaining(["dv_001 (DRAFT)", d.modelFingerprint, "PRELIMINARY", "TEST_FIXTURE", "1:5"]));
  });
  it("traces to the design version and components", () => {
    expect(d.drawingId).toBe("DRW:dv_001:obj_001:FRONT_ELEVATION:KIT-EL-001:RA");
    expect(d.trace.designVersionId).toBe("dv_001");
    expect(d.componentIds).toHaveLength(9);
  });
  it("embeds traceability in the SVG", () => {
    const svg = renderSvg(d);
    expect(svg).toContain(`data-design-version="dv_001"`);
    expect(svg).toContain(`data-model-fingerprint="${d.modelFingerprint}"`);
    expect(svg).toContain(`data-content-hash="${d.contentHash}"`);
    expect(svg).toContain(`data-classification="TEST_FIXTURE"`);
  });
});

describe("front elevation content", () => {
  it("dimensions come from the model and follow changes (PRD §43 test B)", () => {
    expect(texts(created(elevation(fixtureSlice().resolved)))).toEqual(expect.arrayContaining(["600", "720", "297", "717", "SHT-L", "SHT-R", "297 x 717 x 18"]));
    expect(texts(created(elevation(fixtureSlice(referenceObject({ dimensions: { width: 750 } })).resolved)))).toEqual(expect.arrayContaining(["750", "372"]));
  });
  it("inset fronts draw inside the carcass (PRD §43 test D)", () => {
    expect(texts(created(elevation(fixtureSlice(referenceObject({ parameters: { frontType: "INSET" } })).resolved)))).toEqual(expect.arrayContaining(["278.5", "680"]));
  });
  it("draws hidden carcass edges dashed behind overlay fronts", () => {
    const d = created(elevation(fixtureSlice().resolved));
    const hidden = (d.sheets[0]?.primitives ?? []).filter((p) => p.kind === "line" && p.layer === "HIDDEN");
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((p) => p.kind === "line" && p.dashed)).toBe(true);
  });
  it("picks a larger standard scale for a wider cabinet", () => {
    expect(created(elevation(fixtureSlice(referenceObject({ dimensions: { width: 2400 } })).resolved)).titleBlock.scale).toBe("1:10");
  });
});

describe("panel schedule content", () => {
  it("lists every component with finished sizes, materials, edges and finish", () => {
    const d = created(schedule(fixtureSlice().resolved));
    expect(texts(d)).toEqual(expect.arrayContaining(["OBJ-KIT-001-SHT-L", "BOARD_HDHMR_18", "EDGE_ABS_2MM (T/BT/L/R)", "LAMINATE_WHITE x2", "580", "710"]));
    expect(d.titleBlock.scale).toBe("NTS");
  });
  it("lists components that could not be generated in the production configuration", () => {
    const d = created(schedule(productionSlice().resolved));
    expect(texts(d).filter((t) => t === "NOT GENERATED")).toHaveLength(6);
    expect(texts(d).filter((t) => t === "UNDEFINED")).toHaveLength(3); // edge rules undefined
  });
  it("paginates long schedules onto continuation sheets", () => {
    const d = created(schedule(fixtureSlice(referenceObject({ parameters: { shelfCount: 30 } })).resolved));
    expect(d.sheets).toHaveLength(Math.ceil(38 / ROWS_PER_SHEET));
    expect(texts(d, 1)).toContain(`SHEET 2 OF ${d.sheets.length}`);
  });
});

describe("watermark (TEST_FIXTURE / blocked data)", () => {
  it("marks TEST_FIXTURE drawings", () => {
    const d = created(elevation(fixtureSlice().resolved));
    expect(d.watermark).toBe("TEST FIXTURE DATA - NOT FOR PRODUCTION");
    expect(renderSvg(d)).toContain(`<g id="WATERMARK"`);
  });
  it("marks production-classified but blocked drawings", () => {
    expect(created(elevation(productionSlice().resolved)).watermark).toBe("BLOCKED DATA - NOT FOR PRODUCTION (24 BLOCKERS)");
  });
});

describe("production guard: FOR_PRODUCTION", () => {
  it("is refused for TEST_FIXTURE data", () => {
    const r = elevation(fixtureSlice().resolved, { status: "FOR_PRODUCTION", designVersion: { ...DESIGN_VERSION, status: "APPROVED" } });
    expect(r.status).toBe("REFUSED");
    if (r.status === "REFUSED") expect(r.blockers.map((b) => b.code)).toEqual(["DRAWING_PRODUCTION_GUARD", "DRAWING_MODEL_NOT_FROM_APPROVED_VERSION", "DRAWING_TEST_FIXTURE_DATA"]);
  });
  it("is refused for blocked production data and for DRAFT versions", () => {
    for (const r of [schedule(productionSlice().resolved, { status: "FOR_PRODUCTION" }), elevation(productionSlice().resolved, { status: "FOR_PRODUCTION" })]) {
      expect(r.status).toBe("REFUSED");
      if (r.status === "REFUSED") expect(r.blockers.map((b) => b.code)).toContain("DRAWING_PRODUCTION_GUARD");
    }
  });
  it("is refused when the model belongs to another design version", () => {
    const r = elevation(fixtureSlice().resolved, { designVersion: { ...DESIGN_VERSION, designVersionId: "dv_other" } });
    expect(r.status === "REFUSED" ? r.blockers.map((b) => b.code) : []).toEqual(["DRAWING_TRACE_MISMATCH"]);
  });
  it("FOR_REVIEW and PRELIMINARY stay available (with watermark)", () => {
    expect(created(elevation(fixtureSlice().resolved, { status: "FOR_REVIEW" })).status).toBe("FOR_REVIEW");
  });
  it("is granted only when every condition holds (test double: clean, approved, PRODUCTION model)", () => {
    const base = fixtureSlice().resolved;
    // Test-only double of a fully approved model; no approved data file exists in the repo.
    const approved: ResolvedCabinet = {
      ...base,
      trace: { ...base.trace, designVersionStatus: "APPROVED", dataClassification: "PRODUCTION", testFixtureSources: [] },
      validation: { messages: [], counts: { BLOCKER: 0, ERROR: 0, WARNING: 0, INFO: 0 }, canApprove: true },
    };
    const d = created(elevation(approved, { status: "FOR_PRODUCTION", designVersion: { ...DESIGN_VERSION, status: "APPROVED" } }));
    expect(d.status).toBe("FOR_PRODUCTION");
    expect(d.watermark).toBeNull();
    expect(d.titleBlock.approvalStatus).toBe("FOR_PRODUCTION");
  });
});

describe("stale-drawing detection", () => {
  const slice = fixtureSlice();
  const d = created(elevation(slice.resolved));
  it("is current against the same model", () => {
    expect(checkDrawingStaleness(d, slice.resolved)).toEqual({ stale: false, reasons: [] });
  });
  it("detects model changes (width, shutters, front type, material)", () => {
    for (const o of [referenceObject({ dimensions: { width: 750 } }), referenceObject({ parameters: { shutterCount: 1 } }), referenceObject({ parameters: { frontType: "INSET" } }), referenceObject({ parameters: { material: "BOARD_HDHMR_18" } })]) {
      const s = checkDrawingStaleness(d, fixtureSlice(o).resolved);
      expect(s.stale).toBe(true);
      expect(s.reasons[0]).toMatch(/^Model changed/);
    }
  });
  it("detects a different design version", () => {
    const other: ResolvedCabinet = { ...slice.resolved, trace: { ...slice.resolved.trace, designVersionId: "dv_002" } };
    expect(checkDrawingStaleness(d, other).reasons.some((r) => r.startsWith("Design version changed"))).toBe(true);
  });
});

describe("immutability and determinism", () => {
  const d = created(elevation(fixtureSlice().resolved));
  it("is frozen and hash-sealed", () => {
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.sheets[0]?.primitives)).toBe(true);
    expect(verifyDrawing(d)).toBe(true);
    const copy = structuredClone(d);
    (copy.titleBlock as { approvalStatus: string }).approvalStatus = "FOR_PRODUCTION";
    expect(verifyDrawing(copy)).toBe(false);
  });
  it("renders identical SVG and PDF on every run", () => {
    const again = created(elevation(fixtureSlice().resolved));
    expect(renderSvg(again)).toBe(renderSvg(d));
    expect(renderPdf([again])).toBe(renderPdf([d]));
  });
});

describe("PDF export", () => {
  const pdf = renderPdf([created(elevation(fixtureSlice().resolved)), created(schedule(fixtureSlice().resolved))]);
  it("is a well-formed PDF 1.4 with one page per sheet", () => {
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count 2/.test(pdf)).toBe(true);
    expect(Array.from(pdf, (c) => c.charCodeAt(0)).every((code) => code < 128)).toBe(true);
  });
  it("has a correct cross-reference table", () => {
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    entries.forEach((offset, i) => {
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = (m.index) + m[0].length;
      expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe("\nendstream");
    }
  });
});
