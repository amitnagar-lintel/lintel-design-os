/**
 * PRD §44 golden fixtures for the 600 × 720 × 560 reference cabinet. The snapshot
 * covers components, dimensions, materials, hardware requirements and resolutions,
 * BOM, BOQ and validation.
 *
 * Fixtures are committed and reviewed by humans. To regenerate after an intentional
 * change: `pnpm golden:update`, then review the diff.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DesignObject } from "@lintel/types";
import { stableStringify } from "@lintel/design-engine";
import { fixtureSlice, productionSlice, referenceObject } from "../support/scenario.js";
import type { SliceResult } from "../support/scenario.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const snapshot = (description: string, r: SliceResult): string =>
  `${stableStringify({ description, resolved: r.resolved, bom: r.bom, boq: r.boq }, 2)}\n`;

const SCENARIOS: readonly { file: string; description: string; run: (o?: DesignObject) => SliceResult }[] = [
  {
    file: "kit-base-standard.reference.production.json",
    description:
      "PRD §42 reference cabinet with the production configuration: Lintel construction standard (DRAFT, no values defined) and the official Hettich dataset slot (empty). Expected: only fully-defined components, every missing construction value reported, approval blocked.",
    run: productionSlice,
  },
  {
    file: "kit-base-standard.reference.test-fixture.json",
    description:
      "PRD §42 reference cabinet with TEST_FIXTURE construction values and TEST_FIXTURE Hettich data (synthetic, non-authoritative). Exercises the full pipeline; approval is always blocked.",
    run: fixtureSlice,
  },
];

describe.each(SCENARIOS)("golden: $file", ({ file, description, run }) => {
  const path = join(FIXTURES, file);
  const actual = snapshot(description, run());

  it("matches the committed fixture", () => {
    if (UPDATE) writeFileSync(path, actual);
    if (!existsSync(path)) throw new Error(`Golden fixture ${file} missing — run \`pnpm golden:update\` and review it.`);
    expect(actual).toBe(readFileSync(path, "utf8"));
  });

  it("is deterministic across repeated runs", () => {
    for (let n = 0; n < 5; n++) expect(snapshot(description, run())).toBe(actual);
  });

  it("does not depend on input key order", () => {
    const o = referenceObject();
    const reordered: DesignObject = {
      ...o,
      dimensions: { depth: o.dimensions.depth, height: o.dimensions.height, width: o.dimensions.width },
      parameters: Object.fromEntries(Object.entries(o.parameters).reverse()),
    };
    expect(snapshot(description, run(reordered))).toBe(actual);
  });
});
