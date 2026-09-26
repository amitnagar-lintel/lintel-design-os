/** M4 room golden fixtures (resolved room, and — added in later commits — room BOM/BOQ/quotation). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stableStringify } from "@lintel/types";
import { LINTEL_PRODUCTION_PRICING_RULES, LINTEL_PRODUCTION_QUOTATION_POLICY, LINTEL_PRODUCTION_RATE_CARD } from "@lintel/pricing-engine";
import { fixtureRoom, lLayout, productionRoom } from "../support/room.js";
import { quote, roomCommercials } from "../support/quotation.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "room");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

export const ROOM_CASES: { file: string; description: string; run: () => unknown }[] = [
  {
    file: "kitchen.l-layout.test-fixture.resolved-room.json",
    description: "PRD §11 kitchen, L-shaped TEST_FIXTURE layout: 3 touching cabinets on wall A, 1 returned cabinet on wall D (21 mm corner gap).",
    run: () => fixtureRoom(),
  },
  {
    file: "kitchen.l-layout.production.resolved-room.json",
    description: "Same layout with production data (construction, planning, Hettich all unverified): blocked.",
    run: () => productionRoom(lLayout()),
  },
  {
    file: "kitchen.l-layout.test-fixture.room-bom-boq.json",
    description: "Combined room BOM (object BOMs + traced room totals) and room BOQ for the TEST_FIXTURE L-layout.",
    run: () => roomCommercials(fixtureRoom()),
  },
  {
    file: "kitchen.l-layout.test-fixture.quotation.json",
    description: "TEST_FIXTURE quotation: per-object price snapshots, tax aggregated by rate (PER_RATE_GROUP), grand total rounded to whole rupees. Synthetic rates and policy.",
    run: () => quote(fixtureRoom()),
  },
  {
    file: "kitchen.l-layout.production.quotation.json",
    description: "PRODUCTION quotation: UNAVAILABLE until construction, planning, Hettich, pricing and finance data are approved.",
    run: () => quote(productionRoom(), { mode: "PRODUCTION", rateCard: LINTEL_PRODUCTION_RATE_CARD, rules: LINTEL_PRODUCTION_PRICING_RULES, policy: LINTEL_PRODUCTION_QUOTATION_POLICY }),
  },
];

describe.each(ROOM_CASES)("golden room: $file", ({ file, description, run }) => {
  const path = join(FIXTURES, file);
  const actual = `${stableStringify({ description, result: run() }, 2)}\n`;
  it("matches the committed fixture", () => {
    if (UPDATE) writeFileSync(path, actual);
    if (!existsSync(path)) throw new Error(`Golden fixture ${file} missing — run \`pnpm golden:update\` and review it.`);
    expect(actual).toBe(readFileSync(path, "utf8"));
  });
  it("is deterministic", () => {
    expect(`${stableStringify({ description, result: run() }, 2)}\n`).toBe(actual);
  });
});
