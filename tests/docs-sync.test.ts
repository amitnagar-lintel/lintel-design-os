/** Keeps the production-data documentation in sync with the data it describes. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KITCHEN_BASE_STANDARD_V1, LINTEL_CONSTRUCTION_STANDARD_DRAFT } from "@lintel/catalog-engine";
import { edgeSidesForPlane } from "@lintel/geometry-engine";
import { LINTEL_PRODUCTION_RATE_CARD } from "@lintel/pricing-engine";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "catalog");
const read = (p: string): string => readFileSync(join(DOCS, p), "utf8");
const allVariables = KITCHEN_BASE_STANDARD_V1.constructionVariables.map((v) => v.key);
/** Parameters added after the original 11-field list, documented separately (section A1, …). */
const ADDITIONAL = ["SHUTTER_BACK_GAP"];
/** The original 11-field list. */
const variables = allVariables.filter((v) => !ADDITIONAL.includes(v));

describe("KIT_BASE_STANDARD_DATA_REQUIRED.md", () => {
  const doc = read("KIT_BASE_STANDARD_DATA_REQUIRED.md");
  const sections = [...doc.matchAll(/^### (\d+)\. `([A-Z_]+)`$/gm)].map((m) => m[2]);

  it("lists exactly the recipe's construction variables: the original 11, then additional ones (A1…)", () => {
    expect(variables).toHaveLength(11);
    expect(sections).toEqual(variables);
    const additional = [...doc.matchAll(/^### A(\d+)\. `([A-Z_]+)`$/gm)].map((m) => m[2]);
    expect(additional).toEqual(ADDITIONAL);
    expect([...sections, ...additional].sort()).toEqual([...allVariables].sort());
  });
  it("defines the front-geometry terms separately, with SHUTTER_REDUCTION unused by the recipe", () => {
    for (const t of ["OVERLAY_EDGE_GAP", "OVERLAY_TOP_GAP", "OVERLAY_BOTTOM_GAP", "FRONT_BETWEEN_GAP", "INSET_GAP", "SHUTTER_BACK_GAP", "SHUTTER_REDUCTION"]) expect(doc).toContain(`| \`${t}\` |`);
    expect(allVariables).not.toContain("SHUTTER_REDUCTION");
  });
  it("every listed value is still NULL in the Lintel standard (doc says NULL / UNVERIFIED)", () => {
    for (const v of allVariables) expect(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables[v]).toBeNull();
  });
  it("every section carries all required fields", () => {
    const fields = ["Field name", "Current status", "Current value", "Unit", "Where used", "Affected components", "Affected formulas", "Affected drawings", "Affected manufacturing outputs", "Who provides / approves"];
    const bodies = doc.split(/^### A?\d+\. /m).slice(1);
    expect(bodies).toHaveLength(12);
    for (const body of bodies) for (const f of fields) expect(body).toContain(`| ${f} |`);
  });
});

describe("production-data intake documents", () => {
  const files = ["README.md", "01-construction-standards.md", "02-board-material-standards.md", "03-edge-banding-standards.md", "04-hardware-standards.md", "05-dimensional-limits.md", "06-manufacturing-standards.md", "07-pricing-standards.md"];
  it("all exist", () => {
    for (const f of files) expect(existsSync(join(DOCS, "production-data", f)), f).toBe(true);
  });
  it("01 lists the 11 original and the additional construction variables individually", () => {
    const doc = read("production-data/01-construction-standards.md");
    for (const v of variables) expect(doc).toMatch(new RegExp(`\\| \\d+ \\| ${v} \\|`));
    for (const v of ADDITIONAL) expect(doc).toMatch(new RegExp(`\\| A\\d+ \\| ${v} \\|`));
  });
  it("03 lists every edge side of every recipe component type", () => {
    const doc = read("production-data/03-edge-banding-standards.md");
    const planes = new Map(KITCHEN_BASE_STANDARD_V1.components.map((c) => [c.componentType, c.plane]));
    for (const [type, plane] of planes) for (const side of edgeSidesForPlane(plane)) expect(doc).toContain(`| ${type} | ${side} |`);
  });
  it("07 lists every production rate card entry", () => {
    const doc = read("production-data/07-pricing-standards.md");
    const keys = [...Object.keys(LINTEL_PRODUCTION_RATE_CARD.boardPerM2), ...Object.keys(LINTEL_PRODUCTION_RATE_CARD.edgeBandPerM), ...Object.keys(LINTEL_PRODUCTION_RATE_CARD.finishPerM2)];
    for (const k of keys) expect(doc).toContain(`| ${k} |`);
  });
});

describe("reconciliation of the 11-field list with engine behaviour", () => {
  const undefinedFor = async (frontType: string): Promise<string[]> => {
    const { productionSlice, referenceObject } = await import("./support/scenario.js");
    return productionSlice(referenceObject({ parameters: { frontType } }))
      .resolved.validation.messages.filter((m) => m.code === "CONSTRUCTION_VARIABLE_UNDEFINED")
      .map((m) => (m.path ?? "").replace("standard.variables.", ""));
  };
  it("overlay reference cabinet blocks on 10 of the original 11 (INSET_GAP inactive) plus SHUTTER_BACK_GAP", async () => {
    const missing = await undefinedFor("OVERLAY");
    expect(missing).toHaveLength(11);
    expect(variables.filter((v) => !missing.includes(v))).toEqual(["INSET_GAP"]);
    expect(missing).toContain("SHUTTER_BACK_GAP");
  });
  it("inset cabinet blocks on 8 of the 11 (overlay reveals inactive)", async () => {
    const missing = await undefinedFor("INSET");
    expect(missing).toEqual(["BACK_GROOVE_DEPTH", "BACK_REAR_OFFSET", "FRONT_BETWEEN_GAP", "FRONT_FINISHED_FACES", "INSET_GAP", "SHELF_FRONT_SETBACK", "SHELF_SIDE_CLEARANCE", "TOP_RAIL_WIDTH"]);
  });
});

describe("KIT_BASE_STANDARD_BENCHMARK_V1.md", () => {
  const doc = read("KIT_BASE_STANDARD_BENCHMARK_V1.md");
  const bodies = doc.split(/^### A?\d+\. /m).slice(1);
  const row = (body: string, name: string): string => new RegExp(`^\\| ${name} \\| (.+) \\|$`, "m").exec(body)?.[1] ?? "";
  const bodyOf = (field: string): string => bodies.find((b) => b.startsWith(`\`${field}\``)) ?? "";

  it("is labelled as an industry benchmark, not the Lintel production standard", () => {
    expect(doc).toContain("INDUSTRY BENCHMARK - NOT LINTEL PRODUCTION STANDARD");
  });
  it("covers the original 11 fields and the additional parameters, each with the required rows", () => {
    const sections = [...doc.matchAll(/^### (\d+)\. `([A-Z_]+)`$/gm)].map((m) => m[2]);
    expect(sections).toEqual(variables);
    expect([...doc.matchAll(/^### A(\d+)\. `([A-Z_]+)`$/gm)].map((m) => m[2])).toEqual(ADDITIONAL);
    const rows = ["Field", "Benchmark value", "Source", "Source URL", "Source type", "Confidence", "Applicability", "Stated or inferred"];
    for (const body of bodies) for (const r of rows) expect(body).toContain(`| ${r} |`);
  });
  it("every recorded value cites an https source URL; otherwise it states no verified benchmark", () => {
    for (const body of bodies) {
      const value = row(body, "Benchmark value");
      if (value === "NO VERIFIED PUBLIC BENCHMARK FOUND") expect(row(body, "Stated or inferred")).toBe("—");
      else {
        expect(row(body, "Source URL")).toMatch(/^https:\/\//);
        expect(row(body, "Stated or inferred")).toMatch(/^(Directly stated|Stated, mapping interpreted|Not converted)$/);
      }
    }
  });
  it("keeps SHELF_SIDE_CLEARANCE in source semantics (-0.5 mm extension, not converted)", () => {
    const b = bodyOf("SHELF_SIDE_CLEARANCE");
    expect(row(b, "Benchmark value")).toMatch(/^-0\.5 mm/);
    expect(row(b, "Stated or inferred")).toBe("Not converted");
    expect(b).not.toMatch(/\+0\.5/);
  });
  it("records SHUTTER_BACK_GAP as a directly stated 2 mm benchmark from its own source", () => {
    const b = bodyOf("SHUTTER_BACK_GAP");
    expect(row(b, "Benchmark value")).toBe("2 mm");
    expect(row(b, "Source URL")).toBe("https://help.infurnia.com/en/articles/9669837-how-to-change-the-shutter-back-gap");
    expect(row(b, "Stated or inferred")).toBe("Directly stated");
  });
  it("records no number where the mapping would need inference", () => {
    for (const f of ["FRONT_BETWEEN_GAP", "INSET_GAP", "FRONT_FINISHED_FACES"]) expect(row(bodyOf(f), "Benchmark value")).toBe("NO VERIFIED PUBLIC BENCHMARK FOUND");
  });
  it("never derives overlay gaps from shutter reduction (fields 6–8)", () => {
    for (const f of ["OVERLAY_EDGE_GAP", "OVERLAY_TOP_GAP", "OVERLAY_BOTTOM_GAP"]) {
      expect(row(bodyOf(f), "Benchmark value")).toBe("NO VERIFIED PUBLIC BENCHMARK FOUND");
      expect(row(bodyOf(f), "Source URL")).toBe("—");
      expect(doc).toMatch(new RegExp(`^\\| \\d+ \\| ${f} \\| NO VERIFIED PUBLIC BENCHMARK FOUND \\|`, "m"));
    }
    const reduction = doc.slice(doc.indexOf("## Shutter reduction (source fact, not a Lintel field)"));
    expect(reduction).toMatch(/shutter reduction\*\* of 1 mm on all four sides/);
    expect(reduction).toMatch(/not\*\* used by the Lintel recipe/);
  });
  it("does not change the production standard", () => {
    for (const v of allVariables) expect(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables[v]).toBeNull();
    for (const b of bodies) expect(row(b, "Lintel production value")).toBe("NULL / UNVERIFIED (unchanged)");
  });
});

describe("08-planning-standards.md", () => {
  it("lists every planning variable individually and the Lintel draft keeps them NULL", async () => {
    const { PLANNING_VARIABLES, LINTEL_PLANNING_STANDARD_DRAFT } = await import("@lintel/catalog-engine");
    const doc = read("production-data/08-planning-standards.md");
    for (const v of PLANNING_VARIABLES) {
      expect(doc).toMatch(new RegExp(`\\| P\\d+ \\| ${v.key} \\|`));
      expect(LINTEL_PLANNING_STANDARD_DRAFT.variables[v.key]).toBeNull();
    }
    expect(Object.keys(LINTEL_PLANNING_STANDARD_DRAFT.variables).sort()).toEqual(PLANNING_VARIABLES.map((v) => v.key).sort());
  });
});
