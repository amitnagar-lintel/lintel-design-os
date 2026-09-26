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
