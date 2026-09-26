/**
 * Golden SVG / PDF fixtures for M3 drawings. Reviewed by rendering them; regenerate
 * after an intentional change with `pnpm golden:update` and review the diff.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSideSection, renderPdf, renderSvg } from "@lintel/drawing-engine";
import { DESIGN_VERSION, fixtureSlice, productionSlice, referenceObject } from "../support/scenario.js";
import { created, elevation, METADATA, schedule } from "../support/drawing.js";

const sideSection = (resolved: Parameters<typeof elevation>[0]) => created(createSideSection({ resolved, designVersion: DESIGN_VERSION, metadata: { ...METADATA, drawingNumber: "KIT-SS-001" } }));

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "drawings");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const CASES: readonly { file: string; render: () => string }[] = [
  { file: "kit-base-standard.test-fixture.front-elevation.svg", render: () => renderSvg(created(elevation(fixtureSlice().resolved))) },
  { file: "kit-base-standard.test-fixture.panel-schedule.svg", render: () => renderSvg(created(schedule(fixtureSlice().resolved))) },
  { file: "kit-base-standard.test-fixture.inset.front-elevation.svg", render: () => renderSvg(created(elevation(fixtureSlice(referenceObject({ parameters: { frontType: "INSET" } })).resolved))) },
  { file: "kit-base-standard.production.front-elevation.svg", render: () => renderSvg(created(elevation(productionSlice().resolved))) },
  { file: "kit-base-standard.production.panel-schedule.svg", render: () => renderSvg(created(schedule(productionSlice().resolved))) },
  { file: "kit-base-standard.test-fixture.side-section.svg", render: () => renderSvg(sideSection(fixtureSlice().resolved)) },
  { file: "kit-base-standard.test-fixture.inset.side-section.svg", render: () => renderSvg(sideSection(fixtureSlice(referenceObject({ parameters: { frontType: "INSET" } })).resolved)) },
  { file: "kit-base-standard.production.side-section.svg", render: () => renderSvg(sideSection(productionSlice().resolved)) },
  {
    file: "kit-base-standard.test-fixture.drawings.pdf",
    render: () => renderPdf([created(elevation(fixtureSlice().resolved)), created(schedule(fixtureSlice().resolved))]),
  },
];

describe.each(CASES)("golden drawing: $file", ({ file, render }) => {
  const path = join(FIXTURES, file);
  const actual = render();
  it("matches the committed fixture", () => {
    if (UPDATE) writeFileSync(path, actual, "latin1");
    if (!existsSync(path)) throw new Error(`Golden fixture ${file} missing — run \`pnpm golden:update\` and review it.`);
    expect(actual).toBe(readFileSync(path, "latin1"));
  });
  it("is deterministic", () => {
    expect(render()).toBe(actual);
  });
});
