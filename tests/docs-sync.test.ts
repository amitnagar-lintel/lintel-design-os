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
const variables = KITCHEN_BASE_STANDARD_V1.constructionVariables.map((v) => v.key);

describe("KIT_BASE_STANDARD_DATA_REQUIRED.md", () => {
  const doc = read("KIT_BASE_STANDARD_DATA_REQUIRED.md");
  const sections = [...doc.matchAll(/^### (\d+)\. `([A-Z_]+)`$/gm)].map((m) => m[2]);

  it("lists exactly the recipe's construction variables, one section each", () => {
    expect(variables).toHaveLength(11);
    expect(sections).toEqual(variables);
  });
  it("every listed value is still NULL in the Lintel standard (doc says NULL / UNVERIFIED)", () => {
    for (const v of variables) expect(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables[v]).toBeNull();
  });
  it("every section carries all required fields", () => {
    const fields = ["Field name", "Current status", "Current value", "Unit", "Where used", "Affected components", "Affected formulas", "Affected drawings", "Affected manufacturing outputs", "Who provides / approves"];
    const bodies = doc.split(/^### \d+\. /m).slice(1);
    expect(bodies).toHaveLength(11);
    for (const body of bodies) for (const f of fields) expect(body).toContain(`| ${f} |`);
  });
});

describe("production-data intake documents", () => {
  const files = ["README.md", "01-construction-standards.md", "02-board-material-standards.md", "03-edge-banding-standards.md", "04-hardware-standards.md", "05-dimensional-limits.md", "06-manufacturing-standards.md", "07-pricing-standards.md"];
  it("all exist", () => {
    for (const f of files) expect(existsSync(join(DOCS, "production-data", f)), f).toBe(true);
  });
  it("01 lists all 11 construction variables individually", () => {
    const doc = read("production-data/01-construction-standards.md");
    for (const v of variables) expect(doc).toMatch(new RegExp(`\\| \\d+ \\| ${v} \\|`));
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
  it("overlay reference cabinet blocks on 10 of the 11 (INSET_GAP inactive)", async () => {
    const missing = await undefinedFor("OVERLAY");
    expect(missing).toHaveLength(10);
    expect(variables.filter((v) => !missing.includes(v))).toEqual(["INSET_GAP"]);
  });
  it("inset cabinet blocks on 8 of the 11 (overlay reveals inactive)", async () => {
    const missing = await undefinedFor("INSET");
    expect(missing).toEqual(["BACK_GROOVE_DEPTH", "BACK_REAR_OFFSET", "FRONT_BETWEEN_GAP", "FRONT_FINISHED_FACES", "INSET_GAP", "SHELF_FRONT_SETBACK", "SHELF_SIDE_CLEARANCE", "TOP_RAIL_WIDTH"]);
  });
});

describe("KIT_BASE_STANDARD_BENCHMARK_V1.md", () => {
  const doc = read("KIT_BASE_STANDARD_BENCHMARK_V1.md");
  it("is labelled as an industry benchmark, not the Lintel production standard", () => {
    expect(doc).toContain("INDUSTRY BENCHMARK - NOT LINTEL PRODUCTION STANDARD");
  });
  it("covers all 11 fields, each with the required rows", () => {
    const sections = [...doc.matchAll(/^### (\d+)\. `([A-Z_]+)`$/gm)].map((m) => m[2]);
    expect(sections).toEqual(variables);
    const bodies = doc.split(/^### \d+\. /m).slice(1);
    const rows = ["Benchmark value", "Source", "Source URL", "Source type", "Confidence", "Appears configurable", "Notes on applicability"];
    for (const body of bodies) for (const r of rows) expect(body).toContain(`| ${r} |`);
  });
  it("any recorded benchmark value carries a source URL; otherwise it states no verified benchmark", () => {
    for (const body of doc.split(/^### \d+\. /m).slice(1)) {
      const value = /\| Benchmark value \| (.+) \|/.exec(body)?.[1] ?? "";
      if (value !== "NO VERIFIED PUBLIC BENCHMARK FOUND") expect(body).toMatch(/\| Source URL \| https:\/\//);
    }
  });
  it("does not change the production standard", () => {
    for (const v of variables) expect(LINTEL_CONSTRUCTION_STANDARD_DRAFT.variables[v]).toBeNull();
  });
});
